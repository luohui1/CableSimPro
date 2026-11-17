"""Fail-fast release gate: fresh release seed, three workflows, host HTTP APIs only.

Uses the same seed_release function invoked by run_demo.py --release, with an
explicit temporary database. Never supplements it from a donor/development DB.
TestClient exercises the real ASGI routes and normal plugin executor, not mocks.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import csv
from hashlib import sha256
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
import time
from functools import wraps
from threading import local
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
AREAS = (35, 50, 70, 95, 120, 150, 185, 240, 300, 400)
WORKFLOWS = ('inquiry', 'sweep', 'type')


@contextmanager
def observe_runtime(events, label):
    """Timings only: call the original methods, retain results/errors/executors."""
    from backend.kernel.research import Research
    from backend.plugin_host.executor import Executor
    from backend.plugin_host import registry
    stack=local()
    def timed(original, name):
        @wraps(original)
        def call(*args, **kwargs):
            frames=getattr(stack,'frames',[]);stack.frames=frames
            frame={'children':0.};frames.append(frame)
            context=label();started=time.perf_counter();result=None
            try:
                result=original(*args,**kwargs)
                return result
            finally:
                elapsed=time.perf_counter()-started;frames.pop()
                if frames:frames[-1]['children']+=elapsed
                event={'context':context,'stage':name,'elapsed_s':elapsed,
                       'self_s':max(0.,elapsed-frame['children'])}
                if name=='Executor.run':
                    event.update(plugin_id=args[1] if len(args)>1 else kwargs.get('plugin_id'),
                                 capability=args[2] if len(args)>2 else kwargs.get('capability_id'),
                                 case_count=len(args[3] if len(args)>3 else kwargs.get('cases',[])),phase=kwargs.get('phase','run'))
                    if result is not None:
                        event['host_profiling']=result.environment.get('host_profiling',{})
                        event['resident_profiling']=result.environment.get('resident_profiling',{})
                events.append(event)
        return call
    targets=[(Research,key) for key in ('preflight','prepare','complete_candidate','resolve','check_cases')]
    targets += [(Executor,'run'),(registry.Plugin,'verify'),(registry,'verify_host_dependencies')]
    with ExitStack() as scope:
        for owner,key in targets:
            name=(owner.__name__ if hasattr(owner,'__name__') else type(owner).__name__)+'.'+key
            scope.enter_context(patch.object(owner,key,timed(getattr(owner,key),name)))
        yield


class GateFailure(RuntimeError):
    def __init__(self, code, message, owner='研究线程', **details):
        super().__init__(message)
        self.detail = {'code': code, 'message': message, 'owner': owner, **details}


def require(condition, code, message, owner='研究线程', **details):
    if not condition:
        raise GateFailure(code, message, owner, **details)


def identity(item):
    p = item['payload']; s = p.get('specification')
    if s:
        return s['designation'], s['u0_v'], s['cores'], round(s['area_m2']*1e6)
    t = p.get('cable_type', {}); cores = t.get('cores', [])
    label = p.get('name', t.get('label', '')).strip()
    return ('YJV22' if re.match(r'^YJV22(?:-|\s)', label) else '',
            t.get('rating', {}).get('u0'), len(cores),
            round(cores[0]['conductor']['nominal_area']*1e6) if cores else None)


def real_candidates(catalogue):
    # The bundled series consists of original manufacturer specification records.
    # A completed 3x300 workspace model is a derived draft, not an eleventh row
    # of that series and must not replace a missing original specification.
    selected = [c for c in catalogue if isinstance(c['payload'].get('specification'), dict)
                and identity(c)[:3] == ('YJV22', 8700, 3)]
    areas = sorted({identity(c)[3] for c in selected})
    require(set(AREAS) <= set(areas), 'RELEASE_CANDIDATES_MISSING',
            '发布种子未提供完整 YJV22-8.7/15 kV 三芯35–400 mm²系列，停止真实询价验收。',
            '前端线程（发布种子）；研究线程配合真实候选数据与工程参数',
            expected_areas_mm2=list(AREAS), actual_areas_mm2=areas,
            missing_areas_mm2=sorted(set(AREAS)-set(areas)),
            catalogue=[{'id':c['id'],'name':c['payload']['name'],'state':c['state']} for c in catalogue])
    require(all(any(s.get('kind')=='manufacturer' and s.get('reference')
                    for s in c['payload'].get('sources', {}).values()) for c in selected),
            'RELEASE_MANUFACTURER_SOURCE_MISSING', '真实候选缺厂家来源；不能把教学型号当成客户选型数据。',
            '前端线程（发布种子）；研究线程（型号来源）')
    return sorted(selected, key=lambda c:(identity(c)[3], c['id']))


@contextmanager
def isolated_environment(directory):
    paths = {'CABLESIM_DB':directory/'engineering.sqlite', 'CABLESIM_DATASETS_DIR':directory/'datasets',
             'CABLESIM_REPRODUCTION_LIBRARY':directory/'library', 'CABLESIM_FRONTEND_DIST':directory/'frontend'}
    previous = {key:os.environ.get(key) for key in paths}
    os.environ.update({key:str(value) for key,value in paths.items()})
    try:
        yield paths
    finally:
        for key,value in previous.items():
            if value is None: os.environ.pop(key, None)
            else: os.environ[key] = value


class Gate:
    def __init__(self, output, timeout=900, profile=False, performance=False):
        self.output, self.timeout = output, timeout
        self.profile=profile
        self.performance=performance
        self.active_api=None
        self.client = None
        self.phase = 'seed'
        self.result = {'status':'running', 'transport':'FastAPI TestClient / real ASGI routes; no browser',
                       'steps':[], 'workflows':{name:{'status':'not_run'} for name in WORKFLOWS},
                       'artifacts':[], 'database_removed':False}

    @contextmanager
    def step(self, name, interface, owner='研究线程'):
        row = {'workflow':self.phase, 'step':name, 'interface':interface, 'status':'running'}
        self.result['steps'].append(row); started=time.perf_counter()
        try:
            yield row
            row['status']='passed'
        except GateFailure as exc:
            row.update(status='failed', failure=exc.detail)
            raise
        except Exception as exc:
            error=GateFailure('UNEXPECTED_ERROR',str(exc),owner,exception=type(exc).__name__)
            row.update(status='failed',failure=error.detail)
            raise error from exc
        finally:
            row['elapsed_s']=round(time.perf_counter()-started,3)
            print(json.dumps(row,ensure_ascii=False),flush=True)

    def api(self, method, path, body=None, *, owner='研究线程', binary=False):
        with self.step(method+' '+path.split('?')[0], method+' '+path, owner) as row:
            self.active_api=method+' '+path.split('?')[0]
            try:
                response=self.client.request(method,path,json=body)
            finally:
                self.active_api=None
            row['http_status']=response.status_code
            require(response.is_success, 'HTTP_ERROR', response.text[:12000], owner,
                    method=method,path=path,http_status=response.status_code)
            if binary:
                row['bytes']=len(response.content)
                return response.content
            return response.json()

    def artifact(self, name, data):
        raw=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False,indent=2).encode('utf-8')
        (self.output/name).write_bytes(raw)
        self.result['artifacts'].append({'path':str(self.output/name),'sha256':sha256(raw).hexdigest(),'bytes':len(raw)})

    def run(self, workspace, definition):
        prefix=f'/api/workspaces/{workspace["id"]}/studies'
        study=self.api('POST',prefix,{**definition,'expected_revision':workspace['revision']})
        root=prefix+'/'+study['id']
        check=self.api('GET',root+f'/preflight?expected_revision={workspace["revision"]}&expected_study_revision={study["revision"]}')
        with self.step('预检可执行',root+'/preflight'):
            require(check['ready'], 'PREFLIGHT_BLOCKED', '没有可执行工况。', checks=check)
        body={'expected_revision':workspace['revision'],'expected_study_revision':study['revision'],
              'request_id':str(uuid4()),'scope_acknowledged':True,'lock_digest':check['lock_digest']}
        run=self.api('POST',root+'/runs',body)
        deadline=time.monotonic()+self.timeout
        while run['status'] in ('accepted','running','validating'):
            require(time.monotonic()<deadline,'RUN_TIMEOUT','运行未在门禁等待时间内完成；保留运行ID。',run_id=run['id'])
            time.sleep(.5)
            run=self.api('GET',root+'/runs/'+run['id'])
        with self.step('运行与来源完整性',root+'/runs/'+run['id']):
            require(run['status'] in ('succeeded','partial') and run['integrity']=='verified',
                    'RUN_FAILED','运行失败或工件完整性异常。',run_id=run['id'],error=run.get('error'))
            require(run['freshness']=='current' and run.get('version_status',{}).get('status')=='current',
                    'RUN_STALE','新运行不是当前输入/方法版本。',version_status=run.get('version_status'))
        self.artifact(self.phase+'-run.json',run)
        return run

    def pdf(self, name, raw, expected):
        import fitz
        with self.step('校验并保存 '+name,'PDF bytes from host delivery','3D线程（PDF）') as row:
            require(raw.startswith(b'%PDF-'),'INVALID_PDF','下载内容不是PDF。','3D线程（PDF）')
            with fitz.open(stream=raw,filetype='pdf') as document:
                text=''.join(''.join(page.get_text().split()) for page in document)
                require(all(''.join(value.split()) in text for value in expected),
                        'PDF_CONTENT_MISMATCH','PDF缺少本次结论或型号标识。','3D线程（PDF）',expected=expected)
                row['pages']=len(document)
            self.artifact(name,raw)

    def inquiry(self):
        self.phase='inquiry';self.result['workflows']['inquiry']['status']='running'
        catalogue=self.api('GET','/api/domain-cable-models')
        with self.step('完整真实候选系列','GET /api/domain-cable-models','前端线程（发布种子）') as row:
            candidates=real_candidates(catalogue)
            row['candidate_count']=len(candidates);row['areas_mm2']=sorted({identity(c)[3] for c in candidates})
        # Engineering assumptions must already be saved with sources in the seed.
        workspaces=self.api('GET','/api/workspaces'); configurations=[]
        for w in workspaces:
            for s in self.api('GET',f'/api/workspaces/{w["id"]}/studies'):
                configurations.extend([s['definition'],*s['definition'].get('modules',{}).values()])
        template=next((d for d in configurations if d['driver']['kind']=='selection' and
                       set(c['id'] for c in candidates)<=set(d['driver']['candidate_ids'])),None)
        with self.step('有来源的选型条件','GET /api/workspaces/{wid}/studies'):
            require(template is not None,'RELEASE_INQUIRY_CONFIGURATION_MISSING',
                    '发布种子缺真实全系列选型配置及工程补全参数；不从开发库补齐。','前端线程（发布种子）；研究线程（参数契约）')
        chosen=next(c for c in candidates if identity(c)[3]==400)
        choice={'model_id':'candidate:'+chosen['id'],'content_sha256':chosen['digest'],
                'three_core_layout':'three_core_ducts_horizontal','target_current_a':400}
        completion=template.get('candidate_completions',{}).get(chosen['id'])
        if completion: choice['candidate_completion']=completion
        workspace=self.api('POST','/api/design/study-workspaces',choice)
        doc=workspace['domain'];circuits=[c['id'] for c in doc['circuits']]
        with self.step('10 kV三回一管一缆，400 A','POST /api/design/study-workspaces'):
            require(len(circuits)==3 and len(doc['sections'][0]['enclosures'])==3 and
                    all(doc['load_cases'][0]['currents'][cid]==400 for cid in circuits),
                    'INQUIRY_CONDITIONS_MISMATCH','敷设或负荷不符合本次问询。')
        definition=deepcopy(template);definition.pop('modules',None)
        definition.update(title='发布门禁：10 kV三回排管400 A',input_source='domain',method_input=None)
        definition['driver'].update(candidate_ids=[c['id'] for c in candidates],minimum=400,
            allow_demo_candidates=False,rating_basis='simultaneous',target_entity=circuits[0],target_entities=circuits,
            target_key='ampacity',target_unit='A',target_condition='rating-simultaneous')
        run=self.run(workspace,definition)
        with self.step('全候选与推荐','RunResponse.output.assessment') as row:
            assessments=run['output']['assessment'];frozen=run['snapshot']['candidate_snapshots']
            require(len(assessments)==len(candidates),'CANDIDATES_DROPPED','候选从结果中消失。')
            rows=[];qualified=[]
            for assessment,candidate in zip(assessments,frozen):
                area=identity(candidate)[3];value=assessment.get('value')
                require(assessment['status']!='failed','CANDIDATE_CALCULATION_FAILED','候选计算失败。',candidate=assessment)
                require(assessment['status']!='not_applicable' or bool(assessment.get('reason')),
                        'CANDIDATE_REASON_MISSING','不适用候选未说明原因。')
                if value is not None:
                    require(math.isfinite(value) and value>0 and assessment.get('rating_basis')=='simultaneous',
                            'RATING_BASIS_MISMATCH','允许电流或共同能力口径不正确。')
                summary={'name':candidate['payload']['name'],'area_mm2':area,'ampacity_a':value,
                         'status':assessment['status'],'margin_a':assessment.get('margin'),'reason':assessment.get('reason')}
                rows.append(summary)
                if assessment['status']=='satisfied' and candidate['state'] in ('reviewed','user_reviewed','engineering_input'):
                    qualified.append(summary)
            require(qualified,'NO_RECOMMENDATION','400 A下没有可推荐候选。',candidates=rows)
            recommendation=min(qualified,key=lambda r:(r['area_mm2'],r['margin_a'],r['name']))
            row.update(recommendation=recommendation,candidates=rows)
        delivery=self.api('POST',f'/api/workspaces/{workspace["id"]}/deliveries/current',{'run_ids':[run['id']],'request_id':str(uuid4())})
        with self.step('提取宿主生成的客户PDF','DeliveryResult.html data-report-pdf=customer','3D线程（研究PDF）'):
            match=re.search(r'data-report-pdf="customer"[^>]+href="data:application/pdf;base64,([^"]+)"',delivery['html'])
            require(match is not None,'CUSTOMER_PDF_MISSING','交付未提供客户PDF。','3D线程（研究PDF）')
            raw=base64.b64decode(match.group(1),validate=True)
        self.pdf('inquiry-customer.pdf',raw,['推荐',recommendation['name']])
        self.result['workflows']['inquiry'].update(status='passed',recommendation=recommendation,run_id=run['id'])
        return workspace,definition,run

    def sweep(self, workspace, definition, inquiry):
        self.phase='sweep';self.result['workflows']['sweep']['status']='running'
        # 3x300 input, including its original-source and engineering-parameter trace.
        index=next(i for i,c in enumerate(inquiry['snapshot']['candidate_snapshots']) if identity(c)[3]==300)
        source=inquiry['snapshot']['cases'][index];doc=deepcopy(source['input'])
        soil=next(i for i,m in enumerate(doc['materials']) if m['id']==doc['sections'][0]['medium']['material'])
        field=f'/input/materials/{soil}/thermal_resistivity';values=[n/10 for n in range(6,21,2)]
        config={'title':'发布门禁：土壤热阻率共同能力扫描','task':'rating','input_source':'study','method_input':doc,
                'method':definition['method'],'parameters':source['parameters'],
                'input_sources':{'/driver':{'kind':'user','reference':'发布验收指定土壤热阻率0.6–2.0 K·m/W，步长0.2；其余输入来自同库真实3×300候选。','reviewed':False}},
                'driver':{'kind':'sweep','target_key':'ampacity','target_unit':'A','target_entity':doc['circuits'][0]['id'],
                          'rating_basis':'simultaneous','target_condition':'rating-simultaneous',
                          'samples':[{'label':str(v)+' K·m/W','changes':{field:v}} for v in values]}}
        run=self.run(workspace,config);rows=[]
        with self.step('共同能力曲线与CSV','GET .../runs/{rid} → client-side CSV export') as step:
            for rho,case in zip(values,run['output']['cases']):
                quantity=next((r for r in case['results'] if r['key']=='ampacity' and r['entity']==doc['circuits'][0]['id'] and r.get('case')=='rating-simultaneous'),None)
                require(quantity and quantity.get('status')=='available' and quantity.get('rating_basis',{}).get('kind')=='common_balanced',
                        'SWEEP_VALUE_MISSING','扫描点缺少共同能力结果。',case=case['case_id'])
                rows.append([rho,'K*m/W',quantity['value'],'A','common_balanced',run['id'],run['input_digest'],run['output_digest'],
                             definition['method']['plugin_id'],definition['method']['version'],config['input_sources']['/driver']['reference']])
            require(len(rows)==len(values) and all(a[2]>b[2] for a,b in zip(rows,rows[1:])),
                    'SWEEP_NOT_MONOTONIC','共同能力扫描点缺失或不随土壤热阻率单调下降。')
            stream=io.StringIO(newline='');writer=csv.writer(stream)
            writer.writerow(['soil_rho','soil_unit','ampacity','current_unit','rating_basis','run_id','input_sha256','output_sha256','plugin_id','plugin_version','source'])
            writer.writerows(rows)
            self.artifact('sweep.csv',stream.getvalue().encode('utf-8-sig'))
            step['points']=[{'soil_rho_k_m_w':r[0],'ampacity_a':r[2]} for r in rows]
        self.result['workflows']['sweep'].update(status='passed',points=step['points'],run_id=run['id'])

    def type_change(self, baseline_only=False):
        self.phase='type';self.result['workflows']['type']['status']='running'
        models=self.api('GET','/api/design/cable-models')
        model=next((m for m in models if m['id']=='system.specification-yjv22-300'),None)
        with self.step('3×300可编辑结构入口','GET /api/design/cable-models','3D线程'):
            require(model is not None,'TYPE_SEED_MISSING','发布库缺YJV22 3×300结构和规格书条件。','前端线程（发布种子）；3D线程')
        w=self.api('POST','/api/design/type-workspaces',{'model_id':model['id'],'content_sha256':model['content_sha256']},owner='3D线程')
        # A new draft has no chosen execution-standard editions. Follow the
        # same explicit resource/edition selection as the release example;
        # this attaches identities only, without filling physical values or
        # approving a product. An undeclared standard must still refuse.
        from frontend.scripts.engineering_resources import bind_demo_resources
        with self.step('选择型号执行标准与参考资源','POST /api/types/{wid}/resources/migrate','数据线程'):
            bind_demo_resources(lambda path, method='GET', body=None:
                                self.api(method,path,body,owner='数据线程'),w['id'],'mv')
            w=self.api('GET','/api/workspaces/'+w['id'])
        root=f'/api/types/{w["id"]}/specification'
        def generate(workspace):
            value=self.api('POST',root+'/generate',{'expected_revision':workspace['revision'],'request_id':str(uuid4()),'scope_acknowledged':True},owner='3D线程（规格书）；研究线程（计算）')
            with self.step('五项规格书结果生成',root+'/generate'):
                require(value['status']=='generated','SPECIFICATION_BLOCKED','规格书生成未完成。','3D线程（规格书）；研究线程（计算）',result=value)
            return self.api('GET',root,owner='3D线程')
        before=generate(w)
        if baseline_only:
            self.artifact('type-specification-baseline.json',before)
            self.result['workflows']['type'].update(status='baseline_measured',channels=list(before['payload']['results']))
            return
        doc=deepcopy(w['domain'])
        for ci,core in enumerate(doc['cable_types'][0]['cores']):
            li=next(i for i,l in enumerate(core['layers']) if l['role']=='insulation')
            require(abs(core['layers'][li]['thickness']-.0045)<1e-12,'TYPE_INITIAL_DIMENSION','初始绝缘不是4.5 mm。','3D线程')
            core['layers'][li]['thickness']=.005
            path=f'/cable_types/0/cores/{ci}/layers/{li}/thickness'
            doc['provenance'][path]={'kind':'user','reference':'发布验收：各芯绝缘设计厚度4.5改为5.0 mm，非厂家实测值。','reviewed':False}
        # Do not compensate core coordinates or unrelated dimensions in the gate.
        self.api('PUT',f'/api/workspaces/{w["id"]}/domain',{'expected_revision':w['revision'],'document':doc},owner='3D线程（结构编辑）')
        changed=self.api('GET',f'/api/workspaces/{w["id"]}')
        with self.step('旧结果失效','GET /api/workspaces/{wid}/studies/{sid}/runs/{rid}'):
            for source in before['payload']['sources']:
                run=self.api('GET',f'/api/workspaces/{w["id"]}/studies/{source["study_id"]}/runs/{source["run_id"]}')
                require(run['freshness']=='historical','RESULT_NOT_INVALIDATED','尺寸修改后仍使用旧结果。')
        after=generate(changed)
        with self.step('外径和用料变化','GET /api/types/{wid}/specification','3D线程') as step:
            a=before['payload']['results']['geometry']['artifact'];b=after['payload']['results']['geometry']['artifact']
            require(b['outer_diameter_m']>a['outer_diameter_m'] and b['mass_kg_per_km']>a['mass_kg_per_km'],
                    'GEOMETRY_NOT_UPDATED','增厚绝缘后外径或用料未增加。','3D线程')
            step.update(outer_diameter_mm=[a['outer_diameter_m']*1000,b['outer_diameter_m']*1000],mass_kg_per_km=[a['mass_kg_per_km'],b['mass_kg_per_km']])
        raw=self.api('GET',root+f'/file?expected_revision={changed["revision"]}&specification_digest={after["digest"]}&audience=customer',binary=True,owner='3D线程（规格书PDF）')
        self.pdf('type-customer.pdf',raw,['YJV22','300'])
        self.artifact('type-specification.json',after)
        self.result['workflows']['type'].update(status='passed',outer_diameter_mm=step['outer_diameter_mm'],mass_kg_per_km=step['mass_kg_per_km'])

    def execute(self):
        if not self.profile:
            return self._execute()
        events=[]
        with observe_runtime(events,lambda:self.active_api or self.phase):
            code=self._execute()
        self.artifact('runtime-profile.json',{'timing':'elapsed is inclusive; self excludes instrumented children; overlapping calls must not be summed',
                                              'events':events})
        (self.output/'result.json').write_text(json.dumps(self.result,ensure_ascii=False,indent=2),encoding='utf-8')
        return code

    def _execute(self):
        from fastapi.testclient import TestClient
        from backend.main import create_app
        start=time.perf_counter();temporary=None
        try:
            with TemporaryDirectory(prefix='database-',dir=self.output) as name:
                temporary=Path(name)
                with isolated_environment(temporary) as paths:
                    with self.step('全新发布种子','scripts/run_demo.py → frontend/scripts/seed-engineering-demo.py:seed_release','前端线程（发布种子）') as step:
                        path=ROOT/'frontend/scripts/seed-engineering-demo.py'
                        spec=importlib.util.spec_from_file_location('release_gate_seed',path)
                        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                        require(not paths['CABLESIM_DB'].exists(),'DATABASE_NOT_FRESH','门禁只接受全新临时库。')
                        module.seed_release(paths['CABLESIM_DB'])
                        receipt=json.loads(paths['CABLESIM_DB'].with_suffix('.seed.json').read_text('utf-8'))
                        require(receipt['complete'],'SEED_INCOMPLETE','发布种子未完成。','前端线程（发布种子）')
                        step.update(studies=len(receipt['studies']),types=len(receipt['types']),database=str(paths['CABLESIM_DB']))
                        self.artifact('seed-receipt.json',receipt)
                    # The seed changes its environment while staging; restore the
                    # exact acceptance paths before opening the real host again.
                    os.environ.update({key:str(value) for key,value in paths.items()})
                    with TestClient(create_app(paths['CABLESIM_DB'])) as self.client:
                        w,definition,run=self.inquiry()
                        if not self.performance:self.sweep(w,definition,run)
                        self.type_change(baseline_only=self.performance)
                    if self.performance:
                        steps=self.result['steps']
                        preflight=next(s['elapsed_s'] for s in steps if s['workflow']=='inquiry' and s['step'].startswith('GET ') and s['step'].endswith('/preflight'))
                        specification=next(s['elapsed_s'] for s in steps if s['workflow']=='type' and s['step'].startswith('POST ') and s['step'].endswith('/generate'))
                        self.result['performance']={'inquiry_preflight_s':preflight,'specification_generation_s':specification,
                            'limits_s':{'inquiry_preflight':5,'specification_generation':30},'passed':preflight<=5 and specification<=30,
                            'scope':'Fresh host and native worker; no warmup before measurement. Does not validate the insulation-edit workflow.'}
                        self.result['status']='performance_measured'
                    else:self.result['status']='passed'
        except GateFailure as exc:
            self.result.update(status='failed',failure={'workflow':self.phase,**exc.detail})
            if self.phase in WORKFLOWS:self.result['workflows'][self.phase]['status']='failed'
        except Exception as exc:
            self.result.update(status='failed',failure={'workflow':self.phase,'code':'GATE_ENVIRONMENT_ERROR',
                'message':str(exc),'owner':'研究线程（验收脚本/环境）','exception':type(exc).__name__})
            if self.phase in WORKFLOWS:self.result['workflows'][self.phase]['status']='failed'
        finally:
            self.result['elapsed_s']=round(time.perf_counter()-start,3)
            self.result['database_removed']=temporary is not None and not temporary.exists()
            (self.output/'result.json').write_text(json.dumps(self.result,ensure_ascii=False,indent=2),encoding='utf-8')
        return 0 if self.result['status']=='passed' or self.result.get('performance',{}).get('passed') else 1


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'.data/acceptance'/('release-'+str(uuid4())),help='New evidence directory; must not be .data/release or an existing directory.')
    parser.add_argument('--timeout-seconds',type=int,default=900,help='Maximum polling time per accepted run, seconds.')
    parser.add_argument('--profile-preflight',action='store_true',help='Observe preparation, seal checks and plugin timings; no solver or cache behavior changes.')
    parser.add_argument('--performance-only',action='store_true',help='Measure inquiry preflight and initial five-channel specification; not a three-workflow release pass.')
    args=parser.parse_args();output=args.output.resolve()
    if output.is_relative_to((ROOT/'.data/release').resolve()) or output.exists() or args.timeout_seconds<=0:
        parser.error('Use a new output directory outside .data/release and a positive timeout.')
    output.mkdir(parents=True)
    gate=Gate(output,args.timeout_seconds,args.profile_preflight,args.performance_only);code=gate.execute()
    print(json.dumps({'status':gate.result['status'],'report':str(output/'result.json'),'failure':gate.result.get('failure')},ensure_ascii=False),flush=True)
    return code


if __name__=='__main__':
    raise SystemExit(main())
