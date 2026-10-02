"""Single local host ownership; the OS releases the lock if the process dies."""
import os
from pathlib import Path


class OwnerLock:
    def __init__(self, database):
        self.path = Path(str(database) + '.owner')
        self.file = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open('a+b')
        self.file.seek(0, 2)
        if not self.file.tell():
            self.file.write(b'0')
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            self.file = None
            raise RuntimeError('此数据库已由另一个 CableSimPro 宿主管理。') from None

    def close(self):
        if self.file:
            self.file.close()
            self.file = None
