"""Field-level research refusals and SI translations; no mesher or solver is run."""
from copy import deepcopy
from pathlib import Path
import sys
import pytest
from simulation_fixtures import domain,transient_parameters,electromagnetic_parameters,coupled_parameters

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.transient import prepare as transient
from cablesim_simulation.sheath import prepare as sheath
from cablesim_simulation.domain_coupled import prepare as coupled


def test_transient_uses_saved_current_squared_and_kelvin_limit():
    value=domain();parameters=transient_parameters(value)
    problem,mesh,limits=transient(value,parameters)
    assert problem.physics=='transient_heat'
    assert problem.excitations[0].value==[10.]
    assert problem.excitations[0].schedule==[(0.,1.),(20.,0.),(40.,1.)]
    assert limits=={'cable/one':294.15}
    assert problem.temperature_regions=={'cable/one':['cable/one/conductor']}


@pytest.mark.parametrize('case', ['capacity','misaligned','duration','resistance','preload'])
def test_transient_rejects_missing_or_conflicting_saved_facts(case):
    value=domain();parameters=transient_parameters(value)
    if case=='capacity':value['materials'][0]['volumetric_heat_capacity']=None
    elif case=='misaligned':value['load_cases'][0]['profile']['circuit/one']['time'][1]=20.05
    elif case=='duration':parameters['time']['steps']=599
    elif case=='resistance':parameters['resistance_temperature_k']={}
    else:value['load_cases'][0]['preload']='load/one'
    with pytest.raises(ValueError):transient(value,parameters)


def test_sheath_phase_and_unequal_cross_bonding_are_saved_topology():
    value=domain(True);parameters=electromagnetic_parameters(value)
    source=value['circuits'][0]['bonding']['source']
    value['circuits'][0]['bonding']={'kind':'cross_bonded','minor_section_lengths':[80.,100.,120.],
        'section_permutations':[[0,1,2],[1,2,0],[2,0,1]],'transposed':False,'source':source}
    problem,mesh,export=sheath(value,parameters)
    assert len(problem.electrical_networks)==1 and len(problem.electrical_networks[0].branches)==9
    assert sorted(set(problem.axial_lengths_m.values()))==[80.,100.,120.]
    assert len(export.bindings)==3 and len(export.bindings[0].conductor_regions)==3
    assert export.topology['circuits']['circuit/one']['bonding']==value['circuits'][0]['bonding']
    assert sum(export.topology['longitudinal_integration']['regional_length_weights'][uid] for uid in export.bindings[0].conductor_regions)==pytest.approx(1.)


def test_missing_phase_source_is_not_inferred_from_labels():
    value=domain(True);value['circuits'][0]['electrical_topology']=None
    with pytest.raises(ValueError,match='electrical_topology'):sheath(value,electromagnetic_parameters(value))


def test_coupled_resistivity_is_bound_to_domain_and_validity():
    value=domain(True);parameters=coupled_parameters(value)
    model,mesh=coupled(value,parameters)
    assert len(model.resistivity_laws)==6
    assert model.resistivity_laws['cable/a/conductor'].alpha_per_k==.00393
    parameters['thermal_boundaries'][0]['value']=300.
    with pytest.raises(ValueError,match='环境温度'):coupled(value,parameters)
