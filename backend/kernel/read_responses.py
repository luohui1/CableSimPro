"""Validated read responses, invalidated by database commits and source changes."""
from collections import OrderedDict
from contextlib import suppress
from hashlib import sha256
from threading import Condition, RLock
from concurrent.futures import Future
from time import perf_counter
from gzip import compress
import sqlite3

from fastapi import Response
from pydantic import TypeAdapter
from starlette.concurrency import run_in_threadpool

from .source_watch import SourceWatch
from .workspace import fingerprint


class ReadResponses:
    MAX_BYTES = 8 * 1024 * 1024
    MAX_ENTRIES = 64

    def __init__(self, research):
        self.research = research
        self.lock = RLock()
        self.idle = Condition(self.lock)
        self.closed = False
        self.entries = OrderedDict()
        self.inflight = {}
        self.bytes = 0
        self.database = None
        self.source_root = None
        self.watch = None
        self.encoded = OrderedDict()
        self.encoded_bytes = 0

    def initialize(self, uses_database):
        root = self.research.executor.registry.root.parent
        if self.source_root != root:
            if self.watch is not None:self.watch.close()
            self.source_root = root
            # Unrelated host services do not change plugin contracts/evidence.
            # Sealed dependency locks define the public source closure; plugin
            # additions and publication still invalidate immediately.
            self.watch = SourceWatch(root.resolve(), release_only=True)
            self.entries.clear();self.bytes = 0
        if uses_database and self.database is None:
            # A persistent connection is required: data_version cannot be compared
            # across separate SQLite connections. It holds no read transaction.
            uri = self.research.store.path.resolve().as_uri() + '?mode=ro'
            self.database = sqlite3.connect(uri, uri=True, check_same_thread=False, timeout=20)

    def generation(self, uses_database):
        source = self.watch.snapshot()
        if source is None:return None
        database = self.database.execute('PRAGMA data_version').fetchone()[0] if uses_database else None
        return (database, source)

    def get(self, key, uses_database):
        # Cache misses and lock contention use the existing worker thread. The
        # event loop only polls ready notifications and a tiny SQLite pragma.
        if self.watch is None or not self.lock.acquire(blocking=False):return None
        try:
            if self.closed:return None
            if self.source_root != self.research.executor.registry.root.parent:return None
            # A source-only read may have initialized the cache first; the build path opens the database.
            if uses_database and self.database is None:return None
            generation = self.generation(uses_database)
            entry = self.entries.get(key)
            if generation is not None and entry is not None and entry[0] == generation:
                self.entries.move_to_end(key)
                return entry[2]
            return None
        finally:self.lock.release()

    def input_identity(self, value):
        """Retain the actual input/output digests and frozen method release keys."""
        if isinstance(value, bytes):
            catalog = next(reversed(self.research.contract_read_cache), None)
            return ('contract', catalog, sha256(value).digest())
        rows = value if isinstance(value, list) else value.get('items', [value])
        identities = []
        with self.research.run_read_lock:
            for row in rows:
                wid = str(row.get('workspace', ''))
                rid = row.get('latest_run_id') or (row.get('id') if 'snapshot' in row else None)
                receipt = self.research.run_read_cache.get((wid, str(rid))) if rid else None
                if receipt is not None:
                    method = receipt[1]['method'] or {}
                    identities.append((str(rid), receipt[0], method.get('release_digest')))
                if 'definition' in row:
                    identities.append(('study', row['id'], row['revision'],
                                       row.get('definition_digest') or fingerprint(row['definition'])))
        return tuple(identities)

    def build(self, key, model, load, uses_database, *, exclude_unset=False):
        with self.lock:
            if self.closed:
                raise RuntimeError('研究读取服务已关闭')
            self.initialize(uses_database)
            before = self.generation(uses_database)
            previous = self.entries.get(key)
            if before is not None and previous is not None and previous[0] == before:
                self.entries.move_to_end(key)
                return previous[2]
            pending_key = (key, before)
            pending = self.inflight.get(pending_key)
            owner = pending is None
            if owner:
                pending = Future()
                self.inflight[pending_key] = pending
        if not owner:
            return pending.result()  # Worker thread only; never block the event loop.
        try:
            # Resolve all release pins against one verified source snapshot in
            # this read. Executions still rehash independently; source changes
            # during the read prevent caching below.
            from .verified_executor import verification_scope
            with verification_scope():
                value = load()
            adapter = TypeAdapter(model) if not isinstance(value, bytes) else None
            payload = value if isinstance(value, bytes) else adapter.dump_json(
                adapter.validate_python(value), by_alias=True, exclude_unset=exclude_unset)
            identity = self.input_identity(value)
            with self.lock:
                after = self.generation(uses_database)
                # Publication/commit during this read must not become a reusable receipt.
                if before is not None and before == after and len(payload) <= self.MAX_BYTES:
                    prior = self.entries.pop(key, None)
                    if prior is not None:self.bytes -= len(prior[2])
                    self.entries[key] = (after, identity, payload)
                    self.bytes += len(payload)
                    while self.bytes > self.MAX_BYTES or len(self.entries) > self.MAX_ENTRIES:
                        _, old = self.entries.popitem(last=False);self.bytes -= len(old[2])
            pending.set_result(payload)
            return payload
        except BaseException as exc:
            pending.set_exception(exc)
            raise
        finally:
            with self.idle:
                self.inflight.pop(pending_key, None)
                self.idle.notify_all()

    def close(self):
        with self.idle:
            # A builder loads outside the cache lock, then needs the watcher and
            # data_version connection again to authenticate its final receipt.
            # Stop admission first; release the lock while waiting for owners.
            self.closed = True
            while self.inflight:self.idle.wait()
            if self.watch is not None:self.watch.close()
            if self.database is not None:
                with suppress(sqlite3.Error):self.database.close()
            self.watch = None;self.database = None
            self.entries.clear();self.bytes = 0
            self.encoded.clear();self.encoded_bytes = 0

    def gzip(self, payload):
        # Content addressed, so a DB commit or new seal can never reuse bytes
        # from another response. Bounded separately from verified read receipts.
        key = sha256(payload).digest()
        with self.lock:
            previous = self.encoded.get(key)
            if previous is not None:
                self.encoded.move_to_end(key)
                return previous
        encoded = compress(payload, compresslevel=1, mtime=0)
        with self.lock:
            if self.closed:return encoded
            if key not in self.encoded:
                self.encoded[key] = encoded
                self.encoded_bytes += len(encoded)
            while self.encoded_bytes > self.MAX_BYTES or len(self.encoded) > self.MAX_ENTRIES:
                _, old = self.encoded.popitem(last=False)
                self.encoded_bytes -= len(old)
        return encoded


async def read_response(research, key, model, load, *, uses_database=True, exclude_unset=False, request=None):
    started=perf_counter()
    cache = research.read_responses if uses_database else research.catalog_read_responses
    payload = cache.get(key, uses_database)
    hit=payload is not None
    if payload is None:
        payload = await run_in_threadpool(cache.build, key, model, load, uses_database, exclude_unset=exclude_unset)
    headers = {
        'Server-Timing': f'host-read;dur={(perf_counter()-started)*1000:.2f}',
        'X-CableSim-Read-Cache': 'hit' if hit else 'miss', 'Vary':'Accept-Encoding',
        'Cache-Control': 'private, no-cache',
        'ETag': 'W/"'+sha256(payload).hexdigest()+'"'}
    # Revalidate against the newly verified content, never a timestamp or a
    # caller-supplied digest. Browsers can reuse bytes only after this check.
    if request is not None:
        candidates = request.headers.get('if-none-match', '').split(',')
        if any(tag.strip().removeprefix('W/') == headers['ETag'].removeprefix('W/')
               for tag in candidates):
            return Response(status_code=304, headers=headers)
    accepted = request.headers.get('accept-encoding','') if request is not None else ''
    if len(payload) >= 1024 and accepts_gzip(accepted):
        payload = await run_in_threadpool(cache.gzip, payload)
        headers['Content-Encoding'] = 'gzip'
    return Response(payload, media_type='application/json', headers=headers)


def accepts_gzip(header):
    for item in header.lower().split(','):
        parts = [p.strip() for p in item.split(';')]
        if parts[0] != 'gzip':continue
        try:return all(float(p[2:]) > 0 for p in parts[1:] if p.startswith('q='))
        except ValueError:return False
    return False
