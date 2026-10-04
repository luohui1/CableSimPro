"""Single-process COMSOL execution without distributing or changing COMSOL."""
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))
from backend.plugin_host.process import run_process

CONFIG = ROOT / '.data/cablesim-solvers.json'
INSTALL_GUIDE = 'https://www.comsol.com/support/knowledgebase/1221'


class EnvironmentMissing(RuntimeError):
    pass


class EnvironmentBusy(RuntimeError):
    pass


class SolverFailure(RuntimeError):
    pass


def decode(raw):
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('gb18030', errors='replace')


def fingerprint(path):
    h = sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def running_comsol(api):
    class Entry(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),
                  ('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),
                  ('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('exe',wintypes.WCHAR*260)]
    api.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD]
    api.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
    for name in ('Process32FirstW','Process32NextW'):
        getattr(api,name).argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
        getattr(api,name).restype=wintypes.BOOL
    snapshot=api.CreateToolhelp32Snapshot(2,0)
    if snapshot==ctypes.c_void_p(-1).value:
        raise EnvironmentBusy('无法检查 COMSOL 进程；本次未启动，请稍后重试。')
    try:
        entry=Entry();entry.size=ctypes.sizeof(entry);valid=api.Process32FirstW(snapshot,ctypes.byref(entry))
        while valid:
            if entry.exe.lower() in {'comsol.exe','comsolbatch.exe','comsolmphserver.exe','comsolserver.exe'}:
                return True
            valid=api.Process32NextW(snapshot,ctypes.byref(entry))
        return False
    finally:api.CloseHandle(snapshot)


@contextmanager
def exclusive(configuration=None):
    """Do not start a second bridge solve, even in a different host process."""
    if os.name != 'nt':
        if not os.environ.get('SLURM_JOB_ID'):
            raise EnvironmentMissing('COMSOL 计算必须由 Slurm 提交到计算节点，不能在登录节点启动。')
        import fcntl
        # One COMSOL process at a time for this account, across all compute jobs.
        # Do not wait while holding paid resources behind another bridge run.
        config=configuration if configuration is not None else json.loads(CONFIG.read_text('utf-8')) if CONFIG.is_file() else {}
        lock=Path(config.get('comsol_lock',''))
        if not lock.is_absolute() or not lock.parent.is_dir():
            raise EnvironmentMissing('管理员须配置共享文件系统上的 comsol_lock 绝对路径。')
        with lock.open('a+b') as stream:
            try:fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise EnvironmentBusy('超算 COMSOL 正在执行另一项对照；本次未启动重复计算。') from None
            try:yield
            finally:fcntl.flock(stream.fileno(),fcntl.LOCK_UN)
        return
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    api.CreateMutexW.restype = wintypes.HANDLE
    api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    api.WaitForSingleObject.restype = wintypes.DWORD
    api.ReleaseMutex.argtypes = [wintypes.HANDLE]
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = api.CreateMutexW(None, False, 'Local\\CableSimPro.ComsolBridge')
    if not handle:
        raise EnvironmentMissing('无法取得 COMSOL 进程互斥锁。')
    acquired = False
    try:
        acquired = api.WaitForSingleObject(handle, 0) in (0, 0x80)
        if not acquired:
            raise EnvironmentBusy('COMSOL 正在执行另一项对照，请待其结束后重试；本次未启动重复计算。')
        if running_comsol(api):
            raise EnvironmentBusy('检测到其他 COMSOL 进程；为避免并发占用内存，本次未启动。请等待该进程结束。')
        yield
    finally:
        if acquired:
            api.ReleaseMutex(handle)
        api.CloseHandle(handle)


def resolve(configuration=None):
    config = configuration if configuration is not None else json.loads(CONFIG.read_text('utf-8')) if CONFIG.is_file() else {}
    value = config.get('comsol')
    if not value or not Path(value).is_file():
        raise EnvironmentMissing(f'环境缺失：请安装自备有效商业许可证的 COMSOL 6.2，在 {CONFIG} 的 comsol 字段填写 comsolbatch.exe 绝对路径。安装说明：{INSTALL_GUIDE}')
    executable = Path(value).resolve()
    if os.name!='nt':
        if executable!=Path('/data/app/comsol/62/multiphysics/bin/comsol').resolve():
            raise EnvironmentMissing('超算 COMSOL 仅允许已核验的 /data/app/comsol/62/multiphysics/bin/comsol。')
        return executable,executable
    if executable.name.lower() != 'comsolbatch.exe':
        raise EnvironmentMissing('comsol 配置必须指向官方 bin/win64/comsolbatch.exe。')
    compiler = executable.with_name('comsolcompile.exe')
    if not compiler.is_file():
        raise EnvironmentMissing('环境缺失：COMSOL Java 编译器 comsolcompile.exe 不在同一安装目录。')
    return executable, compiler


def environment(work):
    env = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'COMSOL_LICENSE_FILE', 'LM_LICENSE_FILE','SLURM_JOB_ID','SLURM_ARRAY_JOB_ID','SLURM_ARRAY_TASK_ID','SLURM_CPUS_PER_TASK','SLURM_JOB_NODELIST') if key in os.environ}
    env.update(HOME=str(work),TEMP=str(work), TMP=str(work),TMPDIR=str(work),OMP_NUM_THREADS='1')
    return env


def command(executable, arguments, work, timeout=300, name='process'):
    """Host Job Object owns the Python relay, COMSOL and every child process."""
    try:
        import threading
        result = run_process([sys.executable, str(Path(__file__).resolve()), '--relay', str(executable), *arguments],
                             cwd=work, env=environment(work), timeout=timeout, stderr_limit=24*1024*1024,stop_event=threading.Event())
    except subprocess.TimeoutExpired as exc:
        raise SolverFailure(f'COMSOL {name} 超时（{timeout} s）；进程树已终止，本次没有有效结果。') from exc
    output = decode(result.stderr or b'')
    if len(result.stderr or b'') >= 24*1024*1024:
        raise SolverFailure('COMSOL 输出超过 24 MiB 上限；结果可能被截断，请减少网格节点。')
    (work/(name+'.log')).write_text(output, encoding='utf-8')
    if result.returncode or re.search(r'(?im)^\s*(?:ERROR|FATAL|java\.[\w.]+Exception|com\.comsol\.[\w.]+Exception)\b|Compilation failed', output):
        raise SolverFailure(f'COMSOL {name} 失败（退出码 {result.returncode}）：{output[-2500:]}')
    return output


def compile_source(source, work, compiler):
    path = work/'BridgeJob.java'
    path.write_text(source, encoding='utf-8')
    output = command(compiler, (['compile'] if os.name!='nt' else [])+[str(path)], work, timeout=120, name='compile')
    compiled = path.with_suffix('.class')
    if not compiled.is_file() or compiled.stat().st_mtime_ns < path.stat().st_mtime_ns:
        raise SolverFailure('COMSOL Java 编译未生成本次类文件：'+output[-2000:])
    return compiled


def execute(source, work, required_modules, configuration=None, timeout=600, save_model=True):
    if os.name=='nt':
        raise EnvironmentMissing('本机 COMSOL 计算已禁用；请使用超算 Slurm 后端。')
    work.mkdir(parents=True, exist_ok=True)
    if any(work.glob('model*.mph')):
        raise SolverFailure('COMSOL 工作目录已有模型；请使用新的运行目录，避免读取历史模型。')
    executable, compiler = resolve(configuration)
    with exclusive(configuration):
        banner = command(executable, ['-version'], work, timeout=60, name='version')
        match = re.search(r'COMSOL Multiphysics\s+(6\.2\.\d+\.\d+)', banner)
        if not match:
            raise EnvironmentMissing('环境缺失：仅支持已核验的 COMSOL 6.2；检测结果为 '+banner[:500])
        compiled = compile_source(source, work, compiler)
        args = (['batch'] if os.name!='nt' else [])+['-np', '1', '-inputfile', str(compiled), '-batchlog', str(work/'batch.log')]
        args += ['-outputfile', str(work/'model.mph')] if save_model else ['-nosave']
        log = command(executable, args, work, timeout=timeout, name='solver')
        batch = (work/'batch.log').read_text('utf-8', errors='replace') if (work/'batch.log').is_file() else ''
        if 'BRIDGE_COMPLETE' not in log:
            reason = (batch+'\n'+log)[-3000:]
            if 'BRIDGE_ENVIRONMENT_MISSING' in reason or re.search(r'license|许可证|许可', reason, re.I):
                raise EnvironmentMissing('环境缺失：COMSOL 所需模块或有效许可证不可用。'+reason)
            raise SolverFailure('COMSOL 未返回完整结果标记，退出码 0 不代表成功：'+reason)
        products = {m: 'BRIDGE_PRODUCT='+m+':true' in log for m in required_modules}
        if not all(products.values()):
            raise EnvironmentMissing('环境缺失：所需模块未通过实际许可检测：'+', '.join(m for m,v in products.items() if not v))
        models = sorted(work.glob('model*.mph'))
        if save_model and len(models) != 1:
            raise SolverFailure('COMSOL 没有保存唯一的本次模型文件。')
        evidence = {'name': 'comsol', 'version': match.group(1), 'version_banner': banner.strip(),
                    'license_source':'hpc-installation','slurm_job_id':os.environ.get('SLURM_JOB_ID'),
                    'slurm_array_job_id':os.environ.get('SLURM_ARRAY_JOB_ID'),'node':os.environ.get('SLURM_JOB_NODELIST'),
                    'threads':1,
                    'modules': products, 'execution': 'separate-process', 'executable_sha256': fingerprint(executable),
                    'generated_source_sha256': sha256(source.encode()).hexdigest(),
                    'model_sha256': fingerprint(models[0]) if models else None,
                    'model_file': models[0].name if models else None, 'log_sha256': fingerprint(work/'solver.log')}
        return log, evidence


if __name__ == '__main__' and len(sys.argv) > 2 and sys.argv[1] == '--relay':
    # Arguments originate only in this adapter; no shell or user expressions.
    completed = subprocess.run(sys.argv[2:], stdin=subprocess.DEVNULL, stdout=sys.stderr, stderr=sys.stderr)
    raise SystemExit(completed.returncode)
