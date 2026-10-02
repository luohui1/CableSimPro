"""Explicit line-source source binding and output validation for the first-party host.

The UI command has no arbitrary file/job selector in v0.1. The host binds the
newest successful fixed-power buried job for the same project revision and exact
current plugin release. That deterministic source is sealed into the job context
and the result; absence of such a source fails before a new job is registered.
"""
from __future__ import annotations

import json
from .catalog import PluginError
from .line_source_contract import validate_line_source

COMMAND = 'validation.line-source-buried'
SOURCE_COMMAND = 'skfem.buried-reference'
SOURCE_PLUGIN = 'cablesim.buried-reference'


def bind_source(service, db, wid, context):
    """Bind before inserting the new job, in the same registration transaction."""
    expected = service._pin(service.catalog.get(SOURCE_PLUGIN)).model_dump(mode='json')
    had_successful_source = False
    rows = db.execute("SELECT * FROM plugin_jobs WHERE workspace=? AND command=? AND status='succeeded' ORDER BY rowid DESC",
                      (wid, SOURCE_COMMAND))
    for source in rows:
        had_successful_source = True
        saved = json.loads(source['context'])
        if saved.get('project_revision') != context['project_revision'] or saved.get('plugin') != expected:
            continue
        artifact = next((a for a in json.loads(source['output']).get('artifacts', ()) if a.get('path') == 'thermal.json'), None)
        if artifact is None:
            continue
        service._artifact_path(wid, source['id'], artifact)
        if saved.get('source_sha256') != context['source_sha256']:
            raise PluginError('STALE_SOURCE', '最新直埋工件与当前工程快照不一致。', 409)
        metadata = {'job_id': source['id'], 'plugin': saved['plugin'], 'command': source['command'],
                    'arguments': saved['arguments'], 'source_sha256': saved['source_sha256'],
                    'project_revision': saved['project_revision']}
        context['arguments'] = {**context['arguments'], '_source_context': metadata}
        context['source_artifact'] = dict(artifact, job_id=source['id'])
        return
    if had_successful_source:
        raise PluginError('STALE_SOURCE', '已有直埋热研究不属于当前工程版本或当前锁定发行版，请重新运行来源任务。', 409)
    raise PluginError('SOURCE_JOB', '请先在当前工程版本成功运行一次三相定功率直埋热研究。', 409)


def validate_output(directory, context, result):
    try:
        report = validate_line_source(json.loads((directory/'line-source.json').read_text('utf-8')))
        source = context['arguments']['_source_context']
        if (report.source_job_id != source['job_id'] or
            report.source_release_sha256 != source['plugin']['release_sha256'] or
            report.source_project_revision != source['project_revision'] or
            result.get('summary') != report.model_dump(mode='json')):
            raise ValueError('LINE_SOURCE_SOURCE_BINDING')
    except (ValueError, KeyError, TypeError, OSError):
        raise PluginError('FIELD_CONTRACT', '线源解析对照与来源任务、工程或计算摘要不一致。') from None
