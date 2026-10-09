"""Bounded, opt-in preview workers using the same controlled process launcher."""
import ast
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Event, Lock, Thread
from time import monotonic, perf_counter, sleep
from uuid import uuid4

from .process import run_process
from .registry import PluginHostError


def worker_launch(python_executable, environment):
    """Use the selected Windows venv without its nested redirector process.

    A cold venv redirector can block inside CreateProcess with the atomic Job
    Object assignment. CPython's redirector normally launches home/python.exe
    with __PYVENV_LAUNCHER__; retain exactly that prefix/site-packages selection
    while assigning the real interpreter to the controlled job at creation.
    Never substitute the host interpreter or run an uncontrolled priming job.
    """
    # Keep a venv's executable spelling on POSIX: resolving bin/python's
    # symlink would silently select the base environment instead.
    selected = Path(os.path.abspath(python_executable))
    config = selected.parent.parent / 'pyvenv.cfg'
    env = dict(environment)
    env.pop('__PYVENV_LAUNCHER__', None)
    if os.name == 'nt' and selected.parent.name.lower() == 'scripts' and config.is_file():
        settings = {key.strip(): value.strip() for key, value in (line.split('=', 1) for line in config.read_text('utf-8').splitlines() if '=' in line)}
        home = settings.get('home', '').strip()
        base = Path(home) / 'python.exe'
        if not home or not base.is_absolute() or not base.is_file():
            raise PluginHostError('ENVIRONMENT_MISSING', '所选 Python 虚拟环境的基础解释器缺失；请重新准备该环境。', 503)
        env['__PYVENV_LAUNCHER__'] = str(selected)
        return str(base), env
    return str(selected), env


class ResidentWorker:
    def __init__(self, entry, root, environment, python_executable):
        executable, launch_env = worker_launch(python_executable, environment)
        self.entry=entry
        self.allowed_root=Path(root).resolve();self.closed=False
        self.mailbox=Path(tempfile.mkdtemp(prefix='csp-worker-',dir=root))
        self.stop=Event();self.completed=Event();self.lock=Lock();self.error=None
        self.args=[executable,'-I',str(Path(__file__).with_name('resident_worker.py')),str(entry),str(self.mailbox)]
        self.environment={**launch_env,**{k:str(self.mailbox) for k in ('HOME','USERPROFILE','TMP','TEMP','TMPDIR')}}
        self.thread=Thread(target=self._run,daemon=True,name='cablesim-preview-worker')
        self.thread.start()

    def _run(self):
        try:
            result=run_process(self.args,cwd=self.mailbox,env=self.environment,timeout=3600,
                               stderr_limit=8000,stop_event=self.stop)
            if result.returncode:self.error=PluginHostError('PLUGIN_CRASHED',result.stderr.decode('utf-8','replace'),502)
        except subprocess.TimeoutExpired:
            pass
        except BaseException as error:
            self.error=error
        finally:self.completed.set()

    def _wait(self,path,deadline):
        while True:
            if path.is_file():
                try:return json.loads(path.read_text('utf-8'))
                except (FileNotFoundError,PermissionError):pass
            if self.completed.is_set():
                raise self.error or PluginHostError('PLUGIN_CRASHED','常驻预览进程已退出。',502)
            if monotonic()>=deadline:
                self.close()
                raise subprocess.TimeoutExpired(self.args,0)
            self.completed.wait(.002)

    def run(self,arguments,cwd,environment,timeout):
        began=perf_counter();deadline=monotonic()+timeout
        if not self.lock.acquire(timeout=timeout):raise subprocess.TimeoutExpired(arguments,timeout)
        try:
            queued=perf_counter()-began
            was_ready=(self.mailbox/'ready.json').is_file()
            ready=self._wait(self.mailbox/'ready.json',deadline)
            task=str(uuid4());done=self.mailbox/'done.json';done.unlink(missing_ok=True)
            pending=self.mailbox/'next.pending'
            pending.write_text(json.dumps({'id':task,'job':str(cwd.resolve()),'environment':environment}),'utf-8')
            pending.replace(self.mailbox/'next.json')
            result=self._wait(done,deadline);done.unlink()
            if result['id']!=task:raise PluginHostError('OUTPUT_CONTRACT_VIOLATION','常驻进程返回的作业身份不符。',502)
            proc=subprocess.CompletedProcess(arguments,result['returncode'],None,result['stderr'].encode('utf-8'))
            proc.profiling={'resident':True,'worker_pid':ready['pid'],'queue_ms':queued*1000,
                'startup_ms':0 if was_ready else ready['startup_ms'],'execution_ms':result['execution_ms']}
            return proc
        finally:self.lock.release()

    def close(self):
        if self.closed:return
        self.stop.set();self.thread.join(7)
        if self.thread.is_alive():raise PluginHostError('PROCESS_TERMINATION_UNCONFIRMED','常驻预览进程未确认退出，保留临时目录。',503)
        if isinstance(self.error,PluginHostError) and self.error.code=='PROCESS_TERMINATION_UNCONFIRMED':raise self.error
        if self.allowed_root not in self.mailbox.resolve().parents:raise PluginHostError('PROCESS_TERMINATION_UNCONFIRMED','预览进程目录越出临时根目录。',503)
        for attempt in range(7):
            try:
                shutil.rmtree(self.mailbox);self.closed=True;break
            except PermissionError as error:
                if getattr(error,'winerror',None)!=32 or attempt==6:raise
                sleep(.1)


class ResidentRunner:
    def __init__(self,root):
        self.root=Path(root);self.workers={};self.lock=Lock()

    @staticmethod
    def supports(entry):
        functions={n.name for n in ast.parse(Path(entry).read_bytes()).body if isinstance(n,ast.FunctionDef)}
        return {'resident_main','resident_warmup'}<=functions

    def __call__(self,arguments,*,cwd,env,timeout,stderr_limit):
        worker=self._worker(Path(arguments[-1]),env,arguments[0])
        if worker is None:return run_process(arguments,cwd=cwd,env=env,timeout=timeout,stderr_limit=stderr_limit)
        return worker.run(arguments,cwd,env,timeout)

    def warmup(self,entry,*,env,timeout,python_executable=None):
        """Load an opt-in worker without creating or executing an engineering job."""
        worker=self._worker(Path(entry),env,python_executable or sys.executable)
        if worker is None:return False
        worker._wait(worker.mailbox/'ready.json',monotonic()+timeout)
        return True

    def _worker(self,entry,env,python_executable):
        entry=entry.resolve();raw=entry.read_bytes()
        functions={n.name for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef)}
        if not {'resident_main','resident_warmup'}<=functions:
            return None
        selected = Path(os.path.abspath(python_executable))
        config = selected.parent.parent/'pyvenv.cfg'
        environment_digest = sha256(config.read_bytes()).hexdigest() if config.is_file() else ''
        key=(str(entry),sha256(raw).hexdigest(),env.get('CABLESIM_WORKER_RELEASE',''),str(selected),environment_digest)
        with self.lock:
            worker=self.workers.get(key)
            if worker and worker.completed.is_set():worker.close();del self.workers[key];worker=None
            if worker is None:
                for old_key in list(self.workers):
                    if old_key[0]==key[0] or len(self.workers)>=2:self.workers.pop(old_key).close()
                self.root.mkdir(parents=True,exist_ok=True)
                worker=ResidentWorker(entry,self.root,env,python_executable);self.workers[key]=worker
        return worker

    def close(self):
        with self.lock:
            for worker in self.workers.values():worker.close()
            self.workers.clear()
