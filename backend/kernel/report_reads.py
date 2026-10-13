"""Saved-run receipts bound to database commits and sealed source changes.

Only canonical JSON bypasses reserialization; legacy JSON keeps its semantic
digest check. Display copies may never replace a full saved output.
"""
from contextlib import closing, contextmanager
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


def observation_generation(research,validator):
    """A stable SQLite monitor plus actual validator bytes, without a file watch.

    This is only for immutable observation metadata. If the monitor is absent,
    the caller rehashes source rows. A commit changes data_version on this same
    persistent connection; no database identity is compared across connections.
    """
    cache=getattr(research,'read_responses',None)
    if cache is None or cache.database is None:return None
    with cache.lock:return (cache.database.execute('PRAGMA data_version').fetchone()[0],validator)


def observation_receipt(research,key,generation,value=None):
    if generation is None:return None
    with _image_lock:
        entries=_observations.setdefault(research,OrderedDict())
        identity=(generation,key)
        if value is None:return entries.get(identity)
        entries[identity]=value
        while len(entries)>64:entries.popitem(last=False)
    return value


def saved_observation_receipt(research,identity,value=None):
    """Immutable derived metadata; caller rehashes the original row before reuse."""
    from pathlib import Path
    import sqlite3,json
    if not hasattr(research.store,'path'):return None
    path=Path(research.store.path).with_suffix('.display-cache.sqlite')
    if value is None and not path.exists():return None
    try:
        with closing(sqlite3.connect(path,timeout=2)) as db, db:
            if value is None:
                row=db.execute('SELECT digest,data FROM observations WHERE identity=?',(identity,)).fetchone()
                if row and byte_digest(row[1])==row[0]:return json.loads(row[1])
            else:
                payload=json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
                db.execute('CREATE TABLE IF NOT EXISTS observations(identity TEXT PRIMARY KEY,digest TEXT NOT NULL,data TEXT NOT NULL)')
                db.execute('INSERT OR IGNORE INTO observations VALUES (?,?,?)',(identity,byte_digest(payload),payload))
                db.execute('DELETE FROM observations WHERE rowid NOT IN (SELECT rowid FROM observations ORDER BY rowid DESC LIMIT 128)')
    except (sqlite3.Error,OSError,ValueError):pass
    return None


def field_image_receipt(research, identity, image=None):
    """Derived image only; actual field bytes were authenticated by the caller."""
    from pathlib import Path
    import sqlite3
    if research is None or not hasattr(getattr(research,'store',None),'path'):return None
    path=Path(research.store.path).with_suffix('.display-cache.sqlite')
    if image is None and not path.exists():return None
    try:
        with closing(sqlite3.connect(path,timeout=2)) as db, db:
            if image is None:
                row=db.execute('SELECT digest,png FROM field_images WHERE identity=?',(identity,)).fetchone()
                if row and sha256(row[1]).hexdigest()==row[0] and row[1].startswith(b'\x89PNG\r\n\x1a\n'):return row[1]
            else:
                db.execute('CREATE TABLE IF NOT EXISTS field_images(identity TEXT PRIMARY KEY,digest TEXT NOT NULL,png BLOB NOT NULL)')
                db.execute('INSERT OR IGNORE INTO field_images VALUES (?,?,?)',(identity,sha256(image).hexdigest(),image))
                db.execute('DELETE FROM field_images WHERE rowid NOT IN (SELECT rowid FROM field_images ORDER BY rowid DESC LIMIT 12)')
    except (sqlite3.Error,OSError):
        pass  # A damaged/missing cache never removes source or proof checks.
    return None


def saved_field_image(field,research=None):
    from .batch_field_chapter import field_png
    from .workspace import fingerprint
    from pathlib import Path
    import PIL,numpy
    renderer=Path(__file__).with_name('batch_field_chapter.py')
    tokens=renderer.resolve().parents[2]/'design'/'tokens.css'
    identity=fingerprint((fingerprint(field),sha256(renderer.read_bytes()).hexdigest(),
                          sha256(tokens.read_bytes()).hexdigest(),PIL.__version__,numpy.__version__))
    key=(field_png,identity)
    with _image_lock:
        image=_images.get(key)
        if image is not None:_images.move_to_end(key);return image
    image=field_image_receipt(research,identity)
    if image is None:
        image=field_png(field)
        field_image_receipt(research,identity,image)
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


def bind_display_projection(run):
    """Request-local receipt after authenticating original bytes in read_display.

    The receipt is never accepted from a JSON/API caller. A paper may omit binary
    mesh arrays only if this same source read authenticated its original digest.
    """
    from .workspace import fingerprint
    cache=read_cache()
    if cache is not None:
        cache[('verified-display',run['workspace'],run['id'],run['input_digest'],run['output_digest'])]=fingerprint(run['output'])


def verified_display_projection(run):
    from .workspace import fingerprint
    cache=read_cache()
    return cache is not None and cache.get(('verified-display',run['workspace'],run['id'],run['input_digest'],run['output_digest']))==fingerprint(run['output'])


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
            # A verified projection keeps original artifact digests, even when
            # binary shards were not decoded. Preserve those same full-source
            # references in the paper archive without fetching the arrays.
            for key,digest in case.get('artifact_digests',{}).items():
                if key.startswith('x-cablesim.field-') and key not in case.get('artifacts',{}):
                    references.append({'case_id':case['case_id'],'artifact':key,'sha256':digest,
                        'saved_run_url':f"/api/workspaces/{run['workspace']}/studies/{run['study']}/runs/{run['id']}"})
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
