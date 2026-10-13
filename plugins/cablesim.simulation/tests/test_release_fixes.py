"""Release repair guards; no native meshing or solver is executed."""
import importlib.util
import json
from pathlib import Path
import sys
import sqlite3
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src')]


def test_seeded_thermal_input_is_complete_and_preparable(tmp_path, monkeypatch):
    monkeypatch.setenv('CABLESIM_ENGINEERING_EVIDENCE',str(tmp_path/'missing-engineering-evidence'))
    from cablesim_simulation.three_core_thermal import prepare
    from backend.plugin_host.parameter_contracts import validate_case
    from cablesim_sdk.parameter_units import decode_request
    from backend.plugin_host.registry import Registry
    path=ROOT/'frontend/scripts/seed-engineering-demo.py'
    spec=importlib.util.spec_from_file_location('fem_release_seed',path)
    seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)
    database=tmp_path/'release/engineering.sqlite';seed.seed_release(database)
    with sqlite3.connect(database) as db:
        db.row_factory=sqlite3.Row
        row=next(row for row in db.execute('SELECT * FROM study_versions') if '有限元温度场' in json.loads(row['definition'])['title'])
        captured=json.loads(row['definition'])
        wid=db.execute('SELECT workspace FROM studies WHERE id=?',(row['study'],)).fetchone()['workspace']
        document=json.loads(db.execute('SELECT state FROM workspaces WHERE id=(SELECT workspace FROM studies WHERE id=?)',(row['study'],)).fetchone()['state'])['domain']
    plugin=Registry().get('cablesim.simulation');cap=plugin.manifest.capability('iec-thermal-field')
    case={'input':document,'parameters':captured['parameters']}
    validate_case(cap,case)
    request=decode_request({'capability':cap.id,'cases':[case]},ROOT/'plugins/cablesim.simulation/plugin.json')
    native=request['cases'][0]
    prepare(native['input'],native['parameters'])
    assert captured['parameters']['outer_boundary']=='kennelly_image'
    from backend.main import create_app
    from fastapi.testclient import TestClient
    with TestClient(create_app(database)) as client:
        response=client.get('/api/hpc/workspaces/'+wid+'/studies/'+row['study']+'/availability?module=thermal-field')
        assert response.status_code==200
        assert response.json()['location']=='slurm' and response.json()['local_solver_allowed'] is False


def test_evidence_scope_names_keep_sources_and_numbers():
    from backend.foundation.reproduction_library import bundled_evidence
    evidence,_,_=bundled_evidence();items={row['id']:row for row in evidence['items']}
    for identifier in ('E17','E18','E19'):
        assert items[identifier]['scope'].startswith('表1') or '表1' in items[identifier]['scope']
        assert 'Table' not in items[identifier]['scope']
        assert items[identifier]['rows']
    assert len(items)==63 and len(items['B02-2']['sensitivity']['rows'])==13
    assert items['E05']['scope'].startswith('二维磁准静态有限元')
    assert 'case studies' not in items['B02']['scope']
    assert items['B02-2']['sensitivity']['scope'].startswith('局部加密诊断')


def test_method_figures_are_legible_and_do_not_expose_implementation():
    for identifier in ('cablesim.simulation','cablesim.hybrid-rating'):
        value=(ROOT/'plugins'/identifier/'assets/method.svg').read_text('utf-8')
        root=ET.fromstring(value)
        assert root.attrib['viewBox']=='0 0 560 230'
        assert '22px' in value
        assert '.py' not in value and 'reference_only' not in value
        assert len(root.findall('.//{http://www.w3.org/2000/svg}text'))==7
