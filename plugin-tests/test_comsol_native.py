"""Licensed native COMSOL reference, explicitly skipped when not installed."""
from dataclasses import asdict
from pathlib import Path
from math import pi,log
import json,sys
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.comsol-bridge/src'))
from cablesim_comsol_bridge.runtime import resolve,EnvironmentMissing
from backend.plugin_host import Executor


def test_native_comsol_heat_matches_layered_cylinder(tmp_path):
    try:resolve()
    except EnvironmentMissing as exc:pytest.skip(str(exc))
    source='Analytic steady radial conduction; independent hand calculation, no IEC attribution'
    value={'schema_version':'cablesim.simulation-problem/1','physics':'steady_heat',
           'geometry':[{'uid':'insulation','kind':'disk','values':[0,0,.1],'material':{'k_w_m_k':.2,'source':source}},
                       {'uid':'conductor','kind':'disk','values':[0,0,.01],'material':{'k_w_m_k':1.,'source':source}}],
           'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'temperature','value':300}],
           'excitations':[{'regions':['conductor'],'kind':'heat_w_m','value':[100],'source':source}],
           'probes_m':[],'provenance':{'all':{'source':source}},'assumptions':['Constant isotropic properties; perfect internal thermal contact']}
    exact=300+100/(4*pi)+100/(2*pi*.2)*log(10)
    ref={'citation':{'title':source},'targets':[{'id':'maximum','quantity':'maximum_temperature_k','entity':'field','time_s':0.,'unit':'K','reference':exact,'tolerance':{'absolute':.1,'source':'Predeclared 0.1 K quadratic discretization allowance'},'source':source}]}
    result=Executor(jobs_root=tmp_path).run('cablesim.comsol-bridge','thermal-reference',[{'case_id':'radial','input':value,'parameters':{'mesh':{'size_m':.001,'far_size_m':.01,'transition_m':.03},'reproduction':ref}}])
    path=ROOT/'.data/simulation/comsol-comparison/thermal-analytic.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(asdict(result),ensure_ascii=False,separators=(',',':')),'utf-8')
    case=result.cases[0];assert case.status=='succeeded',case.error
    assert case.artifacts['x-cablesim.reproduction-report']['status']=='matched'
    bundle=case.artifacts['x-cablesim.simulation-bundle'];solver=bundle['result']['solver']
    assert solver['name']=='comsol' and solver['version'].startswith('6.2.')
    assert solver['modules']=={'COMSOL':True,'HEATTRANSFER':True}
    assert len(solver['model_sha256'])==64
    assert not list(tmp_path.rglob('*.mph'))


def test_native_electrothermal_uses_requested_frequency_and_feedback(tmp_path):
    try:resolve()
    except EnvironmentMissing as exc:pytest.skip(str(exc))
    d=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/electrothermal-coaxial.json').read_text('utf-8'))
    d['parameters']['mesh']['minimum_circle_segments']=8
    run=Executor(jobs_root=tmp_path).run('cablesim.comsol-bridge','electrothermal-reference',[
        dict(case_id='coupled',input=d['input'],parameters=d['parameters'])])
    case=run.cases[0];assert case.status=='succeeded',case.error
    result=case.artifacts['x-cablesim.simulation-bundle']['result']
    assert result['maximum_temperature_k']==pytest.approx(298.826,abs=.02)
    assert result['source_heat_w_m']==pytest.approx(14.6894,rel=.002)
    assert result['solver']['modules']=={'COMSOL':True,'ACDC':True,'HEATTRANSFER':True}
    assert result['actual_frequency_hz']==50
    assert not list(tmp_path.rglob('*.mph'))


def test_native_coupled_total_includes_nonconducting_magnetic_losses(tmp_path):
    try:resolve()
    except EnvironmentMissing as exc:pytest.skip(str(exc))
    d=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/electrothermal-coaxial.json').read_text('utf-8'))
    d['parameters']['mesh']['minimum_circle_segments']=8
    d['input']['magnetic']['geometry'][0]['material'].update(relative_permeability=2,relative_permeability_loss=.1)
    run=Executor(jobs_root=tmp_path).run('cablesim.comsol-bridge','electrothermal-reference',[
        dict(case_id='magnetic-heat',input=d['input'],parameters=d['parameters'])])
    case=run.cases[0];assert case.status=='succeeded',case.error
    r=case.artifacts['x-cablesim.simulation-bundle']['result']
    magnetic=next(row['heat_source_w_m'] for row in r['region_temperatures'] if row['entity']=='insulation')
    exact=2*pi*50*4*pi*1e-7*.1*655**2/(2*pi)*log(.04/.0131)
    assert magnetic==pytest.approx(exact,rel=.002)
    assert r['source_heat_w_m']==pytest.approx(sum(row['heat_source_w_m'] for row in r['region_temperatures']),rel=1e-12)
    assert r['source_heat_w_m']>sum(row['joule_loss_w_m'] for row in r['regions'])+1


def test_native_transient_heat_real_times_match_fourier(tmp_path):
    try:resolve()
    except EnvironmentMissing as exc:pytest.skip(str(exc))
    import numpy as np
    d=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/heat-step-cycle.json').read_text('utf-8'))
    d['input']['excitations'][0]['schedule']=[[0,1]]
    run=Executor(jobs_root=tmp_path).run('cablesim.comsol-bridge','thermal-reference',[
        dict(case_id='step',input=d['input'],parameters=d['parameters'])])
    c=run.cases[0];assert c.status=='succeeded',c.error
    b=c.artifacts['x-cablesim.simulation-bundle'];probes=[o for o in b['observations'] if o['quantity']=='probe_temperature_k']
    n=np.arange(1,2000,2,dtype=float)
    def exact(t):return 293.15+float(np.sum(4*1e5*.02**2/(.2*np.pi**3*n**3)*np.sin(n*np.pi/2)*(1-np.exp(-.2/2e6*(n*np.pi/.02)**2*t))))
    assert probes[0]['time_s']==0 and probes[-1]['time_s']==4000
    assert max(abs(o['value']-exact(o['time_s'])) for o in probes)<.25
    assert len(probes)==len(b['result']['snapshots'])
