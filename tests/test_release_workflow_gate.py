"""The release gate must fail closed without changing its seeded inputs."""
from copy import deepcopy
from pathlib import Path
import pytest

from scripts.verify_release_workflows import AREAS, Gate, GateFailure, identity, real_candidates, isolated_environment, observe_runtime


def candidate(area, source='manufacturer'):
    return {'id':str(area),'state':'incomplete','payload':{'name':f'YJV22-8.7/15 kV 3×{area}',
        'specification':{'designation':'YJV22','u0_v':8700,'cores':3,'area_m2':area*1e-6},
        'sources':{'factory':{'kind':source,'reference':'unit fixture only'}}}}


def test_missing_real_candidates_is_a_release_failure_not_a_synthetic_fallback():
    with pytest.raises(GateFailure) as failure:real_candidates([])
    assert failure.value.detail['code']=='RELEASE_CANDIDATES_MISSING'
    assert failure.value.detail['missing_areas_mm2']==list(AREAS)
    catalogue=[candidate(area) for area in AREAS];before=deepcopy(catalogue)
    assert [identity(c)[3] for c in real_candidates(catalogue)]==list(AREAS)
    assert catalogue==before
    catalogue[-1]['payload']['sources']['factory']['kind']='demo'
    with pytest.raises(GateFailure) as failure:real_candidates(catalogue)
    assert failure.value.detail['code']=='RELEASE_MANUFACTURER_SOURCE_MISSING'


def test_completed_workspace_model_cannot_extend_or_replace_the_manufacturer_series():
    catalogue=[candidate(area) for area in AREAS]
    completed=deepcopy(candidate(300));completed['id']='prepared-workspace-model'
    completed['payload'].pop('specification')
    completed['payload']['cable_type']={'rating':{'u0':8700},'cores':[
        {'conductor':{'nominal_area':.0003}} for _ in range(3)]}
    assert identity(completed)==identity(candidate(300))
    before=deepcopy(catalogue+[completed])
    assert [row['id'] for row in real_candidates(catalogue+[completed])]==[str(area) for area in AREAS]
    assert catalogue+[completed]==before
    with pytest.raises(GateFailure) as failure:
        real_candidates([row for row in catalogue if row['id']!='300']+[completed])
    assert failure.value.detail['missing_areas_mm2']==[300]


def test_stop_on_first_failed_api_and_record_failure_owner(tmp_path):
    class Response:
        status_code=409;is_success=False;text='stale input'
    class Client:
        def request(self,*args,**kwargs):return Response()
    gate=Gate(tmp_path);gate.client=Client();gate.phase='inquiry'
    with pytest.raises(GateFailure):gate.api('POST','/api/example',{},owner='研究线程')
    assert len(gate.result['steps'])==1
    assert gate.result['steps'][0]['http_status']==409
    assert gate.result['steps'][0]['failure']['owner']=='研究线程'
    assert gate.result['steps'][0]['elapsed_s']>=0
    assert gate.result['workflows']['sweep']['status']=='not_run'


def test_isolated_environment_restores_existing_development_paths(tmp_path,monkeypatch):
    import os
    monkeypatch.setenv('CABLESIM_DB','untouched-development.sqlite')
    monkeypatch.delenv('CABLESIM_DATASETS_DIR',raising=False)
    with isolated_environment(tmp_path) as paths:
        assert Path(os.environ['CABLESIM_DB'])==tmp_path/'engineering.sqlite'
        assert all(value.is_relative_to(tmp_path) for value in paths.values())
    assert os.environ['CABLESIM_DB']=='untouched-development.sqlite'
    assert 'CABLESIM_DATASETS_DIR' not in os.environ


def test_observer_preserves_results_exceptions_and_restores_method(monkeypatch):
    from backend.kernel.research import Research
    token=object()
    def original(self, method, cache=None):
        if method=='bad':raise ValueError('original failure')
        return token
    monkeypatch.setattr(Research,'resolve',original)
    events=[]
    with observe_runtime(events,lambda:'test preflight'):
        assert Research.resolve(None,'valid') is token
        with pytest.raises(ValueError,match='original failure'):Research.resolve(None,'bad')
    assert Research.resolve is original
    assert len(events)==2 and all(e['stage']=='Research.resolve' and e['elapsed_s']>=e['self_s']>=0 for e in events)
