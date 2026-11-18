"""Audit real LV, 35 kV and 220 kV imports against their official originals.

The normal test suite never downloads manufacturer files. This CI gate obtains
the originals explicitly, runs the same real upload-to-Types workflows with
their independent source checks enabled, and retains receipts and source pages.
PDFs must have the exact declared bytes. The Jiangnan HTML page may change
outside its table; its original headers, all 20 rows and the selected CSV cells
must still agree. No missing engineering property is supplied by this audit.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from urllib.error import URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, build_opener
from xml.etree import ElementTree

import fitz

from verify_catalogue_originals import AuditError, OfficialRedirect, official_url, require


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures'
METHOD = {'name': '厂家结构表原件与真实导入核验', 'version': '1.0.0'}
SOURCES = {
    'chint': {
        'metadata': 'chint_lv_yjv_source.json', 'suffix': '.pdf',
        'environment': 'CABLESIM_CHINT_ORIGINAL',
        'test': 'tests/test_real_lv_catalogue_import.py',
        'hosts': {'cabling.chint.com'}, 'limit': 32 * 1024 * 1024,
        'render_pages': (17, 20, 21),
    },
    'jiangnan': {
        'metadata': 'jiangnan_yjv22.json', 'suffix': '.html',
        'environment': 'CABLESIM_JIANGNAN_ORIGINAL',
        'test': 'tests/test_jiangnan_table_import.py',
        'hosts': {'www.jiangnancable.com', 'jiangnancable.com'},
        'limit': 4 * 1024 * 1024,
    },
    'tai_i': {
        'metadata': 'tai_i_220kv_catalogue.json', 'suffix': '.pdf',
        'environment': 'CABLESIM_TAI_I_ORIGINAL',
        'test': 'tests/test_tai_i_220kv_import.py',
        'hosts': {'www.tai-i-int.com.tw', 'tai-i-int.com.tw'},
        'limit': 32 * 1024 * 1024, 'render_pages': (6,),
    },
}


def obtain(name, local):
    source = SOURCES[name]
    declaration = json.loads((FIXTURES / source['metadata']).read_text('utf-8'))['source']
    if local is not None:
        require(local.is_file() and 0 < local.stat().st_size <= source['limit'],
                'SOURCE_SIZE', f'{name}: original file is missing or exceeds its size limit')
        raw = local.read_bytes()
        origin = {'mode': 'local', 'path': str(local.resolve())}
    else:
        official_url(declaration['url'], source)
        parsed = urlsplit(declaration['url'])
        url = urlunsplit(parsed._replace(path=quote(parsed.path, safe='/%')))
        request = Request(url, headers={'User-Agent': 'Mozilla/5.0 CableSimPro source-audit/1.0',
                                       'Accept-Encoding': 'identity'})
        start = time.monotonic()
        try:
            with build_opener(OfficialRedirect(source)).open(request, timeout=30) as response:
                official_url(response.geturl(), source)
                require(response.status == 200, 'SOURCE_HTTP', f'{name}: expected HTTP 200')
                length = response.headers.get('Content-Length')
                require(length is None or length.isdigit() and 0 < int(length) <= source['limit'],
                        'SOURCE_SIZE', f'{name}: invalid or excessive Content-Length')
                chunks, size = [], 0
                while True:
                    require(time.monotonic() - start <= 120, 'SOURCE_TIMEOUT', f'{name}: exceeded 120 seconds')
                    chunk = response.read1(128 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    require(size <= source['limit'], 'SOURCE_SIZE', f'{name}: original exceeds size limit')
                    chunks.append(chunk)
                raw = b''.join(chunks)
                require(time.monotonic() - start <= 120, 'SOURCE_TIMEOUT', f'{name}: exceeded 120 seconds')
                require(length is None or len(raw) == int(length), 'SOURCE_SIZE', f'{name}: incomplete HTTP body')
                origin = {'mode': 'official_download', 'final_url': response.geturl()}
        except (OSError, URLError) as exc:
            raise AuditError('SOURCE_UNAVAILABLE', f'{name}: official source download failed: {exc}') from exc
    digest = sha256(raw).hexdigest()
    if source['suffix'] == '.pdf':
        require(raw.startswith(b'%PDF-'), 'SOURCE_FORMAT', f'{name}: original is not a PDF')
        require(len(raw) == declaration['size_bytes'] and digest == declaration['sha256'],
                'SOURCE_IDENTITY', f'{name}: expected {declaration["size_bytes"]} bytes / {declaration["sha256"]}; '
                                   f'received {len(raw)} bytes / {digest}')
    else:
        require(b'tablepress-26yjv22' in raw, 'SOURCE_FORMAT', f'{name}: original table is absent')
    return raw, {'source': name, 'url': declaration['url'], 'sha256': digest,
                 'size_bytes': len(raw), 'origin': origin,
                 'identity_rule': 'exact_pdf_bytes' if source['suffix'] == '.pdf' else 'original_table_headers_cells_and_locators'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New evidence directory')
    parser.add_argument('--chint-pdf', type=Path)
    parser.add_argument('--jiangnan-html', type=Path)
    parser.add_argument('--tai-i-pdf', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {'schema': 'cablesim.import-originals-audit/1', 'method': METHOD,
              'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'failed',
              'sources': [], 'scope': 'Source transcription and real import preservation; no product approval or missing-value substitution.'}
    try:
        with TemporaryDirectory(prefix='cablesim-import-originals-') as temporary:
            environment = os.environ.copy()
            environment['CABLESIM_JIANGNAN_AUDIT_OUTPUT'] = str(output / 'jiangnan-table.json')
            selected = {'chint': args.chint_pdf, 'jiangnan': args.jiangnan_html, 'tai_i': args.tai_i_pdf}
            for name, source in SOURCES.items():
                raw, receipt = obtain(name, selected[name])
                path = Path(temporary) / (name + source['suffix'])
                path.write_bytes(raw)
                environment[source['environment']] = str(path)
                report['sources'].append(receipt)
                print(f'{name}: original source bytes {receipt["sha256"]} ({len(raw)} bytes)', flush=True)
                if source['suffix'] == '.pdf':
                    with fitz.open(stream=raw, filetype='pdf') as pdf:
                        receipt['pages'] = len(pdf)
                        receipt['rendered_pages'] = []
                        for page in source['render_pages']:
                            filename = f'{name}-pdf-{page}.png'
                            pdf[page - 1].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(output / filename)
                            receipt['rendered_pages'].append({'pdf_page': page, 'file': filename})
            junit = output / 'import-tests.xml'
            command = [sys.executable, '-m', 'pytest', '-n', '0', '-q', '--tb=short',
                       '--junitxml=' + str(junit), *[item['test'] for item in SOURCES.values()]]
            result = subprocess.run(command, cwd=ROOT, env=environment, timeout=300)
            report['test_exit_code'] = result.returncode
            require(result.returncode == 0, 'IMPORT_TEST_FAILED', 'Source or real import workflow failed; see the pytest evidence.')
            suites = ElementTree.parse(junit).getroot().findall('.//testsuite')
            counts = {key: sum(int(suite.get(key, '0')) for suite in suites)
                      for key in ('tests', 'failures', 'errors', 'skipped')}
            report['tests'] = counts
            require(counts['tests'] >= 11 and not any(counts[key] for key in ('failures', 'errors', 'skipped')),
                    'AUDIT_INCOMPLETE', f'Every original-source check and import must run: {counts}')
            report['status'] = 'passed'
    except (AuditError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        report['error'] = {'code': getattr(exc, 'code', 'AUDIT_FAILED'), 'message': str(exc)}
        print(f'Original import audit failed: {exc}', file=sys.stderr, flush=True)
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
