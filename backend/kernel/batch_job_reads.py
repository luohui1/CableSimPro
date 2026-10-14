"""Small job identities, never cached scheduler status or solver inputs."""
from collections import OrderedDict
from contextlib import closing
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
from threading import RLock
from weakref import WeakKeyDictionary

_plans=OrderedDict()
_runs=WeakKeyDictionary()
_lock=RLock()


def _plan_projection(raw):
    # SQLite validates the complete JSON but materializes only these root
    # members. Loading the embedded schemas/cases as Python trees dominates
    # first-page job reads; they are not part of a job's saved identity.
    text=raw.decode('utf-8')
    with closing(sqlite3.connect(':memory:')) as db:
        if not db.execute('SELECT json_valid(?)',(text,)).fetchone()[0]:
            raise ValueError('保存的超算计划不是合法 JSON。')
        rows=db.execute("SELECT key,value,type FROM json_each(?) WHERE key IN ('id','phase','operation_id','plugin_id','capability','research_context','execution')",(text,)).fetchall()
    return {key:json.loads(value) if kind in ('object','array') else value for key,value,kind in rows}


def plan_identity(path):
    # Read and hash real bytes even on a hit. Only the small projection survives;
    # full cases, manifests and attachments are never retained in this cache.
    raw=Path(path).read_bytes();key=sha256(raw).digest()
    with _lock:
        value=_plans.get(key)
        if value is not None:_plans.move_to_end(key)
    if value is None:
        value=_plan_projection(raw)
        with _lock:
            _plans[key]=value
            while len(_plans)>128:_plans.popitem(last=False)
    return deepcopy(value)


def study_identities(research):
    def generation_now():
        monitor=getattr(getattr(research,'read_responses',None),'database',None)
        if monitor is None:return None
        try:return monitor.execute('PRAGMA data_version').fetchone()[0]
        except sqlite3.Error:return None
    generation=generation_now()
    with _lock:
        try:receipt=_runs.get(research)
        except TypeError:receipt=None
    # These are frozen database fields, not installed-method verdicts. The
    # persistent SQLite monitor is serialized by SQLite itself: do not wait for
    # the unrelated field/catalog response lock or poll source notifications.
    # A commit invalidates them. Live execution is read separately afterwards.
    with getattr(research.store,'read_snapshot',research.store.db)() as db:
        db.execute('SELECT id FROM study_runs LIMIT 1').fetchone()
        if receipt is not None and generation is not None and receipt[0]==generation==generation_now():
            return deepcopy(receipt[1])
        rows=db.execute("SELECT id,workspace,study,sequence,status,created,finished,json_extract(snapshot,'$.definition.title','$.definition.method') AS method_identity FROM study_runs ORDER BY sequence DESC").fetchall()
        result=[dict(row) for row in rows]
    if generation is not None and generation==generation_now():
        with _lock:
            try:_runs[research]=(generation,result)
            except TypeError:pass
    return result
