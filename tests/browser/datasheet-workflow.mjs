import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser} from '../../frontend/scripts/browser.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Use an isolated host acceptance database.');
const base=process.env.HOST_API_URL||'http://127.0.0.1:8048';
process.env.FRONTEND_URL=new URL(base).origin;
const scan=process.env.DATASHEET_E2E_SCAN==='1';
const labels=JSON.parse(await fs.readFile(scan?'plugins/cablesim.datasheet-extract/validation/scans.json':'plugins/cablesim.datasheet-extract/validation/labels.json','utf8'));
const sample=labels.samples[0];
const root=path.resolve(scan?'.data/datasheet-import/offline/browser':'.data/datasheet-import/browser');await fs.mkdir(root,{recursive:true});
const source=path.resolve('.data/datasheet-import/sources',sample.file);
const raw=await fs.readFile(source);const browser=await openHeadlessBrowser();const {page}=browser;
const events=[];page.on('response',r=>{if(r.url().includes('/api/'))events.push({method:r.request().method(),url:r.url(),status:r.status()});});
try{
 await page.goto(base+'/');
 const result=await page.evaluate(async input=>{
  async function api(method,url,body){const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(url+' '+r.status+' '+JSON.stringify(data));return data;}
  const sample=input.sample;
  const binary=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));const form=new FormData();form.append('file',new Blob([binary],{type:'application/pdf'}),sample.file);
  const uploaded=await fetch('/api/documents',{method:'POST',body:form});if(!uploaded.ok)throw Error(await uploaded.text());const doc=await uploaded.json();
  if(doc.sha256!==sample.sha256)throw Error('Original SHA mismatch');
  const prefix='/api/documents/'+doc.id;const text=await api('GET',prefix+'/pages/'+sample.selections[0].page);
  if(input.scan&&!text.requires_ocr)throw Error('Image-only parameter table was missed');
  const request={request_id:crypto.randomUUID(),method:'rules',model:sample.model,selections:sample.selections};
  let run=await api('POST',prefix+'/extractions',request);const replay=await api('POST',prefix+'/extractions',request);if(replay.id!==run.id)throw Error('Repeated extraction');
  const deadline=Date.now()+120000;
  while(['accepted','running'].includes(run.status)){if(Date.now()>deadline)throw Error('Extraction timeout');await new Promise(r=>setTimeout(r,500));run=await api('GET',prefix+'/extractions/'+run.id);}
  if(run.status!=='succeeded'||run.result.candidates.length<4)throw Error('Grounded extraction failed: '+JSON.stringify(run.error));
  const agrees=c=>sample.truth[c.field]&&c.unit_si===sample.truth[c.field].unit_si&&Math.abs(c.value_si-sample.truth[c.field].value_si)<1e-10;
  if(!run.result.candidates.some(c=>c.field==='r20'&&agrees(c)))throw Error('R20 SI conversion');
  if(input.scan&&(run.result.provider_calls.length||!run.result.ocr_evidence.length||run.result.candidates.some(c=>c.evidence_source!=='ocr'||!c.evidence_sha256)))throw Error('Offline OCR provenance');
  const baseModel=await api('POST','/api/domain-cable-models',{name:sample.manufacturer+' '+sample.model.designation+' '+sample.model.specification,version:'source-base-'+crypto.randomUUID().slice(0,8),sources:{catalogue:{kind:'manufacturer',reference:doc.sha256+' PDF '+sample.selections[0].page,reviewed:true}},specification:{manufacturer:sample.manufacturer,designation:sample.model.designation,u0_v:input.scan?600:6000,voltage_v:input.scan?600:10000,cores:input.scan?3:1,area_m2:Number(sample.model.specification)*1e-6,conductor:'copper_bare',values:{outer_diameter:{value:sample.truth.outer_diameter.value_si,unit:'m',basis:'manufacturer',source:'catalogue'}},missing:['conductor_diameter','insulation_thickness','metallic_sheath_thickness','oversheath_thickness','r20','materials']}});
  const review={request_id:crypto.randomUUID(),expected_revision:0,reviewer:'Browser acceptance engineer',decisions:run.result.candidates.map(c=>({candidate_id:c.id,action:agrees(c)?'accept':'reject',reason:'Manually labeled public manufacturer evaluation cell; verify page and coordinate'}))};
  const checked=await api('POST',prefix+'/extractions/'+run.id+'/reviews',review);if(checked.revision!==1)throw Error('Review CAS');
  const proposed=await api('POST',prefix+'/proposals',{request_id:crypto.randomUUID(),extraction_id:run.id,expected_review_revision:checked.revision,target_model_id:baseModel.id,expected_model_sha256:baseModel.digest,version:'source-reviewed-'+crypto.randomUUID().slice(0,8)});
  const before=await api('GET','/api/domain-cable-models');if(before.some(m=>m.payload.version===proposed.draft.version))throw Error('Premature model write');
  const approval={request_id:crypto.randomUUID(),proposal_sha256:proposed.sha256,approver:'Browser acceptance engineer',human_approved:true};
  const approved=await api('POST',prefix+'/proposals/'+proposed.id+'/approval',approval);
  const second=await api('POST',prefix+'/proposals/'+proposed.id+'/approval',approval);if(second.new_model_id!==approved.new_model_id)throw Error('Duplicate version');
  const versions=await api('GET','/api/domain-cable-models');if(versions.find(m=>m.id===baseModel.id).digest!==baseModel.digest)throw Error('Original overwritten');
  const current=versions.find(m=>m.id===approved.new_model_id);if(current.payload.confirmed||current.state!=='incomplete')throw Error('Implicit engineering certification');
  const history=await api('GET',prefix+'/extractions');if(!history.find(r=>r.id===run.id))throw Error('History lost');
  const original=await fetch(prefix+'/file');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await original.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==doc.sha256)throw Error('Original download changed');
  return {document_id:doc.id,sha256:doc.sha256,extraction_id:run.id,method:run.method,result_sha256:run.result_sha256,candidates:run.result.candidates,proposal_id:proposed.id,proposal_sha256:proposed.sha256,new_model_id:approved.new_model_id,original_model_id:baseModel.id,history_count:history.length};
 },{base64:raw.toString('base64'),sample,scan});
 assert.ok(result.candidates.length>=4);
 // Actual source page review/download over the same headless browser session.
 await page.goto(base+'/api/documents/'+result.document_id+'/pages/'+sample.selections[0].page+'/image');
 await fs.writeFile(path.join(root,'result.json'),JSON.stringify({...result,events,browser:'Edge --headless=new + CDP',scope:'Real PDF API workflow; no product page or engineer click-timing claim.'},null,2));
 console.log(JSON.stringify({document_id:result.document_id,candidates:result.candidates.length,new_model_id:result.new_model_id,source_sha256:result.sha256,events:events.length}));
}finally{await browser.close();}
