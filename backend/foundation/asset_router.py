"""Local asset catalog endpoints. No endpoint mutates a project's engineering state."""
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Query
from pydantic import Field

from .assets import AssetRepository
from .contracts import (AssetKind, AssetParameter, AssetRelease, Contract, Digest,
                        Quantity, SourceReference, Version)
from .study import prepare_study

Status = Literal['draft', 'reviewed', 'published', 'deprecated']
Action = Literal['review', 'publish', 'return_to_draft', 'deprecate']


class ImportAsset(Contract):
    schema_version: Literal['csp-asset/0.1'] = 'csp-asset/0.1'
    release: AssetRelease


class AssetRevision(Contract):
    expected_revision: int = Field(ge=1, strict=True)


class EditAsset(AssetRevision):
    release: AssetRelease


class TransitionAsset(AssetRevision):
    content_sha256: Digest
    action: Action
    note: str = Field(min_length=4, max_length=1000)
    acknowledge_sources: bool = Field(default=False, strict=True)


class DeriveAsset(AssetRevision):
    content_sha256: Digest
    new_version: Version


class CaptureAsset(AssetRevision):
    name: str = Field(min_length=1, max_length=128)


def make_router(assets: AssetRepository, workspaces) -> APIRouter:
    router = APIRouter(prefix='/api/foundation', tags=['Local engineering assets'])

    @router.get('/assets')
    def list_assets(kind: AssetKind | None = None, status: Status | None = None,
                    q: str = Query(default='', max_length=128),
                    limit: int = Query(default=50, ge=1, le=100),
                    offset: int = Query(default=0, ge=0)):
        return assets.list(kind=kind, status=status, query=q, limit=limit, offset=offset)

    @router.post('/assets/import', status_code=201)
    def import_asset(body: ImportAsset):
        return assets.create(body.release)

    @router.get('/assets/{rid}')
    def asset_detail(rid: str):
        return assets.get(rid)

    @router.put('/assets/{rid}')
    def edit_asset(rid: str, body: EditAsset):
        return assets.update(rid, body.expected_revision, body.release)

    @router.post('/assets/{rid}/transition')
    def transition_asset(rid: str, body: TransitionAsset):
        return assets.transition(rid, body.expected_revision, body.content_sha256,
                                 body.action, body.note, body.acknowledge_sources)

    @router.post('/assets/{rid}/derive', status_code=201)
    def derive_asset(rid: str, body: DeriveAsset):
        return assets.derive(rid, body.expected_revision, body.content_sha256, body.new_version)

    @router.post('/workspaces/{wid}/assets/capture', status_code=201)
    def capture_asset(wid: str, body: CaptureAsset):
        # One transaction binds workspace revision, source digest, asset insertion,
        # and the asset audit. No workspace write / implicit approval is performed.
        with workspaces.db(True) as db:
            row, state = workspaces.load(db, wid, body.expected_revision)
            snapshot = {'id': wid, 'revision': row['revision'], **state}
            package = prepare_study(snapshot).package
            definition = AssetRelease(
                asset_id=f'local.cable.{uuid4()}', version='1.0.0', kind='assembly',
                name=body.name.strip(), geometry_recipe=package.geometry_recipe,
                parameters=(
                    AssetParameter(name='conductor_area', quantity=Quantity(
                        value=float(snapshot['scenario']['cable']['area_mm2']), unit='mm2', dimension='area')),
                    AssetParameter(name='conductor_limit', quantity=package.conductor_limit),
                ),
                sources=(SourceReference(kind='project_input', reviewed=False,
                    reference=f'workspace:{wid}@{row["revision"]}#sha256:{package.source_sha256}'),),
            )
            rid = assets._insert(db, definition, '从已提交工程捕获结构草稿；不复制工况、物性或结果。')
            return assets._detail(db, assets._load(db, rid))

    return router
