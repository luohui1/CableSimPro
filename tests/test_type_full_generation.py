"""Actual host→Executor→sealed plugins; no substitute engineering tables."""
from uuid import uuid4
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.plugin_host.executor import Executor


@pytest.mark.parametrize('voltage,area,construction,armour,expected',[
    ('8700/15000',240e-6,'three_core','steel_tape',(.0045,.0018,.0005,.0034)),
    ('600/1000',95e-6,'four_core','none',(.0011,.0012,None,.0021)),
    ('26000/35000',400e-6,'single_core','none',(.0105,.0016,None,.0028)),
])
def test_full_structure_uses_live_annex_and_keeps_manufacturing_missing(tmp_path,voltage,area,construction,armour,expected):
    # Manual arithmetic from the original tables (mm, one B.1 half-up per stage):
    # 240: dL=17.5; Dc=17.5+2*4.5+3=29.5; Cu tape 0.1*100=10mm²
    # => Δs=0.8; Ds=30.3; 2.16*30.3=65.448=>65.4.
    # table9 lining=1.8; A.2.4 fictitious0.6 =>66.6; table11 steel0.5
    # =>68.6; 0.035*68.6+1=3.401=>3.4 (B.2 clause increment0.1).
    # 95: dL=11.0; ti=1.1; Dc=13.2; 2.42*13.2=31.944=>31.9;
    # table9 lining1.2; fictitious0.4=>32.7; .035*32.7+1=2.1445=>2.1.
    # 400: dL=22.6; ti=10.5; Dc=46.6; Cu tape0.12*100=12mm²
    # => next table row16mm² increases1.1; Ds=47.7;
    # table7 lining1.6; .3 uses actual nominal =>50.9;
    # .035*50.9+1=2.7815=>2.8. Engineering screen thickness never sets dL.
    values={'schema_version':'cablesim.cable-design-request/2','voltage':voltage,
        'area_m2':area,'construction':construction,'conductor':'copper_bare','form':'solid_round',
        'generation_mode':'complete','screened':'no' if voltage=='600/1000' else 'yes','armour':armour,
        **({'gap_m':0} if construction!='single_core' else {}),
        **({'conductor_screen_thickness_m':.0007,'insulation_screen_thickness_m':.0007,
            'screen_tape_thickness_m':.00012 if voltage=='26000/35000' else .0001,'screen_tape_width_m':.1} if voltage!='600/1000' else {})}
    with TestClient(create_app(tmp_path/'complete.sqlite')) as client:
        response=client.post('/api/types/creation-proposals',json={'request_id':str(uuid4()),'input':values})
        assert response.status_code==200,response.text
        result=response.json(); cable=result['document']['cable_types'][0]
        layers={l['role']:l for l in cable['common_layers']}
        assert next(l for l in cable['cores'][0]['layers'] if l['role']=='insulation')['thickness']==pytest.approx(expected[0])
        assert layers['bedding']['thickness']==pytest.approx(expected[1])
        if expected[2] is not None: assert layers['armour']['nominal_tape_thickness']==pytest.approx(expected[2])
        assert layers['oversheath']['thickness']==pytest.approx(expected[3])
        reference=json.loads(result['document']['provenance']['/cable_types/cable_type~1design/annex_basis']['reference'])
        assert reference['basis_references']['annex_core']['query']['conditions']==({'screened':'yes'} if voltage=='8700/15000' else {})
        assert all(step['record']['printed_page'] and step['record']['pdf_page'] for step in reference['trace'])
        assert all(layer.get('minimum_thickness') is None for layer in layers.values())
        assert client.get('/api/design/type-workspaces').json()==[]
        if voltage=='8700/15000':
            # Human accepts the real proposal, resolves the saved design's basis,
            # then edits all three equal insulation layers. The sealed method
            # must recalculate Annex A from this revision, not reuse the proposal.
            made=client.post('/api/types',json={'request_id':str(uuid4()),'origin':'standard','name':'护层实算核验',
                'proposal_id':result['id'],'content_sha256':result['content_sha256'],'human_confirmed':True},headers={'X-CableSim-Actor':'human'})
            assert made.status_code==201,made.text
            workspace=made.json();document=workspace['domain'];wid=workspace['id']
            executor=Executor()
            def checked():
                answer=client.post('/api/design/type-workspaces/'+wid+'/requirements/basis',json={'request_id':str(uuid4()),'expected_revision':workspace['revision']})
                assert answer.status_code==200,answer.text
                case=executor.run('cablesim.standard-check','dimensions',[{'case_id':'design','input':document,
                    'parameters':{'cable_type_id':document['cable_types'][0]['id'],**answer.json()['parameters']}}]).cases[0]
                assert case.status=='succeeded',case.error
                return case.artifacts['x-cablesim.standard-check']
            initial=checked()
            assert initial['counts']['passed']>=9
            copper=[r for r in initial['rows'] if r['id'].endswith(':screen-tape-nominal')]
            assert all(r['verdict']=='passed' and r['printed_page']==10 for r in copper)
            minima=[r for r in initial['rows'] if r['id'].endswith(':screen-tape-minimum')]
            assert len(minima)==3
            assert all(r['verdict']=='missing' and r['limit']==pytest.approx(.09) and r['printed_page']==10 for r in minima)
            for core in document['cable_types'][0]['cores']:
                next(l for l in core['layers'] if l['role']=='insulation')['thickness']=.0044
            saved=client.put('/api/workspaces/'+wid+'/domain',json={'expected_revision':workspace['revision'],'document':document})
            assert saved.status_code==200,saved.text
            workspace={**workspace,'revision':saved.json()['revision']}
            after=checked()
            failed=[r for r in after['rows'] if r['id'].endswith(':insulation-nominal')]
            assert all(r['verdict']=='failed' and r['printed_page']==7 for r in failed)
            assert after['fictitious_diameter_trace'][-1]['inputs']['D']!=initial['fictitious_diameter_trace'][-1]['inputs']['D']
            # The engineer changes the saved insulation material. PVC/XLPE
            # proposal receipts must not keep judging an EPR design as covered.
            insulation_material=next(l for l in document['cable_types'][0]['cores'][0]['layers'] if l['role']=='insulation')['material']
            next(m for m in document['materials'] if m['id']==insulation_material)['standard_kind']='EPR'
            saved=client.put('/api/workspaces/'+wid+'/domain',json={'expected_revision':workspace['revision'],'document':document})
            assert saved.status_code==200,saved.text
            workspace={**workspace,'revision':saved.json()['revision']}
            changed_material=checked()
            covering_rows=[r for r in changed_material['rows'] if r['id'].rsplit(':',1)[-1] in ('bedding-nominal','oversheath-nominal','armour-tape-nominal')]
            assert covering_rows
            assert all(r['verdict']=='uncovered' and r['limit'] is None and 'XLPE' in r['reason'] for r in covering_rows)
