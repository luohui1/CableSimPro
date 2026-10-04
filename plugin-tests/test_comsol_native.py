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
