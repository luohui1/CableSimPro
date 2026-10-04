// BrowserOS neo run-body. Set batchPhase to setup/run/finish/states before this body.
// Use the isolated test service on :8036; real methods, execution and ZIP export.
const page=browser.page((await browser.pages.list()).find(p=>p.ownership==='mine'&&p.url.includes(':8036/')).pageId);
const phase=typeof batchPhase==='undefined'?'setup':batchPhase;
async function value(fn,arg){return (await page.evaluate('return ('+fn.toString()+')('+JSON.stringify(arg??null)+');')).value;}
async function ready(selector){if(!(await page.waitForSelector(selector,{timeout:20000})).matched)throw Error('Missing '+selector);}
async function click(selector){await value(s=>{const e=document.querySelector(s);if(!e)throw Error('Missing '+s);e.click();},selector);}
async function change(selector,text){await value(({s,v})=>{const e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},{s:selector,v:text});}
async function key(selector,key,ctrl=false){await value(({s,k,c})=>{const e=document.querySelector(s);e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:k,ctrlKey:c,bubbles:true}));},{s:selector,k:key,c:ctrl});}
if(phase==='setup'){
  const ids=await value(async()=>{
    const api=async(path,body)=>{const r=await fetch('/api'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw Error(await r.text());return r.json();};
    const w=await api('/workspaces',{}),scenario=w.scenario;
    const converted=await api('/workspaces/'+w.id+'/domain/conversion',{expected_revision:w.revision});
    const methods=await api('/methods'),m=methods.find(x=>x.method.plugin_id==='cablesim.thermal-network').method;
    const s=await api('/workspaces/'+w.id+'/studies',{expected_revision:converted.revision,title:'批量浏览器回归',method:{...m,capability:'steady-rating'},input_source:'study',method_input:scenario});
    window.__batchJourney={wid:w.id,sid:s.id,checks:{}};return window.__batchJourney;
  });
  await value(ids=>{location.hash='/studies/'+ids.sid+'/batch/space';},ids);await ready('[data-batch-action="add"]');
  await value(()=>{window.__batchJourney.checks.empty=document.querySelector('.batch-empty').textContent.includes('定义');});
  await click('[data-batch-action="add"]');await ready('#batch-new-axis');
  await value(()=>{const s=document.querySelector('#batch-new-axis');s.value=[...s.options].find(o=>o.textContent.includes('installation/depth_m')).value;});
  await click('[data-batch-action="confirm-add"]');await ready('[data-batch-field="axis:0:minimum"]');
  await change('[data-batch-field="sample_count"]','3');await change('[data-batch-field="execution:slurm_parallelism"]','1');
  await key('[data-batch-field="sample_count"]','s',true);await ready('[data-action="amp-save"]:disabled');
  await change('[data-batch-field="seed"]','17');await key('[data-batch-field="seed"]','z',true);
  if(await value(()=>document.querySelector('[data-batch-field="seed"]').value)!=='42')throw Error('Undo failed');
  await change('[data-batch-field="axis:0:minimum"]','2');await key('[data-batch-field="axis:0:minimum"]','s',true);await ready('.batch-error');
  await value(()=>window.__batchJourney.checks.error=!!document.querySelector('.batch-error')&&document.querySelectorAll('.batch-error').length===1);
  await key('[data-batch-field="axis:0:minimum"]','z',true);
  return {phase,...await value(()=>window.__batchJourney)};
}
if(phase==='run'){
  await click('[data-action="amp-workflow-next"]');await click('[data-action="amp-workflow-next"]');
  await ready('.batch-conclusion');return {phase,started:true};
}
if(phase==='finish'){
  await ready('.batch-conclusion');
  const evidence=await value(async()=>{
    const j=window.__batchJourney,root='/api/workspaces/'+j.wid+'/studies/'+j.sid;
    const list=await(await fetch(root+'/datasets')).json(),r=await(await fetch(root+'/datasets/'+list[0].id)).json();
    if(r.status!=='completed')return {pending:true,status:r.status};
    if(list.length!==1||r.valid_count!==3||r.samples.some(s=>s.attempt!==1))throw Error('Duplicate or invalid real execution');
    j.dataset=r.id;j.checks.success=true;j.checks.idempotent=true;
    const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/export'))j.export={status:response.status,bytes:(await response.clone().arrayBuffer()).byteLength,type:response.headers.get('content-type')};return response;};
    return {pending:false,status:r.status,samples:r.samples.map(s=>({id:s.sample_id,hash:s.input_sha256,attempt:s.attempt}))};
  });
  if(evidence.pending)return evidence;
  await click('[data-action="amp-workflow-next"]');await ready('[data-action="amp-workflow-next"]:not(:disabled)');
  await value(()=>[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='参数空间').click());await ready('[data-batch-field="seed"]');
  await change('[data-batch-field="seed"]','7');await key('[data-batch-field="seed"]','s',true);await ready('[data-action="amp-save"]:disabled');
  await value(()=>[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='样本结果').click());await ready('.batch-history-mark');
  await value(()=>window.__batchJourney.checks.history=true);
  const sizes=[];
  for(const [width,height] of [[1366,768],[1920,1080]]){
    await page.cdp('Emulation.setDeviceMetricsOverride',JSON.stringify({width,height,deviceScaleFactor:1,mobile:false}));
    sizes.push(await value(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,minFont:Math.min(...[...document.querySelectorAll('.batch-content *')].filter(e=>e.getClientRects().length&&e.textContent.trim()).map(e=>parseFloat(getComputedStyle(e).fontSize)))})));
  }
  if(sizes.some(s=>s.scrollWidth>s.width||s.minFont<13))throw Error('Batch layout/typography regression');
  return {phase,evidence,sizes,...await value(()=>window.__batchJourney)};
}
if(phase==='states'){
  await value(()=>[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='参数空间').click());await ready('[data-batch-select="source"]');
  await value(()=>{window.__batchOriginalFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/batch-configuration')?Promise.reject(new TypeError('Simulated batch connection loss')):window.__batchOriginalFetch(url,options);document.querySelector('[data-batch-select="source"]').dispatchEvent(new Event('change',{bubbles:true}));});
  await ready('.batch-error');
  await value(()=>{window.__batchJourney.checks.networkError=true;window.fetch=(url,options)=>String(url).includes('/batch-configuration')?new Promise((resolve,reject)=>{window.__batchRelease=()=>window.__batchOriginalFetch(url,options).then(resolve,reject);}):window.__batchOriginalFetch(url,options);});
  await click('[data-batch-action="reload"]');await ready('.batch-content[aria-busy="true"]');
  await value(()=>{window.__batchJourney.checks.loading=true;window.fetch=window.__batchOriginalFetch;window.__batchRelease();});await ready('[data-batch-select="source"]');
  await value(()=>{window.__batchJourney.checks.recovery=!document.querySelector('.batch-error');});
  return {phase,...await value(()=>window.__batchJourney)};
}
throw Error('Unknown batch phase');
