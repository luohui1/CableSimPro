"""Build a separate engineering demonstration DB through host APIs; never copy test runs.

Inputs: public manufacturer records plus the existing, explicitly sourced engineering
completion. Only IEC standard algebra is executed here; native fields await HPC.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

def supplement_hv(api, result):
    """Keep manufacturer identities separate; an unsupported sheath is never smoothed."""
    source_file = ROOT / '.data/customer-selection/sources/Qifan-ZC-YJLW03-800.html'
    source_hash = 'b5ffd2e5df25f0fa46446701f235b2e4113f4f4a3459577e4618cf244d490942'
    if not source_file.exists() or sha256(source_file.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError('起帆转载样本原件缺失或摘要变化，保留原演示型号。')
    reference = ('起帆ZC-YJLW03-Z 64/110kV 1×800产品技术规格书，表3–11；'
        'https://www.qifandl.com/products_detail/c-_detailId%3D1266420897496969216.html；'
        '下载2026-10-04；SHA256 '+source_hash+'；网站主体上海子奕实业，公开转载，非签章制造图。')
    quantities = {'conductor_diameter':(.034,'m'), 'conductor_screen_thickness':(.0011,'m'),
        'inner_semiconductive_tape_thickness':(.0002,'m'), 'insulation_thickness':(.016,'m'),
        'insulation_screen_thickness':(.001,'m'), 'buffer_tape_count':(3,'1'),
        'buffer_tape_thickness':(.002,'m'), 'metallic_sheath_thickness':(.002,'m'),
        'asphalt_coating_thickness':(.00025,'m'), 'oversheath_thickness':(.0045,'m'),
        'graphite_coating_thickness':(.00003,'m'), 'outer_diameter':(.1006,'m'), 'weight':(14.41,'kg/m')}
    public = {'name':'起帆 ZC-YJLW03-Z-64/110 1×800 · 公开结构参考', 'version':'公开样本待闭合', 'confirmed':False,
        'sources':{'factory':{'kind':'manufacturer','reference':reference+'导体紧压圆形，61/4.28或88/3.52；缓冲带3×2mm不是压缩后径向厚度。R20≤0.0221Ω/km为声明最大值，未当作设计电阻。','reviewed':False}},
        'specification':{'manufacturer':'起帆（公开转载样本）','designation':'ZC-YJLW03-Z','voltage_v':110000,'u0_v':64000,'cores':1,'area_m2':.0008,'conductor':'copper_bare',
            'values':{key:{'value':value,'unit':unit,'basis':'manufacturer','source':'factory'} for key,(value,unit) in quantities.items()},
            'missing':['缓冲层压缩后径向尺寸','波纹铝套波深和节距','完整材料热物性','IEC方法未覆盖皱纹铝护套']}}
    imported = api('/api/domain-cable-models','POST',public)
    # Preserve the People product already shown in the two-workspace demonstration.
    # Only this manufacturer's independently verified operating temperature
    # are added. The Qifan dimensions are kept in a separate source candidate.
    people = '人民电器64/110kV样本 https://www.chinapeople.com/pdf/sh/dxdl/64-110kV.pdf；SHA256 5f1e3af4c35d474ab69120bea4b66534b6cd3bed9860712205038239babbd3b3；'
    study_item = next(row for row in result['studies'] if '110 kV' in row['title'])
    type_item = next(row for row in result['types'] if 'YJLW03' in row['name'])
    for wid in (type_item['workspace'], study_item['workspace']):
        workspace = api('/api/workspaces/'+wid); document = deepcopy(workspace['domain'])
        cable = document['cable_types'][0]; conductor = cable['cores'][0]['conductor']
        if conductor.get('r20') is not None:
            raise RuntimeError('110 kV已有电阻输入，保留工程师修改；未用公开资料覆盖。')
        if cable['rating']['max_conductor_temperature'].get('normal') not in (None,363.15):
            raise RuntimeError('110 kV温限已由工程师修改，保留现值。')
        cable['rating']['max_conductor_temperature']['normal']=363.15
        def pointer(*parts): return '/'+ '/'.join(str(part).replace('~','~0').replace('/','~1') for part in parts)
        for tail in ('r20','r20_basis'):
            document.setdefault('provenance',{}).pop(pointer('cable_types',cable['id'],'cores',cable['cores'][0]['id'],'conductor',tail),None)
        document['provenance'][pointer('cable_types',cable['id'],'rating','max_conductor_temperature','normal')]={'kind':'manufacturer','reference':people+'PDF7/印刷069页长期温限90℃','reviewed':False}
        document['provenance']['/cable_types']={'kind':'manufacturer','reference':people+'结构仍缺半导电屏蔽和缓冲实际径向尺寸、波纹及物性；'+reference+'作为独立参考保存，未跨厂家拼接。','reviewed':False}
        if document != workspace['domain']:
            if wid == study_item['workspace']:
                used={conductor['material']}|{layer['material'] for layer in cable['common_layers']}|{layer['material'] for core in cable['cores'] for layer in core['layers']}
                materials=deepcopy([item for item in document['materials'] if item['id'] in used]); canonical=deepcopy(cable)
                material_map={item['id']:'material/hv-'+str(index) for index,item in enumerate(materials)}
                for item in materials:item['id']=material_map[item['id']]
                canonical['id']='cable_type/ct1'
                for index,core in enumerate(canonical['cores']):
                    core['id']='core/'+str(index+1);core['conductor']['material']=material_map[core['conductor']['material']]
                    for layer in core['layers']:layer['material']=material_map[layer['material']]
                for layer in canonical['common_layers']:layer['material']=material_map[layer['material']]
                version=api('/api/domain-cable-models','POST',{'name':'YJLW03-64/110 1×800','version':'厂家温限核对稿','confirmed':False,'cable_type':canonical,'materials':materials,'sources':{'factory':{'kind':'manufacturer','reference':people+'90℃为长期温限。PDF电阻表止于500mm²，800mm²电阻上限没有原文支持；R20保持缺项。结构、波纹和材料物性仍未覆盖。','reviewed':False}}})
                binding=workspace.get('study_cable_reference',{})
                if binding.get('id')!='candidate:'+version['id'] or binding.get('content_sha256')!=version['digest']:
                    api('/api/design/workspaces/'+wid+'/cable-reference','POST',{'expected_revision':workspace['revision'],'model_id':'candidate:'+version['id'],'content_sha256':version['digest']})
            else:
                api('/api/workspaces/'+wid+'/domain','PUT',{'expected_revision':workspace['revision'],'document':document})
    prefix='/api/workspaces/'+study_item['workspace']+'/studies/'+study_item['study']
    workspace=api('/api/workspaces/'+study_item['workspace'])
    study=next(row for row in api('/api/workspaces/'+study_item['workspace']+'/studies') if row['id']==study_item['study'])
    current=next(row['method'] for row in api('/api/methods') if row['method']['plugin_id']=='cablesim.iec60287')
    definition=deepcopy(study['definition']);definition['method'].update(current)
    try:
        if definition!=study['definition']:
            study=api(prefix,'PUT',{**definition,'expected_revision':workspace['revision'],'expected_study_revision':study['revision']})
        check=api(prefix+f'/preflight?expected_revision={workspace["revision"]}&expected_study_revision={study["revision"]}')
    except RuntimeError as error:
        # Preserve transport/seal failure as such, not as a fabricated case result.
        check={'ready':False,'request_error':str(error)}
    study_item.update(ready=check['ready'],preflight=check,public_structure_candidate=imported['id'],status='皱纹护套未覆盖；公开缺项保留')
    type_item['status']='厂家温限已补；结构、物性和电阻待闭合'
    result['hv_source']={'candidate':imported['id'],'sha256':source_hash,'reference':reference,'scope':'独立资料候选；未替换人民电器尺寸、未生成假载流量'}
    print('110 kV：已补厂家可确认值；完整结构/皱纹护套方法仍未覆盖',flush=True)


def supplement_mv(api, result):
    """Complete the saved teaching draft without changing public dimensions or measurements."""
    from backend.kernel.scenarios import system_models
    from backend.domain.guards import pointer
    model=next(m for m in system_models() if m['id']=='system.specification-yjv22-300')
    item=next(row for row in result['types'] if row['name']=='YJV22-8.7/15 3×300')
    wid=item['workspace'];workspace=api('/api/workspaces/'+wid);document=deepcopy(workspace['domain'])
    cable=document['cable_types'][0];example=model['payload']['cable_type']
    if cable['construction']!='three_core' or len(cable['cores'])!=3:
        raise RuntimeError('YJV22演示构造已变更，保留工程师输入；请从规格书演示版本新建。')
    source={'kind':'demo','reference':model['source'],'reviewed':False}
    def missing(target, reference, keys, location):
        for key in keys:
            if target.get(key) is None and reference.get(key) is not None:
                target[key]=deepcopy(reference[key]);document.setdefault('provenance',{})[location+pointer(key)]=source
    for core, sample in zip(cable['cores'],example['cores']):
        base=pointer('cable_types',cable['id'],'cores',core['id'])
        missing(core['conductor'],sample['conductor'],('lay_factor','conductor_class'),base+'/conductor')
        for layer in core['layers']:
            matched=next((row for row in sample['layers'] if row['role']==layer['role']),{})
            missing(layer,matched,('tape_width','tape_count','tape_application','nominal_tape_thickness'),base+pointer('layers',layer['role']))
    for layer in cable['common_layers']:
        matched=next((row for row in example['common_layers'] if row['role']==layer['role']),{})
        missing(layer,matched,('form','tape_application','tape_count','nominal_tape_thickness'),pointer('cable_types',cable['id'],'common_layers',layer['role']))
    missing(cable['rating']['max_conductor_temperature'],example['rating']['max_conductor_temperature'],('short_circuit',),pointer('cable_types',cable['id'],'rating','max_conductor_temperature'))
    for material in document['materials']:
        matched=next((row for row in model['payload']['materials'] if row['id']==material['id']),{})
        missing(material,matched,('density','standard_kind'),pointer('materials',material['id']))
    if document!=workspace['domain']:
        api('/api/workspaces/'+wid+'/domain','PUT',{'expected_revision':workspace['revision'],'document':document})
        workspace=api('/api/workspaces/'+wid)
    methods=api('/api/methods');studies=api('/api/workspaces/'+wid+'/studies')
    channels={'electrical':('cablesim.type-electrical','electrical'),
              'short_circuit':('cablesim.type-electrical','short-circuit'),
              'rating':('cablesim.iec60287','steady-rating')}
    declared=model['payload']['specification_conditions']
    for channel,(plugin,capability) in channels.items():
        if any(s['definition']['method']['plugin_id']==plugin and s['definition']['method']['capability']==capability for s in studies):
            continue
        method=next(m for m in methods if m['method']['plugin_id']==plugin)
        if not any(c['id']==capability for c in method['capabilities']):raise RuntimeError('缺少已安装方法 '+capability)
        pin={**method['method'],'capability':capability}
        if channel=='rating':
            definition=api('/api/design/workspaces/'+wid+'/rating-table-definition','POST',{'expected_revision':workspace['revision'],**declared[channel]})
        else:
            definition={'title':'电气参数' if channel=='electrical' else '短路容量','input_source':'domain','method':pin,
                'parameters':{**declared[channel],'cable_type_id':cable['id']},'input_sources':{'/parameters':source}}
        api('/api/workspaces/'+wid+'/studies','POST',{'expected_revision':workspace['revision'],**definition})
    item.update(status='公开尺寸与明示教学参数已补齐；待人工核对批准',specification_model=model['id'])
    print('YJV22 3×300：已保存用料参数和规格书计算条件；实测与批准记录保持原状',flush=True)


def refresh_saved_demo(base, result):
    """Explicitly select the installed IEC release; preserve every previous run."""
    if urlsplit(base).hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('演示刷新只接受本机服务。')
    def api(path, method='GET', body=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        with urlopen(Request(base+path, data=data, method=method, headers={'Content-Type':'application/json'}), timeout=180) as response:
            return json.load(response)
    installed = next(row['method'] for row in api('/api/methods') if row['method']['plugin_id']=='cablesim.iec60287')
    def update_pins(value):
        if isinstance(value, dict):
            if value.get('plugin_id')=='cablesim.iec60287' and 'capability' in value:
                value.update(installed)
            else:
                for child in value.values(): update_pins(child)
        elif isinstance(value, list):
            for child in value: update_pins(child)
    for item in result['studies']:
        if not item.get('run'): continue
        prefix = '/api/workspaces/'+item['workspace']+'/studies/'+item['study']
        study = next(row for row in api('/api/workspaces/'+item['workspace']+'/studies') if row['id']==item['study'])
        if study['definition']['title'] != item['title']:
            raise SystemExit('演示研究身份已变化，保留现状。')
        if study['definition']['method']['plugin_id']!='cablesim.iec60287':
            continue
        existing = api(prefix+'/runs')['items']
        module = item.get('module')
        if any(row['freshness']=='current' and row['integrity']=='verified' and row['status'] in ('succeeded','partial')
               and row.get('version_status',{}).get('status')=='current'
               and row['snapshot'].get('module')==module
               and row['snapshot']['definition']['method']['version']==installed['version']
               and row['snapshot']['definition']['method']['release_digest']==installed['release_digest'] for row in existing):
            continue
        workspace = api('/api/workspaces/'+item['workspace'])
        definition = deepcopy(study['definition']); update_pins(definition)
        if definition != study['definition']:
            study = api(prefix,'PUT',{**definition,'expected_revision':workspace['revision'],'expected_study_revision':study['revision']})
        module = item.get('module')
        check = api(prefix+f'/preflight?expected_revision={workspace["revision"]}&expected_study_revision={study["revision"]}'+('&module='+module if module else ''))
        if not check['ready']: raise RuntimeError('当前发行预检拒绝：'+json.dumps(check['cases'],ensure_ascii=False))
        body={'expected_revision':workspace['revision'],'expected_study_revision':study['revision'],'request_id':str(uuid4()),'scope_acknowledged':True,'lock_digest':check['lock_digest']}
        if module:body['module']=module
        run=api(prefix+'/runs','POST',body)
        for _ in range(120):
            if run['status'] not in ('accepted','running','validating'):break
            time.sleep(.25);run=api(prefix+'/runs/'+run['id'])
        if run['status'] not in ('succeeded','partial') or run['integrity']!='verified' or run['freshness']!='current':
            raise RuntimeError('刷新未产生当前有效结果：'+json.dumps(run.get('error'),ensure_ascii=False))
        item.update(run=run['id'],status=run['status'],study_revision=study['revision'])
        print(item['title']+'：已保存当前发行结果',flush=True)


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


def release_hv_model():
    """Sourced Qifan reference design; never a factory ampacity declaration."""
    from backend.kernel.model_series import hv_payload
    return hv_payload()


def import_release_reproductions(folder, expected_snapshot):
    """Import repository-bundled saved evidence, never development/test libraries."""
    from backend.foundation.reproduction_library import bundled_evidence, ReproductionLibrary
    from backend.kernel.database_ops import atomic_json
    value, raw, snapshot_id = bundled_evidence()
    if snapshot_id != expected_snapshot:
        raise RuntimeError('生成期间随附验证证据已更新；停止导入，请重新启动。')
    folder = Path(folder)
    snapshots = folder/'snapshots'; snapshots.mkdir(parents=True, exist_ok=True)
    destination = snapshots/(snapshot_id+'.json')
    if destination.exists():
        if destination.read_bytes() != raw:
            raise RuntimeError('发布验证证据已损坏；保留现场，停止导入。')
    else:
        from tempfile import NamedTemporaryFile
        temporary = None
        try:
            with NamedTemporaryFile(dir=snapshots, suffix='.part', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(destination)
        finally:
            if temporary is not None:temporary.unlink(missing_ok=True)
    index = folder/'index.json'
    existing = ReproductionLibrary(folder).snapshot() if index.exists() else None
    history = existing['history'] if existing else []
    history = [{'id':snapshot_id,'created_at':value['created_at']}] + [row for row in history if row['id'] != snapshot_id]
    atomic_json(index, {'current':snapshot_id,'history':history})
    return {'snapshot_id':snapshot_id,'targets':len(value['items']),'kind':'saved_evidence'}


def release_identity():
    """Pin installed releases and the bundled model/input versions, not local edits."""
    from backend.plugin_host.registry import Registry
    from backend.kernel.research import Research
    from backend.kernel.scenarios import system_models
    from backend.kernel.model_series import bundled_series, bundled_hv
    from backend.kernel.workspace import fingerprint
    from frontend.scripts.engineering_resources import identity as resource_identity
    from backend.foundation.reproduction_library import bundled_evidence
    registry = Registry()
    for plugin in registry.plugins.values():
        plugin.verify()
    series, digest = bundled_series()
    hv,hv_digest = bundled_hv()
    return {'seed_revision':4, 'engineering_resources':resource_identity(), 'reproduction_snapshot':bundled_evidence()[2],
            'plugins':{key:Research.pin(plugin) for key,plugin in sorted(registry.plugins.items())},
            'models':{item['id']:{'version':item['version'],'sha256':item['content_sha256']} for item in system_models()},
            'manufacturer_series':{'id':series['id'],'version':series['version'],'sha256':digest},
            'hv_model':{'id':hv['id'],'version':hv['version'],'sha256':hv_digest,
                        'model_sha256':fingerprint(release_hv_model())}}


def build_release_seed(staged, database, identity):
    """Create sourced engineering examples using current host APIs and real IEC runs."""
    from fastapi.testclient import TestClient
    from backend.main import create_app
    from backend.kernel.scenarios import METHOD_DEFAULTS
    environment = {'CABLESIM_DB':str(staged), 'CABLESIM_DATASETS_DIR':str(staged.parent/'datasets'),
                   'CABLESIM_REPRODUCTION_LIBRARY':str(database.parent/'library')}
    previous = {key:os.environ.get(key) for key in environment}
    result = {'database':str(database), 'complete':False, 'identity':identity,
              'types':[], 'studies':[], 'native_core_hours':0}
    os.environ.update(environment)
    try:
        with TestClient(create_app(staged)) as client:
            def api(path, method='GET', body=None):
                response = client.request(method, path, json=body)
                if response.status_code >= 400:
                    raise RuntimeError(f'{method} {path}: {response.status_code} {response.text}')
                return response.json()

            from frontend.scripts.engineering_resources import publish_resources, bind_demo_resources
            result['engineering_resources'] = publish_resources(api)
            method = next(row['method'] for row in api('/api/methods') if row['method']['plugin_id']=='cablesim.iec60287')
            method = {**method, 'capability':'steady-rating'}
            from backend.kernel.model_series import import_yjv22, bundled_hv, hv_study_document
            series = import_yjv22(api,method)
            candidates = [c['id'] for c in series['candidates']]
            result['series'] = {k:series[k] for k in ('id','version','sha256','engineering_scope')}
            result['source'] = '江苏华远公开YJV22结构尺寸、GB/T3956 R20标准上限；'+series['engineering_scope']
            base = next(c for c in series['candidates'] if round(c['payload']['specification']['area_m2']*1e6)==300)
            prepared, error = client.app.state.research.complete_candidate(base, series['candidate_completions'][base['id']])
            if error:
                raise RuntimeError('型号工程参数补录失败：'+str(error))
            payload = deepcopy(prepared['payload'])
            payload['name'] = payload['cable_type']['label'] = 'YJV22-8.7/15 3×300'
            payload['confirmed'] = False
            mv = api('/api/domain-cable-models','POST',payload)
            hv = api('/api/domain-cable-models','POST',release_hv_model())

            def create_workspace(model, name, *, type_draft=False, **extra):
                endpoint = '/api/design/type-workspaces' if type_draft else '/api/design/study-workspaces'
                created = api(endpoint,'POST',{'model_id':'candidate:'+model['id'],
                              'content_sha256':model['digest'],**extra})
                document = deepcopy(created['domain'])
                document['name'] = name
                api('/api/workspaces/'+created['id']+'/domain','PUT',{
                    'expected_revision':created['revision'],'document':document})
                return api('/api/workspaces/'+created['id'])

            for model, status in ((mv,'公开尺寸与有来源的工程参数草稿，未批准'),
                                  (hv,'公开结构与声明的工程参考参数，未批准')):
                draft = create_workspace(model,model['payload']['name'],type_draft=True)
                bindings = bind_demo_resources(api,draft['id'],'mv' if model is mv else 'hv')
                result['types'].append({'name':model['payload']['name'],'workspace':draft['id'],'status':status,
                    'resource_bindings': {'bound':sum(t['state']=='current' for t in bindings['targets']),
                                          'unbound':[{'name':t['name'],'reason':t['match_reason']} for t in bindings['targets'] if t['state']=='unbound']}})
            workspace = create_workspace(mv,'城北变电站 · 10 kV 三回排管',
                                         target_current_a=400,three_core_layout='three_core_ducts_horizontal')
            hv_workspace = create_workspace(hv,'城南线路 · 110 kV 直埋单回',target_current_a=600)
            hv_data,hv_digest = bundled_hv()
            api('/api/workspaces/'+hv_workspace['id']+'/domain','PUT',{
                'expected_revision':hv_workspace['revision'],'document':hv_study_document(hv_workspace)})
            hv_workspace=api('/api/workspaces/'+hv_workspace['id'])
            result['hv_series']={'id':hv_data['id'],'version':hv_data['version'],
                                 'sha256':hv_digest,'engineering_scope':hv_data['scope']}
            parameters = {**deepcopy(METHOD_DEFAULTS['cablesim.iec60287']), 'rating_mode':'both'}
            parameters['solver']['max_iterations'] = 300
            circuit = workspace['domain']['circuits'][0]['id']
            soil = next(i for i,m in enumerate(workspace['domain']['materials'])
                        if m['id'] == workspace['domain']['sections'][0]['medium']['material'])
            field = f'/input/materials/{soil}/thermal_resistivity'
            definitions = [
                ('城北变电站 · 10 kV 三回排管询价', 'selection',
                 {'kind':'selection','candidate_ids':candidates,'minimum':400,'allow_demo_candidates':False,
                  'target_entity':circuit,'target_entities':[c['id'] for c in workspace['domain']['circuits']],
                  'rating_basis':'simultaneous','target_condition':'rating-simultaneous'}),
                ('排管段 · 土壤热阻率扫描', 'sweep',
                 {'kind':'sweep','rating_basis':'simultaneous','target_entity':circuit,'target_condition':'rating-simultaneous',
                  'samples':[{'label':f'{v} K*m/W','changes':{field:v}} for v in (.6,.8,1.,1.2,1.4,1.6,1.8,2.)]}),
            ]
            def save_study(target, title, module, driver, *, required=True, **extra):
                prefix = '/api/workspaces/' + target['id'] + '/studies'
                config = {'title':title,'task':'rating','input_source':'domain','method':method,
                          'parameters':parameters,'driver':driver,
                          'candidate_completions':series['candidate_completions'] if module=='selection' else {},
                          'input_sources':{'/driver':{'kind':'user','reference':result['source']+'；工程场景为参考设计条件，非现场实测；具体敷设、负荷和来源保存在领域输入中。','reviewed':False}},**extra}
                study = api(prefix,'POST',{**config,'modules':{module:deepcopy(config)},'expected_revision':target['revision']})
                root = prefix + '/' + study['id']
                check = api(root + f'/preflight?expected_revision={target["revision"]}&expected_study_revision={study["revision"]}&module={module}')
                item = {'title':title,'workspace':target['id'],'study':study['id'],'module':module,'ready':check['ready']}
                if not check['ready']:
                    if required:
                        raise RuntimeError('发布演示预检未通过：'+json.dumps(check,ensure_ascii=False))
                    item.update(status='缺项待补；未生成结果',preflight=check)
                    result['studies'].append(item)
                    print(title+'：缺项待补，未生成结果',flush=True)
                    return
                run = api(root+'/runs','POST',{'expected_revision':target['revision'],
                    'expected_study_revision':study['revision'],'request_id':str(uuid4()),
                    'scope_acknowledged':True,'lock_digest':check['lock_digest'],'module':module})
                deadline = time.monotonic()+180
                while run['status'] in ('accepted','running','validating') and time.monotonic()<deadline:
                    time.sleep(.2)
                    run = api(root+'/runs/'+run['id'])
                if (run['status']!='succeeded' or run['integrity']!='verified'
                        or run['freshness']!='current' or run.get('version_status',{}).get('status')!='current'):
                    raise RuntimeError('发布演示计算未完成：'+json.dumps({
                        'status':run['status'],'integrity':run.get('integrity'),'error':run.get('error'),
                        'cases':[{k:case.get(k) for k in ('case_id','status','error')} for case in (run.get('output') or {}).get('cases',[])]},ensure_ascii=False))
                item.update(run=run['id'],status=run['status'])
                result['studies'].append(item)
                print(title+'：真实计算完成',flush=True)
            for title, module, driver in definitions:
                save_study(workspace,title,module,driver)
            save_study(hv_workspace,'城南线路 · 110 kV 直埋单回校核','rating',
                       {'kind':'single'},parameters=deepcopy(hv_data['parameters']),
                       input_sources={'/parameters':{'kind':'user','reviewed':False,
                           'reference':hv_data['scope']+'；'+hv_data['sources']['buffer_reference']['reference']+'；'+hv_data['sources']['geometry_reference']['reference']}})
            contracts = api('/api/input-contracts')
            contract = next(item for item in contracts if item['method']['capability']=='electrothermal-steady')
            title = '城北变电站 · 排管段温度场（需在超算运行）'
            configuration = {'title':title,'task':'operating','method':contract['method'],'input_source':'domain',
                             'parameters':{key:value['default'] for key,value in contract['parameter_schema'].get('properties',{}).items() if 'default' in value},
                             'driver':{'kind':'single'}}
            thermal = api('/api/workspaces/'+workspace['id']+'/studies','POST',{
                **configuration,'modules':{'thermal-field':deepcopy(configuration)},'expected_revision':workspace['revision']})
            result['studies'].append({'title':title,'workspace':workspace['id'],'study':thermal['id'],
                                      'module':'thermal-field','status':'需在超算运行；补齐参数并预检后提交','ready':False})
            # Later seed operations must not silently age an earlier result.
            for item in result['studies']:
                if item.get('run'):
                    run = api(f'/api/workspaces/{item["workspace"]}/studies/{item["study"]}/runs/{item["run"]}')
                    if run['freshness']!='current' or run['version_status']['status']!='current':
                        raise RuntimeError('发布种子出现过期结果：'+item['title'])
            result['reproduction_library'] = import_release_reproductions(database.parent/'library',identity['reproduction_snapshot'])
        return result
    finally:
        for key,value in previous.items():
            if value is None: os.environ.pop(key,None)
            else: os.environ[key] = value


def carry_model_settings(old, new):
    """模型连接设置是用户配置，不是演示数据：重建发布库时带到新库（密钥在系统凭据库，不在库里）。"""
    from contextlib import closing
    import sqlite3
    with closing(sqlite3.connect(f'file:{old}?mode=ro', uri=True)) as source:
        try:rows = source.execute('SELECT name,value,updated FROM agent_settings').fetchall()
        except sqlite3.OperationalError:return 0
    if rows:
        with closing(sqlite3.connect(new)) as target, target:
            target.execute('CREATE TABLE IF NOT EXISTS agent_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL)')
            target.executemany('INSERT INTO agent_settings(name,value,updated) VALUES (?,?,?) '
                               'ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated=excluded.updated', rows)
    return len(rows)


def seed_release(database):
    """Keep current data; rebuild changed releases only after a verified backup."""
    from contextlib import closing
    from datetime import datetime, timezone
    import sqlite3
    from tempfile import TemporaryDirectory
    from backend.kernel.database_ops import atomic_json, snapshot, validate
    from backend.kernel.ownership import OwnerLock
    database = Path(database).resolve()
    marker = database.with_suffix('.seed.json')
    owner = OwnerLock(database)
    owner.acquire()
    try:
        previous = None
        if database.exists():
            if not marker.exists() or not (previous := json.loads(marker.read_text(encoding='utf-8'))).get('complete'):
                raise SystemExit('发布库已存在但缺少完成标记；保留数据，请检查后再启动。')
            validate(database)
        identity = release_identity()
        if previous and previous.get('identity') == identity:
            print('发布插件与型号版本未变化，保留已有数据：'+str(database),flush=True)
            return
        print('发布插件、型号或演示输入版本已变化，准备重建。' if previous else '首次生成发布工程示例。',flush=True)
        with TemporaryDirectory(prefix='seed-',dir=database.parent) as scratch:
            staged = Path(scratch)/database.name
            result = build_release_seed(staged,database,identity)
            # 新库只挪主文件：先把 WAL 合并进主文件，否则最后几次写入（如最后一个运行）会留在 -wal 里丢失
            with closing(sqlite3.connect(staged,timeout=20)) as built:
                if built.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:
                    raise RuntimeError('新生成的发布库仍有未合并的写入，已停止替换。')
                if built.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
                    raise RuntimeError('新生成的发布库仍被占用，已停止替换。')
            validate(staged)
            if identity != release_identity():
                raise RuntimeError('生成期间插件或型号版本发生变化；保留旧库，请重新启动。')
            if previous:
                name = 'engineering-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid4().hex[:8]+'.sqlite'
                backup = database.parent/'backups'/name
                snapshot(database,backup)
                atomic_json(backup.with_suffix('.seed.json'),previous)
                # No host can acquire this library while OwnerLock is held.
                with closing(sqlite3.connect(database,timeout=20)) as old:
                    if old.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:
                        raise RuntimeError('旧库仍在使用，已保留备份且未替换。')
                    if old.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
                        raise RuntimeError('旧库尚未关闭，已保留备份且未替换。')
                result['previous_backup'] = str(backup)
                print('旧发布库已备份：'+str(backup),flush=True)
                if carry_model_settings(database, staged):
                    validate(staged)
                    print('已沿用 Agent 模型连接设置。',flush=True)
            staged.replace(database)
            result['complete'] = True
            atomic_json(marker,result)
        print('发布工程示例已就绪：'+str(database),flush=True)
    finally:
        owner.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='http://127.0.0.1:8040')
    parser.add_argument('--release', action='store_true', help='从随附工程输入创建发布库；版本变化时先备份再重建，不读取开发库')
    parser.add_argument('--database', type=Path, default=ROOT / '.data/engineering-demo/engineering.sqlite')
    parser.add_argument('--refresh', action='store_true', help='通过本机服务显式更新已过时的 IEC 发行并重算；旧运行保留')
    parser.add_argument('--supplement-hv', action='store_true', help='补入110kV公开原文事实并记录真实预检；不平滑皱纹护套、不猜缺项')
    parser.add_argument('--supplement-mv', action='store_true', help='补齐YJV22演示用料与规格书条件；只填缺项并标注教学假设')
    args = parser.parse_args()
    database = args.database.resolve()
    if args.release:
        if database.parent != (ROOT / '.data/release').resolve() or args.refresh or args.supplement_hv or args.supplement_mv:
            raise SystemExit('发布模式只允许 .data/release/ 下的独立库，不混用来源服务补录选项。')
        seed_release(database)
        return
    if database.parent not in ((ROOT / '.data/engineering-demo').resolve(), (ROOT / '.tmp/engineering-demo').resolve()):
        raise SystemExit('只允许独立演示目录；不能向开发或测试来源库写入。')
    marker = database.with_suffix('.seed.json')
    if database.exists():
        if marker.exists() and json.loads(marker.read_text(encoding='utf-8')).get('complete'):
            result = json.loads(marker.read_text(encoding='utf-8'))
            if args.supplement_hv or args.supplement_mv:
                if urlsplit(args.source).hostname not in ('127.0.0.1','localhost','::1'): raise SystemExit('仅补本机独立演示库')
                def api(path, method='GET', body=None):
                    data=None if body is None else json.dumps(body,ensure_ascii=False).encode('utf-8')
                    try:
                        with urlopen(Request(args.source+path,data=data,method=method,headers={'Content-Type':'application/json'}),timeout=180) as response:return json.load(response)
                    except HTTPError as error:
                        raise RuntimeError(f'{method} {path}: {error.code} '+error.read().decode('utf-8')) from None
                if args.supplement_hv: supplement_hv(api,result)
                if args.supplement_mv: supplement_mv(api,result)
            if args.refresh:
                refresh_saved_demo(args.source,result)
            elif not any('温度场' in row['title'] and row.get('study') for row in result['studies']):
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
        ensure_temperature(client, result)
        if args.supplement_hv: supplement_hv(api,result)
        if args.supplement_mv: supplement_mv(api,result)
        result['complete'] = True
        marker.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:value for key,value in result.items() if key!='studies'},ensure_ascii=False,indent=2))


if __name__ == '__main__': main()
