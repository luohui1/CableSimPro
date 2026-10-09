import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(os.name != 'nt', reason='directory notifications are Windows-only')
def test_watch_opened_and_closed_on_the_owner_thread_does_not_wait_for_itself(tmp_path):
    # A fresh process, so the owner thread has run nothing yet: open and close a
    # watch directly on that thread, as garbage collection may do via __del__.
    script = (
        "import sys;from backend.kernel.source_watch import DirectoryChanges,notification_owner\n"
        "done=notification_owner().submit(lambda:DirectoryChanges(sys.argv[1],False).close())\n"
        "done.result(timeout=10);print('closed')\n"
    )
    result = subprocess.run([sys.executable, '-c', script, str(tmp_path)], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0 and result.stdout.strip() == 'closed', result.stderr


@pytest.mark.skipif(os.name != 'nt', reason='directory notifications are Windows-only')
def test_collecting_a_watch_never_waits_for_executor_locks(tmp_path):
    # A thread being started can run garbage collection while another thread
    # holds the executors' global shutdown lock; the finalizer must not wait.
    script = (
        "import gc,sys,threading\n"
        "import concurrent.futures.thread as pool\n"
        "import backend.kernel.source_watch as source\n"
        "from backend.kernel.source_watch import DirectoryChanges,notification_owner\n"
        "watch=DirectoryChanges(sys.argv[1],False)\n"
        "def collect():\n"
        "    global watch\n"
        "    watch=None;gc.collect()\n"
        "with pool._global_shutdown_lock:\n"
        "    worker=threading.Thread(target=collect,daemon=True);worker.start();worker.join(10)\n"
        "    assert not worker.is_alive(),'finalizer blocked on the executor lock'\n"
        "notification_owner().submit(lambda:None).result(10)\n"
        "DirectoryChanges(sys.argv[1],False).close()\n"
        "assert not getattr(source,'_deferred',());print('released')\n"
    )
    result = subprocess.run([sys.executable, '-c', script, str(tmp_path)], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0 and result.stdout.strip() == 'released', result.stderr
