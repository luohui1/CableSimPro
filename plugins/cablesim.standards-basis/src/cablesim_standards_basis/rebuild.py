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
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def build(excerpts, verification):
    records, tables = [], []
    for table in excerpts['tables']:
        ids = []
        evidence = verification['tables'][table['id']]
        for row_index, row in enumerate(table['rows']):
            if len(row['values']) != len(table['columns']):
                raise ValueError('表格格数不完整：' + table['id'])
            for col_index, column in enumerate(table['columns']):
                record_id = f"{table['id']}/r{row_index+1}/{column['id']}"
                conditions = {**table.get('conditions', {}), **row.get('conditions', {}), **column.get('conditions', {})}
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
                    'axes': row.get('axes', {}),
                    'printed_page': row.get('printed_page', table['printed_page']),
                    'pdf_page': row.get('pdf_page', table['pdf_page']),
                    'source_file': table['source_file'], 'source_sha256': table['source_sha256'],
                    'conditions': conditions, 'quantity': {k: column[k] for k in ('key', 'name', 'dimension', 'unit')},
                    'value': value, 'semantic': column.get('semantic', table.get('semantic', 'standard_limit')),
                    'criterion': column.get('criterion', table.get('criterion', 'nominal')),
                    'limitations': table.get('limitations', []),
                    'verification': {'status': checked['status'], 'evidence_id': table['id'],
                                     'methods': evidence['methods'], 'note': checked.get('note', '')},
                }
                records.append(record)
                ids.append(record_id)
        tables.append({'id': table['id'], 'standard': table['standard'], 'edition': table['edition'],
                       'clause': table['clause'], 'table': table['locator'], 'title': table['title'],
                       'row_count': len(table['rows']), 'column_count': len(table['columns']),
                       'record_count': len(ids), 'record_ids': ids})
    return {'schema': 'cablesim.standards-basis/1', 'version': excerpts['version'],
            'rights': excerpts['rights'], 'sources': excerpts['sources'],
            'tables': tables, 'records': records, 'not_covered': excerpts['not_covered']}


def expected_files(directory=ROOT):
    excerpts = json.loads((directory / 'excerpts.json').read_text('utf-8'))
    verification_raw = (directory / 'verification.json').read_bytes()
    verification = json.loads(verification_raw)
    basis_raw = encode(build(excerpts, verification))
    integrity = {'schema': 'cablesim.standards-integrity/1', 'version': excerpts['version'],
                 'files': {name: {'sha256': sha256(raw).hexdigest(), 'size_bytes': len(raw)}
                           for name, raw in [('basis.json', basis_raw), ('verification.json', verification_raw)]}}
    return {'basis.json': basis_raw, 'integrity.json': encode(integrity)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    changed = []
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
