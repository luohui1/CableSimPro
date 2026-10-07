"""Validated read responses, invalidated by database commits and source changes."""
from collections import OrderedDict
from contextlib import suppress
from hashlib import sha256
from threading import RLock
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
        self.entries = OrderedDict()
        self.bytes = 0
        self.database = None
        self.source_root = None
        self.watch = None

    def initialize(self, uses_database):
        root = self.research.executor.registry.root.parent
        if self.source_root != root:
            if self.watch is not None:self.watch.close()
            self.source_root = root
            self.watch = SourceWatch(root.resolve())
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
                    identities.append(('study', row['id'], row['revision'], fingerprint(row['definition'])))
        return tuple(identities)

    def build(self, key, model, load, uses_database, *, exclude_unset=False):
        with self.lock:
            self.initialize(uses_database)
            before = self.generation(uses_database)
            previous = self.entries.get(key)
            if before is not None and previous is not None and previous[0] == before:
                self.entries.move_to_end(key)
                return previous[2]
        value = load()
        adapter = TypeAdapter(model) if not isinstance(value, bytes) else None
        payload = value if isinstance(value, bytes) else adapter.dump_json(
            adapter.validate_python(value), by_alias=True, exclude_unset=exclude_unset)
        identity = self.input_identity(value)
        with self.lock:
            after = self.generation(uses_database)
            # A concurrent commit/publication may make this response usable for
            # its own read only; it must never become a reusable current receipt.
            if before is not None and before == after and len(payload) <= self.MAX_BYTES:
                prior = self.entries.pop(key, None)
                if prior is not None:self.bytes -= len(prior[2])
                self.entries[key] = (after, identity, payload)
                self.bytes += len(payload)
                while self.bytes > self.MAX_BYTES or len(self.entries) > self.MAX_ENTRIES:
                    _, old = self.entries.popitem(last=False);self.bytes -= len(old[2])
        return payload

    def close(self):
        with self.lock:
            if self.watch is not None:self.watch.close()
            if self.database is not None:
                with suppress(sqlite3.Error):self.database.close()
            self.watch = None;self.database = None
            self.entries.clear();self.bytes = 0


async def read_response(research, key, model, load, *, uses_database=True, exclude_unset=False):
    cache = research.read_responses
    payload = cache.get(key, uses_database)
    if payload is None:
        payload = await run_in_threadpool(cache.build, key, model, load, uses_database, exclude_unset=exclude_unset)
    return Response(payload, media_type='application/json')
