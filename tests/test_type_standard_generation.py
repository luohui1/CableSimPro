"""Evidence-backed generation and Annex arithmetic; no native solver or demo writes."""
import importlib.util
from pathlib import Path
from decimal import Decimal
from uuid import uuid4
from copy import deepcopy
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('standard_generation_method',ROOT/'plugins/cablesim.standard-check/src/cablesim_standard_check/main.py')
method = importlib.util.module_from_spec(spec);spec.loader.exec_module(method)
from cablesim_standard_check.annex import DiameterChain, MissingBasis, round_value


def rounding_record():
    # Independently read GB/T12706.3—2020 B.1, printed36/PDF41.
    # Arithmetic-only unit fixture, deliberately not a library/Executor receipt.
    # This must never be used to bypass the runtime evidence() seal gate.
    return {'value':{'increment':.1,'mode':'half_up','unit':'mm'},
            'citation':'GB/T 12706.3—2020 B.1，第 36 页（PDF 第 41 页）'}


def test_annex_b_original_examples_direct_rounding_not_double_rounding():
    # B.1 original examples: 2.449 -> 2.4; 30.050 ->30.1.
    # Rounding 2.449 first to2.45 then2.5 would be wrong.
    assert round_value(Decimal('2.449'),rounding_record())==Decimal('2.4')
    assert round_value(Decimal('30.050'),rounding_record())==Decimal('30.1')
    with pytest.raises(MissingBasis):round_value(2.75,{'value':{'increment':.1,'rule':'annex-B','execution_status':'not_implemented'}})
    with pytest.raises(ValueError):round_value(-1,rounding_record())


def test_annex_a_35kv_400_core_hand_calculation():
    # 26/35kV 1x400: .3 A.1 printed32/PDF37 gives22.6mm;
    # insulation table6 gives10.5mm; A.2.2 printed33/PDF38:
    # Dc=22.6+2*10.5+3.0=46.6mm. This is NOT physical diameter.
    chain=DiameterChain(rounding_record())
    record={'value':{'kind':'core_diameter','insulation_multiplier':2,'screen_increment_mm':3},
            'citation':'GB/T 12706.3—2020 A.2.2，第 33 页（PDF 第 38 页）'}
    assert chain.core(Decimal('22.6'),Decimal('10.5'),record)==Decimal('46.6')
    assert chain.steps[0]['raw_value']=='46.6' and chain.steps[0]['rounded_value']==46.6
    assert chain.steps[0]['rounding']['record']['citation'].endswith('PDF 第 41 页）')


def test_affine_oversheath_hand_calculation_and_floor():
    # .3 14.3 single-core: at hypothetical pre-sheath D=50.0mm,
    # 0.035*50+1=2.750 -> B.1 2.8mm; atD=5.0,1.175->1.2,
    # then single-core1.4mm minimum controls. No manufacturing claim.
    chain=DiameterChain(rounding_record())
    record={'value':{'kind':'affine','x':'diameter','a':.035,'b':1,'floor':1.4,
            'parameter_units':{'a':'1','b':'mm','diameter':'mm','result':'mm'}},
            'quantity':{'name':'外护套标称厚度'},'citation':'GB/T 12706.3—2020 14.3，第 11 页（PDF 第 16 页）'}
    assert chain.thickness(Decimal('50.0'),record)==Decimal('2.8')
    assert chain.thickness(Decimal('5.0'),record)==Decimal('1.4')
    assert chain.steps[-1]['floor_applied'] is True
    record['value']['parameter_units']['diameter']='m'
    with pytest.raises(MissingBasis):chain.thickness(Decimal('50.0'),record)


@pytest.fixture
def client(tmp_path):
    from fastapi.testclient import TestClient
    from backend.main import create_app
    with TestClient(create_app(tmp_path/'standard-generation.sqlite')) as client:
        yield client


@pytest.mark.parametrize('voltage,area,construction,thickness,page',[
    ('8700/15000',300e-6,'three_core',.0045,7),
    ('600/1000',95e-6,'single_core',.0011,6),
    ('26000/35000',400e-6,'single_core',.0105,6),
])
def test_live_basis_dimensions_and_complete_generation_refuses_missing_annex(client,voltage,area,construction,thickness,page):
    values={'schema_version':'cablesim.cable-design-request/1','construction':construction,
            'voltage':voltage,'conductor':'copper_bare','area_m2':area,'form':'solid_round',
            **({'gap_m':0} if construction=='three_core' else {})}
    result=client.post('/api/types/creation-proposals',json={'request_id':str(uuid4()),'input':values})
    assert result.status_code==200,result.text
    proposal=result.json();row=proposal['rows'][0]
    assert row['value']==pytest.approx(thickness)
    ref=row['source'];assert ref['schema']=='cablesim.standard-basis-ref/1'
    assert ref['record']['verification']['status']=='verified'
    assert ref['printed_page']==page and ref['pdf_page']>page and ref['artifact_digest']
    from cablesim_standard_check.annex import evidence
    edited=deepcopy(ref);edited['record']['value']+=.1
    with pytest.raises(ValueError,match='摘要'):evidence(edited,ref['query'])
    blocked=client.post('/api/types/creation-proposals',json={'request_id':str(uuid4()),'input':{**values,'generation_mode':'complete'}})
    assert blocked.status_code==422,blocked.text
    assert '本库' in blocked.text or '缺少' in blocked.text
    assert client.get('/api/design/type-workspaces').json()==[]


def test_four_core_not_extrapolated_and_missing_receipt_rejected(client):
    values={'schema_version':'cablesim.cable-design-request/1','construction':'four_core',
            'voltage':'600/1000','conductor':'copper_bare','area_m2':95e-6,'form':'solid_round'}
    response=client.post('/api/types/creation-proposals',json={'request_id':str(uuid4()),'input':values})
    assert response.status_code==422,response.text
    from cablesim_standard_check.annex import evidence
    with pytest.raises(MissingBasis):evidence(None,{'standard':'GB/T 12706.1','edition':'2020','locator':'B.1'})


def test_missing_basis_installation_is_actionable_without_creating_draft():
    from types import SimpleNamespace
    from fastapi import HTTPException
    from backend.kernel.requirements import lookup_references
    research=SimpleNamespace(registry=lambda:SimpleNamespace(plugins={}))
    with pytest.raises(HTTPException) as error:lookup_references(research,{'insulation':{}})
    assert error.value.status_code==503
    assert error.value.detail['code']=='BASIS_UNAVAILABLE'
    assert '安装' in error.value.detail['message']


def test_35kv_requirement_query_uses_its_own_insulation_table(client):
    """Save a complete 26/35 kV input, then resolve its criterion via real Executor."""
    import json
    from backend.kernel.scenarios import system_models
    from backend.kernel.type_versions import structure_context
    from backend.domain.models import DomainDocument
    from test_standard_check import example
    model=next(m for m in system_models() if m['id']=='system.cu-xlpe-al-400')
    created=client.post('/api/design/type-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']})
    assert created.status_code==201,created.text
    workspace=created.json();document=example(26000,35000,False,400)
    document.update(circuits=[],sections=[],load_cases=[]);structure_context(document)
    document['provenance']['/execution_standards']={'kind':'standard','reviewed':True,'reference':json.dumps({'schema':'cablesim.execution-standards/1','items':[{'standard':method.SOURCES[key]['standard'],'source_digest':method.SOURCES[key]['sha256']} for key in ('mv3','conductor')]})}
    saved=client.put('/api/workspaces/'+workspace['id']+'/domain',json={'expected_revision':workspace['revision'],'document':DomainDocument.model_validate(document).model_dump(mode='json')})
    assert saved.status_code==200,saved.text
    answer=client.post('/api/design/type-workspaces/'+workspace['id']+'/requirements/basis',json={'request_id':str(uuid4()),'expected_revision':saved.json()['revision']})
    assert answer.status_code==200,answer.text
    reference=next(ref for ref in answer.json()['parameters']['basis_references'].values() if ref['record']['quantity']['key']=='insulation_nominal')
    query=reference['query']
    assert (query['standard'],query['edition'],query['locator'])==('GB/T 12706.3','2020','表 6')
    assert (reference['record']['value'],reference['record']['printed_page'])==(10.5,6)
