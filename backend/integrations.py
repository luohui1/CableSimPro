"""Server-only provider adapters. No API key or remote URL is accepted from documents."""
import base64
import json
import os
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException


def endpoint(value:str):
    parsed=urlparse(value)
    local=parsed.hostname in ('localhost','127.0.0.1','::1')
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise HTTPException(503,'服务端 API 地址格式无效。')
    if parsed.scheme != 'https' and not (parsed.scheme=='http' and local and os.getenv('CABLESIM_ALLOW_LOCAL_HTTP')=='1'):
        raise HTTPException(503,'API 必须使用 HTTPS；本机网关需显式启用 CABLESIM_ALLOW_LOCAL_HTTP。')
    return value.rstrip('/')


def agent_config():
    return {'protocol':os.getenv('CABLESIM_AGENT_PROTOCOL','responses'),
            'base_url':os.getenv('CABLESIM_AGENT_BASE_URL','https://api.openai.com/v1'),
            'key':os.getenv('CABLESIM_AGENT_API_KEY') or os.getenv('OPENAI_API_KEY',''),
            'model':os.getenv('CABLESIM_AGENT_MODEL','')}


def integration_status():
    a=agent_config(); provider=os.getenv('CABLESIM_OCR_PROVIDER','disabled')
    return {'agent':{'configured':bool(a['key'] and a['model']),'protocol':a['protocol'],'model':a['model'],
                     'host':urlparse(a['base_url']).hostname,'verified':False},
            'ocr':{'provider':provider,'configured':provider in ('mistral','gateway') and bool(os.getenv('CABLESIM_OCR_API_KEY')) and (provider=='mistral' or bool(os.getenv('CABLESIM_OCR_URL'))),
                   'model':os.getenv('CABLESIM_OCR_MODEL','mistral-ocr-latest' if provider=='mistral' else ''),
                   'host':urlparse(os.getenv('CABLESIM_OCR_URL','https://api.mistral.ai/v1/ocr' if provider=='mistral' else '')).hostname,
                   'verified':False},
            'note':'已配置不等于联通测试成功。密钥只读取服务端环境；本地 PDF 文字提取不调用云端。'}


async def request_json(url, key, payload):
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(55,connect=8),follow_redirects=False) as client:
            async with client.stream('POST',endpoint(url),headers={'Authorization':f'Bearer {key}'},json=payload) as response:
                if response.status_code != 200:
                    raise HTTPException(502,f'外部服务返回 HTTP {response.status_code}；未采用识别/模型结果。')
                parts=[];total=0
                async for part in response.aiter_bytes():
                    total+=len(part)
                    if total>4_000_000:
                        raise HTTPException(502,'服务返回超出 4 MB 限制。')
                    parts.append(part)
        return json.loads(b''.join(parts))
    except httpx.TimeoutException:
        raise HTTPException(504,'外部服务超时，未自动重试以避免重复计费。') from None
    except (httpx.HTTPError,ValueError,TypeError):
        raise HTTPException(502,'外部服务响应无效。请检查服务端协议配置。') from None


async def ocr_bytes(raw:bytes,mime:str,pages:list[int],consent:bool):
    config=integration_status()['ocr']
    if not config['configured']:
        raise HTTPException(503,'OCR 尚未配置：设置 CABLESIM_OCR_PROVIDER、CABLESIM_OCR_API_KEY 及相应接口地址。')
    if not consent:
        raise HTTPException(403,'需同意将原始文件发送到 OCR 服务；即使只选部分页，服务仍会收到完整文件。')
    provider=config['provider']; encoded=base64.b64encode(raw).decode()
    if provider=='mistral':
        kind='document_url' if mime=='application/pdf' else 'image_url'
        payload={'model':config['model'],'document':{'type':kind,kind:f'data:{mime};base64,{encoded}'},'include_image_base64':False}
        if mime=='application/pdf':payload['pages']=[p-1 for p in pages]
        url=os.getenv('CABLESIM_OCR_URL','https://api.mistral.ai/v1/ocr')
    else:
        payload={'schema_version':1,'mime_type':mime,'file_base64':encoded,'pages':pages}
        url=os.getenv('CABLESIM_OCR_URL','')
    result=await request_json(url,os.environ['CABLESIM_OCR_API_KEY'],payload)
    found={}
    try:
        for page in result['pages']:
            n=int(page['index'])+1 if provider=='mistral' else int(page['page'])
            text=page['markdown'] if provider=='mistral' else page['text']
            if n not in pages or n in found or not isinstance(text,str) or not text.strip() or len(text)>80000:
                raise ValueError()
            found[n]=text
        if set(found)!=set(pages):raise ValueError()
    except (ValueError,KeyError,TypeError):
        raise HTTPException(502,'OCR 页码、内容或返回结构不完整；保留已有文本，不采用本次结果。') from None
    return found


async def model_turn(messages:list,tools:list,instructions:str,consent:bool):
    c=agent_config()
    if not c['key'] or not c['model']:
        raise HTTPException(503,'Agent 尚未配置 API key 与模型 ID。')
    if not consent:raise HTTPException(403,'需明确同意向模型服务发送任务、工程参数及检索到的资料片段。')
    base=endpoint(c['base_url'])
    if c['protocol']=='responses':
        payload={'model':c['model'],'store':False,'instructions':instructions,'input':messages,
                 'tools':tools,'parallel_tool_calls':False,'max_output_tokens':2400}
        data=await request_json(base+'/responses',c['key'],payload)
        if data.get('status') not in (None,'completed'):raise HTTPException(502,'模型输出未完成。')
        calls=[x for x in data.get('output',[]) if x.get('type')=='function_call']
        text='\n'.join(p.get('text','') for x in data.get('output',[]) if x.get('type')=='message' for p in x.get('content',[]) if p.get('type')=='output_text')
    elif c['protocol']=='chat_completions':
        mapped=[{'role':'system','content':instructions}]
        for m in messages:
            # Tool observations are data, supplied by our broker, never executable client code.
            mapped.append({'role':'user','content':json.dumps(m,ensure_ascii=False)})
        data=await request_json(base+'/chat/completions',c['key'],{'model':c['model'],'messages':mapped,
             'tools':[{'type':'function','function':{k:v for k,v in t.items() if k!='type'}} for t in tools],
             'parallel_tool_calls':False,'max_tokens':2400})
        try:
            choice=data['choices'][0]
            if choice.get('finish_reason') not in ('stop','tool_calls'):raise ValueError()
            msg=choice['message'];text=msg.get('content') or ''
            calls=[{'name':t['function']['name'],'arguments':t['function']['arguments']} for t in msg.get('tool_calls',[])]
        except (KeyError,IndexError,TypeError,ValueError):raise HTTPException(502,'Chat Completions 协议响应无效。') from None
    else:raise HTTPException(503,'Agent 协议仅支持 responses / chat_completions。')
    if len(calls)>1:raise HTTPException(502,'单步只允许一个受限工具调用。')
    if calls:
        try:
            name=calls[0]['name'];args=json.loads(calls[0]['arguments'])
            if name not in {t['name'] for t in tools} or not isinstance(args,dict):raise ValueError()
        except (KeyError,TypeError,ValueError):raise HTTPException(502,'模型返回未授权工具或无效参数。') from None
        return {'tool':name,'arguments':args,'text':''}
    if not isinstance(text,str) or not text.strip():raise HTTPException(502,'模型没有返回有效文本或工具。')
    return {'tool':None,'arguments':{},'text':text[:12000]}
