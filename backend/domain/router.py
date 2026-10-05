"""Explicit conversion and one current domain document per workspace."""
from fastapi import APIRouter, HTTPException

from ..kernel.workspace import Revision
from .guards import describe_locks, validate_lock
from .migration import convert
from .editing import DraftDomainDocument, resolve_edit


class SaveDomain(Revision):
    document: DraftDomainDocument


def make_router(store):
    router = APIRouter(prefix='/api/workspaces')

    @router.get('/{wid}/domain')
    def get(wid: str):
        state = store.snapshot(wid)
        return {'revision': state['revision'], 'document': state.get('domain'),
                'conversion': state.get('domain_conversion'),
                'locks': describe_locks(state) if state.get('domain') else []}

    @router.get('/{wid}/domain/conversion')
    def preview(wid: str):
        state = store.snapshot(wid)
        if state.get('domain'):
            raise HTTPException(409, '工程已转换。')
        return {'base_revision': state['revision'], **convert(state['scenario'])}

    @router.post('/{wid}/domain/conversion')
    def migrate(wid: str, body: Revision):
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision)
            converted = convert(state['scenario'])
            state['domain'] = converted['document']
            state['domain_conversion'] = {'source_revision': row['revision'], 'method_parameters': converted['method_parameters'], 'warnings': converted['warnings']}
            for path in state.get('locks', []):
                validate_lock(state, path)
            store.commit(db, row, state, '转换领域文档')
        return get(wid)

    @router.put('/{wid}/domain')
    def save(wid: str, body: SaveDomain):
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision, allow_domain=True)
            if 'domain' not in state:
                raise HTTPException(409, '请先显式转换工程。')
            document = resolve_edit(state, body.document)
            state['domain'] = document
            store.commit(db, row, state, '保存领域文档')
        return get(wid)

    return router
