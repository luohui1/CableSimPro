"""Rebuild indexes from reviewed numeric excerpts; never opens original standards.

Run: python plugins/cablesim.standards-basis/src/cablesim_standards_basis/rebuild.py [--write]
The default is a read-only consistency check. Excerpts and verification are the
reviewed authoring inputs; basis.json and integrity.json are deterministic views.
"""
from copy import deepcopy
from hashlib import sha256
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).parent


def encode(value):
    raw = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    # Compact large authoring matrices; compiled records remain split by standard.
    if len(raw) > 900_000:
        raw = (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    if len(raw) >= 976 * 1024:
        raise ValueError('编制输入超过单文件卫生限制，须分册：'+str(len(raw)))
    return raw


def build(excerpts, verification):
    records, tables = [], []
    for table in excerpts['tables']:
        ids = []
        evidence = verification['tables'][table['id']]
        if len(evidence['methods']) < 2 or len(evidence['cells']) != len(table['rows']):
            raise ValueError('两路核验或行数不完整：' + table['id'])
        for row_index, row in enumerate(table['rows']):
            if len(row['values']) != len(table['columns']):
                raise ValueError('表格格数不完整：' + table['id'])
            if len(evidence['cells'][row_index]) != len(table['columns']):
                raise ValueError('核验列数不完整：' + table['id'])
            for col_index, column in enumerate(table['columns']):
                definition = {**column, **row.get('cell_definitions', {}).get(column['id'], {})}
                record_id = f"{table['id']}/r{row_index+1}/{column['id']}"
                conditions = {**table.get('conditions', {}), **row.get('conditions', {}), **column.get('conditions', {}), **definition.get('conditions', {})}
                checked = evidence['cells'][row_index][col_index]
                value = deepcopy(row['values'][col_index])
                if checked['status'] == 'verified' and (checked['route_a'] != value or checked['route_b'] != value):
                    raise ValueError('核验值与提取值不同：' + record_id)
                if checked['status'] not in ('verified', 'blocked'):
                    raise ValueError('未知核验状态：' + record_id)
                record = {
                    'id': record_id, 'standard': table['standard'], 'edition': table['edition'],
                    'clause': table['clause'], 'table': table['locator'], 'title': table['title'],
                    'row': row_index + 1, 'column': column['id'], 'row_label': row['label'],
                    'axes': row.get('axes', {}), 'column_conditions': column.get('conditions', {}),
                    'column_header': {'name': column['name'], 'unit': column['unit']},
                    'printed_page': row.get('printed_page', table['printed_page']),
                    'pdf_page': row.get('pdf_page', table['pdf_page']),
                    'source_file': table['source_file'], 'source_sha256': table['source_sha256'],
                    'conditions': conditions, 'quantity': {k: definition[k] for k in ('key', 'name', 'dimension', 'unit')},
                    'value': value, 'semantic': definition.get('semantic', table.get('semantic', 'standard_limit')),
                    'criterion': definition.get('criterion', table.get('criterion', 'nominal')),
                    'limitations': table.get('limitations', []),
                    'verification': {'status': checked['status'], 'evidence_id': table['id'],
                                     'methods': evidence['methods'], 'note': checked.get('note', '')},
                }
                records.append(record)
                if 'value_details' in definition:
                    record['value_details']=deepcopy(definition['value_details'])
                elif isinstance(value,str) and value in table.get('value_details',{}):
                    record['value_details']=deepcopy(table['value_details'][value])
                ids.append(record_id)
        tables.append({'id': table['id'], 'standard': table['standard'], 'edition': table['edition'],
                       'clause': table['clause'], 'table': table['locator'], 'title': table['title'],
                       'quantities': list({r['quantity']['key']: r['quantity'] for r in records if r['id'] in ids}.values()),
                       'row_count': len(table['rows']), 'column_count': len(table['columns']),
                       'record_count': len(ids), 'record_ids': ids})
    return {'schema': 'cablesim.standards-basis/1', 'version': excerpts['version'],
            'rights': excerpts['rights'], 'sources': excerpts['sources'],
            'condition_fields': excerpts.get('condition_fields', {}),
            'tables': tables, 'records': records, 'not_covered': excerpts['not_covered']}


def expected_files(directory=ROOT):
    excerpts = json.loads((directory / 'excerpts.json').read_text('utf-8'))
    verification = json.loads((directory / 'verification.json').read_bytes())
    verification_raw = encode(verification)
    basis = build(excerpts, verification)
    names = {'GB/T 12706.1':'lv','GB/T 12706.2':'mv','GB/T 12706.3':'medium-high',
             'GB/T 3956':'conductor-gb','IEC 60228':'conductor-iec','GB/T 11017.2':'high',
             'GB 50217':'installation','IEC 60287-1-1':'electrical','IEC 60287-2-1':'thermal',
             'IEC 60287-3-1':'environment','GB/T 12706.4':'accessories',
             'Nielsen et al.':'thermal-capacity','Huang and Niu':'thermal-capacity-model'}
    compiled = {}
    for standard, suffix in names.items():
        selected = [r for r in basis['records'] if r['standard']==standard]
        if selected:
            # Bound compiled files below the 976 KiB hygiene limit. Whole records
            # stay together; alphabetic suffixes keep names valid for the loader.
            parts, current, size = [], [], 3
            for record in selected:
                raw = json.dumps(record,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
                if len(raw) + 3 > 900_000:
                    raise ValueError('单条依据过大：' + record['id'])
                if current and size + len(raw) + 1 > 900_000:
                    parts.append(current); current, size = [], 3
                current.append(record); size += len(raw) + 1
            parts.append(current)
            for index, part in enumerate(parts):
                if index > 25:
                    raise ValueError('分册数超出当前编制范围。')
                name = 'records-'+suffix+('' if index == 0 else '-'+chr(96+index))+'.json'
                compiled[name] = (json.dumps(part,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode('utf-8')
    if sum(len(json.loads(raw)) for raw in compiled.values()) != len(basis['records']):
        raise ValueError('新标准必须声明编制文件名。')
    basis.pop('records')
    basis['record_files'] = [{'name':name,'sha256':sha256(raw).hexdigest(),'size_bytes':len(raw)} for name,raw in compiled.items()]
    basis_raw = encode(basis)
    compiled.update({'basis.json':basis_raw,'verification.json':verification_raw})
    integrity = {'schema': 'cablesim.standards-integrity/1', 'version': excerpts['version'],
                 'files': {name: {'sha256': sha256(raw).hexdigest(), 'size_bytes': len(raw)}
                           for name, raw in compiled.items()}}
    compiled['integrity.json']=encode(integrity)
    return compiled


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    changed = []
    # Git forces LF in sealed source payloads. Authoring on Windows must emit
    # those same bytes before sealing, including verification's data digest.
    for name in ('excerpts.json', 'verification.json', 'query.schema.json'):
        path = ROOT / name
        expected = encode(json.loads(path.read_bytes()))
        if path.read_bytes() != expected:
            changed.append(name)
            if args.write:
                path.write_bytes(expected)
    for name, expected in expected_files().items():
        path = ROOT / name
        if not path.exists() or path.read_bytes() != expected:
            changed.append(name)
            if args.write:
                path.write_bytes(expected)
    print(json.dumps({'changed': changed, 'written': args.write}, ensure_ascii=False))
    if changed and not args.write:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
