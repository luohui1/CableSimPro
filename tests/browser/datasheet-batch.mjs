import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser} from '../../frontend/scripts/browser.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Use an isolated acceptance database.');
const base=process.env.HOST_API_URL||'http://127.0.0.1:8051';
process.env.FRONTEND_URL=new URL(base).origin;
const labels=JSON.parse(await fs.readFile('plugins/cablesim.datasheet-extract/validation/batch-example.json','utf8'));
const raw=await fs.readFile(path.resolve('.data/datasheet-import/sources',labels.source.file));
const browser=await openHeadlessBrowser();const {page}=browser;
try{
 await page.goto(base+'/');
 const result=await page.evaluate(async({labels,base64})=>{
  async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw Error(r.status+' '+url+' '+JSON.stringify(v));return v;}
  const source=labels.source;const form=new FormData();form.append('file',new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'application/pdf'}),source.file);
  const uploaded=await fetch('/api/documents',{method:'POST',body:form});if(!uploaded.ok)throw Error(await uploaded.text());const doc=await uploaded.json();
  if(doc.sha256!==source.sha256)throw Error('Original digest changed');
  const prefix='/api/documents/'+doc.id;const before=await api('/api/domain-cable-models');const version='batch-'+crypto.randomUUID().slice(0,8);const items=[];const evidence=[];
  for(const row of labels.rows){
   let run=await api(prefix+'/extractions',{request_id:crypto.randomUUID(),method:'rules',model:{designation:source.designation,specification:String(row.area_mm2),identity_note:source.annotation},selections:source.selections});
   const deadline=Date.now()+90000;
   while(['accepted','running'].includes(run.status)){if(Date.now()>deadline)throw Error('Extraction timeout');await new Promise(r=>setTimeout(r,250));run=await api(prefix+'/extractions/'+run.id);}
   if(run.status!=='succeeded'||run.result.provider_calls.length)throw Error('Local extraction failed');
   const expected=Object.fromEntries(labels.fields.map((f,i)=>[f,{value:row.values[i]*.001,unit:labels.si_units[i]}]));
   const seen=new Set();
   for(const c of run.result.candidates){const e=expected[c.field];if(!e||c.ambiguities.length||c.unit_si!==e.unit||Math.abs(c.value_si-e.value)>1e-10||![20,21].includes(c.page)||!c.quote)throw Error('Candidate does not match manual source annotation: '+JSON.stringify(c));seen.add(c.field);}
   if(seen.size!==7)throw Error('Missing manually annotated field');
   const review=await api(prefix+'/extractions/'+run.id+'/reviews',{request_id:crypto.randomUUID(),expected_revision:0,reviewer:'Isolated acceptance human fixture',decisions:run.result.candidates.map(c=>({candidate_id:c.id,action:'accept',reason:'Compared with manually annotated original PDF pp20–21'}))});
   items.push({request_id:crypto.randomUUID(),extraction_id:run.id,expected_review_revision:review.revision,version,new_model:{name:`Bahra ${source.designation} 6/10 kV 1×${row.area_mm2}`,manufacturer:source.manufacturer,designation:source.designation,u0_v:source.u0_v,voltage_v:source.voltage_v,cores:1,conductor:source.conductor,area_m2:row.area_mm2*1e-6,identity_reference:source.annotation}});
   evidence.push({area_mm2:row.area_mm2,extraction_id:run.id,result_sha256:run.result_sha256,method:run.method,fields:run.result.candidates.length});
  }
  const request={request_id:crypto.randomUUID(),items};const proposal=await api(prefix+'/batches',request);
  if((await api(prefix+'/batches',request)).id!==proposal.id)throw Error('Repeated batch proposal');
  if((await api('/api/domain-cable-models')).length!==before.length)throw Error('Library written before approval');
  const body={request_id:crypto.randomUUID(),proposal_sha256:proposal.sha256,approver:'Isolated acceptance human fixture',human_approved:true};
  const approved=await api(prefix+'/batches/'+proposal.id+'/approval',body);const replay=await api(prefix+'/batches/'+proposal.id+'/approval',body);
  const ids=approved.proposals.map(p=>p.new_model_id);
  if(JSON.stringify(ids)!==JSON.stringify(replay.proposals.map(p=>p.new_model_id)))throw Error('Duplicate approval wrote new models');
  const models=(await api('/api/domain-cable-models')).filter(m=>ids.includes(m.id));
  if(models.length!==5||models.some(m=>m.payload.confirmed||m.state!=='incomplete'))throw Error('Draft boundary failed');
  for(const model of models){const references=Object.entries(model.payload.sources).filter(([k])=>k.startsWith('datasheet/')).map(([,s])=>JSON.parse(s.reference));if(references.length!==7||references.some(r=>r.original_sha256!==doc.sha256||![20,21].includes(r.page)||!r.bbox_pt))throw Error('Source page/hash provenance lost');}
  return {document_id:doc.id,original_sha256:doc.sha256,batch_id:proposal.id,batch_sha256:proposal.sha256,models,evidence,provider_calls:0,approved_effect:'five incomplete drafts; no engineering approval'};
 },{labels,base64:raw.toString('base64')});
 assert.equal(result.models.length,5);
 const output=path.resolve('.data/datasheet-import/batch');await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({models:result.models.length,fields:result.evidence.reduce((n,r)=>n+r.fields,0),document_id:result.document_id,batch_id:result.batch_id,provider_calls:result.provider_calls}));
}finally{await browser.close();}
