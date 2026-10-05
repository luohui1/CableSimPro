"""Reproducible factual extraction evaluation; original PDFs remain outside Git.

python scripts/evaluate_datasheets.py --sources .data/datasheet-import/sources
The labels are selected numeric facts, not copied catalogues or fabricated PDFs.
"""
import argparse,base64,json,sys,importlib.util,platform
from time import monotonic
from hashlib import sha256
from pathlib import Path
from math import isclose
from importlib.metadata import version,PackageNotFoundError
import os,time,httpx

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def offline_runtime():
 """Cache identity includes runtime and shipped weights, not just parser code."""
 packages={}
 for name in ('rapidocr','onnxruntime'):
  try:packages[name]=version(name)
  except PackageNotFoundError:packages[name]=None
 spec=importlib.util.find_spec('rapidocr')
 models={p.name:sha256(p.read_bytes()).hexdigest() for p in (Path(spec.origin).parent/'models').glob('*.onnx')} if spec else {}
 return {'packages':packages,'models':models}

class PublicCorpusRelay(httpx.BaseTransport):
 """Optional SSH file relay when compute nodes lack Internet egress.

 Only public evaluation requests are allowed. Authorization headers are never
 serialized. Parsing, model grounding and timing remain in the Slurm allocation.
 """
 def __init__(self,directory):self.directory=Path(directory);self.directory.mkdir(parents=True,exist_ok=True)
 def handle_request(self,request):
  if request.url.host!='api.mistral.ai' or request.url.scheme!='https' or request.url.path not in ('/v1/ocr','/v1/chat/completions'):raise httpx.ConnectError('Relay target refused',request=request)
  identifier=sha256((request.headers.get('Idempotency-Key','')+str(request.url)).encode()).hexdigest()
  pending=self.directory/(identifier+'.request.json');completed=self.directory/(identifier+'.response.json')
  value={'url':str(request.url),'body':json.loads(request.read()),'request_id':request.headers.get('Idempotency-Key'),'public_manufacturer_evaluation':True}
  partial=pending.with_suffix('.part');partial.write_text(json.dumps(value),'utf8');partial.replace(pending)
  deadline=monotonic()+180
  while monotonic()<deadline:
   if completed.exists():
    response=json.loads(completed.read_text('utf8'));return httpx.Response(response['status_code'],json=response['body'],headers={'X-CableSim-Provider-Seconds':str(response['provider_seconds'])},request=request)
   time.sleep(.25)
  raise httpx.ReadTimeout('Public evaluation relay timed out',request=request)

def score(labels,predictions):
 truth=labels['truth'];eligible=[p for p in predictions if not p.get('ambiguities')]
 # Repeated corroborating evidence is one prediction; conflicting candidates
 # remain separately reported as abstentions and never counted as correct.
 unique={(p['field'],p['value_si'],p['unit_si']):p for p in eligible}
 tp=0;unit_errors=0;row_errors=0;wrong=[]
 for field,value,unit in unique:
  expected=truth.get(field)
  if expected and unit==expected['unit_si'] and isclose(value,expected['value_si'],rel_tol=1e-9,abs_tol=1e-12):tp+=1
  else:
   if expected and (unit!=expected['unit_si'] or any(isclose(value,expected['value_si']*factor,rel_tol=1e-9) for factor in (1e-6,1e-3,1e3,1e6))):unit_errors+=1
   elif expected and any(isclose(value,x,rel_tol=1e-9) for x in labels.get('other_model_values',{}).get(field,[])):row_errors+=1
   wrong.append({'field':field,'value_si':value,'unit_si':unit})
 return {'true_positive':tp,'predicted':len(unique),'truth':len(truth),'precision':tp/len(unique) if unique else None,'recall':tp/len(truth),'unit_errors':unit_errors,'model_row_errors':row_errors,'ambiguous_candidates':len(predictions)-len(eligible),'wrong':wrong}

def evaluate(sources,labels,output,strategies=('rules',),public_outbound_confirmed=False,retry_failed=False):
 if any(s not in ('rules','offline_ocr') for s in strategies) and not public_outbound_confirmed:raise ValueError('Public manufacturer corpus outbound confirmation is required; user uploads use /api/documents/disclosures.')
 parser_path=ROOT/'plugins/cablesim.datasheet-extract/src/cablesim_datasheet_extract/main.py'
 spec=importlib.util.spec_from_file_location('datasheet_evaluation_parser',parser_path);parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
 from backend.kernel.datasheets import Documents
 from backend.kernel.datasheet_contracts import ExtractionResult
 host=Documents.__new__(Documents);host.transport=PublicCorpusRelay(os.environ['CABLESIM_EVALUATION_RELAY_DIR']) if public_outbound_confirmed and os.environ.get('CABLESIM_EVALUATION_RELAY_DIR') else None
 provider=host.provider();rows={s:[] for s in strategies};outputs=[];runtime=offline_runtime()
 output.parent.mkdir(parents=True,exist_ok=True)
 cached={x['sample_id']+'-'+x['strategy']:x for x in json.loads(output.read_text('utf8')).get('outputs',[])} if output.exists() else {}
 for record in labels['samples']:
  path=sources/record['file']
  if not path.is_file():raise FileNotFoundError('Missing real manufacturer source: '+str(path))
  raw=path.read_bytes()
  if sha256(raw).hexdigest()!=record['sha256']:raise ValueError('Manufacturer source SHA mismatch: '+record['file'])
  params={'model':record['model'],'selections':record['selections']};document={'schema_version':'cablesim.datasheet/1','sha256':record['sha256'],'pdf_base64':base64.b64encode(raw).decode()}
  negatives={field:[other['truth'][field]['value_si'] for other in labels['samples'] if other['file']==record['file'] and other['id']!=record['id'] and field in other['truth'] and other['truth'][field]['value_si']!=expected['value_si']] for field,expected in record['truth'].items()}
  for strategy in strategies:
   started=monotonic();key=record['id']+'-'+strategy;calls=[];error=None
   cache_identity=sha256(json.dumps([record,strategy,sha256(parser_path.read_bytes()).hexdigest(),runtime,{k:v for k,v in provider.items() if not k.startswith('_')}],sort_keys=True).encode()).hexdigest()
   old=cached.get(key)
   if old and old.get('cache_identity')==cache_identity and not (retry_failed and old.get('error')):
    artifact=old['artifact'];calls=artifact.get('provider_calls',[]);elapsed=old['elapsed_seconds'];error=old.get('error')
   else:
    try:
     if strategy in ('rules','offline_ocr'):artifact=parser.operation(document,{**params,'method':strategy},'rules')
     else:
      if not provider['available']:raise ValueError('PROVIDER_NOT_CONFIGURED')
      selected={**params,'method':strategy,'ocr':strategy=='ocr'};payload=parser.operation(document,selected,'provider-request')
      reply,calls,evidence=host.call_provider(provider,payload,key+'-'+cache_identity[:16])
      artifact=parser.operation(document,{**selected,'response':reply,'ocr_evidence':evidence},'provider-response')
      artifact.update(provider_calls=calls,ocr_evidence=evidence,strategy=strategy)
     ExtractionResult.model_validate(artifact)
    except Exception as exc:
     detail=getattr(exc,'detail',{})
     error={'code':detail.get('code','EVALUATION_FAILED') if isinstance(detail,dict) else 'EVALUATION_FAILED','type':type(exc).__name__}
     calls=detail.get('provider_calls',calls) if isinstance(detail,dict) else calls
     artifact={'candidates':[],'issues':[error],'provider_calls':calls,'ocr_evidence':detail.get('ocr_evidence',[]) if isinstance(detail,dict) else []}
    elapsed=monotonic()-started
   metrics=score({**record,'other_model_values':negatives},artifact['candidates'])
   abstentions=record.get('expected_abstentions',{})
   metrics['ambiguity_failures']=sum(any(c['field']==f and not c.get('ambiguities') for c in artifact['candidates']) for f in abstentions)
   metrics['ungrounded_discarded']=sum(i.get('code')=='PROVIDER_UNGROUNDED_CANDIDATE' for i in artifact.get('issues',[]))
   cost=None if error else sum(c['prompt_tokens']*1.5e-6+c['completion_tokens']*7.5e-6+c['pages']*.004 for c in calls)
   rows[strategy].append({'sample_id':record['id'],'file':record['file'],'manufacturer':record['manufacturer'],'elapsed_seconds':elapsed,'estimated_usd':cost,'error':error,**metrics})
   outputs.append({'sample_id':record['id'],'strategy':strategy,'cache_identity':cache_identity,'artifact':artifact,'artifact_sha256':sha256(json.dumps(artifact,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'method_version':parser.VERSION,'elapsed_seconds':elapsed,'error':error})
   report={'schema':'cablesim.datasheet-evaluation/2','label_sha256':sha256(json.dumps(labels,sort_keys=True).encode()).hexdigest(),'source_documents':len({r['sha256'] for r in labels['samples']}),'models':len(labels['samples']),'parser_sha256':sha256(parser_path.read_bytes()).hexdigest(),'public_outbound_confirmed':public_outbound_confirmed,'configuration':{k:v for k,v in provider.items() if not k.startswith('_')},'environment':{'python':platform.python_version(),'slurm_job_id':__import__('os').environ.get('SLURM_JOB_ID')},'price_basis':{'url':'https://docs.mistral.ai/inference/pricing','date':'2026-10-04','usd_per_million_input':1.5,'usd_per_million_output':7.5,'usd_per_ocr_page':.004,'type':'published-standard-list-price-estimate; no cache discount; not an invoice'},'outputs':outputs}
   report.update(offline_runtime=runtime,complete=len(outputs)==len(labels['samples'])*len(strategies),expected_samples=len(labels['samples'])*len(strategies),completed_samples=len(outputs))
   for s,items in rows.items():
    totals={k:sum(r[k] for r in items) for k in ('true_positive','predicted','truth','unit_errors','model_row_errors','ambiguous_candidates','ambiguity_failures','ungrounded_discarded','elapsed_seconds')}
    totals['estimated_usd']=sum(r['estimated_usd'] for r in items if r['estimated_usd'] is not None) if any(r['estimated_usd'] is not None for r in items) else None
    totals.update(precision=totals['true_positive']/totals['predicted'] if totals['predicted'] else None,recall=totals['true_positive']/totals['truth'] if totals['truth'] else None,failed_samples=sum(bool(r['error']) for r in items))
    if items and totals['failed_samples']==len(items):totals.update(status='not_evaluated',precision=None,recall=None)
    else:totals['status']='partial' if totals['failed_samples'] else 'evaluated'
    report[s]={'rows':items,'totals':totals}
   output.write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf8')
   print(json.dumps({'sample_id':record['id'],'strategy':strategy,'elapsed_seconds':elapsed,'cost_usd':cost,'error':error,'tp':metrics['true_positive']},ensure_ascii=False),flush=True)
 return report

def prepare_public_batch(sources,labels,output):
 parser_path=ROOT/'plugins/cablesim.datasheet-extract/src/cablesim_datasheet_extract/main.py'
 spec=importlib.util.spec_from_file_location('datasheet_batch_parser',parser_path);parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
 requests=[]
 for record in labels['samples']:
  raw=(sources/record['file']).read_bytes()
  if sha256(raw).hexdigest()!=record['sha256']:raise ValueError('Source SHA mismatch')
  document={'schema_version':'cablesim.datasheet/1','sha256':record['sha256'],'pdf_base64':base64.b64encode(raw).decode()}
  for strategy in ('llm','hybrid'):
   payload=parser.operation(document,{'model':record['model'],'selections':record['selections'],'method':strategy},'provider-request')
   if payload['images']:raise ValueError('Scanned pages require OCR before text batch preparation')
   requests.append({'custom_id':record['id']+'-'+strategy,'body':{'messages':[{'role':'user','content':payload['prompt']}],'temperature':0,'max_tokens':6000,'response_format':{'type':'json_object'}}})
 output.write_text(json.dumps({'model':'mistral-medium-2604','endpoint':'/v1/chat/completions','requests':requests,'metadata':{'purpose':'public-manufacturer-evaluation','label_sha256':sha256(json.dumps(labels,sort_keys=True).encode()).hexdigest(),'parser_sha256':sha256(parser_path.read_bytes()).hexdigest()}},ensure_ascii=False),'utf8')
 print(json.dumps({'prepared_requests':len(requests),'public_manufacturer_corpus':True}),flush=True)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--sources',type=Path,default=ROOT/'.data/datasheet-import/sources');parser.add_argument('--labels',type=Path,default=ROOT/'plugins/cablesim.datasheet-extract/validation/labels.json');parser.add_argument('--output',type=Path,default=ROOT/'.data/datasheet-import/evaluation.json');parser.add_argument('--strategies',nargs='+',choices=['rules','offline_ocr','llm','hybrid','ocr'],default=['rules']);parser.add_argument('--public-corpus-outbound-confirmed',action='store_true');parser.add_argument('--retry-failed',action='store_true',help='Explicitly retry failed saved samples; never automatically repeat paid calls.');parser.add_argument('--prepare-public-batch',action='store_true');parser.add_argument('--sample',action='append',help='Explicit labeled sample IDs for separately reported OCR smoke runs.');args=parser.parse_args()
 labels=json.loads(args.labels.read_text('utf-8'))
 if args.sample:
  selected=[r for r in labels['samples'] if r['id'] in args.sample]
  if len(selected)!=len(set(args.sample)):parser.error('Unknown or duplicate sample ID.')
  labels={**labels,'samples':selected}
 if args.prepare_public_batch:
  if not args.public_corpus_outbound_confirmed:parser.error('Confirm the public manufacturer corpus outbound scope.')
  prepare_public_batch(args.sources,labels,args.output)
 else:evaluate(args.sources,labels,args.output,tuple(args.strategies),args.public_corpus_outbound_confirmed,args.retry_failed)
