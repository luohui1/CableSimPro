"""Verify product tables and separate published guidance against original PDFs.

Usage: python scripts/verify_catalogue_originals.py --output <new-directory>
Optional --people-pdf and --bahra-pdf use local originals instead of downloading
the fixed official URLs. --catalogue-root selects a copy of the two JSON files.
No application, import API or calculation plugin is executed. All output is evidence,
not product approval; the 46 unpublished People R20 entries remain absent.
The 877 product-table cells remain separate from four material-guide values and
84 logical direct-burial factors and three People permissible limits; these
separate reference facts are not actual calculation inputs.
Official downloads share one transport retry and a checked time budget; all
attempts, including failures, are retained in original-pdf-downloads.json.
"""
from __future__ import annotations

import argparse
import csv
import errno
import hashlib
from http.client import HTTPException, IncompleteRead
import json
import math
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import fitz

ROOT = Path(__file__).resolve().parents[1]
METHOD_VERSION = '1.2.0'
MAX_PDF_BYTES = 32 * 1024 * 1024
NETWORK_TIMEOUT = 30
DOWNLOAD_SECONDS = 120
DOWNLOAD_STAGE_SECONDS = 270
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
        'render_pages': (7, 8, 12, 13, 18, 19),
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


def checked_pdf(name, data, origin):
    source = SOURCES[name]
    digest = hashlib.sha256(data).hexdigest()
    require(digest == source['sha256'], 'PDF_SHA256_MISMATCH',
            f'{name}: expected {source["sha256"]}, received {digest}')
    require(data.startswith(b'%PDF-'), 'SOURCE_FORMAT', f'{name}: source is not a PDF')
    return data, {**origin, 'primary_url': source['url'], 'sha256': digest, 'bytes': len(data)}


def retryable_transport(error):
    if isinstance(error, AuditError):
        return error.code == 'SOURCE_TIMEOUT'
    if isinstance(error, HTTPError):
        return False
    if isinstance(error, URLError):
        error = error.reason
    # IncompleteRead and RemoteDisconnected are protocol failures, even though
    # RemoteDisconnected also inherits ConnectionResetError in Python.
    return not isinstance(error, HTTPException) and (
        isinstance(error, (TimeoutError, ConnectionResetError))
        or isinstance(error, OSError) and error.errno in (errno.ETIMEDOUT, errno.ECONNRESET))


class DownloadAudit:
    """One shared reconnect and a checked time budget for both official PDFs."""

    def __init__(self, output):
        self.output = output
        self.started = None
        self.remaining_retries = 1
        self.report = {
            'policy': {'shared_extra_connections': 1, 'stage_check_budget_seconds': DOWNLOAD_STAGE_SECONDS,
                       'attempt_check_budget_seconds': DOWNLOAD_SECONDS, 'socket_timeout_seconds': NETWORK_TIMEOUT,
                       'limit': 'Budgets are checked at I/O boundaries, not hard wall-clock deadlines. '
                                'Blocking socket operations, DNS and scheduling can overrun a remaining budget; '
                                'the CI step timeout remains the outer limit.'},
            'attempts': [], 'finished_utc': None,
        }

    def elapsed(self):
        return 0 if self.started is None else time.monotonic() - self.started

    def save(self, cause=None):
        if self.report['finished_utc'] is None:
            self.report['stage_elapsed_seconds'] = self.elapsed()
        self.report['remaining_extra_connections'] = self.remaining_retries
        try:
            write_json(self.output, self.report)
        except OSError as error:
            detail = f'Cannot save download diagnostics: {error}'
            print(json.dumps({'code': 'SOURCE_DIAGNOSTICS_UNAVAILABLE', 'detail': detail,
                              'original_error': str(cause) if cause is not None else None}), file=sys.stderr)
            if cause is None:
                raise AuditError('SOURCE_DIAGNOSTICS_UNAVAILABLE', detail) from error
            return False
        return True

    def finish(self, cause=None):
        if self.report['finished_utc'] is None:
            self.report['stage_elapsed_seconds'] = self.elapsed()
            self.report['finished_utc'] = datetime.now(timezone.utc).isoformat()
        if cause is not None:
            self.report['audit_error'] = {'code': getattr(cause, 'code', type(cause).__name__), 'detail': str(cause)}
        self.save(cause)

    def fetch(self, name):
        source = SOURCES[name]
        if self.started is None:
            self.started = time.monotonic()
        attempt_number = 0
        while True:
            attempt_number += 1
            started = time.monotonic()
            attempt = {'source': name, 'attempt': attempt_number, 'url': source['url'], 'final_url': None,
                       'started_utc': datetime.now(timezone.utc).isoformat(), 'http_status': None,
                       'declared_size': None, 'received_bytes': 0, 'redirects': [], 'connection_started': False,
                       'elapsed_seconds': 0, 'status': 'started'}
            self.report['attempts'].append(attempt)

            def budget():
                require(self.elapsed() < DOWNLOAD_STAGE_SECONDS, 'SOURCE_DOWNLOAD_BUDGET',
                        f'{name}: shared download check budget of {DOWNLOAD_STAGE_SECONDS} seconds exhausted')
                require(time.monotonic() - started < DOWNLOAD_SECONDS, 'SOURCE_TIMEOUT',
                        f'{name}: download exceeded {DOWNLOAD_SECONDS} seconds')

            class ObservedRedirect(OfficialRedirect):
                def redirect_request(self, request, fp, code, message, headers, newurl):
                    attempt['redirects'].append({'url': request.full_url, 'http_status': code,
                                                'location': newurl, 'declared_size': headers.get('Content-Length')})
                    attempt['http_status'], attempt['final_url'] = code, request.full_url
                    # URL rejection takes precedence over a spent time budget.
                    redirected = super().redirect_request(request, fp, code, message, headers, newurl)
                    budget()
                    return redirected

            chunks = []
            try:
                self.save()
                official_url(source['url'], source)
                budget()
                request = Request(source['url'], headers={'User-Agent': 'CableSimPro catalogue-source-verification/1.0',
                                                        'Accept': 'application/pdf', 'Accept-Encoding': 'identity'})
                attempt['connection_started'] = True
                with build_opener(ObservedRedirect(source)).open(request, timeout=NETWORK_TIMEOUT) as response:
                    attempt['final_url'], attempt['http_status'] = response.geturl(), response.status
                    attempt['declared_size'] = response.headers.get('Content-Length')
                    attempt['elapsed_seconds'] = time.monotonic() - started
                    self.save()
                    official_url(response.geturl(), source)
                    require(response.status == 200, 'SOURCE_HTTP', f'{name}: expected HTTP 200')
                    declared_size = attempt['declared_size']
                    if declared_size is not None:
                        require(declared_size.isdigit() and int(declared_size) <= MAX_PDF_BYTES,
                                'SOURCE_SIZE', f'{name}: invalid or excessive Content-Length')
                    while True:
                        budget()
                        chunk = response.read1(128 * 1024)
                        attempt['received_bytes'] += len(chunk)
                        require(attempt['received_bytes'] <= MAX_PDF_BYTES, 'SOURCE_SIZE',
                                f'{name}: download exceeds size limit')
                        budget()
                        attempt['elapsed_seconds'] = time.monotonic() - started
                        self.save()
                        if not chunk:
                            break
                        chunks.append(chunk)
                    data = b''.join(chunks)
                    if declared_size is not None:
                        require(len(data) == int(declared_size), 'SOURCE_SIZE', f'{name}: incomplete HTTP body')
                    result = checked_pdf(name, data, {'mode': 'official_download', 'final_url': response.geturl()})
            except (ValueError, OSError, URLError, HTTPException) as error:
                if isinstance(error, HTTPError):
                    attempt.update(http_status=error.code, final_url=error.geturl(),
                                   declared_size=error.headers.get('Content-Length') if error.headers else None)
                    error.close()
                if isinstance(error, IncompleteRead):
                    attempt['received_bytes'] += len(error.partial)
                code = error.code if isinstance(error, AuditError) else (
                    'SOURCE_HTTP' if isinstance(error, HTTPError) else
                    'SOURCE_SIZE' if isinstance(error, IncompleteRead) else
                    'SOURCE_INPUT_INVALID' if isinstance(error, ValueError) else 'SOURCE_UNAVAILABLE')
                retry = retryable_transport(error) and self.remaining_retries > 0 and self.elapsed() < DOWNLOAD_STAGE_SECONDS
                chunks.clear()  # A reconnect never appends to an earlier response.
                attempt.update(status='failed', elapsed_seconds=time.monotonic() - started,
                               error={'code': code, 'type': type(error).__name__, 'detail': str(error)},
                               retryable_transport=retryable_transport(error), retry_scheduled=retry,
                               partial_body_discarded=True)
                if retry:
                    self.remaining_retries -= 1
                persisted = self.save(error)  # A diagnostics write error cannot replace this rejection.
                if retry and persisted:
                    continue
                if isinstance(error, AuditError):
                    raise
                raise AuditError(code, f'{name}: official PDF download failed: {error}') from error
            attempt.update(status='passed', elapsed_seconds=time.monotonic() - started,
                           sha256=result[1]['sha256'], retry_scheduled=False)
            self.save()
            return result


def pdf_bytes(name, local_path, downloads):
    if local_path is not None:
        require(local_path.is_file(), 'SOURCE_MISSING', f'{name}: original PDF is not a file: {local_path}')
        require(local_path.stat().st_size <= MAX_PDF_BYTES, 'SOURCE_SIZE', f'{name}: PDF exceeds size limit')
        data = local_path.read_bytes()
        origin = {'mode': 'local', 'path': str(local_path.resolve())}
        return checked_pdf(name, data, origin)
    return downloads.fetch(name)


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


def same_declared_value(value, expected):
    """JSON may normalize 1.0 to 1; it must not turn a condition into True."""
    if type(value) in (int, float) and type(expected) in (int, float):
        return math.isfinite(value) and value == expected
    if type(value) is not type(expected):
        return False
    if isinstance(expected, dict):
        return value.keys() == expected.keys() and all(same_declared_value(value[key], item) for key, item in expected.items())
    if isinstance(expected, list):
        return len(value) == len(expected) and all(same_declared_value(a, b) for a, b in zip(value, expected))
    return value == expected


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


def audit_published_guidance(doc, data):
    """Read guide values and all factor cells from fixed independent PDF grids.

    Neither the values nor the selection of original cells comes from the JSON.
    Conditions and units are checked against original headers before the values
    are compared. The product-table coverage above is deliberately unchanged.
    """
    guidance = data.get('published_guidance')
    require(isinstance(guidance, dict), 'GUIDANCE_SCHEMA', 'Bahra published guidance is missing')
    require(guidance.get('schema') == 'cablesim.catalogue-published-guidance/1'
            and guidance.get('id') == 'bahra.mv-lead-sheathed.guidance'
            and guidance.get('usage') == 'published_reference_only'
            and guidance.get('confidence') == 'reference' and guidance.get('reviewed') is False,
            'GUIDANCE_SCHEMA', 'Bahra guidance identity or reference-only status changed')
    method = {'id': 'cablesim.catalogue-guidance-transcription', 'name': 'Bahra 公开手册逐值转录', 'version': '1.0.0'}
    require(guidance.get('method') == method, 'GUIDANCE_SCHEMA', 'Guidance transcription method differs')
    source = guidance.get('source', {})
    require(source.get('sha256') == SOURCES['bahra']['sha256']
            and source.get('url') == SOURCES['bahra']['url'] and source.get('edition') is None,
            'GUIDANCE_SOURCE', 'Guidance source must be the fixed, undated manufacturer PDF')
    unsigned = {key: value for key, value in guidance.items() if key != 'content_sha256'}
    require(guidance.get('content_sha256') == hashlib.sha256(json.dumps(unsigned, ensure_ascii=False,
            sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'GUIDANCE_DIGEST', 'Published guidance content digest differs')
    headers = {
        'resistance': header_evidence(doc, 7, (84, 182, 557, 357),
            ('2. RESISTANCE', 'R20', 'temperature coefficient', 'copper', 'aluminum')),
        'capacitance': header_evidence(doc, 7, (84, 366, 315, 472),
            ('3. CAPACITANCE', 'Relative permittivity', 'PVC', 'XLPE', 'μF/km')),
        'dielectric_loss': header_evidence(doc, 8, (40, 290, 457, 363),
            ('9. DIELECTRIC LOSSES', 'tan δ : Dielectric power factor')),
        'baseline': header_evidence(doc, 12, (40, 130, 530, 450),
            ('100% load factor', 'one circuit installed thermally isolated', 'IEC 60287', 'IEC 60502-2')),
        'table-3': header_evidence(doc, 13, (84, 125, 527, 239),
            ('DIRECT BURIAL', 'Table 3', '15°C', '55°C')),
        'table-4': header_evidence(doc, 13, (84, 273, 523, 353),
            ('Table 4', 'Single Core Cables', 'Three Core Cables', '≤ 185 mm2', '> 185 mm2')),
        'table-5': header_evidence(doc, 13, (84, 502, 527, 704),
            ('Table 5', 'average values', 'Soil Thermal Resistivity ( °C m / W )',
             'Single Core Cables', 'Three Core Cables', '≤ 50 mm2', '> 50 mm2 & ≤ 185 mm2', '240 mm2 and above')),
    }
    # Page 8 defines the symbol, but supplies no numerical loss tangent.
    require(not re.search(r'tan\s*δ\s*[=:]\s*\d', headers['dielectric_loss']['text']),
            'PDF_LAYOUT_MISMATCH', 'The fixed guide unexpectedly contains a numerical loss tangent')
    baseline = guidance.get('baseline', {})
    require(baseline.get('source', {}).get('sha256') == SOURCES['bahra']['sha256']
            and baseline.get('source', {}).get('pdf_page') == 12
            and baseline.get('source', {}).get('printed_page') == 11
            and baseline.get('source', {}).get('bbox_pdf_points') == [40, 130, 530, 450],
            'GUIDANCE_SOURCE', 'Baseline source location differs')
    baseline_checks, expected_baseline = [], {}
    for key, rect, pattern, unit in (
        ('air_temperature_c', (292, 307, 324, 322), r'(\d+(?:\.\d+)?)\s*°C', '°C'),
        ('ground_temperature_c', (292, 323, 324, 338), r'(\d+(?:\.\d+)?)\s*°C', '°C'),
        ('depth_m', (292, 339, 332, 354), r'(\d+(?:\.\d+)?)\s*m', 'm'),
        ('soil_thermal_resistivity', (292, 355, 353, 370), r'(\d+(?:\.\d+)?)\s*°K\.m/W', '°K.m/W'),
    ):
        text = doc[11].get_text(clip=fitz.Rect(rect)).strip()
        match = re.fullmatch(pattern, re.sub(r'\s+', '', text))
        require(match is not None, 'PDF_LAYOUT_MISMATCH', f'Bahra baseline {key}: original value/unit is missing')
        value = float(match.group(1))
        expected_baseline[key] = value
        original = baseline.get('original_values', {}).get(key, {})
        require(same_declared_value(original.get('value'), value) and original.get('unit') == unit,
                'GUIDANCE_CONDITION', f'Bahra baseline original {key} differs')
        baseline_checks.append({'field': key, 'original_text': text, 'original_value': value,
                                'original_unit': unit, 'value': value, 'pdf_page': 12, 'bbox_pdf_points': list(rect)})
    load = re.search(r'(\d+(?:\.\d+)?)%\s*load factor', headers['baseline']['text'])
    require(load is not None, 'PDF_LAYOUT_MISMATCH', 'Original percentage load factor is missing')
    load_value = Decimal(load.group(1))
    expected_baseline.update(circuit_count=1, load_factor=float(load_value / 100), thermally_isolated=True)
    require(same_declared_value(baseline.get('conditions'), expected_baseline)
            and baseline['conditions']['thermally_isolated'] is True,
            'GUIDANCE_CONDITION', 'Published baseline conditions differ from the original guide')
    originals = baseline.get('original_values', {})
    require(same_declared_value(originals.get('load_factor'), {'value': float(load_value), 'unit': '%',
                'original_text': '100% load factor', 'conversion': '100% / 100 = 1（无量纲）'})
            and same_declared_value(originals.get('circuit_count'), {'value': 1, 'unit': '1', 'original_text': 'one circuit'}),
            'GUIDANCE_CONDITION', 'The original percentage or single-circuit wording was lost')
    baseline_checks.extend([
        {'field': 'load_factor', 'original_value': float(load_value), 'original_unit': '%',
         'value': float(load_value / 100), 'unit': '1', 'conversion': 'original percentage / 100', 'pdf_page': 12},
        {'field': 'circuit_count', 'original_text': 'one circuit', 'value': 1, 'unit': '1', 'pdf_page': 12},
        {'field': 'thermally_isolated', 'original_text': 'thermally isolated from other circuits or any other heat source',
         'value': True, 'pdf_page': 12},
    ])
    checks = []

    def compare(item, original, *, identity, category, unit, conditions, section, row, column, table=None):
        where = 'Bahra guidance ' + identity
        require(isinstance(item, dict) and item.get('id') == identity and item.get('unit') == unit
                and same_declared_value(item.get('conditions'), conditions) and item.get('method') == method
                and item.get('confidence') == 'reference', 'GUIDANCE_CONDITION', where + ': identity, unit or conditions differ')
        citation = item.get('source', {})
        require(citation.get('sha256') == SOURCES['bahra']['sha256']
                and citation.get('pdf_page') == original['pdf_page']
                and citation.get('printed_page') == original['printed_page']
                and citation.get('bbox_pdf_points') == original['bbox_pdf_points']
                and citation.get('original_text') == original['text'] and citation.get('section') == section
                and same_declared_value(citation.get('row'), row) and same_declared_value(citation.get('column'), column)
                and (table is None or citation.get('table') == table),
                'GUIDANCE_SOURCE', where + ': original cell location or printed text differs')
        difference = numeric(item.get('value'), where) - Decimal(original['text'])
        checks.append({'id': identity, 'category': category, 'table': table, 'unit': unit,
                       'conditions': conditions, 'dataset_value': item['value'], 'pdf_value': original['value'],
                       'difference': float(difference), 'status': 'exact_match' if difference == 0 else 'MISMATCH',
                       **{key: value for key, value in original.items() if key != 'value'}})

    material_specs = [
        ('copper-alpha20', 'copper', (110, 263, 153, 265)),
        ('aluminium-alpha20', 'aluminium', (110, 274, 153, 276)),
        ('pvc-permittivity', 'PVC', (135, 447, 152, 449)),
        ('xlpe-permittivity', 'XLPE', (135, 458, 152, 460)),
    ]
    materials = guidance.get('material_facts')
    require(isinstance(materials, list) and len(materials) == 4, 'GUIDANCE_COVERAGE', 'Exactly four material-guide values are required')
    for item, (identity, material, rect) in zip(materials, material_specs):
        rows, _ = extract_rows(doc, 'bahra', 7, rect)
        require(len(rows) == 1 and len(rows[0]) == 1, 'PDF_LAYOUT_MISMATCH', identity + ': original cell is ambiguous')
        alpha = identity.endswith('alpha20')
        require(item.get('quantity') == ('conductor_resistance_temperature_coefficient_20' if alpha else 'insulation_relative_permittivity')
                and item.get('usage') == ('resistance_temperature_conversion' if alpha else 'capacitance_calculation'),
                'GUIDANCE_CONDITION', identity + ': published purpose changed')
        compare(item, rows[0][0], identity=identity, category='material_guide', unit='1/K' if alpha else '1',
                conditions={'material': material, **({'reference_temperature_c': 20} if alpha else {'temperature_c': None, 'frequency_hz': None})},
                section='2. RESISTANCE' if alpha else '3. CAPACITANCE', row=material,
                column='alpha20' if alpha else 'relative_permittivity')
    tables = guidance.get('correction_tables')
    require(isinstance(tables, list) and [t.get('id') for t in tables] == ['table-3', 'table-4', 'table-5'],
            'GUIDANCE_COVERAGE', 'Exactly Tables 3, 4 and 5 are covered')
    expected = []

    def axis(field, unit, rect, text=None):
        return {'field': field, 'unit': unit, 'bbox_pdf_points': list(rect),
                'original_text': doc[12].get_text(clip=fitz.Rect(rect)).strip() if text is None else text}

    temperature_headers = sorted([word for word in doc[12].get_text('words')
        if 195 <= word[0] <= 520 and 213 <= word[1] <= 215 and re.fullmatch(r'\d+°C', word[4])], key=lambda word: word[0])
    temperatures = [int(word[4].removesuffix('°C')) for word in temperature_headers]
    require(temperatures == list(range(15, 56, 5)), 'PDF_LAYOUT_MISMATCH', 'Table 3 temperature axis differs')
    rows, _ = extract_rows(doc, 'bahra', 13, (195, 240, 520, 242))
    require(len(rows) == 1 and len(rows[0]) == 9, 'PDF_LAYOUT_MISMATCH', 'Table 3 factor grid differs')
    for col, (temperature, header, cell) in enumerate(zip(temperatures, temperature_headers, rows[0]), 1):
        axes = [axis('ground_temperature_c', '°C', [round(v, 4) for v in header[:4]], header[4])]
        expected.append((0, f'table-3.ground-{temperature}', {'ground_temperature_c': temperature}, cell, 1, col, axes))
    rows, _ = extract_rows(doc, 'bahra', 13, (125, 354, 480, 471))
    require(len(rows) == 9 and all(len(row) == 4 for row in rows)
            and [row[0]['value'] for row in rows] == [.5, .6, .8, 1., 1.25, 1.5, 2., 2.5, 3.],
            'PDF_LAYOUT_MISMATCH', 'Table 4 depth axis or factor grid differs')
    for row_number, row in enumerate(rows, 1):
        depth = row[0]['value']
        for col, ((key, cores, area), cell) in enumerate(zip(
                [('single-le185', 1, {'lte': 185}), ('single-gt185', 1, {'gt': 185}), ('three-core', 3, None)], row[1:]), 1):
            axes = [axis('depth_m', 'm', row[0]['bbox_pdf_points'], row[0]['text']),
                    axis('cores', '1', (250, 295, 350, 311) if cores == 1 else (420, 320, 510, 338))]
            if area is not None:
                axes.append(axis('area_mm2', 'mm2', (215, 338, 279, 353) if col == 1 else (325, 338, 386, 353)))
            expected.append((1, f'table-4.depth-{depth:g}.{key}',
                             {'depth_m': depth, 'cores': cores, **({'area_mm2': area} if area is not None else {})}, cell, row_number, col, axes))
    soil, _ = extract_rows(doc, 'bahra', 13, (215, 543, 520, 545))
    require(len(soil) == 1 and [x['value'] for x in soil[0]] == [.8, .9, 1., 1.2, 1.5, 2., 2.5, 3.],
            'PDF_LAYOUT_MISMATCH', 'Table 5 soil-resistivity axis differs')
    rows, _ = extract_rows(doc, 'bahra', 13, (210, 577, 523, 685))
    require(len(rows) == 6 and all(len(row) == 8 for row in rows), 'PDF_LAYOUT_MISMATCH', 'Table 5 factor grid differs')
    # The six 1.2-column entries are six separately printed "1" cells. They have
    # independent coordinates; no merged-cell propagation or inferred 1 is used.
    require(len({tuple(row[3]['bbox_pdf_points']) for row in rows}) == 6,
            'PDF_LAYOUT_MISMATCH', 'Table 5 baseline cells must have six distinct original locations')
    profiles = [('single-le50', 1, {'lte': 50}), ('single-gt50-le185', 1, {'gt': 50, 'lte': 185}),
                ('single-ge240', 1, {'gte': 240}), ('three-le50', 3, {'lte': 50}),
                ('three-gt50-le185', 3, {'gt': 50, 'lte': 185}), ('three-ge240', 3, {'gte': 240})]
    for row_number, ((key, cores, area), row) in enumerate(zip(profiles, rows), 1):
        y = row[0]['bbox_pdf_points'][1]
        for col, (soil_axis, cell) in enumerate(zip(soil[0], row), 1):
            rho = soil_axis['value']
            axes = [axis('soil_thermal_resistivity', '°C m / W', soil_axis['bbox_pdf_points'], soil_axis['text']),
                    axis('area_mm2', 'mm2', (85, y - .2, 205, y + 13)),
                    axis('cores', '1', (258, 559 if cores == 1 else 630, 351, 574 if cores == 1 else 645))]
            expected.append((2, f'table-5.{key}.soil-{rho:g}',
                             {'cores': cores, 'area_mm2': area, 'soil_thermal_resistivity': rho}, cell, row_number, col, axes))
    require([len(table.get('factors', [])) for table in tables] == [9, 27, 48]
            and all(table.get('installation') == 'direct_buried' for table in tables),
            'GUIDANCE_COVERAGE', 'Direct-burial factor tables are missing, duplicated or expanded')
    offsets = [0, 0, 0]
    for table_index, identity, conditions, cell, row, column, expected_axes in expected:
        item = tables[table_index]['factors'][offsets[table_index]]
        offsets[table_index] += 1
        table = 'Table ' + str(table_index + 3)
        compare(item, cell, identity=identity, category='direct_burial_factor', unit='1',
                conditions={'installation': 'direct_buried', **conditions}, section=table, row=row, column=column, table=table)
        axes = item.get('source', {}).get('condition_evidence')
        # A real header from a different row must not be accepted as provenance
        # for these conditions. These original locations were selected above
        # independently of every coordinate supplied by the dataset under audit.
        require(same_declared_value(axes, expected_axes), 'GUIDANCE_SOURCE',
                identity + ': condition provenance differs from its independently located original headers')
    counts = Counter(item['category'] for item in checks)
    require(len(checks) == len({item['id'] for item in checks}) == 88
            and counts == {'material_guide': 4, 'direct_burial_factor': 84},
            'GUIDANCE_COVERAGE', 'Published guidance coverage differs')
    summary = {'material_facts_checked': 4, 'logical_factors_checked': 84,
               'logical_factors_by_table': {'table-3': 9, 'table-4': 27, 'table-5': 48},
               'numeric_status_counts': dict(Counter(item['status'] for item in checks)),
               'baseline_conditions_checked': len(baseline_checks),
               'mismatches': [item for item in checks if item['status'] == 'MISMATCH']}
    return {'summary': summary, 'source_headers_and_units': headers, 'baseline_checks': baseline_checks,
            'numeric_checks': checks, 'content_sha256': guidance['content_sha256'],
            'scope': 'Manufacturer reference guidance only; not manufacturing measurements, GB 50217 factors, or actual calculation inputs.'}


def audit_people_operating_limits(doc, published, modelling):
    """Compare declared limits with independent text in the pinned first page.

    Read the complete clauses, including <= / maximum-duration wording, inside
    the fixed usage-characteristics region. A number elsewhere on the page is
    not evidence for this limit. The declared numeric values never determine
    what is extracted or where it is read.
    """
    require(isinstance(published, dict) and isinstance(modelling, dict),
            'OPERATING_LIMIT_SCHEMA', 'People permissible-limit declarations must be objects')
    source = published.get('source', {})
    require(published.get('schema') == 'cablesim.published-operating-limits/1'
            and published.get('semantic') == 'manufacturer_limit'
            and published.get('usage') == 'permitted_limits_only'
            and published.get('confidence') == 'reference' and published.get('reviewed') is False,
            'OPERATING_LIMIT_SCHEMA', 'People operating facts must remain unreviewed permissible limits')
    method = {'id': 'cablesim.catalogue-operating-limits-transcription',
              'name': '人民电器公开使用特性转录', 'version': '1.0.0'}
    require(published.get('method') == method, 'OPERATING_LIMIT_SCHEMA', 'People transcription method differs')
    require(isinstance(source, dict) and source.get('sha256') == SOURCES['people']['sha256'] and source.get('url') == SOURCES['people']['url']
            and source.get('pdf_page') == 1 and source.get('printed_page') == 43,
            'OPERATING_LIMIT_SOURCE', 'People operating-limit source or original page differs')
    region = (205, 210, 552, 296)
    header = header_evidence(doc, 1, region, ('使用特性',))
    footer = re.sub(r'\s+', '', doc[0].get_text(clip=fitz.Rect(40, 620, 100, 642)))
    require(footer == '043', 'PDF_LAYOUT_MISMATCH', 'People usage characteristics must be on printed page 043')
    text = re.sub(r'\s+', '', header['text'])
    normal = list(re.finditer(r'电缆导体的长期允许工作温度[:：]≤(\d+(?:\.\d+)?)(?:℃|°C)', text))
    short = list(re.finditer(r'短路时[（(]最长持续时间不超过(\d+(?:\.\d+)?)s[）)]'
                            r'电缆的最高工作温度[:：](\d+(?:\.\d+)?)(?:℃|°C)', text))
    require(len(normal) == len(short) == 1, 'PDF_LAYOUT_MISMATCH',
            'People usage temperature units or maximum-duration condition is missing or ambiguous')
    originals = {
        'normal_temperature': (normal[0].group(1), 'degC', normal[0].group(0), {}),
        'short_circuit_temperature': (short[0].group(2), 'degC', short[0].group(0),
                                     {'maximum_duration_s': float(short[0].group(1))}),
        'short_circuit_duration': (short[0].group(1), 's', short[0].group(0),
                                  {'maximum_temperature_c': float(short[0].group(2))}),
    }
    facts = published.get('limits', {})
    require(isinstance(facts, dict) and set(facts) == set(originals), 'OPERATING_LIMIT_SCHEMA', 'People permissible-limit coverage differs')
    require(set(modelling) == {'normal_temperature_k', 'short_circuit_temperature_k'},
            'OPERATING_LIMIT_MAPPING', 'Only declared temperature limits may be mapped; no actual fault duration')
    checks = []
    for key, (original, unit, clause, conditions) in originals.items():
        fact = facts[key]
        require(isinstance(fact, dict) and set(fact) == {'value', 'unit', 'criterion'}
                and fact.get('unit') == unit and fact.get('criterion') == 'maximum',
                'OPERATING_LIMIT_SCHEMA', 'People permissible-limit unit or maximum semantics differs: ' + key)
        value = float(numeric(fact['value'], 'People permissible limit ' + key))
        require(value > 0, 'OPERATING_LIMIT_SCHEMA', 'People permissible limit must be positive: ' + key)
        difference = Decimal(str(value)) - Decimal(original)
        checks.append({'id': 'people.usage.' + key, 'unit': unit, 'criterion': 'maximum', 'conditions': conditions,
                       'dataset_value': value, 'pdf_value': float(original), 'difference': float(difference),
                       'status': 'exact_match' if difference == 0 else 'mismatch', 'text': clause,
                       'pdf_page': 1, 'printed_page': 43, 'bbox_pdf_points': list(region)})
        if key == 'short_circuit_duration':
            continue
        parameter = modelling[key + '_k']
        require(isinstance(parameter, dict) and parameter.get('unit') == 'K' and type(parameter.get('value')) in (int, float)
                and math.isfinite(parameter['value'])
                and Decimal(str(parameter['value'])) == Decimal(str(value)) + Decimal('273.15'),
                'OPERATING_LIMIT_MAPPING', 'People SI temperature conversion differs: ' + key)
        try:
            reference = json.loads(parameter['reference'], object_pairs_hook=unique_object, parse_constant=nonfinite_json)
        except (KeyError, TypeError, ValueError) as error:
            raise AuditError('OPERATING_LIMIT_MAPPING', 'People temperature source is malformed: ' + key) from error
        require(isinstance(reference, dict) and reference.get('source') == source and reference.get('semantic') == 'manufacturer_limit'
                and reference.get('method') == method
                and reference.get('quantity') == key and reference.get('value') == value
                and reference.get('unit') == unit and reference.get('criterion') == 'maximum'
                and reference.get('conversion') == {'name': '摄氏温度换算开尔文', 'version': '1.0.0',
                                                      'expression': 'T/K = t/degC + 273.15'}
                and reference.get('limitations') == published.get('limitations')
                and isinstance(reference.get('limitations'), list) and bool(reference['limitations']),
                'OPERATING_LIMIT_MAPPING', 'People exact declared source or limit semantics differs: ' + key)
        if key == 'short_circuit_temperature':
            require(reference.get('conditions') == {'short_circuit_duration': facts['short_circuit_duration']},
                    'OPERATING_LIMIT_MAPPING', 'People short-circuit temperature lost its maximum-duration condition')
    return {'summary': {'permissible_limits_checked': len(checks),
                        'numeric_status_counts': dict(Counter(row['status'] for row in checks)),
                        'mismatches': [row for row in checks if row['status'] != 'exact_match']},
            'source_headers_and_units': header, 'printed_page_text': footer, 'numeric_checks': checks,
            'scope': 'Published maximum temperatures and their duration condition only; not operating/fault inputs or manufacturing measurements.'}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def run(args):
    require(not args.output.exists(), 'OUTPUT_EXISTS', 'Output must be a new directory; existing evidence is never overwritten.')
    args.output.mkdir(parents=True)
    docs = {}
    downloads = DownloadAudit(args.output / 'original-pdf-downloads.json')
    try:
        data, catalogue_files, source_files = {}, {}, {}
        for name in SOURCES:
            data[name], catalogue_files[name] = read_catalogue(name, args.catalogue_root)
            raw, source_files[name] = pdf_bytes(name, getattr(args, name + '_pdf'), downloads)
            docs[name] = fitz.open(stream=raw, filetype='pdf')
            require(not docs[name].needs_pass and len(docs[name]) == SOURCES[name]['pages'], 'PDF_LAYOUT_MISMATCH',
                    f'{name}: encrypted PDF or unexpected page count')
            source_files[name]['pdf_pages'] = len(docs[name])
        downloads.finish()
        originals = original_cells(docs)
        checks, metrics, summary = compare_catalogues(data, originals)
        guidance = audit_published_guidance(docs['bahra'], data['bahra'])
        # Read the production metadata helper only; do not build a workbook,
        # invoke an importer, start the application, or execute a method.
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from backend.kernel.public_catalogues import _data, _people_operating_limits
        modelling, published = _people_operating_limits(_data('people-mv'))
        operating_limits = audit_people_operating_limits(docs['people'], published, modelling)
        summary['published_guidance'] = guidance['summary']
        summary['published_operating_limits'] = operating_limits['summary']
        mismatches = summary['mismatches'] + guidance['summary']['mismatches'] + operating_limits['summary']['mismatches']
        summary['status'] = 'failed' if mismatches else 'passed'
        report = {'created_utc': datetime.now(timezone.utc).isoformat(),
            'method': {'id': 'cablesim.catalogue-original-audit', 'version': METHOD_VERSION,
                       'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       'pdf_engine': 'PyMuPDF', 'pdf_engine_version': fitz.VersionBind},
            'audit_method': 'Independent coordinate extraction from SHA-pinned original PDFs; no workbook, import API, application or calculation plugin execution.',
            'source_files': source_files, 'catalogue_files': catalogue_files,
            'original_headers_and_units': originals[3], 'overlaid_pdf_tokens_suppressed': originals[4],
            'summary': summary, 'four_metric_checks': metrics, 'all_numeric_cell_checks': checks,
            'published_guidance_audit': guidance,
            'published_operating_limits_audit': operating_limits,
            'operating_limits_declaration_sha256': hashlib.sha256((ROOT / 'backend/kernel/public_catalogues.py').read_bytes()).hexdigest(),
            'rendered_pages': {},
            'visual_review': 'PNG pages are evidence for review; this automated run does not assert human visual inspection.',
            'limits': [
                'Checks faithful transcription of published approximate values, not measured manufacturing data or product compliance.',
                'The original product-table coverage is 877 numeric cells; four material-guide values, 84 logical factors, and three People operating limits are reported separately. This is not coverage of the complete handbooks.',
                'People page 1 permits up to 90 degrees C normally and 250 degrees C for at most 5 seconds. These maxima never declare actual operating temperatures, fault duration or test results.',
                'People R20 is unpublished: 46 absent slots do not count as numeric matches.',
                'Missing manufacturer construction and installation conditions remain missing; no reference assumptions are used here.',
                'Bahra reactance, cable codes and drum lengths are outside the transcribed columns; their neighbouring grid positions are not silently substituted.',
                'Short-circuit rows retain 1 second, resistance rows retain 20/90 degrees C, inductance/capacitance retain 60 Hz, and voltage drop retains its per-phase basis in the original headers.',
                'Bahra capacitance-guide permittivity is not substituted for IEC ampacity dielectric-loss inputs. The printed 100 percent load factor is explicitly converted to the dimensionless baseline 1.',
                'Tables 3–5 contain discrete manufacturer direct-burial factors only. Their conditions, area bounds and original units are retained; no interpolation, extrapolation or GB 50217 attribution is performed.',
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
        with (args.output / 'original-pdf-guidance.csv').open('w', newline='', encoding='utf-8') as stream:
            fields = ['id', 'category', 'table', 'unit', 'conditions', 'dataset_value', 'pdf_value', 'difference',
                      'status', 'text', 'pdf_page', 'printed_page', 'bbox_pdf_points']
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows({**item, 'conditions': json.dumps(item['conditions'], ensure_ascii=False, sort_keys=True),
                              'bbox_pdf_points': json.dumps(item['bbox_pdf_points'])} for item in guidance['numeric_checks'])
        with (args.output / 'original-pdf-operating-limits.csv').open('w', newline='', encoding='utf-8') as stream:
            fields = ['id', 'unit', 'criterion', 'conditions', 'dataset_value', 'pdf_value', 'difference',
                      'status', 'text', 'pdf_page', 'printed_page', 'bbox_pdf_points']
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows({**item, 'conditions': json.dumps(item['conditions'], ensure_ascii=False, sort_keys=True),
                              'bbox_pdf_points': json.dumps(item['bbox_pdf_points'])} for item in operating_limits['numeric_checks'])
        require(not mismatches, 'CATALOGUE_VALUE_MISMATCH',
                f'{len(mismatches)} published values differ from the original PDFs; see original-pdf-cell-audit.json')
        require(summary['four_metric_status_counts'] == {'exact_match': 190, 'not_published': 46}
                and summary['all_transcribed_numeric_cell_status_counts'] == {'exact_match': 877}
                and guidance['summary']['numeric_status_counts'] == {'exact_match': 88}
                and operating_limits['summary']['numeric_status_counts'] == {'exact_match': 3},
                'AUDIT_COVERAGE', 'Unexpected exact-match or unpublished-metric coverage')
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    finally:
        for doc in docs.values():
            doc.close()
        downloads.finish(sys.exception())


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
