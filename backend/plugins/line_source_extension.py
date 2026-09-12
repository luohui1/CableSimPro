"""Install the additive line-source command into the existing first-party host.

The UI command has no arbitrary file/job selector in v0.1. The host binds the
newest successful fixed-power buried job for the same project revision and exact
current plugin release. That deterministic source is sealed into the job context
and the result; absence of such a source fails before a new job is registered.
"""
from __future__ import annotations

import json
from . import service
from .catalog import PluginError
from .line_source_contract import validate_line_source

COMMAND = 'validation.line-source-buried'
SOURCE_COMMAND = 'skfem.buried-reference'
SOURCE_PLUGIN = 'cablesim.buried-reference'
_INSTALLED = False


def install_line_source_extension() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True
    service.OUTPUTS[COMMAND] = {'line-source.json'}
    original_register = service.PluginService._register
    original_worker = service.PluginService._worker

    def register(self, wid, request, args):
        source = source_context = item = None
        if request.command == COMMAND:
            expected = self._pin(self.catalog.get(SOURCE_PLUGIN)).model_dump(mode='json')
            with self.store.db() as db:
                self.store.load(db, wid, request.expected_revision)
                rows = db.execute(
                    "SELECT rowid,* FROM plugin_jobs WHERE workspace=? AND command=? AND status='succeeded' ORDER BY rowid DESC",
                    (wid, SOURCE_COMMAND))
                for candidate in rows:
                    candidate_context = json.loads(candidate['context'])
                    if (candidate_context.get('project_revision') != request.expected_revision or
                        candidate_context.get('plugin') != expected):
                        continue
                    output = json.loads(candidate['output'])
                    artifact = next((a for a in output.get('artifacts', ()) if a.get('path') == 'thermal.json'), None)
                    if artifact is None:
                        continue
                    # Integrity is checked now and again when copied to the worker.
                    self._artifact_path(wid, candidate['id'], artifact)
                    source, source_context, item = candidate, candidate_context, artifact
                    break
            if source is None:
                raise PluginError('SOURCE_JOB', '请先在当前工程版本成功运行一次三相定功率直埋热研究。', 409)
        context, saved = original_register(self, wid, request, args)
        if context is None or request.command != COMMAND:
            return context, saved
        if source_context.get('source_sha256') != context['source_sha256']:
            # This should be impossible after matching the monotonic project revision,
            # but fail closed rather than consuming a mismatched snapshot.
            raise PluginError('STALE_SOURCE', '最新直埋工件与当前工程快照不一致。', 409)
        metadata = {'job_id': source['id'], 'plugin': source_context['plugin'],
                    'command': source['command'], 'arguments': source_context['arguments'],
                    'source_sha256': source_context['source_sha256'],
                    'project_revision': source_context['project_revision']}
        context['arguments'] = {**context['arguments'], '_source_context': metadata}
        context['source_artifact'] = dict(item, job_id=source['id'])
        with self.store.db(True) as db:
            db.execute('UPDATE plugin_jobs SET context=? WHERE workspace=? AND id=?',
                       (json.dumps(context, ensure_ascii=False, allow_nan=False), wid, str(request.request_id)))
        return context, saved

    def worker(self, wid, tid, context):
        result = original_worker(self, wid, tid, context)
        if context['command'] != COMMAND:
            return result
        try:
            report = validate_line_source(json.loads((self.directory/wid/tid/'line-source.json').read_text('utf-8')))
            source = context['arguments']['_source_context']
            if (report.source_job_id != source['job_id'] or
                report.source_release_sha256 != source['plugin']['release_sha256'] or
                report.source_project_revision != source['project_revision'] or
                result.get('summary') != report.model_dump(mode='json')):
                raise ValueError('LINE_SOURCE_SOURCE_BINDING')
        except (ValueError, KeyError, TypeError, OSError, json.JSONDecodeError):
            raise PluginError('FIELD_CONTRACT', '线源解析对照与来源任务、工程或计算摘要不一致。') from None
        return result

    service.PluginService._register = register
    service.PluginService._worker = worker
