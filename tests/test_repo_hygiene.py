"""Run the repository hygiene gate as part of the default pytest suite."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_repository_hygiene():
    result = subprocess.run([sys.executable, 'scripts/check_hygiene.py'], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_copy_action_icon_is_not_a_scratch_copy():
    from scripts.check_hygiene import version_names

    assert version_names(['design/icons/action/copy.svg']) == []
    assert len(version_names(['design/icons/action/save-copy.svg', 'backend/copy.py'])) == 2
