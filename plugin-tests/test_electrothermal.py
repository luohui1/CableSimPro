"""Real Gmsh/P1 study, independent full-space iteration and API evidence.

No skipped dependencies or substituted solver. Synthetic inputs are not field data.
"""
from pathlib import Path
from uuid import uuid4
from copy import deepcopy
import json
import os
import numpy as np
import pytest
from backend.schemas import Scenario
from backend.foundation.contracts import CircularRecipe,CircularLayer
from backend.plugins.buried import buried_mesh
from backend.plugins.electrothermal import ResponseModel, ElectrothermalError, electrothermal_reference, mesh_arguments
from backend.plugins.electrothermal_contract import ElectrothermalArgs, validate_electrothermal


def args(**changes):
    return ElectrothermalArgs.model_validate(dict(mode='ampacity',alpha20_per_k=.00393,conductor_k_w_m_k=380.,
        metal_screen_k_w_m_k=380.,coefficient_basis='Synthetic reference fixture; no manufacturer data',
        acknowledged_coefficient_model=True) | changes)


def recipe(s):
    r=s.cable.radii_mm();roles=('conductor','conductor_screen','insulation','insulation_screen','metallic_screen','jacket')
    return CircularRecipe(length_m=.25,layers=tuple(CircularLayer(uid=f'cable/{role}',role=role,
        inner_radius_m=0 if i==0 else r[i-1]/1000,outer_radius_m=r[i]/1000) for i,role in enumerate(roles))).model_dump(mode='json')


@pytest.fixture(scope='module')
def prepared(tmp_path_factory):
    s=Scenario();s.cable.r20_ohm_km=.0754
    before=Path.cwd()
    try:
        os.chdir(tmp_path_factory.mktemp('electrothermal-domain'))
        mesh=buried_mesh(recipe(s),s,mesh_arguments(args()))
    finally:os.chdir(before)
    return s,mesh


def test_real_inverse_brackets_the_hottest_conductor_and_conserves_all_losses(prepared):
    s,mesh=prepared;m=ResponseModel(mesh,s,args());state,bracket,trace=m.invert()
    field,summary,evidence=m.export_state(state,bracket)
    validate_electrothermal(field,summary,s,args())
    assert 500 < summary['ampacity_a'] < 560  # Regression fixture, not a certified engineering range.
    assert bracket['lower_max_temperature_c']<=90<bracket['upper_max_temperature_c']
    assert bracket['upper_a']-bracket['lower_a']<=.01
    assert summary['feedback_iterations']>1
    assert sum(summary['dielectric_losses_w_m'])>0
    assert summary['screen_losses_w_m']==pytest.approx(np.asarray(summary['conductor_losses_w_m'])*.05)
    assert summary['energy_relative_residual']<1e-6
    assert evidence['source_integrals']==pytest.approx([1]*9,abs=1e-12)
    assert field['values']==pytest.approx((state['rise']+298.15).tolist(),abs=1e-9)


def test_reduced_solution_matches_independent_full_space_picard_iteration(prepared):
    from scipy.sparse.linalg import splu
    s,mesh=prepared;m=ResponseModel(mesh,s,args(mode='operating-point'))
    direct=m.state(500)
    # Never use the three-by-three matrix or new state() inside this loop.
    solver=splu(m.matrix[m.free][:,m.free].tocsc())
    rise=np.zeros(m.basis.N)
    for _ in range(100):
        mean=25+m.sources[:,:3].T@rise
        r=.0754/1000*1.05*(1+.00393*(mean-20))
        pc=500**2*r
        source=m.sources@np.concatenate((pc,.05*pc,[m.wd]*3))
        next_rise=np.zeros(m.basis.N);next_rise[m.free]=solver.solve(source[m.free])
        if np.max(abs(next_rise-rise))<1e-9:break
        rise=next_rise
    else:pytest.fail('Independent Picard loop did not converge')
    assert direct['rise']==pytest.approx(next_rise,abs=1e-7)


def test_zero_alpha_matches_closed_form_current_and_feedback_lowers_rating(prepared):
    s,mesh=prepared;m=ResponseModel(mesh,s,args(alpha20_per_k=0.))
    # With alpha=0 every conductor source is I² R20ac; invert the per-node formula.
    candidates=[]
    u=m.effective.sum(axis=1)*m.r20ac_m
    for nodes in m.phase_nodes:
        candidates.extend(np.sqrt((90-25-m.base_rise[nodes])/u[nodes]))
    exact=float(min(candidates));state,_,_=m.invert()
    assert 0<=exact-state['current_a']<=.01
    coupled,_,_=ResponseModel(mesh,s,args()).invert()
    assert coupled['current_a']<state['current_a']


def test_unstable_current_and_unbracketed_search_fail(prepared):
    s,mesh=prepared;m=ResponseModel(mesh,s,args())
    with pytest.raises(ElectrothermalError,match='UNSTABLE'):m.state(100000)
    hot=m.state(800)
    with pytest.raises(ElectrothermalError,match='150_C'):
        m.export_state(hot)
    with pytest.raises(ElectrothermalError,match='NOT_BRACKETED'):
        ResponseModel(mesh,s,args(maximum_search_current_a=10.)).invert()


def test_no_current_is_not_no_dielectric_heat_and_no_losses_are_exact_zero(prepared):
    s,mesh=prepared;m=ResponseModel(mesh,s,args(mode='operating-point'));state=m.state(0)
    assert max(state['peaks'])>25
    copy=s.model_copy(deep=True);copy.cable.tan_delta=0;copy.operating_current_a=0
    zero=ResponseModel(mesh,copy,args(mode='operating-point'))
    field,summary,_=zero.export_state(zero.state(0))
    assert summary['ampacity_a'] is None and summary['energy_relative_residual'] is None
    assert summary['source_heat_w_m']==0
    assert field['values']==pytest.approx([298.15]*len(field['points']))


def test_zero_current_overheated_model_has_no_rating(prepared):
    s,mesh=prepared;copy=s.model_copy(deep=True)
    copy.cable.max_temperature_c=50;copy.installation.ambient_temperature_c=49.9
    copy.cable.tan_delta=.02;copy.cable.u0_kv=26
    with pytest.raises(ElectrothermalError,match='ZERO_CURRENT'):
        ResponseModel(mesh,copy,args()).invert()


@pytest.mark.parametrize('which',['mean','loss','bracket','dielectric','mode','geometry'])
def test_result_validation_rejects_changed_engineering_evidence(prepared,which):
    s,mesh=prepared;m=ResponseModel(mesh,s,args());state,b,_=m.invert();f,out,_=m.export_state(state,b)
    if which=='mean':out['conductor_mean_temperatures_c'][0]+=1
    if which=='loss':out['screen_losses_w_m'][0]=0
    if which=='bracket':out['bracket']['upper_max_temperature_c']=89
    if which=='dielectric':out['capacitance_f_m']*=2
    if which=='mode':out['mode']='operating-point'
    if which=='geometry':f['cable_centers_m'][0][0]+=.01
    with pytest.raises(ValueError):validate_electrothermal(f,out,s,args())


def test_larger_domain_comparison_retains_two_valid_solutions(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    s=Scenario();s.cable.r20_ohm_km=.0754
    a=args(compare_domain_scale=16)
    result=electrothermal_reference(recipe(s),s,a)
    summary=result['summary'];comparison=summary['domain_comparison']
    assert comparison['ampacity_a']<summary['ampacity_a']
    assert comparison['primary_current_max_temperature_c']>90
    assert abs(comparison['current_change_percent'])<1
    assert not comparison['infinite_domain_accuracy_certified']
    assert not comparison['mesh_independence_certified']
    field=json.loads(Path('field.json').read_text())
    validate_electrothermal(field,summary,s,a)
    other=json.loads(Path('comparison.json').read_text())
    validate_electrothermal(json.loads(Path('comparison-field.json').read_text()),other['summary'],s,args(domain_scale=16))
    import meshio
    vtu=meshio.read('temperature.vtu')
    assert vtu.point_data['temperature_c']+273.15==pytest.approx(field['values'],abs=1e-9)
    evidence=Path(__file__).resolve().parents[1]/'artifacts';evidence.mkdir(exist_ok=True)
    (evidence/'electrothermal-domain-comparison.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')


def test_actual_plugin_rejects_missing_r20_then_runs_saved_snapshot(tmp_path):
    from fastapi.testclient import TestClient
    from backend.main import create_app
    pid='cablesim.electrothermal-reference'
    with TestClient(create_app(tmp_path/'study.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json()
        p=c.post('/api/plugins/install-plan',json={'plugin_id':pid,'version':'0.1.0'}).json()
        approval={k:p[k] for k in ('plugin_id','version','plan_sha256','state_revision')} | {'approved':True,'license_acknowledged':True,'grants':{i['plugin_id']:i['permissions'] for i in p['plugins']}}
        assert c.post('/api/plugins/install',json=approval).status_code==200
        lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        enabled=c.post(f'/api/plugins/workspaces/{w["id"]}/enable',json={'plugin_id':pid,'expected_revision':1,'lock_revision':lock['lock']['lock_revision'],'enabled':True,'approved':True})
        assert enabled.status_code==200,enabled.text
        body=dict(plugin_id=pid,command='skfem.electrothermal-reference',request_id=str(uuid4()),expected_revision=1,lock_sha256=enabled.json()['lock_sha256'],arguments=args().model_dump(mode='json'),confirmed=True)
        url=f'/api/plugins/workspaces/{w["id"]}/invoke'
        r=c.post(url,json=body);assert r.status_code==422 and r.json()['detail']['code']=='ELECTROTHERMAL_INPUT'
        assert c.get(f'/api/plugins/workspaces/{w["id"]}/jobs').json()['items']==[]
        edit=c.post(f'/api/workspaces/{w["id"]}/edit',json={'expected_revision':1,'changes':[{'path':'cable.r20_ohm_km','value':.0754}]})
        assert edit.status_code==200,edit.text
        baseline=c.get(f'/api/workspaces/{w["id"]}').json()
        lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        body.update(expected_revision=2,lock_sha256=lock['lock_sha256'])
        result=c.post(url,json=body);assert result.status_code==200,result.text
        out=result.json();assert out['status']=='succeeded' and out['result']['summary']['ampacity_a']>0
        assert out['promoted_to_current_ampacity'] is False
        assert c.post(url,json=body).json()['replayed'] is True
        assert c.get(f'/api/workspaces/{w["id"]}').json()==baseline
        other=c.post('/api/workspaces',json={}).json()
        assert c.get(f'/api/plugins/workspaces/{other["id"]}/jobs/{out["job_id"]}/artifacts/field.json').status_code==404
