import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser } from '../../frontend/scripts/browser.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Host browser workflow requires a separately created acceptance database and E2E_ISOLATED=1.');
const base=process.env.HOST_API_URL || 'http://127.0.0.1:8047';
process.env.FRONTEND_URL=new URL(base).origin; // Reuse the helper's guard for this exact isolated host.
const root=path.resolve('.data/host-integration/browser');
await fs.mkdir(root,{recursive:true});
const browser=await openHeadlessBrowser();
const {page}=browser;const events=[];const started=performance.now();
page.on('response',r=>{if(r.url().includes('/api/'))events.push({method:r.request().method(),url:r.url(),status:r.status()});});
try {
  await page.goto(base+'/');
  const result=await page.evaluate(async()=>{
    async function api(method,url,body){
      const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
      const value=await r.json();if(!r.ok)throw Error(url+': '+r.status+' '+JSON.stringify(value));return value;
    }
    const schema=await api('GET','/openapi.json');
    for(const route of ['/api/input-contracts','/api/examples/iec','/api/examples/cable','/api/workspaces/{wid}/geometry-preview','/api/workspaces/{wid}/deliveries/current','/api/workspaces/{wid}/deliveries/{did}/file'])
      if(!schema.paths[route])throw Error('Missing '+route);
    const contracts=await api('GET','/api/input-contracts');
    const tasks=await api('GET','/api/study-tasks');
    if(tasks.length!==3)throw Error('Task catalog');
    const methods=await api('GET','/api/methods');
    const sample=await api('GET','/api/examples/iec');
    const cable=await api('GET','/api/examples/cable');
    if(cable.document.schema_version!=='cablesim.domain/1')throw Error('Cable example');
    const w=await api('POST','/api/workspaces',{});const root='/api/workspaces/'+w.id;
    const method={...methods.find(m=>m.method.plugin_id==='cablesim.iec60287').method,capability:'reference-rating'};
    const s=await api('POST',root+'/studies',{title:'Browser host workflow',expected_revision:w.revision,method,
      input_source:'study',method_input:sample.input});const url=root+'/studies/'+s.id;
    const preflight=await api('GET',url+'/preflight?expected_revision='+w.revision+'&expected_study_revision='+s.revision);
    if(!preflight.ready)throw Error('Preflight not ready');
    const body={expected_revision:w.revision,expected_study_revision:s.revision,request_id:crypto.randomUUID(),scope_acknowledged:true,lock_digest:preflight.lock_digest};
    const run=await api('POST',url+'/runs',body);if(run.status!=='succeeded'||run.integrity!=='verified')throw Error('Run not sealed');
    const replay=await api('POST',url+'/runs',body);if(replay.id!==run.id)throw Error('Duplicate calculation');
    const polled=await api('GET',url+'/runs/'+run.id);if(polled.output_digest!==run.output_digest)throw Error('Polling identity');
    const request={run_ids:[run.id],request_id:crypto.randomUUID()};
    const delivery=await api('POST',root+'/deliveries/current',request);
    const alias=await api('POST','/api/design/workspaces/'+w.id+'/deliveries',request);
    if(alias.id!==delivery.id)throw Error('Duplicate delivery');
    return {workspace:w.id,study:s.id,run:run.id,delivery:delivery.id,html:delivery.html,
      ampacity:run.output.cases[0].results.find(r=>r.key==='ampacity').value,taskCount:tasks.length,contractCount:contracts.length,
      file:root+'/deliveries/'+delivery.id+'/file',input_sha256:run.input_digest,output_sha256:run.output_digest};
  });
  const downloadPromise=page.waitForEvent('download');
  await page.evaluate(url=>{const a=document.createElement('a');a.href=url;a.textContent='Download saved report';document.body.append(a);a.click();},result.file);
  const download=await downloadPromise;const file=path.join(root,'customer-report.html');await download.saveAs(file);
  assert.equal(await fs.readFile(file,'utf8'),result.html);
  for(const [width,height] of [[1366,768],[1920,1080]]){
    await page.setViewportSize({width,height});await page.goto(base+result.file.replace('/file',''));
    // The contract response is JSON; render the actual saved book for artifact QA.
    await page.setContent(result.html);await page.screenshot({path:path.join(root,`report-${width}.png`),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false);
  }
  const evidence={...result,html:undefined,elapsed_s:(performance.now()-started)/1000,events,
    browser:'Edge --headless=new + Playwright over CDP',scope:'Browser network workflow and saved report download; no frontend page changes or engineer click timing.'};
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
