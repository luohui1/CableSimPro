from fastapi.testclient import TestClient
from backend.main import create_app
from backend.schemas import Scenario


def test_health_presets_and_removed_v0_endpoints(tmp_path):
    with TestClient(create_app(tmp_path/'api.sqlite')) as client:
        assert client.get('/api/health').json()['status']=='ok'
        presets=client.get('/api/presets').json()
        assert len(presets)==6
        for item in presets:
            Scenario.model_validate(item['scenario'])
        for endpoint in ['calculate','sweep','report','validate','projects']:
            assert client.post('/api/'+endpoint,json={}).status_code==404
        assert client.get('/api/not-a-real-endpoint').status_code==404
        routes={r.path for r in client.app.routes}
        assert '/api/design/study-workspaces' in routes
        assert any('requirements' in p for p in routes)
        assert any('rating-table' in p for p in routes)
