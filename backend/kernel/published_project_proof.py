"""Portable, unapproved input references to an exact published Types release.

The complete frozen specification is evidence, not a local publication or a
copied run. Export verifies the actual saved runs; transport preserves their
identities as external declarations without claiming to carry their outputs.
"""
from copy import deepcopy
import json
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError

from backend.domain.models import DomainDocument
from backend.foundation.contracts import AssetRelease, content_hash, frozen_application_dependencies
from .contracts import Method
from .project_exchange import detached_id, fail, projection
from .workspace import fingerprint


SCHEMA = 'cablesim.exchange-published-cable-source/1'
MAX_PROOF_BYTES = 8 * 1024 * 1024
RUN_EVIDENCE = 'external_declared_run'
BINDING_KEYS = {'id', 'version', 'name', 'state', 'source', 'content_sha256',
                'payload', 'method_defaults', 'locks', 'bound_cable_type_id'}
PROOF_KEYS = {'schema', 'kind', 'origin', 'asset_release', 'asset_sha256',
              'specification', 'specification_sha256', 'approval', 'dependencies',
              'source_runs', 'binding', 'run_evidence'}
SPECIFICATION_KEYS = {'schema', 'renderer', 'workspace_id', 'revision', 'name', 'purpose',
                      'base_reference', 'document', 'chapters', 'sources', 'results', 'checks',
                      'revisions', 'requirement_reviews', 'resource_bindings', 'release_exclusions'}


def size(value):
    return len(json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':'), allow_nan=False).encode('utf-8'))


def same(left, right):
    # Ordinary Python equality treats False as 0. Preserve exact JSON values.
    return fingerprint(left) == fingerprint(right)


def require(condition, message):
    if not condition:
        fail('EXCHANGE_PUBLISHED_MODEL_PROOF', message)


def run_pin(run):
    snapshot = run['snapshot']
    require(run.get('integrity') == 'verified' and run['status'] in ('succeeded', 'partial')
            and snapshot.get('workspace_id') == run['workspace']
            and snapshot.get('study_id') == run['study'],
            '发布来源运行没有完整且相符的保存身份。')
    return {'run_id': run['id'], 'workspace_id': run['workspace'], 'study_id': run['study'],
            'workspace_revision': snapshot['workspace_revision'],
            'study_revision': snapshot['study_revision'], 'method': snapshot['definition']['method'],
            'input_digest': run['input_digest'], 'output_digest': run['output_digest'],
            'status': run['status']}


def _asset(item):
    require(isinstance(item, dict) and set(item) == {
        'origin_id', 'origin_status', 'release', 'content_sha256'}, '发布来源的依赖记录字段不完整。')
    UUID(item['origin_id'])
    require(item['origin_status'] in ('draft', 'reviewed', 'published', 'deprecated'),
            '发布来源的依赖状态无效。')
    release = AssetRelease.model_validate(item['release'])
    require(not release.files and content_hash(release) == item['content_sha256'],
            '发布来源的依赖缺少可搬运正文，或其内容摘要不一致。')
    return release


def _validate(binding):
    require(set(binding) == BINDING_KEYS | {'source_snapshot'}, '发布型号绑定包含未定义字段。')
    proof = binding['source_snapshot']
    require(isinstance(proof, dict) and set(proof) == PROOF_KEYS
            and proof['schema'] == SCHEMA and proof['kind'] == 'published_type'
            and proof['run_evidence'] == RUN_EVIDENCE,
            '已发布型号需要完整的独立版本来源证明；不能继承本机审核或运行状态。')
    if size(proof) > MAX_PROOF_BYTES:
        raise HTTPException(413, {'code': 'EXCHANGE_PUBLISHED_PROOF_TOO_LARGE',
            'message': '完整发布来源证明超过 8 MiB；请使用数据库备份恢复，不能删减冻结证据。'})
    origin = proof['origin']
    require(isinstance(origin, dict) and set(origin) == {
        'asset', 'family', 'version', 'workspace', 'submission', 'sequence'},
        '发布来源缺少准确的发行、工作区和提交身份。')
    for field in ('asset', 'workspace', 'submission'):
        UUID(origin[field])
    require(type(origin['sequence']) is int and origin['sequence'] > 0
            and isinstance(origin['family'], str) and origin['family'].startswith('type/'),
            '发布来源的系列或发行序号无效。')
    release = AssetRelease.model_validate(proof['asset_release'])
    require(not release.files and release.kind == 'assembly'
            and release.asset_id == origin['family'] and release.version == origin['version']
            and content_hash(release) == proof['asset_sha256'],
            '发布资产的固定身份、正文或摘要不一致。')
    spec, receipt = proof['specification'], proof['approval']
    require(isinstance(spec, dict) and SPECIFICATION_KEYS <= set(spec)
            and spec.get('schema') == 'cablesim.type-specification/1'
            and fingerprint(spec) == proof['specification_sha256']
            and spec.get('workspace_id') == origin['workspace']
            and type(spec.get('revision')) is int and spec['revision'] > 0
            and spec.get('name') == release.name,
            '冻结规格书的原始内容摘要或来源身份不一致。')
    document = spec['document']
    DomainDocument.model_validate(document)
    require(len(document['cable_types']) == 1 and isinstance(spec['sources'], list)
            and spec['sources'] and isinstance(spec['checks'], list)
            and isinstance(spec['results'], dict)
            and isinstance(spec['chapters'], list) and spec['chapters']
            and all(isinstance(spec[key], list) for key in ('revisions', 'requirement_reviews', 'release_exclusions'))
            and all(isinstance(spec[key], dict) for key in ('base_reference', 'resource_bindings'))
            and spec['purpose'] in ('engineering', 'demo')
            and isinstance(spec['renderer'], str) and spec['renderer']
            and all(isinstance(c, dict) and c.get('blocking') is False for c in spec['checks']),
            '冻结规格书不是已完成发布门禁的单型号记录。')
    require(set(spec['results']) == {source['channel'] for source in spec['sources']}
            and len(spec['results']) == len(spec['sources']),
            '冻结规格书缺少完整来源通道或结果正文。')
    if 'source_design' in spec:
        require(same(spec['source_design'], {'id': origin['workspace'], 'revision': spec['revision']}),
                '冻结规格书的设计来源修订不一致。')
    require(isinstance(receipt, dict)
            and fingerprint({k: v for k, v in receipt.items() if k != 'receipt_digest'}) == receipt.get('receipt_digest')
            and receipt.get('decision') == 'approved'
            and receipt.get('authority') == 'local_manual_confirmation'
            and isinstance(receipt.get('reviewer'), str) and receipt['reviewer'].strip()
            and isinstance(receipt.get('approved_at'), str) and receipt['approved_at']
            and receipt.get('submission_id') == origin['submission']
            and receipt.get('specification_digest') == proof['specification_sha256']
            and same(receipt.get('workspace_revision'), spec['revision'])
            and same(receipt.get('sources'), spec['sources'])
            and same(receipt.get('release_exclusions', []), spec.get('release_exclusions', [])),
            '人工批准回执没有固定到同一提交、规格书、修订和发布范围。')
    UUID(receipt['id'])
    expected_source = '规格书 ' + origin['submission'] + ' sha256:' + proof['specification_sha256']
    require(any(s.kind == 'project_input' and s.reference == expected_source and s.reviewed
                for s in release.sources), '发布资产没有引用这份准确的冻结规格书。')

    pins = frozen_application_dependencies({'type_resource_bindings': spec.get('resource_bindings', {})})
    required = {(p.asset_id, p.version): p.content_sha256 for p in pins}
    declared = {(p.asset_id, p.version): p.content_sha256 for p in release.dependencies}
    require(required == declared, '发布资产依赖与冻结规格书的材料、标准固定版本不一致。')
    require(isinstance(proof['dependencies'], list) and len(proof['dependencies']) <= 100,
            '发布来源依赖数量超出范围。')
    resources = {}
    origin_ids = set()
    for item in proof['dependencies']:
        dependency = _asset(item)
        key = (dependency.asset_id, dependency.version)
        require(key not in resources and item['origin_id'] not in origin_ids
                and key != (release.asset_id, release.version), '发布来源依赖身份重复或引用自身。')
        resources[key] = (dependency, item['content_sha256'])
        origin_ids.add(item['origin_id'])
    visited, active = set(), set()
    def visit(ref):
        key = (ref.asset_id, ref.version)
        require(key in resources and resources[key][1] == ref.content_sha256,
                '完整发布来源缺少准确的依赖版本。')
        require(key not in active, '发布来源依赖形成循环。')
        if key in visited:
            return
        active.add(key)
        for child in resources[key][0].dependencies:
            visit(child)
        active.remove(key)
        visited.add(key)
    for ref in release.dependencies:
        visit(ref)
    require(visited == set(resources), '发布来源包含不属于本发行依赖闭包的资料。')

    original = proof['binding']
    require(isinstance(original, dict) and set(original) == BINDING_KEYS
            and original['id'] == origin['family'] and original['version'] == origin['version']
            and original['content_sha256'] == proof['asset_sha256']
            and original['source'] == 'published_type' and original['state'] == 'reviewed'
            and original['name'] == spec['name'], '原工程绑定与固定发布身份不一致。')
    expected = projection({'cable_type': document['cable_types'][0], 'materials': document['materials']})
    require(same(original['payload'], expected), '工程电缆和材料投影与冻结规格书不一致。')
    require(binding['id'] == detached_id(origin['family'], proof['asset_sha256'])
            and binding.get('state') == 'draft'
            and all(same(binding.get(k), original[k]) for k in BINDING_KEYS - {'id', 'state'}),
            '搬运型号须保持完整原绑定并使用独立草稿身份，不能绑定目标型号或继承批准。')

    require(isinstance(proof['source_runs'], list) and len(proof['source_runs']) <= 100,
            '发布来源运行身份不完整。')
    runs = {}
    run_fields = {'run_id', 'workspace_id', 'study_id', 'workspace_revision', 'study_revision',
                  'method', 'input_digest', 'output_digest', 'status'}
    for run in proof['source_runs']:
        require(isinstance(run, dict) and set(run) == run_fields, '发布来源运行字段不完整。')
        for key in ('run_id', 'workspace_id', 'study_id'):
            UUID(run[key])
        method = Method.model_validate(run['method'])
        require(all(getattr(method, field).strip() for field in ('plugin_id', 'capability', 'version'))
                and run['workspace_id'] == origin['workspace']
                and run['status'] in ('succeeded', 'partial')
                and all(type(run[k]) is int and run[k] > 0 for k in ('workspace_revision', 'study_revision'))
                and run['run_id'] not in runs, '发布来源运行身份、状态或方法无效。')
        for key in ('input_digest', 'output_digest'):
            require(isinstance(run[key], str) and len(run[key]) == 64
                    and all(c in '0123456789abcdef' for c in run[key]), '发布来源运行摘要无效。')
        runs[run['run_id']] = run
    require(set(runs) == {s['run_id'] for s in spec['sources']}, '发布来源运行有缺项或额外身份。')
    for source in spec['sources']:
        require(all(same(source[k], runs[source['run_id']][k]) for k in run_fields - {'workspace_id'}),
                '冻结规格书的来源运行、方法、修订或输入输出摘要不一致。')
    return proof


def validate(binding):
    try:
        return _validate(binding)
    except (KeyError, TypeError, ValueError, AttributeError, ValidationError, RecursionError):
        fail('EXCHANGE_PUBLISHED_MODEL_PROOF', '已发布型号来源证明字段、数值或身份无效；未采用任何替代值。')


def _dependencies(types, db, release):
    result, seen = [], set()
    def visit(ref):
        key = (ref.asset_id, ref.version)
        if key in seen:
            return
        require(len(seen) < 100, '发布来源依赖超过 100 个资料版本。')
        row = db.execute('SELECT * FROM engineering_assets WHERE asset_id=? AND version=?', key).fetchone()
        require(row is not None and row['content_sha256'] == ref.content_sha256,
                '来源库缺少发布型号固定的资源依赖，不能导出不完整证明。')
        detail = types.assets._detail(db, row)
        seen.add(key)
        value = AssetRelease.model_validate(detail['release'])
        for child in value.dependencies:
            visit(child)
        result.append({'origin_id': row['id'], 'origin_status': row['status'],
                       'release': detail['release'], 'content_sha256': row['content_sha256']})
    for ref in release.dependencies:
        visit(ref)
    return result


def prepare(types, db, binding):
    require(types is not None, '宿主没有可核验的发布来源读取器。')
    original = deepcopy(binding)
    # The existing binding contract treats an explicit null as no proof. It is
    # not part of the original published model identity carried by this proof.
    if original.get('source_snapshot') is None:
        original.pop('source_snapshot', None)
    row = db.execute('SELECT a.* FROM engineering_assets a JOIN engineering_type_releases t '
                     'ON t.asset=a.id WHERE t.family=? AND a.version=? AND a.content_sha256=?',
                     (binding['id'], binding['version'], binding['content_sha256'])).fetchone()
    require(row is not None and row['status'] in ('published', 'deprecated'),
            '来源库没有工程固定的已发布型号版本；未改用最新版本。')
    detail = types.assets._detail(db, row)
    published = db.execute('SELECT * FROM engineering_type_releases WHERE asset=?', (row['id'],)).fetchone()
    verified = types.published_specification(published['workspace'], connection=db)
    require(verified is not None and verified['record'] == dict(published), '发布记录在读取时不一致。')
    submission = db.execute('SELECT * FROM type_submissions WHERE id=?', (published['submission'],)).fetchone()
    require(submission is not None and submission['status'] == 'published'
            and submission['workspace'] == published['workspace'] and submission['asset'] == row['id']
            and submission['digest'] == published['digest']
            and same(json.loads(submission['payload']), verified['payload'])
            and same(types._receipt(submission['receipt']), verified['lifecycle']['approval']),
            '原发布记录与提交、批准或冻结规格书不一致。')
    runs = {run['id']: run_pin(run) for run in verified['runs']}
    proof = {'schema': SCHEMA, 'kind': 'published_type',
             'origin': {key: published[key] for key in ('asset', 'family', 'workspace', 'submission', 'sequence')},
             'asset_release': detail['release'], 'asset_sha256': row['content_sha256'],
             'specification': verified['payload'], 'specification_sha256': verified['digest'],
             'approval': verified['lifecycle']['approval'],
             'dependencies': _dependencies(types, db, AssetRelease.model_validate(detail['release'])),
             'source_runs': [runs[key] for key in sorted(runs)], 'binding': original, 'run_evidence': RUN_EVIDENCE}
    proof['origin']['version'] = row['version']
    binding.update(id=detached_id(published['family'], row['content_sha256']),
                   state='draft', source_snapshot=proof)
    validate(binding)
    return proof


def check_local(types, db, proof):
    """An existing conflicting local identity cannot be downgraded to external."""
    origin = proof['origin']
    row = db.execute('SELECT * FROM engineering_assets WHERE id=? OR (asset_id=? AND version=?)',
                     (origin['asset'], origin['family'], origin['version'])).fetchall()
    for asset in row:
        if (asset['asset_id'], asset['version'], asset['content_sha256']) != (
                origin['family'], origin['version'], proof['asset_sha256']):
            raise HTTPException(409, {'code': 'EXCHANGE_PUBLISHED_MODEL_CONFLICT',
                'message': '本库已有相同发布资产身份但内容不同；未按外部声明放行。'})
        types.assets._detail(db, asset)
        published = db.execute('SELECT * FROM engineering_type_releases WHERE asset=?', (asset['id'],)).fetchone()
        if published is not None and (any(published[key] != origin[key] for key in
                ('asset', 'family', 'workspace', 'submission', 'sequence'))
                or published['digest'] != proof['specification_sha256']
                or not same(json.loads(published['payload']), proof['specification'])
                or not same(types._receipt(published['receipt']), proof['approval'])):
            raise HTTPException(409, {'code': 'EXCHANGE_PUBLISHED_MODEL_CONFLICT',
                'message': '本库发行与外部冻结规格书或批准回执冲突。'})
    for saved in proof['source_runs']:
        row = db.execute('SELECT * FROM study_runs WHERE id=?', (saved['run_id'],)).fetchone()
        if row is None:
            continue
        if (row['workspace'], row['study']) != (saved['workspace_id'], saved['study_id']):
            raise HTTPException(409, {'code': 'EXCHANGE_PUBLISHED_RUN_CONFLICT',
                'message': '本库相同来源运行 ID 属于其他工程或研究，不能按外部声明放行。'})
        try:
            actual = types.research.get_run(row['workspace'], row['id'])
            intact = same(run_pin(actual), saved)
        except HTTPException:
            intact = False
        if not intact:
            raise HTTPException(409, {'code': 'EXCHANGE_PUBLISHED_RUN_CONFLICT',
                'message': '本库来源运行与冻结发布证明不一致。'})
