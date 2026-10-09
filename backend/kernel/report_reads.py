"""Saved-run receipts bound to database commits and sealed source changes.

Only canonical JSON bypasses reserialization; legacy JSON keeps its semantic
digest check. Display copies may never replace a full saved output.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from hashlib import sha256
from collections import OrderedDict
from threading import RLock
from weakref import WeakKeyDictionary

_reads = ContextVar('report_saved_reads', default=None)
_progress = ContextVar('report_progress', default=None)
_images=OrderedDict()
_image_lock=RLock()
_observations=WeakKeyDictionary()


def read_generation(research):
    cache=getattr(research,'read_responses',None)
    if cache is None or cache.database is None or cache.watch is None:return None
    with cache.lock:return cache.generation(True)


def observation_receipt(research,key,generation,value=None):
    if generation is None:return None
    with _image_lock:
        entries=_observations.setdefault(research,OrderedDict())
        identity=(generation,key)
        if value is None:return entries.get(identity)
        entries[identity]=value
        while len(entries)>64:entries.popitem(last=False)
    return value


def saved_field_image(field):
    from .batch_field_chapter import field_png
    from .workspace import fingerprint
    key=(field_png,fingerprint(field))
    with _image_lock:
        image=_images.get(key)
        if image is not None:_images.move_to_end(key);return image
    image=field_png(field)
    with _image_lock:
        _images[key]=image
        while len(_images)>8:_images.popitem(last=False)
    return image


def checkpoint(stage):
    callback = _progress.get()
    if callback is not None: callback(stage)


@contextmanager
def progress_scope(callback):
    token = _progress.set(callback)
    try: yield
    finally: _progress.reset(token)


def saved_scope(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        from .verified_executor import verification_scope
        if _reads.get() is not None: return function(*args, **kwargs)
        token = _reads.set({})
        try:
            with verification_scope(): return function(*args, **kwargs)
        finally: _reads.reset(token)
    return wrapped


def read_cache():
    return _reads.get()


def byte_digest(value):
    return sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def archive_runs(runs):
    """Keep all inputs/results; replace binary full-mesh shards with bound refs.

    Binary arrays remain in immutable source runs in the engineering database;
    a paper attachment is a traceable manifest, not a second solver file store.
    """
    values=[]
    for run in runs:
        cases=[]; references=[]
        for case in run['output']['cases']:
            artifacts={}
            for key, value in case.get('artifacts', {}).items():
                if key.startswith('x-cablesim.field-'):
                    references.append({'case_id':case['case_id'],'artifact':key,
                        'sha256':case['artifact_digests'][key],
                        'saved_run_url':f"/api/workspaces/{run['workspace']}/studies/{run['study']}/runs/{run['id']}"})
                else: artifacts[key]=value
            cases.append({**case,'artifacts':artifacts})
        values.append({**run,'output':{**run['output'],'cases':cases},
                       'full_field_references':references} if references else run)
    return values
