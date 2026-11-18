"""Published manufacturer series with their declared values.

A catalogue series serves two purposes: it is real product data to work with, and its declared values
(resistance, capacitance, short-circuit and current ratings) are something to compare the methods against.
What a catalogue does not state is listed in the series file and filled by declared assumptions, never silently.
"""
import json
from copy import deepcopy
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

from . import library

CATALOGUES = Path(__file__).with_name('catalogues')


def series(name):
    data = json.loads((CATALOGUES / f'{name}.json').read_text('utf-8'))
    keys = [column for column, _unit in data['columns']]
    data['items'] = [dict(zip(keys, row)) for row in data['rows']]
    return data


def tables(name):
    """A catalogue that publishes structure tables: one table per construction, several designations per table."""
    return json.loads((CATALOGUES / f'{name}.json').read_text('utf-8'))


def table_series(data, table_id, model=None):
    """One designation of one published table as a series declaration and its rows, ready for the structure builder.

    The declaration is the catalogue's `import_declaration`: what an engineer states when the table lacks a column.
    """
    from . import designation, structure
    table = next(item for item in data['tables'] if item['id'] == table_id)
    model = model or table['designations'][0]
    parts = designation.parse(model)
    declared = data['import_declaration']
    common = {**declared['common'], **declared['common_by_cores'].get(str(table['cores']), {}),
              **(declared['common_by_armour'].get(parts['armour']['kind'], {}) if parts['armour'] else {})}
    keys = [column[0] for column in table['columns']]
    rows = []
    for row in table['rows']:
        values = dict(zip(keys, row))
        values['weight'] = values[f'weight:{model}']
        rows.append({key: value for key, value in values.items() if not key.startswith('weight:')})
    modelling = structure.reference_modelling()
    modelling['diameter_rounding'] = deepcopy(declared['diameter_rounding'])
    series = {'name': f"{data['manufacturer']} {model}-{data['u0_v'] / 1000:g}/{data['u_v'] / 1000:g} kV {'单芯' if table['cores'] == 1 else '三芯'}",
              'manufacturer': data['manufacturer'], 'designation': model, 'cores': table['cores'], 'u0_v': data['u0_v'], 'u_v': data['u_v'],
              'um_v': data.get('um_v'), 'origin': 'public', 'standards': list(declared['standards']), 'common': common,
              'common_basis': {key: declared['common_basis'][key] for key in common}, 'modelling': modelling,
              'source': {**data['source'], 'location': f"{table['title']}；{data['source']['location']}"}}
    return series, rows


def workbook(data, path):
    """The published tables written as a workbook laid out like the printed ones: a sheet per table, a title,
    names over units, one weight column per designation, the catalogue's note under the rows."""
    book = Workbook()
    book.remove(book.active)
    centre = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for table in data['tables']:
        words = table['title'].split()
        sheet = book.create_sheet(f"{words[0]}{words[1]} {table['designations'][0]}")
        width = len(table['columns'])
        sheet.cell(1, 1, table['title']).font = Font(bold=True, size=12)
        sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=width)
        sheet.cell(2, 1, f"{data['manufacturer']}　{data['title']}")
        sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=width)
        weights = [index for index, column in enumerate(table['columns']) if column[0].startswith('weight:')]
        for index, (key, unit, label) in enumerate(table['columns']):
            if index in weights:
                sheet.cell(3, index + 1, '电缆近似重量 kg/km')
                sheet.cell(4, index + 1, key.split(':')[1])
            else:
                sheet.cell(3, index + 1, label)
                sheet.cell(4, index + 1, unit.replace('mm2', 'mm²'))
            sheet.column_dimensions[get_column_letter(index + 1)].width = 14
        sheet.merge_cells(start_row=3, start_column=weights[0] + 1, end_row=3, end_column=weights[-1] + 1)
        for row in sheet.iter_rows(min_row=1, max_row=4, max_col=width):
            for cell in row:
                cell.alignment = centre
        for offset, row in enumerate(table['rows']):
            for index, value in enumerate(row):
                sheet.cell(5 + offset, index + 1, value).alignment = centre
        sheet.cell(6 + len(table['rows']), 1, '注：导体外径仅供参考。')
    book.save(path)
    return {'path': str(path), 'sheets': book.sheetnames}


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
    # The standard kind of each material is what lets a method take its constants from the standard;
    # the catalogue names the materials (copper, XLPE, lead, PVC), so the kinds are stated, not guessed.
    kinds = {'material/cu': 'copper_bare', 'material/xlpe': 'XLPE', 'material/pb-sheath': 'lead', 'material/pvc': 'PVC'}
    for material in payload['materials']:
        if material['id'] in kinds:
            material['standard_kind'] = kinds[material['id']]
    # The catalogue's resistance is the maximum the manufacturer guarantees, not a measurement.
    payload['cable_type']['cores'][0]['conductor']['r20_basis'] = 'manufacturer_limit'
    source = f"{data['source']['title']}；{data['source']['location']}；sha256:{data['source']['sha256']}。目录未给出的量按系列文件里声明的假设取值。"
    return library._entry(f"{data['id']}.{area:g}", '1.0.0', label, f"{data['designation']} {data['u0_v'] / 1000:g}/{data['u_v'] / 1000:g} kV 单芯",
                          'public', source, payload)
