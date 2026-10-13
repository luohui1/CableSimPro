"""Verified installed contracts remain isolated across real host lifetimes."""
import os
from pathlib import Path
import shutil

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel import input_contracts
from backend.kernel.verified_executor import VerifiedExecutor
from backend.plugin_host.registry import Registry


def test_contract_reuse_keeps_host_data_isolated_and_rejects_restored_mtime_drift(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    for name in ('backend', 'cablesim_sdk', 'plugins/cablesim.iec60287'):
        shutil.copytree(root / name, tmp_path / name,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'tests'))
    calls = []
    original = input_contracts.verified_contracts
    def build(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)
    monkeypatch.setattr(input_contracts, 'verified_contracts', build)

    def host(name):
        app = create_app(tmp_path / (name + '.sqlite'))
        app.state.research.executor = VerifiedExecutor(registry=Registry(tmp_path / 'plugins'), jobs_root=tmp_path / 'jobs')
        return TestClient(app)

    with host('first') as client:
        first = client.get('/api/input-contracts')
        assert first.status_code == 200, first.text
        original_bytes = first.content
        # Mutating a caller's decoded result must never edit another host's JSON.
        changed = first.json()
        changed[0]['parameter_schema'].clear()
    with host('second') as client:
        second = client.get('/api/input-contracts')
        assert second.status_code == 200, second.text
        assert second.content == original_bytes
    assert len(calls) == 1
    entry = tmp_path / 'plugins/cablesim.iec60287/src/cablesim_iec60287/main.py'
    before = entry.stat()
    raw = entry.read_bytes()
    entry.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
    os.utime(entry, ns=(before.st_atime_ns, before.st_mtime_ns))
    assert entry.stat().st_size == before.st_size
    assert entry.stat().st_mtime_ns == before.st_mtime_ns
    with host('after-drift') as client:
        failed = client.get('/api/input-contracts')
        assert failed.status_code == 409, failed.text
        assert failed.json()['detail']['code'] == 'PACKAGE_DIGEST_MISMATCH'
