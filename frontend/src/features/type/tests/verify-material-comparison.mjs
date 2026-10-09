import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';

// Real APIs and fixed published references in a private copy; no demo writes.
const output = path.join(root, '.data/material-comparison');
await fs.mkdir(output, { recursive: true });
process.env.E2E_DATABASE_SOURCE ||= path.join(root, '.data/release/engineering.sqlite');
const fixture = await typeFixture({ main: true, build: path.join(output, 'frontend'), setup: async database => {
  await promisify(execFile)(process.env.PYTHON || path.join(root, '.venv/Scripts/python.exe'), ['-c', `
import sys
from fastapi.testclient import TestClient
from backend.main import create_app
from frontend.scripts.engineering_resources import publish_resources,bind_demo_resources
with TestClient(create_app(sys.argv[1])) as client:
 def api(path,method='GET',body=None):
  r=client.request(method,path,json=body)
  assert r.status_code<400,r.text
  return r.json()
 publish_resources(api)
 for w in api('/api/design/type-workspaces'):
  s=api('/api/workspaces/'+w['id'])
  name=s['domain']['name']
  if '110' in name: bind_demo_resources(api,w['id'],'hv')
  elif 'YJV22' in name: bind_demo_resources(api,w['id'],'mv')
`, database], { cwd: root, windowsHide: true });
} });
const { page } = fixture, results = { checks: [], workflows: [], errors: fixture.errors, runtime: fixture.runtime };
let mode = 'success', release, relationFailure;
async function layout(label) {
  await page.evaluate(() => document.fonts.ready);
  const report = await page.evaluate(() => {
    const root = document.querySelector('.workbench-dock-body'), nodes = [...root.querySelectorAll('button,td,th,summary,p,label,span')].filter(n => n.checkVisibility() && n.getBoundingClientRect().height && (n.textContent.trim() || n.value));
    const rgba = c => { const v=c.match(/[\d.]+/g)?.map(Number)||[]; return [...v.slice(0,3),v[3]??1]; };
    const over = (a,b) => a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])).concat(1);
    const bg = n => !n ? [255,255,255,1] : rgba(getComputedStyle(n).backgroundColor)[3]===1 ? rgba(getComputedStyle(n).backgroundColor) : over(rgba(getComputedStyle(n).backgroundColor),bg(n.parentElement));
    const lum = a => a.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const contrast = nodes.filter(n=>!n.children.length && !n.closest('[disabled],[data-disabled]')).flatMap(n=>{const b=bg(n),a=lum(over(rgba(getComputedStyle(n).color),b)),d=lum(b);return (Math.max(a,d)+.05)/(Math.min(a,d)+.05)<4.48?[n.textContent]:[];});
    const clipped = [...root.querySelectorAll('td,th')].flatMap(cell=>{
      const b=cell.getBoundingClientRect(),walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);let text;
      while((text=walker.nextNode())){if(!text.textContent.trim()||!text.parentElement.checkVisibility())continue;const r=document.createRange();r.selectNodeContents(text);if([...r.getClientRects()].some(v=>v.left<b.left-1||v.right>b.right+1))return[cell.textContent];}return[];
    });
    const panels=['.app-sidebar','.project-explorer','.workbench','.work-body>.type-property-wrapper'].map(s=>document.querySelector(s)?.getBoundingClientRect()).filter(Boolean), overlap=[];
    for(let i=0;i<panels.length;i++)for(let j=i+1;j<panels.length;j++){const a=panels[i],b=panels[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([i,j]);}
    const brokenNumbers=[...root.querySelectorAll('.type-material-number,.type-material-unit')].filter(n=>n.checkVisibility()).flatMap(n=>{const range=document.createRange();range.selectNodeContents(n);const tops=[...range.getClientRects()].map(r=>r.top);return tops.length&&Math.max(...tops)-Math.min(...tops)>1?[n.textContent]:[];});
    return { overflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1, font:Math.min(...nodes.map(n=>parseFloat(getComputedStyle(n).fontSize))), contrast, clipped, overlap, brokenNumbers };
  });
  assert.equal(report.overflow,false,label+JSON.stringify(report));assert.ok(report.font>=13,label);assert.deepEqual(report.contrast,[],label);assert.deepEqual(report.clipped,[],label);assert.deepEqual(report.overlap,[],label);
  assert.deepEqual(report.brokenNumbers,[],label);results.checks.push({label,...report});
}
try {
  const index=await fixture.api('/api/design/type-workspaces');
  const saved=[]; for(const w of index)saved.push(await fixture.api('/api/workspaces/'+w.id));
  const original=saved.find(w=>w.domain.name.includes('110'));
  assert.ok(original,'起帆 110 kV 的真实保存型号'); const wid=original.id;
  const document=structuredClone(original.domain), insulation=document.materials.find(m=>m.id==='material/insulation-qifan'); assert.ok(insulation);
  insulation.thermal_resistivity=4;
  const field='/materials/'+insulation.id.replaceAll('~','~0').replaceAll('/','~1')+'/thermal_resistivity';
  document.provenance[field]={kind:'user',reviewed:false,reference:'隔离交互回归：热阻率改为 4 K·m/W；不是厂家实测值'};
  await fixture.api('/api/workspaces/'+wid+'/domain','PUT',{expected_revision:original.revision,document});
  const before=await fixture.api('/api/workspaces/'+wid);
  await page.route(`**/api/types/${wid}/material-comparison?*`, route => route.continue());
  await page.route(`**/api/types/${wid}/material-comparison`, async route => {
    if(mode==='loading')await new Promise(resolve=>{release=resolve;});
    if(mode==='error')return route.fulfill({status:503,json:{detail:'物性目录暂时不可用，请重试。'}});
    if(mode==='empty'){const r=await route.fetch(),data=await r.json();return route.fulfill({json:{...data,materials:[]}});}
    return route.continue();
  });
  async function open(theme='light',revision) {release?.();release=undefined;await page.goto(`${fixture.url}/types/${wid}/structure/materials?theme=${theme}${revision?'&revision='+revision:''}`,{waitUntil:'domcontentloaded'});await expect(page.locator('[data-type-page=structure]')).toBeVisible();}
  async function select(name) {await page.getByRole('combobox',{name:'核对材料',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();}
  await page.setViewportSize({width:1366,height:768});await open();
  await select(insulation.label);
  const table=page.getByRole('table',{name:'材料物性核对'}), thermal=table.getByRole('row',{name:'热阻率',exact:true});
  await expect(thermal).toContainText('不同');await expect(thermal).toContainText('+0.5 K·m/W');await expect(thermal).toContainText('+14.29%');
  await thermal.getByRole('button',{name:'出处与条件',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('IEC 60287-2-1:2023');await page.keyboard.press('Escape');await expect(page.locator('[role=dialog]')).toHaveCount(0);await layout('资源出处后返回 1366 light');
  await page.screenshot({path:path.join(output,'xlpe-comparison.png')});
  await thermal.getByRole('button',{name:'采用资源值'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden();
  assert.equal((await fixture.api('/api/workspaces/'+wid)).revision,before.revision);
  const ids=[];
  await page.route(`**/api/types/${wid}/material-comparison/adopt`,async route=>{ids.push(route.request().postDataJSON().request_id);if(ids.length===1){await route.fetch();return route.abort('failed');}return route.continue();});
  await thermal.getByRole('button',{name:'采用资源值'}).click();const dialog=page.getByRole('dialog',{name:'采用固定资源参考值'});
  await dialog.getByRole('button',{name:'确认采用'}).click();await expect(dialog.getByRole('alert')).toContainText('物性服务未响应');
  await dialog.getByRole('button',{name:'确认采用'}).click();await expect(dialog).toBeHidden();
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);const adopted=await fixture.api('/api/workspaces/'+wid);assert.equal(adopted.revision,before.revision+1);
  assert.equal(adopted.domain.materials.find(m=>m.id===insulation.id).thermal_resistivity,3.5);
  const source=JSON.parse(adopted.domain.provenance[field].reference);assert.equal(source.asset_id,'material/xlpe-hv');assert.ok(source.content_sha256);assert.equal(source.previous_value,4);
  await expect(thermal).toContainText('一致');assert.deepEqual((await fixture.api('/api/workspaces/'+wid+'/revisions/'+before.revision)).state.domain,before.domain);
  try {const relations=await fixture.api('/api/index/objects/type/'+wid+'/relations');assert.ok(relations.uses.some(r=>r.role==='material'&&r.target.id===source.resource_id&&r.freshness==='current'));}
  catch(error){relationFailure=error;results.relationFailure=String(error);}
  await page.getByRole('combobox',{name:'核对材料'}).focus();const undo=page.waitForResponse(r=>r.url().includes('/history/undo'));await page.keyboard.press('Control+z');assert.equal((await undo).status(),200);await expect(thermal).toContainText('不同');
  assert.deepEqual((await fixture.api('/api/workspaces/'+wid)).domain,before.domain);
  await expect(page.getByText('已恢复上一份型号输入',{exact:true})).toBeVisible();
  results.workflows.push('真实起帆型号：条件核对、SI 差值 / 百分比、出处、Esc 取消、丢失响应后的幂等重试、来源固定、新修订、Ctrl+Z、历史不变');
  if(!relationFailure)results.workflows.push('采用后材料关联为当前固定资源引用');
  await select(before.domain.materials.find(m=>m.id==='material/cu').label);const copper=await table.innerText();assert.match(copper,/一致/);assert.match(copper,/型号未给此项/);assert.match(copper,/资源缺项/);
  await layout('铜物性数值完整 1366 light');await page.screenshot({path:path.join(output,'copper-comparison.png')});
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});
    for(const state of ['loading','error','empty','success','historical']){
      mode=state==='historical'?'success':state;await open(theme,state==='historical'?before.revision:undefined);
      if(state==='loading')await expect(page.getByText('正在核对材料物性',{exact:true})).toBeVisible();
      if(state==='error')await expect(page.getByText('物性目录暂时不可用，请重试。',{exact:true})).toBeVisible();
      if(state==='empty')await expect(page.getByText('尚无已绑定材料；先选择已发布的材料版本。',{exact:true})).toBeVisible();
      if(state==='success')await expect(page.locator('[data-material-state=success]')).toBeVisible();
      if(state==='historical'){await expect(page.locator('[data-material-state=historical]')).toBeVisible();await expect(page.getByRole('button',{name:'采用资源值',exact:true})).toHaveCount(0);}
      await layout(`${state} ${width} ${theme}`);
    }
  }
  assert.deepEqual(fixture.errors,[]);if(relationFailure)throw relationFailure;results.passed=true;
} catch(error) {results.failure=String(error.stack||error);console.error(results.failure);console.error((await page.locator('body').innerText()).slice(-2200));process.exitCode=1;}
finally {release?.();await fixture.close();results.closed=true;await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify({passed:results.passed,checks:results.checks.length,workflows:results.workflows}));
