"""Exercise real local HTTP transport faults, not manufacturer data correctness.

The test handler sends actual HTTP bytes, stalls sockets, and resets connections.
Only the HTTPS connection transport is redirected to a loopback HTTP server;
the production URL/redirect validation and response reader still run unchanged.
Small, explicitly synthetic payload hashes replace the source pins in these
protocol tests. The official PDFs and their 877 + 88 values remain a separate gate.
"""
from __future__ import annotations

import hashlib
import json
import socket
import ssl
import struct
import sys
import threading
from http.client import HTTPConnection, RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.error import URLError
from urllib.request import HTTPSHandler, ProxyHandler, build_opener

import pytest

from scripts import verify_catalogue_originals as audit


BODY = b'%PDF-1.7\nProtocol fixture only, not a catalogue.\n%%EOF\n'
PARTIAL = b'discard-this-partial-response'
ORIGINAL_SHA = {name: source['sha256'] for name, source in audit.SOURCES.items()}


@pytest.fixture
def protocol(monkeypatch, tmp_path):
    replies, requests = [], []
    stop = threading.Event()
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_args):
            pass

        def do_GET(self):
            with lock:
                requests.append({'host': self.headers['Host'], 'path': self.path,
                                 'headers': dict(self.headers)})
                reply = replies.pop(0) if replies else {'status': 599}
            if 'before' in reply:
                reply['before']()
            body = reply.get('body', BODY)
            status = reply.get('status', 200)
            fault = reply.get('fault')
            self.send_response(status)
            self.send_header('Connection', 'close')
            if reply.get('location'):
                self.send_header('Location', reply['location'])
            if fault == 'chunked':
                self.send_header('Transfer-Encoding', 'chunked')
            elif not reply.get('no_length'):
                self.send_header('Content-Length', reply.get('length', str(len(body))))
            self.end_headers()
            self.close_connection = True
            try:
                if fault in ('reset', 'timeout'):
                    self.wfile.write(PARTIAL)
                    self.wfile.flush()
                    if fault == 'reset':
                        self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                            struct.pack('HH' if sys.platform == 'win32' else 'ii', 1, 0))
                        self.connection.close()
                    else:
                        stop.wait(2)
                elif fault == 'slow':
                    for _ in range(100):
                        self.wfile.write(b'x')
                        self.wfile.flush()
                        if stop.wait(.02):
                            break
                elif fault == 'chunked':
                    self.wfile.write(b'not-a-chunk-length\r\n')
                else:
                    self.wfile.write(body)
            except OSError:
                # The client deliberately closes failed/expired responses.
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    worker = threading.Thread(target=lambda: server.serve_forever(poll_interval=.01), daemon=True)
    worker.start()

    class LoopbackHTTPS(HTTPSHandler):
        def https_open(self, request):
            return self.do_open(lambda _host, timeout, **_kwargs:
                HTTPConnection('127.0.0.1', server.server_port, timeout=timeout), request)

    monkeypatch.setattr(audit, 'build_opener', lambda *handlers:
                        build_opener(ProxyHandler({}), LoopbackHTTPS(), *handlers))
    monkeypatch.setattr(audit, 'SOURCES', {name: {**source, 'sha256': hashlib.sha256(BODY).hexdigest()}
                                        for name, source in audit.SOURCES.items()})
    monkeypatch.setattr(audit, 'NETWORK_TIMEOUT', .15)
    monkeypatch.setattr(audit, 'DOWNLOAD_SECONDS', 2)
    monkeypatch.setattr(audit, 'DOWNLOAD_STAGE_SECONDS', 5)
    output = tmp_path / 'downloads.json'
    fixture = SimpleNamespace(replies=replies, requests=requests, output=output,
                              downloads=audit.DownloadAudit(output))
    try:
        yield fixture
    finally:
        stop.set()
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)
        assert not worker.is_alive()


def records(protocol):
    return json.loads(protocol.output.read_text())


@pytest.mark.parametrize('fault', ['timeout', 'reset'])
def test_transient_partial_body_is_discarded_before_one_new_request(protocol, fault):
    protocol.replies.extend([{'fault': fault}, {}])
    raw, source = protocol.downloads.fetch('people')
    assert raw == BODY and source['bytes'] == len(BODY)
    assert source['mode'] == 'official_download'
    assert source['primary_url'] == source['final_url'] == audit.SOURCES['people']['url']
    assert len(protocol.requests) == 2
    assert protocol.requests[0] == protocol.requests[1]
    report = records(protocol)
    first, second = report['attempts']
    assert first['http_status'] == 200 and first['declared_size'] == str(len(BODY))
    assert first['received_bytes'] == len(PARTIAL) and first['elapsed_seconds'] > 0
    assert first['partial_body_discarded'] and first['retry_scheduled']
    assert first['error']['code'] == 'SOURCE_UNAVAILABLE'
    assert [first['status'], second['status']] == ['failed', 'passed']
    assert second['received_bytes'] == len(BODY)
    assert report['remaining_extra_connections'] == 0
    assert sorted(path.name for path in protocol.output.parent.iterdir()) == ['downloads.json']


def test_two_sources_share_one_extra_attempt(protocol):
    protocol.replies.extend([{'fault': 'reset'}, {}, {'fault': 'reset'}, {}])
    protocol.downloads.fetch('people')
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('bahra')
    assert failure.value.code == 'SOURCE_UNAVAILABLE'
    attempts = records(protocol)['attempts']
    assert [item['source'] for item in attempts] == ['people', 'people', 'bahra']
    assert len(protocol.requests) == 3 and len(protocol.replies) == 1
    assert not attempts[-1]['retry_scheduled']


def test_second_transport_failure_is_final(protocol):
    protocol.replies.extend([{'fault': 'reset'}, {'fault': 'reset'}, {}])
    with pytest.raises(audit.AuditError):
        protocol.downloads.fetch('people')
    assert len(protocol.requests) == 2 and len(protocol.replies) == 1
    assert [attempt['retry_scheduled'] for attempt in records(protocol)['attempts']] == [True, False]


def test_slow_body_hits_attempt_budget_and_reconnects(protocol, monkeypatch):
    monkeypatch.setattr(audit, 'DOWNLOAD_SECONDS', .4)
    protocol.replies.extend([{'fault': 'slow', 'length': '1000000'}, {}])
    assert protocol.downloads.fetch('people')[0] == BODY
    attempts = records(protocol)['attempts']
    assert len(protocol.requests) == 2
    assert attempts[0]['error']['code'] == 'SOURCE_TIMEOUT'
    assert attempts[0]['received_bytes'] > 0 and attempts[0]['elapsed_seconds'] >= .4
    assert attempts[1]['received_bytes'] == len(BODY)


def test_shared_budget_stops_slow_body_without_using_retry(protocol, monkeypatch):
    monkeypatch.setattr(audit, 'DOWNLOAD_STAGE_SECONDS', .4)
    protocol.replies.extend([{'fault': 'slow', 'length': '1000000'}, {}])
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('people')
    assert failure.value.code == 'SOURCE_DOWNLOAD_BUDGET'
    report = records(protocol)
    assert len(protocol.requests) == 1 and report['remaining_extra_connections'] == 1
    assert report['attempts'][0]['received_bytes'] > 0
    assert report['stage_elapsed_seconds'] >= .4


def test_budget_clock_does_not_restart_for_the_second_source(protocol, monkeypatch):
    # Only the budget clock is controlled here; both HTTP responses are real.
    clock = SimpleNamespace(now=0)
    monkeypatch.setattr(audit, 'time', SimpleNamespace(monotonic=lambda: clock.now))
    monkeypatch.setattr(audit, 'DOWNLOAD_STAGE_SECONDS', 270)
    monkeypatch.setattr(audit, 'DOWNLOAD_SECONDS', 200)
    protocol.replies.extend([{'before': lambda: setattr(clock, 'now', 150)},
                             {'before': lambda: setattr(clock, 'now', 271)}, {}])
    protocol.downloads.fetch('people')
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('bahra')
    assert failure.value.code == 'SOURCE_DOWNLOAD_BUDGET'
    report = records(protocol)
    assert report['stage_elapsed_seconds'] == 271
    assert report['attempts'][-1]['elapsed_seconds'] == 121
    assert len(protocol.requests) == 2 and report['remaining_extra_connections'] == 1


@pytest.mark.parametrize('status', [401, 403, 408, 429, 503])
def test_http_failure_is_never_retried(protocol, status):
    protocol.replies.extend([{'status': status}, {}])
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('people')
    assert failure.value.code == 'SOURCE_HTTP'
    report = records(protocol)
    attempt, = report['attempts']
    assert attempt['http_status'] == status and attempt['declared_size'] == str(len(BODY))
    assert attempt['received_bytes'] == 0 and not attempt['retry_scheduled']
    assert len(protocol.requests) == 1 and report['remaining_extra_connections'] == 1


@pytest.mark.parametrize('url', ['http://www.chinapeople.com/replaced.pdf',
                               'https://unrelated.invalid/replaced.pdf',
                               'https://www.chinapeople.com:444/replaced.pdf'])
def test_official_redirect_policy_is_not_retried_or_relaxed(protocol, url):
    protocol.replies.extend([{'status': 302, 'location': url, 'body': b''}, {}])
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('people')
    assert failure.value.code == 'SOURCE_REDIRECT'
    attempt, = records(protocol)['attempts']
    assert attempt['http_status'] == 302 and attempt['final_url'] == audit.SOURCES['people']['url']
    assert attempt['redirects'][0]['location'] == url
    assert not attempt['retry_scheduled'] and len(protocol.requests) == 1


def test_allowed_redirect_is_recorded_and_still_hash_checked(protocol):
    final = 'https://chinapeople.com/official.pdf'
    protocol.replies.extend([{'status': 302, 'location': final, 'body': b''}, {}])
    assert protocol.downloads.fetch('people')[1]['final_url'] == final
    attempt, = records(protocol)['attempts']
    assert attempt['redirects'][0]['location'] == final
    assert attempt['status'] == 'passed' and attempt['received_bytes'] == len(BODY)
    assert len(protocol.requests) == 2


@pytest.mark.parametrize('reply', [
    {'length': 'invalid'}, {'length': str(audit.MAX_PDF_BYTES + 1)},
    {'length': str(len(BODY) + 10)}, {'fault': 'chunked'},
])
def test_invalid_or_incomplete_http_body_is_not_retried(protocol, reply):
    protocol.replies.extend([reply, {}])
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('people')
    assert failure.value.code == 'SOURCE_SIZE'
    attempt, = records(protocol)['attempts']
    assert not attempt['retry_scheduled'] and len(protocol.requests) == 1


def test_streamed_size_limit_still_rejects_without_retry(protocol, monkeypatch):
    monkeypatch.setattr(audit, 'MAX_PDF_BYTES', len(BODY))
    protocol.replies.extend([{'no_length': True, 'body': BODY + b'x'}, {}])
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('people')
    assert failure.value.code == 'SOURCE_SIZE'
    attempt, = records(protocol)['attempts']
    assert attempt['received_bytes'] == len(BODY) + 1 and not attempt['retry_scheduled']
    assert len(protocol.requests) == 1


@pytest.mark.parametrize('valid_hash', [False, True])
def test_sha_and_pdf_signature_rejections_are_not_retried(protocol, monkeypatch, valid_hash):
    bad = b'not an original PDF'
    if valid_hash:
        monkeypatch.setitem(audit.SOURCES['people'], 'sha256', hashlib.sha256(bad).hexdigest())
    protocol.replies.extend([{'body': bad}, {}])
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('people')
    assert failure.value.code == ('SOURCE_FORMAT' if valid_hash else 'PDF_SHA256_MISMATCH')
    attempt, = records(protocol)['attempts']
    assert attempt['received_bytes'] == len(bad) and not attempt['retry_scheduled']
    assert len(protocol.requests) == 1


@pytest.mark.parametrize('error', [URLError(ssl.SSLCertVerificationError('certificate rejected')),
                                 URLError(PermissionError('permission denied')),
                                 URLError('timed out'), RemoteDisconnected('premature disconnect')])
def test_unclassified_tls_permission_or_protocol_errors_are_not_transient(error):
    assert not audit.retryable_transport(error)


@pytest.mark.parametrize('reply,code', [({'status': 403}, 'SOURCE_HTTP'),
                                       ({'fault': 'reset'}, 'SOURCE_UNAVAILABLE')])
def test_diagnostic_write_error_preserves_the_original_rejection(protocol, monkeypatch, capsys, reply, code):
    write = audit.write_json

    def fail_on_rejection(path, report):
        if any(item['status'] == 'failed' for item in report['attempts']):
            raise PermissionError('diagnostic output became unwritable')
        return write(path, report)

    monkeypatch.setattr(audit, 'write_json', fail_on_rejection)
    protocol.replies.extend([reply, {}])
    with pytest.raises(audit.AuditError) as failure:
        protocol.downloads.fetch('people')
    assert failure.value.code == code
    stderr = json.loads(capsys.readouterr().err)
    assert stderr['code'] == 'SOURCE_DIAGNOSTICS_UNAVAILABLE'
    assert stderr['original_error'] == str(failure.value.__cause__)
    assert len(protocol.requests) == 1


def test_cli_failure_keeps_attempt_diagnostics_and_returns_one(protocol, monkeypatch, tmp_path, capsys):
    for name, sha in ORIGINAL_SHA.items():
        monkeypatch.setitem(audit.SOURCES[name], 'sha256', sha)
    protocol.replies.append({'status': 503})
    output = tmp_path / 'cli-output'
    monkeypatch.setattr(sys, 'argv', ['verify_catalogue_originals.py', '--output', str(output)])
    assert audit.main() == 1
    saved = json.loads((output / 'original-pdf-downloads.json').read_text())
    assert saved['attempts'][0]['http_status'] == 503
    assert saved['attempts'][0]['received_bytes'] == 0
    assert saved['audit_error']['code'] == 'SOURCE_HTTP'
    assert saved['finished_utc'] and len(protocol.requests) == 1
    assert json.loads(capsys.readouterr().err)['code'] == 'SOURCE_HTTP'


def test_local_source_is_explicit_and_still_hash_checked(protocol, tmp_path):
    original = tmp_path / 'explicit-local.pdf'
    original.write_bytes(BODY)
    raw, source = audit.pdf_bytes('people', original, protocol.downloads)
    assert raw == BODY and source['mode'] == 'local'
    assert source['path'] == str(original.resolve())
    assert protocol.requests == [] and protocol.downloads.report['attempts'] == []
    original.write_bytes(BODY + b'changed')
    with pytest.raises(audit.AuditError) as failure:
        audit.pdf_bytes('people', original, protocol.downloads)
    assert failure.value.code == 'PDF_SHA256_MISMATCH'


def test_fixed_production_transport_limits_and_pins():
    assert audit.DOWNLOAD_SECONDS == 120 and audit.DOWNLOAD_STAGE_SECONDS == 270
    assert audit.NETWORK_TIMEOUT == 30 and audit.MAX_PDF_BYTES == 32 * 1024 * 1024
    assert audit.OfficialRedirect.max_redirections == 3 and audit.OfficialRedirect.max_repeats == 1
    assert audit.SOURCES['people']['sha256'] == 'c60b53c188478b55f424f49ca31506c5f7c100d2c876f91aab65622e86ddba4a'
    assert audit.SOURCES['bahra']['sha256'] == '6c0d7cf7e92a7292d3b1c3a0ed07a956ac17005c2918c1debd6234c7c155243a'
