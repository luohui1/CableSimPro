/* Scripted type branches and publication; receipt fixture is isolated test data.
   Run: node tests/browser/type-versions.cjs. No production approval is performed. */
'use strict';
const {chromium}=require('../../design/node_modules/@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),base=process.env.CABLESIM_BASE_URL||'http://127.0.0.1:8041';
const out=path.join(root,'.data/type-versions'),parent=path.join(root,'.tmp/type-versions-e2e'),owned=path.join(parent,randomUUID());
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(owned,{recursive:true});
const checks=[],errors=[],sessions=[];let server,browser,context,fixtureBase,fixtureWid,historyWid;
const record=(name,detail={})=>{checks.push({name,...detail});console.log('PASS '+name);};
async function api(route,body,method=body?'POST':'GET',url=base,headers={}){
  const response=await fetch(url+'/api'+route,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
  const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
}
async function fixture(){
  const py=String.raw`import importlib.util, os, json
from pathlib import Path
from copy import deepcopy
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from design.workbench.serve import app
spec=importlib.util.spec_from_file_location('type_receipt_fixture', Path(os.environ['TYPE_TEST_ROOT'])/'tests/test_type_versions.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
patch=MonkeyPatch()
with TestClient(app) as client:
    w=module.workspace(client)
    runs=module.seed_evidence(client,w,patch)
    historical=module.workspace(client)
    runs.update(module.seed_evidence(client,historical,patch))
    def get_run(wid,rid,cache=None):
        value=deepcopy(runs[rid])
        if app.state.workspace_store.snapshot(wid)['revision']!=value['snapshot']['workspace_revision']:
            value['freshness']='historical'
        return value
    patch.setattr(app.state.research,'get_run',get_run)
    (Path(os.environ['TYPE_TEST_DIR'])/'fixture.json').write_text(json.dumps({'workspace_id':w['id'],'historical_workspace_id':historical['id']}),'utf-8')
`;
  fs.writeFileSync(path.join(owned,'type_versions_fixture.py'),py,'utf8');
  const net=require('node:net'),probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));fixtureBase='http://127.0.0.1:'+port;
  server=spawn(path.join(root,'.venv/Scripts/python.exe'),['-m','uvicorn','type_versions_fixture:app','--app-dir',owned,'--host','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,env:{...process.env,CABLESIM_DESIGN_DB:path.join(owned,'types.sqlite'),CABLESIM_TYPE_APPROVER_TOKEN:'isolated-test-credential',TYPE_TEST_ROOT:root,TYPE_TEST_DIR:owned},stdio:['ignore','pipe','pipe']});
  let log='';server.stdout.on('data',b=>log+=b.toString());server.stderr.on('data',b=>log+=b.toString());
  await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error('Receipt fixture did not start: '+log)),60000);const check=b=>{if(b.toString().includes('Uvicorn running')){clearTimeout(deadline);resolve();}};server.stderr.on('data',check);server.once('exit',code=>{clearTimeout(deadline);reject(new Error('Receipt fixture exited '+code+': '+log));});});
  fixtureWid=JSON.parse(fs.readFileSync(path.join(owned,'fixture.json'),'utf8')).workspace_id;
  historyWid=JSON.parse(fs.readFileSync(path.join(owned,'fixture.json'),'utf8')).historical_workspace_id;
}
async function stopFixture(){
  if(!server)return;
  if(process.platform==='win32')await new Promise(resolve=>{const killer=spawn('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('exit',resolve);killer.once('error',resolve);});
  else server.kill('SIGTERM');
}
async function goto(page,id,module,url=base){await page.goto(`${url}/design/workbench/#/types/${id}/${module}`);await page.waitForSelector('[data-version-state]');await page.waitForFunction(()=>!state.busy&&!document.querySelector('[data-version-state="loading"]'));}
async function capture(page,name,width=1366,height=768){
  await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
  const stats=await page.evaluate(()=>{const area=document.querySelector('.type-version-workspace'),rail=area.querySelector('.module-rail').getBoundingClientRect(),center=area.querySelector('.center').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,overlap:Math.min(rail.right,center.right)-Math.max(rail.left,center.left)>1&&Math.min(rail.bottom,center.bottom)-Math.max(rail.top,center.top)>1,primaries:[...document.querySelectorAll('#header button.primary,#workspace button.primary')].filter(e=>e.getClientRects().length).length,small:[...area.querySelectorAll('th,td,button,a,p,summary,label,span')].filter(e=>e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName+':'+getComputedStyle(e).fontSize)};});
  assert.ok(stats.scroll<=width,JSON.stringify(stats));assert.equal(stats.overlap,false);assert.ok(stats.primaries<=1,JSON.stringify(stats));assert.deepEqual(stats.small,[]);
  await page.screenshot({path:path.join(out,name+'.png')});record('layout '+name,stats);
}
(async()=>{
  const demo=JSON.parse(fs.readFileSync(path.join(out,'demo.json'),'utf8'));
  browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:1366,height:768}});sessions.push(context);let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
    const ids=demo.examples.single_core;
    await goto(page,ids.a,'comparison/matrix');assert.equal(await page.locator('[aria-label="方案结果矩阵"] thead input[type="radio"]').count(),2);
    const values=await api('/types/'+ids.a+'/comparison'),[a,b]=values.items;
    const close=(actual,expected,tolerance)=>assert.ok(Math.abs(actual-expected)<tolerance,actual+' != '+expected);
    close(b.values.outer_diameter.value-a.values.outer_diameter.value,.001,1e-12);
    close(b.values.mass.value-a.values.mass.value,demo.hand_check.mass_delta_kg_km,1e-7);
    close(a.values.copper_mass.value,demo.hand_check.copper_mass_kg_km,1e-7);assert.equal(a.values.copper_mass.value,b.values.copper_mass.value);
    const currents=Object.keys(a.values).filter(k=>k.startsWith('rating/')&&a.values[k].value!=null);assert.equal(currents.length,3);
    for(const key of currents)assert.ok(b.values[key]&&b.values[key].value!=null,key);
    record('native geometry delta and matching saved condition rows',{outer_diameter_delta_mm:1,mass_delta_kg_km:b.values.mass.value-a.values.mass.value,copper_mass_kg_km:a.values.copper_mass.value,ampacity_deltas:Object.fromEntries(currents.map(k=>[a.values[k].title,b.values[k].value-a.values[k].value]))});
    await capture(page,'comparison-matrix-1366');await capture(page,'comparison-matrix-1920',1920,1080);
    await goto(page,ids.a,'comparison/parameters');assert.ok(await page.locator('.version-difference').count()>0);await capture(page,'comparison-parameters-1366');
    await goto(page,ids.a,'comparison/geometry');assert.equal(await page.locator('.version-sections svg').count(),2);await page.locator('#version-overlay').check();assert.equal(await page.locator('svg.version-overlay').count(),1);await capture(page,'comparison-overlay-1920',1920,1080);record('parallel and overlay geometry');
    await goto(page,demo.examples.jiangnan.a,'comparison/matrix');const j=await api('/types/'+demo.examples.jiangnan.a+'/comparison');assert.ok(j.items.length>=2);const ja=j.items.find(p=>p.workspace===demo.examples.jiangnan.a),jb=j.items.find(p=>p.workspace===demo.examples.jiangnan.b);assert.equal(ja.values['short_circuit/conductor'].value,jb.values['short_circuit/conductor'].value);assert.equal(ja.values.mass.value,null);await capture(page,'jiangnan-comparison-1366');record('real three-core inputs preserve gaps and per-core short-circuit equality');
    const nativePage=page;await fixture();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await goto(page,fixtureWid,'comparison/matrix',fixtureBase);
    await page.locator('[data-action="type-version-new"]').click();await page.locator('#version-plan-name').fill('键盘流程方案');await page.locator('#version-plan-name').press('Escape');assert.equal(await page.locator('#modal').evaluate(d=>d.open),false);record('Escape cancels branch dialog');
    await page.locator('[data-action="type-version-new"]').click();await page.locator('#version-plan-name').fill('键盘流程方案');await page.locator('#version-plan-name').press('Enter');await page.waitForFunction(()=>state.route.includes('/structure/table')&&!state.busy&&state.wid===state.route.split('/')[2]);await page.locator('[data-grid-row="1"][data-grid-col="1"]').waitFor();const newId=await page.evaluate(()=>state.wid);assert.notEqual(newId,fixtureWid);record('Enter creates independent branch',{workspace_id:newId});
    const thickness=page.locator('[data-grid-row="1"][data-grid-col="1"]');await thickness.fill('4.6');await thickness.press('Enter');assert.equal(await page.evaluate(()=>state.dirty),true);await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>state.dirty),false);await page.keyboard.press('Control+s');record('Ctrl Z and Ctrl S remain available');
    await goto(page,newId,'comparison/matrix',fixtureBase);await page.locator(`input[name="compare-plan"][value="${newId}"]`).check();await page.locator('[data-action="type-version-adopt"]').click();await page.locator('[data-action="type-version-confirm-adopt"]').press('Enter');await page.waitForFunction(()=>state.route.includes('/specification/review')&&!state.busy);await page.locator('[data-action="type-version-submit"]').waitFor();
    await page.locator('[data-action="type-version-submit"]').click();await page.locator('#version-checks-ack').check();await page.locator('#version-checks-ack').press('Enter');await page.waitForFunction(()=>document.querySelector('.version-review-header h3')?.textContent==='待人工审核'&&!state.busy);assert.equal(await page.locator('[data-action="type-version-approve"]').isDisabled(),true);await capture(page,'submission-checklist-1920',1920,1080);record('isolated missing-evidence submission is listed and approval stays disabled');page=nativePage;await goto(page,ids.a,'comparison/matrix');
    let releaseComparison;const heldComparison=new Promise(resolve=>releaseComparison=resolve);await page.route('**/api/types/*/comparison',async r=>{await heldComparison;await r.continue();});await page.locator('[data-action="type-version-refresh"]').click();await page.locator('[data-version-state="loading"]').waitFor();await capture(page,'comparison-loading-1366');releaseComparison();await page.waitForFunction(()=>!['loading','error'].includes(document.querySelector('[data-version-state]')?.dataset.versionState));await page.unroute('**/api/types/*/comparison');record('loading reaches saved records');
    await page.route('**/api/types/*/comparison',r=>r.abort('internetdisconnected'));await page.locator('[data-action="type-version-refresh"]').click();await page.locator('[data-version-state="error"]').waitFor();await capture(page,'comparison-error-1366');await page.unroute('**/api/types/*/comparison');await page.locator('[data-action="type-version-refresh"]').click();await page.waitForFunction(()=>!['loading','error'].includes(document.querySelector('[data-version-state]')?.dataset.versionState));record('network error and retry preserve stored plans');
    const edited=await api('/workspaces/'+ids.b),document=structuredClone(edited.domain);document.cable_types[0].common_layers[1].thickness=.0051;await api('/workspaces/'+ids.b+'/domain',{expected_revision:edited.revision,document},'PUT');await page.locator('[data-action="type-version-refresh"]').click();await page.locator('[data-version-state="historical"]').waitFor();assert.ok(await page.locator('.version-history').count()>0);await capture(page,'comparison-historical-1366');const restore=await api('/workspaces/'+ids.b);await api('/workspaces/'+ids.b+'/domain',{expected_revision:restore.revision,document:edited.domain},'PUT');record('input edit retains numbers with historical labels');
    // Original snapshots remain historical after restoring inputs: refresh runs explicitly.
    const review=await context.newPage();review.on('pageerror',e=>errors.push(e.message));
    await goto(review,fixtureWid,'comparison/matrix',fixtureBase);await review.locator('[data-action="type-version-adopt"]').click();await review.locator('[data-action="type-version-confirm-adopt"]').click();await review.locator('[data-action="type-version-submit"]').waitFor();await review.locator('[data-action="type-version-submit"]').click();await review.locator('#version-checks-ack').check();await review.locator('#version-checks-ack').press('Enter');await review.locator('[data-action="type-version-approve"]:not([disabled])').waitFor();await capture(review,'release-submitted-1366');
    await review.locator('[data-action="type-version-approve"]').click();await review.locator('#version-reviewer').fill('TEST RECEIPT');await review.locator('#version-review-token').fill('isolated-test-credential');await review.locator('#version-human-ack').check();await review.locator('#version-human-ack').press('Enter');await review.waitForFunction(()=>document.querySelector('.version-review-header h3')?.textContent==='已批准'&&!state.busy);await capture(review,'release-approved-1366');
    await review.locator('[data-action="type-version-publish"]').click();await review.locator('#version-publish-token').fill('isolated-test-credential');await review.locator('[data-action="type-version-confirm-publish"]').press('Enter');await review.waitForFunction(()=>document.querySelector('.version-review-header h3')?.textContent==='已发布'&&!state.busy);await capture(review,'release-published-1920',1920,1080);
    const released=await api('/types/'+fixtureWid+'/specification',null,'GET',fixtureBase);assert.equal(released.lifecycle.status,'published');assert.equal(released.lifecycle.approval.reviewer,'TEST RECEIPT');assert.ok(released.lifecycle.approval.approved_at);assert.equal(released.payload.chapters.length,8);
    const snapshot=await api('/workspaces/'+fixtureWid,null,'GET',fixtureBase),deny=await fetch(fixtureBase+'/api/workspaces/'+fixtureWid+'/domain',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:snapshot.revision,document:snapshot.domain})});assert.equal(deny.status,409);
    await goto(review,fixtureWid,'specification/preview',fixtureBase);assert.equal(await review.frameLocator('.version-spec-preview').locator('section').count(),8);record('isolated credentialed human receipt publishes and freezes complete specification',{authority:'isolated test receipt',chapters:8});
    const exported=review.waitForEvent('download');await review.locator('[data-action="type-version-download"]').click();const download=await exported;await download.saveAs(path.join(out,'specification.html'));const exportedHtml=fs.readFileSync(path.join(out,'specification.html'),'utf8');assert.equal((exportedHtml.match(/<section id=/g)||[]).length,8);assert.ok(exportedHtml.includes('--font-ui'));assert.ok(!exportedHtml.includes('<link rel="stylesheet"'));record('standalone specification export embeds tokens and all eight chapters');
    await goto(review,fixtureWid,'specification/review',fixtureBase);await review.reload();await review.locator('[data-action="type-version-fork"]').waitFor();assert.equal(await review.locator('#header [data-action="save"]').isDisabled(),true);record('published version reload remains frozen');
    await capture(review,'release-published-1366');await capture(review,'release-mobile',390,844);
    await review.setViewportSize({width:1366,height:768});
    let releaseSpec;const heldSpec=new Promise(resolve=>releaseSpec=resolve);await review.route('**/api/types/*/specification',async r=>{await heldSpec;await r.continue();});await review.locator('[data-action="type-version-refresh"]').click();await review.locator('[data-version-state="loading"]').waitFor();await capture(review,'specification-loading-1366');releaseSpec();await review.locator('[data-version-state="success"]').waitFor();await review.unroute('**/api/types/*/specification');
    await review.route('**/api/types/*/specification',r=>r.abort('internetdisconnected'));await review.locator('[data-action="type-version-refresh"]').click();await review.locator('[data-version-state="error"]').waitFor();await capture(review,'specification-error-1366');await review.unroute('**/api/types/*/specification');await review.locator('[data-action="type-version-refresh"]').click();await review.locator('[data-version-state="success"]').waitFor();record('specification loading and retry preserve frozen release');
    const historical=await api('/workspaces/'+historyWid,null,'GET',fixtureBase),historyDocument=structuredClone(historical.domain);historyDocument.cable_types[0].common_layers[1].thickness+=.0005;await api('/workspaces/'+historyWid+'/domain',{expected_revision:historical.revision,document:historyDocument},'PUT',fixtureBase);await goto(review,historyWid,'specification/content',fixtureBase);await review.locator('[data-version-state="historical"]').waitFor();await capture(review,'specification-historical-1366');record('specification historical state retains source snapshots');
    assert.deepEqual(errors,[]);record('no browser page errors');fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify({base,checks,errors,fixture_scope:'isolated lifecycle data, not manufacturer certification'},null,2));
  }finally{
    for(const c of sessions)await c.close();if(browser){assert.equal(browser.contexts().length,0);await browser.close();}await stopFixture();
    if(path.resolve(owned).startsWith(path.resolve(parent)+path.sep))fs.rmSync(owned,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
