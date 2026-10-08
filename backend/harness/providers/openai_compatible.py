"""OpenAI-compatible transport configured from saved settings or the host environment, with bounded response and tool calls."""
import json
import os
from time import perf_counter
from urllib.parse import urlsplit

import httpx

from ..model_port import ModelError, ModelReply
from ..security import redact


class OpenAICompatibleProvider:
    MAX_RESPONSE_BYTES = 1024*1024  # 回答、思维链与工具参数的正文
    MAX_STREAM_BYTES = 16*1024*1024  # 含 SSE 外壳的原始字节；思考模式每个词元一行，外壳远大于正文
    MAX_ARGUMENT_BYTES = 32*1024

    def __init__(self,settings=None):
        self.settings=settings

    def connection(self):
        if self.settings:return self.settings.resolve()
        env={name:os.environ.get('CABLESIM_LLM_'+name.upper(),'').strip() for name in ('base_url','model','api_key')}
        return {**env,'model':env['model'] or 'deepseek-flash','source':'environment' if all(env.values()) else 'none'}

    def status(self):
        current=self.connection()
        return current['source']!='none' and bool(current['base_url'] and current['model'] and current['api_key']),redact(current['model'])

    def probe(self,base,model,key,timeout_s=20.):
        """Smallest real request: confirms address, model name and key together; nothing is stored."""
        parsed=urlsplit(base)
        if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            return {'ok':False,'code':'LLM_BASE_INVALID','message':'服务地址须为 http(s) 开头、不含账号密码、查询串或片段的 API 基址。'}
        if not model or not key:
            return {'ok':False,'code':'LLM_NOT_CONFIGURED','message':'请先填写模型名与密钥。'}
        started=perf_counter()
        try:
            with httpx.Client(timeout=httpx.Timeout(timeout_s,connect=min(8.,timeout_s)),follow_redirects=False) as client:
                response=client.post(base.rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},
                    json={'model':model,'messages':[{'role':'user','content':'只回复“好”。'}],'max_tokens':8,'stream':False})
            elapsed=round((perf_counter()-started)*1000)
            if response.status_code in (401,403):return {'ok':False,'code':'LLM_AUTH_FAILED','message':'密钥不被接受（%d）。'%response.status_code,'latency_ms':elapsed}
            if response.status_code==404:return {'ok':False,'code':'LLM_NOT_FOUND','message':'服务地址或模型名不对（404）。','latency_ms':elapsed}
            if response.status_code!=200:
                reason=self.refusal(response)
                return {'ok':False,'code':'LLM_PROVIDER_ERROR','message':'模型服务拒绝了请求（%d）'%response.status_code+('：'+reason if reason else '。'),'latency_ms':elapsed}
            data=response.json()
            if not isinstance(data.get('choices'),list) or not data['choices']:
                return {'ok':False,'code':'LLM_RESPONSE_INVALID','message':'地址可达，但返回的不是 OpenAI 兼容的对话结果。','latency_ms':elapsed}
            return {'ok':True,'model':redact(str(data.get('model') or model))[:100],'latency_ms':elapsed}
        except httpx.TimeoutException:
            return {'ok':False,'code':'LLM_TIMEOUT','message':'%g 秒内没有响应；请检查网络、代理或服务状态。'%timeout_s}
        except httpx.HTTPError:
            return {'ok':False,'code':'LLM_CONNECTION_FAILED','message':'连不上服务地址；请检查网络、代理或地址拼写。'}
        except ValueError:
            return {'ok':False,'code':'LLM_RESPONSE_INVALID','message':'地址可达，但返回的不是 JSON 对话结果。'}

    def reply(self,messages,tools,timeout_s):
        configured,model = self.status()
        if not configured:
            raise ModelError('LLM_NOT_CONFIGURED','模型未配置；请在“设置 · AI 模型”里填写服务地址、模型名与密钥。')
        current=self.connection()
        base,key=current['base_url'],current['api_key']
        parsed=urlsplit(base)
        if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or len(model)>100:
            raise ModelError('LLM_CONFIGURATION_INVALID','模型配置不合法；地址须为无凭据、查询串或片段的 HTTP(S) API 基址。')
        if timeout_s<=0:raise ModelError('BUDGET_EXCEEDED','模型请求已无剩余时间预算。')
        # 思考模式下思维链也计入输出上限；2048 会在调用工具前被截断
        body={'model':model,'messages':messages,'stream':True,'stream_options':{'include_usage':True},'max_tokens':8192}
        if tools:body.update(tools=tools,tool_choice='auto',parallel_tool_calls=False)
        # No endpoint, header or credential enters model messages or audit payloads.
        started=perf_counter()
        chunks,thinking,calls,usage,finish=[],[],{}, {},None
        received=payload=0
        try:
            timeout=httpx.Timeout(timeout_s,connect=min(5.,timeout_s))
            with httpx.Client(timeout=timeout,follow_redirects=False) as client:
                with client.stream('POST',base.rstrip('/')+'/chat/completions',
                    headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},json=body) as response:
                    if response.status_code!=200:
                        code='LLM_AUTH_FAILED' if response.status_code in (401,403) else 'LLM_PROVIDER_ERROR'
                        reason=self.refusal(response)
                        raise ModelError(code,('模型服务认证失败（HTTP %d）' if code=='LLM_AUTH_FAILED' else '模型服务拒绝了请求（HTTP %d）')%response.status_code
                            +('：'+reason if reason else '。请核对模型配置或稍后重试。'))
                    if 'text/event-stream' not in response.headers.get('content-type',''):
                        raw=b''
                        for part in response.iter_bytes():
                            raw+=part
                            if len(raw)>self.MAX_RESPONSE_BYTES:raise ModelError('LLM_RESPONSE_TOO_LARGE','模型响应超过大小上限。')
                            if perf_counter()-started>timeout_s:raise ModelError('LLM_TIMEOUT','模型请求超过剩余时间预算。')
                        return self.parse_response(json.loads(raw))
                    for line in response.iter_lines():
                        received+=len(line.encode('utf-8'))
                        if received>self.MAX_STREAM_BYTES:raise ModelError('LLM_RESPONSE_TOO_LARGE','模型响应超过大小上限。')
                        if perf_counter()-started>timeout_s:raise ModelError('LLM_TIMEOUT','模型请求超过剩余时间预算。')
                        if not line.startswith('data:'):continue
                        raw=line[5:].strip()
                        if raw=='[DONE]':break
                        if not raw:continue
                        data=json.loads(raw)
                        if data.get('error'):raise ModelError('LLM_PROVIDER_ERROR','模型服务返回错误，未执行新工具。')
                        if data.get('usage'):usage=self.usage(data['usage'])
                        for choice in data.get('choices',[])[:1]:
                            delta=choice.get('delta',{})
                            payload+=sum(len(str(delta.get(name) or '').encode('utf-8')) for name in ('content','reasoning_content'))
                            if payload>self.MAX_RESPONSE_BYTES:raise ModelError('LLM_RESPONSE_TOO_LARGE','模型回答超过大小上限。')
                            if delta.get('reasoning_content'):
                                if not isinstance(delta['reasoning_content'],str):raise ValueError('reasoning text required')
                                thinking.append(delta['reasoning_content'])
                            if delta.get('content'):
                                if not isinstance(delta['content'],str):raise ValueError('text required')
                                chunks.append(delta['content'])
                            for call in delta.get('tool_calls',[]):
                                index=call.get('index',0)
                                current=calls.setdefault(index,{'id':'','name':'','arguments':''})
                                if call.get('id'):current['id']=call['id']
                                function=call.get('function',{})
                                current['name']+=function.get('name','')
                                current['arguments']+=function.get('arguments','')
                                if len(current['arguments'].encode())>self.MAX_ARGUMENT_BYTES:raise ValueError('arguments limit')
                            finish=choice.get('finish_reason') or finish
            if finish=='length':raise ModelError('LLM_OUTPUT_TRUNCATED','模型输出达到上限；未执行不完整的工具意图。')
            return ModelReply(redact(''.join(chunks)),self.calls([calls[index] for index in sorted(calls)]),usage,finish,redact(''.join(thinking)))
        except ModelError:
            raise
        except httpx.TimeoutException:
            raise ModelError('LLM_TIMEOUT','模型请求超时；未自动重试。') from None
        except httpx.HTTPError:
            raise ModelError('LLM_CONNECTION_FAILED','无法连接模型服务；请核对宿主网络与配置。') from None
        except (ValueError,TypeError,KeyError,AttributeError):
            raise ModelError('LLM_RESPONSE_INVALID','模型服务响应或工具参数格式不合法；未执行不完整意图。') from None

    @staticmethod
    def refusal(response):
        """The provider's own short reason (e.g. a 400 message), credentials hidden; never the request."""
        try:
            raw=b''
            for part in response.iter_bytes():
                raw+=part
                if len(raw)>4096:break
            text=raw[:4096].decode('utf-8','replace')
            try:
                error=json.loads(text).get('error')
                text=error.get('message') if isinstance(error,dict) else str(error or text)
            except (ValueError,AttributeError):
                pass
            return redact(' '.join(str(text).split()))[:240]
        except Exception:
            return ''

    @staticmethod
    def usage(value):
        return {name:value[name] for name in ('prompt_tokens','completion_tokens')
                if type(value.get(name)) is int and value[name]>=0}

    def calls(self,calls):
        if len(calls)>12:raise ModelError('LLM_RESPONSE_INVALID','单次模型请求返回过多工具意图。')
        result=[]
        for call in calls:
            raw=call['arguments']
            if not isinstance(raw,str) or len(raw.encode())>self.MAX_ARGUMENT_BYTES:raise ValueError('argument format')
            arguments=json.loads(raw or '{}')
            if not isinstance(arguments,dict) or not isinstance(call['id'],str) or not call['id'] or len(call['id'])>96:
                raise ValueError('tool call identity')
            result.append({'id':redact(call['id']),'name':redact(call['name']),'arguments':redact(arguments)})
        return result

    def parse_response(self,data):
        choice=data['choices'][0];message=choice['message']
        text=message.get('content') or ''
        if not isinstance(text,str):raise ValueError('text required')
        if choice.get('finish_reason')=='length':raise ModelError('LLM_OUTPUT_TRUNCATED','模型输出达到上限。')
        calls=[{'id':call['id'],'name':call['function']['name'],'arguments':call['function']['arguments']}
            for call in message.get('tool_calls',[])]
        reasoning=message.get('reasoning_content') or ''
        if not isinstance(reasoning,str):raise ValueError('reasoning text required')
        return ModelReply(redact(text),self.calls(calls),self.usage(data.get('usage') or {}),choice.get('finish_reason'),redact(reasoning))
