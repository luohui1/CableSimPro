"""Release catalogue inputs through the same upload/preview/commit HTTP path.

This module has no independent type store and never promotes the imported drafts
to an approved release. Saved public facts, missing data and per-row failures are
the same ones an engineer sees when importing these sample workbooks.
"""
from copy import deepcopy
from uuid import uuid4

from backend.kernel.public_catalogues import _data


def import_public_catalogues(client):
    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f'{method} {path}: {response.status_code} {response.text}')
        return response

    manifest = request('GET', '/api/type-library/samples').json()
    result = []
    for sample in manifest:
        original = request('GET', '/api/type-library/samples/' + sample['filename']).content
        uploaded = request('POST', '/api/type-library/imports/upload', files={
            'file': (sample['filename'], original, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()
        if uploaded['sha256'] != sample['sha256'] or not uploaded.get('declarations'):
            raise RuntimeError('发布结构表摘要不一致或原始声明丢失：' + sample['id'])
        data = _data(sample['id'])
        counts = {table['id']: len(table['rows']) for table in data['tables']} if 'tables' in data else {'single-core': len(data['rows'])}
        for declaration in uploaded['declarations']:
            preview = request('POST', '/api/type-library/imports/preview', json={
                'upload_id': uploaded['upload_id'], **{key: declaration[key] for key in
                    ('sheet', 'first_data_row', 'mapping', 'series')}}).json()
            if preview['error_count'] or len(preview['rows']) != counts[declaration['table']]:
                raise RuntimeError('发布结构表不能遗漏任何规格：' + sample['id'] + ' / ' + declaration['sheet']
                                   + '；错误行数=' + str(preview['error_count']))
            committed = request('POST', '/api/type-library/imports/commit',
                                headers={'X-CableSim-Actor': 'human'}, json={
                                    'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
                                    'request_id': str(uuid4()), 'human_confirmed': True, 'skip_errors': False}).json()
            if len(committed['specs']) != counts[declaration['table']]:
                raise RuntimeError('发布结构表入库规格数量变化：' + declaration['sheet'])
            result.append({'sample_id': sample['id'], 'sheet': declaration['sheet'], 'table': declaration['table'],
                           'source': sample['source'], 'workbook_sha256': uploaded['sha256'],
                           'preview_digest': preview['preview_digest'], 'series_id': committed['series_id'],
                           'execution_standards': preview['execution_standards'],
                           'specs': committed['specs'], 'incomplete_count': preview['incomplete_count'],
                           'state': 'draft', 'human_reviewed': False})
    return result


def calculate_factory_series(client, catalogues):
    """A full published MV family with saved ordinary runs, never only one size."""
    from backend.kernel.scenarios import METHOD_DEFAULTS
    selected = next(item for item in catalogues
                    if item['sample_id'] == 'people-mv' and item['table'] == 'three-core')
    detail = client.get('/api/type-library/series/' + selected['series_id'])
    if detail.status_code != 200:
        raise RuntimeError('发布系列未能读取：' + detail.text)
    specs = detail.json()['specs']
    source = ('人民电器 8.7/10(15) kV 样本表8：土温25℃、土壤热阻率1.0 K·m/W、导体90℃；'
              '50 Hz来自使用特性；样本未给埋深和屏蔽接地，研究示例明确取0.7 m、两端接地。'
              '结构屏蔽及材料参数按系列声明，非厂家完整制造图。')
    parameters = deepcopy(METHOD_DEFAULTS['cablesim.iec60287'])
    parameters['solver']['max_iterations'] = 300
    parameters['source'] = ('IEC 60287 对照方法：ks=kp=1，T4 exact，涡流项 ignored；'
                            '铜带纵向电阻按系列声明模型，非任意补值。数值收敛阈值1e-8 A、最多300次。')
    result, generation = {}, {}
    for spec in specs:
        response = client.post('/api/types/' + spec['workspace_id'] + '/specification/generate', json={
            'request_id': str(uuid4()), 'expected_revision': spec['workspace_revision'],
            'scope_acknowledged': True, 'audience': 'internal'})
        if response.status_code >= 400:
            raise RuntimeError('发布系列规格书生成请求失败：' + response.text)
        attempt = response.json()
        if attempt.get('status') not in ('generated', 'blocked'):
            raise RuntimeError('发布系列规格书缺少可解释的生成状态：' + str(attempt))
        generation[spec['id']] = attempt
    # A generation attempt may create its own standards study. Run the requested
    # library checks afterwards so their saved evidence remains current.
    for operation in ('check', 'calculate'):
        body = {'request_id': str(uuid4()), 'operation': operation,
                'spec_ids': [item['id'] for item in specs],
                'expected_versions': {item['id']: item['version'] for item in specs},
                'expected_revisions': {item['id']: item['workspace_revision'] for item in specs},
                'human_confirmed': True, 'scope_acknowledged': True,
                'parameters': parameters,
                'rows': [{'case_id': 'catalogue-ground', 'name': '公开样本条件 · 声明埋深及接地',
                          'layout': 'three_core_buried_single', 'depth_m': .7,
                          'soil_rho_k_m_w': 1.0, 'ambient_temperature_c': 25.0, 'frequency_hz': 50.0,
                          'bonding': 'both_ends', 'rating_basis': 'simultaneous', 'source': source}]}
        response = client.post('/api/type-library/series/' + selected['series_id'] + '/batch',
                               headers={'X-CableSim-Actor': 'human'}, json=body)
        if response.status_code >= 400:
            raise RuntimeError('发布系列批量操作失败：' + response.text)
        batch = response.json()
        if len(batch['items']) != len(specs) or batch['status'] != 'succeeded':
            raise RuntimeError('发布系列没有完成全部规格的真实方法运行：' + str(batch))
        result[operation] = batch
    documents = []
    for spec in specs:
        endpoint = '/api/types/' + spec['workspace_id'] + '/specification?audience=internal&view=detail'
        response = client.get(endpoint)
        if response.status_code >= 400:
            raise RuntimeError('发布系列规格书草稿无法打开：' + response.text)
        snapshot = response.json()
        if snapshot['payload']['workspace_id'] != spec['workspace_id'] or snapshot['lifecycle']['approval'] is not None:
            raise RuntimeError('发布系列规格书身份或审核状态异常：' + spec['name'])
        documents.append({'spec_id': spec['id'], 'workspace_id': spec['workspace_id'], 'name': spec['name'],
                          'endpoint': endpoint, 'digest': snapshot['digest'], 'ready': snapshot['ready'],
                          'generation': generation[spec['id']],
                          'snapshot': {key: snapshot[key] for key in ('payload', 'digest', 'lifecycle', 'audience')},
                          'blockers': [{key: check[key] for key in ('id', 'channel', 'message')}
                                       for check in snapshot['payload']['checks'] if check['blocking']]})
    generation_runs = [{**source, 'workspace_id': document['workspace_id']}
                       for document in documents for source in document['snapshot']['payload']['sources']
                       if source['channel'] not in ('standards', 'rating')]
    return {'series_id': selected['series_id'], 'specifications': len(specs),
            'specification_drafts': documents, 'generation_runs': generation_runs, **result}
