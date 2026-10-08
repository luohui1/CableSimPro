"""Bounded retries of read operations or fully rolled-back task transactions."""
from functools import wraps
import sqlite3
from time import sleep,monotonic


def category(error):
    if isinstance(error,MemoryError):return 'memory_pressure'
    if isinstance(error,sqlite3.OperationalError):
        code=getattr(error,'sqlite_errorcode',None)
        if code is not None and code & 255 in (sqlite3.SQLITE_BUSY,sqlite3.SQLITE_LOCKED):return 'sqlite_busy'
        if 'locked' in str(error).lower() or 'busy' in str(error).lower():return 'sqlite_busy'
        if 'memory' in str(error).lower():return 'memory_pressure'
        return 'sqlite_operational'
    return None


def retry(operation,on_retry=None):
    began=monotonic()
    for attempt in range(3):
        try:return operation()
        except (sqlite3.OperationalError,MemoryError) as error:
            kind=category(error)
            if on_retry:on_retry(kind,attempt+1)
            if kind!='sqlite_busy' or attempt==2 or monotonic()-began>=.5:raise
            sleep(.03*(attempt+1))


def transaction(method):
    """The decorated method must contain only a single task-side transaction."""
    @wraps(method)
    def wrapped(self,*args,**kwargs):
        attempts=[]
        result=retry(lambda:method(self,*args,**kwargs),lambda kind,attempt:attempts.append({'category':kind,'attempt':attempt}))
        if attempts:
            tid=result if method.__name__=='create' else (args[0] if args else kwargs.get('tid'))
            try:
                with self.db(True) as db:self.event(db,tid,'runtime.retry',{'transaction':method.__name__,'exceptions':attempts,'rolled_back':True})
            except (sqlite3.OperationalError,MemoryError):pass
        return result
    return wrapped
