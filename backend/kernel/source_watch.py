"""Content-cache invalidation from Windows directory change notifications.

No timestamp trust. Missing/failed/overflowed notifications force a fresh content
check. Other platforms retain the existing per-read hashing policy.
"""
import ctypes
from functools import lru_cache
import os
from contextlib import suppress
import struct
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from threading import local


_notification_thread = local()
_notification_owner = ThreadPoolExecutor(max_workers=1, thread_name_prefix='source-notifications')


def notification_owner():
    # Windows cancels outstanding overlapped I/O when its issuing thread exits.
    # Request-pool workers expire after idle time, so all issue/rearm/cancel calls
    # share one persistent owner. Only bounded, nonblocking polls run here.
    return _notification_owner


def owned_notification(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if getattr(_notification_thread,'active',False):return function(*args, **kwargs)
        def invoke():
            _notification_thread.active=True
            return function(*args, **kwargs)
        return notification_owner().submit(invoke).result()
    return wrapped


@lru_cache(maxsize=1)
def native_api():
    from ctypes import wintypes as w
    class Overlapped(ctypes.Structure):
        _fields_ = [('Internal',ctypes.c_size_t),('InternalHigh',ctypes.c_size_t),
                    ('Offset',w.DWORD),('OffsetHigh',w.DWORD),('hEvent',w.HANDLE)]
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'CreateFileW':([w.LPCWSTR,w.DWORD,w.DWORD,w.LPVOID,w.DWORD,w.DWORD,w.HANDLE],w.HANDLE),
        'CreateEventW':([w.LPVOID,w.BOOL,w.BOOL,w.LPCWSTR],w.HANDLE),
        'ReadDirectoryChangesW':([w.HANDLE,w.LPVOID,w.DWORD,w.BOOL,w.DWORD,ctypes.POINTER(w.DWORD),ctypes.POINTER(Overlapped),w.LPVOID],w.BOOL),
        'GetOverlappedResult':([w.HANDLE,ctypes.POINTER(Overlapped),ctypes.POINTER(w.DWORD),w.BOOL],w.BOOL),
        'WaitForSingleObject':([w.HANDLE,w.DWORD],w.DWORD),
        'ResetEvent':([w.HANDLE],w.BOOL),
        'CancelIoEx':([w.HANDLE,ctypes.POINTER(Overlapped)],w.BOOL),
        'CloseHandle':([w.HANDLE],w.BOOL),
    }
    for name,(arguments,result) in signatures.items():
        function=getattr(api,name);function.argtypes=arguments;function.restype=result
    return api,Overlapped,w.DWORD


class DirectoryChanges:
    @owned_notification
    def __init__(self,path,recursive,relevance=None):
        self.api,self.Overlapped,self.DWORD=native_api()
        self.handle=None;self.event=None;self.pending=False;self.serial=0
        self.buffer=ctypes.create_string_buffer(64*1024)
        self.recursive=recursive
        self.relevance=relevance
        try:
            self.handle=self.api.CreateFileW(str(path),1,7,None,3,0x02000000|0x40000000,None)
            if self.handle in (None,ctypes.c_void_p(-1).value):
                self.handle=None;raise OSError(ctypes.get_last_error(),'Directory watch unavailable')
            self.event=self.api.CreateEventW(None,True,False,None)
            if not self.event:raise OSError(ctypes.get_last_error(),'Directory event unavailable')
            self.arm()
        except BaseException:
            self.close();raise

    def arm(self):
        if not self.api.ResetEvent(self.event):raise OSError('Directory event reset failed')
        self.overlapped=self.Overlapped();self.overlapped.hEvent=self.event
        # Names, attributes, size, last-write, creation and security; not last access.
        result=self.api.ReadDirectoryChangesW(self.handle,self.buffer,len(self.buffer),self.recursive,
            0x01|0x02|0x04|0x08|0x10|0x40|0x100,None,ctypes.byref(self.overlapped),None)
        if not result and ctypes.get_last_error()!=997:raise OSError(ctypes.get_last_error(),'Directory notification failed')
        self.pending=True

    @owned_notification
    def poll(self):
        changed=False
        for _ in range(256):
            state=self.api.WaitForSingleObject(self.event,0)
            if state==258:return changed
            if state!=0:raise OSError('Directory event wait failed')
            size=self.DWORD()
            if not self.api.GetOverlappedResult(self.handle,ctypes.byref(self.overlapped),ctypes.byref(size),False):
                raise OSError(ctypes.get_last_error(),'Directory notification lost')
            self.pending=False
            relevant = size.value == 0
            offset=0;raw=self.buffer.raw[:size.value]
            while offset < len(raw):
                if offset+12 > len(raw):raise OSError('Truncated directory notification')
                following,_,length=struct.unpack_from('<III',raw,offset)
                if length%2 or offset+12+length > len(raw):raise OSError('Invalid directory notification')
                name=raw[offset+12:offset+12+length].decode('utf-16-le')
                parts=name.replace('/', '\\').split('\\')
                if self.recursive:
                    relevant = relevant or ('__pycache__' not in parts and not name.endswith('.pyc')
                                            and (self.relevance is None or self.relevance(name.replace('\\','/'))))
                else:
                    relevant = relevant or parts[0].lower() in ('backend','cablesim_sdk','plugins')
                if following == 0:break
                if following < 12+length or offset+following >= len(raw):raise OSError('Invalid directory notification offset')
                offset+=following
            if relevant:self.serial+=1;changed=True
            # A zero-sized buffer is an overflow: serial still invalidates all receipts.
            self.arm()
        raise OSError('Directory notifications did not settle')

    @owned_notification
    def close(self):
        if self.handle is not None:
            if self.pending:
                self.api.CancelIoEx(self.handle,ctypes.byref(self.overlapped))
                size=self.DWORD()
                self.api.GetOverlappedResult(self.handle,ctypes.byref(self.overlapped),ctypes.byref(size),True)
            self.api.CloseHandle(self.handle);self.handle=None
        if self.event:
            self.api.CloseHandle(self.event);self.event=None
        self.pending=False

    def __del__(self):
        # OVERLAPPED and its buffer must remain alive until kernel I/O is cancelled.
        with suppress(Exception):self.close()


class SourceWatch:
    def __init__(self,root,*,release_only=False):
        self.root=root;self.handles=[];self.epoch=0;self.healthy=False
        self.release_only=release_only;self.shared_files=None
        if os.name=='nt':
            try:self.configure()
            except OSError:self.close()

    def configure(self):
        self.close();self.epoch+=1
        try:
            self.handles.append(DirectoryChanges(self.root,False))
            for name in ('backend','cablesim_sdk','plugins'):
                path=self.root/name
                relevance = (lambda relative: self.shared_change('backend/'+relative)) if name=='backend' and self.release_only else None
                if path.is_dir():self.handles.append(DirectoryChanges(path,True,relevance))
            self.load_shared_files()
            self.healthy=True
        except OSError:
            self.close();raise

    def load_shared_files(self):
        """Only sealed host dependencies affect a cached plugin catalog.

        Plugin directory events are always relevant, including added packages
        and changed dependency locks. Unreadable locks widen to all sources.
        """
        if not self.release_only:return
        try:
            self.shared_files={row['path'].casefold() for manifest in (self.root/'plugins').glob('*/plugin.json')
                               for row in json.loads((manifest.parent/'src/host-dependencies.json').read_text('utf-8'))}
        except (OSError,ValueError,KeyError,TypeError):self.shared_files=None

    def shared_change(self,path):
        if self.shared_files is None:return True
        name=path.casefold().rstrip('/')
        return name.startswith('backend/plugin_host/') or name in self.shared_files or any(value.startswith(name+'/') for value in self.shared_files)

    def snapshot(self):
        if not self.healthy:
            if os.name != 'nt': return None
            try:self.configure()
            except OSError:return None
        try:
            if self.handles[0].poll():self.configure()
            changed=False
            for handle in self.handles[1:]:changed=handle.poll() or changed
            if changed:self.load_shared_files()
            return (self.epoch,*(handle.serial for handle in self.handles))
        except (OSError,UnicodeError,struct.error) as exc:
            logging.getLogger(__name__).warning('Source notifications unavailable; cached reads invalidated: %s', exc)
            self.close();return None

    def close(self):
        for handle in self.handles:handle.close()
        self.handles=[];self.healthy=False

    def __del__(self):
        with suppress(Exception):self.close()
