import assert from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, root } from './fixture.mjs';

// One page, private SQLite backup, genuine saved plugin runs; no approvals or source-input writes.
process.env.E2E_DATABASE_SOURCE ||= path.join(root, '.data/release/engineering.sqlite');
const fixture = await typeFixture({ main: true, build: path.join(root,'frontend/dist') });
const { page, context } = fixture, expect = baseExpect.configure({ timeout: 30000 });
const output = path.join(root,'.data/type-calculations'); await fs.mkdir(output,{recursive:true});
const result = { workflows:[], layouts:[], screenshots:[], errors:fixture.errors };
const stateSelector = module => module==='standard-check' ? '[data-type-page=standard-check-results]' : '[data-type-page=quantities]';
const routePath = (wid,module,theme='light') => `/types/${wid}/${module==='standard-check'?'standard-check/results':'structure/quantities'}?theme=${theme}`;
async function navigate(wid,module,theme='light') { await page.goto(fixture.url+routePath(wid,module,theme),{waitUntil:'domcontentloaded'}); }
async function savedRuns(wid) {
  const studies=await fixture.api(`/api/workspaces/${wid}/studies`);
  const runs=[]; for(const study of studies) for(const run of (await fixture.api(`/api/workspaces/${wid}/studies/${study.id}/runs`)).items) runs.push({study,run});
  return runs;
}
function artifact(run,type) { return run.output.cases.find(c=>c.status==='succeeded')?.artifacts[type]; }
async function runModule(wid,module) {
  await navigate(wid,module);
  const key=module==='standard-check'?'x-cablesim.standard-check':'x-cablesim.cad-model';
  const existing=process.env.E2E_REUSE_CALCULATIONS==='1'?(await savedRuns(wid)).find(({run})=>run.integrity==='verified'&&run.freshness==='current'&&artifact(run,key)):null;
  if(existing){await expect(page.locator(stateSelector(module))).toHaveAttribute('data-type-state','success');result.workflows.push({wid,module,run:existing.run.id,integrity:existing.run.integrity,reused:true});return {...existing,artifact:artifact(existing.run,key)};}
  const label=module==='standard-check'?'执行标准核对':'更新结构推导';
  await page.getByRole('button',{name:label,exact:true}).focus(); await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:label+' · 预检',exact:true}); await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();
  await dialog.getByRole('button',{name:'确认并运行',exact:true}).click();
  await expect(dialog).toBeHidden({timeout:120000});
  await expect(page.locator(stateSelector(module))).toHaveAttribute('data-type-state','success');
  const entry=(await savedRuns(wid)).filter(({run})=>run.integrity==='verified'&&artifact(run,key)).sort((a,b)=>b.run.created.localeCompare(a.run.created))[0];
  assert.ok(entry); result.workflows.push({wid,module,run:entry.run.id,integrity:entry.run.integrity}); console.log('已保存：'+module+' · '+entry.study.definition.title); return { ...entry, artifact:artifact(entry.run,key) };
}
async function layout(label) {
  await page.evaluate(()=>document.fonts.ready);
  const data=await page.evaluate(()=>{
    const visible=[...document.querySelectorAll('button,label,input,td,th,p,h1,h2,h3,dt,dd,span,small')].filter(n=>n.checkVisibility()&&n.getBoundingClientRect().height&&!n.closest('[aria-hidden=true]')&&(n.textContent.trim()||n.value));
    const rgba=c=>{const n=c.match(/[\d.]+/g)?.map(Number)||[];return n.length>=3?[...n.slice(0,3),n[3]??1]:[0,0,0,0]};
    const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat(1);
    const bg=n=>!n?[255,255,255,1]:rgba(getComputedStyle(n).backgroundColor)[3]===1?rgba(getComputedStyle(n).backgroundColor):over(rgba(getComputedStyle(n).backgroundColor),bg(n.parentElement));
    const lum=a=>a.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const contrast=visible.filter(n=>!n.children.length&&!n.closest('svg,[disabled],[data-disabled]')&&+getComputedStyle(n).opacity===1).flatMap(n=>{const b=bg(n),a=lum(over(rgba(getComputedStyle(n).color),b)),l=lum(b),ratio=(Math.max(a,l)+.05)/(Math.min(a,l)+.05);return ratio<4.48?[{text:(n.textContent||n.value).slice(0,50),ratio}]:[]});
    const zones=['.app-sidebar','.project-explorer','.workbench','.work-body > .type-design-card','.work-body > .type-property-wrapper','.work-body > .property-panel','.topbar'].map(s=>document.querySelector(s)?.getBoundingClientRect()).filter(Boolean), overlap=[];
    for(let i=0;i<zones.length;i++)for(let j=i+1;j<zones.length;j++){const a=zones[i],b=zones[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([i,j]);}
    const clipped=[...document.querySelectorAll('.type-layer-input input')].filter(n=>n.checkVisibility()).flatMap(n=>{const s=getComputedStyle(n),c=document.createElement('canvas').getContext('2d');c.font=s.font;return c.measureText('123.456').width>n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)?[n.clientWidth]:[]});
    for(const cell of document.querySelectorAll('.data-table[aria-label="外径与用料"] th,.data-table[aria-label="外径与用料"] td')){
      const box=cell.getBoundingClientRect(),walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode())){if(!node.textContent.trim()||!node.parentElement.checkVisibility())continue;const range=document.createRange();range.selectNodeContents(node);if([...range.getClientRects()].some(r=>r.left<box.left-1||r.right>box.right+1))clipped.push(cell.textContent);}
    }
    return {overflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1,font:Math.min(...visible.map(n=>parseFloat(getComputedStyle(n).fontSize))),contrast,overlap,clipped,internal:document.body.innerText.match(/\b[a-f0-9]{8}-[a-f0-9-]{27,}\b|\b[a-f0-9]{64}\b|cablesim\.[a-z-]+/)||[]};
  });
  assert.equal(data.overflow,false,label);assert.ok(data.font>=13,label);assert.deepEqual(data.contrast,[],label);assert.deepEqual(data.overlap,[],label);assert.deepEqual(data.clipped,[],label);assert.deepEqual(data.internal,[],label);result.layouts.push({label,...data});
}
async function shot(name) {const file=path.join(output,name+'.png');await page.screenshot({path:file});result.screenshots.push(file)}
let release;
try {
  const types=await fixture.api('/api/design/type-workspaces'), yjv=types.find(t=>t.name.startsWith('YJV22')), qifan=types.find(t=>t.name.startsWith('起帆'));
  assert.ok(yjv&&qifan,'需要真实起帆与 YJV22 输入'); await page.setViewportSize({width:1366,height:768});
  const yStandard=await runModule(yjv.id,'standard-check'), qStandard=await runModule(qifan.id,'standard-check');
  const nominal=yStandard.artifact.rows.find(r=>r.id.endsWith(':insulation-nominal'));
  const minimum=yStandard.artifact.rows.find(r=>r.id.endsWith(':insulation-minimum'));
  assert.equal(nominal.limit,4.5);assert.equal(minimum.limit,3.95);assert.ok(minimum.standard.includes('12706.2'));assert.ok(minimum.clause);assert.equal(minimum.source_status,'original-verified');
  assert.ok(qStandard.artifact.rows.some(r=>r.standard.includes('11017.2')&&r.source_status==='original-verified'));
  result.workflows.push({name:'GB/T 12706.2-2020 8.7/15 kV XLPE 标称 4.5 mm；0.9×4.5−0.1=3.95 mm',standard:minimum.standard,clause:minimum.clause,printedPage:minimum.printed_page,actual:minimum.actual,verdict:minimum.verdict});
  const geometry=await runModule(yjv.id,'quantities'), layer=geometry.artifact.layers.find(r=>r.role==='insulation');
  const volume=Math.PI*(layer.outer_radius_m**2-layer.inner_radius_m**2)*geometry.artifact.length_m;
  assert.ok(Math.abs(layer.material_volume_m3-volume)<volume*1e-8);assert.equal(geometry.artifact.mass_kg_per_km,null);
  assert.ok(geometry.artifact.layers.every(r=>r.quantity_missing.includes('材料密度')));
  result.workflows.push({name:'OCCT绝缘圆环体积对拍；密度缺项保持缺项',length:geometry.artifact.length_m,hand:volume,plugin:layer.material_volume_m3});
  await page.getByRole('row',{name:'芯 1 · 导体',exact:true}).click();
  await page.locator('.property-row').filter({hasText:'材料密度'}).getByRole('button',{name:'定位字段'}).click();
  await expect(page.locator('.type-property-fields').getByRole('textbox',{name:'材料密度',exact:true})).toBeFocused();
  await layout('尺寸框与材料密度定位');
  const dimension=page.getByRole('table',{name:'型号分层',exact:true}).getByRole('textbox',{name:'导体直径',exact:true}).first();
  await dimension.fill('20.700');await dimension.press('Enter');
  await page.getByRole('tab',{name:'外径与用料',exact:true}).click();
  await expect(page.locator(stateSelector('quantities'))).toHaveAttribute('data-type-state','historical');
  await expect(page.getByRole('button',{name:'更新结构推导',exact:true})).toBeDisabled();
  result.workflows.push({name:'真实未保存几何修改使旧推导成为历史，禁止重复运行'});
  await page.keyboard.press('Control+z');
  await expect(page.locator(stateSelector('quantities'))).toHaveAttribute('data-type-state','success');
  await page.getByRole('row',{name:'芯 1 · 金属屏蔽',exact:true}).click();
  await page.locator('.property-row').filter({hasText:'绕包方式'}).getByRole('button',{name:'定位字段'}).click();
  await expect(page.locator('.type-property-fields').getByRole('combobox',{name:'绕包方式',exact:true})).toBeFocused();
  result.workflows.push({name:'未给定绕包方式定位下拉字段，不补默认绕包'});
  await navigate(qifan.id,'quantities');await page.getByRole('button',{name:'更新结构推导',exact:true}).click();
  const rejected=page.getByRole('dialog',{name:'更新结构推导 · 预检'});await expect(rejected).toBeVisible();
  await expect(rejected).toContainText('波纹层');await expect(rejected.getByRole('button',{name:'确认并运行'})).toBeDisabled();
  await rejected.getByRole('button',{name:'定位金属护套'}).click();await expect(page).toHaveURL(/layer=core/);
  result.workflows.push({name:'起帆波纹层明确拒绝，定位护套；未生成替代用料'});
  const spec=await fixture.api(`/api/types/${yjv.id}/specification?audience=internal`);
  assert.ok(spec.html.includes('标准')&&spec.html.includes('推导')&&spec.html.includes('kg/km'));
  assert.ok(spec.payload.sources.some(s=>s.run_id===geometry.run.id||s.run===geometry.run.id));
  result.workflows.push({name:'内部规格书引用保存核对与用料工件',sources:spec.payload.sources});
  const studies=(await fixture.api(`/api/workspaces/${yjv.id}/studies`));let mode='success';
  const pattern=`**/api/workspaces/${yjv.id}/studies`;
  await context.route(pattern,async route=>{
    if(mode==='loading') await new Promise(resolve=>{release=resolve});
    if(mode==='empty') return route.fulfill({json:[]});
    if(mode==='error') return route.fulfill({status:503,json:{detail:'验收：保存运行读取失败，请重试'}});
    return route.fulfill({json:studies});
  });
  const runsPattern=`**/api/workspaces/${yjv.id}/studies/*/runs?*`;
  await context.route(runsPattern,async route=>{const response=await route.fetch(),data=await response.json();if(mode==='historical')for(const run of data.items)run.freshness='historical';await route.fulfill({json:data});});
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const module of ['standard-check','quantities'])for(const state of ['empty','loading','error','success','historical']) {
    release?.();release=undefined;mode=state;await page.setViewportSize({width,height:width===1366?768:1080});await navigate(yjv.id,module,theme);
    await expect(page.locator(stateSelector(module))).toHaveAttribute('data-type-state',state);await layout(`${width}/${theme}/${module}/${state}`);
    if(width===1366&&theme==='light'&&state==='success')await shot(module);
    release?.();release=undefined;
  }
  await context.unroute(pattern);await context.unroute(runsPattern);
  assert.deepEqual(fixture.errors,[]);console.log(JSON.stringify({workflows:result.workflows.length,layouts:result.layouts.length,screenshots:result.screenshots}));
} catch(error) {result.failure=String(error.stack||error);result.url=page.url();console.error(result.failure);console.error((await page.locator('body').innerText()).slice(-5000));process.exitCode=1;}
finally {release?.();await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));await fixture.close();}
