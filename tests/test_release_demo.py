"""Release isolation and API/static routing, without installing or building packages."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
import pytest

from scripts import run_demo


def test_release_environment_ignores_inherited_development_paths(monkeypatch, tmp_path):
    monkeypatch.setattr(run_demo, 'RELEASE', tmp_path / 'release')
    for key in ('CABLESIM_DB', 'CABLESIM_DATASETS_DIR', 'CABLESIM_REPRODUCTION_LIBRARY', 'CABLESIM_FRONTEND_DIST'):
        monkeypatch.setenv(key, str(tmp_path / 'development'))
    env = run_demo.release_environment()
    assert Path(env['CABLESIM_DB']) == tmp_path / 'release/engineering.sqlite'
    assert all(Path(env[key]).is_relative_to(tmp_path / 'release') for key in
               ('CABLESIM_DB', 'CABLESIM_DATASETS_DIR', 'CABLESIM_REPRODUCTION_LIBRARY', 'CABLESIM_FRONTEND_DIST'))
    assert env['NODE_ENV'] == 'production'


def test_missing_cad_assets_stop_before_creating_release_data(tmp_path, monkeypatch):
    monkeypatch.setattr(run_demo, 'ROOT', tmp_path)
    with pytest.raises(RuntimeError, match='prepare.py --jobs 4') as error:
        run_demo.require_cad_assets()
    assert 'occt-viewer.wasm' in str(error.value)
    assert not (tmp_path / '.data').exists()


@pytest.mark.parametrize('prepare_succeeds', [False, True])
def test_cad_preparation_gates_frontend_build(tmp_path, monkeypatch, prepare_succeeds):
    monkeypatch.setattr(run_demo, 'ROOT', tmp_path)
    monkeypatch.setattr(run_demo, 'RELEASE', tmp_path / '.data/release')
    monkeypatch.setattr(run_demo.sys, 'argv', ['run_demo.py', '--skip-install', '--no-browser'])
    monkeypatch.setattr(run_demo.socket, 'socket', MagicMock())
    monkeypatch.setattr(run_demo.shutil, 'which', lambda _: 'npm')
    events = []

    def execute(command, **kwargs):
        events.append(command)
        if command[1].endswith('prepare.py'):
            assert kwargs['cwd'] == tmp_path
            if not prepare_succeeds:
                raise subprocess.CalledProcessError(1, command)
            cache = tmp_path / 'frontend/src/features/cad/node_modules/.cache/cablesim-occt'
            cache.mkdir(parents=True)
            for name in ('build.json', 'occt-viewer.js', 'occt-viewer.wasm',
                         'LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt'):
                (cache / name).touch()
        else:
            # Stop at the build boundary; no packages, database or server needed.
            raise subprocess.CalledProcessError(2, command)

    monkeypatch.setattr(run_demo, 'run', execute)
    monkeypatch.setattr(run_demo.subprocess, 'Popen', lambda *_a, **_k: pytest.fail('Server must not start'))
    with pytest.raises(subprocess.CalledProcessError) as error:
        run_demo.main()
    assert events[0] == [run_demo.sys.executable,
                         str(tmp_path / 'frontend/src/features/cad/native/prepare.py'), '--jobs', '4']
    assert error.value.returncode == (2 if prepare_succeeds else 1)
    assert len(events) == (2 if prepare_succeeds else 1)
    if prepare_succeeds:
        assert events[1][:3] == ['npm', 'run', 'build:release']
    assert not (tmp_path / '.data').exists()


def test_frontend_routes_and_missing_assets_do_not_mask_api_errors(tmp_path, monkeypatch):
    dist = tmp_path / 'frontend'
    (dist / 'assets').mkdir(parents=True)
    (dist / 'index.html').write_text('<div id="root">release</div>', encoding='utf-8')
    (dist / 'assets/app.js').write_text('export const ready = true;', encoding='utf-8')
    monkeypatch.setenv('CABLESIM_DB', str(tmp_path / 'release.sqlite'))
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path / 'datasets'))
    monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(tmp_path / 'library'))
    monkeypatch.setenv('CABLESIM_FRONTEND_DIST', str(dist))
    with TestClient(run_demo.create_release_app()) as client:
        for route in ('/', '/studies/example/sweep/results?workspace=sample'):
            response = client.get(route)
            assert response.status_code == 200 and 'id="root"' in response.text
        script = client.get('/assets/app.js')
        assert script.status_code == 200 and 'javascript' in script.headers['content-type']
        assert client.get('/api/health').json()['status'] == 'ok'
        assert client.get('/api/workspaces').json() == []
        for route in ('/api/not-an-endpoint', '/api', '/assets/missing.js', '/assets/missing', '/gallery', '/gallery/selection'):
            response = client.get(route)
            assert response.status_code == 404 and 'id="root"' not in response.text, route


def test_completed_release_seed_keeps_user_data_and_unfinished_seed_is_refused(tmp_path):
    path = Path(__file__).resolve().parents[1] / 'frontend/scripts/seed-engineering-demo.py'
    spec = importlib.util.spec_from_file_location('release_seed', path)
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    database = tmp_path / 'engineering.sqlite'
    database.write_bytes(b'existing user data must not be opened or changed')
    before = database.read_bytes()
    with pytest.raises(SystemExit, match='保留数据'):
        seed.seed_release(database)
    database.with_suffix('.seed.json').write_text(json.dumps({'complete':True}), encoding='utf-8')
    seed.seed_release(database)
    assert database.read_bytes() == before


def test_first_release_seed_is_offline_isolated_and_idempotent(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'frontend/scripts/seed-engineering-demo.py'
    spec = importlib.util.spec_from_file_location('fresh_release_seed', path)
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    development = tmp_path / 'development.sqlite'
    development.write_bytes(b'development database sentinel')
    for key in ('CABLESIM_DB', 'CABLESIM_DATASETS_DIR', 'CABLESIM_REPRODUCTION_LIBRARY'):
        monkeypatch.setenv(key, str(development))
    monkeypatch.setattr(seed, 'urlopen', lambda *_a, **_k: pytest.fail('Release seed must not contact a donor service'))
    database = tmp_path / 'release/engineering.sqlite'
    seed.seed_release(database)
    receipt = json.loads(database.with_suffix('.seed.json').read_text(encoding='utf-8'))
    assert receipt['complete'] and len(receipt['studies']) == 2 and len(receipt['types']) == 1
    with sqlite3.connect(database) as connection:
        assert connection.execute('SELECT COUNT(*) FROM workspaces').fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM study_runs WHERE status='succeeded'").fetchone()[0] == 2
        candidates=[json.loads(r[0]) for r in connection.execute('SELECT payload FROM domain_cable_models')]
        assert len(candidates)==10
        assert all(c['specification']['designation']=='YJV22' and c['specification']['u0_v']==8700 for c in candidates)
        assert not any(c['confirmed'] for c in candidates)
    before = database.read_bytes()
    seed.seed_release(database)
    assert database.read_bytes() == before
    assert development.read_bytes() == b'development database sentinel'
