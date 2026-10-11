import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as playwrightExpect } from '@playwright/test';
const expect=playwrightExpect.configure({timeout:30000});
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
if(process.env.E2E_ISOLATED!=='1') throw Error('仅允许隔离数据库');
const base=process.env.FRONTEND_URL, phase=process.env.READABILITY_PHASE || 'after';
const statusOnly=process.env.READABILITY_STATUS_ONLY==='1';
const previewOnly=process.env.READABILITY_PREVIEW_ONLY==='1';
if(statusOnly && process.env.E2E_DEV!=='1')throw Error('发行提示单元场景需 Vite 开发模块');
const out=path.join(repositoryRoot,'.data/fix-round/research/readability',phase);
await fs.mkdir(out,{recursive:true});
const projects=await request(base,'/api/workspaces'),studies=[];
for(const project of projects)studies.push(...await request(base,`/api/workspaces/${project.id}/studies`));
const rating=studies.find(s=>s.definition.driver.kind==='single' && s.definition.method.plugin_id==='cablesim.iec60287' && s.latest_run);
const selection=studies.find(s=>s.definition.driver.kind==='selection' && s.latest_run);
assert(rating && selection);
const canvasTestView=process.env.READABILITY_VIEW || 'field';
const session=await openHeadlessBrowser(),{page}=session,report={phase,checks:[],screens:[],errors:[],consoleErrors:[],matrix:[],canvasTestView};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',item=>{if(item.type()==='error')report.consoleErrors.push(item.text());});
const url=(s,module,tab)=>`${base}/studies/${s.id}/${module}/${tab}?workspace=${s.workspace}&theme=light&view=${canvasTestView}`;
async function shot(name){await page.waitForTimeout(200);await expect(page.getByText('Something went wrong!',{exact:true})).toHaveCount(0);const file=path.join(out,name+'.png');await page.screenshot({path:file});report.screens.push(file);console.log('可读性复测：'+name);}
async function go(s,module,tab){
 await page.goto(url(s,module,tab));
 try{await expect(page.getByRole('toolbar',{name:'工程命令'})).toBeVisible();}
 catch(error){const show=page.getByRole('button',{name:'Show Error',exact:true});if(await show.count())await show.click();report.routeError=await page.locator('body').innerText();await page.screenshot({path:path.join(out,'route-blocked.png')});console.error(report.routeError,report.errors,report.consoleErrors);throw error;}
}
async function layout(state){
 for(const theme of ['light','dark'])for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
  await page.setViewportSize(viewport);await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);await page.waitForTimeout(250);
  const measured=await page.evaluate(()=>{
   const color=s=>s.match(/[\d.]+/g)?.map(Number)||[];
   const lum=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   const issues=[];let minimum=Infinity,contrast=Infinity;
   const nodes=document.querySelectorAll('.study-workbench *, .study-inspector *, .provider-state *, .route-skeleton *, [role="dialog"] *');
   for(const node of nodes){
    const box=node.getBoundingClientRect(),style=getComputedStyle(node);
    if(!box.width||!box.height||style.visibility==='hidden'||node.closest('[disabled],[aria-hidden="true"],svg')||!Array.from(node.childNodes).some(n=>n.nodeType===3&&n.textContent.trim()))continue;
    const size=parseFloat(style.fontSize);minimum=Math.min(minimum,size);
    let parent=node,bg=[];while(parent){bg=color(getComputedStyle(parent).backgroundColor);if(bg.length===3||bg[3]>=1)break;parent=parent.parentElement;}
    if(bg.length<3)continue;
    const fg=color(style.color),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);contrast=Math.min(contrast,ratio);
    if(size<13||ratio<4.5)issues.push({text:node.textContent.trim().slice(0,70),class:node.className,size,contrast:ratio});
   }
   const metrics=[...document.querySelectorAll('.conclusion-metrics > div')].map(n=>n.getBoundingClientRect());
   const overlap=metrics.some((a,i)=>metrics.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));
   return {overflow:document.documentElement.scrollWidth>innerWidth,overlap,minimum,contrast,issues,roots:document.querySelectorAll('.study-workbench,.provider-state,.route-skeleton').length};
  });
  report.matrix.push({state,theme,viewport,...measured});assert(measured.roots>0,'页面不能落入路由异常边界');assert.equal(measured.overflow,false);assert.equal(measured.overlap,false);assert.deepEqual(measured.issues,[],JSON.stringify(measured.issues));
 }
 await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
 await page.setViewportSize({width:1366,height:768});
}
async function verifyReleaseNotice(){
 const notice=await page.evaluate(async ()=>{
  const {studyPresentation}=await import('/src/components/study-status.tsx');
  const sample={raw:{},definition:{input_source:'domain'},latest_run:undefined};
  const run={status:'succeeded',freshness:'historical',version_status:{status:'stale',reasons:[{code:'METHOD_VERSION_CHANGED',id:'cablesim.iec60287',from_version:'1.1.1',to_version:'1.1.1',from_digest:'old-release',to_digest:'current-release'}]}};
  const value=studyPresentation(sample,run);return {reason:value.reason,details:value.releaseDetails};
 });
 assert.equal(notice.reason,'方法发行内容已更新（版本号未变），结果需重算');assert(notice.details.includes('old-release')&&notice.details.includes('current-release'));report.checks.push('同版本发行更新用人话说明，摘要留在详情');
 const projection=await page.evaluate(async()=>{
  const {previewDifference}=await import('/src/components/study-preview.tsx');
  const {engineeringContractFields}=await import('/src/components/study-method-form.tsx');
  // Contract projection unit fixture: nested references, enum labels, SI bounds
  // and requiredness. These are input metadata, not simulated engineering results.
  const schema={type:'object',properties:{values:{type:'object',required:['conductor_form'],properties:{
   conductor_form:{$ref:'#/$defs/Form'},pitch:{title:'成缆节距',properties:{value:{type:'number',exclusiveMinimum:0,maximum:10,'x-unit':{si:'m',display:'mm',scale:1000}},unit:{const:'m'}}}
  }}},$defs:{Form:{title:'导体结构',properties:{value:{enum:['round','sector'],'x-enum-labels':{round:'圆形',sector:'扇形'}},unit:{const:'1'}}}}};
  return {fields:engineeringContractFields(schema),noise:[previewDifference(1.5e-6,'A'),previewDifference(-.09,'K'),previewDifference(.149,'A'),previewDifference(-.26,'°C')]};
 });
 assert.equal(projection.fields[0].title,'导体结构');assert.equal(projection.fields[0].optional,false);
 assert.deepEqual(projection.fields[0].choices,[['round','圆形'],['sector','扇形']]);
 assert.equal(projection.fields[1].unit,'m');assert.equal(projection.fields[1].display.scale,1000);
 assert.equal(projection.fields[1].minExclusive,true);assert.equal(projection.fields[1].max,10);
 assert.deepEqual(projection.noise.slice(0,3).map(row=>row.label),['无变化','无变化','0.1']);assert.equal(projection.noise[3].rounded,-0.3);
 report.checks.push('补录参数沿用契约中文名、必填、枚举、范围和 SI 换算；试算差值去除低于显示精度的噪声');
}
try {
 if(statusOnly){await page.goto(base);await verifyReleaseNotice();}
 else{
 await page.setViewportSize({width:1366,height:768});
 if(!previewOnly){
 await go(selection,'selection','results');await expect(page.getByRole('table',{name:'真实选型候选'})).toBeVisible();await shot('candidate-1366');
 if(phase==='after')await layout('history');
 if(phase==='after'){
  if(process.env.E2E_DEV==='1')await verifyReleaseNotice();
  const headers=await page.locator('.study-selection-table thead th').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,width:node.getBoundingClientRect().width,whiteSpace:getComputedStyle(node).whiteSpace})));
  assert(headers.every(h=>h.whiteSpace==='nowrap'));assert(headers[2].width>=85);report.checks.push('候选量名不拆词、数值列固定内容宽度');
 }
 await go(rating,'ampacity','results');await shot('results-1366');
 if(phase==='after'){
  const fold=page.locator('.study-detail-group').first();await expect(fold).not.toHaveAttribute('open','');await fold.locator('summary').click();await expect(fold).toHaveAttribute('open','');
  await page.reload();await expect(fold).toHaveAttribute('open','');await fold.locator('summary').click();report.checks.push('明细默认折叠、展开状态刷新后保留');
  assert(await page.locator('.workbench-canvas').evaluate(node=>node.getBoundingClientRect().height)>=220);report.checks.push('1366 画布高度至少 220 px');
 }
 await go(rating,'ampacity','detail');await shot('heat-1366');
 await go(rating,'ampacity','validation');await shot('validation-1366');
 await go(selection,'selection','results');await page.getByRole('button',{name:'撤销',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:phase==='after'?'撤销上一次保存？':'撤销已保存修改',exact:true});await expect(dialog).toBeVisible();await shot('undo-1366');
 if(phase==='after'){assert.deepEqual(await dialog.getByRole('button').allTextContents(),['取消','撤销保存']);await expect(dialog).not.toContainText('本地草稿已到边界');report.checks.push('保存撤销仅两个按钮、明确工程共用影响');}
 await page.keyboard.press('Escape');
 }
 // Select the installed release only in the private copy. Saved old runs remain
 // historical; a real preview must not invoke a method release no longer installed.
 const methods=await request(base,'/api/methods');
 const installed=methods.find(m=>m.method.plugin_id==='cablesim.iec60287');
 const latestStudy=await request(base,`/api/workspaces/${rating.workspace}/studies/${rating.id}`);
 const workspace=await request(base,`/api/workspaces/${rating.workspace}`);
 const definition=structuredClone(latestStudy.definition);
 for(const config of [definition,...Object.values(definition.modules || {})])if(config.method?.plugin_id===installed.method.plugin_id)config.method={...installed.method,capability:config.method.capability};
 await request(base,`/api/workspaces/${rating.workspace}/studies/${rating.id}`,'PUT',{...definition,expected_revision:workspace.revision,expected_study_revision:latestStudy.revision});
 await go(rating,'ampacity','results');
 const current=page.locator('.inspector-conditions').getByRole('textbox',{name:/电流/}).first();await current.fill(String(Number(await current.inputValue())+50));await current.press('Tab');
 const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preview'));await page.getByRole('button',{name:'试算',exact:true}).click();const reply=await response,result=await reply.json();report.preview={httpStatus:reply.status(),status:result.status,error:result.detail};assert(reply.ok(),JSON.stringify(result));assert.equal(result.status,'succeeded');await expect(page.getByRole('status',{name:'试算结果'})).toBeVisible();await shot('preview-1366');
 const trialLayout=await page.locator('.preview-strip').evaluate(node=>({scroll:node.scrollWidth>node.clientWidth,wrap:getComputedStyle(node).flexWrap,overflow:getComputedStyle(node).overflowX}));
 assert.equal(trialLayout.scroll,false);assert.equal(trialLayout.wrap,'wrap');report.checks.push('真实试算对比换行，无内部横向滚动条');
 const loadWidth=await current.evaluate(node=>node.getBoundingClientRect().width);
 assert(loadWidth>=50,`负荷输入框应保留可读宽度，实际 ${loadWidth}`);report.loadInputWidth=loadWidth;
 if(previewOnly){
  if(process.env.E2E_DEV==='1')await verifyReleaseNotice();
  assert(await page.locator('.workbench-canvas').evaluate(node=>node.getBoundingClientRect().height)>=220);
  await layout('success-preview');
  const optional=page.getByRole('region',{name:'附加热源',exact:true});
  await expect(optional).toContainText('未设置');
  assert(await optional.evaluate(node=>node.getBoundingClientRect().height)<=40,'未设置热源只占一行');
  assert(await optional.evaluate(node=>node.getBoundingClientRect().top)>await current.evaluate(node=>node.getBoundingClientRect().bottom),'可选热源放在负荷之后');
  await optional.getByRole('button',{name:'添加',exact:true}).click();
  await expect(page.locator('.study-crossing-inputs')).toBeVisible();
  assert(await page.locator('.study-crossing-inputs').evaluate(node=>node.getBoundingClientRect().top)<await current.evaluate(node=>node.getBoundingClientRect().top),'热源缺关键值时升到工况前面');
  await page.getByRole('button',{name:'移除热源 1',exact:true}).click();
  await expect(optional).toBeVisible();await expect(page.getByRole('status',{name:'试算结果'})).toHaveCount(0);
  report.checks.push('负荷框保留宽度；可选热源末尾一行，添加后提升、移除后恢复并清除旧试算');
 }
 if(phase==='after'){assert(await page.locator('.workbench-canvas').evaluate(node=>node.getBoundingClientRect().height)>=220);report.checks.push('真实试算时画布高度至少 220 px');}
 if(phase==='after')await layout('success-preview');
 await page.setViewportSize({width:1920,height:1080});await shot('preview-1920');
 if(phase==='after' && !previewOnly){
  const workspace=await request(base,`/api/workspaces/${rating.workspace}`);
  const empty=await request(base,`/api/workspaces/${rating.workspace}/studies`,'POST',{...definition,title:'可读性空状态验收',expected_revision:workspace.revision});
  await go(empty,'ampacity','results');await expect(page.getByRole('heading',{name:'尚无载流量运行',exact:true})).toBeVisible();await layout('empty');
  let release;const gate=new Promise(resolve=>{release=resolve;});const hold=async route=>{await gate;await route.continue();};
  await page.route('**/api/**',hold);
  try{await page.goto(url(empty,'ampacity','results'),{waitUntil:'domcontentloaded'});await expect(page.locator('.provider-state,.route-skeleton').first()).toBeVisible();await layout('loading');}finally{release();await page.unrouteAll({behavior:'wait'});}
  await expect(page.getByRole('toolbar',{name:'工程命令'})).toBeVisible();
  const fail=route=>route.abort('failed');await page.route('**/api/workspaces/**',fail);await page.goto(url(empty,'ampacity','results'));await expect(page.locator('.provider-state')).toBeVisible();await layout('error');await page.unroute('**/api/workspaces/**',fail);
  report.checks.push('五态 × 深浅主题 × 两种尺寸：字号、对比度、横向越界与结论数值重叠自动断言');
 }
 }
 assert.equal(report.errors.length,0);report.outcome='passed';
}catch(e){report.outcome='failed';report.failure=e.message;throw e;}finally{await fs.writeFile(path.join(out,statusOnly?'release-notice.json':'evidence.json'),JSON.stringify(report,null,2));await session.close();}
