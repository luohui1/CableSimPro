"""Closed-form comparison for a successful fixed-power cable/soil FEM job.

The analytical model uses the method of images for line sources in a homogeneous
semi-infinite soil with an isothermal ground plane. The cable's own conductor
center-to-jacket temperature rise uses the same explicit circular dimensions and
constant material conductivities. It intentionally does not imitate the FEM's
finite side/bottom boundaries or its polygonal cable geometry.
"""
from __future__ import annotations

import json
from math import hypot, isclose, log, pi, sqrt
from pathlib import Path
from ..foundation.contracts import CircularRecipe
from ..schemas import Scenario
from .buried_contract import BuriedArgs, BuriedSummary
from .line_source_contract import LineSourceComparison, PhaseComparison


def internal_resistance(recipe, scenario, arguments):
    recipe = CircularRecipe.model_validate(recipe)
    scenario = Scenario.model_validate(scenario)
    args = BuriedArgs.model_validate(arguments)
    if len(recipe.layers) != 6:
        raise ValueError('LINE_SOURCE_REQUIRES_SIX_LAYERS')
    radii = [layer.outer_radius_m for layer in recipe.layers]
    if any(abs(value-reference/1000) > 1e-12 for value, reference in zip(radii, scenario.cable.radii_mm())):
        raise ValueError('LINE_SOURCE_RECIPE_MISMATCH')
    cable = scenario.cable
    conductivities = [args.conductor_k_w_m_k, 1/cable.semicon_rho_k_m_w,
                      1/cable.insulation_rho_k_m_w, 1/cable.semicon_rho_k_m_w,
                      args.metal_screen_k_w_m_k, 1/cable.jacket_rho_k_m_w]
    value = 1/(4*pi*conductivities[0])
    value += sum(log(radii[i]/radii[i-1])/(2*pi*conductivities[i]) for i in range(1, 6))
    return value


def soil_matrix(scenario, outer_radius_m):
    scenario = Scenario.model_validate(scenario)
    positions = scenario.installation.positions_m()
    rho = scenario.installation.soil_rho_k_m_w
    matrix = []
    for i, (xi, yi) in enumerate(positions):
        row = []
        for j, (xj, yj) in enumerate(positions):
            image_distance = hypot(xi-xj, yi+yj)
            real_distance = outer_radius_m if i == j else hypot(xi-xj, yi-yj)
            if not image_distance > real_distance > 0:
                raise ValueError('INVALID_LINE_SOURCE_GEOMETRY')
            row.append(rho*log(image_distance/real_distance)/(2*pi))
        matrix.append(tuple(row))
    return tuple(matrix)


def compare_line_source(recipe, scenario, source_summary, source_context):
    scenario = Scenario.model_validate(scenario)
    summary = BuriedSummary.model_validate(source_summary)
    if source_context.get('command') != 'skfem.buried-reference':
        raise ValueError('SOURCE_COMMAND_MISMATCH')
    source_plugin = source_context.get('plugin', {})
    if source_plugin.get('plugin_id') != 'cablesim.buried-reference':
        raise ValueError('SOURCE_PLUGIN_MISMATCH')
    arguments = BuriedArgs.model_validate(source_context.get('arguments'))
    if (tuple(summary.source_powers_w_m) != tuple(arguments.conductor_powers_w_m) or
        summary.domain_scale != arguments.domain_scale or summary.resolution != arguments.resolution or
        not isclose(summary.ambient_temperature_c, scenario.installation.ambient_temperature_c, abs_tol=1e-12) or
        not isclose(summary.soil_k_w_m_k, 1/scenario.installation.soil_rho_k_m_w, rel_tol=1e-12)):
        raise ValueError('SOURCE_SUMMARY_INPUT_MISMATCH')
    recipe_model = CircularRecipe.model_validate(recipe)
    outer = recipe_model.layers[-1].outer_radius_m
    own = internal_resistance(recipe_model, scenario, arguments)
    matrix = soil_matrix(scenario, outer)
    ambient = scenario.installation.ambient_temperature_c
    powers = tuple(summary.source_powers_w_m)
    analytic = tuple(ambient + powers[i]*own + sum(matrix[i][j]*powers[j] for j in range(3)) for i in range(3))
    comparisons = []
    for i, phase in enumerate(('A', 'B', 'C')):
        fem = summary.conductor_max_temperatures_c[i]
        difference = fem-analytic[i]
        rise = analytic[i]-ambient
        comparisons.append(PhaseComparison(phase=phase, source_power_w_m=powers[i],
            fem_peak_temperature_c=fem, half_space_center_temperature_c=analytic[i],
            difference_fem_minus_half_space_k=difference,
            relative_rise_difference_percent=100*difference/rise if rise else None))
    differences = [p.difference_fem_minus_half_space_k for p in comparisons]
    result = LineSourceComparison(
        source_job_id=source_context['job_id'], source_plugin_id=source_plugin['plugin_id'],
        source_plugin_version=source_plugin['version'], source_release_sha256=source_plugin['release_sha256'],
        source_project_revision=source_context['project_revision'],
        finite_element_boundary=summary.boundary_condition,
        ambient_temperature_c=ambient, soil_k_w_m_k=summary.soil_k_w_m_k,
        conductor_to_jacket_surface_k_m_w=own, soil_resistance_matrix_k_m_w=matrix,
        cable_centers_m=tuple(tuple(p) for p in scenario.installation.positions_m()),
        cable_outer_radius_m=outer, phases=tuple(comparisons),
        maximum_absolute_difference_k=max(abs(v) for v in differences),
        rms_difference_k=sqrt(sum(v*v for v in differences)/3),
        domain_scale=summary.domain_scale, resolution=summary.resolution,
        finite_domain_half_width_m=summary.half_width_m,
        finite_domain_bottom_depth_m=summary.bottom_depth_m)
    return result


def run_line_source(recipe, scenario, context):
    summary = json.loads(Path('input/thermal.json').read_text('utf-8'))
    result = compare_line_source(recipe, scenario, summary, context)
    Path('line-source.json').write_text(result.model_dump_json(indent=2), encoding='utf-8')
    return {'files': ['line-source.json'], 'summary': result.model_dump(mode='json'),
            'warnings': ['解析参考采用半无限均匀土壤和恒温地表；不包含有限元的侧面与底部恒温截断边界。',
                         '电缆按线热源处理，内部温升按六层同心圆柱热阻计算；不复现网格的多边形误差。',
                         '差异同时包含有限计算域、线源近似与离散误差；没有预设通过阈值或工程认证。']}
