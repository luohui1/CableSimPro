"""Offline numeric evidence, conservative queries and the real v2 process boundary."""
from copy import deepcopy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import shutil

import pytest

from backend.plugin_host.executor import Executor
from backend.plugin_host.registry import Registry, seal
from backend.kernel.workspace import fingerprint

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'plugins/cablesim.standards-basis'
DATA = PACKAGE / 'src/cablesim_standards_basis'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, DATA / filename)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


library_module = module('standards_basis_library', 'library.py')
rebuild = module('standards_basis_rebuild', 'rebuild.py')


@pytest.fixture
def library():
    return library_module.BasisLibrary()


def query(standard='GB/T 12706.2', edition='2020', locator='表 7',
          quantity='insulation_nominal', conditions=None, **extra):
    return dict(schema_version='cablesim.standards-query/1', standard=standard, edition=edition,
                locator=locator, quantity=quantity,
                conditions=conditions if conditions is not None else
                {'area_m2': 240e-6, 'u0_v': 12000, 'u_v': 20000, 'insulation': 'XLPE'}, **extra)


def only(library, request):
    answer = library.query(request)
    assert answer['status'] == 'resolved'
    assert answer['approval'] == 'not_granted'
    assert len(answer['records']) == 1
    return answer['records'][0]


def test_key_cells_against_independent_manual_page_values(library):
    # Values read from original PDF pages, not generated from the implementation.
    samples = [
        (query(), 5.5, 7, 15),
        (query('GB/T 12706.1', locator='表 7', conditions={'area_m2': 240e-6, 'u0_v': 600, 'u_v': 1000, 'insulation': 'XLPE'}), 1.7, 6, 12),
        (query('GB/T 12706.1', locator='表 8', conditions={'area_m2': 1000e-6, 'u0_v': 1800, 'u_v': 3000, 'insulation': 'HEPR'}), 2.8, 7, 13),
        (query('GB/T 12706.2', locator='表 8', conditions={'area_m2': 10e-6, 'u0_v': 3600, 'u_v': 6000, 'insulation': 'EPR', 'screened': 'no'}), 3.0, 7, 15),
        (query('GB/T 12706.3', locator='表 6', conditions={'area_m2': 240e-6, 'u0_v': 21000, 'u_v': 35000, 'insulation': 'XLPE'}), 9.3, 6, 11),
        (query('GB/T 12706.3', locator='表 A.1', quantity='conductor_fictitious_diameter', conditions={'area_m2': 1600e-6}), 45.1, 32, 37),
        (query('GB/T 12706.3', locator='表 A.2', quantity='screen_diameter_increase', conditions={'screen_area_m2': 20e-6}), 1.2, 33, 38),
        (query('GB/T 3956', '2008', '表 2', 'resistance_20_max', {'area_m2': 240e-6, 'conductor_class': 2, 'conductor_material': 'copper', 'coating': 'plain'}), .0754, 4, 7),
        (query('GB/T 3956', '2008', '表 1', 'resistance_20_max', {'area_m2': 185e-6, 'conductor_class': 1, 'conductor_material': 'copper', 'coating': 'plain', 'conductor_form': 'circular'}), .101, 3, 6),
        (query('GB/T 3956', '2008', '表 1', 'resistance_20_max', {'area_m2': 1200e-6, 'conductor_class': 1, 'conductor_material': 'aluminium', 'conductor_form': 'circular'}), .0247, 4, 7),
        (query('IEC 60228', '2023', 'Table 4', 'wire_count_min', {'area_m2': 240e-6, 'conductor_class': 2, 'conductor_material': 'copper', 'conductor_form': 'compacted'}), 34, 13, 15),
        (query('IEC 60228', '2023', 'Table 4', 'resistance_20_max', {'area_m2': 1400e-6, 'conductor_class': 2, 'conductor_material': 'copper', 'coating': 'metal_coated'}), .0129, 13, 15),
        (query('IEC 60228', '2023', 'Table 4', 'resistance_20_max', {'area_m2': 3500e-6, 'conductor_class': 2, 'conductor_material': 'copper', 'coating': 'metal_coated'}), .0051, 13, 15),
        (query('GB/T 11017.2', '2024', '表 2', 'insulation_nominal', {'area_m2': 240e-6, 'u0_v': 64000, 'u_v': 110000}), 19, 4, 10),
        (query('GB/T 11017.2', '2024', '表 3', 'metal_sheath_nominal', {'area_m2': 1600e-6, 'sheath_material': 'corrugated_aluminium'}), 2.3, 7, 13),
        (query('GB/T 11017.2', '2024', '表 4', 'oversheath_nominal', {'area_m2': 1200e-6, 'u0_v': 64000, 'u_v': 110000}), 5, 8, 14),
    ]
    for request, expected, printed, pdf in samples:
        record = only(library, request)
        assert record['value'] == expected
        assert (record['printed_page'], record['pdf_page']) == (printed, pdf)


def test_every_record_has_complete_provenance_and_two_route_evidence(library):
    sources = {s['sha256'] for s in library.data['sources']}
    authoring = {t['id']: t for t in json.loads((DATA/'excerpts.json').read_text('utf-8'))['tables']}
    ids = set()
    for record in library.data['records']:
        assert record['id'] not in ids
        ids.add(record['id'])
        assert record['standard'] and record['edition'] and record['title']
        assert record['clause'] or record['table']
        assert (type(record['printed_page']) is int and record['printed_page'] > 0) or (
            isinstance(record['printed_page'], str) and __import__('re').fullmatch(r'[1-9]\d*-[1-9]\d*', record['printed_page']))
        assert type(record['pdf_page']) is int and record['pdf_page'] > 0
        assert record['source_file'] and record['source_sha256'] in sources
        assert record['quantity']['name'] and record['quantity']['dimension'] and record['quantity']['unit']
        assert record['conditions'] is not None
        evidence = library.verification['tables'][record['verification']['evidence_id']]
        assert len(evidence['methods']) >= 2
        checked = evidence['cells'][record['row']-1]
        table = authoring[record['verification']['evidence_id']]
        col_index = next(i for i,c in enumerate(table['columns']) if c['id']==record['column'])
        assert checked[col_index]['route_a'] == checked[col_index]['route_b'] == record['value']
        expected_status = 'blocked' if record['verification']['evidence_id'] == 'mv-表18' else 'verified'
        assert checked[col_index]['status'] == record['verification']['status'] == expected_status
        if expected_status == 'blocked': assert record['verification']['note']
    assert len(ids) >= 1429
    assert {r['table_id'] for r in library.verification['unresolved']} == {'mv-表18'}
    assert sources >= {
        '9c398e261e5b88d24db5f0ca5a698402bc25eab6e4da0de063ebd4cd7790f6f1',
        'cb45f149b626e5ab9f50c491f7950965ad604a37cb9dac2c76eee013511f0970',
        '3b5fa321c213d4aaac7e04a293b9026626f43cc5b15209b26b713172e56f748d',
        'b6251feba7318676bc7b28d481f7e978fc66b1efa9f5c16e8bf0f83d0399555a',
        '4b2cca105c903cf4fed10b7f06cced06b834da1561170f1d9be96eb67ad0e3bb',
        '5cf2ff30a362b32f674dc2d2498796625ca13b4f3c27923277560b36f40cf0dc',
        'b9a118e1282b4eeee6ec6ae4653e8c80e0a42beee0df5bf84360c4876a856939',
        'd50b9d8338bdd224b0ffef2714d2e58722b2408e624c161d3503ae2c3374605e',
        '5a9ecebbedf59c0b99d44c4b3520147d8bd08208ff2b7b6f338cdbbe5628b89b',
    }


def test_all_selected_tables_are_complete_including_empty_cells(library):
    counts = {
        'lv-表6': (13,2), 'lv-表7': (16,2), 'lv-表8': (17,4), 'lv-表9': (6,1), 'lv-表10': (6,1), 'lv-表11': (3,2), 'lv-表12': (2,1),
        'mv-表6': (1,1), 'mv-表7': (9,5), 'mv-表8': (9,6), 'mv-表9': (6,1), 'mv-表10': (6,1), 'mv-表11': (3,2), 'mv-表12': (5,1),
        'v35-表6': (1,2), 'v35-表7': (5,1), 'v35-表8': (3,1), 'v35-表9': (2,1), 'v35-表A.1': (16,1), 'v35-表A.2': (16,1), 'v35-表10': (2,2), 'v35-表12': (2,1),
        'gb3956-表1': (25,3), 'gb3956-表2': (30,9), 'gb3956-表3': (22,3), 'gb3956-表4': (19,3),
        'iec-Table3': (27,3), 'iec-Table4': (33,9), 'iec-Table5': (22,3), 'iec-Table6': (19,3),
        'hv-表2': (12,3), 'hv-表3': (12,3), 'hv-表4': (12,2),
    }
    indexes={t['id']:t for t in library.data['tables']}
    for ident,(rows,cols) in counts.items():
        t=indexes[ident]
        assert (t['row_count'], t['column_count'],t['record_count']) == (rows,cols,rows*cols)
        assert len(set(t['record_ids'])) == rows*cols
    assert sum(indexes[k]['record_count'] for k in counts) == 1384


def test_seals_digests_and_deterministic_rebuild(library):
    plugin=Registry(ROOT/'plugins',plugin_id='cablesim.standards-basis').get('cablesim.standards-basis')
    plugin.verify()
    assert plugin.manifest.model_dump(mode='json')['files'] == seal(PACKAGE)
    for name, expected in rebuild.expected_files().items():
        assert (DATA/name).read_bytes() == expected
    catalogue=json.loads((ROOT/'plugins/registry.json').read_text('utf-8'))
    entry=next(e for e in catalogue['plugins'] if e['plugin_id']==plugin.manifest.id)
    assert entry['release_digest']==fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))


def test_tampering_with_data_and_its_local_checksum_is_rejected(tmp_path):
    copied=tmp_path/'plugins/cablesim.standards-basis'
    shutil.copytree(PACKAGE,copied)
    data=copied/'src/cablesim_standards_basis'
    raw=(data/'basis.json').read_bytes()+b' '
    (data/'basis.json').write_bytes(raw)
    index=json.loads((data/'integrity.json').read_text('utf-8'))
    index['files']['basis.json'].update(sha256=sha256(raw).hexdigest(),size_bytes=len(raw))
    (data/'integrity.json').write_text(json.dumps(index),'utf-8')
    with pytest.raises(library_module.BasisError) as caught:
        library_module.BasisLibrary(data)
    assert caught.value.code=='BASIS_INTEGRITY_FAILED'


def test_missing_conditions_and_wrong_si_units_stop_on_the_field(library):
    request=query();del request['conditions']['insulation']
    with pytest.raises(library_module.BasisError) as caught:library.query(request)
    assert caught.value.code=='CONDITIONS_REQUIRED' and caught.value.path=='/conditions/insulation'
    request=query();request['conditions']['area_m2']=240
    with pytest.raises(library_module.BasisError) as caught:library.query(request)
    assert caught.value.code=='INPUT_INVALID' and caught.value.path=='/conditions/area_m2'
    request=query();request['conditions']['area_mm2']=240
    with pytest.raises(library_module.BasisError) as caught:library.query(request)
    assert caught.value.path=='/conditions/area_mm2'


@pytest.mark.parametrize('value',[0,-1,float('nan'),float('inf'),True,'0.00024',2**1024])
def test_invalid_numerical_conditions_are_rejected(library,value):
    request=query();request['conditions']['area_m2']=value
    with pytest.raises(library_module.BasisError):library.query(request)


def test_no_extrapolation_version_substitution_or_alloy_derivation(library):
    for request in [query(edition='2019'),query(conditions={'area_m2':5e-6,'u0_v':12000,'u_v':20000,'insulation':'XLPE'}),
                    query('GB/T 12706.3','2020','表 A.2','screen_diameter_increase',{'screen_area_m2':1e-6}),
                    query('IEC 60228','2023','Table 4','resistance_20_max',{'area_m2':240e-6,'conductor_class':2,'conductor_material':'aluminium_alloy'})]:
        assert library.query(request)['status']=='not_covered'
    with pytest.raises(library_module.BasisError) as caught:library.query(query(expected_data_sha256='0'*64))
    assert caught.value.code=='BASIS_VERSION_CHANGED'


def test_empty_cell_and_alternative_values_are_preserved(library):
    answer=library.query(query('GB/T 12706.2',conditions={'area_m2':10e-6,'u0_v':12000,'u_v':20000,'insulation':'XLPE'}))
    assert answer['status']=='explicit_not_applicable' and answer['records'][0]['value'] is None
    record=only(library,query(locator='表 10',quantity='armour_wire_nominal',conditions={'diameter_m':.061}))
    assert record['value']==[3.15,4]


def test_diameter_boundary_and_one_higher_bucket_are_exact(library):
    record=only(library,query(locator='表 9',quantity='lining_nominal',conditions={'diameter_m':.025}))
    assert record['value']==1
    record=only(library,query(locator='表 9',quantity='lining_nominal',conditions={'diameter_m':.025001}))
    assert record['value']==1.2


def test_formula_parameters_against_hand_calculation_and_reference_semantics(library):
    outer=only(library,query(locator='14.3',quantity='oversheath_nominal',conditions={'core_count':3}))['value']
    assert max(outer['floor'],outer['a']*40+outer['b'])==pytest.approx(2.4)
    assert outer['rounding']['execution_status']=='not_implemented'
    minimum=only(library,query(locator='17.5.2',quantity='insulation_min',conditions={}))['value']
    assert minimum['a']*5.5+minimum['b']==pytest.approx(4.85)
    ref=only(library,query('GB/T 11017.2','2024','6.3.2','conductor_screen_nominal_reference',{}))
    assert ref['semantic']=='standard_reference' and ref['criterion']=='approximate'
    voltage=only(library,query('GB/T 12706.3','2020','表 12','sample_ac_voltage',{'u0_v':21000}))
    assert voltage['value']==84 and voltage['criterion']=='test_voltage'


def test_blocked_evidence_is_listed_but_never_resolved(library):
    record=only(library,query());target=next(r for r in library.data['records'] if r['id']==record['id'])
    target['verification']['status']='blocked'
    with pytest.raises(library_module.BasisError) as caught:library.query(query())
    assert caught.value.code=='EVIDENCE_BLOCKED'
    listed=library.query(query(operation='list',conditions={}))
    assert any(r['verification']['status']=='blocked' for r in listed['records'])


def test_real_host_process_check_run_errors_retries_and_citation(tmp_path):
    executor=Executor(Registry(ROOT/'plugins',plugin_id='cablesim.standards-basis'),jobs_root=tmp_path)
    valid={'case_id':'valid','input':query()}
    invalid=deepcopy(valid);invalid['case_id']='invalid';del invalid['input']['conditions']['insulation']
    checked=executor.check('cablesim.standards-basis','lookup',[valid,invalid])
    assert [c.status for c in checked.cases]==['succeeded','failed']
    assert checked.cases[1].error['path']=='/conditions/insulation'
    assert checked.cases[0].artifacts=={} and checked.cases[0].results==[]
    run=executor.run('cablesim.standards-basis','lookup',[valid,invalid])
    assert [c.status for c in run.cases]==['succeeded','failed']
    answer=run.cases[0].artifacts['x-cablesim.standards-basis']
    assert answer['records'][0]['citation']=='GB/T 12706.2—2020 表 7，第 7 页（PDF 第 15 页）'
    assert answer['records'][0]['value']==5.5 and answer['approval']=='not_granted'
    retry=executor.run('cablesim.standards-basis','lookup',[valid])
    assert retry.cases[0].artifacts['x-cablesim.standards-basis']==answer
    assert run.plugin_version==checked.plugin_version=='0.7.0'
    assert len(run.request_sha256)==len(checked.request_sha256)==64
