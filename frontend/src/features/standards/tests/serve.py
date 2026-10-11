"""Isolated read-only browser fixture, no workspace or demonstration database.

Only the new query router is mounted; application wiring is owned by Claude.
Run through verify-browser.mjs, which owns its random port and process lifetime.
"""
from fastapi import FastAPI
from backend.plugin_host.executor import Executor
from backend.plugin_host.query_router import make_router
from backend.plugin_host.registry import Registry
from backend.kernel.workspace import fingerprint

app=FastAPI()
app.include_router(make_router(Executor()))


@app.get('/api/methods')
def methods():
    p=Registry(plugin_id='cablesim.standards-basis').get('cablesim.standards-basis')
    return [{'method':{'plugin_id':p.manifest.id,'version':p.manifest.version,
                       'release_digest':fingerprint(p.manifest.model_dump(mode='json',by_alias=True))},
             'name':p.manifest.name,'capabilities':[c.model_dump(mode='json',by_alias=True) for c in p.manifest.capabilities]}]


@app.get('/api/health')
def health():return {'status':'ok'}


@app.get('/api/foundation/assets')
def assets():return {'items':[],'total':0}


@app.get('/api/workspaces')
@app.get('/api/design/type-workspaces')
def empty_index():return []
