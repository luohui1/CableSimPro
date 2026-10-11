"""Release isolation and API/static routing, without installing or building packages."""
import importlib.util
from contextlib import closing
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
        for route in ('/', '/studies/example/sweep/results?workspace=sample', '/plugins/cablesim.iec60287'):
            response = client.get(route)
            assert response.status_code == 200 and 'id="root"' in response.text
        script = client.get('/assets/app.js')
        assert script.status_code == 200 and 'javascript' in script.headers['content-type']
        assert client.get('/api/health').json()['status'] == 'ok'
        assert client.get('/api/workspaces').json() == []
        for route in ('/api/not-an-endpoint', '/api', '/assets/missing.js', '/assets/missing', '/gallery', '/gallery/selection', '/missing.css'):
            response = client.get(route)
            assert response.status_code == 404 and 'id="root"' not in response.text, route


def test_completed_release_seed_keeps_user_data_and_unfinished_seed_is_refused(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'frontend/scripts/seed-engineering-demo.py'
    spec = importlib.util.spec_from_file_location('release_seed', path)
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    database = tmp_path / 'engineering.sqlite'
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.execute('CREATE TABLE user_data (value TEXT)')
        connection.execute("INSERT INTO user_data VALUES ('user changes')")
    before = database.read_bytes()
    with pytest.raises(SystemExit, match='保留数据'):
        seed.seed_release(database)
    assert database.read_bytes() == before
    monkeypatch.setenv('CABLESIM_DATASETS_DIR',str(tmp_path/'datasets'))
    from backend.main import create_app
    with TestClient(create_app(database)):
        pass
    before = database.read_bytes()
    database.with_suffix('.seed.json').write_text(json.dumps({'complete':True,'identity':seed.release_identity()}), encoding='utf-8')
    monkeypatch.setattr(seed,'build_release_seed',lambda *_a: pytest.fail('Unchanged release must preserve user edits'))
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
    assert receipt['complete'] and len(receipt['studies']) == 4 and len(receipt['types']) == 2
    assert receipt['identity'] == seed.release_identity()
    assert receipt['identity']['engineering_resources']
    assert len(receipt['engineering_resources']) == 28
    assert all(row['resource_bindings']['bound'] >= 2 for row in receipt['types'])
    assert sum(bool(row.get('run')) for row in receipt['studies']) == 3
    type_runs=[module for item in receipt['types'] for module in item['modules'] if module.get('run')]
    assert len(type_runs)>=6
    assert all(item['status'] in ('succeeded','partial') for item in type_runs)
    assert all(any(m.get('run') and m['title']=='标准核对' for m in item['modules']) for item in receipt['types'])
    assert any('有限元温度场' in row['title'] and not row.get('run') for row in receipt['studies'])
    hv=next(row for row in receipt['studies'] if '110 kV' in row['title'])
    assert hv['run'] and hv['ready'] and hv['status']=='succeeded'
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute('SELECT COUNT(*) FROM workspaces').fetchone()[0] == 4
        assert connection.execute("SELECT COUNT(*) FROM study_runs WHERE status IN ('succeeded','partial')").fetchone()[0] == 3+len(type_runs)
        assert connection.execute("SELECT COUNT(*) FROM engineering_assets WHERE kind='material' AND status='published'").fetchone()[0] == 21
        assert connection.execute("SELECT COUNT(*) FROM engineering_assets WHERE kind='rule' AND status='published'").fetchone()[0] == 7
        candidates=[json.loads(r[0]) for r in connection.execute('SELECT payload FROM domain_cable_models')]
        public=[c for c in candidates if c.get('specification')]
        assert len(public)==10 and len(candidates)==12
        assert all(c['specification']['designation']=='YJV22' and c['specification']['u0_v']==8700 for c in public)
        assert not any(c['confirmed'] for c in candidates)
        hv_run=json.loads(connection.execute('SELECT output FROM study_runs WHERE id=?',(hv['run'],)).fetchone()[0])
        quantities=hv_run['cases'][0]['results']
        capacity=next(q['value'] for q in quantities if q['key']=='ampacity' and q.get('case')=='rating')
        assert capacity == pytest.approx(748.3219742774963,abs=.001)
        from backend.kernel.report import task_answer
        disclosure=task_answer({'snapshot':json.loads(connection.execute('SELECT snapshot FROM study_runs WHERE id=?',(hv['run'],)).fetchone()[0]),'output':hv_run})
        assert '工程师给定参考参数不是厂家实测值' in disclosure and '不是厂家额定载流量' in disclosure
        hv_model=next(c for c in candidates if '起帆' in c['name'])
        assert hv_model['version']=='1.0.0'
        assert hv_model['cable_type']['cores'][0]['conductor']['r20_basis']=='manufacturer_limit'
        assert hv_model['cable_type']['cores'][0]['conductor']['conductor_class']==2
        class_source=hv_model['sources']['/cable_type/cores/core~11/conductor/conductor_class']
        assert class_source['kind']=='standard' and not class_source['reviewed']
        assert '6.1.1' in class_source['reference'] and 'PDF 第 9 页' in class_source['reference']
        assert {s['kind'] for s in hv_model['sources'].values()} >= {'manufacturer','standard','derived','user'}
        assert '不是厂家额定' in receipt['hv_series']['engineering_scope']
        # 研究模块键与运行记录的模块必须是前端已有的模块，否则研究页找不到运行、显示“未运行”
        import re
        modules=set(re.findall(r'^  "?([a-z-]+)"?: \{', (Path(__file__).resolve().parents[1]/'frontend/src/pages/study-modules.ts').read_text('utf-8'), re.M))
        assert {'ampacity','selection','sweep','thermal-field'} <= modules
        for (definition,) in connection.execute('SELECT definition FROM study_versions'):
            assert set((json.loads(definition).get('modules') or {})) <= modules
        for (snapshot,) in connection.execute('SELECT snapshot FROM study_runs'):
            assert json.loads(snapshot).get('module') in modules | {None, ''}
    before = database.read_bytes()
    seed.seed_release(database)
    assert database.read_bytes() == before
    assert development.read_bytes() == b'development database sentinel'


@pytest.mark.parametrize('change', ['plugins', 'models', 'engineering_resources'])
def test_release_version_change_backs_up_user_data_before_replacement(tmp_path, monkeypatch, change):
    spec=importlib.util.spec_from_file_location('upgraded_seed',Path(__file__).resolve().parents[1]/'frontend/scripts/seed-engineering-demo.py')
    seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)
    from backend.main import create_app
    monkeypatch.setenv('CABLESIM_DATASETS_DIR',str(tmp_path/'datasets'))
    database=tmp_path/'engineering.sqlite'
    with TestClient(create_app(database)):
        pass
    with closing(sqlite3.connect(database)) as db, db:
        db.execute('CREATE TABLE user_data (value TEXT)')
        db.execute("INSERT INTO user_data VALUES ('keep in backup')")
        db.execute("INSERT INTO agent_settings VALUES ('model','\"deepseek-flash\"','2026-10-07T14:55:28')")
    identity=seed.release_identity()
    old=json.loads(json.dumps(identity));old[change]={}
    receipt={'complete':True,'identity':old,'user_note':'keep this too'}
    database.with_suffix('.seed.json').write_text(json.dumps(receipt),encoding='utf-8')
    def build(staged, target, versions):
        with TestClient(create_app(staged)):
            pass
        return {'identity':versions,'database':str(target)}
    monkeypatch.setattr(seed,'build_release_seed',build)
    seed.seed_release(database)
    current=json.loads(database.with_suffix('.seed.json').read_text(encoding='utf-8'))
    backup=Path(current['previous_backup'])
    assert backup.parent == tmp_path/'backups'
    from backend.kernel.database_ops import validate
    metadata=json.loads(Path(str(backup)+'.json').read_text(encoding='utf-8'))
    validate(backup,metadata['sha256'])
    with closing(sqlite3.connect(backup)) as db:
        assert db.execute('SELECT value FROM user_data').fetchone()[0]=='keep in backup'
    assert json.loads(backup.with_suffix('.seed.json').read_text(encoding='utf-8'))==receipt
    assert current['identity']==identity and current['complete']
    with closing(sqlite3.connect(database)) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE name='user_data'").fetchone() is None
        # 模型连接设置是用户配置，重建后沿用
        assert db.execute("SELECT value FROM agent_settings WHERE name='model'").fetchone()[0]=='"deepseek-flash"'


def test_failed_release_rebuild_preserves_database_and_receipt(tmp_path, monkeypatch):
    spec=importlib.util.spec_from_file_location('failed_seed',Path(__file__).resolve().parents[1]/'frontend/scripts/seed-engineering-demo.py')
    seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)
    from backend.main import create_app
    monkeypatch.setenv('CABLESIM_DATASETS_DIR',str(tmp_path/'datasets'))
    database=tmp_path/'engineering.sqlite'
    with TestClient(create_app(database)):
        pass
    marker=database.with_suffix('.seed.json')
    marker.write_text(json.dumps({'complete':True}),encoding='utf-8')
    before,receipt=database.read_bytes(),marker.read_bytes()
    def fail(*_args):
        raise RuntimeError('calculation failed')
    monkeypatch.setattr(seed,'build_release_seed',fail)
    with pytest.raises(RuntimeError,match='calculation failed'):
        seed.seed_release(database)
    assert database.read_bytes()==before and marker.read_bytes()==receipt
    assert not list(tmp_path.glob('seed-*')) and not (tmp_path/'backups').exists()
