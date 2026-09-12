"""Small synthetic topology fixtures; no numerical-validation claims from these."""
from copy import deepcopy
from pathlib import Path
import json
import pytest
from backend.plugins.buried_contract import BuriedArgs, BuriedField, BuriedSummary, validate_buried_projection
from backend.plugins.contracts import RuntimeRequirement, Dependency


def fixture():
    points = [(x/2-1, y/2, 0) for y in range(5) for x in range(5)]
    cells = []
    for y in range(4):
        for x in range(4):
            a = y*5+x
            cells.extend([(a, a+1, a+6), (a, a+6, a+5)])
    roles = ('conductor', 'conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'jacket')
    domains = [{'domain_id': i, 'phase': 'ABC'[(i-1)//6], 'role': roles[(i-1)%6], 'uid': f'domain/{i}'} for i in range(1, 19)]
    domains.append({'domain_id': 19, 'phase': None, 'role': 'soil', 'uid': 'soil'})
    field = BuriedField(points=points, triangles=cells, domain_ids=[i%19+1 for i in range(len(cells))],
        domains=domains, values=[298.15]*25, boundary_nodes=[i for i,(x,y,z) in enumerate(points) if abs(x)==1 or y in (0,2)],
        cable_centers_m=[(-.5,1),(0,1),(.5,1)], cable_outer_radius_m=.1, half_width_m=1,bottom_depth_m=2).model_dump(mode='json')
    summary = BuriedSummary(maximum_temperature_c=25, conductor_max_temperatures_c=[25,25,25], ambient_temperature_c=25,
        source_powers_w_m=[0,0,0], source_heat_w_m=0, boundary_heat_w_m=0, energy_relative_residual=None,
        free_equation_residual_inf_w_m=0,nodes=25,elements=32,half_width_m=1,bottom_depth_m=2,domain_scale=8,resolution=16,soil_k_w_m_k=1).model_dump(mode='json')
    return field, summary


@pytest.mark.parametrize('patch', [
    {'conductor_powers_w_m':[1,2]}, {'conductor_powers_w_m':[1,2,3,4]},
    {'conductor_powers_w_m':[True,2,3]}, {'conductor_powers_w_m':[-1,2,3]},
    {'conductor_powers_w_m':[float('nan'),2,3]}, {'conductor_powers_w_m':[1001,2,3]},
    {'domain_scale':100}, {'resolution':128}, {'ampacity_a':500}, {'conductor_k_w_m_k':True},
])
def test_research_input_must_be_explicit_and_bounded(patch):
    args={'conductor_powers_w_m':[20,20,20],'conductor_k_w_m_k':380,'metal_screen_k_w_m_k':380}
    with pytest.raises(ValueError):BuriedArgs.model_validate(args|patch)


def test_no_default_power_or_materials():
    with pytest.raises(ValueError):BuriedArgs()
    assert BuriedArgs(conductor_powers_w_m=[0,0,0],conductor_k_w_m_k=380,metal_screen_k_w_m_k=380)


def test_exact_binary_release_versions_do_not_relax_plugin_versions():
    assert RuntimeRequirement(distribution='cadquery-ocp',version='7.9.3.1.1').version=='7.9.3.1.1'
    for version in ['latest','>=3.7.2','3.07.2','3.7.2+local','3.7.2rc1']:
        with pytest.raises(ValueError):RuntimeRequirement(distribution='casadi',version=version)
    with pytest.raises(ValueError):Dependency(plugin_id='cablesim.cadquery',version='7.9.3.1.1')


@pytest.mark.parametrize('change', ['count','nan','unit','depth','topology','boundary','duplicate','semantics','peak','energy','relative'])
def test_invalid_buried_artifacts_fail_closed(change):
    f,s=fixture()
    if change=='count':f['values'].pop()
    if change=='nan':f['values'][0]=float('nan')
    if change=='unit':f['unit']='degC'
    if change=='depth':f['positive_y']='up'
    if change=='topology':f['triangles'][0][2]=999
    if change=='boundary':f['boundary_nodes']=f['boundary_nodes'][1:]
    if change=='duplicate':f['triangles'][1]=f['triangles'][0]
    if change=='semantics':f['domains'][0]['phase']='B'
    if change=='peak':s['maximum_temperature_c']=30
    if change=='energy':s['boundary_heat_w_m']=1
    if change=='relative':s['energy_relative_residual']=0
    with pytest.raises(ValueError):validate_buried_projection(f,s)


def test_artifact_schemas_match_executable_contracts():
    root=Path(__file__).resolve().parents[2]/'plugin-spec'
    for name,model in [('buried-field',BuriedField),('buried-summary',BuriedSummary)]:
        assert json.loads((root/f'{name}.schema.json').read_text('utf-8'))==model.model_json_schema()
    assert validate_buried_projection(*fixture()).unit=='K'


def test_cad_readiness_checks_the_compatible_dependency_combination(monkeypatch):
    from backend.plugins.catalog import Catalog
    import importlib.metadata
    catalog=Catalog();m=catalog.get('cablesim.cadquery')
    expected={r.distribution:r.version for r in m.requirements}
    assert expected=={'cadquery':'2.8.0','cadquery-ocp':'7.9.3.1.1','vtk':'9.6.2','casadi':'3.7.2','nlopt':'2.11.0'}
    monkeypatch.setattr(importlib.metadata,'version',lambda name:'3.8.0' if name=='casadi' else expected[name])
    result=catalog.environment(m)
    assert result['metadata_ready'] is False and result['missing']==['casadi==3.7.2']
