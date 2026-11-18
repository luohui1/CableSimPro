"""Selectable material/environment evidence from the installed, sealed data plugin.

This is an index over the existing standards query contract, not a second set of
material constants. Reading a reference does not approve it or alter an input.
"""
from __future__ import annotations

from copy import deepcopy
from collections import OrderedDict
import json
from math import isfinite
from threading import Lock
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, JsonValue

from backend.schemas import StrictModel
from backend.foundation.contracts import Quantity, ReferenceEvidence
from backend.plugin_host.registry import Registry
from .workspace import fingerprint


PLUGIN = 'cablesim.standards-basis'
SCHEMA = 'cablesim.standards-query/1'
MAX_RESOLVED_RECEIPTS = 128
Category = Literal['materials', 'environment', 'manufacturing']

# Identifiers select tables that are already shipped and sealed. No numerical
# property or engineering criterion is reproduced in the host.
MATERIAL_TABLES = {
    'iec60287-1-1-table1', 'iec60287-1-1-table3', 'iec60287-2-1-table1',
    'sc-material-constants', 'sc-adjacent-thermal', 'nielsen-Table1',
    'huang-TableA1', 'youn-degassing-table1', 'iec60228-table1', 'iec60228-table2',
    'lv-表18', 'lv-表19', 'mv-表20', 'mv-表21', 'v35-表17', 'v35-表18',
}
ENVIRONMENT_TABLES = {
    'iec60287-3-1-table1', 'iec60287-3-1-table2', 'iec60287-3-1-annex-a4',
    'iec60287-2-1-table5', 'qi-eahe-table1', 'qi-eahe-capacity',
    'deng-dbhe-table2', 'deng-dbhe-capacity', 'hopmans-soil-capacity-model',
    'sah-backfill-table2', 'sah-backfill-table3',
}


class Selection(StrictModel):
    release_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    data_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    standard: str = Field(min_length=1, max_length=80)
    edition: str = Field(min_length=1, max_length=80)
    locator: str = Field(min_length=1, max_length=80)
    quantity: str = Field(min_length=1, max_length=180)
    record_id: str = Field(min_length=1, max_length=180)
    conditions: dict[str, JsonValue] = Field(max_length=100)


def _category(table, category):
    identifier = table['id']
    if category == 'materials':
        return identifier in MATERIAL_TABLES
    if category == 'environment':
        return identifier in ENVIRONMENT_TABLES or identifier.startswith('gb50217-')
    return table['standard'].startswith(('GB/T 12706', 'GB/T 11017', 'GB/T 18890', 'GB/T 3956'))


def _trust(record):
    """Transcription quality and engineering adoption remain separate facts."""
    verified = record.get('verification', {}).get('status') == 'verified'
    numeric = type(record.get('value')) in (int, float) and isfinite(record['value'])
    if not verified or not numeric:
        return {'grade': 'unavailable', 'label': '不可采用',
                'reason': '依据尚未核验或原文未给唯一数值；保留缺项。'}
    return {'grade': 'reference', 'label': '参考',
            'reason': '已核验的标准或文献摘录；适用条件须逐项确认，不代表实测物性或工程批准。'}


def _si_quantity(record):
    aliases = {'K·m/W': 'K.m/W', 'K*m/W': 'K.m/W', '°C': 'degC', '℃': 'degC',
               'J/(m³.K)': 'J/(m3.K)', 'W/(m·K)': 'W/(m.K)'}
    try:
        dimension = record['quantity']['dimension']
        if dimension == 'temperature' and record['quantity']['unit'] in ('°C', '℃', 'degC', 'K'):
            dimension = 'absolute_temperature'
        return Quantity(value=float(record['value']), dimension=dimension,
            unit=aliases.get(record['quantity']['unit'], record['quantity']['unit'])).si()
    except (TypeError, ValueError):
        return None


class ResourceData:
    def __init__(self, executor):
        self.executor = executor
        self._resolved_receipts = OrderedDict()
        self._receipt_lock = Lock()

    def _plugin(self):
        plugin = Registry(self.executor.registry.root, plugin_id=PLUGIN).get(PLUGIN)
        plugin.verify()
        release = fingerprint(plugin.manifest.model_dump(mode='json', by_alias=True))
        return plugin, release

    def _query(self, plugin, release, query):
        result = self.executor.run(PLUGIN, 'lookup',
            [{'case_id': 'resource', 'input': {'schema_version': SCHEMA, **query}}],
            expected_manifest=plugin.manifest)
        case = result.cases[0]
        if case.status != 'succeeded':
            raise HTTPException(422, case.error or {'code': 'RESOURCE_QUERY_FAILED', 'message': '依据查询失败。'})
        answer = case.artifacts['x-cablesim.standards-basis']
        receipt = {'release_digest': release, 'request_sha256': result.request_sha256,
                'artifact_sha256': case.artifact_digests['x-cablesim.standards-basis'],
                'method': {'plugin_id': PLUGIN, 'name': plugin.manifest.name,
                           'version': result.plugin_version, 'method_version': result.method_version,
                           'capability': 'lookup'}, 'answer': answer}
        # Each call above really re-executes the sealed provider. Run ids make
        # request hashes differ even for identical queries. Keep the previous
        # complete, genuinely issued receipt only when every result byte other
        # than that execution-instance hash is unchanged. A draft preview and
        # its confirmation can then refer to the exact same immutable release.
        # This bounded per-service cache is not an asset store; after restart a
        # caller must preview again. Never accept a client-supplied receipt here.
        if query.get('operation') == 'resolve' and len(json.dumps(receipt).encode('utf-8')) <= 64*1024:
            key = (release, fingerprint(query))
            with self._receipt_lock:
                prior = self._resolved_receipts.get(key)
                stable = lambda value: {k: v for k, v in value.items() if k != 'request_sha256'}
                if prior is not None and stable(prior) == stable(receipt):
                    receipt = deepcopy(prior)
                else:
                    self._resolved_receipts[key] = deepcopy(receipt)
                self._resolved_receipts.move_to_end(key)
                while len(self._resolved_receipts) > MAX_RESOLVED_RECEIPTS:
                    self._resolved_receipts.popitem(last=False)
        return receipt

    def catalogue(self, category: Category):
        plugin, release = self._plugin()
        receipt = self._query(plugin, release, {'operation': 'catalog', 'compact': True})
        answer = receipt['answer']
        return {key: value for key, value in receipt.items() if key != 'answer'} | {
            'category': category, 'data_sha256': answer['data_sha256'],
            'tables': [table for table in answer['tables'] if _category(table, category)],
            'not_covered': answer['not_covered'], 'approval': 'not_granted',
            'limitations': ['目录项和已核验摘录不表示标准全文覆盖；缺项不使用近似值。']}

    def table(self, category: Category, table_id: str):
        plugin, release = self._plugin()
        catalog = self._query(plugin, release, {'operation': 'catalog', 'compact': True})['answer']
        table = next((item for item in catalog['tables']
                      if item['id'] == table_id and _category(item, category)), None)
        if table is None:
            raise HTTPException(404, {'code': 'RESOURCE_TABLE_NOT_FOUND', 'message': '此分类中没有该依据表。'})
        receipt = self._query(plugin, release, {'operation': 'list', 'standard': table['standard'],
            'edition': table['edition'], 'locator': table['table'] or table['clause'],
            'table_id': table['id'], 'expected_data_sha256': catalog['data_sha256']})
        rows = []
        for record in receipt['answer']['records']:
            trust = _trust(record)
            rows.append({**record, 'trust': trust, 'selectable': trust['grade'] == 'reference',
                         'method_version': receipt['method']['method_version']})
        return {key: value for key, value in receipt.items() if key != 'answer'} | {
            'category': category, 'table': table, 'rows': rows,
            'data_sha256': catalog['data_sha256'], 'approval': 'not_granted'}

    def select(self, body: Selection):
        plugin, release = self._plugin()
        if body.release_digest != release:
            raise HTTPException(409, {'code': 'RESOURCE_RELEASE_CHANGED', 'message': '依据版本已变化，请重新查看后选择。'})
        query = body.model_dump(exclude={'release_digest', 'data_sha256'})
        receipt = self._query(plugin, release, {'operation': 'resolve', **query,
                                              'expected_data_sha256': body.data_sha256})
        answer = receipt['answer']
        if answer['status'] != 'resolved' or len(answer['records']) != 1:
            raise HTTPException(422, {'code': 'RESOURCE_VALUE_UNAVAILABLE', 'message': '该条件没有唯一可采用数值；请补充来源，不能默认取值。'})
        record = deepcopy(answer['records'][0])
        trust = _trust(record)
        if trust['grade'] != 'reference':
            raise HTTPException(422, {'code': 'RESOURCE_VALUE_UNAVAILABLE', 'message': trust['reason']})
        quantity = _si_quantity(record)
        return {key: value for key, value in receipt.items() if key != 'answer'} | {
            'record': record, 'trust': trust, 'conditions': body.conditions,
            'quantity': quantity.model_dump(mode='json') if quantity is not None else None,
            'quantity_status': 'available' if quantity is not None else 'unsupported',
            'quantity_reason': '' if quantity is not None else '原文物理量或单位尚无明确的 SI 资源契约，不能猜测换算。',
            'data_sha256': answer['data_sha256'], 'approval': 'not_granted',
            'applied_to_workspace': False}

    def evidence(self, selection: Selection, parameter: str, expected_dimension: str) -> ReferenceEvidence:
        """Resolve the identity on the server; never accept a client property value."""
        receipt = self.select(selection)
        record = receipt['record']
        quantity = _si_quantity(record)
        if quantity is not None and quantity.dimension != expected_dimension:
            raise HTTPException(422, {'code': 'RESOURCE_QUANTITY_MISMATCH',
                'message': '依据的物理量与目标字段不同，不能替代或推算。'})
        if quantity is None:
            raise HTTPException(422, {'code': 'RESOURCE_UNIT_UNSUPPORTED',
                'message': '原文单位没有明确的 SI 换算契约，不能猜测。'})
        return ReferenceEvidence(parameter=parameter, quantity=quantity,
            selection=selection.model_dump(mode='json'), receipt=receipt,
            record_sha256=record['record_sha256'])

    def verify_evidence(self, evidence: ReferenceEvidence) -> ReferenceEvidence:
        """Verify a frozen reference for new use, without rewriting its receipt."""
        evidence = ReferenceEvidence.model_validate(evidence)
        current = self.evidence(Selection.model_validate(evidence.selection),
                                evidence.parameter, evidence.quantity.dimension)
        if (current.record_sha256 != evidence.record_sha256 or current.quantity != evidence.quantity
                or {k: v for k, v in current.receipt.items() if k != 'request_sha256'}
                    != {k: v for k, v in evidence.receipt.items() if k != 'request_sha256'}):
            raise HTTPException(409, {'code': 'RESOURCE_REFERENCE_CHANGED',
                'message': '固定资料与封签依据不一致，停止采用；请核对原记录。'})
        return evidence


def make_router(executor, assets=None, research=None, types=None):
    service = ResourceData(executor)
    router = APIRouter(prefix='/api/library/resources', tags=['Material and environment references'])

    @router.get('/catalogue')
    def catalogue(category: Category = 'materials'):
        return service.catalogue(category)

    @router.get('/table')
    def table(category: Category, table_id: str = Query(min_length=1, max_length=180)):
        return service.table(category, table_id)

    @router.post('/select')
    def select(body: Selection):
        return service.select(body)

    if assets is not None and research is not None and types is not None:
        from .material_references import make_router as material_router
        from .environment_references import make_router as environment_router
        router.include_router(material_router(service, assets, types))
        router.include_router(environment_router(service, assets, research))

    return router
