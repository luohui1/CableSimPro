"""Source drift after startup produces actionable 409s, not server errors."""
from pathlib import Path
import shutil
from threading import Event
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.plugin_host import Executor
from backend.plugin_host.registry import Registry


@pytest.mark.parametrize('fault,code',[
    ('source','PACKAGE_DIGEST_MISMATCH'),('missing','PACKAGE_FILES_MISMATCH'),
    ('manifest','PLUGIN_MANIFEST_INVALID'),('read_error','PLUGIN_SEAL_INVALID')])
def test_input_contracts_refuse_live_source_or_manifest_drift(tmp_path,monkeypatch,fault,code):
    from backend.kernel.research import Research
    warmed = Event()
    original_warm = Research.warm_catalogs
    def warm(self, stop=None):
        original_warm(self, stop)
        warmed.set()
    monkeypatch.setattr(Research, 'warm_catalogs', warm)
    root=Path(__file__).resolve().parents[1];package=tmp_path/'plugins/cablesim.iec60287'
    shutil.copytree(root/'plugins/cablesim.iec60287',package,ignore=shutil.ignore_patterns('__pycache__','tests'))
    # Start from a genuinely admissible isolated package. Without its sealed
    # host import closure, background warm-up can fail before the drift under
    # test and race the request with HOST_DEPENDENCIES_MISMATCH instead.
    for name in ('backend','cablesim_sdk'):
        shutil.copytree(root/name,tmp_path/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc','tests'))
    registry=Registry(tmp_path/'plugins');app=create_app(tmp_path/'library.sqlite')
    registry.get('cablesim.iec60287').verify()
    app.state.research.executor=Executor(registry=registry)
    with TestClient(app) as client:
        # This regression changes a running, fully warmed installation. Do not
        # join a source read which legitimately began before the mutation.
        assert warmed.wait(20), 'Managed catalogue warm-up did not complete'
        source=package/'src/cablesim_iec60287/inputs.py'
        if fault=='source':source.write_bytes(source.read_bytes()+b'\n# changed\n')
        elif fault=='missing':source.unlink()
        elif fault=='manifest':(package/'plugin.json').write_text('{',encoding='utf-8')
        else:
            from backend.plugin_host.registry import Plugin
            monkeypatch.setattr(Plugin,'verify',lambda self:(_ for _ in ()).throw(OSError('file changing')))
            # A Python method replacement is not a filesystem notification;
            # request a fresh verification for this simulated I/O failure.
            monkeypatch.setattr(app.state.research.catalog_read_responses,'generation',lambda _:None)
        response=client.get('/api/input-contracts')
        assert response.status_code==409,response.text
        assert response.json()['detail']['code']==code
        assert response.json()['detail']['message']
        assert client.get('/api/health').status_code==200


def test_contract_read_race_returns_409(tmp_path,monkeypatch):
    from backend.kernel import input_contracts
    monkeypatch.setattr(input_contracts,'verified_contracts',lambda *args:(_ for _ in ()).throw(FileNotFoundError('source changed')))
    with TestClient(create_app(tmp_path/'library.sqlite')) as client:
        response=client.get('/api/input-contracts')
        assert response.status_code==409,response.text
        assert response.json()['detail']['code']=='PLUGIN_INPUT_CONTRACT_INVALID'
