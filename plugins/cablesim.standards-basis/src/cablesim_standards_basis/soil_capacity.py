"""Hopmans phase mixture, with engineer-supplied SI inputs and no defaults."""
from math import isfinite
from .library import BasisError, digest, VERSION

FIELDS = {
    'dry_bulk_density_kg_m3': '土壤干容重 / kg/m³',
    'particle_density_kg_m3': '颗粒密度 / kg/m³',
    'solid_specific_heat_capacity_j_kg_k': '固相质量比热 / J/(kg·K)',
    'water_volumetric_heat_capacity_j_m3_k': '水相体积热容 / J/(m³·K)',
    'air_volumetric_heat_capacity_j_m3_k': '气相体积热容 / J/(m³·K)',
    'water_volume_fraction': '体积含水率 / m³/m³',
}


def evaluate(record, values):
    if record['id'] not in ('hopmans-soil-capacity-model/r1/soil_capacity_expression', 'hopmans-soil-capacity-model/r2/soil_capacity_expression'):
        raise BasisError('FORMULA_NOT_SUPPORTED', '/record_id', '此条款仅提供依据；未声明可执行公式，不能自动计算。')
    three_phase = record['conditions']['soil_capacity_method'] == 'three_phase'
    required = set(FIELDS) - (set() if three_phase else {'air_volumetric_heat_capacity_j_m3_k'})
    if not isinstance(values, dict):
        raise BasisError('INPUT_INVALID', '/formula_inputs', '请填写现场土壤和各相热容参数；不采用默认土壤。')
    extra = set(values) - required - {'phase_assumption'}
    if extra:
        raise BasisError('INPUT_INVALID', '/formula_inputs/' + sorted(extra)[0], '未声明的公式参数，请核对字段与 SI 单位。')
    for key in sorted(required):
        value = values.get(key)
        if type(value) not in (int, float) or not isfinite(value) or (value < 0 if key == 'water_volume_fraction' else value <= 0):
            raise BasisError('INPUT_INVALID', '/formula_inputs/' + key, '请填写有效的 ' + FIELDS[key] + '；不接受缺项或非有限值。')
    if values.get('phase_assumption') != 'single_temperature_no_phase_change':
        raise BasisError('INPUT_INVALID', '/formula_inputs/phase_assumption', '请明确各相同温且无冻结/相变；该公式未覆盖潜热。')
    dry, particle = values['dry_bulk_density_kg_m3'], values['particle_density_kg_m3']
    if dry > particle:
        raise BasisError('INPUT_INVALID', '/formula_inputs/dry_bulk_density_kg_m3', '干容重不得大于颗粒密度，请核对现场测量与单位。')
    porosity = 1 - dry / particle
    theta = values['water_volume_fraction']
    if theta > porosity:
        raise BasisError('INPUT_INVALID', '/formula_inputs/water_volume_fraction', '体积含水率不得大于由密度算出的孔隙率。')
    solid = particle * values['solid_specific_heat_capacity_j_kg_k']
    air = values.get('air_volumetric_heat_capacity_j_m3_k', 0) if three_phase else 0
    capacity = values['solid_specific_heat_capacity_j_kg_k'] * dry + values['water_volumetric_heat_capacity_j_m3_k'] * theta + air * (porosity - theta)
    if not isfinite(solid) or not isfinite(capacity):
        raise BasisError('INPUT_INVALID', '/formula_inputs', '参数乘积超出有限数值范围，请核对单位和数量级。')
    return {'schema': 'cablesim.soil-capacity-calculation/1', 'inputs': values,
            'input_sha256': digest(values), 'plugin_version': VERSION,
            'derived': {'porosity': porosity, 'solid_volumetric_heat_capacity_j_m3_k': solid},
            'derivation': 'φ = 1 − ρd/ρs（质量与体积定义）；Cs = ρs·cs；体积含水率 θ 必须为现场输入。',
            'output': {'quantity': 'volumetric_heat_capacity', 'value': capacity, 'unit': 'J/(m³·K)'},
            'record_id': record['id'], 'record_sha256': record['record_sha256'],
            'source_sha256': record['source_sha256'], 'citation': record['citation'],
            'formula': record['value'], 'approval': 'not_granted'}
