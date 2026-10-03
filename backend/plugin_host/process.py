"""Windows worker trees belong to an anonymous, non-inherited Job Object.

PROC_THREAD_ATTRIBUTE_JOB_LIST assigns the job during CreateProcess, avoiding an
unmanaged interval after launch. Closing the host's last job handle kills the tree.
This controls process lifetime; it imposes no memory or network sandbox.
See https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
"""
import ctypes as c
from ctypes import wintypes as w
import os
import subprocess
import time

from .registry import PluginHostError


class BasicLimits(c.Structure):
    _fields_ = [('process_time', c.c_longlong), ('job_time', c.c_longlong), ('flags', w.DWORD),
                ('minimum_working_set', c.c_size_t), ('maximum_working_set', c.c_size_t),
                ('active_process_limit', w.DWORD), ('affinity', c.c_size_t),
                ('priority', w.DWORD), ('scheduling', w.DWORD)]


class ExtendedLimits(c.Structure):
    _fields_ = [('basic', BasicLimits), ('io_counters', c.c_ulonglong * 6),
                ('process_memory', c.c_size_t), ('job_memory', c.c_size_t),
                ('peak_process_memory', c.c_size_t), ('peak_job_memory', c.c_size_t)]


class Accounting(c.Structure):
    _fields_ = [('times', c.c_longlong * 4), ('page_faults', w.DWORD), ('total_processes', w.DWORD),
                ('active_processes', w.DWORD), ('terminated_processes', w.DWORD)]


class StartupInfo(c.Structure):
    _fields_ = [('size', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR), ('title', w.LPWSTR),
                ('x', w.DWORD), ('y', w.DWORD), ('width', w.DWORD), ('height', w.DWORD),
                ('x_chars', w.DWORD), ('y_chars', w.DWORD), ('fill', w.DWORD), ('flags', w.DWORD),
                ('show', w.WORD), ('reserved_size', w.WORD), ('reserved_data', c.c_void_p),
                ('stdin', w.HANDLE), ('stdout', w.HANDLE), ('stderr', w.HANDLE)]


class ExtendedStartup(c.Structure):
    _fields_ = [('info', StartupInfo), ('attributes', c.c_void_p)]


class ProcessInfo(c.Structure):
    _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE), ('pid', w.DWORD), ('tid', w.DWORD)]


def kernel_api():
    api = c.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'CreateJobObjectW': ([c.c_void_p, w.LPCWSTR], w.HANDLE),
        'SetInformationJobObject': ([w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL),
        'QueryInformationJobObject': ([w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p], w.BOOL),
        'TerminateJobObject': ([w.HANDLE, w.UINT], w.BOOL),
        'InitializeProcThreadAttributeList': ([c.c_void_p, w.DWORD, w.DWORD, c.POINTER(c.c_size_t)], w.BOOL),
        'UpdateProcThreadAttribute': ([c.c_void_p, w.DWORD, c.c_size_t, c.c_void_p, c.c_size_t, c.c_void_p, c.c_void_p], w.BOOL),
        'DeleteProcThreadAttributeList': ([c.c_void_p], None),
        'CreateProcessW': ([w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD,
                            c.c_void_p, w.LPCWSTR, c.POINTER(ExtendedStartup), c.POINTER(ProcessInfo)], w.BOOL),
        'WaitForSingleObject': ([w.HANDLE, w.DWORD], w.DWORD),
        'GetExitCodeProcess': ([w.HANDLE, c.POINTER(w.DWORD)], w.BOOL),
        'CloseHandle': ([w.HANDLE], w.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(api, name)
        function.argtypes, function.restype = arguments, result
    return api


def checked(value):
    if not value:
        raise c.WinError(c.get_last_error())
    return value


def stop_tree(api, job, process):
    try:
        checked(api.TerminateJobObject(job, 1))
        if api.WaitForSingleObject(process, 5000) != 0:
            raise OSError('工作进程句柄未确认退出')
        deadline, account = time.monotonic() + 5, Accounting()
        while True:
            checked(api.QueryInformationJobObject(job, 1, c.byref(account), c.sizeof(account), None))
            if not account.active_processes:
                return
            if time.monotonic() >= deadline:
                raise OSError('工作进程树未确认退出')
            time.sleep(.01)
    except OSError as exc:
        raise PluginHostError('PROCESS_TERMINATION_UNCONFIRMED', f'{exc}；保留作业目录。', 503) from None


def run_process(arguments, *, cwd, env, timeout, stderr_limit, stop_event=None):
    if os.name != 'nt':
        if stop_event is not None:
            with subprocess.Popen(arguments, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                  start_new_session=True) as process:
                deadline = time.monotonic()+timeout
                while True:
                    if stop_event.is_set() or time.monotonic()>=deadline:
                        import signal
                        os.killpg(process.pid, signal.SIGKILL)
                        process.communicate()
                        raise subprocess.TimeoutExpired(arguments,timeout)
                    try:
                        _,stderr=process.communicate(timeout=.05)
                        return subprocess.CompletedProcess(arguments,process.returncode,None,stderr[-stderr_limit:])
                    except subprocess.TimeoutExpired:
                        pass
        return subprocess.run(arguments, cwd=cwd, env=env, timeout=timeout,
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    import msvcrt
    api, job = kernel_api(), None
    attributes, initialized, stopped, process = None, False, False, ProcessInfo()
    try:
        job = checked(api.CreateJobObjectW(None, None))
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway
        checked(api.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)))
        size = c.c_size_t()
        api.InitializeProcThreadAttributeList(None, 2, 0, c.byref(size))
        attributes = c.create_string_buffer(size.value)
        checked(api.InitializeProcThreadAttributeList(attributes, 2, 0, c.byref(size)))
        initialized = True
        jobs = (w.HANDLE * 1)(job)
        checked(api.UpdateProcThreadAttribute(attributes, 0, 0x2000D, jobs, c.sizeof(jobs), None, None))
        # A file avoids deadlocks when a descendant retains stderr, and bounds memory.
        with open(os.devnull, 'rb') as stdin, open(os.devnull, 'wb') as stdout, open(cwd / 'stderr.log', 'w+b') as stderr:
            handles = (w.HANDLE * 3)(*(msvcrt.get_osfhandle(f.fileno()) for f in (stdin, stdout, stderr)))
            for handle in handles:
                os.set_handle_inheritable(handle, True)
            checked(api.UpdateProcThreadAttribute(attributes, 0, 0x20002, handles, c.sizeof(handles), None, None))
            startup = ExtendedStartup()
            startup.info.size, startup.info.flags = c.sizeof(startup), 0x100  # STARTF_USESTDHANDLES
            startup.info.stdin, startup.info.stdout, startup.info.stderr = handles
            startup.attributes = c.cast(attributes, c.c_void_p)
            command = c.create_unicode_buffer(subprocess.list2cmdline(arguments))
            environment = c.create_unicode_buffer('\0'.join(f'{k}={v}' for k, v in sorted(env.items(), key=lambda i: i[0].upper())) + '\0\0')
            checked(api.CreateProcessW(arguments[0], command, None, None, True,
                                       0x80000 | 0x400 | 0x08000000, environment, str(cwd), c.byref(startup), c.byref(process)))
            if stop_event is None:
                wait = api.WaitForSingleObject(process.process, max(1, int(timeout * 1000)))
            else:
                deadline=time.monotonic()+timeout
                while True:
                    if stop_event.is_set() or time.monotonic()>=deadline:
                        raise subprocess.TimeoutExpired(arguments,timeout)
                    wait=api.WaitForSingleObject(process.process,25)
                    if wait!=0x102:break
            if wait == 0x102:
                raise subprocess.TimeoutExpired(arguments, timeout)
            if wait != 0:
                raise c.WinError(c.get_last_error())
            code = w.DWORD()
            checked(api.GetExitCodeProcess(process.process, c.byref(code)))
            stop_tree(api, job, process.process)
            stopped = True
            stderr.seek(max(0, stderr.seek(0, os.SEEK_END) - stderr_limit))
            return subprocess.CompletedProcess(arguments, code.value, None, stderr.read())
    finally:
        try:
            if job and process.process and not stopped:
                stop_tree(api, job, process.process)
        finally:
            if initialized:
                api.DeleteProcThreadAttributeList(attributes)
            for handle in (process.thread, process.process, job):
                if handle:
                    api.CloseHandle(handle)
