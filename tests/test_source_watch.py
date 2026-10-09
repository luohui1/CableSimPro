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
