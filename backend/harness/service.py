"""Bounded native conversation loop; the model never owns a business write path."""
import json
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
from .recipes import validate_request,recipes
from .security import redact
from .task_store import TaskStore
from .tool_broker import ToolBroker,failure
from .tool_registry import ToolRegistry
from .resilience import category
from .object_refs import references
from .session_scope import is_type,load_context
from .inbox import report as inbox_report,MAX_TRIAGE_PAGES
from .progress import state as task_progress
from .platform import Platform
from .memory import Memories


class Harness:
    def __init__(self,research,model=None,limits=None):
        self.research=research
        self.settings=ModelSettings(research.store)
        self.model=model or OpenAICompatibleProvider(self.settings)
        self.tasks=TaskStore(research.store,research.owner_epoch,limits)
        self.registry=ToolRegistry(research)
        self.proposals=Proposals(research,self.tasks)
        self.platform=Platform(research,self.tasks,self.registry)
        self.broker=ToolBroker(research,self.tasks,self.registry,self.proposals)
        self.broker.platform=self.platform
        self.memories=Memories(self)

    def initialize(self):
        self.tasks.initialize()
        self.settings.initialize()
        self.registry.initialize()
        self.memories.initialize()

    def model_record(self,tid,turn=None):
        record=self.tasks.record(tid,model_context=True)
        try:record['memory']=self.memories.recall(record)
        except Exception as error:
            record['memory']={'enabled':True,'items':[],'code':type(error).__name__,'engineering_evidence':False}
        if turn and record['memory']['enabled'] and not any(event['type']=='memory.recalled'
                and event['data'].get('turn_id')==turn for event in record['events']):
            try:self.tasks.emit(tid,'memory.recalled',{'turn_id':turn,'items':[
                    {'id':item['id'],'revision':item['revision']} for item in record['memory']['items']],
                    'code':record['memory'].get('code'),'engineering_evidence':False})
            except (sqlite3.OperationalError,MemoryError):pass
        return record

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

    def catalog_context(self,session_id=None,workspace_id=None):
        if session_id and workspace_id:raise HTTPException(422,'请选择 session_id 或 workspace_id 之一。')
        if session_id:
            with self.tasks.db() as db:return self.tasks.load(db,session_id)['context']
        if workspace_id:
            with self.research.store.db() as db:
                row,_=self.research.store.load(db,workspace_id,allow_domain=True)
                return load_context(db,{'id':'','workspace_id':workspace_id,'workspace_revision':row['revision']})
        return None

    def tools(self,session_id=None,workspace_id=None):
        context=self.catalog_context(session_id,workspace_id)
        if context and context['kind']=='type':
            return [tool.info() for tool in self.registry.visible({'context':context,'workspace_id':context['id'],'steps':[]}).values()]
        return self.registry.info()

    def recipes(self,session_id=None,workspace_id=None):
        return recipes(self.catalog_context(session_id,workspace_id))

    def create(self,body):
        wid=str(body.workspace_id);sid=str(body.study_id) if body.study_id else None
        with self.research.store.db() as db:
            row,_=self.research.store.load(db,wid,allow_domain=True)
            study=self.research.definition(db,wid,sid) if sid else None
        timeout=self.settings.model_timeout()
        limits=replace(self.tasks.limits,model_timeout_s=timeout) if timeout else None
        tid=self.tasks.create(wid,sid,row['revision'],study['revision'] if study else None,limits)
        with self.tasks.db() as db:context=self.tasks.load(db,tid)['context']
        return {'id':tid,'context':context}

    def emit(self,tid,kind,data,*,persist=True):
        data=redact(data)
        TypeAdapter(StreamEvent).validate_python({'type':kind,**data})
        if persist:self.tasks.emit(tid,kind,data)
        return 'event: '+kind+'\ndata: '+json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n\n'

    def begin(self,tid,content,recipe=None):
        record=self.tasks.record(tid,model_context=True)
        source='human.message'
        recipe=validate_request(recipe,record['context']) if recipe is not None else None
        return self.tasks.begin_turn(tid,redact(content),redact(recipe) if recipe else None,recipe_source=source)

    def stream(self,tid,turn):
        normal=False
        state,reason='completed',None
        snapshot=None
        try:
            recovery=reconcile(self.research,self.tasks,tid,persist=True)
            if recovery['unknown']:
                raise HTTPException(409,{'code':'UNKNOWN_OPERATION','message':'原工具步骤结果未知；请先对账，未重新执行或提交作业。'})
            record=self.tasks.record(tid,model_context=True);snapshot=record
            requested=next(event['data'].get('recipe') for event in reversed(record['events'])
                if event['type']=='chat.message' and event['data'].get('turn_id')==turn and event['data'].get('role')=='user')
            if requested:
                waiting=yield from self.run_recipe(tid,turn,requested,record)
                if waiting:state,reason='waiting',waiting
            elif is_type(record):
                # A durable host read supplies the default context and quantity
                # evidence before the first model request, using normal budgets.
                plan=compile_calls([{'id':'host-type-context-'+str(uuid4()),'name':'type_read',
                    'arguments':{'type_id':record['workspace_id'],'view':'summary'}}],
                    self.registry.visible(record),record['workspace_id'],record['workspace_revision'])
                yield from self.execute_plan(tid,turn,plan,self.registry.visible(record),record,source='host')
                self.tasks.emit(tid,'context.loaded',{'turn_id':turn,'kind':'type','tool':'type_read','view':'summary',
                    'status':record['steps'][-1]['result']['status'],'workspace_revision':record['workspace_revision']})
            while True:
                record=self.model_record(tid,turn)
                snapshot=record
                tools=self.registry.visible(record)
                current=self.turn_steps(record,turn)
                progress=task_progress(record,tools)
                digest=next((step['result']['data'] for step in reversed(current) if step.get('result')
                    and step['result']['status']=='ok' and 'studies' in step['result']['data'] and 'next_page' in step['result']['data']),None)
                reads=self.read_count(record,turn,tools)
                baseline=self.baseline_problem(record,turn)
                method_block=self.method_problem(record,turn)
                model_recipe=next((e['data'] for e in reversed(record['events']) if e['type']=='recipe.finished'
                    and e['data'].get('turn_id')==turn and e['data'].get('source')=='model'
                    and not e['data'].get('remaining_pages')),None)
                # A model-selected finite recipe has already supplied its
                # declared scope. Awaiting a duplicate recipe before explaining
                # wasted a provider round and a second pair of tool intents.
                # Explicit multi-goal plans still keep tools until every goal's
                # receipts are present; paginated recipes remain open above.
                recipe_ready=model_recipe and (progress['all_satisfied'] if progress['goals'] else model_recipe.get('status')=='completed')
                answer_reason=('研究保存的方法发行已变化，预检尚未执行。根据结构化原因说明阻断及人工下一步，不重复预检、不宣称缺项已检查。' if method_block else
                    '宿主已执行所选配方。按回执解释结果、检查覆盖范围及尚未覆盖的目标；预检通过不等于工程合格，不再重复已完成的配方。' if requested or recipe_ready else
                    '连续读取没有取得新证据。说明已完成目标、缺口及可执行下一步。' if progress['consecutive_unproductive_reads']>=record['budget']['limits']['max_read_tool_calls'] else None)
                answer_only=answer_reason is not None
                if baseline:state,reason='waiting','missing_input'
                if method_block:state,reason='waiting','missing_input'
                if answer_only:self.tasks.emit(tid,'turn.answer_only',{'turn_id':turn,
                    'reason':'method_release_changed' if method_block else 'recipe_complete' if requested or recipe_ready else 'evidence_stalled',
                    'read_tool_calls':reads,'max_read_tool_calls':record['budget']['limits']['max_read_tool_calls'],
                    'consecutive_unproductive_reads':progress['consecutive_unproductive_reads'],
                    'tools_allowed':False,'remaining_page':digest.get('next_page') if digest else None})
                shown=self.remaining_preflights(tid,record,tools,current)
                prompt,definitions=prepare(record,shown,self.registry.directory(record) if not answer_only else [],
                    closing=answer_reason,
                    instructions=self.settings.instructions(),progress=progress)
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
                plan=compile_calls(reply.tool_calls,tools,record['workspace_id'],record['workspace_revision'])
                waiting=yield from self.execute_plan(tid,turn,plan,tools,record,reasoning=reply.reasoning,soft_limit=True)
                if waiting=='scope_confirmation':
                    state,reason='waiting',waiting
                    yield from self.closing(tid,turn,'所选操作需要人工确认；按工具诊断到对应模块核对并执行，当前尚未执行。')
                    break
            record=self.tasks.record(tid,model_context=True)
            if state=='completed' and any(proposal['status']=='pending' for proposal in record['proposals']):
                state,reason='reviewing','human_review'
            elif state=='completed' and any(step['tool']=='platform_prepare' and (step.get('result') or {}).get('status')=='ok'
                    for step in self.turn_steps(record,turn)):
                state,reason='waiting','scope_confirmation'
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
            elif any(step.get('result') for step in self.tasks.record(tid,model_context=True)['steps']):
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
        if normal and state in ('completed','reviewing','waiting'):
            try:self.memories.enqueue(tid,turn)
            except Exception as error:
                try:self.tasks.emit(tid,'memory.unavailable',{'exception_type':type(error).__name__,
                    'code':error.detail.get('code') if isinstance(error,HTTPException) and isinstance(error.detail,dict) else None})
                except (sqlite3.OperationalError,MemoryError):pass
        try:record=self.tasks.record(tid,model_context=True)
        except (MemoryError,sqlite3.OperationalError):record=snapshot
        usage={name:record['budget'][name] if record else 0 for name in ('prompt_tokens','completion_tokens')}
        yield self.emit(tid,'done',{'usage':usage},persist=False)

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

    def method_problem(self,record,turn):
        return next((step['result'] for step in reversed(self.turn_steps(record,turn)) if step.get('result')
            and any(row['code']=='METHOD_RELEASE_CHANGED' for row in step['result']['diagnostics'])),None)

    def run_recipe(self,tid,turn,request,record):
        """User-selected finite steps run before any model request, with normal authority."""
        source=next((event['data'].get('recipe_source','human.message') for event in reversed(record['events'])
            if event['type']=='chat.message' and event['data'].get('turn_id')==turn and event['data'].get('role')=='user'),'human.message')
        self.tasks.emit(tid,'recipe.requested',{'turn_id':turn,**request,'source':source,'engineering_approval':False})
        arguments={'recipe':request['id'],'parameters':request['parameters']}
        pages=set();waiting=None
        while True:
            tools=self.registry.visible(self.tasks.record(tid,model_context=True))
            plan=compile_calls([{'id':'host-recipe-'+str(uuid4()),'name':'recipe_execute','arguments':arguments}],
                tools,record['workspace_id'],record['workspace_revision'])
            waiting=yield from self.execute_plan(tid,turn,plan,tools,record,source='host')
            current=self.tasks.record(tid,model_context=True)
            if request['id'] not in ('conclusion_summary','type_review','inbox_triage') or waiting:break
            result=current['steps'][-1].get('result')
            next_page=result['data'].get('next_page') if result and result['status']=='ok' else None
            if not next_page:break
            if request['id']=='inbox_triage' and len(pages)>=MAX_TRIAGE_PAGES-1:
                self.tasks.emit(tid,'recipe.pagination_stopped',{'turn_id':turn,'next_page':next_page,'reason':'page_limit',
                    'max_pages':MAX_TRIAGE_PAGES})
                break
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
        reused_nodes=set()
        recipes={node['input_identity'].get('recipe') for node in plan['nodes']} - {None}
        if recipes:self.tasks.emit(tid,'recipe.compiled',{'turn_id':turn,'revision':revision,'source':source,
            'recipes':sorted(recipes),'nodes':[{'id':node['id'],'tool':node['tool'],
                'recipe':node['input_identity'].get('recipe'),'bindings':node.get('bindings',{})} for node in plan['nodes']],
            'engineering_approval':False})
        self.tasks.emit(tid,'chat.message',{'role':'assistant','content':None,'turn_id':turn,'source':source,**({'reasoning_content':reasoning} if reasoning else {}),
            'tool_calls':[{'id':node['id'],'name':node['tool'],'arguments':node['arguments']} for node in plan['nodes']]})
        for index,node in enumerate(plan['nodes']):
            if soft_limit and task_progress(self.tasks.record(tid,model_context=True),tools)['consecutive_unproductive_reads']>=task['limits']['max_read_tool_calls']:
                self.tasks.emit(tid,'plan.read_limit',{'turn_id':turn,'revision':revision,'executed':False,
                    'reason':'evidence_stalled','skipped_node_ids':[row['id'] for row in plan['nodes'][index:]]})
                break
            tool=tools.get(node['tool'])
            if node['input_identity'].get('recipe'):
                outcomes={step['node_id']:step for step in self.tasks.record(tid,model_context=True)['steps']}
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
                        actions=['读取原诊断并修正输入，或补充所缺证据；已有结果可直接引用。']) if prior
                else failure(**node['preparation_error']) if node.get('preparation_error')
                else ToolResult.model_validate(reused['result']) if reused else self.broker.execute(task,node,tool))
            if prior:self.tasks.emit(tid,'tool.diagnostic_reused',{'turn_id':turn,'node_id':node['id'],'source_operation_id':prior['operation_id']})
            if reused:self.tasks.emit(tid,'tool.result_reused',{'turn_id':turn,'node_id':node['id'],
                'source_operation_id':reused['operation_id'],'source_run_id':reused['run_id'],'executed':False})
            if reused:reused_nodes.add(node['id'])
            result=redact(result.model_dump(mode='json'));self.tasks.finish_step(tid,operation,result,(perf_counter()-started)*1000)
            snapshot['steps'].append({'result':compress_result(result),'operation_id':operation,'turn_id':turn,
                'node_id':node['id'],'tool':node['tool'],'state':'succeeded' if result['status']=='ok' else 'failed'})
            yield self.emit(tid,'tool.result',{'id':node['id'],'status':result['status'],'summary':result['summary'],
                'next_actions':result['next_actions'],**({'diagnostics':result['diagnostics']} if result['diagnostics'] else {})})
            if result['data'].get('proposal'):yield self.emit(tid,'proposal.created',result['data']['proposal'],persist=False)
            codes={row['code'] for row in result['diagnostics']}
            if 'DIAGNOSTIC_ALREADY_REPORTED' in codes:raise HTTPException(422,{'code':'DIAGNOSTIC_ALREADY_REPORTED','message':'重复动作已停止；请按原诊断修正输入。'})
            if 'HUMAN_EXECUTION_REQUIRED' in codes:return 'scope_confirmation'
            if 'METHOD_RELEASE_CHANGED' in codes:
                self.tasks.emit(tid,'plan.blocked',{'turn_id':turn,'revision':revision,'reason':'method_release_changed',
                    'skipped_node_ids':[row['id'] for row in plan['nodes'][index+1:]],'retry_requires_human':True})
                return 'missing_input'
            if result['status']=='error' and self.repeated_error(tid,node,result)>=task['limits']['max_repair_attempts']:
                raise HTTPException(422,{'code':'REPAIR_LIMIT_EXCEEDED','message':'同一错误已达到修正次数上限，请人工补充输入或能力；没有无限重试。'})
        if recipes and source=='model':
            current=self.tasks.record(tid,model_context=True)
            completed={step['node_id']:step for step in current['steps'] if step.get('result')}
            recipe_steps=[completed[node['id']] for node in plan['nodes'] if node['id'] in completed
                and node['input_identity'].get('recipe')]
            if len(recipe_steps)==sum(bool(node['input_identity'].get('recipe')) for node in plan['nodes']):
                self.tasks.emit(tid,'recipe.finished',{'turn_id':turn,'source':'model','ids':sorted(recipes),
                    'remaining_pages':[step['result']['data']['next_page'] for step in recipe_steps if step['result']['data'].get('next_page')],
                    'status':'needs_action' if any(step['result']['status']=='error' for step in recipe_steps) else 'completed',
                    'source_node_ids':[step['node_id'] for step in recipe_steps],
                    'all_results_reused':all(step['node_id'] in reused_nodes for step in recipe_steps),'engineering_approval':False})

    def respond(self,tid,turn,text,*,safe=False,phase='answer',attempt=0,suffix='',reasoning=''):
        record=self.tasks.record(tid,model_context=True)
        metadata={'task_plan','platform_capabilities','platform_prepare'}
        observations=[step['result'] for step in record['steps'] if step.get('result') and step['tool'] not in metadata]
        current=[step['result'] for step in self.turn_steps(record,turn) if step.get('result') and step['tool'] not in metadata]
        baseline=self.baseline_problem(record,turn)
        if baseline:observations=current  # Earlier previews cannot prove a new comparison that was stopped.
        text=redact(text).strip() or '未取得可用解释，请根据工具诊断补充输入；当前请求尚未完成。'
        if not safe:
            proof=[]
            try:text=grounded_text(text,observations,current=current,proposals=[] if baseline else record['proposals'],
                users=[message['content'] for message in record['messages'] if message['role']=='user'],proof=proof)
            except HTTPException as error:
                self.tasks.emit(tid,'answer.rejected',redact({'turn_id':turn,'phase':phase,'attempt':attempt,
                    'draft':text,'issues':error.detail['issues'],**({'reasoning_content':reasoning} if reasoning else {})}))
                raise
            self.tasks.emit(tid,'answer.accepted',{'turn_id':turn,'phase':phase,'attempt':attempt,'matches':proof})
        if baseline and not ('工作台' in text and '重算' in text):
            text+='\n'+baseline['summary']+'\n下一步：'+'；'.join(baseline['next_actions'])
        text+=suffix
        progress=task_progress(record,self.registry.visible(record))
        self.tasks.emit(tid,'task.progress',{'turn_id':turn,**progress})
        pending=[goal['description'] for goal in progress['goals'] if goal['status']=='pending']
        if pending:text+='\n尚未取得完整证据的目标：'+'；'.join(pending)+'。请补充对应资料或按工具诊断在工作台处理。'
        # The model's explanation is verified first. Exact saved reasons and
        # human-only actions come from the host, not unverified model claims.
        checklist,known_refs,triage=inbox_report(self.turn_steps(record,turn))
        if checklist:
            text+='\n\n'+checklist
            self.tasks.emit(tid,'inbox.triaged',{'turn_id':turn,**triage,'source':'host',
                'model_explanation_verified':not safe})
        object_refs=self.object_refs(tid,text,record)
        for card in known_refs:
            if not any((ref['kind'],ref['id'])==(card['kind'],card['id']) for ref in object_refs):object_refs.append(card)
        # Host references include ambiguous names whose identities were saved in
        # the list; order them by the first actual mention just like model refs.
        object_refs.sort(key=lambda card:text.find('“'+card['name']+'”') if '“'+card['name']+'”' in text else text.find(card['id']) if card['id'] in text else len(text))
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
        record=self.tasks.record(tid,model_context=True);limit=record['budget']['limits']['max_repair_attempts']
        for attempt in range(limit+1):
            if text is not None:
                try:
                    yield from self.respond(tid,turn,text,phase='repair' if attempt else 'answer',attempt=attempt,reasoning=reasoning)
                    return
                except HTTPException as error:
                    yield self.emit(tid,'error',{'code':error.detail['code'],'message':error.detail['message']})
            record=self.model_record(tid)
            feedback=next(event['data'] for event in reversed(record['events']) if event['type']=='answer.rejected' and event['data']['turn_id']==turn)
            if attempt==limit:break
            # Same-unit alternatives do not prove that the requested field was
            # read (thermal resistance is not soil thermal resistivity). Let the
            # model either correct the draft or acquire the missing read evidence.
            needs_evidence=any(issue['code'].startswith('UNGROUNDED') for issue in feedback['issues'])
            visible=self.registry.visible(record)
            recovery_tools={name:tool for name,tool in visible.items() if tool.kind=='read' and name!='task_plan'} if needs_evidence else {}
            progress=task_progress(record,visible)
            if self.method_problem(record,turn) or progress['consecutive_unproductive_reads']>=record['budget']['limits']['max_read_tool_calls']:recovery_tools={}
            shown=self.remaining_preflights(tid,record,recovery_tools,self.turn_steps(record,turn))
            prompt,definitions=prepare(record,shown,closing=None if recovery_tools else '只重写被拦的解释，不执行任何业务动作。',
                feedback=feedback,instructions=self.settings.instructions(),progress=progress)
            _,model=self.model.status();metrics={**request_summary(model,prompt,definitions),'phase':'repair'}
            with self.research.store.db() as db:task=self.tasks.load(db,tid)
            reason=self.tasks.closing_reason(task,metrics['prompt_bytes'],metrics['definition_bytes'],repair=True)
            if reason:break
            self.tasks.emit(tid,'answer.repair',{'turn_id':turn,'attempt':attempt+1,'feedback':compress_result({
                'status':'error','summary':'根据核验问题补取只读证据或重写解释','data':{'issues':feedback['issues']}}),
                'read_tools_allowed':bool(recovery_tools),'engineering_writes_allowed':False})
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
                if not recovery_tools or any(call['name'] not in recovery_tools for call in reply.tool_calls):
                    self.tasks.emit(tid,'answer.repair_rejected',{'turn_id':turn,'attempt':attempt+1,'code':'TOOLS_NOT_ALLOWED'})
                    break
                plan=compile_calls(reply.tool_calls,recovery_tools,record['workspace_id'],record['workspace_revision'])
                yield from self.execute_plan(tid,turn,plan,recovery_tools,record,reasoning=reply.reasoning,source='model',soft_limit=True)
                text=None
                continue
            text,reasoning=reply.text,reply.reasoning
        yield from self.closing(tid,turn,'解释修正次数或可用预算已到上限。')

    def fallback(self,tid,turn):
        record=self.tasks.record(tid,model_context=True)
        method_block=self.method_problem(record,turn)
        if method_block:
            self.tasks.emit(tid,'answer.diagnostic',{'turn_id':turn,'model_explanation_verified':False,
                'code':'METHOD_RELEASE_CHANGED','diagnostics':method_block['diagnostics']})
            yield from self.respond(tid,turn,method_block['summary']+'\n下一步：'+'；'.join(method_block['next_actions']),safe=True)
            return
        if any(step['tool']=='inbox_read' for step in self.turn_steps(record,turn)):
            self.tasks.emit(tid,'answer.fallback',{'turn_id':turn,'sources':['inbox_read'],
                'model_explanation_verified':False})
            yield from self.respond(tid,turn,'以下为工具证据摘要，模型解释未通过核验。\n模型解释暂不可用；由宿主根据本次读取的统一待办列出原因和人工下一步。',safe=True)
            return
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
        record=self.model_record(tid)
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
        record=self.tasks.record(tid,model_context=True)
        began=next(event['created'] for event in reversed(record['events']) if event['type']=='chat.message' and event['data'].get('role')=='user')
        return sum(step['tool']==node['tool'] and step['arguments_digest']==node['arguments_digest']
            and [(item['code'],item.get('path')) for item in step['result']['diagnostics']]==signature
            for step in record['steps'] if step.get('result') and step['result']['status']=='error' and step['created']>=began)

    def previous_error(self,tid,node):
        record=self.tasks.record(tid,model_context=True)
        began=next(event['created'] for event in reversed(record['events'])
            if event['type']=='chat.message' and event['data'].get('role')=='user')
        physical=lambda identity:{key:value for key,value in identity.items() if key not in ('recipe','recipe_version','recipe_step')}
        return next((step for step in reversed(record['steps']) if step.get('result')
            and step['result']['status']=='error' and step['created']>=began
            and step['tool']==node['tool'] and step['arguments_digest']==node['arguments_digest']
            and physical(step['input_identity'])==physical(node['input_identity'])),None)

    def previous_read(self,tid,node):
        if node['tool'] not in ('run_read','workspace_read','study_read','study_preflight'):return None
        if node['tool']=='study_preflight' and not node['input_identity'].get('verified_preflight_methods'):return None
        def view(args,identity):
            if node['tool']=='study_preflight':return {'study_id':identity.get('study_id'),'module':args.get('module')}
            return {key:args[key] for key in ('run_id','case_id','entity','key','input_paths') if args.get(key) is not None} if node['tool']=='run_read' else args
        physical=lambda identity:{key:value for key,value in identity.items() if key not in ('recipe','recipe_version','recipe_step')}
        record=self.tasks.record(tid,model_context=True)
        began=next(event['created'] for event in reversed(record['events']) if event['type']=='chat.message' and event['data'].get('role')=='user')
        found=next((step for step in reversed(record['steps']) if step['tool']==node['tool']
            and step['state']=='succeeded' and step.get('result') and view(step['arguments'],step['input_identity'])==view(node['arguments'],node['input_identity'])
            and (node['tool']=='run_read' or step['created']>=began)
            and physical(step['input_identity'])==physical(node['input_identity'])),None)
        if found:
            with self.tasks.db() as db:found['result']=json.loads(db.execute('SELECT result FROM agent_steps WHERE operation_id=?',
                (found['operation_id'],)).fetchone()[0])
        return found

    def remaining_preflights(self,tid,record,tools,current):
        """Hide only already-verified scopes, retaining other studies/modules."""
        tool=tools.get('study_preflight')
        if tool is None:return tools
        completed={((step.get('input_identity') or {}).get('study_id'),step['arguments'].get('module')):step
            for step in current if step['tool']=='study_preflight' and step['state']=='succeeded'
            and step.get('result') and (step.get('input_identity') or {}).get('verified_preflight_methods')}
        if not completed:return tools
        with self.tasks.db() as db:task=self.tasks.load(db,tid)
        from backend.plugin_host import PluginHostError
        excluded=[];confirmed=[]
        for (sid,module),step in completed.items():
            node={'tool':'study_preflight','arguments':{'study_id':sid,'module':module},'input_identity':step['input_identity']}
            try:node['input_identity']=self.broker.identity(task,node,tool)
            except (HTTPException,PluginHostError):continue
            if self.previous_read(tid,node) is None:continue
            properties={'study_id':{'enum':[sid,None] if sid==record['study_id'] else [sid]},'module':{'const':module}}
            required=([] if sid==record['study_id'] else ['study_id'])+([] if module is None else ['module'])
            excluded.append({'properties':properties,'required':required})
            confirmed.append({'study_id':sid,'module':module,'source_operation_id':step['operation_id']})
        if not excluded:return tools
        parameters={**tool.parameters,'not':{'anyOf':excluded}}
        self.tasks.emit(tid,'preflight.scopes_satisfied',{'scopes':confirmed,
            'excluded_scopes':excluded,'input_and_seals_rechecked':True})
        result={**tools,'study_preflight':replace(tool,parameters=parameters,
            description=tool.description+' 已成功且输入和封签未变化的预检范围已从参数中排除，直接引用已有回执；其他研究和模块仍可检查。')}
        # The missing-input recipe expands to this same preflight. Excluding
        # only the direct tool leaves a second path to the identical operation.
        # Keep the recipe usable for any other study/module, with defaults
        # resolved in exactly the same way as the direct call.
        recipe=tools.get('recipe_execute')
        if recipe:
            nested=[{'properties':{'recipe':{'const':'missing_inputs'},'parameters':scope},
                'required':['recipe','parameters']} for scope in excluded]
            result['recipe_execute']=replace(recipe,parameters={**recipe.parameters,'not':{'anyOf':nested}},
                description=recipe.description+' 已完成的缺项预检范围已从参数中排除；引用现有回执或检查其他研究和模块。')
        return result

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
