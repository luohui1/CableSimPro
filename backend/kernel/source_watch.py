"""Content-cache invalidation from Windows directory change notifications.

No timestamp trust. Missing/failed/overflowed notifications force a fresh content
check. Other platforms retain the existing per-read hashing policy.
"""
import ctypes
from functools import lru_cache
import os
from contextlib import suppress
import struct


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
    def __init__(self,path,recursive):
        self.api,self.Overlapped,self.DWORD=native_api()
        self.handle=None;self.event=None;self.pending=False;self.serial=0
        self.buffer=ctypes.create_string_buffer(64*1024)
        self.recursive=recursive
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
                    relevant = relevant or ('__pycache__' not in parts and not name.endswith('.pyc'))
                else:
                    relevant = relevant or parts[0].lower() in ('backend','cablesim_sdk','plugins')
                if following == 0:break
                if following < 12+length or offset+following >= len(raw):raise OSError('Invalid directory notification offset')
                offset+=following
            if relevant:self.serial+=1;changed=True
            # A zero-sized buffer is an overflow: serial still invalidates all receipts.
            self.arm()
        raise OSError('Directory notifications did not settle')

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
    def __init__(self,root):
        self.root=root;self.handles=[];self.epoch=0;self.healthy=False
        if os.name=='nt':
            try:self.configure()
            except OSError:self.close()

    def configure(self):
        self.close();self.epoch+=1
        try:
            self.handles.append(DirectoryChanges(self.root,False))
            for name in ('backend','cablesim_sdk','plugins'):
                path=self.root/name
                if path.is_dir():self.handles.append(DirectoryChanges(path,True))
            self.healthy=True
        except OSError:
            self.close();raise

    def snapshot(self):
        if not self.healthy:return None
        try:
            if self.handles[0].poll():self.configure()
            for handle in self.handles[1:]:handle.poll()
            return (self.epoch,*(handle.serial for handle in self.handles))
        except (OSError,UnicodeError,struct.error):
            self.close();return None

    def close(self):
        for handle in self.handles:handle.close()
        self.handles=[];self.healthy=False

    def __del__(self):
        with suppress(Exception):self.close()
