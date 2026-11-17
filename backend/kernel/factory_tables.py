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
from zipfile import ZipFile, BadZipFile

from fastapi import HTTPException
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from studio.core.studio_core import structure

IMPORT_METHOD = {'name': '厂家结构表导入', 'version': '1.0.0'}
MAX_BYTES, MAX_ROWS, MAX_COLUMNS = 10 * 1024 * 1024, 2000, 80
FIELDS = {**structure.FIELDS,
    'metallic_sheath_thickness': ('金属套厚度', 'mm', .001, ['金属套厚度', '铅套厚度', '铝套厚度', 'Lead sheath thickness']),
    'buffer_thickness': ('缓冲层厚度', 'mm', .001, ['缓冲层厚度', '缓冲层']),
    'separator_thickness': ('隔离层厚度', 'mm', .001, ['隔离层厚度', '沥青层厚度']),
    'corrugation_depth': ('金属套波纹深度', 'mm', .001, ['波纹深度', '波深']),
    'corrugation_pitch': ('金属套波纹节距', 'mm', .001, ['波纹节距', '波距']),
    'screen_wire_diameter': ('屏蔽铜丝直径', 'mm', .001, ['屏蔽铜丝直径', '铜丝直径']),
    'screen_wire_count': ('屏蔽铜丝根数', '根', 1, ['屏蔽铜丝根数', '铜丝根数']),
    'ampacity': ('样本载流量', 'A', 1, ['样本载流量', '载流量', 'Ampacity']),
}
SI_UNITS = {'mm': 'm', 'mm²': 'm2', 'Ω/km': 'ohm/m', 'kg/km': 'kg/m', '根': '1', '%': '1', 'A': 'A'}
NUMBER = re.compile(r'^[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?$')


def fail(code, message, status=422):
    raise HTTPException(status, {'code': code, 'message': message})


def number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (float, int)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str) and NUMBER.fullmatch(value.strip()):
        parsed = float(value.strip().replace(',', '.'))
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
    from studio.core.studio_core.tables import _layout
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
