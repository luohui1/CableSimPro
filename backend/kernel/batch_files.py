"""Portable atomic JSON, hashing and process-scoped locks for dataset artifacts."""
from contextlib import contextmanager
from hashlib import sha256
import json
import os
import time
from pathlib import Path
from uuid import uuid4


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return sha256(encoded(value)).hexdigest()


def read(path):
    return json.loads(Path(path).read_text('utf-8'), parse_constant=lambda s: (_ for _ in ()).throw(ValueError(s)))


def atomic(path, value):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid4().hex+'.part')
    try:
        with temporary.open('xb') as stream:
            stream.write(encoded(value));stream.flush();os.fsync(stream.fileno())
        # Windows readers/antivirus can briefly hold a handle without DELETE
        # sharing. Keep the old complete file until replacement succeeds; do not
        # turn a transient progress-file collision into a failed Slurm run.
        deadline=time.monotonic()+2
        while True:
            try:
                os.replace(temporary,path);break
            except PermissionError as exc:
                if getattr(exc,'winerror',None) not in (5,32,33) or time.monotonic()>=deadline:raise
                time.sleep(.02)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def locked(path, blocking=False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a+b') as stream:
        stream.seek(0,2)
        if stream.tell()==0:
            stream.write(b'0');stream.flush()
        stream.seek(0)
        if os.name=='nt':
            import msvcrt
            deadline=time.monotonic()+120
            while True:
                try:msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1);break
                except OSError as exc:
                    if not blocking or time.monotonic()>=deadline:raise BlockingIOError('Another execution owns this dataset/sample') from exc
                    time.sleep(.05)
        else:
            import fcntl
            fcntl.flock(stream.fileno(),fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        try:yield
        finally:
            stream.seek(0)
            if os.name=='nt':msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
            else:fcntl.flock(stream.fileno(),fcntl.LOCK_UN)
