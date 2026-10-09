"""Bounded native conversation loop; the model never owns a business write path."""
import json
import re
import sqlite3
from dataclasses import replace
from time import perf_counter,time
from uuid import uuid4

from fastapi import HTTPException
from pydantic import TypeAdapter
from backend.kernel.workspace import stamp
from backend.domain.guards import value_at
from backend.kernel.workspace import fingerprint

from .contracts import StreamEvent,ToolResult
from .context_builder import request_summary,compress_result
from .evidence import grounded_text,reconcile,evidence_summary
from .model_port import ModelError
from .model_settings import ModelSettings
from .planner import prepare
from .proposals import Proposals
from .providers import OpenAICompatibleProvider
from .recipe_compiler import compile_calls
from .recipes import recipe_schema,validate_request
from .security import redact
from .task_store import TaskStore
from .tool_broker import ToolBroker,failure
from .tool_registry import ToolRegistry
from .resilience import category
from .object_refs import references


class Harness:
    def __init__(self,research,model=None,limits=None):
        self.research=research
        self.settings=ModelSettings(research.store)
        self.model=model or OpenAICompatibleProvider(self.settings)
        self.tasks=TaskStore(research.store,research.owner_epoch,limits)
        self.registry=ToolRegistry(research)
        self.proposals=Proposals(research,self.tasks)
        self.broker=ToolBroker(research,self.tasks,self.registry,self.proposals)

    def initialize(self):
        self.tasks.initialize()
        self.settings.initialize()
        self.registry.initialize()

    def test_model(self,body):
        """Probe a candidate connection; omitted fields fall back to the one in use."""
        current=self.settings.resolve()
        base=(body.base_url or current['base_url'] or '').strip()
        model=(body.model or current['model'] or '').strip()
        key=(body.api_key or '').strip() or current['api_key']
        if not hasattr(self.model,'probe'):return {'ok':False,'code':'LLM_PROBE_UNAVAILABLE','message':'当前模型接口不支持连接测试。'}
        return self.model.probe(base,model,key)

    def status(self):
        configured,model=self.model.status()
        return {'configured':configured,'model':model,'tools':self.registry.count()}

    def tools(self):
        return self.registry.info()

    def create(self,body):
        wid=str(body.workspace_id);sid=str(body.study_id) if body.study_id else None
        with self.research.store.db() as db:
            row,_=self.research.store.load(db,wid)
            study=self.research.definition(db,wid,sid) if sid else None
        timeout=self.settings.model_timeout()
        limits=replace(self.tasks.limits,model_timeout_s=timeout) if timeout else None
        return {'id':self.tasks.create(wid,sid,row['revision'],study['revision'] if study else None,limits)}

    def emit(self,tid,kind,data,*,persist=True):
        data=redact(data)
        TypeAdapter(StreamEvent).validate_python({'type':kind,**data})
        if persist:self.tasks.emit(tid,kind,data)
        return 'event: '+kind+'\ndata: '+json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n\n'

    def begin(self,tid,content,recipe=None):
        self.tasks.record(tid)
        recipe=validate_request(recipe) if recipe is not None else None
        return self.tasks.begin_turn(tid,redact(content),redact(recipe) if recipe else None)

    def stream(self,tid,turn):
        normal=False
        state,reason='completed',None
        snapshot=None
        try:
            recovery=reconcile(self.research,self.tasks,tid,persist=True)
            if recovery['unknown']:
                raise HTTPException(409,{'code':'UNKNOWN_OPERATION','message':'原工具步骤结果未知；请先对账，未重新执行或提交作业。'})
            record=self.tasks.record(tid);snapshot=record
            requested=next(event['data'].get('recipe') for event in reversed(record['events'])
                if event['type']=='chat.message' and event['data'].get('turn_id')==turn and event['data'].get('role')=='user')
            if requested:
                waiting=yield from self.run_recipe(tid,turn,requested,record)
                if waiting:state,reason='waiting',waiting
            while True:
                record=self.tasks.record(tid)
                snapshot=record
                tools=self.registry.visible(record)
                user=next(message for message in reversed(record['messages']) if message['role']=='user')
                summary=bool(re.search(r'汇总|总结|概览|conclusion_summary',user['content']) and re.search(r'研究|结论|载流量|conclusion_summary',user['content'])
                    and not re.search(r'改成|修改|试算|细节|具体输入',user['content']))
                current=self.turn_steps(record,turn)
                digest=next((step['result']['data'] for step in reversed(current) if step.get('result')
                    and step['result']['status']=='ok' and 'studies' in step['result']['data'] and 'next_page' in step['result']['data']),None)
                covered=summary and self.digest_complete(current)
                reads=self.read_count(record,turn,tools)
                baseline=self.baseline_problem(record,turn)
                answer_reason=('宿主已执行所选配方。只解释已取得的结果与诊断，不再调用工具。' if requested else
                    '试算对比基准不可用。说明诊断原因和工作台重算步骤；方案与试算未执行，不引用历史结果作当前结论。' if baseline else
                    '结论汇总摘要已覆盖本工程研究。直接解释保存证据；运行输入细节尚未展开，可供用户追问。' if covered else
                    '只读工具已达到本条消息的软上限。按现有证据回答，明确尚未展开的对象或细节，不继续读取。' if reads>=record['budget']['limits']['max_read_tool_calls'] else None)
                answer_only=answer_reason is not None
                if baseline:state,reason='waiting','missing_input'
                if answer_only:self.tasks.emit(tid,'turn.answer_only',{'turn_id':turn,
                    'reason':'recipe_complete' if requested else 'baseline_unavailable' if baseline else 'summary_covered' if covered else 'read_limit',
                    'read_tool_calls':reads,'max_read_tool_calls':record['budget']['limits']['max_read_tool_calls'],
                    'tools_allowed':False,'remaining_page':digest.get('next_page') if digest else None})
                shown={name:tool for name,tool in tools.items() if name in ('recipe_execute','project_digest')} if summary else tools
                if summary:
                    schema=recipe_schema();schema['properties']['recipe']['enum']=['conclusion_summary'];schema['oneOf']=schema['oneOf'][:1]
                    shown['recipe_execute']=replace(shown['recipe_execute'],parameters=schema)
                prompt,definitions=prepare(record,shown,self.registry.directory() if not summary and not answer_only else [],
                    closing=answer_reason,
                    instructions=self.settings.instructions())
                configured,model=self.model.status()
                if not configured:raise ModelError('LLM_NOT_CONFIGURED','模型未配置；请在宿主环境中配置模型地址、模型名与密钥。')
                metrics={**request_summary(model,prompt,definitions),**({'phase':'recipe_answer' if requested else 'answer_only'} if answer_only else {})}
                with self.research.store.db() as db:task=self.tasks.load(db,tid)
                closing=self.tasks.closing_reason(task,metrics['prompt_bytes'],metrics['definition_bytes'])
                if closing:
                    state,reason='blocked','budget'
                    yield from self.closing(tid,turn,closing)
                    break
                task=self.tasks.begin_model(tid,turn,metrics)
                remaining=max(0.,min((task['limits']['max_active_ms']-task['elapsed_ms'])/1000,task['deadline']-time()))
                timeout=min(task['limits']['model_timeout_s'],remaining)
                started=perf_counter()
                try:
                    reply=self.model.reply(prompt,definitions,timeout)
                except (MemoryError,sqlite3.OperationalError):
                    try:self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,{},
                        {'status':'error','code':'HARNESS_RESOURCE_PRESSURE','usage_available':False})
                    except (MemoryError,sqlite3.OperationalError):pass
                    raise
                except ModelError as error:
                    self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,{},
                        {'status':'error','code':error.code,'usage_available':False})
                    raise
                self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,reply.usage,
                    {'status':'ok','finish_reason':reply.finish_reason,'tool_names':[call['name'] for call in reply.tool_calls],
                     'usage_available':all(name in reply.usage for name in ('prompt_tokens','completion_tokens')),'text_received':bool(reply.text)})
                if not reply.tool_calls:
                    yield from self.answer_loop(tid,turn,reply.text,reply.reasoning)
                    break
                if answer_only:raise HTTPException(422,{'code':'TOOLS_NOT_ALLOWED','message':'本次仅解释已取得证据与诊断，不能继续调用工具。'})
                plan=compile_calls(reply.tool_calls,shown,record['workspace_id'],record['workspace_revision'])
                for node in plan['nodes']:
                    if summary and node['tool'] not in shown:
                        node['preparation_error']={'code':'SUMMARY_RECIPE_REQUIRED','message':'结论汇总只需 conclusion_summary；请直接读取完整摘要。'}
                waiting=yield from self.execute_plan(tid,turn,plan,tools,record,reasoning=reply.reasoning,soft_limit=True)
                if waiting=='scope_confirmation':
                    state,reason='waiting',waiting
                    yield from self.closing(tid,turn,'所选能力需要人工确认正式或超算运行，尚未执行。')
                    break
            record=self.tasks.record(tid)
            if state=='completed' and any(proposal['status']=='pending' for proposal in record['proposals']):
                state,reason='reviewing','human_review'
            normal=True
        except (ModelError,HTTPException) as error:
            if isinstance(error,ModelError):code,message=error.code,error.message
            else:
                detail=error.detail;code=detail.get('code','AGENT_REQUEST_REJECTED') if isinstance(detail,dict) else 'AGENT_REQUEST_REJECTED'
                message=detail.get('message',str(detail)) if isinstance(detail,dict) else str(detail)
            state,reason=('blocked','budget') if code=='BUDGET_EXCEEDED' else ('waiting','capability') if code=='UNKNOWN_OPERATION' else ('blocked','capability')
            yield self.emit(tid,'error',{'code':code,'message':message})
            if not isinstance(error,ModelError):
                try:yield from self.closing(tid,turn,message)
                except ModelError as closing_error:
                    yield self.emit(tid,"error",{"code":closing_error.code,"message":closing_error.message})
                    yield from self.fallback(tid,turn)
                except HTTPException:
                    yield from self.fallback(tid,turn)
            elif any(step.get('result') for step in self.tasks.record(tid)['steps']):
                yield from self.fallback(tid,turn)
            normal=True
        except (MemoryError,sqlite3.OperationalError) as error:
            state,reason='blocked','capability'
            issue={'exception_type':type(error).__name__,'category':category(error),'degraded':True,'automatic_execution':False}
            try:self.tasks.emit(tid,'harness.error',issue)
            except (MemoryError,sqlite3.OperationalError):pass
            yield self.emit(tid,'error',{'code':'HARNESS_RESOURCE_PRESSURE','message':'运行层暂时资源不足；保留已取得证据与操作记录，未重放计算。'},persist=False)
            baseline=self.baseline_problem(snapshot,turn) if snapshot else None
            text,refs=(baseline['summary']+'\n下一步：'+'；'.join(baseline['next_actions']),[]) if baseline else evidence_summary(snapshot) if snapshot else ('以下为工具证据摘要，模型解释未通过核验。\n本次尚未取得可用工具证据；未推算工程结果。',[])
            object_refs=self.object_refs(tid,text,snapshot) if snapshot else []
            try:
                self.tasks.emit(tid,'answer.diagnostic' if baseline else 'answer.fallback',{'turn_id':turn,'sources':refs,'model_explanation_verified':False,'reason':issue})
                self.tasks.emit(tid,'chat.message',{'role':'assistant','content':text,'turn_id':turn,'object_refs':object_refs})
            except (MemoryError,sqlite3.OperationalError):pass
            for offset in range(0,len(text),64):yield self.emit(tid,'message.delta',{'text':text[offset:offset+64],
                **({'object_refs':object_refs} if offset==0 else {})},persist=False)
            normal=True
        except Exception as error:
            state,reason='failed',None
            self.tasks.emit(tid,'harness.error',{'exception_type':type(error).__name__,'details_recorded':False})
            yield self.emit(tid,'error',{'code':'HARNESS_FAILED','message':'Agent 运行层发生错误；已保留记录，未生成替代结果或自动重试。'})
            yield from self.fallback(tid,turn)
            normal=True
        finally:
            # Disconnecting the stream does not assert that a solver/job was cancelled.
            try:self.tasks.finish_turn(tid,turn,state if normal else 'waiting',reason if normal else 'capability')
            except (MemoryError,sqlite3.OperationalError):pass  # Durable running intent remains unknown, never reissued.
        try:record=self.tasks.record(tid)
        except (MemoryError,sqlite3.OperationalError):record=snapshot
        usage={name:record['budget'][name] if record else 0 for name in ('prompt_tokens','completion_tokens')}
        yield self.emit(tid,'done',{'usage':usage},persist=False)

    @staticmethod
    def digest_complete(steps):
        cursor=None;identity=None;studies=set();complete=False
        for step in steps:
            result=step.get('result') or {};data=result.get('data') or {}
            if result.get('status')!='ok' or 'studies' not in data or 'next_page' not in data:continue
            args=step.get('arguments') or {}
            position=(args.get('after',0),args.get('case_after',0))
            current=(data.get('workspace_revision'),data.get('total_studies'))
            if position==(0,0):cursor=(0,0);identity=current;studies=set();complete=False
            if position!=cursor or current!=identity:continue
            studies.update(item['study_id'] for item in data['studies'])
            page=data['next_page']
            cursor=(page.get('after',0),page.get('case_after',0)) if page else None
            complete=page is None and len(studies)==data.get('total_studies')
        return complete

    @staticmethod
    def turn_steps(record,turn):
        start=next(i for i in range(len(record['events'])-1,-1,-1) if record['events'][i]['type']=='chat.message'
            and record['events'][i]['data'].get('turn_id')==turn and record['events'][i]['data'].get('role')=='user')
        end=next((i for i in range(start+1,len(record['events'])) if record['events'][i]['type']=='chat.message'
            and record['events'][i]['data'].get('role')=='user'),len(record['events']))
        operations={event['data']['operation_id'] for event in record['events'][start+1:end] if event['type']=='tool.intent'}
        return [step for step in record['steps'] if step.get('operation_id') in operations or step.get('turn_id')==turn]

    def read_count(self,record,turn,tools):
        return sum(tools[step['tool']].kind=='read' for step in self.turn_steps(record,turn) if step['tool'] in tools)

    def baseline_problem(self,record,turn):
        return next((step['result'] for step in reversed(self.turn_steps(record,turn)) if step.get('result')
            and any(row['code'] in ('BASELINE_INVALID','BASELINE_REQUIRED','BASELINE_NOT_FOUND','BASELINE_CASE_INVALID')
                for row in step['result']['diagnostics'])),None)

    def run_recipe(self,tid,turn,request,record):
        """User-selected finite steps run before any model request, with normal authority."""
        self.tasks.emit(tid,'recipe.requested',{'turn_id':turn,**request,'source':'human.message','engineering_approval':False})
        arguments={'recipe':request['id'],'parameters':request['parameters']}
        pages=set();waiting=None
        while True:
            tools=self.registry.visible(self.tasks.record(tid))
            plan=compile_calls([{'id':'host-recipe-'+str(uuid4()),'name':'recipe_execute','arguments':arguments}],
                tools,record['workspace_id'],record['workspace_revision'])
            waiting=yield from self.execute_plan(tid,turn,plan,tools,record,source='host')
            current=self.tasks.record(tid)
            if request['id'] not in ('conclusion_summary','type_review') or waiting:break
            result=current['steps'][-1].get('result')
            next_page=result['data'].get('next_page') if result and result['status']=='ok' else None
            if not next_page:break
            marker=fingerprint(next_page)
            if marker in pages:
                self.tasks.emit(tid,'recipe.pagination_stopped',{'turn_id':turn,'next_page':next_page,'reason':'cursor_not_advanced'})
                break
            pages.add(marker);arguments={'recipe':request['id'],'parameters':next_page}
        self.tasks.emit(tid,'recipe.finished',{'turn_id':turn,'id':request['id'],'source':'host','tools_allowed_next':False,
            'status':'needs_action' if waiting or any((step.get('result') or {}).get('status')=='error' for step in self.turn_steps(current,turn)) else 'completed'})
        return waiting

    def execute_plan(self,tid,turn,plan,tools,snapshot,*,reasoning='',source='model',soft_limit=False):
        with self.tasks.db() as db:task=self.tasks.load(db,tid)
        for node in plan['nodes']:
            try:node['input_identity']=self.broker.identity(task,node,tools.get(node['tool']))
            except HTTPException as error:
                detail=error.detail
                node['preparation_error']={'code':detail.get('code','INPUT_IDENTITY_INVALID') if isinstance(detail,dict) else 'INPUT_IDENTITY_INVALID',
                    'message':redact(str(detail))}
        revision=self.tasks.add_plan(tid,plan)
        recipes={node['input_identity'].get('recipe') for node in plan['nodes']} - {None}
        if recipes:self.tasks.emit(tid,'recipe.compiled',{'turn_id':turn,'revision':revision,'source':source,
            'recipes':sorted(recipes),'nodes':[{'id':node['id'],'tool':node['tool'],
                'recipe':node['input_identity'].get('recipe'),'bindings':node.get('bindings',{})} for node in plan['nodes']],
            'engineering_approval':False})
        self.tasks.emit(tid,'chat.message',{'role':'assistant','content':None,'turn_id':turn,**({'reasoning_content':reasoning} if reasoning else {}),
            'tool_calls':[{'id':node['id'],'name':node['tool'],'arguments':node['arguments']} for node in plan['nodes']]})
        for index,node in enumerate(plan['nodes']):
            if soft_limit and self.read_count(self.tasks.record(tid),turn,tools)>=task['limits']['max_read_tool_calls']:
                self.tasks.emit(tid,'plan.read_limit',{'turn_id':turn,'revision':revision,'executed':False,
                    'skipped_node_ids':[row['id'] for row in plan['nodes'][index:]]})
                break
            tool=tools.get(node['tool'])
            if node['input_identity'].get('recipe'):
                outcomes={step['node_id']:step for step in self.tasks.record(tid)['steps']}
                dependencies=[outcomes.get(identifier) for identifier in node['depends_on']]
                if any(step and step['state']!='succeeded' for step in dependencies):
                    node['preparation_error']={'code':'RECIPE_DEPENDENCY_FAILED',
                        'message':'配方前一步未成功，后续动作未执行；请先处理原诊断。'}
                elif node.get('bindings'):
                    for field,binding in node['bindings'].items():
                        item=outcomes.get(binding['node_id'])
                        if not item or not item.get('result') or item['state']!='succeeded':
                            node['preparation_error']={'code':'RECIPE_DEPENDENCY_FAILED','message':'配方输入证据未取得，后续动作未执行。'}
                            break
                        node['arguments'][field]=value_at(item['result'],binding['path'])
                    node['arguments_digest']=fingerprint(node['arguments'])
                    node['input_identity']=self.broker.identity(task,node,tool)
                    self.tasks.emit(tid,'recipe.bound',{'turn_id':turn,'node_id':node['id'],
                        'bindings':node['bindings'],'arguments_digest':node['arguments_digest']})
            prior=self.previous_error(tid,node)
            reused=self.previous_read(tid,node) if not prior and not node.get('preparation_error') else None
            operation=self.tasks.issue(tid,turn,revision,node)
            yield self.emit(tid,'tool.call',{'id':node['id'],'tool':node['tool'],
                'title':tool.title if tool else '未注册工具','arguments':node['arguments']})
            self.tasks.running(tid,operation);started=perf_counter()
            result=(failure('DIAGNOSTIC_ALREADY_REPORTED','同一工具与输入的诊断已给出，未重复执行；请处理原缺项。',
                        actions=['读取原诊断并修正输入；结论汇总可直接使用 project_digest。']) if prior
                else failure(**node['preparation_error']) if node.get('preparation_error')
                else ToolResult.model_validate(reused['result']) if reused else self.broker.execute(task,node,tool))
            if prior:self.tasks.emit(tid,'tool.diagnostic_reused',{'turn_id':turn,'node_id':node['id'],'source_operation_id':prior['operation_id']})
            if reused:self.tasks.emit(tid,'tool.result_reused',{'turn_id':turn,'node_id':node['id'],
                'source_operation_id':reused['operation_id'],'source_run_id':reused['run_id'],'executed':False})
            result=redact(result.model_dump(mode='json'));self.tasks.finish_step(tid,operation,result,(perf_counter()-started)*1000)
            snapshot['steps'].append({'result':compress_result(result),'operation_id':operation,'turn_id':turn,
                'node_id':node['id'],'tool':node['tool'],'state':'succeeded' if result['status']=='ok' else 'failed'})
            yield self.emit(tid,'tool.result',{'id':node['id'],'status':result['status'],'summary':result['summary'],
                'next_actions':result['next_actions'],**({'diagnostics':result['diagnostics']} if result['diagnostics'] else {})})
            if result['data'].get('proposal'):yield self.emit(tid,'proposal.created',result['data']['proposal'],persist=False)
            codes={row['code'] for row in result['diagnostics']}
            if 'DIAGNOSTIC_ALREADY_REPORTED' in codes:raise HTTPException(422,{'code':'DIAGNOSTIC_ALREADY_REPORTED','message':'重复动作已停止；请按原诊断修正输入。'})
            if 'HUMAN_EXECUTION_REQUIRED' in codes:return 'scope_confirmation'
            if result['status']=='error' and self.repeated_error(tid,node,result)>=task['limits']['max_repair_attempts']:
                raise HTTPException(422,{'code':'REPAIR_LIMIT_EXCEEDED','message':'同一错误已达到修正次数上限，请人工补充输入或能力；没有无限重试。'})

    def respond(self,tid,turn,text,*,safe=False,phase='answer',attempt=0,suffix='',reasoning=''):
        record=self.tasks.record(tid)
        observations=[step['result'] for step in record['steps'] if step.get('result')]
        current=[step['result'] for step in self.turn_steps(record,turn) if step.get('result')]
        baseline=self.baseline_problem(record,turn)
        if baseline:observations=current  # Earlier previews cannot prove a new comparison that was stopped.
        text=redact(text).strip() or '未取得可用解释，请根据工具诊断补充输入；当前请求尚未完成。'
        if not safe:
            proof=[]
            try:text=grounded_text(text,observations,current=current,proposals=[] if baseline else record['proposals'],
                users=[message['content'] for message in record['messages'] if message['role']=='user'],proof=proof)
            except HTTPException as error:
                self.tasks.emit(tid,'answer.rejected',redact({'turn_id':turn,'phase':phase,'attempt':attempt,
                    'draft':text,'issues':error.detail['issues']}))
                raise
            self.tasks.emit(tid,'answer.accepted',{'turn_id':turn,'phase':phase,'attempt':attempt,'matches':proof})
        if baseline and not ('工作台' in text and '重算' in text):
            text+='\n'+baseline['summary']+'\n下一步：'+'；'.join(baseline['next_actions'])
        text+=suffix
        object_refs=self.object_refs(tid,text,record)
        self.tasks.emit(tid,'chat.message',{'role':'assistant','content':text,'turn_id':turn,'object_refs':object_refs,
            **({'reasoning_content':reasoning} if reasoning else {})})
        for offset in range(0,len(text),64):yield self.emit(tid,'message.delta',{'text':text[offset:offset+64],
            **({'object_refs':object_refs} if offset==0 else {})})

    def object_refs(self,tid,text,record):
        try:return references(self.research,text,record)
        except (HTTPException,MemoryError,sqlite3.OperationalError,OSError) as error:
            try:self.tasks.emit(tid,'object_refs.unavailable',{'exception_type':type(error).__name__,'cards_invented':False})
            except (MemoryError,sqlite3.OperationalError):pass
            return []

    def answer_loop(self,tid,turn,text,reasoning=''):
        record=self.tasks.record(tid);limit=record['budget']['limits']['max_repair_attempts']
        for attempt in range(limit+1):
            try:
                yield from self.respond(tid,turn,text,phase='repair' if attempt else 'answer',attempt=attempt,reasoning=reasoning)
                return
            except HTTPException as error:
                yield self.emit(tid,'error',{'code':error.detail['code'],'message':error.detail['message']})
            record=self.tasks.record(tid)
            feedback=next(event['data'] for event in reversed(record['events']) if event['type']=='answer.rejected' and event['data']['turn_id']==turn)
            if attempt==limit:break
            prompt,definitions=prepare(record,{},closing='只重写被拦的解释，不执行任何业务动作。',feedback=feedback,instructions=self.settings.instructions())
            _,model=self.model.status();metrics={**request_summary(model,prompt,definitions),'phase':'repair'}
            with self.research.store.db() as db:task=self.tasks.load(db,tid)
            reason=self.tasks.closing_reason(task,metrics['prompt_bytes'],metrics['definition_bytes'],repair=True)
            if reason:break
            self.tasks.emit(tid,'answer.repair',{'turn_id':turn,'attempt':attempt+1,'feedback':compress_result({
                'status':'error','summary':'根据核验问题重写解释','data':{'issues':feedback['issues']}})})
            task=self.tasks.begin_model(tid,turn,metrics)
            timeout=min(task['limits']['model_timeout_s'],max(.001,(task['limits']['max_active_ms']-task['elapsed_ms'])/1000),max(.001,task['deadline']-time()))
            started=perf_counter()
            try:reply=self.model.reply(prompt,definitions,timeout)
            except ModelError as error:
                self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,{}, {'status':'error','phase':'repair','code':error.code,'usage_available':False})
                yield self.emit(tid,'error',{'code':error.code,'message':error.message})
                break
            self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,reply.usage,{'status':'ok','phase':'repair',
                'usage_available':all(key in reply.usage for key in ('prompt_tokens','completion_tokens'))})
            if reply.tool_calls:
                self.tasks.emit(tid,'answer.repair_rejected',{'turn_id':turn,'attempt':attempt+1,'code':'TOOLS_NOT_ALLOWED'})
                break
            text,reasoning=reply.text,reply.reasoning
        yield from self.closing(tid,turn,'解释修正次数或可用预算已到上限。')

    def fallback(self,tid,turn):
        record=self.tasks.record(tid)
        baseline=self.baseline_problem(record,turn)
        if baseline:
            text=baseline['summary']+'\n下一步：'+'；'.join(baseline['next_actions'])
            self.tasks.emit(tid,'answer.diagnostic',{'turn_id':turn,'model_explanation_verified':False,
                'code':baseline['diagnostics'][0]['code'],'details':baseline['diagnostics'][0]['details']})
            yield from self.respond(tid,turn,text,safe=True)
            return
        text,refs=evidence_summary(record)
        self.tasks.emit(tid,'answer.fallback',{'turn_id':turn,'sources':refs,'model_explanation_verified':False})
        yield from self.respond(tid,turn,text,safe=True)

    def closing(self,tid,turn,reason):
        record=self.tasks.record(tid)
        feedback=next((event['data'] for event in reversed(record['events']) if event['type']=='answer.rejected' and event['data']['turn_id']==turn),None)
        prompt,definitions=prepare(record,{},closing=reason,feedback=feedback,instructions=self.settings.instructions())
        configured,model=self.model.status()
        if not configured:raise ModelError('LLM_NOT_CONFIGURED','模型未配置，无法发起收尾请求。')
        task=self.tasks.begin_model(tid,turn,request_summary(model,prompt,definitions),closing=True)
        timeout=min(task['limits']['model_timeout_s'],max(.001,(task['limits']['max_active_ms']-task['elapsed_ms'])/1000),max(.001,task['deadline']-time()))
        started=perf_counter()
        try:reply=self.model.reply(prompt,definitions,timeout)
        except ModelError as error:
            self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,{}, {'status':'error','code':error.code,'usage_available':False})
            yield self.emit(tid,'error',{'code':error.code,'message':error.message})
            yield from self.fallback(tid,turn)
            return
        self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,reply.usage,{'status':'ok','phase':'closing',
            'finish_reason':reply.finish_reason,'usage_available':all(key in reply.usage for key in ('prompt_tokens','completion_tokens'))})
        self.tasks.emit(tid,'budget.closing',{'turn_id':turn,'reason':reason,'tools_allowed':False,'remaining_goals_completed':False})
        try:
            if reply.tool_calls:raise HTTPException(422,'收尾请求不能调用工具。')
            yield from self.respond(tid,turn,reply.text,phase='closing',suffix='' if feedback else '\n尚未完成的请求：'+reason,reasoning=reply.reasoning)
        except HTTPException:
            yield from self.fallback(tid,turn)

    def repeated_error(self,tid,node,result):
        signature=[(item['code'],item.get('path')) for item in result['diagnostics']]
        record=self.tasks.record(tid)
        began=next(event['created'] for event in reversed(record['events']) if event['type']=='chat.message' and event['data'].get('role')=='user')
        return sum(step['tool']==node['tool'] and step['arguments_digest']==node['arguments_digest']
            and [(item['code'],item.get('path')) for item in step['result']['diagnostics']]==signature
            for step in record['steps'] if step.get('result') and step['result']['status']=='error' and step['created']>=began)

    def previous_error(self,tid,node):
        record=self.tasks.record(tid)
        began=next(event['created'] for event in reversed(record['events'])
            if event['type']=='chat.message' and event['data'].get('role')=='user')
        physical=lambda identity:{key:value for key,value in identity.items() if key not in ('recipe','recipe_version','recipe_step')}
        return next((step for step in reversed(record['steps']) if step.get('result')
            and step['result']['status']=='error' and step['created']>=began
            and step['tool']==node['tool'] and step['arguments_digest']==node['arguments_digest']
            and physical(step['input_identity'])==physical(node['input_identity'])),None)

    def previous_read(self,tid,node):
        if node['tool']!='run_read':return None
        view=lambda args:{key:args[key] for key in ('run_id','case_id','entity','key','input_paths') if args.get(key) is not None}
        physical=lambda identity:{key:value for key,value in identity.items() if key not in ('recipe','recipe_version','recipe_step')}
        return next((step for step in reversed(self.tasks.record(tid)['steps']) if step['tool']=='run_read'
            and step['state']=='succeeded' and step.get('result') and view(step['arguments'])==view(node['arguments'])
            and physical(step['input_identity'])==physical(node['input_identity'])),None)

    def close_stream(self,tid,turn,iterator):
        iterator.close()
        with self.research.store.db(True) as db:
            task=self.tasks.load(db,tid)
            if task['active_turn']!=turn:return
            db.execute("UPDATE agent_steps SET state='cancelled',finished=? WHERE task_id=? AND state='issued'",(stamp(),tid))
        self.tasks.finish_turn(tid,turn,'waiting','capability')

    def reconciliation(self,tid):
        value=reconcile(self.research,self.tasks,tid,persist=True)
        self.tasks.emit(tid,'task.reconciliation',value)
        return value
