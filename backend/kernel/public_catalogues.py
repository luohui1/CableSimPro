"""Public manufacturer tables for the canonical type-library import workflow.

The transcribed catalogue JSON remains the only copy of the published numbers.
Workbook generation does not complete missing engineering parameters. In
particular, Bahra's unlisted screens are absent from the import, even though the
older, explicitly assumed catalogue comparison can calculate a reference case.
"""
from copy import deepcopy
import csv
from datetime import datetime, timezone
from functools import lru_cache
from hashlib import sha256
from io import BytesIO, StringIO
import re
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from studio.core.studio_core import catalogue


SAMPLES = {
    'people-mv': {
        'catalogue': 'people_mv_xlpe',
        'title': '人民电器 8.7/15 kV 结构表',
        'url': 'https://www.chinapeople.com/pdf/sh/dxdl/8.7-10kV.pdf',
    },
    'bahra-mv': {
        'catalogue': 'bahra_mv_lead_sheathed',
        'title': 'Bahra 3.6/6 kV 铅护套结构与性能表',
        'url': 'https://www.bahra-electric.com/Downloads/MV_Lead_Sheathed.pdf',
    },
}
BAHRA_SHEET = 'Bahra CU XLPE LC PVC'
BAHRA_LABELS = {
    'area': '标称截面', 'conductor_diameter': '导体外径',
    'insulation_thickness': '绝缘标称厚度', 'lead_sheath_thickness': '铅套厚度',
    'oversheath_thickness': '护套标称厚度', 'outer_diameter': '电缆近似外径',
    'weight': '电缆近似重量', 'r_dc_20': '20℃直流电阻',
    'r_ac_90': '90℃交流电阻', 'inductance': '电感', 'capacitance': '电容',
    'short_circuit_conductor': '导体短路电流 1s', 'short_circuit_sheath': '铅套短路电流 1s',
    'rating_ground_trefoil': '直埋品字形样本载流量', 'rating_ground_flat': '直埋平排样本载流量',
    'rating_air_trefoil': '空气品字形样本载流量', 'rating_air_flat': '空气平排样本载流量',
    'voltage_drop': '电压降', 'minimum_bending_radius': '最小弯曲半径',
}
BAHRA_FIELDS = {'r_dc_20': 'r20', 'lead_sheath_thickness': 'metallic_sheath_thickness',
                'rating_ground_trefoil': 'ampacity'}
IMPORT_FIELDS = {'area', 'conductor_diameter', 'insulation_thickness', 'oversheath_thickness',
                 'outer_diameter', 'weight', 'r20', 'metallic_sheath_thickness', 'ampacity'}


def _data(name):
    if name not in SAMPLES:
        raise ValueError('未知公开样本。')
    data = catalogue.tables(SAMPLES[name]['catalogue'])
    data['source']['url'] = SAMPLES[name]['url']
    if name == 'people-mv':
        data['source']['dataset_manufacturer_label'] = data['manufacturer']
        data['manufacturer'] = '人民电器集团'
    return data


def _sheet_name(table):
    words = table['title'].split()
    return f"{words[0]}{words[1]} {table['designations'][0]}"


def _declarations(name):
    data = _data(name)
    if name == 'people-mv':
        declarations = []
        for table in data['tables']:
            series, _ = catalogue.table_series(data, table['id'])
            # The source PDF is published by People Electric. Preserve the
            # historical dataset identity in the source instead of assigning
            # another manufacturer's identity from an inherited display label.
            series['manufacturer'] = '人民电器集团（公开样本）'
            series['name'] = series['name'].replace(data['manufacturer'], '人民电器集团')
            series['resistance_basis'] = 'standard_limit'
            series['common_basis']['r20'] = ('原样本没有 R20 列；按显式声明由标准依据库查询 GB/T 3956—2008 '
                                            '第 2 类铜导体上限，非厂家实测值。')
            series['reference'] = {'resistance': series['common_basis']['r20'],
                                   'original_standards': data['standards_stated'],
                                   'review_standards': series['standards']}
            mapping = {}
            for index, (field, _unit, _label) in enumerate(table['columns']):
                if field.startswith('weight:'):
                    if field == 'weight:' + series['designation']:
                        mapping['weight'] = index
                else:
                    mapping[field] = index
            declarations.append({'sheet': _sheet_name(table), 'table': table['id'],
                                 'first_data_row': 5, 'mapping': mapping, 'series': series})
        return declarations
    source = deepcopy(data['source'])
    return [{'sheet': BAHRA_SHEET, 'table': 'single-core', 'first_data_row': 5,
             'mapping': {BAHRA_FIELDS.get(field, field): index
                         for index, (field, _unit) in enumerate(data['columns'])
                         if BAHRA_FIELDS.get(field, field) in IMPORT_FIELDS},
             'series': {'name': 'Bahra CU/XLPE/LC/PVC 3.6/6 kV 单芯',
                        'manufacturer': data['manufacturer'], 'designation': data['designation'],
                        'cores': 1, 'u0_v': data['u0_v'], 'u_v': data['u_v'], 'um_v': data['um_v'],
                        'origin': 'public', 'standards': [data['standard']],
                        'conductor': 'copper', 'insulation': 'XLPE', 'metal_sheath': 'lead',
                        'oversheath': 'PVC', 'source': source,
                        'common': {}, 'common_basis': {},
                        'reference': {'conditions': data['conditions'],
                                      'missing': data['not_in_the_catalogue'],
                                      'note': '原始导入未采用目录对照中的屏蔽层厚度假设；缺项保留。'}}}]


def sample_manifest():
    """Download metadata plus explicit, editable declarations for each sheet."""
    return [{'id': name, 'title': info['title'], 'filename': name + '.xlsx',
             'source': _data(name)['source'], 'sha256': sha256(sample_bytes(name)).hexdigest(),
             'declarations': _declarations(name)} for name, info in SAMPLES.items()]


def _stable_xlsx(raw):
    """Stable bytes allow recognition by content rather than a trusted filename."""
    output = BytesIO()
    with ZipFile(BytesIO(raw)) as source, ZipFile(output, 'w', ZIP_DEFLATED) as target:
        for name in sorted(source.namelist()):
            content = source.read(name)
            if name == 'docProps/core.xml':
                content = re.sub(rb'(<dcterms:(?:created|modified)[^>]*>)[^<]*(</dcterms:(?:created|modified)>)',
                                 rb'\g<1>2000-01-01T00:00:00Z\g<2>', content)
            entry = ZipInfo(name, (2000, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o600 << 16
            target.writestr(entry, content)
    return output.getvalue()


def _bahra_workbook(data):
    book = Workbook()
    sheet = book.active
    sheet.title = BAHRA_SHEET
    count = len(data['columns'])
    sheet.cell(1, 1, SAMPLES['bahra-mv']['title'])
    sheet.cell(2, 1, data['source']['url'] + '；' + data['source']['location'])
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=count)
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=count)
    for index, (field, unit) in enumerate(data['columns'], 1):
        sheet.cell(3, index, BAHRA_LABELS[field])
        sheet.cell(4, index, unit.replace('mm2', 'mm²').replace('ohm', 'Ω'))
        sheet.column_dimensions[get_column_letter(index)].width = 17
    for offset, row in enumerate(data['rows'], 5):
        for index, value in enumerate(row, 1):
            sheet.cell(offset, index, value)
    note = ('样本标为近似值；屏蔽层厚度、接地方式和平排间距未公布。'
            '载流量条件：土温 35℃，埋深 0.8 m，土壤热阻率 1.2 K·m/W，60 Hz，导体 90℃。')
    sheet.cell(6 + len(data['rows']), 1, note)
    sheet.merge_cells(start_row=6 + len(data['rows']), start_column=1,
                      end_row=6 + len(data['rows']), end_column=count)
    sheet.freeze_panes = 'C5'
    sheet.auto_filter.ref = f'A4:{get_column_letter(count)}{4 + len(data["rows"])}'
    for row in sheet.iter_rows(min_row=1, max_row=4):
        for cell in row:
            cell.alignment = Alignment(horizontal='left' if cell.row <= 2 else 'center',
                                       vertical='center', wrap_text=True)
            cell.font = Font(bold=True, color='FFFFFF' if cell.row in (1, 3) else '17324D')
            if cell.row in (1, 3):
                cell.fill = PatternFill('solid', fgColor='17324D')
    sheet.row_dimensions[1].height = 25
    sheet.row_dimensions[2].height = 30
    sheet.row_dimensions[3].height = 32
    book.properties.created = book.properties.modified = datetime(2000, 1, 1, tzinfo=timezone.utc)
    result = BytesIO()
    book.save(result)
    return result.getvalue()


@lru_cache(maxsize=16)
def sample_bytes(name, format='xlsx', table=None):
    """Return original table cells; no inferred screens or resistance columns."""
    data = _data(name)
    format = format.lower().lstrip('.')
    if format == 'xlsx':
        if name == 'people-mv':
            output = BytesIO()
            catalogue.workbook(data, output)
            raw = output.getvalue()
        else:
            raw = _bahra_workbook(data)
        return _stable_xlsx(raw)
    if format != 'csv':
        raise ValueError('公开样本支持 .xlsx 和 .csv。')
    if name == 'people-mv':
        selected = next((item for item in data['tables'] if item['id'] == (table or 'single-core')), None)
        if selected is None:
            raise ValueError('公开样本中没有此表。')
        columns, rows = selected['columns'], selected['rows']
        headers = [label + f' ({unit})' for _field, unit, label in columns]
    else:
        if table not in (None, 'single-core'):
            raise ValueError('公开样本中没有此表。')
        rows = data['rows']
        headers = [BAHRA_LABELS[field] + f' ({unit})' for field, unit in data['columns']]
    output = StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode('utf-8-sig')


def match_sample(digest):
    """A name alone cannot attach trusted declarations to an arbitrary upload."""
    for item in sample_manifest():
        if item['sha256'] == digest:
            return deepcopy(item['declarations'])
    return []


def catalogue_reference(sample_id, sheet, area):
    """Four original published metrics, with missing values represented by None."""
    data = _data(sample_id)
    if sample_id == 'bahra-mv':
        if sheet not in (BAHRA_SHEET, 'single-core'):
            raise ValueError('公开样本中没有此表。')
        keys = [key for key, _ in data['columns']]
        row = next((dict(zip(keys, row)) for row in data['rows'] if row[0] == area), None)
        if row is None:
            raise ValueError('公开样本中没有此截面。')
        return {'outer_diameter': row['outer_diameter'], 'weight': row['weight'],
                'r20': row['r_dc_20'], 'ampacity': row['rating_ground_trefoil'],
                'source': data['source'], 'conditions': data['conditions']}
    table = next((item for item in data['tables'] if sheet in (item['id'], _sheet_name(item))), None)
    if table is None:
        raise ValueError('公开样本中没有此表。')
    keys = [key for key, _unit, _label in table['columns']]
    row = next((dict(zip(keys, row)) for row in table['rows'] if row[0] == area), None)
    if row is None:
        raise ValueError('公开样本中没有此截面。')
    ratings = data['ratings']['single_core' if table['cores'] == 1 else 'three_core']
    rating_keys = ratings['columns']
    rating_row = next((dict(zip(rating_keys, values)) for values in ratings['rows'] if values[0] == area), {})
    key = 'ground_trefoil_copper' if table['cores'] == 1 else 'ground_copper'
    return {'outer_diameter': row['outer_diameter'], 'weight': row['weight:' + table['designations'][0]],
            'r20': None, 'ampacity': rating_row.get(key), 'source': data['source'],
            'conditions': data['ratings']['conditions']}
