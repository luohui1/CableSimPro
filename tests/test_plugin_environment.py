"""Native dependency declarations select an environment, not the caller's Python."""
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
import json
import sys

import pytest

from backend.plugin_host.registry import PluginHostError, Registry
from backend.plugin_host.runtime import environment_python, resolve_python


def declared_plugin(tmp_path):
    directory=tmp_path/'plugins/example.geometry'
    source=directory/'src';source.mkdir(parents=True)
    raw=b'cadquery==2.8.0\n';(source/'requirements.txt').write_bytes(raw)
    return SimpleNamespace(directory=directory,manifest=SimpleNamespace(
        id='example.geometry',name='几何',runtime=SimpleNamespace(python='>=3.11,<3.14'),
        files=[SimpleNamespace(path='src/requirements.txt',sha256=sha256(raw).hexdigest(),size_bytes=len(raw))]))


def test_missing_project_environment_never_falls_back_to_host(tmp_path,monkeypatch):
    monkeypatch.delenv('CABLESIM_PLUGIN_PYTHON',raising=False)
    monkeypatch.delenv('SLURM_JOB_ID',raising=False)
    plugin=declared_plugin(tmp_path)
    with pytest.raises(PluginHostError) as failure:resolve_python(plugin)
    assert failure.value.code=='PLUGIN_ENVIRONMENT_MISSING'
    assert 'python scripts/prepare_plugin_environment.py example.geometry' in failure.value.message


def test_environment_dependency_failure_includes_the_prepare_command(tmp_path,monkeypatch):
    plugin=declared_plugin(tmp_path)
    monkeypatch.setenv('CABLESIM_PLUGIN_PYTHON',sys.executable)
    monkeypatch.setattr('backend.plugin_host.runtime.subprocess.run',lambda *a,**k:SimpleNamespace(
        stdout=json.dumps({'python':[3,11,8],'packages':{'cadquery':None}})))
    with pytest.raises(PluginHostError) as failure:resolve_python(plugin)
    assert failure.value.code=='PLUGIN_ENVIRONMENT_MISSING'
    assert 'cadquery 要求 2.8.0' in failure.value.message


def test_requirements_tampering_is_rejected_before_any_environment_probe(tmp_path):
    plugin=declared_plugin(tmp_path)
    (plugin.directory/'src/requirements.txt').write_text('cadquery==0.0.0\n')
    with pytest.raises(PluginHostError) as failure:resolve_python(plugin)
    assert failure.value.code=='PACKAGE_DIGEST_MISMATCH'


def test_cad_environment_is_selected_independently_of_the_host_python(monkeypatch):
    monkeypatch.delenv('CABLESIM_PLUGIN_PYTHON',raising=False)
    monkeypatch.delenv('SLURM_JOB_ID',raising=False)
    plugin=Registry(plugin_id='cablesim.cable-geometry').get('cablesim.cable-geometry')
    selected,receipt=resolve_python(plugin)
    assert Path(selected)==environment_python(plugin.directory.parent.parent/'.venv').absolute()
    assert receipt['selection']=='project-venv'
    assert receipt['packages']['cadquery']=='2.8.0'
