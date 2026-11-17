"""Verify the 877 transcribed catalogue cells against the original manufacturer PDFs.

Usage: python scripts/verify_catalogue_originals.py --output <new-directory>
Optional --people-pdf and --bahra-pdf use local originals instead of downloading
the fixed official URLs. --catalogue-root selects a copy of the two JSON files.
No application, importer or calculation plugin is used. All output is evidence,
not product approval; the 46 unpublished People R20 entries remain absent.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import fitz

ROOT = Path(__file__).resolve().parents[1]
METHOD_VERSION = '1.0.0'
MAX_PDF_BYTES = 32 * 1024 * 1024
NETWORK_TIMEOUT = 30
DOWNLOAD_SECONDS = 120
SOURCES = {
    'people': {
        'file': 'people_mv_xlpe.json', 'pages': 6,
        'url': 'https://www.chinapeople.com/pdf/sh/dxdl/8.7-10kV.pdf',
        'sha256': 'c60b53c188478b55f424f49ca31506c5f7c100d2c876f91aab65622e86ddba4a',
        'hosts': {'www.chinapeople.com', 'chinapeople.com'},
        'render_pages': (1, 2, 3, 4, 5, 6),
    },
    'bahra': {
        'file': 'bahra_mv_lead_sheathed.json', 'pages': 124,
        'url': 'https://www.bahra-electric.com/Downloads/MV_Lead_Sheathed.pdf',
        'sha256': '6c0d7cf7e92a7292d3b1c3a0ed07a956ac17005c2918c1debd6234c7c155243a',
        'hosts': {'www.bahra-electric.com', 'bahra-electric.com'},
        'render_pages': (12, 18, 19),
    },
}
AREAS = (25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630)

# Field order and units are transcribed from the fixed PDF headers, independently
# of the catalogue JSON. Original header text and coordinates are also retained.
COMMON = [('area', 'mm2'), ('conductor_diameter', 'mm'), ('insulation_thickness', 'mm')]
PLAIN = COMMON + [('oversheath_thickness', 'mm'), ('outer_diameter', 'mm')]
ARMOURED = COMMON + [('bedding_thickness', 'mm')]
PEOPLE_COLUMNS = {
    'single-core': PLAIN + [(f'weight:{name}', 'kg/km') for name in ('YJV', 'YJY', 'YJLV', 'YJLY')],
    'three-core': PLAIN + [(f'weight:{name}', 'kg/km') for name in ('YJV', 'YJY', 'YJLV', 'YJLY')],
    'three-core-steel-tape': ARMOURED + [('armour_tape_thickness', 'mm'), ('oversheath_thickness', 'mm'),
        ('outer_diameter', 'mm')] + [(f'weight:{name}', 'kg/km') for name in ('YJV22', 'YJY23', 'YJLV22', 'YJLY23')],
    'three-core-steel-wire': ARMOURED + [('armour_wire_diameter', 'mm'), ('oversheath_thickness', 'mm'),
        ('outer_diameter', 'mm')] + [(f'weight:{name}', 'kg/km') for name in ('YJV32', 'YJY33', 'YJLV32', 'YJLY33')],
}
PEOPLE_GRIDS = {
    'single-core': (2, (207, 205, 548, 374), (195, 140, 550, 210), AREAS),
    'three-core': (2, (207, 445, 548, 589), (195, 382, 550, 450), AREAS[:11]),
    'three-core-steel-tape': (3, (207, 168, 548, 313), (195, 95, 550, 174), AREAS[:11]),
    'three-core-steel-wire': (4, (207, 168, 548, 313), (195, 95, 550, 174), AREAS[:11]),
}
RATING_COLUMNS = {
    'three_core': [('area', 'mm2')] + [(key, 'A') for key in
        ('air_copper', 'air_aluminium', 'ground_copper', 'ground_aluminium')],
    'single_core': [('area', 'mm2')] + [(key, 'A') for key in
        ('air_trefoil_copper', 'air_trefoil_aluminium', 'air_flat_copper', 'air_flat_aluminium',
         'ground_trefoil_copper', 'ground_trefoil_aluminium', 'ground_flat_copper', 'ground_flat_aluminium')],
}
BAHRA_STRUCTURE = COMMON + [('lead_sheath_thickness', 'mm'), ('oversheath_thickness', 'mm'),
                          ('outer_diameter', 'mm'), ('weight', 'kg/km')]
BAHRA_TECHNICAL = [('area', 'mm2'), ('r_dc_20', 'ohm/km'), ('r_ac_90', 'ohm/km'),
    ('inductance', 'mH/km'), ('reactance', 'ohm/km'), ('capacitance', 'uF/km'),
    ('short_circuit_conductor', 'kA'), ('short_circuit_sheath', 'kA'),
    ('rating_ground_trefoil', 'A'), ('rating_ground_flat', 'A'),
    ('rating_air_trefoil', 'A'), ('rating_air_flat', 'A'),
    ('voltage_drop', 'V/(A km)'), ('minimum_bending_radius', 'mm')]
BAHRA_COLUMNS = BAHRA_STRUCTURE + [item for item in BAHRA_TECHNICAL[1:] if item[0] != 'reactance']
EXPECTED_COUNTS = {
    'people.single-core': 117, 'people.three-core': 99,
    'people.three-core-steel-tape': 121, 'people.three-core-steel-wire': 121,
    'people.ratings.three_core': 55, 'people.ratings.single_core': 117,
    'bahra.single-core': 247,
}


class AuditError(ValueError):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code


def require(condition, code, detail):
    if not condition:
        raise AuditError(code, detail)


def official_url(url, source):
    parsed = urlsplit(url)
    require(parsed.scheme == 'https' and parsed.hostname in source['hosts']
            and parsed.port in (None, 443) and parsed.username is None and parsed.password is None,
            'SOURCE_REDIRECT', f'Refusing a URL outside the official HTTPS source: {url}')


class OfficialRedirect(HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 1

    def __init__(self, source):
        super().__init__()
        self.source = source

    def redirect_request(self, request, fp, code, message, headers, newurl):
        official_url(newurl, self.source)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def pdf_bytes(name, local_path):
    source = SOURCES[name]
    if local_path is not None:
        require(local_path.is_file(), 'SOURCE_MISSING', f'{name}: original PDF is not a file: {local_path}')
        require(local_path.stat().st_size <= MAX_PDF_BYTES, 'SOURCE_SIZE', f'{name}: PDF exceeds size limit')
        data = local_path.read_bytes()
        origin = {'mode': 'local', 'path': str(local_path.resolve())}
    else:
        request = Request(source['url'], headers={'User-Agent': 'CableSimPro catalogue-source-verification/1.0',
                                                'Accept': 'application/pdf', 'Accept-Encoding': 'identity'})
        started = time.monotonic()
        try:
            with build_opener(OfficialRedirect(source)).open(request, timeout=NETWORK_TIMEOUT) as response:
                official_url(response.geturl(), source)
                require(response.status == 200, 'SOURCE_HTTP', f'{name}: expected HTTP 200')
                declared_size = response.headers.get('Content-Length')
                if declared_size is not None:
                    require(declared_size.isdigit() and int(declared_size) <= MAX_PDF_BYTES,
                            'SOURCE_SIZE', f'{name}: invalid or excessive Content-Length')
                chunks, size = [], 0
                while True:
                    require(time.monotonic() - started <= DOWNLOAD_SECONDS, 'SOURCE_TIMEOUT',
                            f'{name}: download exceeded {DOWNLOAD_SECONDS} seconds')
                    chunk = response.read1(128 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    require(size <= MAX_PDF_BYTES, 'SOURCE_SIZE', f'{name}: download exceeds size limit')
                    require(time.monotonic() - started <= DOWNLOAD_SECONDS, 'SOURCE_TIMEOUT',
                            f'{name}: download exceeded {DOWNLOAD_SECONDS} seconds')
                    chunks.append(chunk)
                data = b''.join(chunks)
                if declared_size is not None:
                    require(len(data) == int(declared_size), 'SOURCE_SIZE', f'{name}: incomplete HTTP body')
                origin = {'mode': 'official_download', 'final_url': response.geturl()}
        except (OSError, URLError) as exc:
            raise AuditError('SOURCE_UNAVAILABLE', f'{name}: official PDF download failed: {exc}') from exc
    digest = hashlib.sha256(data).hexdigest()
    require(digest == source['sha256'], 'PDF_SHA256_MISMATCH',
            f'{name}: expected {source["sha256"]}, received {digest}')
    require(data.startswith(b'%PDF-'), 'SOURCE_FORMAT', f'{name}: source is not a PDF')
    return data, {**origin, 'primary_url': source['url'], 'sha256': digest, 'bytes': len(data)}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'CATALOGUE_SCHEMA', f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def nonfinite_json(value):
    raise AuditError('CATALOGUE_SCHEMA', f'Nonfinite JSON value: {value}')


def read_catalogue(name, root):
    path = root / SOURCES[name]['file']
    raw = path.read_bytes()
    data = json.loads(raw, object_pairs_hook=unique_object, parse_constant=nonfinite_json)
    require(isinstance(data, dict) and isinstance(data.get('source'), dict), 'CATALOGUE_SCHEMA',
            f'{name}: source declaration is missing')
    require(data['source'].get('sha256') == SOURCES[name]['sha256'], 'CATALOGUE_SOURCE_MISMATCH',
            f'{name}: catalogue source identity differs from the independently fixed original')
    return data, {'file': path.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}


def numeric(value, where):
    require(type(value) in (int, float) and math.isfinite(value), 'CATALOGUE_SCHEMA',
            f'{where}: expected a finite numeric cell, received {value!r}')
    return Decimal(str(value))


def area_key(value, where):
    number = numeric(value, where)
    require(number > 0 and number == number.to_integral_value(), 'CATALOGUE_SCHEMA',
            f'{where}: area must be an exact positive integer in mm2')
    return int(number)


def extract_rows(doc, name, page, box, allow_overlay=False):
    x0, y0, x1, y1 = box
    words = [word for word in doc[page - 1].get_text('words')
             if x0 <= word[0] <= x1 and y0 <= word[1] <= y1 and re.fullmatch(r'\d+(?:\.\d+)?', word[4])]
    groups = []
    overlays = 0
    for word in sorted(words, key=lambda item: (item[1], item[0])):
        group = next((row for row in groups if abs(row[0][1] - word[1]) < 1), None)
        if group is None:
            groups.append([word])
        elif any(word[4] == other[4] and abs(word[0] - other[0]) < .5 and abs(word[1] - other[1]) < .5 for other in group):
            require(allow_overlay, 'PDF_LAYOUT_MISMATCH', f'{name} PDF {page}: unexpected duplicate text at {word[:4]}')
            overlays += 1
        else:
            group.append(word)
    rows = [[{'text': word[4], 'value': float(word[4]),
              'bbox_pdf_points': [round(value, 4) for value in word[:4]],
              'pdf_page': page, 'printed_page': page + 42 if name == 'people' else page - 1}
             for word in sorted(group, key=lambda item: item[0])] for group in groups]
    return rows, overlays


def header_evidence(doc, page, box, required):
    text = doc[page - 1].get_text(clip=fitz.Rect(box))
    normalized = re.sub(r'\s+', '', text)
    for marker in required:
        require(re.sub(r'\s+', '', marker) in normalized, 'PDF_HEADER_MISMATCH',
                f'PDF {page}: missing original header/unit {marker!r}')
    return {'pdf_page': page, 'bbox_pdf_points': list(box), 'text': text,
            'verified_header_markers': list(required)}


def indexed_pdf_rows(rows, columns, expected_areas, where):
    require(len(rows) == len(expected_areas), 'PDF_LAYOUT_MISMATCH', f'{where}: unexpected row count {len(rows)}')
    result = {}
    for row in rows:
        require(len(row) == len(columns), 'PDF_LAYOUT_MISMATCH', f'{where}: unexpected row width {len(row)}')
        area = area_key(row[0]['value'], where)
        require(area not in result, 'PDF_LAYOUT_MISMATCH', f'{where}: duplicate area {area}')
        result[area] = {key: {**cell, 'unit': unit} for (key, unit), cell in zip(columns, row)}
    require(set(result) == set(expected_areas), 'PDF_LAYOUT_MISMATCH', f'{where}: area set differs from original table')
    return result


def original_cells(docs):
    people, headers, overlays = {}, {}, {}
    for table, (page, box, header, areas) in PEOPLE_GRIDS.items():
        rows, count = extract_rows(docs['people'], 'people', page, box, allow_overlay=table == 'three-core')
        people[table] = indexed_pdf_rows(rows, PEOPLE_COLUMNS[table], areas, f'People {table}')
        headers['people.' + table] = header_evidence(docs['people'], page, header, ('mm2', 'kg/km'))
        overlays['people.' + table] = count
    rows, _ = extract_rows(docs['people'], 'people', 6, (245, 264, 548, 482))
    require(len(rows) == 13 and [len(row) for row in rows] == [13] * 11 + [9] * 2,
            'PDF_LAYOUT_MISMATCH', 'People Table 8: unexpected grid dimensions')
    three, single = [], []
    for row in rows:
        if len(row) == 13:
            three.append(row[:5])
            single.append([row[0]] + row[5:])
        else:
            single.append(row)
    ratings = {'three_core': indexed_pdf_rows(three, RATING_COLUMNS['three_core'], AREAS[:11], 'People ratings three-core'),
               'single_core': indexed_pdf_rows(single, RATING_COLUMNS['single_core'], AREAS, 'People ratings single-core')}
    headers['people.ratings'] = header_evidence(docs['people'], 6, (180, 90, 550, 267), ('载流量(A)', '空气中', '土壤中'))
    headers['people.ratings.area'] = header_evidence(docs['people'], 6, (210, 350, 243, 390), ('标称截面', 'mm2'))
    rows, _ = extract_rows(docs['bahra'], 'bahra', 18, (50, 307, 520, 488))
    require(len(rows) == 13 and all(len(row) == 9 for row in rows), 'PDF_LAYOUT_MISMATCH', 'Bahra construction grid differs')
    bahra = indexed_pdf_rows([row[1:8] for row in rows], BAHRA_STRUCTURE, AREAS, 'Bahra construction')
    rows, _ = extract_rows(docs['bahra'], 'bahra', 19, (188, 125, 553, 535))
    require(len(rows) == len(BAHRA_TECHNICAL) and all(len(row) == 13 for row in rows),
            'PDF_LAYOUT_MISMATCH', 'Bahra technical grid differs')
    require([area_key(cell['value'], 'Bahra technical header') for cell in rows[0]] == list(AREAS),
            'PDF_LAYOUT_MISMATCH', 'Bahra technical area header differs')
    for (field, unit), row in zip(BAHRA_TECHNICAL[1:], rows[1:]):
        for area, cell in zip(AREAS, row):
            bahra[area][field] = {**cell, 'unit': unit}
    headers['bahra.structure'] = header_evidence(docs['bahra'], 18, (45, 215, 552, 310),
        ('Cross Sectional Area Nominal mm2', 'Overall Diameter Approx. mm', 'Net Weight Approx. Kg/Km'))
    headers['bahra.technical'] = header_evidence(docs['bahra'], 19, (36, 125, 188, 539),
        ('Maximum DC resistance of Conductor @ 20°C Ω/km', 'AC resistance of Conductor @ 90°C Ω/km',
         'Inductance at 60 Hz mH/Km', 'Capacitance at 60 Hz μF/Km', 'Short Circuit Current For 1 second',
         '1- Conductor KA', '2- Metallic Sheath/Screen KA', 'Laid direct in ground', 'Laid in free air',
         'Trefoil Formation', 'Flat Formation', 'Voltage Drop per phase V/A/km', 'Minimum Bending radius mm'))
    return people, ratings, bahra, headers, overlays


def catalogue_rows(table, columns, expected_areas, where, declared_units=True):
    require(isinstance(table, dict) and isinstance(table.get('columns'), list) and isinstance(table.get('rows'), list),
            'CATALOGUE_SCHEMA', f'{where}: missing columns or rows')
    declared = table['columns']
    if declared_units:
        require(all(isinstance(item, list) and len(item) in (2, 3) for item in declared),
                'CATALOGUE_SCHEMA', f'{where}: malformed columns')
        require([(item[0], item[1]) for item in declared] == columns, 'CATALOGUE_UNIT_OR_COLUMN_MISMATCH',
                f'{where}: field order or units differ from the original PDF headers')
    else:
        require(declared == [key for key, _ in columns], 'CATALOGUE_UNIT_OR_COLUMN_MISMATCH',
                f'{where}: rating columns differ; original units are mm2 and A')
    rows = table['rows']
    require(len(rows) == len(expected_areas), 'CATALOGUE_SCHEMA', f'{where}: unexpected row count')
    result = {}
    for row in rows:
        require(isinstance(row, list) and len(row) == len(columns), 'CATALOGUE_SCHEMA', f'{where}: unexpected row width')
        for value in row:
            numeric(value, where)
        area = area_key(row[0], where)
        require(area not in result, 'CATALOGUE_SCHEMA', f'{where}: duplicate area {area}')
        result[area] = dict(zip((key for key, _ in columns), row))
    require(set(result) == set(expected_areas), 'CATALOGUE_SCHEMA', f'{where}: incomplete or changed area set')
    return result


def compare_catalogues(data, originals):
    people, ratings, bahra = originals[:3]
    checks, metrics = [], []

    def compare(name, table, area, field, value, cell):
        difference = numeric(value, f'{name}.{table}/{area}/{field}') - Decimal(cell['text'])
        item = {'manufacturer': name, 'table': table, 'area_mm2': area, 'field': field,
                'dataset_value': value, 'pdf_value': cell['value'], 'unit': cell['unit'],
                'difference': float(difference), 'status': 'exact_match' if difference == 0 else 'MISMATCH',
                **{key: val for key, val in cell.items() if key != 'value'}}
        checks.append(item)
        return item

    def metric(item, key):
        metrics.append({**item, 'metric': key, 'original_column': item['field']})

    tables = data['people'].get('tables')
    require(isinstance(tables, list) and all(isinstance(table, dict) for table in tables),
            'CATALOGUE_SCHEMA', 'People: malformed table collection')
    identities = [table.get('id') for table in tables]
    require(len(identities) == len(PEOPLE_COLUMNS) and set(identities) == set(PEOPLE_COLUMNS),
            'CATALOGUE_SCHEMA', 'People: missing, duplicate or unexpected structure table')
    by_id = {table['id']: table for table in tables}
    rating_data = data['people'].get('ratings')
    require(isinstance(rating_data, dict), 'CATALOGUE_SCHEMA', 'People: ratings are missing')
    require({key for key, value in rating_data.items() if isinstance(value, dict) and 'rows' in value} == set(RATING_COLUMNS),
            'CATALOGUE_SCHEMA', 'People: rating table collection differs')
    rating_checks = {}
    for table, columns in RATING_COLUMNS.items():
        rows = catalogue_rows(rating_data[table], columns, ratings[table], 'People ratings ' + table, declared_units=False)
        for area, row in rows.items():
            for field, _ in columns:
                rating_checks[table, area, field] = compare('people', 'ratings.' + table, area, field, row[field], ratings[table][area][field])
    for table, columns in PEOPLE_COLUMNS.items():
        rows = catalogue_rows(by_id[table], columns, people[table], 'People ' + table)
        first_weight = next(key for key, _ in columns if key.startswith('weight:'))
        for area, row in rows.items():
            for field, _ in columns:
                item = compare('people', table, area, field, row[field], people[table][area][field])
                if field in ('outer_diameter', first_weight):
                    metric(item, 'outer_diameter' if field == 'outer_diameter' else 'weight')
            metrics.append({'manufacturer': 'people', 'table': table, 'area_mm2': area, 'metric': 'r20',
                            'unit': 'ohm/km', 'dataset_value': None, 'pdf_value': None, 'status': 'not_published',
                            'reason': 'The fixed six-page original has no R20 column. Standard limits are not manufacturer values.'})
            group = 'single_core' if table == 'single-core' else 'three_core'
            field = 'ground_trefoil_copper' if group == 'single_core' else 'ground_copper'
            metric({**rating_checks[group, area, field], 'table': table, 'field': 'table8.' + group + '.' + field}, 'ampacity')
    rows = catalogue_rows(data['bahra'], BAHRA_COLUMNS, bahra, 'Bahra')
    bahra_metrics = {'outer_diameter': 'outer_diameter', 'weight': 'weight', 'r_dc_20': 'r20', 'rating_ground_trefoil': 'ampacity'}
    for area, row in rows.items():
        for field, _ in BAHRA_COLUMNS:
            item = compare('bahra', 'single-core', area, field, row[field], bahra[area][field])
            if field in bahra_metrics:
                metric(item, bahra_metrics[field])
    counts = Counter(item['manufacturer'] + '.' + item['table'] for item in checks)
    require(dict(counts) == EXPECTED_COUNTS and len(checks) == 877, 'AUDIT_COVERAGE', f'Unexpected cell coverage: {dict(counts)}')
    identities = [(item['manufacturer'], item['table'], item['area_mm2'], item['metric']) for item in metrics]
    require(len(metrics) == len(set(identities)) == 236, 'AUDIT_COVERAGE', 'Four-metric coverage is incomplete or duplicated')
    summary = {'specifications': {'people': 46, 'bahra': 13}, 'four_metric_slots': len(metrics),
               'four_metric_status_counts': dict(Counter(item['status'] for item in metrics)),
               'all_transcribed_numeric_cells_checked': len(checks),
               'all_transcribed_numeric_cell_status_counts': dict(Counter(item['status'] for item in checks)),
               'cell_counts_by_table': dict(counts), 'mismatches': [item for item in checks if item['status'] == 'MISMATCH']}
    return checks, metrics, summary


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def run(args):
    require(not args.output.exists(), 'OUTPUT_EXISTS', 'Output must be a new directory; existing evidence is never overwritten.')
    args.output.mkdir(parents=True)
    docs = {}
    try:
        data, catalogue_files, source_files = {}, {}, {}
        for name in SOURCES:
            data[name], catalogue_files[name] = read_catalogue(name, args.catalogue_root)
            raw, source_files[name] = pdf_bytes(name, getattr(args, name + '_pdf'))
            docs[name] = fitz.open(stream=raw, filetype='pdf')
            require(not docs[name].needs_pass and len(docs[name]) == SOURCES[name]['pages'], 'PDF_LAYOUT_MISMATCH',
                    f'{name}: encrypted PDF or unexpected page count')
            source_files[name]['pdf_pages'] = len(docs[name])
        originals = original_cells(docs)
        checks, metrics, summary = compare_catalogues(data, originals)
        summary['status'] = 'failed' if summary['mismatches'] else 'passed'
        report = {'created_utc': datetime.now(timezone.utc).isoformat(),
            'method': {'id': 'cablesim.catalogue-original-audit', 'version': METHOD_VERSION,
                       'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       'pdf_engine': 'PyMuPDF', 'pdf_engine_version': fitz.VersionBind},
            'audit_method': 'Independent coordinate extraction from SHA-pinned original PDFs; no workbook, importer, application or calculation plugin.',
            'source_files': source_files, 'catalogue_files': catalogue_files,
            'original_headers_and_units': originals[3], 'overlaid_pdf_tokens_suppressed': originals[4],
            'summary': summary, 'four_metric_checks': metrics, 'all_numeric_cell_checks': checks,
            'rendered_pages': {},
            'visual_review': 'PNG pages are evidence for review; this automated run does not assert human visual inspection.',
            'limits': [
                'Checks faithful transcription of published approximate values, not measured manufacturing data or product compliance.',
                'Coverage is the 877 numeric cells transcribed in the two datasets, not every table in the complete handbooks.',
                'People R20 is unpublished: 46 absent slots do not count as numeric matches.',
                'Missing manufacturer construction and installation conditions remain missing; no reference assumptions are used here.',
                'Bahra reactance, cable codes and drum lengths are outside the transcribed columns; their neighbouring grid positions are not silently substituted.',
                'Short-circuit rows retain 1 second, resistance rows retain 20/90 degrees C, inductance/capacitance retain 60 Hz, and voltage drop retains its per-phase basis in the original headers.',
            ],
            'source_anomalies_preserved': [
                'People PDF 2 / printed 044 / Table 1: 185 and 240 mm2 both publish OD 36 mm.',
                'People PDF 3 / printed 045 / Table 3: YJY23 begins at 17935 kg/km for 25 mm2; visible cells, not text-stream ordering, are retained.',
                'People PDF 4 / printed 046 / Table 5: the steel-wire table retains its original steel-tape thickness header text in the header evidence.',
                'Bahra PDF 19 / printed 18: 500 mm2 publishes bending radius 990 mm while PDF 18 publishes OD 47 mm; neither is corrected.',
            ]}
        for name, doc in docs.items():
            images = []
            for page in SOURCES[name]['render_pages']:
                target = args.output / f'{name}-page-{page:02d}.png'
                doc[page - 1].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(target)
                images.append({'pdf_page': page, 'file': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
            report['rendered_pages'][name] = images
        write_json(args.output / 'original-pdf-cell-audit.json', report)
        write_json(args.output / 'original-pdf-summary.json', summary)
        with (args.output / 'original-pdf-four-metrics.csv').open('w', newline='', encoding='utf-8') as stream:
            fields = ['manufacturer', 'table', 'area_mm2', 'metric', 'field', 'unit', 'dataset_value', 'pdf_value', 'difference',
                      'status', 'pdf_page', 'printed_page', 'original_column', 'text', 'bbox_pdf_points', 'reason']
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(metrics)
        require(not summary['mismatches'], 'CATALOGUE_VALUE_MISMATCH',
                f'{len(summary["mismatches"])} catalogue cells differ from the original PDFs; see original-pdf-cell-audit.json')
        require(summary['four_metric_status_counts'] == {'exact_match': 190, 'not_published': 46}
                and summary['all_transcribed_numeric_cell_status_counts'] == {'exact_match': 877},
                'AUDIT_COVERAGE', 'Unexpected exact-match or unpublished-metric coverage')
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    finally:
        for doc in docs.values():
            doc.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--people-pdf', type=Path, help='Local original People PDF; otherwise download the fixed official source')
    parser.add_argument('--bahra-pdf', type=Path, help='Local original Bahra PDF; otherwise download the fixed official source')
    parser.add_argument('--catalogue-root', type=Path, default=ROOT / 'backend/kernel/catalogue_core/catalogues',
                        help='Directory containing the two catalogue JSON files (also permits isolated negative checks)')
    parser.add_argument('--output', required=True, type=Path, help='New evidence directory for JSON, CSV and original-page PNGs')
    args = parser.parse_args()
    try:
        run(args)
    except (AuditError, OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
        error = {'status': 'failed', 'code': getattr(exc, 'code', 'AUDIT_INPUT_INVALID'), 'detail': str(exc)}
        print(json.dumps(error, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
