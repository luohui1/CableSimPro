"""Immutable originals, extraction coordination and human-reviewed version proposals.

The offline plugin owns parsing/conversion/provider prompts and result grounding.
The host owns storage, scoped outbound consent, transport, history and approval.
"""
import base64
from contextlib import nullcontext
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from hashlib import sha256
import json
from uuid import uuid4
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from . import candidates
from .workspace import fingerprint,stamp
from .datasheet_contracts import (DocumentResponse,PageResponse,ExtractionScope,DisclosureResponse,
 ExtractionRequest,ExtractionResponse,ReviewRequest,ProposalRequest,ProposalResponse,ApprovalRequest,
 ExtractionComparisonRequest,ExtractionComparisonResponse,DocumentErrorResponse,InputFieldErrorResponse,
 BatchProposalRequest,BatchProposalResponse)
from backend.plugin_host import Executor,PluginHostError
from backend.plugin_host.registry import Registry
from . import datasheet_provider

PLUGIN='cablesim.datasheet-extract'
MAX_BYTES=64*1024*1024

def fail(code,message,status=422):raise HTTPException(status,{'code':code,'message':message})
def encoded(value):return json.dumps(value,ensure_ascii=False,allow_nan=False)

class Documents:
 def __init__(self,store,executor=None,transport=None):
  self.store=store;self.executor=executor or Executor();self.transport=transport
  self.pool=ThreadPoolExecutor(max_workers=2,thread_name_prefix='datasheet')
  self.epoch=str(uuid4())
 def initialize(self):
  with self.store.db(True) as db:
   db.execute('CREATE TABLE IF NOT EXISTS source_documents(id TEXT PRIMARY KEY,name TEXT,sha256 TEXT UNIQUE,original BLOB,metadata TEXT,created TEXT)')
   db.execute('CREATE TABLE IF NOT EXISTS document_extractions(id TEXT PRIMARY KEY,document TEXT,request_id TEXT,request_digest TEXT,payload TEXT,status TEXT,result TEXT,result_digest TEXT,error TEXT,revision INTEGER,reviews TEXT,epoch TEXT,created TEXT,UNIQUE(document,request_id))')
   db.execute('CREATE TABLE IF NOT EXISTS document_disclosures(id TEXT PRIMARY KEY,document TEXT,payload TEXT,digest TEXT)')
   db.execute('CREATE TABLE IF NOT EXISTS document_proposals(id TEXT PRIMARY KEY,document TEXT,payload TEXT,digest TEXT,status TEXT,new_model TEXT,approval TEXT)')
   db.execute('CREATE TABLE IF NOT EXISTS document_actions(scope TEXT,request_id TEXT,digest TEXT,result TEXT,PRIMARY KEY(scope,request_id))')
   db.execute('CREATE TABLE IF NOT EXISTS document_batches(id TEXT PRIMARY KEY,document TEXT,payload TEXT,digest TEXT,status TEXT,approval TEXT)')
   db.execute("UPDATE document_extractions SET status='interrupted',error=? WHERE status IN ('accepted','running')",(encoded({'code':'HOST_INTERRUPTED','message':'宿主重启，原件和候选历史保留；请明确重新发起提取。'}),))
 def close(self):self.pool.shutdown(wait=True,cancel_futures=False)
 def original(self,did):
  with self.store.db() as db:row=db.execute('SELECT * FROM source_documents WHERE id=?',(did,)).fetchone()
  if not row:fail('DOCUMENT_NOT_FOUND','原件不存在。',404)
  raw=bytes(row['original'])
  if sha256(raw).hexdigest()!=row['sha256']:fail('DOCUMENT_CORRUPT','原件哈希不一致，已阻止继续使用。',409)
  metadata=json.loads(row['metadata'])
  if metadata.get('sha256')!=row['sha256']:fail('DOCUMENT_CORRUPT','原件元数据不一致。',409)
  return metadata,{'schema_version':'cablesim.datasheet/1','pdf_base64':base64.b64encode(raw).decode(),'sha256':row['sha256']},raw
 def method(self,capability):
  plugin=Registry(self.executor.registry.root,plugin_id=PLUGIN).get(PLUGIN);plugin.verify()
  return plugin.manifest,{'plugin_id':PLUGIN,'capability':capability,'version':plugin.manifest.version,'release_digest':sha256((plugin.directory/'plugin.json').read_bytes()).hexdigest()}
 def invoke(self,document,parameters,capability):
  manifest,_=self.method(capability)
  output=self.executor.run(PLUGIN,capability,[{'case_id':'document','input':document,'parameters':parameters}],expected_manifest=manifest)
  case=output.cases[0]
  if case.status!='succeeded':
   error=case.error or {'code':'EXTRACTION_FAILED','message':'提取失败，原件保留。'}
   fail(error['code'],error['message'])
  return case.artifacts['x-cablesim.datasheet'],case.artifact_digests['x-cablesim.datasheet']
 def upload(self,name,raw):
  if not 1<=len(raw)<=MAX_BYTES:fail('DOCUMENT_SIZE_LIMIT','PDF 须为 1 字节至 64 MiB；请拆分厂家原件。',413)
  digest=sha256(raw).hexdigest()
  with self.store.db() as db:prior=db.execute('SELECT id FROM source_documents WHERE sha256=?',(digest,)).fetchone()
  if prior:return self.original(prior['id'])[0]
  document={'schema_version':'cablesim.datasheet/1','pdf_base64':base64.b64encode(raw).decode(),'sha256':digest}
  parsed,_=self.invoke(document,{},'inspect')
  result={'id':str(uuid4()),'name':name[:200],'sha256':digest,'size_bytes':len(raw),'page_count':parsed['page_count'],'pages':parsed['pages'],'created':stamp()}
  with self.store.db(True) as db:
   prior=db.execute('SELECT id FROM source_documents WHERE sha256=?',(digest,)).fetchone()
   if prior:return self.original(prior['id'])[0]
   if db.execute('SELECT COUNT(*) FROM source_documents').fetchone()[0]>=200:fail('DOCUMENT_COUNT_LIMIT','资料库已达 200 份，请整理原件。',409)
   db.execute('INSERT INTO source_documents VALUES(?,?,?,?,?,?)',(result['id'],result['name'],digest,raw,encoded(result),result['created']))
  return result
 def list(self):
  with self.store.db() as db:return [json.loads(r['metadata']) for r in db.execute('SELECT metadata FROM source_documents ORDER BY created DESC')]
 def page(self,did,number,render=False):
  _,document,_=self.original(did);result,_=self.invoke(document,{'page':number,'render':render},'page');return result
 @staticmethod
 def provider():
  return datasheet_provider.configuration()
 def provider_input(self,did,scope):
  _,document,_=self.original(did)
  params=scope.model_dump(mode='json');params['ocr']=scope.method=='ocr'
  return self.invoke(document,params,'provider-request')[0]
 def disclose(self,did,scope):
  if scope.method in ('rules','offline_ocr'):fail('OUTBOUND_NOT_REQUIRED','规则和离线 OCR 在本地执行，无需外发确认。')
  meta,_,_=self.original(did);payload=self.provider_input(did,scope)
  value={'document_sha256':meta['sha256'],'scope':scope.model_dump(mode='json'),**self.provider(),
         'payload_sha256':fingerprint(payload),'content_kind':'selected_text_and_images' if payload['images'] and scope.method!='ocr' else 'selected_page_images' if payload['images'] else 'selected_text_tables'}
  digest=fingerprint(value);identifier=str(uuid4())
  with self.store.db(True) as db:
   db.execute('INSERT INTO document_disclosures VALUES(?,?,?,?)',(identifier,did,encoded(value),digest))
  return {'id':identifier,**{k:v for k,v in value.items() if k!='_credential_fingerprint'},'disclosure_sha256':digest}
 def accept(self,did,body):
  meta,_,_=self.original(did);request=body.model_dump(mode='json');identity=fingerprint(request)
  scope=ExtractionScope(method=body.method,model=body.model,selections=body.selections)
  _,method=self.method('rules' if body.method in ('rules','offline_ocr') else 'provider-response')
  with self.store.db(True) as db:
   old=db.execute('SELECT id,request_digest FROM document_extractions WHERE document=? AND request_id=?',(did,str(body.request_id))).fetchone()
   if old:
    if old['request_digest']!=identity:fail('REQUEST_CONFLICT','同一 request_id 已用于不同提取输入。',409)
    return self.get(did,old['id'])
   if body.method not in ('rules','offline_ocr'):
    disclosure=db.execute('SELECT * FROM document_disclosures WHERE id=? AND document=?',(body.disclosure_id,did)).fetchone()
    if not disclosure or body.outbound_confirmed is not True or disclosure['digest']!=body.disclosure_sha256:fail('OUTBOUND_CONFIRMATION_REQUIRED','请先查看服务名称、地址及选定片段，并明确确认外发。',409)
    saved=json.loads(disclosure['payload'])
    provider=self.provider()
    if saved['scope']!=scope.model_dump(mode='json') or saved['document_sha256']!=meta['sha256'] or any(saved.get(k)!=v for k,v in provider.items()):
     fail('OUTBOUND_DISCLOSURE_CHANGED','原件、片段或外发服务已变化，请重新查看并确认。',409)
    if not saved['available']:fail('PROVIDER_NOT_CONFIGURED','设置厂家提取服务 URL、模型与环境变量密钥后再发起。',503)
   if db.execute("SELECT COUNT(*) FROM document_extractions WHERE status IN ('accepted','running')").fetchone()[0]>=8:fail('EXTRACTION_QUEUE_FULL','提取队列已满，已保存原件；请等当前任务完成。',429)
   eid=str(uuid4());saved={'request':request,'method':method,'document_sha256':meta['sha256']}
   saved['payload_sha256']=fingerprint(saved)
   db.execute('INSERT INTO document_extractions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(eid,did,str(body.request_id),identity,encoded(saved),'accepted',None,None,None,0,'[]',self.epoch,stamp()))
  self.pool.submit(self.finish,did,eid)
  return self.get(did,eid)
 def finish(self,did,eid):
  with self.store.db(True) as db:
   changed=db.execute("UPDATE document_extractions SET status='running' WHERE id=? AND epoch=? AND status='accepted'",(eid,self.epoch)).rowcount
  if not changed:return
  try:
   record=self.get(did,eid);request=record['request'];_,document,_=self.original(did)
   if self.method(record['method']['capability'])[1]!=record['method']:fail('RELEASE_CHANGED','提取插件发行已变化；保留原件，请使用新请求重新提取。',409)
   scope=ExtractionScope.model_validate({k:request[k] for k in ('method','model','selections')});params=scope.model_dump(mode='json')
   if scope.method in ('rules','offline_ocr'):result,result_digest=self.invoke(document,params,'rules')
   else:
    payload=self.provider_input(did,scope)
    with self.store.db() as db:disclosure=db.execute('SELECT payload FROM document_disclosures WHERE id=?',(request['disclosure_id'],)).fetchone()
    saved=json.loads(disclosure['payload'])
    provider=self.provider()
    if fingerprint(payload)!=saved['payload_sha256'] or any(provider[k]!=saved[k] for k in provider):fail('OUTBOUND_DISCLOSURE_CHANGED','选定内容或服务变化，未外发；请重新确认。',409)
    reply,calls,ocr_evidence=self.call_provider(provider,payload,eid)
    params.update(response=reply,ocr_evidence=ocr_evidence)
    result,result_digest=self.invoke(document,params,'provider-response')
    result.update(provider_calls=calls,ocr_evidence=ocr_evidence,strategy=scope.method)
   # Structural wire validation before persisting any suggestion.
   from .datasheet_contracts import ExtractionResult
   result=ExtractionResult.model_validate(result).model_dump(mode='json',by_alias=True)
   with self.store.db(True) as db:db.execute("UPDATE document_extractions SET status='succeeded',result=?,result_digest=? WHERE id=? AND epoch=? AND status='running'",(encoded(result),fingerprint(result),eid,self.epoch))
  except Exception as error:
   detail=error.detail if isinstance(error,HTTPException) and isinstance(error.detail,dict) else {'code':getattr(error,'code','EXTRACTION_FAILED'),'message':'提取失败，原件和已保存核对记录保留；请核对环境后重新发起。'}
   partial=None
   if detail.get('provider_calls') or detail.get('ocr_evidence'):
    partial={'schema':'cablesim.datasheet-candidates/1','method':payload['rule_result']['method'],'model':request['model'],
     'candidates':payload['rule_result']['candidates'] if request['method']=='hybrid' else [],
     'issues':[{'code':detail['code'],'message':detail['message']}],'provider_calls':detail.get('provider_calls',[]),'ocr_evidence':detail.get('ocr_evidence',[]),'strategy':request['method']}
   safe_detail={k:v for k,v in detail.items() if k not in ('provider_calls','ocr_evidence')}
   with self.store.db(True) as db:db.execute("UPDATE document_extractions SET status='failed',error=?,result=?,result_digest=? WHERE id=? AND epoch=? AND status='running'",(encoded(safe_detail),encoded(partial) if partial else None,fingerprint(partial) if partial else None,eid,self.epoch))
 def call_provider(self,provider,payload,eid):
  progress={'calls':[],'evidence':[]}
  try:return self._call_provider(provider,payload,eid,progress)
  except HTTPException as error:
   if isinstance(error.detail,dict):error.detail.update(provider_calls=progress['calls'],ocr_evidence=progress['evidence'])
   raise
 def _call_provider(self,provider,payload,eid,progress):
  calls=progress['calls'];evidence=progress['evidence']
  if payload.get('skip_provider'):
   return '{"candidates":[],"issues":[]}',calls,evidence
  for image in payload['images']:
   response,telemetry=datasheet_provider.request(provider,{'model':provider['ocr_model'],
    'document':{'type':'image_url','image_url':'data:image/png;base64,'+image['png_base64']},
    'include_blocks':True,'confidence_scores_granularity':'block','table_format':'html'},eid+'-ocr-'+str(image['page']),ocr=True,transport=self.transport)
   calls.append(telemetry)
   if not isinstance(response.get('pages'),list) or len(response['pages'])!=1:fail('OCR_RESPONSE_INVALID','OCR 未返回所选图像的唯一页，已阻止字段提取。',502)
   recognized=response['pages'][0]
   if not recognized.get('blocks'):fail('OCR_EVIDENCE_MISSING','OCR 未返回带坐标的原文块，已阻止字段提取。',502)
   evidence.append({'page':image['page'],'original_sha256':payload['document_sha256'],'region_pt':image['region_pt'],'width_pt':image['width_pt'],'height_pt':image['height_pt'],
    'image_sha256':sha256(base64.b64decode(image['png_base64'])).hexdigest(),'ocr_model':telemetry['returned_model'],
    'response_sha256':telemetry['response_sha256'],'recognized':recognized})
  prompt=payload['prompt']
  if evidence:prompt+='; Separate OCR evidence (coordinates below are image pixels, convert using dimensions and region_pt): '+encoded(evidence)
  reply,telemetry=datasheet_provider.completion(provider,prompt,eid+'-extract',self.transport)
  calls.append(telemetry)
  return reply,calls,evidence
 def get(self,did,eid):
  self.original(did)
  with self.store.db() as db:row=db.execute('SELECT * FROM document_extractions WHERE id=? AND document=?',(eid,did)).fetchone()
  if not row:fail('EXTRACTION_NOT_FOUND','提取记录不存在。',404)
  saved=json.loads(row['payload']);result=json.loads(row['result']) if row['result'] else None
  if fingerprint(saved['request'])!=row['request_digest'] or (saved.get('payload_sha256') is not None and saved['payload_sha256']!=fingerprint({k:v for k,v in saved.items() if k!='payload_sha256'})):fail('EXTRACTION_CORRUPT','提取输入／发行快照摘要不符，已阻止继续使用。',409)
  if result and fingerprint(result)!=row['result_digest']:fail('EXTRACTION_CORRUPT','候选内容摘要不符，已阻止核对和应用。',409)
  return {'id':eid,'document_id':did,'document_sha256':saved['document_sha256'],'request_id':row['request_id'],'status':row['status'],'request':saved['request'],'method':saved['method'],'result':result,'result_sha256':row['result_digest'],'snapshot_integrity':'verified' if saved.get('payload_sha256') else 'unsealed','error':json.loads(row['error']) if row['error'] else None,'revision':row['revision'],'reviews':json.loads(row['reviews']),'created':row['created']}
 def history(self,did):
  self.original(did)
  with self.store.db() as db:ids=[r['id'] for r in db.execute('SELECT id FROM document_extractions WHERE document=? ORDER BY created DESC',(did,))]
  return [self.get(did,eid) for eid in ids]
 def compare(self,did,body):
  left,right=[self.get(did,eid) for eid in body.extraction_ids]
  if any(r['status']!='succeeded' for r in (left,right)):fail('EXTRACTION_NOT_READY','对比须选择两次成功的提取记录。',409)
  if any(left['request'][key]!=right['request'][key] for key in ('model','selections')):fail('COMPARISON_SCOPE_MISMATCH','请对比同一型号与完全相同页／片段。')
  rows=[]
  for field in sorted({c['field'] for r in (left,right) for c in r['result']['candidates']}):
   a=[c for c in left['result']['candidates'] if c['field']==field];b=[c for c in right['result']['candidates'] if c['field']==field]
   rows.append({'field':field,'left':a,'right':b,'agrees':{(c['value_si'],c['unit_si']) for c in a}=={(c['value_si'],c['unit_si']) for c in b}})
  return {'document_sha256':left['document_sha256'],'extraction_ids':body.extraction_ids,'methods':[r['method'] for r in (left,right)],'rows':rows}
 @staticmethod
 def replay(db,scope,body):
  old=db.execute('SELECT * FROM document_actions WHERE scope=? AND request_id=?',(scope,str(body.request_id))).fetchone()
  if old:
   if old['digest']!=fingerprint(body.model_dump(mode='json')):fail('REQUEST_CONFLICT','相同请求标识已用于其他操作。',409)
   return json.loads(old['result'])
 @staticmethod
 def remember(db,scope,body,result):db.execute('INSERT INTO document_actions VALUES(?,?,?,?)',(scope,str(body.request_id),fingerprint(body.model_dump(mode='json')),encoded(result)))
 def review(self,did,eid,body):
  record=self.get(did,eid)
  if record['status']!='succeeded':fail('EXTRACTION_NOT_READY','候选尚未成功，请查看提取状态。',409)
  originals={c['id']:c for c in record['result']['candidates']}
  if any(d.candidate_id not in originals for d in body.decisions):fail('CANDIDATE_NOT_FOUND','核对项不属于本次提取，请刷新候选。')
  edits=[{'field':originals[d.candidate_id]['field'],'value':d.value,'unit':d.unit} for d in body.decisions if d.action=='modify']
  normalized=self.invoke({'schema_version':'cablesim.datasheet/1'}, {'values':edits},'normalize')[0]['values'] if edits else []
  normalized=iter(normalized);reviews={r['candidate_id']:r for r in record['reviews']}
  for decision in body.decisions:
   item=decision.model_dump(mode='json');original=originals[item['candidate_id']]
   item.update(reviewer=body.reviewer,reviewed_at=stamp(),value_si=original['value_si'],unit_si=original['unit_si'])
   if item['action']=='modify':item.update(next(normalized))
   reviews[item['candidate_id']]=item
  with self.store.db(True) as db:
   prior=self.replay(db,eid+'/review',body)
   if prior:return prior
   current=db.execute('SELECT revision FROM document_extractions WHERE id=?',(eid,)).fetchone()
   if current['revision']!=body.expected_revision:fail('REVIEW_REVISION_CONFLICT','核对内容已变化，请刷新后继续。',409)
   db.execute('UPDATE document_extractions SET reviews=?,revision=revision+1 WHERE id=?',(encoded(list(reviews.values())),eid))
   result={**record,'reviews':list(reviews.values()),'revision':record['revision']+1};self.remember(db,eid+'/review',body,result)
  return result
 def propose(self,did,body,*,_db=None):
  record=self.get(did,body.extraction_id)
  if record['snapshot_integrity']!='verified':fail('EXTRACTION_UNSEALED','此历史开发记录没有输入封签；原件保留，请重新提取后生成提案。',409)
  if record['status']!='succeeded' or record['revision']!=body.expected_review_revision:fail('REVIEW_REVISION_CONFLICT','请核对当前成功候选及核对修订。',409)
  items={c['id']:c for c in record['result']['candidates']};decisions={r['candidate_id']:r for r in record['reviews']}
  if not items or set(items)!=set(decisions):fail('REVIEW_INCOMPLETE','请逐项接受、修改或拒绝全部候选后生成提案。')
  with nullcontext(_db) if _db is not None else self.store.db(True) as db:
   prior=self.replay(db,did+'/proposal',body)
   if prior:return prior
   if body.new_model is not None:
    identity=body.new_model.model_dump();reference=identity.pop('identity_reference');name=identity.pop('name')
    payload={'name':name,'version':body.version,'confirmed':False,'materials':[],
     'specification':{**identity,'values':{},'missing':['完整结构和材料物性需另行核对']},
     'sources':{'identity':{'kind':'user','reference':encoded({'document_id':did,'original_sha256':record['document_sha256'],'reference':reference,'selections':record['request']['selections']}),'reviewed':True}}}
    base={'digest':None}
   else:
    base=candidates.read(db,body.target_model_id)
    if base['digest']!=body.expected_model_sha256:fail('MODEL_REVISION_CONFLICT','目标型号摘要已变化，请重新选择准确版本。',409)
    payload=deepcopy(base['payload'])
    if body.version==payload['version']:fail('MODEL_VERSION_REQUIRED','请填写不同的新版本标签，原始型号不能覆盖。')
   spec=payload.get('specification')
   # Chosen identity must agree with target; nominal area compares the exact row
   # label after explicit human selection, not an inferred cable row.
   model=record['result']['model']
   from re import sub
   if body.new_model and sub(r'\s+','',spec['designation']).casefold()!=sub(r'\s+','',model['designation']).casefold():fail('MODEL_IDENTITY_MISMATCH','新型号系列须与选定的原文型号完全一致。')
   if spec and spec['designation'].lower() not in model['designation'].lower():fail('MODEL_IDENTITY_MISMATCH','选定型号与目标型号系列不符，请重新选择。')
   label=sub(r'\s+','',model['specification']).replace('×','x').lower()
   area=spec['area_m2'] if spec else payload['cable_type']['cores'][0]['conductor']['nominal_area']
   cores=spec['cores'] if spec else len(payload['cable_type']['cores'])
   expected=format(area*1e6,'g')
   if label not in (expected,str(cores)+'x'+expected):fail('MODEL_IDENTITY_MISMATCH','规格行与目标芯数／截面不符，请重新选择。')
   if not spec and model['designation'].lower() not in payload['name'].lower():fail('MODEL_IDENTITY_MISMATCH','型号名称与目标结构版本不符。')
   accepted={};changes=[]
   for cid,item in items.items():
    review=decisions[cid]
    if review['action']=='reject':continue
    field=item['field'];value=(review['value_si'],review['unit_si'])
    if field in accepted and accepted[field]!=value:fail('FIELD_CONFLICT','同一字段接受了不同值：'+field+'；请拒绝错误片段或修改。')
    accepted[field]=value
    source='datasheet/'+record['id']+'/'+cid
    reference=encoded({'document_id':did,'original_sha256':record['document_sha256'],'extraction_id':record['id'],'method':record['method'],'result_sha256':record['result_sha256'],'page':item['page'],'bbox_pt':item['bbox_pt'],'quote':item['quote'],'basis':item['basis'],'review':review,
     'evidence_source':item.get('evidence_source','original'),'evidence_sha256':item.get('evidence_sha256'),
     'extraction_origin':item.get('extraction_origin','rules'),'header_quote':item.get('header_quote'),'header_bbox_pt':item.get('header_bbox_pt'),
     'provider_models':[c['returned_model'] for c in record['result'].get('provider_calls',[])],
     'ocr_models':[{'model':e['ocr_model'],'models':e.get('models',{})} for e in record['result'].get('ocr_evidence',[]) if e['page']==item['page']]})
    changes.append({'field':field,'before':deepcopy(spec['values'].get(field)) if spec else None,'after':{'value':value[0],'unit':value[1],'basis':'engineer_given' if review['action']=='modify' else 'manufacturer','source':source},'candidate_id':cid})
    payload['sources'][source]={'kind':'user' if review['action']=='modify' else 'manufacturer','reference':reference,'reviewed':True}
    if spec:
     spec['values'][field]=changes[-1]['after']
     spec['missing']=[x for x in spec['missing'] if x!=field]
    else:
     self.bind_structural(payload,field,value,body.field_bindings.get(field,[]),source,changes[-1],item['basis'] if review['action']=='accept' else 'engineer_given')
   if not accepted:fail('NO_ACCEPTED_VALUES','没有接受的字段，请先核对候选。')
   payload['version']=body.version;payload['confirmed']=False
   if spec and not spec['missing']:spec['missing']=['完整结构和材料物性需另行核对']
   candidates.CableModelVersion.model_validate(payload)
   pid=str(uuid4());proposal={'id':pid,'document_id':did,'status':'proposed','target_model_id':body.target_model_id,'base_sha256':base['digest'],'draft':payload,'changes':changes,'new_model_id':None,'approval':None,'extraction_id':record['id'],'review_revision':record['revision'],'review_sha256':fingerprint(record['reviews'])}
   digest=fingerprint(proposal)
   db.execute('INSERT INTO document_proposals VALUES(?,?,?,?,?,?,?)',(pid,did,encoded(proposal),digest,'proposed',None,None))
   result={k:v for k,v in proposal.items() if k not in ('extraction_id','review_revision','review_sha256')};result['sha256']=digest
   self.remember(db,did+'/proposal',body,result)
  return result
 @staticmethod
 def bind_structural(payload,field,value,paths,source,change,basis='manufacturer'):
  import re
  roles={'insulation_thickness':'insulation','metallic_sheath_thickness':'metallic_sheath','conductor_screen_thickness':'conductor_screen','insulation_screen_thickness':'insulation_screen','inner_sheath_thickness':'bedding','oversheath_thickness':'oversheath'}
  if not paths or len(paths)>100 or len(set(paths))!=len(paths):fail('MODEL_BINDING_REQUIRED',field+'：请选择准确导体／层的目标字段；不能从外径推测完整层结构。')
  before=[]
  for path in paths:
   if not re.fullmatch(r'/cable_type/(?:cores/\d+/(?:conductor/(?:diameter|r20)|layers/\d+/thickness)|common_layers/\d+/thickness)',path):fail('MODEL_BINDING_INVALID',field+'：目标路径不属于允许的型号数量字段。')
   parts=path.strip('/').split('/');parent=payload
   try:
    for part in parts[:-1]:parent=parent[int(part)] if isinstance(parent,list) else parent[part]
    key=parts[-1]
    expected='ohm/m' if key=='r20' else 'm'
    if value[1]!=expected:raise ValueError('unit')
    if key=='diameter' and field!='conductor_diameter' or key=='r20' and field!='r20' or key=='thickness' and parent.get('role')!=roles.get(field):raise ValueError('role')
    before.append({'path':path,'value':parent.get(key)});parent[key]=value[0]
    if key=='r20':parent['r20_basis']='manufacturer_limit' if basis=='manufacturer_limit' else 'design'
    payload['sources'][path]=deepcopy(payload['sources'][source])
   except (KeyError,IndexError,TypeError,ValueError):fail('MODEL_BINDING_INVALID',field+'：目标对象、层角色或 SI 单位不一致，请重新选择。')
  change['before']=before;change['bindings']=paths
 def proposal(self,did,pid):
  self.original(did)
  with self.store.db() as db:row=db.execute('SELECT * FROM document_proposals WHERE id=? AND document=?',(pid,did)).fetchone()
  if not row:fail('PROPOSAL_NOT_FOUND','资料变更提案不存在。',404)
  payload=json.loads(row['payload'])
  if fingerprint(payload)!=row['digest']:fail('PROPOSAL_CORRUPT','提案摘要不一致，已阻止批准。',409)
  return {**{k:v for k,v in payload.items() if k not in ('extraction_id','review_revision','review_sha256')},'sha256':row['digest'],'status':row['status'],'new_model_id':row['new_model'],'approval':json.loads(row['approval']) if row['approval'] else None}
 def approve(self,did,pid,body,*,_db=None):
  proposal=self.proposal(did,pid)
  with nullcontext(_db) if _db is not None else self.store.db(True) as db:
   prior=self.replay(db,pid+'/approve',body)
   if prior:return prior
   if body.human_approved is not True or proposal['sha256']!=body.proposal_sha256:fail('APPROVAL_REQUIRED','请人工核对并明确批准当前摘要的提案。',409)
   if proposal['status']!='proposed':fail('PROPOSAL_ALREADY_APPROVED','提案已批准；请打开已保存的新版本。',409)
   row=db.execute('SELECT payload FROM document_proposals WHERE id=?',(pid,)).fetchone();saved=json.loads(row['payload'])
   extraction=self.get(did,saved['extraction_id'])
   if extraction['revision']!=saved['review_revision'] or fingerprint(extraction['reviews'])!=saved['review_sha256']:fail('PROPOSAL_REVIEW_CHANGED','核对记录已变化，请重新生成提案后批准。',409)
   if proposal['target_model_id'] is not None:
    base=candidates.read(db,proposal['target_model_id'])
    if base['digest']!=proposal['base_sha256']:fail('MODEL_REVISION_CONFLICT','原始型号摘要不符，已阻止批准。',409)
   payload=proposal['draft'];model=candidates.CableModelVersion.model_validate(payload)
   if any(json.loads(r['payload'])['name']==model.name and json.loads(r['payload'])['version']==model.version for r in db.execute('SELECT payload FROM domain_cable_models')):fail('MODEL_VERSION_EXISTS','相同型号版本已存在，请换用新的版本标签。',409)
   cid=str(uuid4());db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)',(cid,encoded(payload),fingerprint(payload),'incomplete' if model.specification else 'draft',stamp()))
   approval={'approver':body.approver,'approved_at':stamp(),'proposal_sha256':proposal['sha256'],'effect':'create_new_version_draft','authority':'local_human_operator'}
   db.execute("UPDATE document_proposals SET status='approved',new_model=?,approval=? WHERE id=? AND status='proposed'",(cid,encoded(approval),pid))
   result={**proposal,'status':'approved','new_model_id':cid,'approval':approval};self.remember(db,pid+'/approve',body,result)
  return result

 def batch_propose(self,did,body):
  with self.store.db(True) as db:
   prior=self.replay(db,did+'/batch-proposal',body)
   if prior:return prior
   proposals=[self.propose(did,item,_db=db) for item in body.items]
   identities=[(p['draft']['name'],p['draft']['version']) for p in proposals]
   if len(set(identities))!=len(identities):fail('BATCH_MODEL_DUPLICATE','同一批次不能重复生成相同型号版本。')
   bid=str(uuid4());payload={'id':bid,'document_id':did,'proposals':[{'id':p['id'],'sha256':p['sha256']} for p in proposals]}
   digest=fingerprint(payload)
   db.execute('INSERT INTO document_batches VALUES(?,?,?,?,?,?)',(bid,did,encoded(payload),digest,'proposed',None))
   result={**payload,'sha256':digest,'status':'proposed','proposals':proposals,'approval':None}
   self.remember(db,did+'/batch-proposal',body,result)
   return result

 def batch(self,did,bid):
  self.original(did)
  with self.store.db() as db:row=db.execute('SELECT * FROM document_batches WHERE id=? AND document=?',(bid,did)).fetchone()
  if row is None:fail('BATCH_NOT_FOUND','批量型号提案不存在。',404)
  payload=json.loads(row['payload'])
  if fingerprint(payload)!=row['digest']:fail('PROPOSAL_CORRUPT','批量提案摘要不一致。',409)
  proposals=[self.proposal(did,p['id']) for p in payload['proposals']]
  if any(p['sha256']!=saved['sha256'] for p,saved in zip(proposals,payload['proposals'])):fail('PROPOSAL_CORRUPT','单项提案与批量摘要不一致。',409)
  return {**payload,'sha256':row['digest'],'status':row['status'],'proposals':proposals,'approval':json.loads(row['approval']) if row['approval'] else None}

 def batch_approve(self,did,bid,body):
  batch=self.batch(did,bid)
  with self.store.db(True) as db:
   prior=self.replay(db,bid+'/batch-approve',body)
   if prior:return prior
   if body.proposal_sha256!=batch['sha256']:fail('APPROVAL_REQUIRED','请人工核对并批准当前整批摘要。',409)
   if batch['status']!='proposed':fail('PROPOSAL_ALREADY_APPROVED','批量提案已批准，请打开已保存型号。',409)
   proposals=[self.approve(did,p['id'],body.model_copy(update={'proposal_sha256':p['sha256']}),_db=db) for p in batch['proposals']]
   approval={'approver':body.approver,'approved_at':stamp(),'proposal_sha256':batch['sha256'],'effect':'create_new_version_drafts','authority':'local_human_operator'}
   db.execute("UPDATE document_batches SET status='approved',approval=? WHERE id=?",(encoded(approval),bid))
   result={**batch,'status':'approved','proposals':proposals,'approval':approval}
   self.remember(db,bid+'/batch-approve',body,result)
   return result

def make_router(documents):
 router=APIRouter(prefix='/api/documents',tags=['Manufacturer documents'])
 errors={422:{'model':DocumentErrorResponse|InputFieldErrorResponse,'description':'Specific field, PDF format, unit or review error.'},409:{'model':DocumentErrorResponse,'description':'Revision/idempotency/consent conflict.'},503:{'model':DocumentErrorResponse,'description':'Provider or plugin environment missing.'},404:{'model':DocumentErrorResponse,'description':'Original/run/proposal not found.'},502:{'model':DocumentErrorResponse,'description':'Provider/plugin result rejected.'},504:{'model':DocumentErrorResponse,'description':'Provider/plugin timeout; original preserved.'},429:{'model':DocumentErrorResponse,'description':'Extraction queue full; original preserved.'}}
 @router.post('',response_model=DocumentResponse,status_code=201,responses={**errors,413:{'description':'PDF exceeds 64 MiB.'}})
 async def upload(file:UploadFile=File(description='Original manufacturer PDF; <=64 MiB and <=500 pages. No automatic cloud upload.')):
  raw=await file.read(MAX_BYTES+1);return await run_in_threadpool(documents.upload,file.filename or 'manufacturer.pdf',raw)
 @router.get('',response_model=list[DocumentResponse])
 def catalogue():return documents.list()
 @router.get('/{did}',response_model=DocumentResponse,responses=errors)
 def detail(did:str):return documents.original(did)[0]
 @router.get('/{did}/file',response_class=Response,responses={200:{'content':{'application/pdf':{}},'description':'Exact original bytes with X-Original-SHA256 header.'},**errors})
 def original(did:str):
  metadata,_,raw=documents.original(did);return Response(raw,media_type='application/pdf',headers={'X-Original-SHA256':metadata['sha256'],'Content-Disposition':'inline; filename="original.pdf"'})
 @router.get('/{did}/pages/{page}',response_model=PageResponse,responses=errors)
 def page(did:str,page:int):return documents.page(did,page)
 @router.get('/{did}/pages/{page}/image',response_class=Response,responses={200:{'content':{'image/png':{}},'description':'Page PNG for source-coordinate review; original preserved.'},**errors})
 def image(did:str,page:int):return Response(base64.b64decode(documents.page(did,page,True)['png_base64']),media_type='image/png')
 @router.post('/{did}/disclosures',response_model=DisclosureResponse,responses=errors)
 def disclose(did:str,body:ExtractionScope):return documents.disclose(did,body)
 @router.post('/{did}/extractions',response_model=ExtractionResponse,status_code=202,responses=errors)
 def extract(did:str,body:ExtractionRequest,response:Response):
  result=documents.accept(did,body);response.headers['Location']=f"/api/documents/{did}/extractions/{result['id']}";response.headers['Retry-After']='2';return result
 @router.get('/{did}/extractions',response_model=list[ExtractionResponse],responses=errors)
 def history(did:str):return documents.history(did)
 @router.get('/{did}/extractions/{eid}',response_model=ExtractionResponse,responses=errors)
 def extraction(did:str,eid:str):return documents.get(did,eid)
 @router.post('/{did}/extractions/{eid}/reviews',response_model=ExtractionResponse,responses=errors)
 def review(did:str,eid:str,body:ReviewRequest):return documents.review(did,eid,body)
 @router.post('/{did}/proposals',response_model=ProposalResponse,status_code=201,responses=errors)
 def propose(did:str,body:ProposalRequest):return documents.propose(did,body)
 @router.post('/{did}/comparisons',response_model=ExtractionComparisonResponse,responses=errors)
 def compare(did:str,body:ExtractionComparisonRequest):return documents.compare(did,body)
 @router.get('/{did}/proposals/{pid}',response_model=ProposalResponse,responses=errors)
 def proposal(did:str,pid:str):return documents.proposal(did,pid)
 @router.post('/{did}/proposals/{pid}/approval',response_model=ProposalResponse,responses=errors)
 def approve(did:str,pid:str,body:ApprovalRequest):return documents.approve(did,pid,body)
 @router.post('/{did}/batches',response_model=BatchProposalResponse,status_code=201,responses=errors)
 def batch_propose(did:str,body:BatchProposalRequest):return documents.batch_propose(did,body)
 @router.get('/{did}/batches/{bid}',response_model=BatchProposalResponse,responses=errors)
 def batch(did:str,bid:str):return documents.batch(did,bid)
 @router.post('/{did}/batches/{bid}/approval',response_model=BatchProposalResponse,responses=errors)
 def batch_approve(did:str,bid:str,body:ApprovalRequest):return documents.batch_approve(did,bid,body)
 return router
