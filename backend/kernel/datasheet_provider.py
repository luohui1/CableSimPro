"""Host-only bounded external transport. Offline extraction plugins never hold keys."""
from hashlib import sha256
import json
import os
from time import monotonic
from urllib.parse import urlsplit
import httpx
from fastapi import HTTPException

def failure(code,message,status=502):
 raise HTTPException(status,{'code':code,'message':message})

def configuration():
 # An explicitly configured compatible provider remains supported during migration.
 generic=bool(os.environ.get('CABLESIM_DATASHEET_BASE_URL'))
 base=os.environ.get('CABLESIM_DATASHEET_BASE_URL','https://api.mistral.ai/v1').rstrip('/')
 url=urlsplit(base)
 valid=bool(url.scheme in ('https','http') and url.hostname and not (url.username or url.password or url.query or url.fragment) and (url.scheme=='https' or url.hostname in ('127.0.0.1','localhost')))
 key_name='CABLESIM_DATASHEET_API_KEY' if generic else 'MISTRAL_API_KEY'
 model=os.environ.get('CABLESIM_DATASHEET_MODEL','' if generic else 'mistral-medium-2604')
 return {'service':os.environ.get('CABLESIM_DATASHEET_SERVICE',(url.hostname or '未配置') if generic else 'Mistral'),
  'endpoint':base+'/chat/completions' if valid else '', 'provider_model':model,
  'ocr_endpoint':base+'/ocr' if valid and not generic else None,
  'ocr_model':os.environ.get('CABLESIM_DATASHEET_OCR_MODEL','mistral-ocr-4-1') if not generic else None,
  'available':bool(valid and model and os.environ.get(key_name)),
  '_credential_fingerprint':sha256(os.environ.get(key_name,'').encode()).hexdigest()}

def request(provider,body,request_id,*,ocr=False,transport=None):
 key_name='MISTRAL_API_KEY' if provider.get('ocr_endpoint') else 'CABLESIM_DATASHEET_API_KEY'
 key=os.environ.get(key_name,'')
 if sha256(key.encode()).hexdigest()!=provider['_credential_fingerprint']:
  failure('OUTBOUND_DISCLOSURE_CHANGED','服务凭据已更换，未外发；请重新确认。',409)
 endpoint=provider.get('ocr_endpoint') if ocr else provider['endpoint']
 if not endpoint:failure('OCR_PROVIDER_UNSUPPORTED','此提供方未声明 OCR 接口；请配置并确认 Mistral OCR。',503)
 started=monotonic()
 try:
  with httpx.Client(timeout=httpx.Timeout(120,connect=15),transport=transport,follow_redirects=False) as client:
   with client.stream('POST',endpoint,headers={'Authorization':'Bearer '+key,'Idempotency-Key':request_id},json=body) as response:
    if response.is_redirect:failure('PROVIDER_REDIRECT_REJECTED','外发服务重定向；已拒绝新地址。')
    if response.status_code>=400:failure('PROVIDER_HTTP_ERROR','外发服务返回 HTTP '+str(response.status_code)+'；原件保留。')
    raw=bytearray()
    for chunk in response.iter_bytes():
     raw.extend(chunk)
     if len(raw)>4*1024*1024:failure('PROVIDER_OUTPUT_LIMIT','提供方结果超过 4 MiB，已拒绝。')
  result=json.loads(raw)
  if not isinstance(result,dict):raise ValueError('response object')
  usage=result.get('usage_info' if ocr else 'usage',{})
  if not isinstance(usage,dict):raise ValueError('usage')
  telemetry={'operation':'ocr' if ocr else 'extraction','requested_model':body['model'],
   'returned_model':result.get('model',body['model']),'elapsed_seconds':monotonic()-started,
   'prompt_tokens':int(usage.get('prompt_tokens',0)),'completion_tokens':int(usage.get('completion_tokens',0)),
   'pages':int(usage.get('pages_processed',len(result.get('pages',[])) if ocr else 0)),
   'response_sha256':sha256(raw).hexdigest()}
  if response.headers.get('X-CableSim-Provider-Seconds'):
   telemetry['service_seconds']=float(response.headers['X-CableSim-Provider-Seconds'])
  if any(telemetry[k]<0 for k in ('prompt_tokens','completion_tokens','pages')):raise ValueError('usage')
  return result,telemetry
 except httpx.TimeoutException:failure('PROVIDER_TIMEOUT','外发服务超时；原件和历史保留，未自动重试。',504)
 except httpx.RequestError:failure('PROVIDER_DISCONNECTED','外发服务连接中断；请检查网络，原件保留。',503)
 except (ValueError,KeyError,TypeError):failure('PROVIDER_RESPONSE_INVALID','提供方响应格式不符，未生成候选。')

def completion(provider,prompt,request_id,transport=None):
 body={'model':provider['provider_model'],'messages':[{'role':'user','content':prompt}],
  'temperature':0,'max_tokens':6000,'response_format':{'type':'json_object'}}
 response,telemetry=request(provider,body,request_id,transport=transport)
 try:
  content=response['choices'][0]['message']['content']
  if isinstance(content,list):content=''.join(x.get('text','') for x in content if x.get('type')=='text')
  if not isinstance(content,str):raise TypeError()
  return content,telemetry
 except (KeyError,IndexError,TypeError):failure('PROVIDER_RESPONSE_INVALID','提供方未返回字段提取文本。')
