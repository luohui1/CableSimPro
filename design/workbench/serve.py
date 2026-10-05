"""Serve the design prototype with the real host API and a separate local database."""
from pathlib import Path
import os
import sys
from hashlib import sha256

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi import Response, Request
from fastapi.responses import JSONResponse
from backend.main import create_app

app = create_app(Path(os.environ.get('CABLESIM_DESIGN_DB', str(ROOT / '.data' / 'design-workbench' / 'cablesim.sqlite'))))


class DesignFiles(StaticFiles):
    # This is a local editing server: a future/matching Last-Modified must not
    # leave the browser rendering an earlier layout after a source edit.
    def is_not_modified(self, response_headers, request_headers):
        return False

    async def get_response(self, path, scope):
        path = path.replace('\\', '/')
        prefix='node_modules/.cache/cablesim-occt/'
        if path.startswith(prefix) and path[len(prefix):] in ('occt-viewer.js','occt-viewer.wasm'):
            digest=Request(scope).query_params.get('v')
            if digest:
                asset=Path(self.directory)/path
                if not asset.is_file() or sha256(asset.read_bytes()).hexdigest()!=digest:
                    return JSONResponse({'detail':'CAD 运行文件已更新，请刷新页面。'},status_code=409,headers={'Cache-Control':'no-store'})
                headers={'Cache-Control':'public, max-age=31536000, immutable','ETag':'"'+digest+'"','Vary':'Accept-Encoding'}
                if Request(scope).headers.get('if-none-match') == headers['ETag']:
                    return Response(status_code=304,headers=headers)
                compressed=asset.with_name(asset.name+'.gz')
                if path.endswith('.wasm') and compressed.is_file() and 'gzip' in Request(scope).headers.get('accept-encoding',''):
                    headers['Content-Encoding']='gzip'
                    return FileResponse(compressed,media_type='application/wasm',headers=headers)
                return FileResponse(asset,media_type='application/wasm' if path.endswith('.wasm') else 'application/javascript',headers=headers)
        response=await super().get_response(path,scope)
        response.headers['Cache-Control']='no-store'
        return response


app.mount('/design', DesignFiles(directory=ROOT / 'design', html=True), name='design')
# The host's unknown-API catch-all must remain last after prototype routes.
fallback = next(route for route in app.router.routes if getattr(route, 'path', None) == '/api/{path:path}')
app.router.routes.remove(fallback)
app.router.routes.append(fallback)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8027)
