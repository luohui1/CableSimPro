"""Opt-in, sealed capability queries. No database or plugin-specific branches.

Application wiring: app.include_router(make_router(research.executor)).
"""
from collections import OrderedDict
from copy import deepcopy
from hashlib import sha256
import json
from threading import Lock

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, JsonValue


class CapabilityQuery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    release_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    input: dict[str, JsonValue]


def make_router(executor):
    router = APIRouter(prefix='/api/plugin-queries', tags=['read-only-capabilities'])
    cache, lock = OrderedDict(), Lock()
    # Admission is serialized, so concurrent retries execute only once; bounded
    # to 32 MiB across 32 entries. Executor's timeout bounds lock occupancy.
    cached_bytes = 0

    @router.post('/{plugin_id}/{capability_id}')
    def query(plugin_id: str, capability_id: str, body: CapabilityQuery):
        nonlocal cached_bytes
        from .registry import Registry
        plugin = Registry(executor.registry.root, plugin_id=plugin_id).get(plugin_id)
        plugin.verify()
        try:
            capability = plugin.manifest.capability(capability_id)
        except KeyError:
            raise HTTPException(404, {'code': 'CAPABILITY_UNKNOWN', 'message': '没有此能力。'}) from None
        if not capability.read_only:
            raise HTTPException(403, {'code': 'QUERY_NOT_READ_ONLY', 'message': '此能力未声明只读，请使用正式运行流程。'})
        from ..kernel.workspace import fingerprint
        release = fingerprint(plugin.manifest.model_dump(mode='json', by_alias=True))
        if release != body.release_digest:
            raise HTTPException(409, {'code': 'PLUGIN_VERSION_CHANGED', 'message': '依据发行已变化，请重新读取目录；历史引用不自动换版。'})
        try:
            raw = json.dumps(body.input, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        except ValueError:
            raise HTTPException(422, {'code': 'QUERY_NON_FINITE', 'message': '查询数值必须有限，请改正 NaN 或无穷大。'}) from None
        if len(raw) > 64 * 1024:
            raise HTTPException(413, {'code': 'QUERY_TOO_LARGE', 'message': '只读查询最多64 KB，请缩小条件。'})
        query_digest = sha256(raw).hexdigest()
        key = (release, capability_id, query_digest)
        with lock:
            if key in cache:
                cache.move_to_end(key)
                return deepcopy(cache[key][0])
            result = executor.run(plugin_id, capability_id, cases=[{'case_id': 'query', 'input': body.input}], expected_manifest=plugin.manifest)
            case = result.cases[0]
            if case.status != 'succeeded':
                raise HTTPException(422, case.error or {'code': 'QUERY_FAILED', 'message': '查询未成功，请检查字段。'})
            answer = {'plugin_id': result.plugin_id, 'plugin_version': result.plugin_version,
                      'release_digest': release, 'query_sha256': query_digest,
                      'request_sha256': result.request_sha256, 'artifacts': case.artifacts,
                      'artifact_digests': case.artifact_digests, 'warnings': case.warnings}
            size = len(json.dumps(answer, ensure_ascii=False, allow_nan=False).encode())
            if size <= 32 * 1024 * 1024:
                while cache and (len(cache) >= 32 or cached_bytes + size > 32 * 1024 * 1024):
                    _, (_, old_size) = cache.popitem(last=False)
                    cached_bytes -= old_size
                cache[key] = (deepcopy(answer), size)
                cached_bytes += size
            return answer

    return router
