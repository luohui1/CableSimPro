"""Human-reviewed Agent adapter for the host's formal preview/export service.

The same T4 service implements /api/formal-deliveries/preview and /export.
The Agent pins its preview before review, renders only after acceptance and
stores the resulting PDF once so a lost acknowledgement never re-exports it.
"""
from copy import deepcopy
from hashlib import sha256

from backend.kernel.formal_contracts import DocumentMetadata, ExportRequest, PreviewRequest, filename
from backend.kernel.formal_deliveries import FormalDeliveries
from backend.kernel.workspace import stamp


def document_schema():
    schema = DocumentMetadata.model_json_schema()
    # File bytes and signatures are not model inputs. The host's formal service
    # derives signatures exclusively from genuine saved approval records.
    schema['properties'].pop('logo_data_uri')
    schema['description'] = '用户明确提供的单位、文件编号和版次；缺少时先询问，不编造单位、编号、日期或签名。'
    return schema


class AgentFormalDeliveries:
    def __init__(self, actions):
        self.actions = actions
        self.store = actions.store
        self.service = FormalDeliveries(actions.research, actions.types)

    def prepare(self, task, kind, document, *, runs=None, specification_digest=None):
        request = PreviewRequest.model_validate({
            'kind': kind,
            'source': {'workspace_id': task['workspace_id'], 'expected_revision': task['workspace_revision'],
                       'runs': runs or [], 'specification_digest': specification_digest},
            'document': document,
        })
        preview = self.service.preview(request)
        return {'formal_request': request.model_dump(mode='json'),
                'formal_model_digest': preview['model_digest'], 'formal_preview': preview}

    @staticmethod
    def review(action, change, checks):
        preview = action['formal_preview']
        metadata = preview['metadata']
        change('文件格式', preview['title'] + ' PDF（含签栏与追溯页）')
        for key, label in (('organization', '单位名称'), ('number', '文件编号'), ('revision', '文件版次'),
                           ('header', '页眉'), ('footer', '页脚'), ('issued_on', '签发日期')):
            if metadata.get(key):
                change(label, metadata[key])
        change('保存状态', preview['state']['label'])
        checks.extend(['按正式文件预览固定全部来源与文件内容；接受时校验同一摘要，变化则拒绝导出。',
                       '保留设计、校核、审核、批准四个签栏；仅已有真实签核记录可填写，人工接受导出不生成签名。',
                       'PDF 附追溯页和完整来源快照；导出不创建研究、不求解、不批准或发布产品。'])

    @staticmethod
    def receipt(wid, pid, name, args, digest):
        preview = args['formal_preview']
        url = '/api/agent/files/' + pid
        specification = name == 'propose_type_specification'
        result = {'kind': 'specification' if specification else 'delivery', 'workspace_id': wid,
                  'title': preview['title'], 'href': url, 'download_url': url,
                  'media_type': 'application/pdf', 'digest': digest,
                  'source_digest': preview['source_digest'], 'model_digest': preview['model_digest'],
                  'document_kind': preview['kind'], 'document': deepcopy(preview['metadata']),
                  'source': deepcopy(preview['source_identity'])}
        if specification:
            result['audience'] = args['audience']
            result['source']['type_id'] = wid
        else:
            result.update(delivery_id=pid, run_ids=list(args['run_ids']))
            result['source'].update(study_id=args['source_study_id'], run_id=args['run_ids'][0])
        return result

    def recover(self, task, proposal, db):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_external_files'").fetchone():
            return None
        row = db.execute('SELECT * FROM agent_external_files WHERE proposal_id=? AND workspace=?',
                         (proposal['id'], task['workspace_id'])).fetchone()
        if row is None:
            return None
        from .external_actions import fail
        if row['media_type'] != 'application/pdf' or sha256(bytes(row['content'])).hexdigest() != row['sha256']:
            fail('FORMAL_FILE_INTEGRITY', '已接受文件完整性校验未通过；不会重复导出覆盖原记录。', status=409)
        return self.receipt(task['workspace_id'], proposal['id'], proposal['action'], proposal['arguments'], row['sha256'])

    def execute(self, task, proposal):
        from .external_actions import fail, initialize
        args = proposal['arguments']
        if 'formal_request' not in args:
            fail('FORMAL_PREVIEW_REQUIRED', '此待审卡尚未固定正式文件预览；请重新提出导出并提供单位、文件编号和版次。', status=409)
        request = ExportRequest.model_validate({**args['formal_request'], 'format': 'pdf',
                                               'expected_model_digest': args['formal_model_digest']})
        model, content = self.service.export(request)
        digest = sha256(content).hexdigest()
        initialize(self.store)
        with self.store.db(True) as db:
            self.store.load(db, task['workspace_id'], task['workspace_revision'], allow_domain=True)
            # Hold the writer lock while checking the latest approval state too;
            # a signing decision must not change between the final check and save.
            if self.service.preview(request)['model_digest'] != model['model_digest']:
                fail('FORMAL_SOURCE_CHANGED', '保存文件前来源或签核记录已变化，未保存文件，请重新提出导出。', status=409)
            db.execute('INSERT OR IGNORE INTO agent_external_files VALUES (?,?,?,?,?,?,?)',
                       (proposal['id'], task['workspace_id'], filename(model, 'pdf'), 'application/pdf',
                        digest, content, stamp()))
            receipt = self.recover(task, proposal, db)
            if receipt is None or receipt['digest'] != digest:
                fail('FORMAL_FILE_IDENTITY', '同一人工决定已关联其他文件，不会覆盖已保存文件。', status=409)
        return receipt
