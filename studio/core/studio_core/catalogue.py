"""Published manufacturer series with their declared values.

A catalogue series serves two purposes: it is real product data to work with, and its declared values
(resistance, capacitance, short-circuit and current ratings) are something to compare the methods against.
What a catalogue does not state is listed in the series file and filled by declared assumptions, never silently.
"""
import json
from copy import deepcopy
from pathlib import Path

from . import library

CATALOGUES = Path(__file__).with_name('catalogues')


def series(name):
    data = json.loads((CATALOGUES / f'{name}.json').read_text('utf-8'))
    keys = [column for column, _unit in data['columns']]
    data['items'] = [dict(zip(keys, row)) for row in data['rows']]
    return data


def single_core_entry(data, item):
    """A library entry for one size of a single-core lead-sheathed series, built from the catalogue's dimensions."""
    assumed = data['modelling_assumptions']
    screen = assumed['conductor_screen_thickness_mm']['value']
    listed = item['insulation_thickness'] + item['lead_sheath_thickness'] + item['oversheath_thickness']
    remainder = (item['outer_diameter'] - item['conductor_diameter']) / 2 - listed
    if remainder <= screen:
        raise ValueError(f"{data['id']} {item['area']} mm²：目录外径放不下各层厚度。")
    thicknesses = [value / 1000 for value in (screen, item['insulation_thickness'], remainder - screen,
                                              item['lead_sheath_thickness'], item['oversheath_thickness'])]
    sheath = {'id': 'material/pb-sheath', 'label': '铅护套', 'category': 'metal', **{key: assumed['lead_sheath'][key] for key in
              ('thermal_resistivity', 'electrical_resistivity_20', 'temperature_coefficient_20')}}
    area = item['area']
    label = f"{data['manufacturer'].split()[0]} {data['designation']} {data['u0_v'] / 1000:g}/{data['u_v'] / 1000:g} kV 1×{area:g}"
    payload = library._single_core(label, area, item['conductor_diameter'] / 1000, item['r_dc_20'] / 1000,
                                   {'u0': data['u0_v'], 'u': data['u_v'], 'um': data['um_v']}, thicknesses,
                                   form='stranded_round_compacted', loss_tangent=assumed['insulation']['loss_tangent'], sheath=deepcopy(sheath))
    source = f"{data['source']['title']}；{data['source']['location']}；sha256:{data['source']['sha256']}。目录未给出的量按系列文件里声明的假设取值。"
    return library._entry(f"{data['id']}.{area:g}", '1.0.0', label, f"{data['designation']} {data['u0_v'] / 1000:g}/{data['u_v'] / 1000:g} kV 单芯",
                          'public', source, payload)
