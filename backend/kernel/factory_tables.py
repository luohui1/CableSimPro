"""Bounded, lossless structure-table reading; engineering values are never repaired.

The vocabulary is shared with the migrated Studio constructor.  Uploaded cells
remain source facts, including fields that no installed method can yet consume.
"""
from copy import deepcopy
import csv
from hashlib import sha256
from io import BytesIO, StringIO
import math
from pathlib import Path
import re
import struct
from zipfile import ZipFile, BadZipFile

from fastapi import HTTPException
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from .catalogue_core import structure

IMPORT_METHOD = {'name': '厂家结构表导入', 'version': '1.1.0'}
MAX_BYTES, MAX_ROWS, MAX_COLUMNS = 10 * 1024 * 1024, 2000, 80
# Published performance is evidence, not a replacement for geometry, material
# properties or operating inputs. This explicit vocabulary is also the whitelist
# excluded from every constructor; adding a structural field cannot exclude it.
CATALOGUE_FIELDS = {
    'ampacity': ('样本载流量', 'A', 1, ['样本载流量', '载流量', 'Ampacity']),
    'r_ac_90': ('样本90℃交流电阻', 'Ω/km', 1e-3, ['90℃交流电阻', '90°C交流电阻']),
    'inductance': ('样本电感', 'mH/km', 1e-6, ['电感', 'Inductance']),
    'capacitance': ('样本电容', 'uF/km', 1e-9, ['电容', 'Capacitance']),
    'short_circuit_conductor': ('样本导体短路电流（1 s）', 'kA', 1e3, ['导体短路电流1s', '导体短路电流（1s）']),
    'short_circuit_sheath': ('样本铅套短路电流（1 s）', 'kA', 1e3, ['铅套短路电流1s', '铅套短路电流（1s）']),
    'rating_ground_flat': ('样本直埋平排载流量', 'A', 1, ['直埋平排样本载流量', '直埋平排载流量']),
    'rating_air_trefoil': ('样本空气品字形载流量', 'A', 1, ['空气品字形样本载流量', '空气品字形载流量']),
    'rating_air_flat': ('样本空气平排载流量', 'A', 1, ['空气平排样本载流量', '空气平排载流量']),
    'voltage_drop': ('样本电压降', 'V/(A km)', 1e-3, ['电压降', 'Voltagedrop']),
    'minimum_bending_radius': ('样本最小弯曲半径', 'mm', 1e-3, ['最小弯曲半径', 'Minimumbendingradius']),
}
SOURCE_ONLY_FIELDS = frozenset(CATALOGUE_FIELDS)
FIELDS = {**structure.FIELDS,
    'metallic_sheath_thickness': ('金属套厚度', 'mm', .001, ['金属套厚度', '铅套厚度', '铝套厚度', 'Lead sheath thickness']),
    'buffer_thickness': ('缓冲层厚度', 'mm', .001, ['缓冲层厚度', '缓冲层']),
    'separator_thickness': ('隔离层厚度', 'mm', .001, ['隔离层厚度', '沥青层厚度']),
    'corrugation_depth': ('金属套波纹深度', 'mm', .001, ['波纹深度', '波深']),
    'corrugation_pitch': ('金属套波纹节距', 'mm', .001, ['波纹节距', '波距']),
    'screen_wire_diameter': ('屏蔽铜丝直径', 'mm', .001, ['屏蔽铜丝直径', '铜丝直径']),
    'screen_wire_count': ('屏蔽铜丝根数', '根', 1, ['屏蔽铜丝根数', '铜丝根数']),
    **CATALOGUE_FIELDS,
}
SI_UNITS = {'mm': 'm', 'mm²': 'm2', 'Ω/km': 'ohm/m', 'kg/km': 'kg/m', '根': '1', '%': '1', 'A': 'A',
            'mH/km': 'H/m', 'uF/km': 'F/m', 'kA': 'A', 'V/(A km)': 'V/(A m)'}
# A text comma could be either a decimal separator or a thousands separator.
# Without a declared locale, accepting it would silently change source values.
NUMBER = re.compile(r'^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$')


def fail(code, message, status=422):
    raise HTTPException(status, {'code': code, 'message': message})


def number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (float, int)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str) and NUMBER.fullmatch(value.strip()):
        parsed = float(value.strip())
        return parsed if math.isfinite(parsed) else None
    return None


def cell(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            return str(value)
        return value
    return str(value).strip() or None


def bounded(name, grid):
    if len(grid) > MAX_ROWS or max(map(len, grid), default=0) > MAX_COLUMNS:
        fail('TABLE_TOO_LARGE', f'工作表“{name}”超过 {MAX_ROWS} 行或 {MAX_COLUMNS} 列；请拆分后导入，未截掉任何行列。')
    return grid


def reject_xls_formulas(book):
    """xlrd exposes cached formula results as numbers; they are not source facts.

    Inspect the worksheet records in the original BIFF stream before asking the
    pinned xlrd 2.0.1 reader for cells. Older BIFF releases discard that stream
    while opening, so refuse them instead of accepting unverifiable caches.
    """
    from xlrd.biffh import XL_FORMULA_OPCODES

    if book.biff_version < 50 or book.mem is None:
        fail('TABLE_XLS_VERSION', '此旧版 XLS 无法核验公式来源，请另存为 XLSX 后导入；未采用缓存数值。')
    for name, position in zip(book.sheet_names(), book._sh_abs_posn):
        while position + 4 <= len(book.mem):
            code, length = struct.unpack_from('<HH', book.mem, position)
            position += 4
            if position + length > len(book.mem):
                fail('TABLE_UNREADABLE', 'XLS 工作表记录不完整，请提供未损坏的原件。')
            if code in XL_FORMULA_OPCODES:
                row, column = struct.unpack_from('<HH', book.mem, position)
                address = f'{get_column_letter(column + 1)}{row + 1}'
                fail('TABLE_XLS_FORMULA', f'工作表“{name}”的 {address} 含公式，不能把旧版 XLS 的缓存值当作原始数值。'
                     '请另存为保留公式的 XLSX，或提供有来源的数值结构表。')
            position += length
            if code == 0x000A:  # end of the worksheet substream
                break


def read(filename, content):
    if not content or len(content) > MAX_BYTES:
        fail('TABLE_FILE_SIZE', '请选择非空且不超过 10 MB 的结构表。')
    name = Path(filename.replace('\\', '/')).name
    extension = Path(name).suffix.lower()
    if extension not in ('.xlsx', '.csv', '.xls'):
        fail('TABLE_FORMAT', '支持 Excel .xlsx、.xls 和 .csv 结构表。')
    try:
        if extension == '.xlsx':
            with ZipFile(BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > 2000 or sum(item.file_size for item in entries) > 40 * 1024 * 1024:
                    fail('TABLE_TOO_LARGE', '工作簿展开后过大，请拆分后导入。')
            book = load_workbook(BytesIO(content), data_only=False, keep_links=False)
            sheets = []
            try:
                for sheet in book.worksheets:
                    if sheet.sheet_state != 'visible':
                        continue
                    if sheet.max_row > MAX_ROWS or sheet.max_column > MAX_COLUMNS:
                        fail('TABLE_TOO_LARGE', f'工作表“{sheet.title}”超过 {MAX_ROWS} 行或 {MAX_COLUMNS} 列。')
                    grid = [[cell(item.value) for item in row] for row in sheet.iter_rows()]
                    for merged in sheet.merged_cells.ranges:
                        value = grid[merged.min_row - 1][merged.min_col - 1]
                        for row in range(merged.min_row - 1, merged.max_row):
                            for column in range(merged.min_col - 1, merged.max_col):
                                grid[row][column] = value
                    sheets.append({'name': sheet.title, 'grid': bounded(sheet.title, grid)})
            finally:
                book.close()
        elif extension == '.xls':
            import xlrd
            book = xlrd.open_workbook(file_contents=content, on_demand=True)
            try:
                reject_xls_formulas(book)
                sheets = []
                for sheet in book.sheets():
                    if sheet.nrows > MAX_ROWS or sheet.ncols > MAX_COLUMNS:
                        fail('TABLE_TOO_LARGE', f'工作表“{sheet.name}”超过大小限制。')
                    sheets.append({'name': sheet.name, 'grid': bounded(sheet.name,
                        [[cell(sheet.cell_value(row, column)) for column in range(sheet.ncols)] for row in range(sheet.nrows)])})
            finally:
                book.release_resources()
        else:
            for encoding in ('utf-8-sig', 'gb18030'):
                try:
                    text = content.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                fail('TABLE_ENCODING', 'CSV 须采用 UTF-8 或 GB18030 编码。')
            try:
                dialect = csv.Sniffer().sniff(text[:4000], delimiters=',\t;')
            except csv.Error:
                dialect = csv.excel
            grid = []
            for row in csv.reader(StringIO(text), dialect):
                grid.append([cell(value) for value in row])
                bounded(name, grid)
            sheets = [{'name': Path(name).stem, 'grid': grid}]
    except HTTPException:
        raise
    except Exception as error:
        fail('TABLE_UNREADABLE', f'结构表无法读取（{type(error).__name__}），请确认文件未损坏或加密。')
    if not sheets or not any(any(any(v is not None for v in row) for row in s['grid']) for s in sheets):
        fail('TABLE_EMPTY', '结构表没有可见内容。')
    return {'file': name, 'sha256': sha256(content).hexdigest(), 'size': len(content), 'sheets': sheets}


def vocabulary():
    return [{'key': key, 'label': label, 'unit': unit, 'si_unit': SI_UNITS[unit]}
            for key, (label, unit, _, _) in FIELDS.items()]


def inspect(upload, designation=None):
    from .catalogue_core.tables import _layout
    inspected = []
    for sheet in upload['sheets']:
        grid = sheet['grid']
        layout = _layout(grid)
        if layout is None:
            start = next((i for i, row in enumerate(grid) if sum(number(v) is not None for v in row) >= 2), None)
            if start is None:
                inspected.append({'name': sheet['name'], 'rows': len(grid), 'table': False, 'columns': []})
                continue
            layout = (start, [start - 1] if start else [], max(map(len, grid), default=0))
        start, headers, width = layout
        columns, used = [], set()
        for index in range(width):
            parts = list(dict.fromkeys(str(grid[r][index]) for r in headers if index < len(grid[r]) and grid[r][index] is not None))
            header = ' '.join(parts)
            candidates = [(len(alias), key) for key, (_, _, _, aliases) in FIELDS.items()
                          for alias in aliases if alias.lower() in re.sub(r'\s+', '', header).lower()]
            suggested = max(candidates)[1] if candidates else None
            if suggested == 'weight' and designation:
                names = re.findall(r'YJ[A-Z]*\d*', header.upper())
                if names and designation.upper() not in names:
                    suggested = None
            if suggested in used:
                suggested = None
            if suggested:
                used.add(suggested)
            columns.append({'index': index, 'letter': get_column_letter(index + 1), 'header': header,
                            'suggested': suggested, 'sample': [row[index] if index < len(row) else None for row in grid[start:start + 3]]})
        inspected.append({'name': sheet['name'], 'rows': len(grid), 'table': True,
                          'first_data_row': start + 1, 'data_rows': len(grid) - start,
                          'header_rows': [r + 1 for r in headers], 'columns': columns})
    return {key: upload[key] for key in ('file', 'sha256', 'size')} | {'sheets': inspected, 'fields': vocabulary()}


def mapped_rows(upload, sheet_name, first_data_row, mapping):
    sheet = next((item for item in upload['sheets'] if item['name'] == sheet_name), None)
    if sheet is None:
        fail('TABLE_SHEET_UNKNOWN', '请选择文件中存在的工作表。')
    grid = sheet['grid']
    width = max(map(len, grid), default=0)
    if (not mapping or 'area' not in mapping or any(key not in FIELDS for key in mapping)
            or any(type(index) is not int or not 0 <= index < width for index in mapping.values())
            or len(set(mapping.values())) != len(mapping)):
        fail('TABLE_MAPPING_INVALID', '请映射标称截面；每列只能对应一个有效字段，列序号不能越界。')
    if type(first_data_row) is not int or not 1 <= first_data_row <= len(grid):
        fail('TABLE_ROW_INVALID', '数据起始行须在所选工作表范围内。')
    results, skipped = [], []
    for row_number, raw in enumerate(grid[first_data_row - 1:], first_data_row):
        cells = {key: raw[column] if column < len(raw) else None for key, column in mapping.items()}
        if all(value is None for value in cells.values()):
            continue
        # An isolated text footer is not a specification. A malformed area in
        # an otherwise numeric row is an error, never a silently skipped size.
        if all(number(value) is None for value in cells.values()) and len({str(v) for v in cells.values() if v is not None}) == 1:
            skipped.append({'row': row_number, 'text': str(next(v for v in cells.values() if v is not None))})
            continue
        values, problems = {}, []
        for key, value in cells.items():
            if value is None:
                continue
            parsed = number(value)
            column = f'{get_column_letter(mapping[key] + 1)}{row_number}'
            if parsed is None or parsed <= 0:
                problems.append({'column': column, 'field': key, 'message': f'{FIELDS[key][0]}须为正数，原单元格为“{value}”。'})
            elif key.endswith('_count') and not parsed.is_integer():
                problems.append({'column': column, 'field': key, 'message': f'{FIELDS[key][0]}须为整数。'})
            elif key.endswith('_overlap') and parsed > 100:
                problems.append({'column': column, 'field': key, 'message': '搭盖率不能超过 100 %。'})
            else:
                values[key] = parsed
        if 'area' not in values and not any(p['field'] == 'area' for p in problems):
            problems.append({'column': f'{get_column_letter(mapping["area"] + 1)}{row_number}', 'field': 'area', 'message': '标称截面缺失。'})
        results.append({'row_number': row_number, 'raw': deepcopy(cells), 'values': values, 'issues': problems})
    return results, skipped
