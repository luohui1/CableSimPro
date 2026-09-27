"""Golden-value regression for the existing thermal network (MV-THERMAL-0.1.0).

These numbers were produced by the pre-plugin host implementation (backend/engine.py) on
synthetic inputs and are now reproduced through the plugin host: the method runs in the
cablesim.thermal-network plugin process and returns through the generic executor. They
prove *unchanged* behaviour across refactors; they are NOT evidence that the method is correct. Correctness evidence for the
IEC 60287 method lives in plugins/cablesim.iec60287/tests.

If the method is intentionally changed, bump MODEL_VERSION and regenerate these values
in the same change; never edit the numbers to make a failing refactor pass.
"""
import pytest

from backend.methods import MODEL_VERSION, calculate_many
from backend.schemas import Scenario

GOLDEN = {
    'default_flat': ({}, {
        'ampacity_a': 542.8559788836769, 'operating_max_temperature_c': 48.66513274024693,
        'rating_temperatures_c': [85.88818987720434, 90.00000000000004, 85.88818987720434],
        'layer_resistances_k_m_w': [0.025371974897946414, 0.2499473004038244, 0.017899978323189198,
                                    1.2309961104129393e-05, 0.07897744052834711],
        'soil_matrix_diag_k_m_w': [0.8475567823884537] * 3,
        'dielectric_loss_w_m': 0.005160223543888441, 'r20_ohm_km': 0.07183749999999998}),
    'trefoil_r20': ({'cable': {'r20_ohm_km': 0.0754}, 'installation': {'arrangement': 'trefoil', 'spacing_m': 0.08}}, {
        'ampacity_a': 510.0052197793119, 'operating_max_temperature_c': 52.04631527866479,
        'rating_temperatures_c': [89.26688920549533, 90.0, 90.0],
        'layer_resistances_k_m_w': [0.025371974897946414, 0.2499473004038244, 0.017899978323189198,
                                    1.2309961104129393e-05, 0.07897744052834711],
        'soil_matrix_diag_k_m_w': [0.8361957148416678, 0.8529934699282389, 0.8529934699282389],
        'dielectric_loss_w_m': 0.005160223543888441, 'r20_ohm_km': 0.0754}),
    'aluminium_hot_soil': ({'cable': {'conductor': 'aluminium', 'area_mm2': 400, 'r20_ohm_km': 0.0778},
                            'installation': {'soil_rho_k_m_w': 2.5, 'ambient_temperature_c': 30, 'depth_m': 1.2}}, {
        'ampacity_a': 347.0015426282595, 'operating_max_temperature_c': 91.27951964719188,
        'rating_temperatures_c': [86.2560014138336, 90.00000000000003, 86.25600141383362],
        'layer_resistances_k_m_w': [0.01979263550533531, 0.20498842253212843, 0.015293340272852002,
                                    1.0574765239523035e-05, 0.06864014939333886],
        'soil_matrix_diag_k_m_w': [1.8748891235682759] * 3,
        'dielectric_loss_w_m': 0.006291984339130275, 'r20_ohm_km': 0.0778}),
    'no_loss_factors': ({'cable': {'ac_extra_factor': 0, 'screen_loss_factor': 0, 'tan_delta': 0}}, {
        'ampacity_a': 568.2227956313038, 'operating_max_temperature_c': 46.425937930039424,
        'rating_temperatures_c': [85.9104126203728, 90.00000000000004, 85.91041262037281],
        'layer_resistances_k_m_w': [0.025371974897946414, 0.2499473004038244, 0.017899978323189198,
                                    1.2309961104129393e-05, 0.07897744052834711],
        'soil_matrix_diag_k_m_w': [0.8475567823884537] * 3,
        'dielectric_loss_w_m': 0.0, 'r20_ohm_km': 0.07183749999999998}),
}
# Bisection has 70 iterations; 1e-9 relative leaves room for platform float differences only.
REL = 1e-9


def scenario(patch: dict) -> Scenario:
    data = Scenario().model_dump()
    for section, values in patch.items():
        data[section].update(values)
    return Scenario.model_validate(data)


def test_golden_values_belong_to_this_method_version():
    assert MODEL_VERSION == 'MV-THERMAL-0.1.0'


@pytest.fixture(scope='module')
def results():
    names = sorted(GOLDEN)
    # One plugin process for all cases; also exercises the batch path.
    return dict(zip(names, calculate_many([scenario(GOLDEN[n][0]) for n in names])))


@pytest.mark.parametrize('name', sorted(GOLDEN))
def test_thermal_network_reproduces_golden_values(name, results):
    patch, expected = GOLDEN[name]
    result = results[name]
    thermal = result['thermal']
    actual = {
        'ampacity_a': result['summary']['ampacity_a'],
        'operating_max_temperature_c': result['summary']['operating_max_temperature_c'],
        'rating_temperatures_c': result['rating']['temperatures_c'],
        'layer_resistances_k_m_w': thermal['layer_resistances_k_m_w'],
        'soil_matrix_diag_k_m_w': [thermal['soil_matrix_k_m_w'][i][i] for i in range(3)],
        'dielectric_loss_w_m': thermal['dielectric_loss_w_m'],
        'r20_ohm_km': thermal['r20_ohm_km'],
    }
    for key, value in expected.items():
        assert actual[key] == pytest.approx(value, rel=REL, abs=1e-12), key
