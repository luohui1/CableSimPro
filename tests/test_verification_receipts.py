"""Real installed IEC certification reused across executor lifetimes, not trust by version."""
import json
import os
from pathlib import Path
import shutil

import pytest

from backend.kernel.verified_executor import VerifiedExecutor
from backend.plugin_host import PluginHostError, Registry
from backend.plugin_host.registry import seal


def test_catalogue_receipt_reused_without_sharing_state_and_rejects_unchanged_version_drift(tmp_path):
    root = Path(__file__).resolve().parents[1]
    for name in ('backend', 'cablesim_sdk', 'plugins/cablesim.iec60287'):
        shutil.copytree(root / name, tmp_path / name,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'tests'))
    registry = Registry(tmp_path / 'plugins')
    plugin = registry.get('cablesim.iec60287')
    catalogue = plugin.verify()
    assert not catalogue['cache_hit']
    receipts = []
    for _ in range(2):
        executor = VerifiedExecutor(registry=registry, jobs_root=tmp_path / 'jobs')
        try:
            receipt = executor.verify_release(plugin)
            assert receipt['cache_hit']
            assert receipt['verified_at'] == catalogue['verified_at']
            assert receipt['source_tree_sha256'] == catalogue['source_tree_sha256']
            receipts.append(dict(receipt))
            receipt['status'] = 'caller-mutated'
        finally:
            executor.seals.close()
    assert all(receipt['status'] == 'verified' for receipt in receipts)

    # Presentation/identity changed at the SAME version must receive a new proof.
    manifest_path = plugin.directory / 'plugin.json'
    manifest = json.loads(manifest_path.read_text('utf-8'))
    version = manifest['version']
    manifest['name'] += ' · 安装副本'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    changed = Registry(registry.root).get(plugin.manifest.id)
    next_receipt = changed.verify()
    assert changed.manifest.version == version
    assert not next_receipt['cache_hit']
    assert next_receipt['release_digest'] != catalogue['release_digest']

    # A re-sealed package is insufficient when its declared host lock is false.
    lock = changed.directory / 'src/host-dependencies.json'
    original_lock, original_manifest = lock.read_bytes(), manifest_path.read_bytes()
    dependencies = json.loads(original_lock)
    dependencies[0]['sha256'] = '0' * 64
    lock.write_text(json.dumps(dependencies), encoding='utf-8')
    manifest['files'] = seal(changed.directory)
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    with pytest.raises(PluginHostError) as failure:
        Registry(registry.root).get(plugin.manifest.id).verify()
    assert failure.value.code == 'HOST_DEPENDENCIES_MISMATCH'
    lock.write_bytes(original_lock)
    manifest_path.write_bytes(original_manifest)

    # Same byte count and restored mtime cannot authenticate a modified source.
    entry = changed.entry
    original, metadata = entry.read_bytes(), entry.stat()
    entry.write_bytes(bytes([original[0] ^ 1]) + original[1:])
    os.utime(entry, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
    with pytest.raises(PluginHostError) as failure:
        changed.verify()
    assert failure.value.code == 'PACKAGE_DIGEST_MISMATCH'
