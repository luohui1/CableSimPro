"""The rating method against a manufacturer's published catalogue.

The catalogue (Bahra, CU/XLPE/LC/PVC 3.6/6 kV single core) states its ratings are computed per IEC 60287 for one
circuit at 35 °C ground, 0.80 m, 1.2 K·m/W, 60 Hz, and marks them approximate. It does not give the screen
thicknesses, the bonding or the flat spacing, so the comparison is a check of agreement, not of exact equality:
the exact check of the method is the TB 880 recomputation in test_studio_core.py.

Full series, measured once: trefoil, both ends bonded: mean 3.9 %, largest 9.8 % (the 25 mm² size);
flat one diameter apart: mean 3.5 %, largest 8.7 %. Sizes from 95 mm² up are within 4 % in trefoil.
"""
import pytest

from studio_core import catalogue, study

DATA = catalogue.series('bahra_mv_lead_sheathed')
CONDITIONS = {'soil_thermal_resistivity': DATA['conditions']['soil_thermal_resistivity'], 'ambient_temperature_c': DATA['conditions']['ground_temperature_c'],
              'frequency_hz': DATA['conditions']['frequency_hz'], 'system_voltage_v': DATA['u_v'], 'currents_a': [100.0]}


def rating(item, layout, spacing=None, bonding='both_ends'):
    cable = catalogue.single_core_entry(DATA, item)
    installation = {'layout': layout, 'depth_m': DATA['conditions']['depth_m'], 'spacing_m': spacing, 'duct': None, 'backfill': None, 'bonding': bonding}
    return study.rate({'name': '目录对照', 'cable': cable, 'installation': installation, 'conditions': CONDITIONS})


def item(area):
    return next(row for row in DATA['items'] if row['area'] == area)


def test_the_series_is_rebuilt_to_the_catalogue_diameter():
    for row in DATA['items']:
        entry = catalogue.single_core_entry(DATA, row)
        assert entry['summary']['outer_diameter_m'] * 1000 == pytest.approx(row['outer_diameter'], abs=1e-6)
        assert entry['summary']['r20_ohm_m'] * 1000 == pytest.approx(row['r_dc_20'])


@pytest.mark.parametrize('area, tolerance', [(35, .08), (95, .04), (240, .04), (630, .04)])
def test_trefoil_ratings_agree_with_the_catalogue(area, tolerance):
    row = item(area)
    record = rating(row, 'trefoil')
    assert record['method_card']['tier']['tier'] == 'deliverable'
    assert record['summary']['ampacity']['value_a'] == pytest.approx(row['rating_ground_trefoil'], rel=tolerance)


@pytest.mark.parametrize('area, tolerance', [(95, .05), (240, .02), (630, .03)])
def test_flat_ratings_agree_when_the_cables_are_one_diameter_apart(area, tolerance):
    row = item(area)
    record = rating(row, 'flat', spacing=2 * row['outer_diameter'] / 1000)
    assert record['summary']['ampacity']['value_a'] == pytest.approx(row['rating_ground_flat'], rel=tolerance)


def test_what_the_method_does_not_cover_is_refused_with_a_reason():
    row = item(240)
    touching = rating(row, 'flat', spacing=row['outer_diameter'] / 1000)
    assert touching['summary']['status'] == 'failed'
    assert touching['summary']['error']['code'] == 'TOUCHING_GROUP_NOT_SUPPORTED'
    # Single-point bonding leaves only eddy losses in the sheath; with eddy losses switched off the method refuses.
    single = rating(row, 'trefoil', bonding='single_point')
    assert single['summary']['status'] == 'failed'
    assert '涡流' in single['summary']['error']['message']
