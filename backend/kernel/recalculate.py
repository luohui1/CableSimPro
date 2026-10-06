"""Explicit current-version adoption, followed by the normal checked run path."""
from copy import deepcopy
import json

from fastapi import HTTPException
from .contracts import RunStudy, StudyDefinition
from .workspace import fingerprint, stamp
from .version_status import latest_model, model_reason, methods


def recalculate(research, wid, sid, body):
    identity = fingerprint({'action': 'recalculate', **body.model_dump(mode='json')})
    # The existing study operation journal also makes adoption restart-safe.
    # No solver runs inside this transaction. Failed preflight leaves an editable
    # new configuration and the original operation can be retried without rebinding.
    with research.store.db(True) as db:
        current = research.definition(db, wid, sid)
        prior = db.execute('SELECT digest,result FROM study_history_requests WHERE study=? AND request=?',
                           (sid, str(body.request_id))).fetchone()
        if prior:
            if prior['digest'] != identity:
                raise HTTPException(409, {'code': 'REQUEST_CONFLICT', 'message': '此请求标识已用于不同研究操作，请刷新或使用原请求重试。'})
            run_body = RunStudy.model_validate_json(prior['result'])
        else:
            row, state = research.store.load(db, wid, body.expected_revision, allow_domain=True)
            research.store.assert_mutable(db, wid)
            if current['revision'] != body.expected_study_revision:
                raise HTTPException(409, {'code': 'STUDY_REVISION_CONFLICT', 'message': '研究已更新，请刷新后重算。'})
            if db.execute('SELECT id FROM study_runs WHERE workspace=? AND request_id=?', (wid, str(body.request_id))).fetchone():
                raise HTTPException(409, {'code': 'REQUEST_CONFLICT', 'message': '请求标识已用于另一次运行。'})
            definition = deepcopy(current['definition'])
            config = research.module_definition(definition, body.module)
            from .method_adoption import adopt_configuration
            adopt_configuration(research,config)
            if config['input_source'] == 'domain':
                reference = state.get('study_cable_reference') or state.get('type_origin_reference')
                if reference:
                    model = latest_model(db, reference)
                    if model_reason(reference, model):
                        if not state.get('study_cable_reference'):
                            raise HTTPException(409, {'code': 'MODEL_REBASE_REQUIRED',
                                'message': '独立型号草稿的基准版本已更新；请先核对并合并型号变更，再重算，避免覆盖工程师编辑。'})
                        from .scenarios import attach_model
                        attach_model(state, model, preserve_layout=True)
                        research.store.commit(db, row, state, '重算前明确更新引用型号版本')
                        row, _ = research.store.load(db, wid)
            definition = StudyDefinition.model_validate(definition).model_dump(mode='json')
            revision = current['revision'] + 1
            db.execute('INSERT INTO study_versions VALUES (?,?,?,?)',
                       (sid, revision, json.dumps(definition, ensure_ascii=False), stamp()))
            db.execute('UPDATE studies SET revision=? WHERE id=?', (revision, sid))
            from .study_history import record
            record(db, sid, revision)
            research.store.audit(db, wid, row['revision'], '按当前版本重算', sid)
            lock = research.lock(db, wid, row['revision'], config['method'])
            run_body = RunStudy(request_id=body.request_id, expected_revision=row['revision'],
                                expected_study_revision=revision, module=body.module,
                                scope_acknowledged=True, lock_digest=lock['digest'])
            db.execute('INSERT INTO study_history_requests VALUES (?,?,?,?)',
                       (sid, str(body.request_id), identity, run_body.model_dump_json()))
    return research.execute(wid, sid, run_body, asynchronous=None)
