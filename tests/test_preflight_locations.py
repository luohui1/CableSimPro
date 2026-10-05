"""Field locations survive validation, plugin acceptance and the public API."""
from copy import deepcopy
from types import SimpleNamespace
import pytest
from pydantic import ValidationError
from cablesim_sdk.validation import validation_error
from cablesim_sdk.domain import DomainDocument
from backend.kernel.research import Research
from backend.plugin_host import Executor
from test_design_studies import client,workspace,saved_study


def test_root_domain_validation_keeps_escaped_current_key(client):
    w=workspace(client);document=deepcopy(w['domain'])
    key=next(iter(document['load_cases'][0]['currents']))
    document['load_cases'][0]['currents'][key]=-1
    with pytest.raises(ValidationError) as caught:DomainDocument.model_validate(document)
    error=validation_error(caught.value,'DOMAIN_INVALID')
    assert error['path']=='/load_cases/0/currents/'+key.replace('~','~0').replace('/','~1')
    service=Research.__new__(Research)
    result=service.check_cases(None,None,[{'case_id':'bad','input':document}])[0]
    assert result.error['path']==error['path'] and result.error['issues'][0]['path']==error['path']


def test_iec_parameter_field_reaches_public_preflight(client):
    w=workspace(client)
    parameters=deepcopy(w['study_cable_reference']['method_defaults']['cablesim.iec60287'])
    parameters['rating_mode']='invalid'
    s=saved_study(client,w,'cablesim.iec60287',parameters=parameters)
    response=client.get(f"/api/workspaces/{w['id']}/studies/{s['id']}/preflight",params={'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert response.status_code==200,response.text
    assert response.json()['cases'][0]['error']['path']=='/parameters/rating_mode'
    assert not response.json()['ready']


def test_iec_model_validator_field_survives_worker(tmp_path):
    from cablesim_iec60287.inputs import Bonding
    with pytest.raises(ValidationError) as caught:Bonding(scheme='single_point',eddy='ignored')
    assert validation_error(caught.value)['path']=='/eddy'
    from cablesim_iec60287.engineering_contract import EngineeringParameters
    with pytest.raises(ValidationError) as caught:EngineeringParameters(values={})
    errors=validation_error(caught.value,prefix=('parameters',))
    assert '/parameters/values/core_lay_length' in {i['path'] for i in errors['issues']}
    assert len(errors['issues'])>=6


def test_domain_reference_path_is_exact(client):
    document=deepcopy(workspace(client)['domain'])
    document['cable_types'][0]['cores'][0]['conductor']['material']='missing'
    with pytest.raises(ValidationError) as caught:DomainDocument.model_validate(document)
    assert validation_error(caught.value)['path']=='/cable_types/0/cores/0/conductor/material'


@pytest.mark.parametrize('parameters,path',[
    ({'t4_form':'simplified'},'/parameters/t4_form'),
    ({'reference_basis':'tb880_reference'},'/parameters/reference_basis'),
    ({},'/parameters/per_cable_losses'),
])
def test_group_applicability_fields(parameters,path,client):
    from cablesim_iec60287.group_inputs import prepare_group
    from cablesim_iec60287.electrical import RatingRefused
    document=deepcopy(workspace(client)['domain'])
    document['circuits'].append(deepcopy(document['circuits'][0]))
    with pytest.raises(RatingRefused) as caught:prepare_group(document,parameters)
    assert caught.value.path==path


def test_soil_geometry_location_uses_original_placement_order():
    from cablesim_iec60287.soil import resistance_matrix
    from cablesim_iec60287.electrical import RatingRefused
    with pytest.raises(RatingRefused) as caught:
        resistance_matrix([(0,-11)],[.05],1.,source_paths=['/sections/0/placements/4'])
    assert caught.value.path=='/sections/0/placements/4/z'
    with pytest.raises(RatingRefused) as caught:
        resistance_matrix([(0,-1)],[.05],1.,{'x':3,'z':-1,'width':1,'height':1,'rho':1})
    assert caught.value.path=='/sections/0/backfill'
