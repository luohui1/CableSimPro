"""Fault-injection test only: native exit failure cannot be promoted by a file."""
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import subprocess
import pytest
from backend.plugins.catalog import PluginError
from backend.plugins.service import PluginService


def test_nonzero_exit_with_response_file_is_failure(tmp_path, monkeypatch):
    service = PluginService(SimpleNamespace(path=tmp_path/'local.sqlite'), None)
    def failed(*args, **kwargs):
        (Path(kwargs['cwd'])/'response.json').write_text('{"files": [], "summary": {}}')
        return subprocess.CompletedProcess(args[0], 3221226356)
    monkeypatch.setattr(subprocess, 'run', failed)
    context = {'plugin': {'plugin_id': 'cablesim.cadquery'}, 'command': 'cadquery.cable-step',
               'recipe': {}, 'scenario': {}, 'arguments': {}}
    with pytest.raises(PluginError) as failure:
        service._worker(str(uuid4()), str(uuid4()), context)
    assert failure.value.code == 'WORKER_FAILED'
