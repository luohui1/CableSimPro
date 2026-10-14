import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect as baseExpect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {root,typeFixture} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';

// Real saved inputs/results are used throughout. Only network delay and loss
// are injected: neither response bodies nor engineering results are invented.
const fixture=await typeFixture({main:true,build:process.env.E2E_FRONTEND_DIST||path.join(root,'frontend/dist')});
const {page,context}=fixture,expect=baseExpect.configure({timeout:30000});
const out=path.join(root,'.data/type-publish/states');await fs.mkdir(out,{recursive:true});
const report={states:[],faultInjection:['网络延迟','网络断开'],errors:fixture.errors};
const wid='41bdf226-ac2c-49f5-a1e4-5b63f94934ee';
const endpoint='/api/types/'+wid+'/display-runs';
const view=id=>fixture.url+'/types/'+id+'/short-circuit/results?theme=light';
async function matrix(state){
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    report.states.push({state,width,theme,...await checkLayout(page,'.type-root')});
  }
}
try{
  await page.goto(view(wid));await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','success');await matrix('成功');
  // Click between actual modules in the same workbench: a peer's status-only
  // summary must never flash an error or be mistaken for the active result.
  await page.evaluate(()=>{
    window.__typeSwitchErrors=[];
    window.__typeSwitchObserver=new MutationObserver(()=>{
      for(const node of document.querySelectorAll('[data-type-state="error"]'))window.__typeSwitchErrors.push(node.textContent);
    });
    window.__typeSwitchObserver.observe(document.querySelector('.type-root'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-type-state']});
  });
  for(let round=0;round<2;round++)for(const [label,part] of [['电气参数','electrical'],['标准核对','standard-check'],['短路容量','short-circuit']]){
    await page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:new RegExp('^'+label)}).click();
    await expect(page.locator(`[data-type-page="${part}-results"]`)).toHaveAttribute('data-type-state','success');
  }
  report.moduleSwitches=await page.evaluate(()=>{window.__typeSwitchObserver.disconnect();return {count:6,errors:window.__typeSwitchErrors};});
  assert.deepEqual(report.moduleSwitches.errors,[]);
  const blank=await fixture.api('/api/types','POST',{origin:'blank',name:'五态验收的真实空白草稿',construction:'three_core',request_id:randomUUID()});
  await page.goto(view(blank.id));await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','empty');await matrix('空');
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await context.route('**'+endpoint+'**',async route=>{await gate;await route.continue();});
  await page.goto(view(wid));await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','loading');await matrix('加载');release();await context.unroute('**'+endpoint+'**');
  await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','success');
  await context.route('**'+endpoint+'**',route=>route.abort('internetdisconnected'));
  await page.goto(view(wid));await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','error');await matrix('错误');
  await context.unroute('**'+endpoint+'**');await page.getByRole('button',{name:'重新读取',exact:true}).click();await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','success');
  const workspace=await fixture.api('/api/workspaces/'+wid), document=structuredClone(workspace.domain);
  document.cable_types[0].cores[0].layers.find(layer=>layer.role==='insulation').thickness-=.0001;
  await fixture.api('/api/types/'+wid+'/document','PUT',{document,expected_revision:workspace.revision,request_id:randomUUID()});
  await page.goto(view(wid));await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','historical');await matrix('历史');
  assert.deepEqual(fixture.errors,[]);report.complete=true;
}catch(error){report.failure=String(error.stack||error);process.exitCode=1;console.error(report.failure);}
finally{await fixture.close();report.closed=true;await fs.writeFile(path.join(out,'assertions.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({complete:report.complete,states:report.states.length,failure:report.failure,closed:report.closed}));
