"""Controlled source mapping and metal constraint hand checks; native on dg83."""
import json
import os
from pathlib import Path
import sys
import numpy as np
import pytest

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/validation'),str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src')]
from tb880_fem import inputs,isothermal_projection


@pytest.mark.parametrize('name',['tb880-buried','tb880-ducts'])
def test_report_values_do_not_enter_solver_input(name):
    fixture=json.loads((ROOT/'plugins/cablesim.simulation/validation/cases'/f'{name}.json').read_text('utf-8'))
    first=inputs(fixture)
    fixture['expected']['ampacityA']=999999.
    assert inputs(fixture)==first
    d,p=first
    assert d['cable_types'][0]['cores'][0]['conductor']['r20']==2.83e-5
    assert d['cable_types'][0]['rating']['u0']==pytest.approx(132000/np.sqrt(3))
    assert sum(q['z'] for q in d['sections'][0]['placements'])/3==-1.
    metals=[m for m in d['materials'] if m['id'] in ('material/cu','material/al-sheath')]
    assert all(m['thermal_resistivity'] is None for m in metals)


def test_isothermal_metal_constraint_matches_hand_heat_balance():
    from scipy.sparse import csr_matrix
    # Perfect metal between 0/1; one 1 K m/W resistance from 1 to bath 2.
    # q=4 W/m implies metal rise=4 K, and bath reaction=-4 W/m.
    P,_=isothermal_projection(3,[np.array([0,1])])
    for unused_metal_conductance in (1.,1.e8):
        k=unused_metal_conductance
        K=csr_matrix([[k,-k,0],[-k,k+1,-1],[0,-1,1]])
        matrix=(P.T@K@P).toarray();load=np.asarray(P.T@np.array([4.,0.,0.])).ravel()
        rise=np.array([load[0]/matrix[0,0],0.]);full=np.asarray(P@rise).ravel()
        assert full.tolist()==[4.,4.,0.]
        assert (matrix@rise-load)[1]==-4.


@pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='Native FEM runs only on dg83')
def test_isothermal_conductor_annulus_against_analytic_resistance():
    from cablesim_simulation.thermal_input import ThermalModel,Controls
    from cablesim_simulation.thermal import ThermalSystem
    from skfem import BilinearForm,asm
    from skfem.helpers import dot,grad
    from scipy.sparse.linalg import spsolve
    boundary=dict(kind='temperature',temperature_k=293.15,h_w_m2_k=None,emissivity=None)
    model=ThermalModel.model_validate(dict(schema_version='cablesim.thermal-model/1',
        cables=[dict(uid='c',circuit='circuit',x_m=0.,z_m=0.,current_a=0.,electrical=None,duct=None,
            prescribed_core_temperature_k=None,temperature_limit_k=363.15,
            layers=[dict(uid='core',role='conductor',outer_radius_m=.1,k_w_m_k=1.,fixed_heat_w_m=0.),
                    dict(uid='annulus',role='insulation',outer_radius_m=.4,k_w_m_k=1.,fixed_heat_w_m=0.)])],
        environment=dict(kind='isolated_cables',background=None,soil_layers=[],backfills=[],boundaries={'surface':boundary}),
        provenance={'source':{'reference':'IEC 60287-2-1:2023 4.1.2 cylindrical resistance; q ln(ro/ri)/(2 pi k)'}},assumptions=[]))
    answers=[];exact=20*np.log(4)/(2*np.pi)
    for size in (.02,.01,.005):
        controls=Controls.model_validate(dict(operation='temperature',element_order=2,mesh_size_m=size,far_mesh_size_m=size,
            mesh_transition_m=1.,max_nodes=100000,tolerance_k=1e-5,max_iterations=100,relaxation=.8,
            current_upper_a=1000.,current_tolerance_a=.01,rated_circuit=None))
        s=ThermalSystem(model,controls);P,inverse=isothermal_projection(s.basis.N,[s.nodes['core']])
        @BilinearForm
        def conduction(u,v,w):return w.k*dot(grad(u),grad(v))
        rid=next(r['id'] for r in s.regions if r['uid']=='core')
        metal=asm(conduction,s.basis,k=(s.ids.reshape(-1,4)[:,0]==rid)[:,None].astype(float))
        matrix=P.T@(s.K-metal)@P
        load=P.T@(20*s.weights['core']/s.weights['core'].sum())
        D=np.unique(inverse[np.array(sorted(s.dirichlet),dtype=int)]);free=np.setdiff1d(np.arange(P.shape[1]),D)
        rise=np.zeros(P.shape[1]);rise[free]=spsolve(matrix[free][:,free],load[free])
        answer=float((P@rise)[s.nodes['core'][0]]);answers.append(answer)
    errors=[abs(value-exact) for value in answers]
    print({'analytic_rise_k':exact,'fem_rises_k':answers,'errors_k':errors})
    assert errors[-1]<errors[-2]<errors[0] and errors[-1]<.01
