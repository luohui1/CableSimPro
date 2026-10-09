import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';

// One page and a private database. Published resource is an explicit contract fixture,
// not a material certification, physical result or human design approval.
const fixture = await typeFixture({ main: true, build: path.join(root, 'frontend/dist') });
const { page } = fixture, output = path.join(root, '.data/type-resources');
await fs.mkdir(output, { recursive: true });
const results = { checks: [], workflows: [], errors: fixture.errors };
let unblock, mode = 'success';
async function layout(label) {
  await page.evaluate(() => document.fonts.ready);
  const report = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.type-resource-controls button,.type-resource-cell,.dialog-content button,.dialog-content label,.dialog-content span')].filter(n => n.checkVisibility() && n.getBoundingClientRect().height);
    const boxes = nodes.flatMap(n => {
      const b=n.getBoundingClientRect(), scroll=n.closest('.table-scroll');
      if(!scroll) return [b];
      const s=scroll.getBoundingClientRect();
      if(b.bottom<=s.top || b.top>=s.bottom) return [];
      return [{left:Math.max(b.left,s.left),right:Math.min(b.right,s.right),top:Math.max(b.top,s.top),bottom:Math.min(b.bottom,s.bottom)}];
    });
    const outside = boxes.some(b => b.left < -1 || b.right > innerWidth+1 || b.top < -1 || b.bottom > innerHeight+1);
    const cells = [...document.querySelectorAll('.type-resource-cell')].filter(n => n.checkVisibility());
    const clipped = cells.filter(n => n.scrollWidth > n.parentElement.clientWidth - 8).map(n => n.textContent);
    const overlap = cells.some(n => { const b = n.getBoundingClientRect(), next = n.closest('td').nextElementSibling?.getBoundingClientRect(); return next && b.right > next.left+1; });
    const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = v => v.slice(0,3).map(x => x/255).map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((s,v,i) => s+v*[.2126,.7152,.0722][i],0);
    const contrasts = nodes.filter(n => !n.children.length && !n.disabled).flatMap(n => {
      let p=n; while(p && (rgb(getComputedStyle(p).backgroundColor)[3] ?? 1)<1) p=p.parentElement;
      const a=lum(rgb(getComputedStyle(n).color)),b=lum(rgb(getComputedStyle(p || document.body).backgroundColor));
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)<4.48 ? [n.textContent] : [];
    });
    return { outside, clipped, overlap, contrasts, font: Math.min(...nodes.map(n => parseFloat(getComputedStyle(n).fontSize))), pageOverflow: document.documentElement.scrollWidth>innerWidth+1 };
  });
  assert.equal(report.outside,false,label+JSON.stringify(report)); assert.equal(report.pageOverflow,false,label); assert.equal(report.overlap,false,label);
  assert.deepEqual(report.clipped,[],label); assert.deepEqual(report.contrasts,[],label); assert.ok(report.font>=13,label);
  results.checks.push({label,...report});
}
try {
  const models = await fixture.api('/api/design/cable-models'), model = models.find(m => m.id === 'system.cu-xlpe-al-240');
  assert.ok(model);
  const workspace = await fixture.api('/api/design/type-workspaces', 'POST', { model_id: model.id, content_sha256: model.content_sha256 });
  const wid = workspace.id, material = workspace.domain.materials.find(m => m.id === workspace.domain.cable_types[0].cores[0].conductor.material);
  assert.ok(material);
  const resource = await fixture.api('/api/foundation/assets/import', 'POST', { release: { asset_id: material.id, version: '1.0.0', kind: 'material', name: '铜材料绑定验收', sources: [{kind:'project_input',reference:'隔离资源身份契约；无物理参数与认证',reviewed:true}] } });
  await promisify(execFile)(process.env.PYTHON || path.join(root, '.venv/Scripts/python.exe'), ['-c', "import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.execute(\"UPDATE engineering_assets SET status='published',reviewed_sha256=content_sha256 WHERE id=?\",(sys.argv[2],));d.commit();d.close()", fixture.database, resource.id], { windowsHide:true });
  await page.route(`**/api/types/${wid}/resources`, async route => {
    if(mode==='loading') await new Promise(resolve => { unblock=resolve; });
    if(mode==='error') return route.fulfill({status:503,json:{detail:'资源目录离线，请重试'}});
    if(mode==='empty') {const response=await route.fetch(), data=await response.json(); return route.fulfill({json:{...data,resources:[]}});}
    return route.continue();
  });
  async function open(theme='light',revision) { unblock?.();unblock=undefined; await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=${theme}${revision?'&revision='+revision:''}`, {waitUntil:'domcontentloaded'}); await expect(page.getByRole('table',{name:'型号分层',exact:true})).toBeVisible(); }
  await open(); await expect(page.getByRole('button',{name:'核对唯一匹配',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'核对唯一匹配',exact:true}).click();
  await expect(page.locator('.type-resource-cell .object-link').first()).toContainText('铜材料绑定验收 · 1.0.0');
  const bound = await fixture.api('/api/workspaces/'+wid);
  assert.equal(bound.type_resource_bindings.material[material.id].resource_id,resource.id);
  assert.deepEqual(bound.domain,workspace.domain);
  results.workflows.push('真实隔离接口：唯一匹配、修订保存、材料版本单元格、领域输入未改动');
  const target = await page.locator('.type-resource-cell .object-link').first().getAttribute('href'); assert.match(target,/\/resources\/materials/);
  await page.getByRole('button',{name:'绑定材料版本',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'绑定材料资源版本'}); await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox',{name:'设计材料',exact:true}).click(); await page.getByRole('option',{name:material.label,exact:true}).click();
  await dialog.getByRole('combobox',{name:'资源版本',exact:true}).click(); await page.getByRole('option',{name:'未绑定资源',exact:true}).click();
  const requestIds=[];
  await page.route(`**/api/types/${wid}/resources/bind`, async route => {
    requestIds.push(route.request().postDataJSON().request_id);
    if(requestIds.length===1) { await route.fetch(); return route.abort('failed'); }
    return route.continue();
  });
  await dialog.getByRole('button',{name:'确认绑定',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('资源服务未响应');
  await expect(dialog.getByRole('button',{name:'确认绑定',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'确认绑定',exact:true}).click(); await expect(dialog).toBeHidden();
  assert.equal(requestIds.length,2);assert.equal(requestIds[0],requestIds[1]);
  assert.equal((await fixture.api('/api/workspaces/'+wid)).revision,bound.revision+1);
  results.workflows.push('响应丢失后重试同一 request_id；只有一次修订写入');
  await expect(page.locator('.type-resource-cell .object-link')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'绑定材料版本',exact:true}).first()).toBeEnabled();
  await page.getByRole('button',{name:'绑定材料版本',exact:true}).first().focus();
  const undoRequest=page.waitForResponse(response=>response.url().includes('/history/undo'));
  await page.keyboard.press('Control+z');
  const undoResponse=await undoRequest; assert.equal(undoResponse.status(),200);
  await expect(page.locator('.type-resource-cell .object-link').first()).toBeVisible();
  results.workflows.push('解除绑定后 Ctrl+Z 恢复完整固定引用');
  for(const width of [1366,1920]) for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    for(const state of ['loading','error','empty','success','historical']) {
      mode=state==='historical'?'success':state; await open(theme,state==='historical'?bound.revision:undefined);
      if(state==='loading') await expect(page.locator('[data-resource-state=loading]').first()).toBeVisible();
      if(state==='error') await expect(page.getByText('资源目录离线，请重试',{exact:false}).first()).toBeVisible();
      if(state==='empty') {await expect(page.getByRole('button',{name:'绑定材料版本',exact:true}).first()).toBeEnabled();await page.getByRole('button',{name:'绑定材料版本',exact:true}).first().click();await expect(page.getByText('资源库尚无对应类别的已发布版本')).toBeVisible();}
      if(state==='success') await expect(page.locator('[data-resource-state=current]').first()).toBeVisible();
      if(state==='historical') {await expect(page.locator('[data-resource-state=fixed]').first()).toBeVisible();await expect(page.getByRole('button',{name:'绑定材料版本',exact:true})).toHaveCount(0);}
      await layout(`${state} ${width} ${theme}`); if(state==='empty') await page.keyboard.press('Escape');
      if(state==='success'&&width===1366&&theme==='light') await page.screenshot({path:path.join(output,'material-bindings.png')});
    }
  }
  assert.deepEqual(fixture.errors,[]); results.passed=true;
} catch(error) { results.failure=String(error.stack || error); console.error(results.failure); console.error((await page.locator('body').innerText()).slice(-2500)); process.exitCode=1; }
finally {unblock?.();await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));await fixture.close();}
console.log(JSON.stringify({passed:results.passed,checks:results.checks.length,workflows:results.workflows}));
