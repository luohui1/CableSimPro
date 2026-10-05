"""Fresh solver regressions for the accepted E17/E19 and C02/C04/C06 cases.

The six TB880 cases and C03 retain their existing tests. Every input here is
built from cited numeric fixtures/source geometry. No saved mesh, field, heat
source or previous run is read as a substitute for a new calculation.
"""
from pathlib import Path
import json,sys
import numpy as np
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/validation'),str(ROOT/'plugins/cablesim.simulation/src'),
              str(ROOT/'plugins/cablesim.comsol-bridge/validation')]
from backend.plugin_host import Executor
from cablesim_simulation.solver_runtime import environment,EnvironmentMissing
from submarine_geometry import build


def getdp(tmp_path):
    try:environment('getdp',tmp_path)
    except EnvironmentMissing as exc:pytest.skip(str(exc))


def run(tmp_path,capability,value,parameters=None):
    c=Executor(jobs_root=tmp_path).run('cablesim.simulation',capability,
        [dict(case_id='regression',input=value,parameters=parameters or {})]).cases[0]
    assert c.status=='succeeded',c.error
    return c


@pytest.mark.parametrize('name,variant',[('eddy-twin',None),('eddy-two-round','case1'),('eddy-two-round','case2'),('eddy-two-round','case3')])
def test_published_e17_e19_getdp_regression(name,variant,tmp_path):
    getdp(tmp_path)
    d=json.loads((ROOT/f'plugins/cablesim.simulation/src/cases/{name}.json').read_text('utf-8'))
    if variant:
        selected=next(v for v in d['variants'] if v['id']==variant)
        for change in selected['input_changes']:
            value=d['input']
            for key in change['path'][:-1]:value=value[key]
            value[change['path'][-1]]=change['value']
        for change in selected['target_changes']:
            next(t for t in d['targets'] if t['id']==change['id']).update(change)
    d['parameters']['mesh']['size_m']=d['mesh_sizes_m'][-1]
    d['parameters']['reproduction']={k:d[k] for k in ('citation','scope','targets','frozen_inputs')}
    c=run(tmp_path,'getdp-eddy',d['input'],d['parameters'])
    report=c.artifacts['x-cablesim.reproduction-report']
    assert report['rows']
    assert all(r['status']=='matched' for r in report['rows']),[(r['id'],r['status'],r.get('difference')) for r in report['rows']]


def test_c02_independent_six_terminal_capacitance(tmp_path):
    mesh=build(.0013,128,thermal=False)
    props={1:(1e-14,1),3:(1.,28),4:(1e-18,2.25),5:(1e-18,2.36),6:(1e-18,2.5),7:(2.,2.25),8:(3.2e-9,3.16),9:(1e-14,3.75),10:(5.,1),11:(59.6e6,1),12:(4.55e6,1),13:(5.,1)}
    labels={r['construction_label']:r['id'] for r in mesh['regions']}
    terminals=[labels[f'phase/{i}/{kind}'] for kind in ('conductor','screen') for i in (1,2,3)]
    discrete={k:mesh[k] for k in ('points','triangles','domain_ids')}
    discrete.update(length_unit='m',source={'reference':mesh['geometry_source'],'sha256':mesh['sha256']})
    value={'schema_version':'cablesim.terminal-field/1','mesh':discrete,'frequency_hz':50.,
        'materials':{str(r['id']):dict(conductivity_s_m=props[r['material_index']][0],relative_permittivity=props[r['material_index']][1],source='COMSOL02 material and ec overrides; independently associated geometry') for r in mesh['regions']},
        'terminals':[dict(id=f'terminal/{i+1}',domain_ids=[d]) for i,d in enumerate(terminals)],
        'floating_terminals':['terminal/4','terminal/5','terminal/6'],
        'ground_nodes':sorted({int(n) for edge in mesh['boundary_edges'] for n in edge[:2]}),
        'boundary_source':'COMSOL02 radius 5*Dcab/2 ground, six independent 1V bases'}
    r=run(tmp_path,'terminal-field',value).artifacts['x-cablesim.simulation-bundle']['result']
    y=np.asarray(r['admittance_real_s_m'])+1j*np.asarray(r['admittance_imag_s_m'])
    assert y.shape==(6,6)
    capacitance=y.imag/(2*np.pi*50)
    # Public tutorial prints 0.14 uF/km: half of its last printed digit is
    # 0.005 uF/km. This assertion does not turn that rounded value into truth.
    assert np.diag(capacitance)[:3]==pytest.approx([1.4e-10]*3,abs=5e-12)
    assert np.max(np.abs(y-y.T))<1e-8*np.max(np.abs(y))
    assert np.linalg.eigvalsh(capacitance).min()>0
    floating=y[:3,:3]-y[:3,3:]@np.linalg.solve(y[3:,3:],y[3:,:3])
    assert np.all(np.diag(floating.imag)<=np.diag(y[:3,:3].imag))


@pytest.mark.parametrize('branch,expected',[('plain',(47.,13.,7.6)),('series',(47.,15.,.36)),('milliken',(43.,16.,.37))])
def test_c04_independent_three_electrical_branches(branch,expected,tmp_path):
    getdp(tmp_path)
    from tutorial_problem import inductive
    p,controls=inductive(branch!='plain',.0015);controls['minimum_circle_segments']=160
    if branch=='milliken':
        for g in p['geometry']:
            if g['uid'].endswith('/conductor'):g['material']['conductivity_s_m']=0.
        for e in p['excitations']:
            if e['regions'][0].endswith('/conductor'):e['kind']='impressed_current_rms_a'
    b=run(tmp_path,'getdp-eddy',p,{'mesh':controls}).artifacts['x-cablesim.simulation-bundle']
    obs=b['observations']
    conductor=3*655**2/(59.6e6*500e-6) if branch=='milliken' else sum(r['value'] for r in obs if r['quantity']=='joule_loss_w_m' and r['entity'].endswith('/conductor'))
    screen=sum(r['value'] for r in obs if r['quantity'] in ('joule_loss_w_m','magnetic_loss_w_m') and r['entity'].endswith('/screen'))
    armor=sum(r['value'] for r in obs if r['quantity'] in ('joule_loss_w_m','magnetic_loss_w_m') and r['entity'].startswith('armor-'))
    # COMSOL04 Table 1 gives rounded W/m values. Keep print precision and the
    # 0.5% independent-discretization allowance distinct from exact equality.
    for actual,reference,rounding in zip((conductor,screen,armor),expected,(.5,.5,.05 if branch=='plain' else .005)):
        assert actual==pytest.approx(reference,abs=rounding+.005*reference)
    assert b['result']['execution']['returncode']==0


def test_c06_fresh_bidirectional_coupling_against_frozen_native_reference(tmp_path):
    getdp(tmp_path)
    from replay_submarine import coupled_input
    mesh=build(.001,128)
    r=run(tmp_path,'contact-electrothermal-field',coupled_input(mesh)).artifacts['x-cablesim.simulation-bundle']['result']
    # Frozen independent COMSOL 6.2 tutorial06 native calculation, documented
    # with provenance in SIMULATION.md. These are local reference-solver values,
    # not numbers printed in the tutorial and not a measured/standard truth.
    assert r['maximum_temperature_k']==pytest.approx(362.804317,abs=.1)
    assert r['thermal']['relative_energy_error']<1e-6
    assert r['thermal']['linear_residual']<1e-8
    assert 1<len(r['iterations'])<=40
    metadata={row['id']:row for row in mesh['regions']}
    for material,temperature,tolerance,power in [(11,362.728642,.1,57.808272),(12,356.001428,.2,11.541505),(13,343.459542,.2,6.971100)]:
        group=[row for row in r['regional'] if metadata[row['domain_id']]['material_index']==material]
        area=sum(metadata[row['domain_id']]['area_m2'] for row in group)
        mean=sum(metadata[row['domain_id']]['area_m2']*row['mean_temperature_k'] for row in group)/area
        assert mean==pytest.approx(temperature,abs=tolerance)
        assert sum(row['heat_w_m'] for row in group)==pytest.approx(power,rel=.005)
