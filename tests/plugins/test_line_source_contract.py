"""Analytical arithmetic and source binding without importing native solvers."""
from copy import deepcopy
from pathlib import Path
import json
import pytest
from backend.schemas import Scenario
from backend.foundation.contracts import CircularLayer, CircularRecipe
from backend.plugins.line_source import compare_line_source, internal_resistance, soil_matrix
from backend.plugins.line_source_contract import LineSourceArgs, LineSourceComparison


def recipe(s):
    radii=s.cable.radii_mm();roles=('conductor','conductor_screen','insulation','insulation_screen','metallic_screen','jacket')
    return CircularRecipe(length_m=.25,layers=tuple(CircularLayer(uid=f'cable/{role}',role=role,
        inner_radius_m=0 if i==0 else radii[i-1]/1000,outer_radius_m=radii[i]/1000) for i,role in enumerate(roles))).model_dump(mode='json')


def source(s,scale=8,peaks=(66.11829692745583,68.65657961606823,66.11757785814751)):
    args={'conductor_powers_w_m':[20.,20.,20.],'conductor_k_w_m_k':380.,'metal_screen_k_w_m_k':380.,'domain_scale':scale,'resolution':16}
    summary={'schema_version':'cablesim.buried-reference/1','method':'P1 2D conduction; three cables and finite homogeneous soil',
        'boundary_condition':'ambient temperature on ground, sides and bottom','ampacity_a':None,'maximum_temperature_c':max(peaks),
        'conductor_max_temperatures_c':list(peaks),'ambient_temperature_c':25.,'source_powers_w_m':[20.,20.,20.],
        'source_heat_w_m':60.,'boundary_heat_w_m':60.,'energy_relative_residual':0.,'free_equation_residual_inf_w_m':0.,
        'nodes':18261,'elements':36327,'domains':19,'half_width_m':.8*scale,'bottom_depth_m':.8*scale,
        'domain_scale':scale,'resolution':16,'soil_k_w_m_k':1/1.2}
    context={'job_id':'00000000-0000-0000-0000-000000000001','plugin':{'plugin_id':'cablesim.buried-reference','version':'0.1.0','release_sha256':'0'*64},
        'command':'skfem.buried-reference','arguments':args,'source_sha256':'1'*64,'project_revision':1}
    return args,summary,context



def test_command_has_no_client_selected_file_or_job_argument():
    assert LineSourceArgs.model_validate({}).model_dump()=={}
    with pytest.raises(ValueError):LineSourceArgs.model_validate({'source_job_id':'00000000-0000-0000-0000-000000000001'})

def test_closed_form_default_fixture_is_independent_and_reproducible():
    s=Scenario();args,summary,context=source(s)
    result=compare_line_source(recipe(s),s,summary,context)
    assert result.independent_equation_family is True and result.engineering_acceptance is False
    assert result.conductor_to_jacket_surface_k_m_w==pytest.approx(.37241906640590605,rel=1e-12)
    assert [p.half_space_center_temperature_c for p in result.phases]==pytest.approx(
        [66.59381548385394,69.20966000981664,66.59381548385394],abs=1e-10)
    assert result.maximum_absolute_difference_k==pytest.approx(.5530803937484166,abs=1e-10)
    assert result.rms_difference_k==pytest.approx(.5029307757423314,abs=1e-10)
    assert result.soil_resistance_matrix_k_m_w[0][1]==result.soil_resistance_matrix_k_m_w[1][0]
    assert result.soil_resistance_matrix_k_m_w[0][2]<result.soil_resistance_matrix_k_m_w[0][1]


def test_geometry_and_material_changes_change_the_reference_not_the_fem_input():
    s=Scenario();args,summary,context=source(s)
    baseline=compare_line_source(recipe(s),s,summary,context)
    changed=s.model_copy(deep=True);changed.installation.spacing_m=.2
    changed_positions=soil_matrix(changed,recipe(changed)['layers'][-1]['outer_radius_m'])
    assert changed_positions[0][1]<baseline.soil_resistance_matrix_k_m_w[0][1]
    changed.cable.insulation_rho_k_m_w=4.
    assert internal_resistance(recipe(changed),changed,args)>baseline.conductor_to_jacket_surface_k_m_w


@pytest.mark.parametrize('change',['command','plugin','power','scale','ambient','soil','recipe'])
def test_source_metadata_and_project_snapshot_must_match(change):
    s=Scenario();args,summary,context=source(s);r=recipe(s)
    if change=='command':context['command']='skfem.electrothermal-reference'
    if change=='plugin':context['plugin']['plugin_id']='cablesim.other'
    if change=='power':summary['source_powers_w_m'][0]=21
    if change=='scale':summary['domain_scale']=4
    if change=='ambient':summary['ambient_temperature_c']=24
    if change=='soil':summary['soil_k_w_m_k']=1
    if change=='recipe':r['layers'][-1]['outer_radius_m']*=2
    with pytest.raises(ValueError):compare_line_source(r,s,summary,context)


def test_contract_rejects_tampered_metrics_and_claims():
    s=Scenario();_,summary,context=source(s)
    raw=compare_line_source(recipe(s),s,summary,context).model_dump(mode='json')
    for path,value in [('maximum_absolute_difference_k',0),('engineering_acceptance',True),('experimental_validation',True)]:
        changed=deepcopy(raw);changed[path]=value
        with pytest.raises(ValueError):LineSourceComparison.model_validate(changed)


def test_checked_in_line_source_schema_matches_runtime_contract():
    path=Path(__file__).resolve().parents[2]/'plugin-spec/line-source-crosscheck.schema.json'
    assert json.loads(path.read_text('utf-8'))==LineSourceComparison.model_json_schema()
