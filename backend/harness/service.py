"""Bounded native conversation loop; the model never owns a business write path."""
import json
from time import perf_counter,time

from fastapi import HTTPException
from pydantic import TypeAdapter
from backend.kernel.workspace import stamp

from .contracts import StreamEvent
from .context_builder import request_summary,compress_result
from .evidence import grounded_text,reconcile
from .model_port import ModelError
from .planner import prepare
from .proposals import Proposals
from .providers import OpenAICompatibleProvider
from .recipe_compiler import compile_calls
from .security import redact
from .task_store import TaskStore
from .tool_broker import ToolBroker,failure
from .tool_registry import ToolRegistry


class Harness:
    def __init__(self,research,model=None,limits=None):
        self.research=research
        self.model=model or OpenAICompatibleProvider()
        self.tasks=TaskStore(research.store,research.owner_epoch,limits)
        self.registry=ToolRegistry(research)
        self.proposals=Proposals(research,self.tasks)
        self.broker=ToolBroker(research,self.tasks,self.registry,self.proposals)

    def initialize(self):
        self.tasks.initialize()

    def status(self):
        configured,model=self.model.status()
        return {'configured':configured,'model':model,'tools':len(self.registry.tools())}

    def tools(self):
        return [tool.info() for tool in self.registry.tools().values()]

    def create(self,body):
        wid=str(body.workspace_id);sid=str(body.study_id) if body.study_id else None
        with self.research.store.db() as db:
            row,_=self.research.store.load(db,wid)
            study=self.research.definition(db,wid,sid) if sid else None
        return {'id':self.tasks.create(wid,sid,row['revision'],study['revision'] if study else None)}

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
        try:
            recovery=reconcile(self.research,self.tasks,tid,persist=True)
            if recovery['unknown']:
                raise HTTPException(409,{'code':'UNKNOWN_OPERATION','message':'原工具步骤结果未知；请先对账，未重新执行或提交作业。'})
            while True:
                record=self.tasks.record(tid)
                tools=self.registry.visible(record)
                prompt,definitions=prepare(record,tools,self.registry.directory())
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
                except ModelError as error:
                    self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,{},
                        {'status':'error','code':error.code,'usage_available':False})
                    raise
                self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,reply.usage,
                    {'status':'ok','finish_reason':reply.finish_reason,'tool_names':[call['name'] for call in reply.tool_calls],
                     'usage_available':all(name in reply.usage for name in ('prompt_tokens','completion_tokens')),'text_received':bool(reply.text)})
                if not reply.tool_calls:
                    yield from self.respond(tid,turn,reply.text)
                    break
                plan=compile_calls(reply.tool_calls,tools,record['workspace_id'],record['workspace_revision'])
                with self.research.store.db() as db:task=self.tasks.load(db,tid)
                for node in plan['nodes']:
                    try:node['input_identity']=self.broker.identity(task,node,tools.get(node['tool']))
                    except HTTPException as error:
                        detail=error.detail
                        node['preparation_error']={'code':detail.get('code','INPUT_IDENTITY_INVALID') if isinstance(detail,dict) else 'INPUT_IDENTITY_INVALID',
                            'message':redact(str(detail))}
                revision=self.tasks.add_plan(tid,plan)
                self.tasks.emit(tid,'chat.message',{'role':'assistant','content':None,'turn_id':turn,
                    'tool_calls':[{'id':node['id'],'name':node['tool'],'arguments':node['arguments']} for node in plan['nodes']]})
                for node in plan['nodes']:
                    tool=tools.get(node['tool'])
                    operation=self.tasks.issue(tid,turn,revision,node)
                    title=tool.title if tool else '未注册工具'
                    yield self.emit(tid,'tool.call',{'id':node['id'],'tool':node['tool'],'title':title,'arguments':node['arguments']})
                    self.tasks.running(tid,operation)
                    started=perf_counter()
                    result=(failure(**node['preparation_error']) if node.get('preparation_error')
                            else self.broker.execute(task,node,tool))
                    result=redact(result.model_dump(mode='json'))
                    self.tasks.finish_step(tid,operation,result,(perf_counter()-started)*1000)
                    yield self.emit(tid,'tool.result',{'id':node['id'],'status':result['status'],
                        'summary':result['summary'],'next_actions':result['next_actions']})
                    if result['data'].get('proposal'):
                        yield self.emit(tid,'proposal.created',result['data']['proposal'],persist=False)
                    codes={item['code'] for item in result['diagnostics']}
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
                except ModelError as failure:
                    yield self.emit(tid,'error',{'code':failure.code,'message':failure.message})
                except HTTPException:
                    yield from self.respond(tid,turn,'已取得的工具证据保存在会话记录中。解释未通过证据核验；其余请求尚未完成，请核对工具诊断。',safe=True)
            normal=True
        except Exception as error:
            state,reason='failed',None
            self.tasks.emit(tid,'harness.error',{'exception_type':type(error).__name__,'details_recorded':False})
            yield self.emit(tid,'error',{'code':'HARNESS_FAILED','message':'Agent 运行层发生错误；已保留记录，未生成替代结果或自动重试。'})
            yield from self.respond(tid,turn,'处理发生错误，已保留取得的工具记录。当前请求尚未完成，请查看诊断后继续。',safe=True)
            normal=True
        finally:
            # Disconnecting the stream does not assert that a solver/job was cancelled.
            self.tasks.finish_turn(tid,turn,state if normal else 'waiting',reason if normal else 'capability')
        record=self.tasks.record(tid)
        yield self.emit(tid,'done',{'usage':{name:record['budget'][name] for name in ('prompt_tokens','completion_tokens')}})

    def respond(self,tid,turn,text,*,safe=False):
        record=self.tasks.record(tid)
        observations=[compress_result(step['result']) for step in record['steps'] if step.get('result')]
        began=next(event['created'] for event in record['events'] if event['type']=='chat.message' and event['data'].get('turn_id')==turn and event['data'].get('role')=='user')
        current=[compress_result(step['result']) for step in record['steps'] if step.get('result') and step['created']>=began]
        text=redact(text).strip() or '未取得可用解释，请根据工具诊断补充输入；当前请求尚未完成。'
        if not safe:text=grounded_text(text,observations,current=current,proposals=record['proposals'])
        self.tasks.emit(tid,'chat.message',{'role':'assistant','content':text,'turn_id':turn})
        for offset in range(0,len(text),64):yield self.emit(tid,'message.delta',{'text':text[offset:offset+64]})

    def closing(self,tid,turn,reason):
        record=self.tasks.record(tid)
        prompt,definitions=prepare(record,{},closing=reason)
        configured,model=self.model.status()
        if not configured:raise ModelError('LLM_NOT_CONFIGURED','模型未配置，无法发起收尾请求。')
        task=self.tasks.begin_model(tid,turn,request_summary(model,prompt,definitions),closing=True)
        timeout=min(task['limits']['model_timeout_s'],max(.001,(task['limits']['max_active_ms']-task['elapsed_ms'])/1000),max(.001,task['deadline']-time()))
        started=perf_counter()
        try:reply=self.model.reply(prompt,definitions,timeout)
        except ModelError as error:
            self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,{}, {'status':'error','code':error.code,'usage_available':False})
            raise
        self.tasks.model_finished(tid,turn,(perf_counter()-started)*1000,reply.usage,{'status':'ok','phase':'closing',
            'finish_reason':reply.finish_reason,'usage_available':all(key in reply.usage for key in ('prompt_tokens','completion_tokens'))})
        self.tasks.emit(tid,'budget.closing',{'turn_id':turn,'reason':reason,'tools_allowed':False,'remaining_goals_completed':False})
        try:
            if reply.tool_calls:raise HTTPException(422,'收尾请求不能调用工具。')
            yield from self.respond(tid,turn,reply.text+'\n尚未完成的请求：'+reason+'请据此核对工具记录后继续。')
        except HTTPException:
            yield from self.respond(tid,turn,'已取得的工具证据保存在会话记录中；模型解释未通过证据核验。尚未完成的请求：'+reason+'请核对诊断后继续。',safe=True)

    def repeated_error(self,tid,node,result):
        signature=[(item['code'],item.get('path')) for item in result['diagnostics']]
        record=self.tasks.record(tid)
        began=next(event['created'] for event in reversed(record['events']) if event['type']=='chat.message' and event['data'].get('role')=='user')
        return sum(step['tool']==node['tool'] and step['arguments_digest']==node['arguments_digest']
            and [(item['code'],item.get('path')) for item in step['result']['diagnostics']]==signature
            for step in record['steps'] if step.get('result') and step['result']['status']=='error' and step['created']>=began)

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
