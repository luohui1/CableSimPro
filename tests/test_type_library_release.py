"""Use T4's real source payload without access to the development checkout.

This checks the model-library runtime closure; the CI installation job separately
checks the complete offline archive, production frontend and platform wheels.
"""
from pathlib import Path
import json
import os
import subprocess
import sys
import textwrap

from scripts.build_release import copy_sources


def test_release_payload_imports_public_catalogues_without_studio(tmp_path):
    root = Path(__file__).resolve().parents[1]
    payload = tmp_path / 'payload'
    payload.mkdir()
    copy_sources(root, payload)
    assert not (payload / 'studio').exists()
    assert not (payload / 'frontend/scripts/catalogue_seed.py').exists()
    assert (payload / 'backend/kernel/catalogue_seed.py').is_file()
    assert (payload / 'backend/kernel/catalogue_core/catalogues/bahra_mv_lead_sheathed.json').is_file()
    program = textwrap.dedent('''\
        from pathlib import Path
        import json
        import sys

        payload, data = map(Path, sys.argv[1:])
        sys.path.insert(0, str(payload))
        from fastapi.testclient import TestClient
        from backend.main import create_app
        from backend.kernel.catalogue_seed import import_public_catalogues
        from backend.kernel.catalogue_core import catalogue, CoreError, REPO

        assert REPO == payload
        assert Path(catalogue.__file__).is_relative_to(payload)
        assert CoreError.__module__ == 'backend.kernel.catalogue_core'
        assert not any(name == 'studio' or name.startswith('studio.') or
                       name == 'studio_core' or name.startswith('studio_core.') for name in sys.modules)
        data.mkdir()
        with TestClient(create_app(data / 'library.sqlite')) as client:
            catalogues = import_public_catalogues(client)
            counts = {}
            for record in catalogues:
                counts[record['sample_id']] = counts.get(record['sample_id'], 0) + len(record['specs'])
                assert record['state'] == 'draft' and record['human_reviewed'] is False
                detail = client.get('/api/type-library/series/' + record['series_id'])
                assert detail.status_code == 200, detail.text
                for spec in detail.json()['specs']:
                    assert spec['state'] == 'draft'
                    assert spec['values']
                    for value in spec['values']:
                        if value['source']['origin'] == 'standard':
                            basis = value['source']['reference']
                            assert value['method'] == {'name': '标准依据库', 'version': basis['plugin_version'],
                                                       'release_digest': basis.get('release_digest')}
                        else:
                            assert value['method'] == {'name': '厂家结构表导入', 'version': '1.1.0'}
                        assert value['confidence'] == 'reference'
                        assert value['source']['file_sha256'] == record['workbook_sha256']
            assert counts == {'people-mv': 46, 'bahra-mv': 13}
            for name, count in counts.items():
                response = client.post('/api/type-library/catalogue-comparison/' + name, json={})
                assert response.status_code == 200, response.text
                report = response.json()
                assert len(report['rows']) == count
                assert report['summary']['ampacity_compared'] == report['summary']['four_metric_passed'] == 0
                assert report['reference_calculation'] is None
            response = client.post('/api/type-library/catalogue-comparison/bahra-mv',
                                   json={'reference_scenario_confirmed': True})
            assert response.status_code == 200, response.text
            reference = response.json()
            assert reference['reference_calculation']['summary']['ampacity_compared'] == 13
            assert reference['summary']['ampacity_compared'] == reference['summary']['four_metric_passed'] == 0
        loaded = {name: str(Path(module.__file__).resolve()) for name, module in sys.modules.items()
                  if name.startswith('backend.') and getattr(module, '__file__', None)}
        assert loaded and all(Path(path).is_relative_to(payload) for path in loaded.values())
        print(json.dumps({'specifications': counts, 'backend_modules': len(loaded),
                          'runtime_root': str(REPO), 'studio_loaded': False}))
    ''')
    environment = {**os.environ, 'CABLESIM_AGENT_KEY_STORE': 'memory',
                   'CABLESIM_DATASETS_DIR': str(tmp_path / 'datasets'),
                   'CABLESIM_REPRODUCTION_LIBRARY': str(tmp_path / 'reproductions'),
                   'PYTHONDONTWRITEBYTECODE': '1'}
    result = subprocess.run([sys.executable, '-I', '-c', program, str(payload), str(tmp_path / 'data')],
                            cwd=tmp_path, env=environment, capture_output=True, text=True,
                            encoding='utf-8', timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
    receipt = json.loads(result.stdout.splitlines()[-1])
    assert receipt['specifications'] == {'people-mv': 46, 'bahra-mv': 13}
    assert receipt['studio_loaded'] is False and receipt['runtime_root'] == str(payload)
