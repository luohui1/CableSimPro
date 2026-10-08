"""Bounded native conversation loop; the model never owns a business write path."""
import json
import re
import sqlite3
from dataclasses import replace
from time import perf_counter,time

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
from .recipes import recipe_schema
from .security import redact
from .task_store import TaskStore
from .tool_broker import ToolBroker,failure
from .tool_registry import ToolRegistry
from .resilience import category


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

    def begin(self,tid,content):
        self.tasks.record(tid)
        return self.tasks.begin_turn(tid,redact(content))

    def stream(self,tid,turn):
        normal=False
        state,reason='completed',None
        snapshot=None
        try:
            recovery=reconcile(self.research,self.tasks,tid,persist=True)
            if recovery['unknown']:
                raise HTTPException(409,{'code':'UNKNOWN_OPERATION','message':'原工具步骤结果未知；请先对账，未重新执行或提交作业。'})
            while True:
                record=self.tasks.record(tid)
                snapshot=record
                tools=self.registry.visible(record)
                user=next(message for message in reversed(record['messages']) if message['role']=='user')
                summary=bool(re.search(r'汇总|总结|概览|conclusion_summary',user['content']) and re.search(r'研究|结论|载流量|conclusion_summary',user['content'])
                    and not re.search(r'改成|修改|试算|细节|具体输入',user['content']))
                current=[step for step in record['steps'] if step['created']>=next(event['created'] for event in reversed(record['events'])
                    if event['type']=='chat.message' and event['data'].get('role')=='user')]
                digest=next((step['result']['data'] for step in reversed(current) if step['tool']=='project_digest'
                    and step.get('result') and step['result']['status']=='ok'),None)
                answer_only=summary and digest is not None and digest.get('next_page') is None
                shown={name:tool for name,tool in tools.items() if name in ('recipe_execute','project_digest')} if summary else tools
                if summary:
                    schema=recipe_schema();schema['properties']['recipe']['enum']=['conclusion_summary'];schema['oneOf']=schema['oneOf'][:1]
                    shown['recipe_execute']=replace(shown['recipe_execute'],parameters=schema)
                prompt,definitions=prepare(record,shown,self.registry.directory() if not summary else [],
                    closing='结论汇总证据已完整，直接回答各研究结论与限制因素。不得继续读取运行、研究或工程。' if answer_only else None,
                    instructions=self.settings.instructions())
                configured,model=self.model.status()
                if not configured:raise ModelError('LLM_NOT_CONFIGURED','模型未配置；请在宿主环境中配置模型地址、模型名与密钥。')
                metrics=request_summary(model,prompt,definitions)
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
                if answer_only:raise HTTPException(422,{'code':'SUMMARY_ALREADY_COMPLETE','message':'摘要已完整；本次只需解释保存证据，不再读取细节。'})
                plan=compile_calls(reply.tool_calls,shown,record['workspace_id'],record['workspace_revision'])
                with self.research.store.db() as db:task=self.tasks.load(db,tid)
                for node in plan['nodes']:
                    if summary and node['tool'] not in shown:
                        node['preparation_error']={'code':'SUMMARY_RECIPE_REQUIRED','message':'结论汇总只需 conclusion_summary；请直接读取完整摘要。'}
                    try:node['input_identity']=self.broker.identity(task,node,tools.get(node['tool']))
                    except HTTPException as error:
                        detail=error.detail
                        node['preparation_error']={'code':detail.get('code','INPUT_IDENTITY_INVALID') if isinstance(detail,dict) else 'INPUT_IDENTITY_INVALID',
                            'message':redact(str(detail))}
                revision=self.tasks.add_plan(tid,plan)
                recipes={node['input_identity'].get('recipe') for node in plan['nodes']} - {None}
                if recipes:self.tasks.emit(tid,'recipe.compiled',{'turn_id':turn,'revision':revision,
                    'recipes':sorted(recipes),'nodes':[{'id':node['id'],'tool':node['tool'],
                        'recipe':node['input_identity'].get('recipe'),'bindings':node.get('bindings',{})} for node in plan['nodes']],
                    'engineering_approval':False})
                self.tasks.emit(tid,'chat.message',{'role':'assistant','content':None,'turn_id':turn,**({'reasoning_content':reply.reasoning} if reply.reasoning else {}),
                    'tool_calls':[{'id':node['id'],'name':node['tool'],'arguments':node['arguments']} for node in plan['nodes']]})
                for node in plan['nodes']:
                    tool=tools.get(node['tool'])
                    if node['input_identity'].get('recipe'):
                        outcomes={step['node_id']:step for step in self.tasks.record(tid)['steps']}
                        dependencies=[outcomes.get(identifier) for identifier in node['depends_on']]
                        if any(step and step['state']!='succeeded' for step in dependencies):
                            node['preparation_error']={'code':'RECIPE_DEPENDENCY_FAILED',
                                'message':'配方前一步未成功，后续动作未执行；请先处理原诊断。'}
                        elif node.get('bindings'):
                            for field,binding in node['bindings'].items():
                                source=outcomes.get(binding['node_id'])
                                if not source or not source.get('result') or source['state']!='succeeded':
                                    node['preparation_error']={'code':'RECIPE_DEPENDENCY_FAILED','message':'配方输入证据未取得，后续动作未执行。'}
                                    break
                                node['arguments'][field]=value_at(source['result'],binding['path'])
                            node['arguments_digest']=fingerprint(node['arguments'])
                            node['input_identity']=self.broker.identity(task,node,tool)
                            self.tasks.emit(tid,'recipe.bound',{'turn_id':turn,'node_id':node['id'],
                                'bindings':node['bindings'],'arguments_digest':node['arguments_digest']})
                    # An identical failed action cannot learn anything by executing
                    # again. Retain its original diagnostic once and close this turn.
                    prior=self.previous_error(tid,node)
                    reused=self.previous_read(tid,node) if not prior and not node.get('preparation_error') else None
                    operation=self.tasks.issue(tid,turn,revision,node)
                    title=tool.title if tool else '未注册工具'
                    yield self.emit(tid,'tool.call',{'id':node['id'],'tool':node['tool'],'title':title,'arguments':node['arguments']})
                    self.tasks.running(tid,operation)
                    started=perf_counter()
                    result=(failure('DIAGNOSTIC_ALREADY_REPORTED','同一工具与输入的诊断已给出，未重复执行；请处理原缺项。',
                                actions=['读取原诊断并修正输入；结论汇总可直接使用 project_digest。']) if prior
                            else failure(**node['preparation_error']) if node.get('preparation_error')
                            else ToolResult.model_validate(reused['result']) if reused
                            else self.broker.execute(task,node,tool))
                    if prior:self.tasks.emit(tid,'tool.diagnostic_reused',{'turn_id':turn,'node_id':node['id'],
                        'source_operation_id':prior['operation_id']})
                    if reused:self.tasks.emit(tid,'tool.result_reused',{'turn_id':turn,'node_id':node['id'],
                        'source_operation_id':reused['operation_id'],'source_run_id':reused['run_id'],'executed':False})
                    result=redact(result.model_dump(mode='json'))
                    self.tasks.finish_step(tid,operation,result,(perf_counter()-started)*1000)
                    # Retain bounded evidence even if the next record allocation fails.
                    snapshot['steps'].append({'result':compress_result(result)})
                    yield self.emit(tid,'tool.result',{'id':node['id'],'status':result['status'],
                        'summary':result['summary'],'next_actions':result['next_actions']})
                    if result['data'].get('proposal'):
                        yield self.emit(tid,'proposal.created',result['data']['proposal'],persist=False)
                    codes={item['code'] for item in result['diagnostics']}
                    if 'DIAGNOSTIC_ALREADY_REPORTED' in codes:
                        raise HTTPException(422,{'code':'DIAGNOSTIC_ALREADY_REPORTED','message':'重复动作已停止；请按原诊断修正输入。'})
                    if 'HUMAN_EXECUTION_REQUIRED' in codes:
                        state,reason='waiting','scope_confirmation'
                        break
                    if result['status']=='error' and self.repeated_error(tid,node,result)>=task['limits']['max_repair_attempts']:
                        raise HTTPException(422,{'code':'REPAIR_LIMIT_EXCEEDED','message':'同一错误已达到修正次数上限，请人工补充输入或能力；没有无限重试。'})
                if state=='waiting':
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
            text,refs=evidence_summary(snapshot) if snapshot else ('以下为工具证据摘要，模型解释未通过核验。\n本次尚未取得可用工具证据；未推算工程结果。',[])
            try:
                self.tasks.emit(tid,'answer.fallback',{'turn_id':turn,'sources':refs,'model_explanation_verified':False,'reason':issue})
                self.tasks.emit(tid,'chat.message',{'role':'assistant','content':text,'turn_id':turn})
            except (MemoryError,sqlite3.OperationalError):pass
            for offset in range(0,len(text),64):yield self.emit(tid,'message.delta',{'text':text[offset:offset+64]},persist=False)
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

    def respond(self,tid,turn,text,*,safe=False,phase='answer',attempt=0,suffix='',reasoning=''):
        record=self.tasks.record(tid)
        observations=[step['result'] for step in record['steps'] if step.get('result')]
        began=next(event['created'] for event in record['events'] if event['type']=='chat.message' and event['data'].get('turn_id')==turn and event['data'].get('role')=='user')
        current=[step['result'] for step in record['steps'] if step.get('result') and step['created']>=began]
        text=redact(text).strip() or '未取得可用解释，请根据工具诊断补充输入；当前请求尚未完成。'
        if not safe:
            proof=[]
            try:text=grounded_text(text,observations,current=current,proposals=record['proposals'],
                users=[message['content'] for message in record['messages'] if message['role']=='user'],proof=proof)
            except HTTPException as error:
                self.tasks.emit(tid,'answer.rejected',redact({'turn_id':turn,'phase':phase,'attempt':attempt,
                    'draft':text,'issues':error.detail['issues']}))
                raise
            self.tasks.emit(tid,'answer.accepted',{'turn_id':turn,'phase':phase,'attempt':attempt,'matches':proof})
        text+=suffix
        self.tasks.emit(tid,'chat.message',{'role':'assistant','content':text,'turn_id':turn,**({'reasoning_content':reasoning} if reasoning else {})})
        for offset in range(0,len(text),64):yield self.emit(tid,'message.delta',{'text':text[offset:offset+64]})

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
