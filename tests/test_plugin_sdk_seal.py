"""Exercise the maintainer CLI against two genuinely changed bundled plugins."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def test_targeted_seal_writes_only_selected_plugin(tmp_path):
    for directory in ('backend', 'cablesim_sdk', 'scripts', 'plugin-spec', 'plugins'):
        shutil.copytree(ROOT / directory, tmp_path / directory,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'node_modules'))
    def run(*arguments):
        return subprocess.run([sys.executable, 'scripts/plugin_sdk.py', *arguments], cwd=tmp_path,
                              capture_output=True, text=True, encoding='utf-8',
                              env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})

    # Concurrent maintainers may have additional unpublished drift. Normalize
    # only this private copy before manufacturing the two independent changes.
    prepared = run('seal', '--write')
    assert prepared.returncode == 0, prepared.stdout + prepared.stderr
    verified = run('verify')
    assert verified.returncode == 0, verified.stdout + verified.stderr
    selected = 'cablesim.iec60287'
    other = 'cablesim.thermal-network'
    for name in (selected, other):
        entry = next((tmp_path / 'plugins' / name / 'src').rglob('main.py'))
        entry.write_bytes(entry.read_bytes() + b'\nimport backend.kernel.source_watch\n# Maintainer seal regression: real source and import drift.\n')
    other_manifest = tmp_path / 'plugins' / other / 'plugin.json'
    metadata = json.loads(other_manifest.read_text('utf-8'))
    metadata['description'] += ' · 未发布的说明调整'
    other_manifest.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    before = {p.relative_to(tmp_path).as_posix(): p.read_bytes()
              for p in (tmp_path / 'plugins').rglob('*') if p.is_file()}
    catalogue = json.loads(before['plugins/registry.json'])
    schemas = {p.name: p.read_bytes() for p in (tmp_path / 'plugin-spec').glob('*.json')}

    result = run('seal', f'plugins/{selected}/plugin.json', '--write')
    assert result.returncode == 0, result.stdout + result.stderr
    assert other in result.stderr
    assert json.loads(result.stderr)['catalogue_plugins'] == [other]
    assert json.loads(result.stdout)['written']['v2_plugins'] == [selected]
    changed = {p.relative_to(tmp_path).as_posix() for p in (tmp_path / 'plugins').rglob('*')
               if p.is_file() and before.get(p.relative_to(tmp_path).as_posix()) != p.read_bytes()}
    assert changed == {f'plugins/{selected}/plugin.json',
                       f'plugins/{selected}/src/host-dependencies.json', 'plugins/registry.json'}
    after = json.loads((tmp_path / 'plugins/registry.json').read_text('utf-8'))
    assert [p for p in after['plugins'] if p['plugin_id'] != selected] == [
        p for p in catalogue['plugins'] if p['plugin_id'] != selected]
    assert schemas == {p.name: p.read_bytes() for p in (tmp_path / 'plugin-spec').glob('*.json')}
    checked = run('seal', f'plugins/{selected}/plugin.json')
    assert checked.returncode == 0, checked.stdout + checked.stderr
    assert other in checked.stderr
    # A foreign installation failure must also remain a warning, without writes.
    previous_manifest = other_manifest.read_bytes()
    other_manifest.write_bytes(b'{')
    invalid_foreign = run('seal', f'plugins/{selected}/plugin.json', '--write')
    assert invalid_foreign.returncode == 0, invalid_foreign.stdout + invalid_foreign.stderr
    assert other in invalid_foreign.stderr and other_manifest.read_bytes() == b'{'
    other_manifest.write_bytes(previous_manifest)
    # An explicit whole-library action still fixes the remaining drift.
    all_plugins = run('seal', '--write')
    assert all_plugins.returncode == 0, all_plugins.stdout + all_plugins.stderr
    assert other in json.loads(all_plugins.stdout)['written']['v2_plugins']
    assert run('verify').returncode == 0
