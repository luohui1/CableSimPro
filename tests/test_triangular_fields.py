"""Manufactured fields verify the new full-domain assembly independently."""
from pathlib import Path
import sys
import numpy as np
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'plugins/cablesim.simulation/src'))
from cablesim_simulation.triangular_fields import terminal_admittance,contact_thermal,floating_admittance
from backend.plugin_host import Executor
from hashlib import sha256
import json


def rectangle(nx=20,ny=4):
    p=np.array([(2*i/nx,j/ny) for i in range(nx+1) for j in range(ny+1)])
    t=[]
    for i in range(nx):
        for j in range(ny):
            a=i*(ny+1)+j;b=a+ny+1;t.extend([[a,b,b+1],[a,b+1,a+1]])
    return p,np.array(t)


def test_complex_parallel_plate_field_has_exact_capacitance_and_conductance():
    p,t=rectangle();gamma=2e-6+3e-8j
    result=terminal_admittance(p,t,np.full(len(t),gamma),[np.flatnonzero(p[:,0]==2)],np.flatnonzero(p[:,0]==0))
    assert result['admittance'][0,0]==pytest.approx(gamma/2,rel=1e-11)
    assert result['potential'][:,0].real==pytest.approx(p[:,0]/2,abs=1e-12)
    assert result['residual']<1e-12


def test_thin_contact_preserves_temperature_jump_and_heat_balance():
    p,t=rectangle(80,20);ids=np.where(p[t].mean(axis=1)[:,0]<1,1,2)
    nodes=np.flatnonzero(p[:,0]==1);contacts=np.array(list(zip(nodes[:-1],nodes[1:])))
    result=contact_thermal(p,t,ids,lambda d,T:np.ones(len(d)),(ids==1).astype(float),contacts,.5,np.flatnonzero(p[:,0]==2),300.)
    assert result['maximum_k']==pytest.approx(303.5,abs=.001)
    assert result['maximum_contact_jump_k']==pytest.approx(2.,abs=.001)
    assert result['heat_w_m']==pytest.approx(1.)
    assert result['relative_energy_error']<1e-10
    assert all(c['domain_a']!=c['domain_b'] and {c['domain_a'],c['domain_b']}=={1,2} for c in result['contacts'])
    assert abs(sum(c['heat_a_to_b_w_m'] for c in result['contacts']))==pytest.approx(1.,abs=1e-8)


def test_contact_rejects_external_edge_and_negative_conductance():
    p,t=rectangle();ids=np.where(p[t].mean(axis=1)[:,0]<1,1,2)
    with pytest.raises(ValueError,match='two domains'):
        contact_thermal(p,t,ids,lambda d,T:np.ones(len(d)),np.zeros(len(t)),[[0,1]],.5,np.flatnonzero(p[:,0]==2),300.)
    nodes=np.flatnonzero(p[:,0]==1);contacts=np.array(list(zip(nodes[:-1],nodes[1:])))
    with pytest.raises(ValueError,match='conductance'):
        contact_thermal(p,t,ids,lambda d,T:np.ones(len(d)),np.zeros(len(t)),contacts,-.5,np.flatnonzero(p[:,0]==2),300.)
    with pytest.raises(ValueError,match='contact-side'):
        contact_thermal(p,t,ids,lambda d,T:np.ones(len(d)),np.zeros(len(t)),contacts,.5,nodes,300.)


def test_floating_terminal_matches_series_capacitor_network():
    indices,Y=floating_admittance(1j*np.array([[2.,-1.],[-1.,2.]]),[1])
    assert indices.tolist()==[0]
    assert Y[0,0]==pytest.approx(1.5j)
    with pytest.raises(ValueError,match='singular'):
        floating_admittance(np.array([[1j,0],[0,0]]),[1])


def test_zero_heat_keeps_uniform_ambient_without_roundoff_refusal():
    p,t=rectangle();ids=np.where(p[t].mean(axis=1)[:,0]<1,1,2)
    nodes=np.flatnonzero(p[:,0]==1);contacts=np.array(list(zip(nodes[:-1],nodes[1:])))
    result=contact_thermal(p,t,ids,lambda d,T:np.ones(len(d)),np.zeros(len(t)),contacts,.5,np.flatnonzero(p[:,0]==2),300.)
    assert np.array_equal(result['temperature_k'],np.full(result['thermal_nodes'],300.))
    assert result['heat_w_m']==result['boundary_heat_w_m']==result['relative_energy_error']==result['linear_residual']==0
    assert result['maximum_contact_jump_k']==0


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
        # JSON dispatch must refuse nonfinite input before a solver process.
        Executor(jobs_root=tmp_path).run('cablesim.simulation','terminal-field',[{'case_id':'bad','input':value,'parameters':{}}])
