"""Reading a factory's structure table from a workbook.

A structure table is a sheet with a title, one to three header rows (often with merged cells and the unit under
the name) and one row per size. This module reads the cells as they are, proposes which column is which field,
and returns the rows of the columns the engineer confirmed. It does not repair a table: a cell that is not a
number is reported with its address.
"""
from pathlib import Path
import csv
import re

from . import CoreError
from .structure import FIELDS

MAX_ROWS, MAX_COLUMNS = 2000, 80
_NUMBER = re.compile(r'^[\s]*[-+]?\d+(?:[.,]\d+)?[\s]*$')


def _letter(index):
    text = ''
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        text = chr(65 + rest) + text
    return text


def _cell(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        return float(value) if value == value else None
    text = str(value).strip()
    return text or None


def _workbook(path):
    from openpyxl import load_workbook
    book = load_workbook(path, data_only=True)
    sheets = []
    for sheet in book.worksheets:
        if sheet.sheet_state != 'visible':
            continue
        height, width = min(sheet.max_row, MAX_ROWS), min(sheet.max_column, MAX_COLUMNS)
        grid = [[_cell(sheet.cell(row=row, column=column).value) for column in range(1, width + 1)] for row in range(1, height + 1)]
        # A merged header cell names every column it spans.
        for merged in sheet.merged_cells.ranges:
            value = _cell(sheet.cell(row=merged.min_row, column=merged.min_col).value)
            for row in range(merged.min_row, min(merged.max_row, height) + 1):
                for column in range(merged.min_col, min(merged.max_col, width) + 1):
                    grid[row - 1][column - 1] = value
        sheets.append((sheet.title, grid))
    return sheets


def _legacy_workbook(path):
    import xlrd
    book = xlrd.open_workbook(path, formatting_info=False)
    sheets = []
    for sheet in book.sheets():
        grid = [[_cell(sheet.cell_value(row, column)) for column in range(min(sheet.ncols, MAX_COLUMNS))] for row in range(min(sheet.nrows, MAX_ROWS))]
        for low_row, high_row, low_column, high_column in sheet.merged_cells:
            for row in range(low_row, min(high_row, len(grid))):
                for column in range(low_column, min(high_column, MAX_COLUMNS)):
                    grid[row][column] = grid[low_row][low_column]
        sheets.append((sheet.name, grid))
    return sheets


def _delimited(path):
    raw = Path(path).read_bytes()
    for encoding in ('utf-8-sig', 'gb18030'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise CoreError('TABLE_UNREADABLE', '文本表格的编码不是 UTF-8 或 GB18030。')
    dialect = csv.Sniffer().sniff(text[:4000], delimiters=',\t;') if text.strip() else csv.excel
    return [(Path(path).stem, [[_cell(_number(value) if _NUMBER.match(value) else value) for value in row[:MAX_COLUMNS]]
                               for row in list(csv.reader(text.splitlines(), dialect))[:MAX_ROWS]])]


def _number(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str) and _NUMBER.match(value):
        return float(value.strip().replace(',', '.'))
    return None


def _grids(path):
    path = Path(path)
    if not path.is_file():
        raise CoreError('TABLE_MISSING', '找不到上传的文件。')
    suffix = path.suffix.lower()
    try:
        if suffix in ('.xlsx', '.xlsm'):
            return _workbook(path)
        if suffix == '.xls':
            return _legacy_workbook(path)
        if suffix in ('.csv', '.tsv', '.txt'):
            return _delimited(path)
    except CoreError:
        raise
    except Exception as error:  # noqa: BLE001 - a damaged or password-protected workbook
        raise CoreError('TABLE_UNREADABLE', f'这个文件打不开：{type(error).__name__}。请确认是未加密的 Excel 工作簿。') from None
    raise CoreError('TABLE_UNSUPPORTED', '支持 .xlsx、.xls 和 .csv 的结构表。')


def _layout(grid):
    """Where the data starts: the first of three consecutive rows that are mostly numbers."""
    width = max((len(row) for row in grid), default=0)
    numeric = [sum(1 for value in row if _number(value) is not None) for row in grid]
    filled = [sum(1 for value in row if value is not None) for row in grid]
    for index in range(len(grid)):
        window = range(index, min(index + 3, len(grid)))
        if len(window) >= 2 and all(numeric[row] >= 3 and numeric[row] >= filled[row] * .6 for row in window):
            start = index
            break
    else:
        return None
    header = []
    for index in range(start - 1, max(start - 4, -1), -1):
        # A blank line or a title ends the header; a title merged across the sheet repeats one text in every column.
        if filled[index] < max(2, width // 3) or len({value for value in grid[index] if value is not None}) < 2:
            break
        header.insert(0, index)
    return start, header, width


def _suggest(header, designation):
    """The field a column header names: the longest known word in it wins."""
    compact = re.sub(r'\s+', '', header or '')
    best = None
    for key, (label, unit, _, aliases) in FIELDS.items():
        for alias in aliases:
            if alias in compact and (best is None or len(alias) > best[1]):
                best = (key, len(alias))
    if best and best[0] == 'weight' and designation:
        # One weight column per designation: only the one that names this designation is the series' weight.
        others = re.findall(r'YJ[A-Z]*\d*', compact.upper())
        if others and designation.upper() not in others:
            return None
    return best[0] if best else None


def inspect(path, designation=None):
    """Each sheet with its header, a proposed field per column and the first rows, for the engineer to confirm."""
    sheets = []
    for name, grid in _grids(path):
        layout = _layout(grid)
        if layout is None:
            sheets.append({'name': name, 'rows': len(grid), 'table': False})
            continue
        start, header, width = layout
        columns, taken = [], set()
        for column in range(width):
            parts = []
            for row in header:
                value = grid[row][column] if column < len(grid[row]) else None
                if isinstance(value, str) and value not in parts:
                    parts.append(value)
            text = ' '.join(parts)
            values = [grid[row][column] if column < len(grid[row]) else None for row in range(start, min(start + 200, len(grid)))]
            if not text and all(value is None for value in values):
                continue
            suggested = _suggest(text, designation)
            if suggested in taken:
                suggested = None
            if suggested:
                taken.add(suggested)
            columns.append({'index': column, 'letter': _letter(column), 'header': text, 'suggested': suggested,
                            'sample': [value for value in values[:3]]})
        data_rows = sum(1 for row in grid[start:] if any(_number(value) is not None for value in row))
        title = next((value for row in grid[:header[0] if header else start] for value in row if isinstance(value, str)), None)
        sheets.append({'name': name, 'rows': len(grid), 'table': True, 'title': title, 'header_rows': [row + 1 for row in header],
                       'first_data_row': start + 1, 'data_rows': data_rows, 'columns': columns})
    return {'file': Path(path).name, 'sheets': sheets,
            'fields': [{'key': key, 'label': label, 'unit': unit} for key, (label, unit, _, _) in FIELDS.items()]}


def rows(path, sheet, first_data_row, mapping):
    """The rows of one sheet as field values, by the confirmed mapping {field: column index}."""
    grid = next((grid for name, grid in _grids(path) if name == sheet), None)
    if grid is None:
        raise CoreError('TABLE_SHEET_UNKNOWN', f'工作簿里没有名为“{sheet}”的工作表。', '/sheet')
    unknown = [key for key in mapping if key not in FIELDS]
    if unknown:
        raise CoreError('TABLE_MAPPING_INVALID', f'未收录的字段：{unknown[0]}。', f'/mapping/{unknown[0]}')
    if 'area' not in mapping:
        raise CoreError('TABLE_MAPPING_INVALID', '请指明哪一列是标称截面。', '/mapping/area')
    result, skipped = [], []
    for index in range(first_data_row - 1, len(grid)):
        row = grid[index]
        cell = lambda column: row[column] if column < len(row) else None
        if all(value is None for value in row):
            continue
        area = _number(cell(mapping['area']))
        if area is None:
            text = next((value for value in row if isinstance(value, str)), '')
            skipped.append({'row': index + 1, 'text': text[:120]})
            continue
        values, problems = {}, []
        for key, column in mapping.items():
            value = cell(column)
            if value is None:
                continue
            number = _number(value)
            if number is None:
                problems.append({'cell': f'{_letter(column)}{index + 1}', 'field': FIELDS[key][0], 'text': str(value)[:40]})
            else:
                values[key] = number
        result.append({'row': index + 1, 'values': values, 'problems': problems})
    return {'rows': result, 'skipped': skipped}
