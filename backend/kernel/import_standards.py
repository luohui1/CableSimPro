"""Pin a user's declared standard editions before confirming a table import.

The sealed catalogue identifies the edition, and a sealed list receipt proves
its original source digest. This is an edition selection, never approval of a
limit, an imported dimension, or a cable product.
"""
from copy import deepcopy
import json
import re

from fastapi import HTTPException

from backend.plugin_host import PluginHostError
from . import factory_tables as tables


PLUGIN = 'cablesim.standards-basis'
ARTIFACT = 'x-cablesim.standards-basis'


def _identity(value):
    return re.sub(r'\s+', '', value).replace('—', '-').replace('–', '-').replace(':', '-')


def preview_selection(research, declared):
    selection = {'schema': 'cablesim.import-standard-selection/1', 'items': [], 'missing': []}
    names = list(dict.fromkeys(name.strip() for name in declared if name.strip()))
    if not names:
        return selection
    plugin = research.registry().plugins.get(PLUGIN)
    if plugin is None:
        selection['missing'] = [{'declared': name, 'reason': '未安装标准依据库；保留原声明，不绑定执行标准来源。'} for name in names]
        return selection
    capability = next(cap for cap in plugin.manifest.capabilities if cap.id == 'lookup')
    method = {'plugin_id': PLUGIN, 'plugin_version': plugin.manifest.version,
              'method_version': capability.method_version, 'release_digest': research.pin(plugin)['release_digest']}

    def run(queries):
        result = research.executor.run(PLUGIN, 'lookup', [
            {'case_id': key, 'input': value, 'parameters': {}} for key, value in queries.items()],
            expected_manifest=plugin.manifest)
        answers = {}
        for case in result.cases:
            if case.status != 'succeeded':
                failure = case.error or {}
                tables.fail('IMPORT_STANDARDS_UNAVAILABLE', failure.get('message', '执行标准来源查询失败，请重新预览。'), 503)
            answer = case.artifacts[ARTIFACT]
            answers[case.case_id] = (answer, {'query': queries[case.case_id],
                'data_sha256': answer['data_sha256'], 'query_sha256': answer['query_sha256'],
                'request_sha256': result.request_sha256, 'artifact_digest': case.artifact_digests[ARTIFACT]})
        if set(answers) != set(queries):
            tables.fail('IMPORT_STANDARDS_UNAVAILABLE', '执行标准来源查询没有返回全部声明，已拒绝隐式选版。', 503)
        return answers

    catalogue, catalogue_evidence = run({'catalog': {
        'schema_version': 'cablesim.standards-query/1', 'operation': 'catalog', 'compact': True}})['catalog']
    queries, chosen = {}, {}
    for index, name in enumerate(names):
        matches = [table for table in catalogue['tables']
                   if _identity(table['standard'] + '-' + table['edition']) == _identity(name)]
        if not matches:
            selection['missing'].append({'declared': name, 'reason': '封签目录未收录这个准确年号；不代用其他版本。'})
            continue
        # Selecting a source identity needs one original, verified record. The
        # smallest table gives a complete list receipt without loading unrelated
        # limits; no numeric criterion is selected or copied into the cable.
        table = min(matches, key=lambda item: (item['record_count'], item['id']))
        key = 'edition-' + str(index)
        queries[key] = {'schema_version': 'cablesim.standards-query/1', 'operation': 'list',
                        'standard': table['standard'], 'edition': table['edition'],
                        'locator': table['table'] or table['clause'], 'table_id': table['id'],
                        'expected_data_sha256': catalogue['data_sha256']}
        chosen[key] = (name, table)
    for key, (answer, evidence) in (run(queries).items() if queries else []):
        name, table = chosen[key]
        records = [record for record in answer.get('records', [])
                   if record.get('verification', {}).get('status') == 'verified'
                   and re.fullmatch(r'[a-f0-9]{64}', record.get('source_sha256', ''))]
        digests = {record['source_sha256'] for record in records}
        if len(digests) != 1:
            selection['missing'].append({'declared': name,
                'reason': '准确版本的原件来源未能唯一核实；保留声明，须补原件来源后才能绑定。'})
            continue
        record = records[0]
        selection['items'].append({'declared': name, 'standard': table['standard'] + '—' + table['edition'],
            'edition': table['edition'], 'source_digest': record['source_sha256'], 'method': method,
            'evidence': {**evidence, 'catalogue': catalogue_evidence, 'record_id': record['id'],
                         'record_sha256': record['record_sha256'], 'source_file': record['source_file'],
                         'printed_page': record['printed_page'], 'pdf_page': record['pdf_page']}})
    return selection


def confirmed_source(selection):
    """Called only after the ordinary human-confirmed preview digest gate."""
    if not selection.get('items'):
        return None
    declaration = {'schema': 'cablesim.execution-standards/1',
        'items': [{'standard': item['standard'], 'source_digest': item['source_digest']}
                  for item in selection['items']],
        'selection': deepcopy(selection),
        'scope': '人工确认结构表预览中的执行标准版本与原件摘要；不批准导入数值、要求或工程型号。'}
    return {'kind': 'standard', 'reviewed': True,
            'reference': json.dumps(declaration, ensure_ascii=False, sort_keys=True)}


def verify_selection(research, selection):
    """Confirm the displayed releases, refusing upgrades or live seal drift.

    Never resolve the declarations again here: that could select a different
    table after the operator reviewed the preview. A changed installation needs
    a new preview and a new human confirmation.
    """
    if selection is None:
        tables.fail('IMPORT_STANDARDS_CHANGED', '预览未保存执行标准发行，请重新预览并核对来源。', 409)
    verified = set()
    for item in selection.get('items', []):
        method = item['method']
        identity = (method['plugin_id'], method['plugin_version'], method['release_digest'], method['method_version'])
        if identity in verified:
            continue
        pin = {'plugin_id': method['plugin_id'], 'version': method['plugin_version'],
               'release_digest': method['release_digest'], 'capability': 'lookup'}
        try:
            _, capability = research.resolve(pin)
            if capability.method_version != method['method_version']:
                tables.fail('IMPORT_STANDARDS_CHANGED', '标准查询方法版本已变化，请重新预览并核对来源。', 409)
        except (HTTPException, PluginHostError, ValueError, OSError):
            tables.fail('IMPORT_STANDARDS_CHANGED', '预览中的执行标准发行或封签已变化，请重新预览并人工核对；未写入型号。', 409)
        verified.add(identity)
