"""Versioned native assets may be cached; edited UI and obsolete builds may not."""
import asyncio
import gzip
from hashlib import sha256

from fastapi import FastAPI
from fastapi.testclient import TestClient

from design.workbench.serve import DesignFiles


def test_native_asset_digest_compression_and_revalidation(tmp_path):
    relative = 'node_modules/.cache/cablesim-occt/occt-viewer.wasm'
    asset = tmp_path / relative
    asset.parent.mkdir(parents=True)
    payload = b'\x00asm' + b'geometry-code' * 300
    asset.write_bytes(payload)
    asset.with_name(asset.name + '.gz').write_bytes(gzip.compress(payload, mtime=0))
    (tmp_path / 'app.js').write_text('current UI', encoding='utf-8')
    digest = sha256(payload).hexdigest()
    files = DesignFiles(directory=tmp_path)
    app = FastAPI()
    app.mount('/design', files)
    with TestClient(app) as client:
        url = '/design/' + relative + '?v=' + digest
        response = client.get(url, headers={'Accept-Encoding': 'gzip'})
        assert response.content == payload
        assert response.headers['Content-Encoding'] == 'gzip'
        assert response.headers['Content-Type'] == 'application/wasm'
        assert response.headers['Cache-Control'].endswith('immutable')
        assert response.headers['Vary'] == 'Accept-Encoding'
        revalidated = client.get(url, headers={'If-None-Match': response.headers['ETag']})
        assert revalidated.status_code == 304 and not revalidated.content
        assert client.get('/design/' + relative).headers['Cache-Control'] == 'no-store'
        assert client.get('/design/app.js').headers['Cache-Control'] == 'no-store'
        asset.write_bytes(b'rebuilt')
        obsolete = client.get(url)
        assert obsolete.status_code == 409
        assert obsolete.headers['Cache-Control'] == 'no-store'


def test_windows_static_path_receives_versioned_cache_headers(tmp_path):
    relative = 'node_modules/.cache/cablesim-occt/occt-viewer.js'
    asset = tmp_path / relative
    asset.parent.mkdir(parents=True)
    asset.write_bytes(b'factory')
    digest = sha256(asset.read_bytes()).hexdigest()
    files = DesignFiles(directory=tmp_path)
    response = asyncio.run(files.get_response(relative.replace('/', '\\'), {
        'type': 'http', 'method': 'GET', 'path': '/' + relative,
        'query_string': ('v=' + digest).encode(), 'headers': [],
    }))
    assert response.status_code == 200
    assert response.headers['Cache-Control'].endswith('immutable')
