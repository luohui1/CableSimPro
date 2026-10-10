"""Replay/cancellation and stable source binding; no native calculations."""
import sys
from copy import deepcopy
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi import HTTPException

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.simulation/validation')]
from backend.kernel.batch_step_response import StepResponses,StepRequest
from cablesim_simulation.step_response import from_saved_run,StepInput
from step_response_case import case


def test_saved_reference_binding_preserves_input_and_rejects_changed_artifact():
    value,controls=case();runid=str(uuid4())
    run=dict(id=runid,integrity='verified',status='succeeded',output_digest='b'*64,
        snapshot={'definition':{'title':'保存参考','method':{'plugin_id':'cablesim.simulation','capability':'fem-step-response','version':'1.3.0'}},'cases':[{'case_id':'one','input':value,'parameters':controls}]},
        output={'cases':[{'case_id':'one','status':'succeeded','artifact_digests':{'x-cablesim.simulation-bundle':'a'*64},
                         'artifacts':{'x-cablesim.simulation-bundle':{'step_response':{'schema':'cablesim.fem-step-reference/1','input':deepcopy(value),'steady_joule_rise_k':5.}}}}]})
    before=deepcopy(run);bound=from_saved_run(run);assert bound['saved_source']['run_id']==runid and run==before
    StepInput.model_validate(bound)
    run['output']['cases'][0]['artifacts']['x-cablesim.simulation-bundle']['step_response']['input']['reference_current_a']=401
    with pytest.raises(ValueError,match='输入与保存'):from_saved_run(run)
    run['integrity']='failed'
    with pytest.raises(ValueError,match='完整性'):from_saved_run(run)


def test_response_request_replay_budget_and_cancel_intent(tmp_path,monkeypatch):
    from test_hpc_convergence import service
    original,run,jobs=service(tmp_path,monkeypatch);manager=StepResponses(original.research)
    method=run['snapshot']['definition']['method'];value,controls=case()
    monkeypatch.setattr(manager,'prepared',lambda *args:(run,value,controls,method,2.))
    request=StepRequest(request_id=uuid4(),source_run_id=run['id'],budget_confirmed=True)
    first=manager.start(run['workspace'],run['study'],request)
    assert manager.start(run['workspace'],run['study'],request)['id']==first['id'] and len(jobs)==1
    with pytest.raises(HTTPException) as error:manager.start(run['workspace'],run['study'],request.model_copy(update={'max_core_hours':20.}))
    assert error.value.status_code==409
    with pytest.raises(HTTPException):manager.start(run['workspace'],run['study'],request.model_copy(update={'budget_confirmed':False}))
    cancelled=manager.cancel(first['id']);assert cancelled['cancel_requested']
    restarted=StepResponses(manager.research);restarted.research.owner_epoch='different-process'
    assert restarted.load(first['id'])['status']=='interrupted'


@pytest.mark.parametrize('output',[{}, {'cases':{}}, {'cases':[{'artifacts':'invalid'}]}, {'cases':[{'artifacts':{}}]}, {'cases':[{'artifacts':{'x-cablesim.simulation-bundle':{'step_response':{}}}}]}])
def test_missing_response_artifact_is_controlled_error(output,monkeypatch):
    from types import SimpleNamespace
    run={'integrity':'verified','status':'succeeded','output':output}
    manager=StepResponses(SimpleNamespace(store=None,get_run=lambda *args:run))
    monkeypatch.setattr(manager,'load',lambda *args:{'workspace':'workspace','run_id':'saved-run'})
    with pytest.raises(HTTPException,match='原运行保留') as error:manager.result('request')
    assert error.value.status_code==409 and run['output']==output
