"""Read a verified display projection without reserializing full-field shards.

Research.encode writes canonical UTF-8 JSON, so its byte SHA256 is exactly the
saved output fingerprint. Noncanonical legacy rows use the host's full reader.
Currentness and presentation contracts always use the existing host checks.
"""
import json
from copy import deepcopy
from collections import OrderedDict
from threading import RLock
from weakref import WeakKeyDictionary
from hashlib import sha256
from fastapi import HTTPException
from .read_models import RUN_COLUMNS,run_state
from .convergence import has_temperature_field,temperature_convergence

# Immutable display data only. Receipts expire on database commits and sealed
# source changes. Without that monitor, actual bytes are hashed on every read.
# Method/input revisions and live execution status remain uncached below.
_caches = WeakKeyDictionary()
_lock = RLock()


def display_only(run):
    output=run.get('output') or {}
    cases=[{**case,'artifacts':{key:value for key,value in case.get('artifacts',{}).items()
                              if not key.startswith('x-cablesim.field-')}} for case in output.get('cases',[])]
    return {**run,'output':{**output,'cases':cases}}


def read_display(research,wid,rid):
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
    with research.store.db() as db:
        db.execute('BEGIN')
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
            key=receipt_key if generation is not None else (wid,rid,*hashes)
            with _lock:
                try:cache=_caches.setdefault(research,OrderedDict())
                except TypeError:cache=OrderedDict()  # Unhashable/nonweak test or legacy reader: no cache.
                cached=cache.get(key)
                if cached is not None:cache.move_to_end(key)
            if cached is None:
                try:
                    decoded={name:json.loads(value[name]) if value[name] else None for name in ('snapshot','output','error')}
                    if not isinstance(decoded['snapshot'],dict) or (decoded['output'] is not None and not isinstance(decoded['output'],dict)):
                        raise ValueError('Invalid saved envelope')
                except (ValueError,TypeError) as exc:raise HTTPException(409,'保存场完整性未通过。') from exc
                cached=display_only(decoded)
                cached['artifact_status']=research.artifact_status(cached)
                if has_temperature_field(cached):cached['convergence']=temperature_convergence(cached)
                with _lock:
                    cache[key]=cached
                    while len(cache)>4:cache.popitem(last=False)
            # Consumers may trim inputs/artifacts. Never let their mutation
            # change the immutable verified entry used by the next request.
            value.update(deepcopy(cached))
            if generation is not None and generation==read_generation(research):
                with _lock:
                    cache[receipt_key]=cached
                    while len(cache)>4:cache.popitem(last=False)
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
    return value
