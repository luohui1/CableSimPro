"""Build a separate engineering demonstration DB through host APIs; never copy test runs.

Inputs: public manufacturer records plus the existing, explicitly sourced engineering
completion. Only IEC standard algebra is executed here; native fields await HPC.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import time
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def ensure_temperature(client, result):
    if any('温度场' in row['title'] and row.get('study') for row in result['studies']): return
    def api(path, method='GET', body=None):
        response = client.request(method, path, json=body)
        if response.status_code >= 400: raise RuntimeError(response.text)
        return response.json()
    contracts = api('/api/input-contracts')
    contract = next((item for item in contracts if item['method']['capability'] == 'electrothermal-steady'), None)
    if not contract: return
    base = next(row for row in result['studies'] if '三回排管询价' in row['title'])
    workspace = api('/api/workspaces/' + base['workspace'])
    params = {key:value['default'] for key,value in contract['parameter_schema'].get('properties',{}).items() if 'default' in value}
    title = '城北变电站 · 排管段电热温度场'
    configuration = {'title':title,'task':'operating','method':contract['method'],'input_source':'domain','parameters':params,'driver':{'kind':'single'}}
    saved = api('/api/workspaces/' + workspace['id'] + '/studies','POST',{**configuration,'modules':{'thermal-field':deepcopy(configuration)},'expected_revision':workspace['revision']})
    result['studies'] = [row for row in result['studies'] if not ('温度场' in row['title'] and not row.get('study'))]
    result['studies'].append({'title':title,'workspace':workspace['id'],'study':saved['id'],'module':'thermal-field','status':'已保存输入；待补方法参数与超算预检','ready':False})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='http://127.0.0.1:8040')
    parser.add_argument('--database', type=Path, default=ROOT / '.data/engineering-demo/engineering.sqlite')
    args = parser.parse_args()
    database = args.database.resolve()
    if database.parent not in ((ROOT / '.data/engineering-demo').resolve(), (ROOT / '.tmp/engineering-demo').resolve()):
        raise SystemExit('只允许独立演示目录；不能向开发或测试来源库写入。')
    marker = database.with_suffix('.seed.json')
    if database.exists():
        if marker.exists() and json.loads(marker.read_text(encoding='utf-8')).get('complete'):
            result = json.loads(marker.read_text(encoding='utf-8'))
            from fastapi.testclient import TestClient
            from backend.main import create_app
            with TestClient(create_app(database)) as client: ensure_temperature(client, result)
            marker.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
            print('演示库已生成，保留原有运行：' + str(database)); return
        raise SystemExit('目标已存在且未完成，保留现场；请使用独立的新目标文件。')
    database.parent.mkdir(parents=True, exist_ok=True)
    os.environ['CABLESIM_DATASETS_DIR'] = str(database.parent / 'datasets')
    def source(path):
        with urlopen(args.source + path, timeout=30) as response:
            return json.load(response)
    donor = None
    for workspace in source('/api/workspaces'):
        for study in source('/api/workspaces/' + workspace['id'] + '/studies'):
            if study['definition']['driver']['kind'] == 'selection' and study['definition'].get('candidate_completions'):
                donor = study
                break
        if donor: break
    if not donor: raise SystemExit('缺少带来源的三芯工程补参数；不会用测试夹具代替。')
    donor_candidates = {item['id']: item for item in source('/api/domain-cable-models')}
    # Check the installed source seal before creating any DB or draft artifacts.
    from backend.plugin_host.registry import Registry
    Registry(plugin_id='cablesim.iec60287').get('cablesim.iec60287').verify()
    from fastapi.testclient import TestClient
    from backend.main import create_app
    app = create_app(database)
    result = {'database': str(database), 'complete': False, 'types': [], 'studies': [], 'native_core_hours': 0}
    with TestClient(app) as client:
        def api(path, method='GET', body=None):
            response = client.request(method, path, json=body)
            if response.status_code >= 400:
                raise RuntimeError(f'{method} {path}: {response.status_code} {response.text}')
            return response.json()
        methods = api('/api/methods')
        iec = next(item['method'] for item in methods if item['method']['plugin_id'] == 'cablesim.iec60287')
        rating_pin = {**iec, 'capability': 'steady-rating'}
        mapping, completions = {}, {}
        for identity, completion in donor['definition']['candidate_completions'].items():
            if identity not in donor_candidates: raise RuntimeError('候选来源不存在')
            imported = api('/api/domain-cable-models', 'POST', donor_candidates[identity]['payload'])
            mapping[identity] = imported['id']
            completions[imported['id']] = {**deepcopy(completion), 'method': {**iec, 'capability': 'model-completion'}}
        candidate = next(item for item in api('/api/domain-cable-models') if item['payload']['name'] == 'YJV22-8.7/15 kV 3×300')
        prepared, error = app.state.research.complete_candidate(candidate, completions[candidate['id']])
        if error: raise RuntimeError(error)
        payload = deepcopy(prepared['payload'])
        payload['name'] = 'YJV22-8.7/15 3×300'
        payload['cable_type']['label'] = payload['name']
        payload['confirmed'] = False
        model = api('/api/domain-cable-models', 'POST', payload)

        def create_workspace(item, name, *, type_draft=False, **extra):
            endpoint = '/api/design/type-workspaces' if type_draft else '/api/design/study-workspaces'
            workspace = api(endpoint, 'POST', {'model_id': 'candidate:' + item['id'], 'content_sha256': item['digest'], **extra})
            document = deepcopy(workspace['domain'])
            document['name'] = name
            api('/api/workspaces/' + workspace['id'] + '/domain', 'PUT', {'expected_revision': workspace['revision'], 'document': document})
            return api('/api/workspaces/' + workspace['id'])
        type300 = create_workspace(model, 'YJV22-8.7/15 3×300', type_draft=True)
        result['types'].append({'name': type300['domain']['name'], 'workspace': type300['id'], 'status': '未批准工程参数草稿'})

        records = json.loads((ROOT / '.data/customer-selection/series-records.json').read_text(encoding='utf-8'))
        record800 = next(item['payload'] for item in records if item['payload']['name'] == 'YJLW03-64/110 kV 1×800')
        imported800 = api('/api/domain-cable-models', 'POST', record800)
        facts = record800['specification']['values']
        def fact(name): return facts[name]['value']
        # Missing layers/material properties remain absent, never inherited from a system model.
        material_ids = [('cu','铜','conductor','copper_bare'), ('xlpe','交联聚乙烯','insulation','XLPE'), ('al','皱纹铝护套','metal','aluminium'), ('pe','聚乙烯外护套','polymer','other')]
        partial = {'name':'YJLW03-64/110 1×800', 'version':'公开尺寸待补齐', 'confirmed':False,
            'materials':[{'id':'material/'+key,'label':label,'category':category,'standard_kind':kind} for key,label,category,kind in material_ids],
            'cable_type':{'id':'cable_type/ct1','label':'YJLW03-64/110 1×800','construction':'single_core',
                'rating':{'u0':64000,'u':110000,'max_conductor_temperature':{}},
                'cores':[{'id':'core/1','conductor':{'material':'material/cu','form':'unspecified','nominal_area':.0008,'diameter':fact('conductor_diameter'),'r20':None},'layers':[]}],
                'common_layers':[{'role':role,'material':'material/'+material,'thickness':fact(key),'form':form} for role,material,key,form in [('insulation','xlpe','insulation_thickness',None),('metallic_sheath','al','metallic_sheath_thickness','corrugated'),('oversheath','pe','oversheath_thickness',None)]]},
            'sources':{'/cable_type':{'kind':'manufacturer','reference':record800['sources']['factory']['reference']+'；尺寸草稿，未建半导电屏蔽、缓冲层与波纹；R20为标准上限，未当作设计电阻。','reviewed':False}}}
        partial_model = api('/api/domain-cable-models','POST',partial)
        type800 = create_workspace(partial_model, partial['name'], type_draft=True)
        result['types'].append({'name':partial['name'],'workspace':type800['id'],'status':'厂家尺寸草稿，缺项拒算','source_candidate':imported800['id']})
        inquiry = create_workspace(model, '城北变电站 · 10 kV 三回排管', three_core_layout='three_core_ducts_horizontal', target_current_a=400)
        hv = create_workspace(partial_model, '城南线路 · 110 kV 直埋单回', target_current_a=600)
        parameters = deepcopy(donor['definition']['parameters'])
        parameters.pop('target_current_a', None)
        parameters.pop('target_circuit_id', None)
        parameters['operation'] = 'both'
        def study(workspace, title, driver, *, method=None, params=None, module=None, run=True, **extra):
            configuration = {'title':title,'task':'rating','method':method or rating_pin,'input_source':'domain','parameters':params if params is not None else parameters,'driver':driver, **extra}
            definition = {**configuration, **({'modules':{module:deepcopy(configuration)}} if module else {})}
            saved = api('/api/workspaces/' + workspace['id'] + '/studies','POST',{**definition,'expected_revision':workspace['revision']})
            prefix = '/api/workspaces/' + workspace['id'] + '/studies/' + saved['id']
            check = api(prefix + f'/preflight?expected_revision={workspace["revision"]}&expected_study_revision={saved["revision"]}' + ('&module='+module if module else ''))
            item = {'title':title,'workspace':workspace['id'],'study':saved['id'],'module':module,'ready':check['ready']}
            if run and check['ready']:
                if configuration['method']['plugin_id'] != 'cablesim.iec60287': raise RuntimeError('本脚本只执行IEC标准代数，不在本机调用原生求解器')
                body = {'expected_revision':workspace['revision'],'expected_study_revision':saved['revision'],'request_id':str(uuid4()),'lock_digest':check['lock_digest'],'scope_acknowledged':True}
                if module: body['module'] = module
                execution = api(prefix + '/runs','POST',body)
                for _ in range(120):
                    if execution['status'] not in ('accepted','running','validating'):break
                    time.sleep(.25); execution = api(prefix+'/runs/'+execution['id'])
                item.update(run=execution['id'],status=execution['status'])
                if execution['status'] not in ('succeeded','partial'):raise RuntimeError(json.dumps(execution.get('error'),ensure_ascii=False))
            else:
                item.update(status='待超算运行' if not run and check['ready'] else '缺项待补', preflight=check)
            result['studies'].append(item)
            print(title+'：'+item['status'],flush=True)
            marker.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
            return saved
        driver = deepcopy(donor['definition']['driver'])
        driver['candidate_ids'] = [mapping[value] for value in driver['candidate_ids']]
        study(inquiry,'城北变电站 · 10 kV 三回排管询价',driver,candidate_completions=completions)
        study(hv,'城南线路 · 110 kV 直埋单回校核',{'kind':'single'},run=False)
        soil_index = next(i for i,m in enumerate(inquiry['domain']['materials']) if m['id'] == inquiry['domain']['sections'][0]['medium']['material'])
        field = f'/input/materials/{soil_index}/thermal_resistivity'
        meta = {'path':field,'minimum':'0.6','maximum':'1.0','step':'0.2','source':'演示敏感性范围；非现场土壤实测值'}
        study(inquiry,'排管段 · 土壤热阻率敏感性',{'kind':'sweep','samples':[{'label':str(v)+' K*m/W','changes':{field:v}} for v in (.6,.8,1.)]},module='sweep',input_sources={'/driver/samples':{'kind':'user','reference':'扫描设置：'+json.dumps(meta,ensure_ascii=False),'reviewed':False}})
        # Same IEC method, two explicitly recorded T4 forms; no second solver is implied.
        comparison = {**parameters,'t4_form':'approximate'}
        study(inquiry,'排管段 · 外部热阻精确式与近似式对比',{'kind':'crosscheck'},module='method-compare',crosschecks=[{'method':rating_pin,'parameters':comparison}])
        ensure_temperature(client, result)
        result['complete'] = True
        marker.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:value for key,value in result.items() if key!='studies'},ensure_ascii=False,indent=2))


if __name__ == '__main__': main()
