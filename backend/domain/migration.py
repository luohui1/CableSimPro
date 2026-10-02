"""Explicit v0 conversion; unknown screen construction/bonding remains unknown."""
from .models import DomainDocument
from ..schemas import Scenario


def convert(scenario):
    s = Scenario.model_validate(scenario)
    c, i = s.cable, s.installation
    layers = [('conductor_screen', 'semicon', c.conductor_screen_mm), ('insulation', 'insulation', c.insulation_mm),
              ('insulation_screen', 'semicon', c.insulation_screen_mm), ('metallic_screen', 'screen', c.metallic_screen_mm),
              ('oversheath', 'jacket', c.jacket_mm)]
    document = {'name': s.name, 'materials': [
        {'id': 'material/conductor', 'label': c.conductor, 'category': 'conductor'},
        {'id': 'material/semicon', 'label': 'v0 semiconductor', 'category': 'semiconductor', 'thermal_resistivity': c.semicon_rho_k_m_w},
        {'id': 'material/insulation', 'label': 'v0 insulation', 'category': 'insulation', 'thermal_resistivity': c.insulation_rho_k_m_w,
         'relative_permittivity': c.relative_permittivity, 'loss_tangent': c.tan_delta},
        {'id': 'material/screen', 'label': 'v0 screen, construction unspecified', 'category': 'metal'},
        {'id': 'material/jacket', 'label': 'v0 oversheath', 'category': 'polymer', 'thermal_resistivity': c.jacket_rho_k_m_w},
        {'id': 'material/soil', 'label': 'v0 soil', 'category': 'soil', 'thermal_resistivity': i.soil_rho_k_m_w}],
        'cable_types': [{'id': 'cable_type/ct1', 'label': c.name, 'construction': 'single_core',
                         'rating': {'u0': c.u0_kv * 1000, 'max_conductor_temperature': {'normal': c.max_temperature_c + 273.15}},
                         'cores': [{'id': 'core/1', 'conductor': {'material': 'material/conductor', 'form': 'unspecified',
                                    'nominal_area': c.area_mm2 * 1e-6, 'diameter': c.radii_mm()[0] * .002,
                                    'r20': None if c.r20_ohm_km is None else c.r20_ohm_km / 1000}, 'layers': []}],
                         'common_layers': [{'role': role, 'material': 'material/' + material, 'thickness': thickness / 1000,
                                            **({'form': 'unspecified'} if role == 'metallic_screen' else {})} for role, material, thickness in layers]}],
        'circuits': [{'id': 'circuit/c1', 'label': 'v0 circuit', 'system': {'kind': 'ac_three_phase', 'frequency': c.frequency_hz, 'voltage': None},
                      'cable_type': 'cable_type/ct1', 'cables': [{'id': 'cable/c1-' + phase, 'phase': phase} for phase in 'ABC'],
                      'bonding': {'kind': 'unspecified'}}],
        'sections': [{'id': 'section/s1', 'label': 'v0 buried section', 'kind': 'ground', 'length': s.circuit_length_m,
                      'medium': {'material': 'material/soil', 'surface_temperature': i.ambient_temperature_c + 273.15},
                      'placements': [{'cable': 'cable/c1-' + phase, 'x': x, 'z': -depth} for phase, (x, depth) in zip('ABC', i.positions_m())],
                      'layout_template': {'kind': i.arrangement, 'depth': i.depth_m, 'spacing': i.spacing_m}}],
        'load_cases': [{'id': 'load/steady', 'kind': 'steady', 'currents': {'circuit/c1': s.operating_current_a}}],
        'criteria': {'max_conductor_temperature': c.max_temperature_c + 273.15},
        'provenance': {'/cable_types/0/cores/0/conductor/diameter': {'kind': 'derived', 'reference': 'v0 area/fill_factor', 'reviewed': False}}}
    return {'document': DomainDocument.model_validate(document).model_dump(mode='json'),
            'method_parameters': {'ac_extra_factor': c.ac_extra_factor, 'screen_loss_factor': c.screen_loss_factor,
                                  'conductor_kind': c.conductor, 'fill_factor': c.fill_factor},
            'warnings': ['v0 未记录导体构造、金属屏蔽结构和接地方式，保留 unspecified；不能自动当成 IEC 圆绞合导体和管状护套。',
                         'v0 未记录系统线电压，保留 null；电缆额定 U0 不能用作系统线电压。',
                         '未核对的旧参数保持未核对，不添加厂家或标准认证。']}
