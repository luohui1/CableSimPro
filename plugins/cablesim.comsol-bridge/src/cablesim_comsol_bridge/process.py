"""COMSOL relay lifetime inside Linux Slurm allocations; no host import."""
import os
import signal
import subprocess
import time


def run_process(arguments, *, cwd, env, timeout, stderr_limit, stop_event=None):
    if os.name == 'nt' or not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('COMSOL 进程必须在 Linux Slurm 计算节点启动。')
    # A file bounds memory and avoids pipe deadlock when a child keeps stderr open.
    with (cwd/'relay.log').open('w+b') as log:
        with subprocess.Popen(arguments, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=log, start_new_session=True) as process:
            try:
                deadline=time.monotonic()+timeout
                while process.poll() is None:
                    if time.monotonic() >= deadline or stop_event is not None and stop_event.is_set():
                        raise subprocess.TimeoutExpired(arguments,timeout)
                    time.sleep(.05)
            finally:
                try:
                    os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
            log.seek(max(0,log.seek(0,os.SEEK_END)-stderr_limit))
            return subprocess.CompletedProcess(arguments,process.returncode,None,log.read())
