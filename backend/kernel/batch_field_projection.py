"""Read a verified display projection without reserializing full-field shards.

Research.encode writes canonical UTF-8 JSON, so its byte SHA256 is exactly the
saved output fingerprint. Noncanonical legacy rows use the host's full reader.
Currentness and presentation contracts always use the existing host checks.
"""
import json
from collections import OrderedDict
from threading import RLock
from weakref import WeakKeyDictionary
from hashlib import sha256
from concurrent.futures import Future
from pathlib import Path
import sqlite3
from contextlib import closing
from fastapi import HTTPException
from .read_models import RUN_COLUMNS,run_state
from .convergence import has_temperature_field,temperature_convergence

# Immutable display data only. The generation shortcut expires on commits;
# a content receipt survives unrelated commits after rehashing actual bytes.
# Both receipts bind the source generation, so changed seals invalidate them.
# Method/input revisions and live execution status remain uncached below.
_caches = WeakKeyDictionary()
_lock = RLock()
_pending = {}


def durable_identity(research, snapshot, hashes, wid, rid):
    """The receipt is derived data, separate from the engineering database.

    Bind actual source bytes, the installed sealed artifact/dependency contract
    and the reader implementation. Verify the installation before disk reuse;
    live input/version/currentness checks still happen below for every request.
    """
    if not hasattr(research.store,'path'):return None
    method=json.loads(snapshot)['definition']['method']
    plugin=research.registry(method['plugin_id']).get(method['plugin_id'])
    pin={**research.pin(plugin),'capability':method['capability']}
    research.resolve(pin)
    readers=('batch_field_projection.py','research.py','convergence.py','answer_witnesses.py')
    identity=(wid,rid,*hashes,pin,
              tuple((name,sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()) for name in readers))
    return sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def durable_receipt(research, identity, payload=None):
    if identity is None:return None
    path=Path(research.store.path).with_suffix('.display-cache.sqlite')
    if payload is None and not path.exists():return None
    try:
        with closing(sqlite3.connect(path,timeout=2)) as db, db:
            if payload is None:
                row=db.execute('SELECT data_sha256,data FROM projections WHERE identity=?',(identity,)).fetchone()
                if row and sha256(row[1].encode()).hexdigest()==row[0]:return row[1]
            else:
                db.execute('CREATE TABLE IF NOT EXISTS projections(identity TEXT PRIMARY KEY,data_sha256 TEXT NOT NULL,data TEXT NOT NULL)')
                db.execute('INSERT OR IGNORE INTO projections VALUES (?,?,?)',(identity,sha256(payload.encode()).hexdigest(),payload))
                db.execute('DELETE FROM projections WHERE rowid NOT IN (SELECT rowid FROM projections ORDER BY rowid DESC LIMIT 12)')
    except (sqlite3.Error,OSError):
        pass  # A missing/damaged/unwritable derived cache repeats full verification.
    return None


def display_only(run):
    output=run.get('output') or {}
    cases=[{**case,'artifacts':{key:value for key,value in case.get('artifacts',{}).items()
                              if not key.startswith('x-cablesim.field-')}} for case in output.get('cases',[])]
    return {**run,'output':{**output,'cases':cases}}


def decode_display_output(db, raw):
    """Parse authenticated JSON in SQLite before allocating lossless shards.

    Only the same case-artifact keys removed by display_only are omitted. The
    complete source is hashed above; SQLite validates its JSON, and all visible
    physical artifacts still undergo the existing artifact_status validation.
    Bind these exact bytes instead of rereading a potentially changed row.
    """
    if not raw:return None
    try:
        paths=[row[0] for row in db.execute(
            "SELECT fullkey FROM json_tree(CAST(? AS TEXT)) WHERE path LIKE '$.cases[%].artifacts' AND key GLOB 'x-cablesim.field-*'",(raw,))]
    except sqlite3.OperationalError as exc:
        raise ValueError('保存场 JSON 格式不完整。') from exc
    if not paths:return json.loads(raw)
    for start in range(0,len(paths),100):
        group=paths[start:start+100]
        raw=db.execute('SELECT json_remove(CAST(? AS TEXT),'+','.join('?' for _ in group)+')',(raw,*group)).fetchone()[0]
    return json.loads(raw)


def read_display(research,wid,rid):
    """Coalesce a cold source read before fetching its large SQLite payload.

    A waiter repeats the normal reader afterwards, including currentness. It
    can use only the authenticated generation receipt created by the owner;
    commits/source changes force its normal full read instead.
    """
    from .report_reads import read_generation
    monitor=getattr(research,'read_responses',None)
    if monitor is not None and hasattr(monitor,'initialize'):
        with monitor.lock:monitor.initialize(True)
    generation=read_generation(research)
    if generation is None:return _read_display(research,wid,rid)
    receipt_key=('generation',wid,rid,generation)
    pending_key=('source-read',id(research),receipt_key)
    with _lock:
        try:cached=_caches.get(research,{}).get(receipt_key)
        except TypeError:cached=None
        pending=_pending.get(pending_key)
        owner=pending is None
        if cached is None and owner:
            pending=Future();_pending[pending_key]=pending
    if cached is not None:return _read_display(research,wid,rid)
    if not owner:
        pending.result()
        return _read_display(research,wid,rid)
    try:
        result=_read_display(research,wid,rid)
        pending.set_result(None)
        return result
    except BaseException as exc:
        pending.set_exception(exc);pending.exception()
        raise
    finally:
        with _lock:_pending.pop(pending_key,None)


def _read_display(research,wid,rid):
    from .report_reads import read_generation
    monitor=getattr(research,'read_responses',None)
    if monitor is not None and hasattr(monitor,'initialize'):
        with monitor.lock:monitor.initialize(True)
    generation=read_generation(research)
    receipt_key=('generation',wid,rid,generation)
    with _lock:
        try:cache=_caches.get(research,{})
        except TypeError:cache={}
        receipt=cache.get(receipt_key) if generation is not None else None
    with getattr(research.store,'read_snapshot',research.store.db)() as db:
        if not hasattr(research.store,'read_snapshot'):db.execute('BEGIN')
        workspace=db.execute('SELECT revision FROM workspaces WHERE id=?',(wid,)).fetchone()
        if workspace is None:raise HTTPException(404,'工程不存在。')
        # Recheck after the read transaction has acquired its database snapshot;
        # a commit between receipt lookup and BEGIN must force a full reread.
        if receipt is not None and generation!=read_generation(research):receipt=None
        columns='id,workspace,study,sequence,status,created,finished,input_digest,output_digest' if receipt is not None else RUN_COLUMNS
        row=db.execute(f'SELECT {columns} FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
        if row is None:raise HTTPException(404,'运行不存在或不属于此工程。')
        value=dict(row)
        # Never trust just a declared digest or cached database identity.
        hashes=tuple(sha256(value[name] or b'').hexdigest() for name in ('snapshot','output','error')) if receipt is None else ()
        canonical=receipt is not None or hashes[0]==value['input_digest'] and (value['output'] is None or hashes[1]==value['output_digest'])
        if canonical:
            # Source binding includes the frozen input bytes and authenticated
            # output bytes, not just the row's declared fingerprint. Reusing a
            # projection cannot authorize delivery or bypass run_state below.
            content_key=('content',wid,rid,generation[1] if generation is not None else None,*hashes)
            key=receipt_key if receipt is not None else content_key
            with _lock:
                try:cache=_caches.setdefault(research,OrderedDict())
                except TypeError:cache=OrderedDict()  # Unhashable/nonweak test or legacy reader: no cache.
                cached=cache.get(key)
                if cached is not None:cache.move_to_end(key)
                pending_key=(id(research),key)
                pending=_pending.get(pending_key)
                owner=pending is None
                if cached is None and owner:
                    pending=Future();_pending[pending_key]=pending
            if cached is None and not owner:
                cached=pending.result()  # Read worker only; no writer lock held.
            if cached is None:
                try:
                    try:disk_key=durable_identity(research,value['snapshot'],hashes,wid,rid)
                    except Exception:disk_key=None  # Normal run_state reports installation errors; never trust a disk receipt.
                    cached=durable_receipt(research,disk_key)
                    if cached is None:
                        decoded={name:json.loads(value[name]) if value[name] else None for name in ('snapshot','error')}
                        decoded['output']=decode_display_output(db,value['output'])
                        if not isinstance(decoded['snapshot'],dict) or (decoded['output'] is not None and not isinstance(decoded['output'],dict)):
                            raise ValueError('Invalid saved envelope')
                        projected=display_only(decoded)
                        projected['artifact_status']=research.artifact_status(projected)
                        if has_temperature_field(projected):projected['convergence']=temperature_convergence(projected)
                        # Immutable JSON; consumers receive their own decoded copy.
                        cached=json.dumps(projected,ensure_ascii=False,separators=(',',':'))
                        durable_receipt(research,disk_key,cached)
                    with _lock:
                        cache[key]=cached
                        while len(cache)>12:cache.popitem(last=False)
                    pending.set_result(cached)
                except BaseException as exc:
                    failure=HTTPException(409,'保存场完整性未通过。') if isinstance(exc,(ValueError,TypeError)) else exc
                    pending.set_exception(failure)
                    # Consume the owner's exception if no other reader waited.
                    pending.exception()
                    if failure is not exc:raise failure from exc
                    raise
                finally:
                    with _lock:_pending.pop(pending_key,None)
            # Consumers may trim inputs/artifacts. Never let their mutation
            # change the immutable verified entry used by the next request.
            value.update(json.loads(cached))
            if generation is not None and generation==read_generation(research):
                with _lock:
                    cache[receipt_key]=cached
                    while len(cache)>12:cache.popitem(last=False)
            study=research.definition(db,wid,value['study'])
            value.update(run_state(research,value['snapshot'],wid,workspace['revision'],study,{}))
    if not canonical:
        value=display_only(research.get_run(wid,rid))
        if value.get('integrity')!='verified':raise HTTPException(409,'保存场完整性未通过。')
        return value
    if hasattr(research.executor,'execution_status'):
        method=value['snapshot']['definition']['method']
        value['execution']=research.executor.execution_status(rid,method['plugin_id'],method['capability'])
        if value['execution'] and value['status'] in ('succeeded','partial','failed','interrupted'):
            value['execution']={**value['execution'],'state':value['status']}
    value['integrity']='verified'
    from .report_reads import bind_display_projection
    bind_display_projection(value)
    return value
