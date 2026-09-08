"""Typed engineering capabilities shared by UI and bounded agents.
No shell, arbitrary URLs, SQL, credential tools, or automatic approval are registered.
This is a local application service, NOT a security boundary between tenants.
"""
from dataclasses import dataclass
import inspect
import json
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool
from pydantic import Field, ValidationError
from .schemas import StrictModel, Scenario
from .workbench import Revision, Edit, Task, PLANNER, fingerprint, stamp
from .agent import Change, PlanRequest, patch
from .modeling import ModelSpecification, model_proposal
from .design_basis import DesignBasis, STANDARDS, VERIFIED_DATE, inspect_basis
from .selection import DesignRequest, VerticalRequest
from .field_analysis import FieldRequest

class NoArgs(StrictModel):
    pass
class ProposedChanges(StrictModel):
    changes: list[Change] = Field(min_length=1,max_length=45)
class PlanArgs(StrictModel):
    message: str = Field(min_length=1,max_length=3000)
    mode: Literal['local','openai'] = 'local'
    consent: bool = False
class DocumentQuery(StrictModel):
    query: str = Field(min_length=1,max_length=300)
class FieldArgs(StrictModel):
    kind: Literal['thermal_fd','electric','magnetic']
    resolution: Literal[65,129] = 65
from .vertical import Vertical
class VerticalArgs(StrictModel):
    configuration: Vertical
    compare_mesh: bool = True
class SelectionArgs(StrictModel):
    target_current_a: float = Field(gt=0,le=3000)
    reserve_percent: float = Field(default=10,ge=0,le=50)
    max_diameter_mm: float = Field(default=150,gt=0,le=300)
    conductor: Literal['any','copper','aluminium'] = 'any'
    include_demo: bool = False
    rank_by: Literal['area','loss','cost'] = 'area'
    currency: Literal['CNY','USD','EUR'] = 'CNY'
    domain: Literal['buried','vertical_air'] = 'buried'
    vertical: Vertical | None = None

class ReportArgs(StrictModel):
    run_id: UUID

class Invocation(StrictModel):
    capability: str = Field(min_length=1,max_length=80)
    request_id: UUID
    expected_revision: int = Field(ge=1)
    arguments: dict = Field(default_factory=dict)

@dataclass(frozen=True)
class Capability:
    label: str
    schema: type[StrictModel]
    effect: Literal['read','study','proposal']
    handler: object

class EngineeringRuntime:
    version = '0.5.0'
    def __init__(self,store,designs,library,providers):
        self.store,self.designs,self.library,self.providers=store,designs,library,providers
        self.capabilities = {
            'project.inspect':Capability('读取工程',NoArgs,'read',self.inspect_project),
            'model.generate':Capability('生成电缆模型变更',ModelSpecification,'proposal',self.generate),
            'parameters.propose':Capability('提出参数变更',ProposedChanges,'proposal',self.propose),
            'task.plan':Capability('解析工程任务',PlanArgs,'proposal',self.plan),
            'analysis.buried':Capability('直埋载流量计算',NoArgs,'study',self.buried),
            'analysis.vertical':Capability('竖向空气电热计算',VerticalArgs,'study',self.vertical),
            'analysis.fields':Capability('截面场计算',FieldArgs,'study',self.fields),
            'selection.evaluate':Capability('计算选型候选',SelectionArgs,'study',self.select),
            'reports.render':Capability('生成计算书',ReportArgs,'read',self.report),
            'documents.search':Capability('检索资料原文',DocumentQuery,'read',self.search),
            'standards.inspect':Capability('检查设计依据适用范围',DesignBasis,'read',self.basis_check),
            'standards.propose':Capability('提出设计依据变更',DesignBasis,'proposal',self.basis_propose),
        }

    def initialize(self):
        with self.store.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS engineering_tasks (
              id TEXT, workspace TEXT, capability TEXT, base_revision INTEGER, request_hash TEXT,
              status TEXT, input_snapshot TEXT, output TEXT, created TEXT, finished TEXT,
              PRIMARY KEY(workspace,id))''')

    def catalog(self):
        return {'runtime_version':self.version,'approval_policy':'修改工程必须经独立的人工审批接口确认；此注册表不提供批准、解锁或凭据工具。',
                'tools':[{'name':name,'label':c.label,'effect':c.effect,'input_schema':c.schema.model_json_schema(),
                          'result_policy':'结构化结果及输入版本','requires_revision':True} for name,c in self.capabilities.items()]}

    def inspect_project(self,wid,revision,args):
        return self.store.snapshot(wid)
    def generate(self,wid,revision,args):
        return model_proposal(self.store,wid,revision,args)
    def propose(self,wid,revision,args):
        state=self.store.snapshot(wid)
        scenario,diff=patch(Scenario.model_validate(state['scenario']),args.changes)
        return self.store.stage(wid,revision,{'ready':True,'action':'import','scenario':scenario.model_dump(),
            'changes':diff,'mode':'engineering-command','message':'参数变更','questions':[],'assumptions':[], 'events':[]})
    async def plan(self,wid,revision,args):
        state=self.store.snapshot(wid)
        result=await PLANNER.ainvoke({'request':PlanRequest(scenario=state['scenario'],**args.model_dump()),'providers':self.providers})
        proposal={**result['plan'],'message':args.message,'events':result['events']}
        return self.store.stage(wid,revision,proposal) if proposal['ready'] else proposal
    def buried(self,wid,revision,args):
        return self.store.calculate(wid,Revision(expected_revision=revision))
    def vertical(self,wid,revision,args):
        return self.designs.vertical(wid,VerticalRequest(expected_revision=revision,**args.model_dump()))
    def fields(self,wid,revision,args):
        return self.designs.fields(wid,FieldRequest(expected_revision=revision,**args.model_dump()))
    def select(self,wid,revision,args):
        return self.designs.design(wid,DesignRequest(expected_revision=revision,**args.model_dump()))
    def report(self,wid,revision,args):
        from .report import render_report
        with self.store.db() as db:
            row=db.execute('SELECT * FROM workspace_runs WHERE workspace=? AND id=?',(wid,str(args.run_id))).fetchone()
            if row is None:raise HTTPException(404,'计算记录不存在或不属于本工程。')
            output=json.loads(row['output'])
            if not output.get('result'):raise HTTPException(422,'此记录不是载流量计算，不能生成稳态计算书。')
        return {'html':render_report(output['result']),'run_id':str(args.run_id),'source_revision':row['revision']}
    def search(self,wid,revision,args):
        return {'hits':self.library.search(args.query),'method':'本机关键词检索；不是向量语义检索'}
    def basis_check(self,wid,revision,args):
        return inspect_basis(Scenario.model_validate(self.store.snapshot(wid)['scenario']),args)
    def basis_propose(self,wid,revision,args):
        state=self.store.snapshot(wid)
        result=inspect_basis(Scenario.model_validate(state['scenario']),args)
        if not result['can_record']:
            raise HTTPException(422,'；'.join(f['message'] for f in result['findings'] if f['level']=='error'))
        return self.store.stage(wid,revision,{'ready':True,'action':'import','scenario':state['scenario'],
            'changes':[],'mode':'design-basis','message':'修改设计依据','questions':[],
            'assumptions':[result['statement']]+[f['message'] for f in result['findings']],
            'design_basis':args.model_dump(),'previous_design_basis':state.get('design_basis'),'events':[]})

    async def invoke(self,wid,body:Invocation):
        capability=self.capabilities.get(body.capability)
        if capability is None: raise HTTPException(422,'未注册的工程能力。')
        try: args=capability.schema.model_validate(body.arguments)
        except ValidationError as exc:
            raise HTTPException(422,[{'loc':e['loc'],'msg':e['msg'],'type':e['type']} for e in exc.errors()]) from None
        request_hash=fingerprint({'capability':body.capability,'revision':body.expected_revision,'arguments':args.model_dump(mode='json')})
        tid=str(body.request_id)
        with self.store.db(True) as db:
            existing=db.execute('SELECT * FROM engineering_tasks WHERE workspace=? AND id=?',(wid,tid)).fetchone()
            if existing:
                if existing['request_hash']!=request_hash: raise HTTPException(409,'同一请求标识不能用于不同参数。')
                if existing['status']=='running': raise HTTPException(409,'请求仍在执行；不会重复启动。')
                saved=json.loads(existing['output'])
                if existing['status']=='failed': raise HTTPException(saved['status_code'],saved['detail'])
                return saved
            row,state=self.store.load(db,wid,body.expected_revision)
            context={'scenario':state['scenario'],'design_basis':state.get('design_basis'),
                     'source_ids':[s['id'] for s in state['sources']],'arguments':args.model_dump(mode='json')}
            db.execute('INSERT INTO engineering_tasks VALUES (?,?,?,?,?,?,?,?,?,?)',
                (tid,wid,body.capability,row['revision'],request_hash,'running',json.dumps(context,ensure_ascii=False),None,stamp(),None))
        try:
            if inspect.iscoroutinefunction(capability.handler):
                result=await capability.handler(wid,body.expected_revision,args)
            else:
                result=await run_in_threadpool(capability.handler,wid,body.expected_revision,args)
            # Reads and expensive studies must not be labelled as the new revision if edited meanwhile.
            with self.store.db(True) as db:
                self.store.load(db,wid,body.expected_revision)
                envelope={'task_id':tid,'capability':body.capability,'base_revision':body.expected_revision,
                          'input_sha256':fingerprint(context),'runtime_version':self.version,'result':result}
                db.execute("UPDATE engineering_tasks SET status='succeeded',output=?,finished=? WHERE workspace=? AND id=?",
                    (json.dumps(envelope,ensure_ascii=False),stamp(),wid,tid))
            return envelope
        except Exception as exc:
            code=exc.status_code if isinstance(exc,HTTPException) else 422 if isinstance(exc,ValueError) else 500
            detail=exc.detail if isinstance(exc,HTTPException) else '工程操作失败；输入未被自动放宽，请检查参数或重新规划。'
            with self.store.db(True) as db:
                db.execute("UPDATE engineering_tasks SET status='failed',output=?,finished=? WHERE workspace=? AND id=?",
                    (json.dumps({'status_code':code,'detail':detail},ensure_ascii=False),stamp(),wid,tid))
            raise HTTPException(code,detail) from None

    def provenance(self,wid):
        state=self.store.snapshot(wid)
        nodes=[{'id':'project:'+wid,'kind':'project','label':state['scenario']['name']},
               {'id':f'revision:{wid}:{state["revision"]}','kind':'revision','label':f'工程版本 {state["revision"]}'}]
        edges=[{'from':nodes[0]['id'],'to':nodes[1]['id'],'relation':'当前版本'}]
        for source in state['sources']:
            sid='source:'+source['id'];nodes.append({'id':sid,'kind':'source','label':source['title']})
            for e in source.get('excerpts',[]):
                fid='parameter:'+e['path']
                if not any(n['id']==fid for n in nodes): nodes.append({'id':fid,'kind':'parameter','label':e['path']})
                value=state['scenario']
                for key in e['path'].split('.'): value=value.get(key) if isinstance(value,dict) else None
                edges.append({'from':fid,'to':sid,'relation':'当前数值引用' if value==e.get('value') else '历史数值引用','page':source['page'],'quote':e['quote']})
        with self.store.db() as db:
            tasks=[dict(r) for r in db.execute('SELECT id,capability,base_revision,status,created,finished,input_snapshot FROM engineering_tasks WHERE workspace=? ORDER BY rowid DESC LIMIT 100',(wid,))]
        for t in tasks:
            nodes.append({'id':'task:'+t['id'],'kind':'task','label':self.capabilities[t['capability']].label if t['capability'] in self.capabilities else t['capability'],'status':t['status']})
            rev=f'revision:{wid}:{t["base_revision"]}'
            if not any(n['id']==rev for n in nodes):nodes.append({'id':rev,'kind':'revision','label':f'工程版本 {t["base_revision"]}'})
            edges.append({'from':'task:'+t['id'],'to':rev,'relation':'采用输入快照'})
            t.pop('input_snapshot')
        return {'nodes':nodes,'edges':edges,'tasks':tasks,'coverage':'仅包含统一执行层的任务及工程已保存引用；旧接口记录仍在计算记录中。'}


def make_router(runtime):
    router=APIRouter(prefix='/api/runtime')
    @router.get('/capabilities')
    def capabilities():return runtime.catalog()
    @router.get('/standards')
    def standards():return {'items':STANDARDS,'verified_on':VERIFIED_DATE,'normative_tables_included':False}
    @router.post('/{wid}/invoke')
    async def invoke(wid:str,body:Invocation):return await runtime.invoke(wid,body)
    @router.get('/{wid}/provenance')
    def provenance(wid:str):return runtime.provenance(wid)
    @router.get('/{wid}/tasks/{tid}')
    def task(wid:str,tid:UUID):
        with runtime.store.db() as db:
            runtime.store.load(db,wid)
            row=db.execute('SELECT * FROM engineering_tasks WHERE workspace=? AND id=?',(wid,str(tid))).fetchone()
            if row is None:raise HTTPException(404,'工程任务不存在。')
        return {**dict(row),'input_snapshot':json.loads(row['input_snapshot']),'output':json.loads(row['output']) if row['output'] else None}
    return router
