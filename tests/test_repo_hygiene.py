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


def test_scientific_temperature_names_are_not_temporary_files():
    from scripts.check_hygiene import version_names

    assert version_names(['docs/architecture/temperature-field.md','backend/TemperatureField.py']) == []
    rejected=['backend/TempFile.py','backend/tempFile.py','docs/result-temp.md','backend/OldSolver.py']
    assert len(version_names(rejected))==len(rejected)


def test_validation_references_are_scoped_and_docs_are_consumers(tmp_path,monkeypatch):
    import scripts.check_hygiene as hygiene
    monkeypatch.setattr(hygiene,'ROOT',tmp_path)
    files=['plugins/a/validation/check.py','plugins/a/validation/helper.py',
           'plugins/b/validation/check.py','docs/validation.md']
    bodies=['from helper import prepare\n','def prepare(): pass\n','pass\n',
            'python plugins/a/validation/check.py\n']
    for name,body in zip(files,bodies):
        target=tmp_path/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(body,encoding='utf-8')
    issues=hygiene.dead_scripts(files)
    assert len(issues)==1 and issues[0].endswith('plugins/b/validation/check.py')


def test_only_declared_and_byte_sealed_plugin_covers_are_binary_exceptions(tmp_path,monkeypatch):
    from hashlib import sha256
    import json
    import scripts.check_hygiene as hygiene
    monkeypatch.setattr(hygiene,'ROOT',tmp_path)
    manifest='plugins/example.method/plugin.json';cover='plugins/example.method/assets/cover.webp'
    raw=b'RIFF'+bytes(4)+b'WEBPfixture'
    path=tmp_path/cover;path.parent.mkdir(parents=True);path.write_bytes(raw)
    data={'presentation':{'assets':[{'role':'cover','path':'assets/cover.webp','media_type':'image/webp'}]},
        'files':[{'path':'assets/cover.webp','sha256':sha256(raw).hexdigest(),'size_bytes':len(raw)}]}
    (tmp_path/manifest).write_text(json.dumps(data),encoding='utf-8')
    assert hygiene.large_or_misplaced_binaries([manifest,cover])==[]
    path.write_bytes(raw+b'changed')
    assert hygiene.large_or_misplaced_binaries([manifest,cover])==['binary outside design or docs: '+cover]
