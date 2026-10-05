// Saved numeric input only; never writes to the original demonstration database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser} from '../../frontend/scripts/browser.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Requires isolated acceptance host');
const base=process.env.HOST_API_URL || 'http://127.0.0.1:8051';
process.env.FRONTEND_URL=new URL(base).origin;
const corrugated=process.env.RATING_EXAMPLE==='corrugated';
const output=path.resolve('.data/customer-selection/'+(corrugated?'corrugated':'soil-sweep'));
const fixture=JSON.parse(await fs.readFile(path.join(output,corrugated?'input.json':'case-0.json'),'utf8'));
const browser=await openHeadlessBrowser();
try {
  await browser.page.goto(base);
  const evidence=await browser.page.evaluate(async({input,parameters,corrugated})=>{
    async function api(method,url,body){
      const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      const value=await r.json();if(!r.ok)throw Error(url+' '+r.status+' '+JSON.stringify(value));return value;
    }
    const methods=await api('GET','/api/methods');
    const method={...methods.find(m=>m.method.plugin_id==='cablesim.iec60287').method,capability:'steady-rating'};
    const w=await api('POST','/api/workspaces',{});const root='/api/workspaces/'+w.id;
    const soil=input.materials.findIndex(m=>m.id===input.sections[0].medium.material);
    delete parameters.rating_mode; // Prove the host honours the driver rather than this optional plugin parameter.
    const study=await api('POST',root+'/studies',{title:corrugated?'城南线路 · 110 kV 直埋单回校核':'三回路排管土壤热阻率核验',expected_revision:w.revision,
      method,input_source:'study',method_input:input,parameters,
      driver:corrugated?{kind:'single'}:{kind:'sweep',target_key:'ampacity',target_unit:'A',target_entity:input.circuits[0].id,
        samples:[.6,.8,1].map(rho=>({label:rho+' K·m/W',changes:{['/input/materials/'+soil+'/thermal_resistivity']:rho}}))}});
    const url=root+'/studies/'+study.id;
    const pre=await api('GET',url+'/preflight?expected_revision='+w.revision+'&expected_study_revision='+study.revision);
    if(!pre.ready)throw Error(JSON.stringify(pre));
    const request={expected_revision:w.revision,expected_study_revision:study.revision,request_id:crypto.randomUUID(),scope_acknowledged:true,lock_digest:pre.lock_digest};
    let run=await api('POST',url+'/runs',request);
    for(let count=0;['accepted','running','validating'].includes(run.status)&&count<450;count++){
      await new Promise(resolve=>setTimeout(resolve,2000));
      run=await api('GET',url+'/runs/'+run.id);
    }
    if(run.status!=='succeeded'||run.integrity!=='verified')throw Error(JSON.stringify(run));
    if((await api('POST',url+'/runs',request)).id!==run.id)throw Error('Idempotency');
    const condition=corrugated?'rating':'rating-simultaneous';
    const quantities=run.output.cases.map(c=>c.results.find(r=>r.key==='ampacity'&&r.entity===input.circuits[0].id&&r.case===condition));
    if(quantities.some(q=>!q.rating_basis?.display_name))throw Error('Missing ampacity display basis');
    if(!corrugated&&run.output.default_result.case!==condition)throw Error('Wrong default sweep metric');
    const currents=quantities.map(q=>q.value);
    const delivery=await api('POST',root+'/deliveries/current',{run_ids:[run.id],request_id:crypto.randomUUID()});
    return {run:run.id,input_sha256:run.input_digest,output_sha256:run.output_digest,currents,quantities,
      execution:run.execution,trace:run.output.cases[0].artifacts['x-cablesim.iec60287-trace'],
      definition:run.snapshot.definition,html:delivery.html,file:root+'/deliveries/'+delivery.id+'/file'};
  },{input:fixture.input,parameters:fixture.parameters,corrugated});
  const expected=[417.384415865,386.973172426,362.238246202];
  if(!corrugated)evidence.currents.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<2e-5));
  else {
    assert.equal(evidence.quantities[0].rating_basis.kind,'single_circuit');
    assert.equal(evidence.trace.verification.passed,true);
    assert.ok(evidence.execution?.job_id);
  }
  assert.ok(evidence.html.includes('data-section="'+(corrugated?'corrugated-sheath':'sweep-basis')+'"'));
  for(const value of evidence.currents)assert.ok(evidence.html.includes(value.toFixed(3)));
  const pending=browser.page.waitForEvent('download');
  await browser.page.evaluate(url=>{const a=document.createElement('a');a.href=url;document.body.append(a);a.click();},evidence.file);
  const download=await pending;await download.saveAs(path.join(output,'calculation.html'));
  assert.equal(await fs.readFile(path.join(output,'calculation.html'),'utf8'),evidence.html);
  await browser.page.setViewportSize({width:1366,height:768});await browser.page.setContent(evidence.html);
  assert.equal(await browser.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify({...evidence,html:undefined,browser:'headless Edge/CDP'},null,2));
  console.log(JSON.stringify({run:evidence.run,currents:evidence.currents,download:true}));
} finally {await browser.close();}
