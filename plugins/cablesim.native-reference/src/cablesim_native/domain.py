"""Explicit SI-to-native adapter for the existing single-circuit buried models.

No material or electrical defaults are introduced. The numerical kernels retain
their current v0 range and coordinate convention; unsupported facts fail closed.
"""
from math import isclose, pi, sqrt

from backend.domain.models import DomainDocument
from backend.schemas import Scenario


METHOD_FIELDS = {'conductor_kind', 'ac_extra_factor', 'screen_loss_factor', 'fill_factor'}


def prepare(value, parameters):
    if value.get('schema_version') != 'cablesim.domain/1':
        raise ValueError('原生方法输入须为 SI 领域文档，请先显式迁移旧工况。')
    d = DomainDocument.model_validate(value)
    if len(d.circuits) != 1 or len(d.sections) != 1 or len(d.load_cases) != 1:
        raise ValueError('原生参考仅支持单回路、单截面、单个稳态负荷')
    circuit, section, load = d.circuits[0], d.sections[0], d.load_cases[0]
    if section.backfill is not None or section.soil_layers:
        raise ValueError('原生参考仅支持均匀土壤；回填区或土壤分层计算尚未接入，不能忽略介质分区。')
    if circuit.system.kind != 'ac_three_phase' or [c.phase for c in circuit.cables] not in (['A', 'B', 'C'], ['L1', 'L2', 'L3']):
        raise ValueError('原生参考仅支持三相、每相一根电缆，并按相序排列')
    if section.kind != 'ground' or section.enclosures or load.kind != 'steady' or load.profile:
        raise ValueError('原生参考仅支持均匀土壤直埋稳态，不支持排管或时变边界')
    cable = next(t for t in d.cable_types if t.id == circuit.cable_type)
    if cable.construction != 'single_core':
        raise ValueError('原生参考仅支持单芯电缆')
    core, materials = cable.cores[0], {m.id: m for m in d.materials}
    conductor = core.conductor
    if core.x or core.z or conductor.form not in ('unspecified', 'solid_round', 'stranded_round', 'stranded_round_compacted') or conductor.inner_diameter:
        raise ValueError('原生参考不支持偏心、空心或非圆形导体')
    layers = core.layers + cable.common_layers
    roles = [layer.role for layer in layers]
    if len(roles) == 5 and roles[3] == 'metallic_sheath':
        roles[3] = 'metallic_screen'
    if roles != ['conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'oversheath']:
        raise ValueError('原生参考要求现有六层同心结构，不支持铠装或额外层')
    if layers[3].form not in (None, 'unspecified', 'smooth'):
        raise ValueError('原生参考金属层使用连续等效圆环，不支持显式丝、带或皱纹构造')
    insulation = materials[layers[1].material]
    semicon = materials[layers[0].material]
    if semicon.thermal_resistivity != materials[layers[2].material].thermal_resistivity:
        raise ValueError('原生参考要求两层半导电材料热阻率相同')
    soil = materials.get(section.medium.material)
    if soil is None or soil.dry_thermal_resistivity is not None or soil.critical_temperature_rise is not None:
        raise ValueError('原生参考需要明确的均匀土壤材料，不支持土壤干燥模型')
    places = {p.cable: p for p in section.placements}
    if set(places) != {c.id for c in circuit.cables}:
        raise ValueError('原生截面位置必须与三根电缆一一对应')
    ordered = [places[c.id] for c in circuit.cables]
    flat = all(isclose(p.z, ordered[0].z, abs_tol=1e-10) for p in ordered)
    spacing = ordered[1].x - ordered[0].x if flat else ordered[2].x - ordered[1].x
    # Invert the native coordinate construction directly. Averaging three equal
    # depths introduces a rounding step that can perturb the generated FEM mesh.
    depth = -ordered[0].z if flat else -ordered[0].z + spacing / sqrt(3)
    fill = conductor.nominal_area / (pi * (conductor.diameter / 2) ** 2)
    if 'fill_factor' in parameters and not isclose(parameters['fill_factor'], fill, rel_tol=1e-10):
        raise ValueError('填充系数由领域面积和直径确定，不能由方法参数覆盖')
    normal_limit = cable.rating.max_conductor_temperature.get('normal')
    if normal_limit is None:
        raise ValueError('原生稳态方法需要正常运行温度上限')
    limit = d.criteria.get('max_conductor_temperature', normal_limit)
    if limit > normal_limit:
        raise ValueError('稳态研究温限不能超过电缆正常运行额定温限')
    # Model assumptions can fill missing material properties only when explicitly
    # supplied, and cannot silently override a property present in the SI document.
    for material, field in ((materials[conductor.material], 'conductor_k_w_m_k'),
                            (materials[layers[3].material], 'metal_screen_k_w_m_k')):
        if field in parameters and material.thermal_resistivity is not None and not isclose(parameters[field], 1 / material.thermal_resistivity, rel_tol=1e-10):
            raise ValueError('方法导热系数与领域材料热阻率不一致：' + field)
    alpha = materials[conductor.material].temperature_coefficient_20
    if alpha is not None and 'alpha20_per_k' in parameters and not isclose(alpha, parameters['alpha20_per_k'], rel_tol=1e-10):
        raise ValueError('方法温度系数与领域材料数据不一致')
    c = {'name': cable.label, 'conductor': parameters['conductor_kind'],
         'area_mm2': conductor.nominal_area * 1e6, 'fill_factor': fill,
         'r20_ohm_km': None if conductor.r20 is None else conductor.r20 * 1000,
         'conductor_screen_mm': layers[0].thickness * 1000, 'insulation_mm': layers[1].thickness * 1000,
         'insulation_screen_mm': layers[2].thickness * 1000, 'metallic_screen_mm': layers[3].thickness * 1000,
         'jacket_mm': layers[4].thickness * 1000, 'semicon_rho_k_m_w': semicon.thermal_resistivity,
         'insulation_rho_k_m_w': insulation.thermal_resistivity,
         'jacket_rho_k_m_w': materials[layers[4].material].thermal_resistivity,
         'relative_permittivity': insulation.relative_permittivity, 'tan_delta': insulation.loss_tangent,
         'u0_kv': cable.rating.u0 / 1000, 'frequency_hz': circuit.system.frequency,
         'ac_extra_factor': parameters['ac_extra_factor'], 'screen_loss_factor': parameters['screen_loss_factor'],
         'max_temperature_c': limit - 273.15}
    s = Scenario.model_validate({'schema_version': 1, 'name': d.name, 'description': 'SI 领域文档的原生方法适配',
                                 'cable': c, 'installation': {'arrangement': 'flat' if flat else 'trefoil',
                                     'depth_m': depth, 'spacing_m': spacing,
                                     'ambient_temperature_c': section.medium.surface_temperature - 273.15,
                                     'soil_rho_k_m_w': soil.thermal_resistivity},
                                 'operating_current_a': load.currents[circuit.id], 'circuit_length_m': section.length})
    if any(not isclose(x, p.x, abs_tol=1e-9) or not isclose(-y, p.z, abs_tol=1e-9)
           for (x, y), p in zip(s.installation.positions_m(), ordered)):
        raise ValueError('原生场坐标要求以 x=0 为中心的平排或等边品字形；不能用模板覆盖实际坐标')
    return s, {k: v for k, v in parameters.items() if k not in METHOD_FIELDS}, {
        'circuit': circuit.id, 'cables': [c.id for c in circuit.cables], 'section': section.id,
        'load': load.id, 'coordinates': {'length_unit': 'm', 'positive_y': 'depth', 'domain_z': '-y'}}
