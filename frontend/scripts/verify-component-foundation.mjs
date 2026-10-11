import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomUUID, createHash } from 'node:crypto';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot, repositoryRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
import { assertLayout } from './layout-assertions.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Only run against an isolated database');
if(process.env.COMPONENT_READABILITY_ONLY==='1'){await import('./verify-research-readability.mjs');process.exit(0);}
if(process.env.COMPONENT_FIXES_ONLY==='1') {
  await import('./verify-research-fixes.mjs');
  process.exit(0);
}
if(process.env.COMPONENT_PERFORMANCE_ONLY==='1') {
  await import('./verify-study-performance.mjs');
  process.exit(0);
}
if(process.env.COMPONENT_CROSSING_ONLY==='1') {
  await import('./verify-crossing.mjs');
  process.exit(0);
}
if(process.env.COMPONENT_FEM_BOOKS_ONLY==='1') {
  await import('./verify-fem-report.mjs');
  process.exit(0);
}
if(process.env.COMPONENT_SCENARIOS_ONLY==='1') {
  await import('./verify-research-scenarios.mjs');
  process.exit(0);
}
const base=process.env.FRONTEND_URL, expect=baseExpect.configure({timeout:30000});
const session=await openHeadlessBrowser(),{page,context}=session;
page.setDefaultTimeout(30000);
const out=path.join(outputRoot,process.env.COMPONENT_RELATIONS_ONLY==='1'?'study-relations':process.env.COMPONENT_ASSOCIATIONS_ONLY==='1'?'study-associations':'round2'), report={checks:[],variants:[],errors:[],writes:[],initialJavaScript:[]};
await fs.mkdir(out,{recursive:true});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(['PUT','PATCH','POST'].includes(r.method()))report.writes.push({url:r.url(),method:r.method(),body:r.postDataJSON()});});
async function go(route){await page.goto('about:blank');await page.goto(base+route);await settle(page);}
async function variants(label,nameOptions){for(const size of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']){await page.setViewportSize(size);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);await assertLayout(page,label,nameOptions);report.variants.push({label,...size,theme});}}
async function sweepContrast() {
  return page.locator('.study-sweep-results .series-chart text').evaluateAll(nodes => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = values => values.slice(0,3).map(v => v/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    return nodes.map(node => {
      const foreground=rgb(getComputedStyle(node).fill);let parent=node.parentElement,background;
      while(parent){const color=rgb(getComputedStyle(parent).backgroundColor);if(color.length===3||color[3]===1){background=color;break;}parent=parent.parentElement;}
      const a=luminance(foreground),b=luminance(background || [255,255,255]);
      return {text:node.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
  });
}
async function verifyAssociations() {
  await page.setViewportSize({width:1366,height:768});
  const all=[];
  for(const workspace of await request(base,'/api/workspaces')) {
    for(const study of await request(base,`/api/workspaces/${workspace.id}/studies`)) all.push({workspace,study});
  }
  const target=all.find(({study})=>study.definition.title.includes('城北')&&study.definition.driver.kind==='selection');
  assert.ok(target,'Real 城北 inquiry is required');
  const {workspace,study}=target, prefix=`/api/workspaces/${workspace.id}/studies/${study.id}`;
  const runs=(await request(base,prefix+'/runs?view=summary')).items;
  const saved=runs.findLast(run=>run.integrity==='verified'&&['succeeded','partial'].includes(run.status));
  assert.ok(saved,'Saved selection results are required');
  const url=run=>`/studies/${study.id}/selection/results?workspace=${workspace.id}&run=${run.id}`;
  // Older seed runs predate field artifacts. Compute one real current run in
  // the isolated library; do not substitute a fabricated plot for this check.
  const freshWorkspace=await request(base,`/api/workspaces/${workspace.id}`),freshStudy=await request(base,prefix);
  let current=await request(base,prefix+'/recalculate','POST',{expected_revision:freshWorkspace.revision,expected_study_revision:freshStudy.revision,request_id:randomUUID(),scope_acknowledged:true});
  const start=performance.now();
  while(['accepted','queued','running','validating'].includes(current.status)&&performance.now()-start<180000) {
    await page.waitForTimeout(500);current=await request(base,prefix+'/runs/'+current.id);
  }
  assert.ok(['succeeded','partial'].includes(current.status)&&current.integrity==='verified','Current selection must calculate');
  await go(url(current));
  await expect(page.locator('.field-view')).toBeVisible();
  const tabs=page.getByRole('tablist',{name:'属性分页'});
  // Preload Agent with the plot removed, then switch with the soil plot mounted.
  await page.getByRole('button',{name:'敷设截面',exact:true}).click();
  await tabs.getByRole('tab',{name:'Agent',exact:true}).click();
  await expect(page.locator('.inspector-agent .agent-panel-model')).toBeVisible();
  await tabs.getByRole('tab',{name:'输入',exact:true}).click();
  await page.getByRole('button',{name:'土壤温度场',exact:true}).click();
  await expect(page.locator('.field-view')).toBeVisible();
  report.agentSwitchMs=[];
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]) for(const theme of ['light','dark']) {
    await page.setViewportSize(size);
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    const field=await page.locator('.field-view').elementHandle(), started=performance.now();
    await tabs.getByRole('tab',{name:'Agent',exact:true}).click({timeout:5000});
    await expect(page.locator('.inspector-agent .agent-panel-model')).toBeVisible({timeout:5000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const elapsedMs=Math.round(performance.now()-started);
    assert.ok(elapsedMs<2000,`Field → Agent took ${elapsedMs} ms`);
    assert.ok(await field.evaluate(node=>node.isConnected),'Agent switching must retain the mounted field');
    await field.dispose();
    await assertLayout(page,'询价场图与 Agent');
    report.agentSwitchMs.push({...size,theme,elapsedMs});
    await tabs.getByRole('tab',{name:'输入',exact:true}).click();
  }
  report.checks.push('询价场图切 Agent：预加载后不冻结、场图保持挂载、两种尺寸与深浅主题');
  await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await go(url(saved));
  const top=page.locator('.topbar > .status-wrap > .status-mark');
  await expect(top).toHaveCount(1);
  if((await top.innerText()).includes('已过期')) {
    await expect(page.locator('.command-state')).toContainText('已过期');
    await expect(page.locator('.inspector-list').filter({hasText:'状态'})).toContainText('已过期');
    await expect(page.locator('.explorer-calc[aria-current="page"] .status-mark')).toHaveText('已过期');
    await expect(page.locator('.study-history-line')).toContainText('历史');
    await expect(page.getByRole('table').first()).toBeVisible();
    await expect(page.locator('.workbench-dock-body')).not.toContainText('尚无运行');
    await top.click();await expect(page.locator('.topbar .status-detail')).toContainText(/→|修改|变化/);
    await top.click();
  }
  await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'workspace-light.png')});
  await go(`/studies?workspace=${workspace.id}`);
  const table=page.getByRole('table',{name:'本工程研究'});
  await expect(table.getByRole('columnheader',{name:'结论',exact:true})).toBeVisible();
  assert.ok(await table.evaluate(node=>node.scrollWidth<=node.parentElement.clientWidth+1),'Project table must fit its workspace, including status');
  assert.equal(await page.locator('.answer-bar').count(),0,'Project homepage has no metric banner');
  assert.equal(await page.locator('.project-explorer .project-switch').count(),0);
  await variants('工程首页结论与状态');
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.screenshot({path:path.join(out,'project-light.png')});
  if(await page.getByRole('button',{name:'全部重算',exact:true}).count()) {
    await page.getByRole('button',{name:'全部重算',exact:true}).click();
    await expect(page.locator('.study-history-line')).toContainText('依次确认');
    await page.getByRole('button',{name:'结束队列',exact:true}).click();
  }
  report.checks.push('研究五区统一过期状态与可读原因；历史结果可见；工程结论列与逐项重算队列');
  await go(url(current)+'&view=section');
  await expect(page.locator('[data-drawing-canvas="laying"]')).toBeVisible();
  report.drawingTools=await page.evaluate(()=>['.workbench-canvas','.study-drawing','.drawing-frame','.drawing-toolbar','.workbench-views'].map(selector=>{const element=document.querySelector(selector);return {selector,box:element?.getBoundingClientRect().toJSON(),top:element?getComputedStyle(element).top:undefined};}));
  console.log('DRAWING_TOOLS',JSON.stringify(report.drawingTools));
  report.compactResultLabels=await page.locator('[data-result-label]').count();
  if(report.compactResultLabels<3)report.followUp='1366 截面有部分温度退为 title：SectionLabels 优先放名称；需三维线程优先保留全部三根电缆温度标注。';
  await page.setViewportSize({width:1920,height:1080});
  await expect(page.locator('[data-result-label]').first()).toBeVisible();
  await page.setViewportSize({width:1366,height:768});
  await page.getByRole('button',{name:'试算模式',exact:true}).click();
  await expect(page.getByRole('button',{name:'试算模式',exact:true})).toHaveAttribute('aria-pressed','true');
  const cable=page.locator('[data-drawing-canvas="laying"] [data-section-object^="cable/"] .drawing-hit-area').first();
  const box=await cable.boundingBox();assert.ok(box);
  const beforeWorkspace=await request(base,`/api/workspaces/${workspace.id}`);
  const previewResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===prefix+'/preview');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2-25,box.y+box.height/2,{steps:6});
  const released=performance.now();await page.mouse.up();
  const response=await previewResponse;assert.equal(response.status(),200);
  const trial=await response.json();assert.equal(trial.persisted,false);assert.equal(trial.engineering_approval,false);
  await expect(page.locator('[data-what-if-delta]').first()).toContainText(/[-+]\d+\.\d K/);
  report.previewMs=Math.round(performance.now()-released);assert.ok(report.previewMs<=2000,`${report.previewMs} ms > 2000 ms`);
  await page.screenshot({path:path.join(out,'workspace-trial-light.png')});
  await page.getByRole('button',{name:'把这个布置写成方案',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'审核几何方案',exact:true});
  await expect(dialog.getByRole('table',{name:'几何方案改动'})).toBeVisible();
  await dialog.getByRole('button',{name:'采纳为草稿',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.topbar .status-mark')).toContainText('未保存');
  assert.equal((await request(base,`/api/workspaces/${workspace.id}`)).revision,beforeWorkspace.revision,'Proposal adoption cannot save the engineering database');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.topbar .status-mark')).not.toContainText('未保存');
  report.checks.push('保存运行导体温度上图；真实几何试算 2 秒内；审核采纳进入草稿、数据库不写入、Ctrl+Z 撤销');
  // Fault injection changes transport/state metadata only; all numeric evidence
  // remains the same genuine saved run, and no new calculation is submitted.
  for(const state of ['empty','loading','error','success','historical']) {
    let release;
    const gate=new Promise(resolve=>release=resolve),mask='**'+prefix+'/runs?*';
    const body=state==='error'?{detail:{message:'运行记录暂不可用'}}:{items:state==='empty'||state==='loading'?[]:[state==='historical'?{...current,freshness:'historical'}:current]};
    const savedRunMask='**'+prefix+'/runs/'+current.id;
    if(state==='historical')await context.route(savedRunMask,route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...current,freshness:'historical'})}));
    await context.route(mask,async route=>{if(state==='loading')await gate;await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});});
    try {
      await go(`/studies/${study.id}/selection/results?workspace=${workspace.id}&view=section`);
      const label={empty:'未运行',loading:'读取中',error:'失败',success:'当前',historical:'已过期'}[state];
      await expect(page.locator('.topbar > .status-wrap > .status-mark')).toContainText(label);
      await expect(page.locator('.command-state')).toHaveText(label);
      await variants('研究工作台·'+state);
    } finally {release();await context.unroute(mask,{behavior:'wait'});if(state==='historical')await context.unroute(savedRunMask,{behavior:'wait'});}
  }
  report.checks.push('空、加载、错误、成功、历史五态：两种尺寸、深浅主题、字号/对比度/不越界自动断言');
  assert.deepEqual(report.errors,[]);
}
async function verifyRelations() {
  const workspace=(await request(base,'/api/workspaces')).find(item=>item.name.includes('城北'));
  assert.ok(workspace,'Real inquiry project required');
  const study=(await request(base,`/api/workspaces/${workspace.id}/studies`)).find(item=>item.definition.driver.kind==='selection');
  assert.ok(study);
  const route=`/studies/${study.id}/selection/results?workspace=${workspace.id}&view=section`;
  const relationPath=`/api/index/objects/study/${study.id}/relations`;
  const relations=await request(base,relationPath);
  assert.ok(relations.uses.some(row=>row.role==='workspace'&&row.target.id===workspace.id));
  assert.ok(relations.uses.some(row=>row.role==='cable_version'&&row.pinned?.digest),'Saved model version digest is required');
  await go(route);
  const panel=page.locator('.workbench-inspector .relation-panel');
  await expect(panel.getByRole('heading',{name:'用到了',exact:true})).toBeVisible();
  await expect(panel.getByRole('link',{name:workspace.name,exact:true})).toHaveAttribute('href',/\/studies\?.*workspace=/);
  await expect(panel.locator('.relation-role').filter({hasText:'电缆型号版本'})).toBeVisible();
  for(const link of await panel.getByRole('link').all())assert.ok((await link.getAttribute('href'))?.startsWith('/'));
  await expect(page.locator('.workbench-inspector')).not.toContainText(/\+engineering/);
  if((await panel.innerText()).includes('public-sample'))report.followUp='共享 ObjectChip 尚未翻译 public-sample；RelationPanel 未显示当前来源的页码 reason，需 Agent 线程收口。';
  await variants('研究关联·成功');
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'study-light.png')});
  for(const state of ['empty','loading','error','historical']) {
    let release;const gate=new Promise(resolve=>release=resolve);
    const mask='**'+relationPath;
    await context.route(mask,async intercepted=>{
      if(state==='loading'){await gate;return intercepted.fallback();}
      return intercepted.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'关联服务连接中断'}:state==='empty'?{uses:[],used_by:[],unresolved:[]}:{...relations,uses:relations.uses.map(row=>({...row,freshness:'outdated',reason:'测试状态：引用版本已变化'}))})});
    });
    try {
      await go(route);
      await expect(page.locator('.workbench-inspector')).toContainText({empty:'没有引用其他对象',loading:'正在读取关联',error:'关联读取失败',historical:'已变化'}[state]);
      await variants('研究关联·'+state);
    }finally{release();await context.unroute(mask,{behavior:'wait'});}
  }
  await go(`/studies?workspace=${workspace.id}`);
  const projectPanel=page.getByRole('region',{name:'工程关联'});
  await expect(projectPanel.getByRole('heading',{name:'被用于',exact:true})).toBeVisible();
  await expect(page.locator('.workbench-inspector .inspector-list').first()).not.toContainText(/\+engineering|public-sample/);
  await variants('工程关联·成功');
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await projectPanel.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'project-light.png')});
  const method=relations.uses.find(row=>row.role==='method');assert.ok(method);
  await go(route);await panel.getByRole('link').filter({hasText:method.target.name}).click();await expect(page).toHaveURL(/\/plugins\//);
  report.checks.push('研究/工程共用索引关联；型号摘要固定；可读版本；插件跳转；两尺寸深浅主题五态');
  // Public annotated original, real offline extraction and explicitly reviewed
  // proposal. All writes occur only in this script's disposable database.
  const sample=JSON.parse(await fs.readFile(path.join(repositoryRoot,'plugins/cablesim.datasheet-extract/validation/labels.json'),'utf8')).samples[0];
  const bytes=await fs.readFile(path.join(repositoryRoot,'.data/datasheet-import/sources',sample.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sample.sha256);
  const upload=new FormData();upload.append('file',new Blob([bytes],{type:'application/pdf'}),sample.file);
  const response=await fetch(base+'/api/documents',{method:'POST',body:upload});assert.equal(response.status,201);
  const document=await response.json(), prefix=`/api/documents/${document.id}`;
  let extraction=await request(base,prefix+'/extractions','POST',{request_id:randomUUID(),method:'rules',model:sample.model,selections:sample.selections});
  await expect.poll(async()=>{extraction=await request(base,prefix+'/extractions/'+extraction.id);return extraction.status;},{timeout:120000}).toBe('succeeded');
  const reviewed=await request(base,prefix+'/extractions/'+extraction.id+'/reviews','POST',{request_id:randomUUID(),expected_revision:0,reviewer:'公开样本标注核验',decisions:extraction.result.candidates.map(c=>({candidate_id:c.id,action:sample.truth[c.field]&&Math.abs(sample.truth[c.field].value_si-c.value_si)<1e-10&&!c.ambiguities.length?'accept':'reject',reason:'与厂家原件及独立标注的行列数值核对'}))});
  const proposal=await request(base,prefix+'/proposals','POST',{request_id:randomUUID(),extraction_id:extraction.id,expected_review_revision:reviewed.revision,version:'原文核对稿',new_model:{name:'Bahra 6/10 kV 1×185 · 关联验收',manufacturer:'Bahra',designation:sample.model.designation,u0_v:6000,voltage_v:10000,cores:1,area_m2:.000185,conductor:'copper_bare',identity_reference:'公开样本 PDF20–21，CU/XLPE/LC/PVC 单芯铜185mm² 6/10kV，与标注一致'}});
  const approved=await request(base,prefix+'/proposals/'+proposal.id+'/approval','POST',{request_id:randomUUID(),proposal_sha256:proposal.sha256,approver:'关联验收工程师',human_approved:true});
  const model=(await request(base,'/api/domain-cable-models')).find(item=>item.id===approved.new_model_id);
  const source=JSON.parse(model.payload.sources.source_document.reference);
  assert.equal(source.document_id,document.id);assert.equal(source.original_sha256,sample.sha256);
  const modelRelations=await request(base,`/api/index/objects/cable_version/${model.id}/relations`);
  const original=modelRelations.uses.find(row=>row.role==='source_document'&&row.target.id===document.id);
  assert.equal(original.freshness,'current');assert.equal(original.pinned.digest,sample.sha256);assert.match(original.reason,/20.*21/);
  report.documentAssociation={manufacturer:'Bahra',pages:source.selections.map(item=>item.page),sha256:sample.sha256,modelVersion:model.payload.version};
  report.checks.push('真实厂家 PDF→离线提取→逐项核对→批准新型号→统一索引原件ID/页码/SHA256关系');
  assert.deepEqual(report.errors,[]);
}
try{verification:{
  if(process.env.COMPONENT_RELATIONS_ONLY==='1'){await verifyRelations();break verification;}
  if(process.env.COMPONENT_ASSOCIATIONS_ONLY==='1'){await verifyAssociations();break verification;}
  report.catalogFirstHttpMs={};for(const endpoint of ['/api/input-contracts','/api/methods']){const started=performance.now();const reply=await fetch(base+endpoint);assert.ok(reply.ok);await reply.json();const elapsed=Math.round(performance.now()-started);report.catalogFirstHttpMs[endpoint]={elapsed,cache:reply.headers.get('X-CableSim-Read-Cache'),serverTiming:reply.headers.get('Server-Timing')};assert.ok(elapsed<300,`${endpoint}: ${JSON.stringify(report.catalogFirstHttpMs[endpoint])} >= 300 ms`);}
  const scripts=[]; const listener=response=>{if(response.request().resourceType()==='script'&&response.url().includes('/assets/'))scripts.push(response.body().then(body=>({url:new URL(response.url()).pathname,gzip:gzipSync(body).length})));};
  page.on('response',listener);await go('/studies');await expect(page.getByRole('table').first()).toBeVisible();await page.waitForTimeout(17000);page.off('response',listener);
  report.initialJavaScript=await Promise.all(scripts);report.initialGzipBytes=report.initialJavaScript.reduce((n,item)=>n+item.gzip,0);
  assert.equal(await page.getByText('读取中',{exact:true}).count(),0,'Runs must resolve or give an error within the timeout');
  await variants('研究列表');report.checks.push('运行列表不永久读取中');console.log('研究列表完成');
  if(process.env.COMPONENT_BUNDLE_ONLY==='1')break verification;
  if(process.env.COMPONENT_FEM_ONLY==='1'){
    let target;
    for(const workspace of await request(base,'/api/workspaces')){
      for(const study of await request(base,`/api/workspaces/${workspace.id}/studies`)){
        if(study.definition.method.capability!=='iec-thermal-field')continue;
        const runs=(await request(base,`/api/workspaces/${workspace.id}/studies/${study.id}/runs?view=summary`)).items;
        const run=runs.findLast(value=>value.integrity==='verified'&&value.status==='succeeded'&&(!process.env.COMPONENT_FEM_RUN||value.id===process.env.COMPONENT_FEM_RUN));
        if(run){target={workspace,study,run};break;}
      }
      if(target)break;
    }
    assert.ok(target,'Saved real FEM run required; no local solver is started');
    const {workspace,study,run}=target;
    const viewUrl=`/api/hpc/workspaces/${workspace.id}/fields/${run.id}/view`, loads=[];
    const listener=response=>{if(new URL(response.url()).pathname===viewUrl)loads.push(response.json());};page.on('response',listener);
    const started=performance.now();
    await go(`/studies/${study.id}/thermal-field/field?workspace=${workspace.id}&run=${run.id}`);
    await expect(page.locator('.workbench-canvas .field-view')).toBeVisible();
    await expect(page.locator('.workbench-canvas .field-canvas')).toBeVisible();
    assert.equal(await page.locator('.workbench-canvas .field-object:not(.field-object-outline)').count(),0,'FEM conductor temperatures must not be masked');
    report.fieldOpenMs=Math.round(performance.now()-started);
    const propertyTabs=page.getByRole('tablist',{name:'属性分页'}), mountedField=await page.locator('.workbench-canvas .field-view').elementHandle(), switchStarted=performance.now();
    await propertyTabs.getByRole('tab',{name:'Agent',exact:true}).click();
    await expect(page.locator('.inspector-agent .agent-panel-model')).toBeVisible();
    report.fieldAgentSwitchMs=Math.round(performance.now()-switchStarted);
    assert.ok(report.fieldAgentSwitchMs<2000,'Large saved field must remain interactive when switching Agent');
    assert.ok(await mountedField.evaluate(element=>element.isConnected));await mountedField.dispose();
    await propertyTabs.getByRole('tab',{name:'输入',exact:true}).click();
    assert.ok(loads.length,'Main canvas must use the verified /view projection');
    const projected=await loads[0];
    assert.ok(projected.output.cases.every(row=>Object.keys(row.artifacts||{}).every(key=>!key.startsWith('x-cablesim.field-'))),'Lossless shards must stay on server');
    const field=projected.output.cases.map(row=>row.artifacts?.['x-cablesim.temperature-field']).find(Boolean);
    report.displayNodes=field.mesh.points.length;report.fullMeshNodes=field.convergence?.full_mesh_nodes;
    if(field.convergence?.display_decimated){
      const sample=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith(`/fields/${run.id}/sample`),{timeout:30000});
      await page.locator('.workbench-canvas .field-view').hover({position:{x:150,y:150}});
      const response=await sample;assert.ok(response.ok());const value=await response.json();assert.equal(value.mesh,'full');assert.ok(value.temperature_k.every(n=>typeof n==='number'));
      report.fullMeshSample=value.temperature_k;await page.mouse.move(10,10);
    }
    page.off('response',listener);
    await variants('保存有限元运行画布');
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await page.screenshot({path:path.join(out,'fem-workbench-light.png')});
    await page.getByRole('button',{name:'运行记录',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'运行记录',exact:true})).toContainText('成功');
    assert.deepEqual(report.writes.filter(item=>!(item.method==='POST'&&new URL(item.url).pathname===`/api/hpc/workspaces/${workspace.id}/fields/${run.id}/sample`)),[],'Saved FEM verification permits read-only full-mesh sampling, but must not calculate or mutate inputs');
    report.checks.push('真实保存有限元运行：主画布不遮蔽导体、运行记录、深浅主题和两种尺寸');
    report.femRun={id:run.id,sequence:run.sequence};break verification;
  }
  await page.getByRole('radio',{name:'Agent',exact:true}).click();await expect(page.locator('[data-page="agent"]')).toBeVisible();await expect(page.getByText('未连接模型',{exact:true}).first()).toBeVisible();await page.getByRole('radio',{name:'工作台',exact:true}).click();await expect(page).toHaveURL(/\/studies/);
  const all=[];for(const w of await request(base,'/api/workspaces'))for(const s of await request(base,`/api/workspaces/${w.id}/studies`))all.push({w,s});
  const selection=all.find(({s})=>s.definition.title.includes('城北')&&s.definition.driver.kind==='selection');assert.ok(selection);
  if(process.env.COMPONENT_REPORT_ONLY!=='1'){
  const single=all.find(({s})=>s.definition.title.includes('城南')&&s.definition.driver.kind==='single');assert.ok(single,'Existing single study');
  const {w,s}=single,prefix=`/api/workspaces/${w.id}/studies/${s.id}`,url=tab=>`/studies/${s.id}/${tab}?workspace=${w.id}`;
  await page.setViewportSize({width:1366,height:768});await page.goto('about:blank');const cdp=await context.newCDPSession(page);await cdp.send('Network.clearBrowserCache');await cdp.detach();const coldStart=performance.now();await page.goto(base+url('ampacity/results')+'&inspector=input');await expect(page.getByRole('textbox',{name:'地表温度',exact:true})).toBeEditable();report.firstInteractiveMs=Math.round(performance.now()-coldStart);assert.ok(report.firstInteractiveMs<=2000,`研究首屏 ${report.firstInteractiveMs} ms > 2000 ms`);
  await page.getByRole('tab',{name:'方法',exact:true}).click();
  await page.getByRole('combobox',{name:'方法版本',exact:true}).click();
  const options=page.getByRole('option').filter({hasText:'IEC 60287',hasNotText:'保存版本'});await expect(options.first()).toBeVisible();await options.first().click();
  await expect(page.locator('.buzzform-contract')).toBeVisible();await expect(page.locator('.workbench-inspector input[data-field-path="/ks"]')).toBeEditable();report.methodReadyMs=Math.round(performance.now()-coldStart);await variants('真实方法参数');
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,'parameters-light.png')});
  report.parameterFields=await page.locator('.buzzform-contract input').evaluateAll(nodes=>nodes.map(n=>({path:n.dataset.fieldPath,value:n.value,type:n.type,label:n.getAttribute('aria-label')})));
  console.log('PARAMETER_FIELDS',JSON.stringify(report.parameterFields));
  const advanced=page.locator('.workbench-inspector summary').filter({hasText:'高级参数'});if(await advanced.count())await advanced.click();const factor=page.locator('input[data-field-path="/ks"]');await expect(factor).toBeVisible();await expect(factor).toBeEditable();
  await factor.fill('1.2');await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(factor).toHaveAttribute('aria-invalid','true');await expect(factor).toBeFocused();assert.equal(report.writes.length,0);
  await factor.fill('0.8');await factor.blur();
  const parameterSave=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===prefix);
  await page.getByRole('button',{name:'保存修改',exact:true}).click();assert.equal((await parameterSave).status(),200);
  const saved=(await request(base,`/api/workspaces/${w.id}/studies`)).find(row=>row.id===s.id);assert.equal(saved.definition.parameters.ks,0.8);report.checks.push('Buzzform范围校验定位字段、正式保存与读回');
  await go(url('ampacity/results')+'&view=cable');await page.locator('.inspector-layers').getByRole('button',{name:'查看',exact:true}).click();await expect(page.locator('[role="grid"]')).toBeVisible();await variants('真实分层表');
  report.grid=await page.locator('[role="grid"]').innerText();report.gridCells=await page.locator('[role="gridcell"]').evaluateAll(nodes=>nodes.slice(0,24).map(n=>({text:n.textContent,attrs:[...n.attributes].map(a=>[a.name,a.value])})));
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  console.log('分层表完成');
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));
  await expect(page.locator('[role="gridcell"][data-column-id="diameter"]').first()).toHaveAttribute('data-readonly','true');
  const unlocked=all.find(({w,s})=>w.id==='b9ee1ceb-92d4-48ed-8f3b-bd7b8818b88c'&&s.definition.driver.kind==='single');assert.ok(unlocked);
  await page.keyboard.press('Escape');await go(`/studies/${unlocked.s.id}/ampacity/results?workspace=${unlocked.w.id}&view=cable`);await page.locator('.inspector-layers').getByRole('button',{name:'查看',exact:true}).click();await expect(page.locator('[role="grid"]')).toBeVisible();
  const cells=page.locator('[role="gridcell"][data-column-id="thickness"]:not([data-readonly])');assert.ok(await cells.count()>=2);
  console.log('分层编辑开始');
  const initial=await cells.allTextContents();await cells.first().dblclick();const editor=page.locator('[role="gridcell"][data-editing] input');await editor.fill('2.5');await editor.press('Enter');await expect(cells.first()).toHaveText('2.5');
  await page.getByRole('dialog',{name:'电缆分层',exact:true}).getByRole('button',{name:'撤销',exact:true}).click();await expect(cells.first()).toHaveText(initial[0]);await page.getByRole('dialog',{name:'电缆分层',exact:true}).getByRole('button',{name:'重做',exact:true}).click();await expect(cells.first()).toHaveText('2.5');
  await cells.first().click();await context.grantPermissions(['clipboard-read','clipboard-write']);await page.evaluate(()=>navigator.clipboard.writeText('2.6\n2.7'));await page.keyboard.press('Control+v');await expect(cells.first()).toHaveText('2.6');await expect(cells.nth(1)).toHaveText('2.7');
  await page.getByRole('dialog',{name:'电缆分层',exact:true}).getByRole('button',{name:'撤销',exact:true}).click();await expect(cells.first()).toHaveText('2.5');await expect(cells.nth(1)).toHaveText(initial[1]);
  await cells.first().click();await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Control+d');await expect(cells.nth(1)).toHaveText('2.5');await page.getByRole('dialog',{name:'电缆分层',exact:true}).getByRole('button',{name:'撤销',exact:true}).click();await expect(cells.nth(1)).toHaveText(initial[1]);
  const domainPath=`/api/workspaces/${unlocked.w.id}/domain`,write=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===domainPath);await page.getByRole('button',{name:'保存分层',exact:true}).click();assert.equal((await write).status(),200);
  console.log('分层保存完成');
  const payload=report.writes.findLast(r=>r.url.endsWith(domainPath)).body;assert.ok(Number.isInteger(payload.expected_revision));assert.ok(JSON.stringify(payload.document).includes('0.0025'));await expect(page.getByRole('button',{name:'保存分层',exact:true})).toBeDisabled();
  await cells.first().dblclick();await editor.fill('2.8');await editor.press('Enter');await context.route('**'+domainPath,route=>route.request().method()==='PUT'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:{code:'REVISION_CONFLICT',message:'工程修订已变化'}})}):route.continue());await page.getByRole('button',{name:'保存分层',exact:true}).click();await expect(page.locator('.layer-grid-module [role="alert"]')).toBeVisible();await expect(cells.first()).toHaveText('2.8');await context.unroute('**'+domainPath);report.checks.push('真实锁定输入只读；分层编辑、粘贴、填充、单次撤销、SI保存、409保留草稿');
  report.checks.push('真实接口方法表单与分层表渲染');
  const runPath=`/api/workspaces/${selection.w.id}/studies/${selection.s.id}/runs`,runs=(await request(base,runPath+'?view=summary')).items,run=runs.at(-1);assert.ok(run);
  const resultUrl=`/studies/${selection.s.id}/selection/results?workspace=${selection.w.id}&run=${run.id}`;
  await go(resultUrl);await expect(page.locator('table[data-slot="table"]').first()).toBeVisible();await variants('真实运行结果');
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.getByRole('button',{name:'运行记录',exact:true}).click();const drawer=page.getByRole('dialog',{name:'运行记录',exact:true});await expect(drawer.locator('.run-records-content')).toBeVisible();await expect(drawer).toContainText('历史结果');await variants('历史运行记录');await page.keyboard.press('Escape');
  // Compare actual stored runs, not generated display fixtures. No run submission
  // is allowed while opening the comparison or generating its source report.
  const comparable=runs.filter(row=>['succeeded','partial','failed'].includes(row.status));assert.ok(comparable.length>=2,'Two saved runs');
  await page.getByRole('button',{name:'运行记录',exact:true}).click();await drawer.locator(`input[data-run-id="${comparable[0].id}"]`).check();await drawer.locator(`input[data-run-id="${comparable.at(-1).id}"]`).check();
  const compared=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/study-comparisons'));
  const beforeCompare=report.writes.length;await drawer.getByRole('button',{name:'对比所选运行',exact:true}).click();const response=await compared;assert.equal(response.status(),200);const comparison=await response.json();
  await expect(drawer.getByRole('table',{name:'结论量值',exact:true})).toBeVisible();await expect(drawer.getByRole('table',{name:'限制对象',exact:true})).toBeVisible();
  const labels=await drawer.locator('.run-comparison .reference-list').innerText();assert.ok(/运行 \d+/.test(labels));assert.ok(!/[0-9a-f]{8}-[0-9a-f-]{27}/.test(labels),'Comparison labels cannot expose raw run IDs');
  assert.deepEqual(comparison.sources.map(row=>row.run_id),[comparable[0].id,comparable.at(-1).id]);
  assert.ok(report.writes.slice(beforeCompare).every(row=>row.url.endsWith('/study-comparisons')),'Comparison cannot run a method');
  const inputDifferences=drawer.getByRole('table',{name:'输入差异（SI）',exact:true}),caseGroup=inputDifferences.getByRole('button',{name:'展开工况 1',exact:true});
  if(await inputDifferences.count())await expect(inputDifferences).toBeVisible();else await expect(drawer.getByText('输入相同',{exact:true})).toBeVisible();
  if(await caseGroup.count()){await caseGroup.click();await expect(inputDifferences).toContainText(/(?:m²|m|A|K·m\/W)/);await inputDifferences.getByRole('button',{name:'收起工况 1',exact:true}).click();}
  await variants('保存运行对比');await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await drawer.getByRole('heading',{name:'保存运行对比',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'comparison-light.png')});await page.keyboard.press('Escape');report.checks.push('两次保存运行结论、限制对象、SI字段差异；不重新计算');
  for(const state of ['empty','loading','error','queued','running','failed','succeeded']){
    let release;const gate=new Promise(resolve=>release=resolve),mask='**'+runPath+'*';
    await context.route(mask,async route=>{if(state==='loading')await gate;await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'运行记录暂不可用'}:{items:state==='empty'||state==='loading'?[]:[{...run,status:state,finished:['queued','running'].includes(state)?null:run.finished}]})}).catch(()=>{});});
    await go(resultUrl);await page.getByRole('button',{name:'运行记录',exact:true}).click();
    const copy={empty:'尚无运行记录',loading:'正在读取运行记录',error:'运行记录读取失败',queued:'排队',running:'运行中',failed:'失败',succeeded:'成功'}[state];await expect(drawer).toContainText(copy);await variants('运行记录'+state);release();await page.keyboard.press('Escape');await context.unroute(mask,{behavior:'wait'});
  }
  report.checks.push('真实结果与历史快照；运行记录空、加载、错误及排队/执行/成功/失败状态');
  const scan=all.find(({s})=>s.definition.driver.kind==='sweep');assert.ok(scan,'Existing saved parameter sweep');
  await go(`/studies/${scan.s.id}/sweep/curve?workspace=${scan.w.id}`);
  await expect(page.locator('.study-sweep-results .series-chart text').first()).toBeVisible();
  report.sweepContrast=[];
  for(const size of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']){
    await page.setViewportSize(size);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);
    await assertLayout(page,'保存参数扫描曲线');const values=await sweepContrast();assert.ok(values.length&&values.every(value=>value.ratio>=4.5),JSON.stringify(values));
    report.sweepContrast.push({...size,theme,minimum:Math.min(...values.map(value=>value.ratio))});
  }
  report.checks.push('保存扫描曲线：两种尺寸、深浅主题文字对比度至少4.5');
  }
  // Use this database's real inquiry and its explicit current-version run;
  // target load is saved input, not a hardcoded fixture selector.
  const inquiryPrefix=`/api/workspaces/${selection.w.id}/studies/${selection.s.id}`;
  const currentWorkspace=await request(base,`/api/workspaces/${selection.w.id}`),currentStudy=await request(base,inquiryPrefix);
  const setupStarted=performance.now();let currentRun=await request(base,inquiryPrefix+'/recalculate','POST',{expected_revision:currentWorkspace.revision,expected_study_revision:currentStudy.revision,request_id:randomUUID(),scope_acknowledged:true});
  while(['accepted','queued','running','validating'].includes(currentRun.status)&&performance.now()-setupStarted<180000){await page.waitForTimeout(500);currentRun=await request(base,inquiryPrefix+'/runs/'+currentRun.id);}
  assert.ok(['succeeded','partial'].includes(currentRun.status)&&currentRun.integrity==='verified','Saved current IEC inquiry must succeed');
  const source={study:currentStudy,run:currentRun};report.currentInquirySetupMs=Math.round(performance.now()-setupStarted);
  const deliveryPath=`/api/workspaces/${source.study.workspace}/deliveries/current`;
  await go(`/studies/${source.study.id}/selection/results?workspace=${source.study.workspace}&run=${source.run.id}`);
  await page.getByRole('button',{name:'三维',exact:true}).click();
  await expect(page.locator('.cad-viewport')).toHaveAttribute('aria-busy','false',{timeout:180000});
  await expect(page.locator('.cad-canvas-host canvas')).toBeVisible();
  await expect(page.getByText('保存运行',{exact:true}).first()).toBeVisible();
  const cadDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出 PNG',exact:true}).click();
  await (await cadDownload).saveAs(path.join(out,'selected-run-3d.png'));
  await expect(page.getByText('三维图已选入计算书',{exact:true})).toBeVisible();
  report.checks.push('统一三维入口；推荐候选保存输入和运行着色；导出图绑定所选运行');
  let releaseDelivery;const deliveryGate=new Promise(resolve=>releaseDelivery=resolve);let deliveryAttempt=0,deliveredBook;
  await context.route('**'+deliveryPath,async route=>{deliveryAttempt++;if(deliveryAttempt===1){await deliveryGate;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{code:'DELIVERY_UNAVAILABLE',message:'交付服务暂不可用'}})});}const response=await route.fetch();deliveredBook=await response.json();return route.fulfill({response});});
  await page.getByRole('toolbar',{name:'工程命令',exact:true}).getByRole('button',{name:'生成计算书',exact:true}).click();
  await expect(page.getByText('正在生成客户计算书',{exact:true})).toBeVisible();await variants('计算书生成中');releaseDelivery();await expect(page.getByText('生成失败',{exact:true})).toBeVisible();await variants('计算书生成失败');
  await expect(page.getByRole('checkbox',{name:'插入三维导出图（含色标与来源）',exact:true})).toBeChecked();
  const delivered=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===deliveryPath);
  await page.getByRole('button',{name:'重新生成',exact:true}).click();const deliveredResponse=await delivered;assert.ok([200,201].includes(deliveredResponse.status()));const book=deliveredBook;assert.equal(book.sources[0].run_id,source.run.id);assert.equal(book.sources[0].input_digest,source.run.input_digest);assert.equal(book.sources[0].output_digest,source.run.output_digest);
  const pdfLink=book.html.match(/<a[^>]*data-report-pdf="customer"[^>]*href="data:application\/pdf;base64,([A-Za-z0-9+/=]+)"/);assert.ok(pdfLink,'Stored customer PDF');const pdf=Buffer.from(pdfLink[1],'base64');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');await fs.mkdir(path.join(outputRoot,'workbench'),{recursive:true});await fs.writeFile(path.join(outputRoot,'workbench','inquiry-customer.pdf'),pdf);
  assert.ok(book.html.includes('data-report-attachment="saved"'),'Saved CAD image is embedded into delivery');
  const attachment=JSON.parse(book.html.match(/<script type="application\/json" data-report-attachments>(.*?)<\/script>/s)[1]);assert.equal(attachment.cad_images[0].metadata.field.runId,source.run.id);assert.match(attachment.cad_images[0].image_sha256,/^[a-f0-9]{64}$/);
  await expect(page.locator('iframe[title="计算书预览"]')).toBeVisible();await expect(page.locator('iframe[title="计算书预览"]')).toHaveAttribute('src',/^blob:/);await expect(page.getByText('已生成 · 所选运行',{exact:true})).toBeVisible();await variants('计算书生成成功',{includeFrames:false});await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,'report-light.png')});await context.unroute('**'+deliveryPath);report.checks.push('命令栏按所选运行生成；加载/失败重试/成功客户PDF预览；输入输出摘要一致');
  assert.deepEqual(report.errors,[]);
}}catch(error){report.failure=String(error.stack||error).slice(0,6000);console.error(report.failure);console.error((await page.locator('body').innerText().catch(()=> '验收浏览器已关闭')).slice(0,5000));process.exitCode=1;}
finally{await fs.writeFile(path.join(out,process.env.COMPONENT_BUNDLE_ONLY==='1'?'bundle.json':process.env.COMPONENT_FEM_ONLY==='1'?'fem.json':process.env.COMPONENT_REPORT_ONLY==='1'?'report.json':'verification.json'),JSON.stringify(report,null,2));await context.unrouteAll({behavior:'ignoreErrors'});await session.close();}
console.log(JSON.stringify({checks:report.checks,variants:report.variants.length,initialGzipBytes:report.initialGzipBytes,errors:report.errors,failure:report.failure?.slice(0,600)}));
