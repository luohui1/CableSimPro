"""Linux directory notifications for source-bound read receipts.

No timestamp-only cache is used. A missing watch, queue overflow or moved root
invalidates the receipt; the caller must re-read and verify actual source bytes.
"""
import ctypes
import os
from pathlib import Path
import struct


class LinuxDirectoryChanges:
    def __init__(self, path, recursive, relevance=None):
        self.path, self.recursive, self.relevance = Path(path), recursive, relevance
        self.fd, self.serial, self.directories = None, 0, {}
        self.api = ctypes.CDLL(None, use_errno=True)
        self.api.inotify_init1.argtypes = [ctypes.c_int]
        self.api.inotify_init1.restype = ctypes.c_int
        self.api.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        self.api.inotify_add_watch.restype = ctypes.c_int
        fd = self.api.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
        if fd < 0:
            raise OSError(ctypes.get_errno(), 'Source notification queue unavailable')
        self.fd = fd
        try:
            self._add_tree(self.path)
        except OSError:
            self.close()
            raise

    def _add(self, path):
        # Writes, replacements, permission changes and deletion all invalidate.
        mask = 0x00000002 | 0x00000004 | 0x00000008 | 0x00000040 | 0x00000080 | 0x00000100 | 0x00000200 | 0x00000400 | 0x00000800
        descriptor = self.api.inotify_add_watch(self.fd, os.fsencode(path), mask)
        if descriptor < 0:
            raise OSError(ctypes.get_errno(), 'Source directory could not be watched: ' + str(path))
        self.directories[descriptor] = path

    def _add_tree(self, path):
        self._add(path)
        if self.recursive:
            for directory, children, files in os.walk(path, followlinks=False):
                if any((Path(directory) / name).is_symlink() for name in [*children, *files]):
                    raise OSError('Source symlinks require per-read content verification')
                children[:] = [name for name in children if name != '__pycache__' and not (Path(directory) / name).is_symlink()]
                for name in children:
                    self._add(Path(directory) / name)

    def poll(self):
        if self.fd is None:
            raise OSError('Source notification queue is closed')
        changed = False
        for _ in range(64):
            try:
                data = os.read(self.fd, 65536)
            except BlockingIOError:
                return changed
            if not data:
                raise OSError('Source notification queue ended')
            offset = 0
            while offset < len(data):
                if offset + 16 > len(data):
                    raise OSError('Truncated source notification')
                descriptor, mask, _, length = struct.unpack_from('iIII', data, offset)
                offset += 16
                if offset + length > len(data) or mask & 0x00004000:
                    raise OSError('Source notification lost or overflowed')
                name = os.fsdecode(data[offset:offset + length].split(b'\0', 1)[0])
                offset += length
                directory = self.directories.get(descriptor)
                if directory is None:
                    raise OSError('Unrecognized source notification')
                if mask & (0x00000400 | 0x00000800 | 0x00008000):
                    raise OSError('Watched source directory moved or removed')
                relative = (directory / name).relative_to(self.path)
                if '__pycache__' in relative.parts or name.endswith('.pyc'):
                    continue
                if self.recursive and mask & 0x40000000 and mask & (0x00000100 | 0x00000080):
                    self._add_tree(directory / name)
                if self.recursive and mask & (0x00000100 | 0x00000080) and (directory / name).is_symlink():
                    raise OSError('Source symlink requires per-read content verification')
                relevant = (self.relevance is None or self.relevance(relative.as_posix())) if self.recursive else not relative.parts or relative.parts[0] in ('backend', 'cablesim_sdk', 'plugins')
                if relevant:
                    self.serial += 1
                    changed = True
        raise OSError('Source notifications did not settle')

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        self.directories.clear()

    def __del__(self):
        if getattr(self, 'fd', None) is not None:
            self.close()
