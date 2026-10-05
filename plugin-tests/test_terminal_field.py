"""Sealed solver dispatch retains the analytic vacuum-capacitance reference."""
import json
from hashlib import sha256
import numpy as np
import pytest
from backend.plugin_host import Executor
from test_triangular_fields import rectangle


def test_terminal_field_runs_through_sealed_plugin_host(tmp_path):
    p,t=rectangle();ids=np.where(p[t].mean(axis=1)[:,0]<1.8,1,2)
    mesh={'length_unit':'m','points':p.tolist(),'triangles':t.tolist(),'domain_ids':ids.tolist()}
    mesh['source']={'reference':'Manufactured rectangular dielectric and equipotential right terminal','sha256':sha256(json.dumps(mesh,sort_keys=True).encode()).hexdigest()}
    value={'schema_version':'cablesim.terminal-field/1','mesh':mesh,'frequency_hz':50.,
           'materials':{str(i):{'conductivity_s_m':0.,'relative_permittivity':1.,'source':'Vacuum reference'} for i in (1,2)},
           'terminals':[{'id':'right','domain_ids':[2]}],'ground_nodes':np.flatnonzero(p[:,0]==0).tolist(),'boundary_source':'x=0 ground; right terminal1V'}
    run=Executor(jobs_root=tmp_path).run('cablesim.simulation','terminal-field',[{'case_id':'plate','input':value,'parameters':{}}])
    case=run.cases[0];assert case.status=='succeeded',case.error
    assert case.results[0]['value']==pytest.approx(8.8541878128e-12/1.8,rel=1e-10)
    assert case.artifact_digests['x-cablesim.simulation-bundle']
    value['materials']['1']['relative_permittivity']=float('nan')
    with pytest.raises(ValueError):
        Executor(jobs_root=tmp_path).run('cablesim.simulation','terminal-field',[{'case_id':'bad','input':value,'parameters':{}}])
