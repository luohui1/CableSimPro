import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect} from '@playwright/test';
import {typeFixture,root} from '../../type/tests/fixture.mjs';
import {checkLayout} from '../../type/tests/ui-checks.mjs';

process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/release/engineering.sqlite');
const output=path.join(root,'.data/cad-lifecycle'),before=process.env.CAD_BEFORE==='1';
await fs.mkdir(output,{recursive:true});
const fixture=await typeFixture({main:true,software:true,build:path.join(output,'frontend'),development:process.env.CAD_DEVELOPMENT==='1'});
const {page}=fixture,report={before,runtime:fixture.runtime,errors:fixture.errors,types:[],switches:[],layouts:[]};
await page.addInitScript(()=>{
  const NativeWorker=window.Worker,active=new Set();
  window.cadLifecycle={created:0,terminated:0,active:0,transfers:0,duplicates:0,frames:[]};
  window.Worker=class extends NativeWorker{
    constructor(...args){super(...args);active.add(this);window.cadLifecycle.created++;window.cadLifecycle.active=active.size;}
    terminate(){if(active.delete(this))window.cadLifecycle.terminated++;window.cadLifecycle.active=active.size;return super.terminate();}
  };
  const transfer=HTMLCanvasElement.prototype.transferControlToOffscreen,seen=new WeakSet();
  HTMLCanvasElement.prototype.transferControlToOffscreen=function(){if(seen.has(this))window.cadLifecycle.duplicates++;seen.add(this);window.cadLifecycle.transfers++;return transfer.call(this);};
  new MutationObserver(()=>{const element=document.querySelector('.cad-viewport[data-cad-ready=true]');if(element&&!element.dataset.testPainted){element.dataset.testPainted='true';window.cadLifecycle.frames.push({at:performance.now(),model:element.dataset.cadModelKind,viewportMs:Number(element.dataset.cadFirstDisplayMs)});}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-cad-ready']});
});
try{
  const workspaces=await fixture.api('/api/workspaces');
  const library={items:(await Promise.all(workspaces.map(async x=>({...await fixture.api('/api/workspaces/'+x.id),workspace_id:x.id})))).filter(x=>!x.study_cable_reference)};
  for(const term of process.env.CAD_RESEARCH_ONLY==='1'?[]:['YJV22','起帆']){
    const item=library.items.find(x=>JSON.stringify(x).includes(term));
    if(!item)console.log('LIBRARY',JSON.stringify(library).slice(0,3000));
    assert.ok(item,'真实发布型号不存在：'+term);
    await page.setViewportSize({width:1366,height:768});
    await page.goto(`${fixture.url}/types/${item.workspace_id}/structure/table?theme=light`);
    await expect(page.getByRole('button',{name:'三维剥切',exact:true})).toBeVisible({timeout:30000});
    console.log('MODEL',term,item.workspace_id);
    const started=performance.now();await page.getByRole('button',{name:'三维剥切',exact:true}).click();
    await expect(page.locator('.cad-viewport')).toHaveAttribute('data-cad-ready','true',{timeout:45000});
    const firstFrameMs=performance.now()-started;
    console.log('FIRST_FRAME',term,firstFrameMs);
    const diagnostics=await page.evaluate(()=>({lifecycle:window.cadLifecycle,resources:performance.getEntriesByType('resource').filter(x=>/geometry-preview|wasm|occt-viewer/.test(x.name)).map(x=>({name:x.name.split('/').slice(-2).join('/'),start:x.startTime,duration:x.duration})),timing:document.querySelector('.cad-viewport').dataset}));
    report.types.push({term,workspace:item.workspace_id,firstFrameMs,...diagnostics});
    await page.screenshot({path:path.join(output,`${before?'before':'after'}-${term==='起帆'?'hv':'three-core'}-1366.png`)});
    if(!before)assert.ok(firstFrameMs<=5000,term+' 首帧超过 5 秒：'+firstFrameMs);
    if(term==='YJV22'){
      await expect(page.locator('.cad-viewport')).toHaveAttribute('data-cad-model-kind','precise',{timeout:60000});
      report.types.at(-1).refinedAtMs=performance.now()-started;
      report.types.at(-1).refinedTiming=await page.locator('.cad-viewport').evaluate(x=>({...x.dataset}));
    }
    for(const [width,height] of [[1366,768],[1920,1080]])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      try{report.layouts.push({term,width,theme,result:await checkLayout(page,'.cad-viewport')});}catch(error){if(!before)throw error;report.layouts.push({term,width,theme,failure:String(error)});}
    }
  }
  let found;
  for(const workspace of workspaces){
    for(const study of await fixture.api(`/api/workspaces/${workspace.id}/studies`)){
      if(['selection','sweep'].includes(study.definition.driver?.kind))continue;
      const runs=await fixture.api(`/api/workspaces/${workspace.id}/studies/${study.id}/runs`);
      const run=runs.items?.find(r=>r.integrity==='verified'&&r.output?.cases?.some(c=>c.artifacts?.['x-cablesim.temperature-field']));
      if(run){found={workspace,study,run};break;}
    }if(found)break;
  }
  assert.ok(found,'必须使用真实保存温度场');
  const {workspace,study,run}=found,module=study.definition.driver?.kind==='sweep'?'sweep':'ampacity';
  await page.setViewportSize({width:1366,height:768});
  await page.goto(`${fixture.url}/studies/${study.id}/${module}/${module==='sweep'?'curve':'results'}?workspace=${workspace.id}&view=three&run=${run.id}&theme=light`);
  await expect(page.locator('[data-cad-field-ready=true]')).toBeVisible({timeout:30000});
  for(let i=0;i<20;i++){
    const label=['敷设截面','电缆截面','三维','土壤温度场'][i%4];
    await page.getByRole('button',{name:label,exact:true}).click();
    report.switches.push({label,...await page.evaluate(()=>window.cadLifecycle)});
  }
  await page.getByRole('button',{name:'三维',exact:true}).click();
  await expect(page.locator('[data-cad-field-ready=true]')).toBeVisible({timeout:10000});
  const slice=page.getByRole('button',{name:/^土壤切片$|^温度切片$/});
  await slice.click();await slice.click();await expect(page.locator('[data-cad-field-ready=true]')).toBeVisible();
  await page.getByRole('button',{name:'导出 PNG',exact:true}).click();
  await expect(page.getByText('三维图已选入计算书',{exact:true})).toBeVisible();
  report.exported=true;
  await page.screenshot({path:path.join(output,'after-research-1366.png')});
  for(const [width,height] of [[1366,768],[1920,1080]])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(page.locator('[data-cad-field-ready=true]')).toBeVisible();
    report.layouts.push({term:'research',width,theme,result:await checkLayout(page,'.cad-viewport')});
  }
  report.study={workspace:workspace.id,study:study.id,run:run.id,lifecycle:await page.evaluate(()=>window.cadLifecycle)};
  await page.getByRole('navigation',{name:'对象',exact:true}).getByRole('link',{name:'型号设计',exact:true}).click();await expect(page.locator('.cad-viewport')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.cadLifecycle.active)).toBe(0);
  report.afterLeave=await page.evaluate(()=>window.cadLifecycle);
  if(!before){assert.equal(report.afterLeave.duplicates,0);assert.deepEqual(fixture.errors,[]);}
}catch(error){report.failure=String(error);report.failureText=(await page.locator('body').innerText()).slice(-6000);await page.screenshot({path:path.join(output,before?'before-failed.png':'after-failed.png')});throw error;}finally{
  await fs.writeFile(path.join(output,`${before?'before':'after'}${process.env.CAD_RESEARCH_ONLY==='1'?'-research':''}${process.env.CAD_DEVELOPMENT==='1'?'-development':''}.json`),JSON.stringify(report,null,2));
  await fixture.close();
}
