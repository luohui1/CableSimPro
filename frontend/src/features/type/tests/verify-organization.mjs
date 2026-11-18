import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrowserFixture, repositoryRoot } from '../../cad/tests/browser-fixture.mjs';

// A single page and a read-only proxy: presentation states never write to the demonstration database.
const output = path.join(repositoryRoot, '.data/type-organization');
await fs.mkdir(output, { recursive: true });
const fixture = await createBrowserFixture({ production: true }), { page } = fixture;
const result = { checks: [], screenshots: [], errors: fixture.errors, writes: [] };
let wid, saved;
let listState = 'success', workspaceState = 'success', standardsState = 'live', release;
const declaredNames=['GB/T 11017.2—2024','GB/T 3956—2008'];
async function prepare() {
const index = await fetch(fixture.url + '/api/design/type-workspaces').then(r => r.json());
assert.ok(index.length, '需要至少一个真实型号设计作为只读验收输入');
wid = index[0].id; saved = await fetch(fixture.url + '/api/types/' + wid + '/workspace').then(r => r.json());
page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) result.writes.push(request.method()); });
await page.route('**/api/design/type-workspaces', async route => {
  if (listState === 'loading') await new Promise(resolve => { release = resolve; });
  if (listState === 'empty') await route.fulfill({ json: [] });
  else if (listState === 'error') await route.fulfill({ status: 503, json: { detail: '型号目录暂时不可用，请重新读取。' } });
  else await route.continue();
});
await page.route('**/api/types/library', route => listState === 'empty' ? route.fulfill({ json: { items: [] } }) : route.continue());
await page.route('**/api/types/' + wid + '/workspace', async route => {
  if (standardsState !== 'live') {
    // Presentation-only contract cases: the real saved workspace remains untouched.
    const value=structuredClone(saved);value.domain.provenance={...value.domain.provenance};
    delete value.domain.provenance['/execution_standards'];
    if (standardsState.startsWith('declared')) value.domain.provenance['/execution_standards']={kind:'standard',reviewed:true,reference:JSON.stringify({schema:'cablesim.execution-standards/1',items:declaredNames.map(standard=>({standard,source_digest:'a'.repeat(64)}))})};
    if (standardsState==='invalid-declaration') value.domain.provenance['/execution_standards']={kind:'standard',reviewed:true,reference:'unreadable declaration'};
    return route.fulfill({json:value});
  }
  if (workspaceState === 'loading') await new Promise(resolve => { release = resolve; });
  if (workspaceState === 'error') await route.fulfill({ status: 503, json: { detail: '型号输入暂时不可用，请重新读取。' } });
  else if (workspaceState === 'empty') { const empty = structuredClone(saved); empty.domain.cable_types = []; empty.domain.circuits = []; empty.domain.sections = []; empty.domain.load_cases = []; await route.fulfill({ json: empty }); }
  else await route.continue();
});
// The catalog reads this approval summary separately from the explicit workspace declaration.
await page.route('**/api/types/' + wid + '/standards-summary', route => {
  if(standardsState==='unavailable'||standardsState==='declared-unavailable') return route.fulfill({status:503,json:{detail:'要求目录离线'}});
  if(standardsState==='live') return route.continue();
  return route.fulfill({json:{revision:saved.revision+(standardsState==='revision-mismatch'?1:0),standards:standardsState==='approved'?['GB/T 12706.2-2020']:[],reason:'只读批准摘要契约验收'}});
});
}
async function check(label) {
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('button,label,input,td,th,p,h1,h2,h3,dt,dd,span')].filter(node => node.checkVisibility() && node.getBoundingClientRect().height && !node.closest('[aria-hidden=true]') && (node.textContent.trim() || node.value));
    const rgba = color => { const n = color.match(/[\d.]+/g)?.map(Number) || []; return n.length >= 3 ? [...n.slice(0,3), n[3] ?? 1] : [0,0,0,0]; };
    const over = (a,b) => [0,1,2].map(i => a[i]*a[3]+b[i]*(1-a[3])).concat(1);
    const bg = node => !node ? [255,255,255,1] : rgba(getComputedStyle(node).backgroundColor)[3] === 1 ? rgba(getComputedStyle(node).backgroundColor) : over(rgba(getComputedStyle(node).backgroundColor),bg(node.parentElement));
    const lum = a => a.slice(0,3).map(v => v/255).map(v => v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const contrast = visible.filter(node=>!node.children.length && !node.closest('svg,[disabled],[data-disabled]') && +getComputedStyle(node).opacity === 1).flatMap(node=> { const background=bg(node), a=lum(over(rgba(getComputedStyle(node).color),background)), b=lum(background), ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05); return ratio < 4.48 ? [{text:(node.textContent||node.value).slice(0,40),ratio}] : []; });
    const zones = ['.app-sidebar','.project-explorer','.workbench','.work-body > .type-property-wrapper','.work-body > .type-design-card','.topbar'].map(s=>document.querySelector(s)?.getBoundingClientRect()).filter(Boolean), overlap=[];
    for(let i=0;i<zones.length;i++)for(let j=i+1;j<zones.length;j++){const a=zones[i],b=zones[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([i,j]);}
    return { overflow: document.documentElement.scrollWidth > innerWidth+1 || document.documentElement.scrollHeight > innerHeight+1, font:Math.min(...visible.map(node=>parseFloat(getComputedStyle(node).fontSize))), contrast, overlap };
  });
  assert.equal(layout.overflow,false,label+': 页面越界'); assert.ok(layout.font>=13,label+': 字号'); assert.deepEqual(layout.contrast,[],label+': 文字对比度'); assert.deepEqual(layout.overlap,[],label+': 面板重叠');
  const details = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.type-property-wrapper .number-field,.type-property-wrapper .select-field,.type-design-card .property-row')].filter(node => node.checkVisibility() && node.getBoundingClientRect().height > 0);
    const collisions = rows.flatMap(row => {
      const label = row.querySelector('label,dt'), value = row.querySelector('.field-value-line,.select-trigger,dd');
      if (!label || !value) return [];
      const a = label.getBoundingClientRect(), b = value.getBoundingClientRect();
      return a.right > b.left + 1 && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top) + 1 ? [label.textContent] : [];
    });
    const clipped = [...document.querySelectorAll('.type-list-toolbar,.type-module-status,.type-design-card,.type-property-fields')].filter(node => node.checkVisibility() && node.scrollWidth > node.clientWidth + 1).map(node => node.className);
    const rowHeights = [...document.querySelectorAll('.type-property-wrapper .number-field,.type-property-wrapper .select-field')].filter(node => node.checkVisibility()).map(node => ({ label: node.querySelector('label')?.textContent, height: node.getBoundingClientRect().height }));
    const body = document.body.innerText;
    const tableClipped=[...document.querySelectorAll('.data-table[aria-label="型号分层"] th,.data-table[aria-label="型号分层"] td:nth-child(3),.data-table[aria-label="型号分层"] td:nth-child(5),.data-table[aria-label="型号分层"] td:nth-child(6)')].flatMap(cell=>{
      const box=cell.getBoundingClientRect(), walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT); let text, failed=false;
      while((text=walker.nextNode())) {if(!text.textContent.trim() || !text.parentElement.checkVisibility())continue;const range=document.createRange();range.selectNodeContents(text);if([...range.getClientRects()].some(rect=>rect.left<box.left-1 || rect.right>box.right+1))failed=true;}
      return failed?[cell.textContent]:[];
    });
    return { collisions, clipped, rowHeights, tableClipped, internal: body.match(/\b[a-f0-9]{8}-[a-f0-9-]{27,}\b|\b[a-f0-9]{64}\b|cablesim\.[a-z-]+|\+engineering/g) || [] };
  });
  assert.deepEqual(details.collisions, [], label + ': 属性标签与值重叠');
  assert.deepEqual(details.clipped, [], label + ': 型号控件横向溢出');
  assert.deepEqual(details.internal, [], label + ': 内部标识露出');
  assert.deepEqual(details.tableClipped, [], label + ': 分层表文字越过单元格');
  assert.ok(details.rowHeights.every(row => Math.abs(row.height - 32) <= 1), label + ': 属性行高 ' + JSON.stringify(details.rowHeights));
  result.checks.push({ label, layout, ...details });
}
async function shot(name) { const file = path.join(output, name + '.png'); await page.screenshot({ path: file }); result.screenshots.push(file); }
async function navigate(url, selector, state) {
  release?.(); release = undefined;
  await page.goto(fixture.url + url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(selector)).toHaveAttribute('data-type-state', state, { timeout: 20000 });
}
try {
  await prepare();
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    for (const state of ['loading', 'empty', 'error', 'success']) {
      listState = state; workspaceState = 'success';
      await navigate('/types?theme=' + theme, '[data-type-page=list]', state);
      if (state === 'success') {
        assert.deepEqual(await page.getByRole('table', { name: '型号', exact: true }).locator('thead th').allTextContents(), ['选择', '型号与方案', '电压', '截面', '执行标准', '基准版本', '状态']);
        await page.getByRole('table', { name: '型号', exact: true }).locator('tbody .data-row').first().click();
        await expect(page.locator('[data-type-card]')).toBeVisible();
        assert.doesNotMatch(await page.getByRole('table', { name: '型号', exact: true }).innerText(), /\.0(?:\/| kV| mm²)/);
      }
      await check(`目录 ${state} ${width} ${theme}`);
    }
    listState = 'success';
    for (const state of ['loading', 'empty', 'error', 'success', 'historical']) {
      workspaceState = state;
      await navigate(`/types/${wid}/structure/section?theme=${theme}${state === 'historical' ? '&revision=' + saved.revision : ''}`, '[data-type-page=structure]', state);
      if (state === 'success' || state === 'historical') {
        await expect(page.locator('[data-type-card]')).toBeVisible();
        await expect(page.getByText('基准版本', { exact: true })).toBeVisible();
        await expect(page.locator('.type-module-status')).toHaveCount(8);
        await expect(page.locator('.command-bar')).not.toContainText('已保存');
        await expect(page.locator('.project-explorer')).not.toContainText('未运行');
        assert.ok((await page.locator('.command-state').innerText()).length < 40);
        await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveClass(/button-outline/);
        const materials=await page.getByRole('table', { name: '型号分层', exact: true }).locator('tbody .data-row td:nth-child(3)').evaluateAll(cells=>cells.map(cell=>{
          const range=document.createRange();range.selectNodeContents(cell);const text=range.getBoundingClientRect(), box=cell.getBoundingClientRect();
          return {name:cell.textContent,nowrap:getComputedStyle(cell).whiteSpace==='nowrap',fits:text.left>=box.left && text.right<=box.right,lines:range.getClientRects().length};
        }));
        assert.ok(materials.every(cell=>cell.fits),'材料名称与版本完整显示，换行后仍在单元格内：'+JSON.stringify(materials));
        await page.locator('.type-module-status').first().hover();
        await expect(page.getByRole('tooltip')).toBeVisible();
        await page.mouse.move(0, 0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        if (state === 'historical') await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
        if (state === 'success' && width === 1366 && theme === 'light') await shot('workbench-card');
      }
      await check(`工作台 ${state} ${width} ${theme}`);
      if (state === 'success') {
        await page.getByRole('table', { name: '型号分层', exact: true }).locator('tbody .data-row').nth(1).click();
        await expect(page.locator('.type-property-wrapper > .type-property-wrapper > .type-property-fields, .type-property-wrapper > .type-property-fields').first()).toBeVisible();
        await check(`行式属性 ${width} ${theme}`);
        await page.locator('.explorer-item').first().focus(); await page.keyboard.press('Escape'); await expect(page.locator('[data-type-card]')).toBeVisible();
      }
    }
  }
  workspaceState = 'success'; listState = 'success';
  await navigate('/types?theme=light', '[data-type-page=list]', 'success');
  await page.getByRole('searchbox', { name: '查找型号', exact: true }).fill('不存在的型号');
  await expect(page.getByText('没有匹配的型号设计', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.locator('.type-list-toolbar [data-slot=toggle-group-item]').filter({ hasText: /^审核中$/ }).click();
  await expect(page.getByText('没有匹配的型号设计', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByRole('table', { name: '型号', exact: true }).locator('.object-link').first().focus();
  await page.keyboard.press('Enter'); await expect(page.locator('[data-type-card]')).toBeVisible();
  const name = page.locator('.type-name-input'); await name.fill(saved.domain.name + ' · 验收草稿');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveClass(/button-primary/);
  await page.locator('.explorer-item').first().focus(); await page.keyboard.press('Control+z');
  await expect(name).toHaveValue(saved.domain.name); await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  for(const state of ['approved','conflict','declared','invalid-declaration','unavailable','declared-unavailable','revision-mismatch']) {
    standardsState=state;
    await navigate('/types?theme=light','[data-type-page=list]','success');
    const standard=page.locator(`[data-type-execution-standards="${wid}"]`),row=page.getByRole('row').filter({has:standard});
    const expected={approved:'未声明；已有批准要求',conflict:'未声明',declared:declaredNames.join('、'),'invalid-declaration':'声明待核对',unavailable:'标准读取失败','declared-unavailable':declaredNames.join('、')+'；批准状态读取失败','revision-mismatch':'标准读取失败'};
    await expect(standard).toHaveText(expected[state]);
    await expect(standard).toHaveAttribute('data-declaration-state',state.startsWith('declared')?'declared':state==='invalid-declaration'?'invalid':'undeclared');
    const failed=['unavailable','declared-unavailable','revision-mismatch'].includes(state);
    await expect(standard).toHaveAttribute('data-approval-state',failed?'error':'ready');
    if(state==='approved') await expect(standard).toHaveAttribute('title',/已有批准要求涉及：GB\/T 12706.2-2020.*不据此推断执行版本声明/);
    if(state.includes('unavailable')) await expect(standard).toHaveAttribute('title',/要求目录离线/);
    if(state==='revision-mismatch') await expect(standard).toHaveAttribute('title',/型号修订已变化/);
    await standard.focus(); await expect(standard).toBeFocused();
    const explanation=page.locator('.tooltip-content:visible');
    await expect(explanation).toContainText(state.includes('unavailable')?'要求目录离线':state==='revision-mismatch'?'型号修订已变化':state==='invalid-declaration'?'无法完整读取':state==='declared'?'声明不等于批准要求':'执行版本');
    await page.keyboard.press('Escape'); await expect(explanation).toBeHidden();
    await check('执行标准契约 '+state);
    if(failed){
      standardsState=state.startsWith('declared')?'declared':'conflict';
      await row.getByRole('button',{name:'重新读取标准',exact:true}).click();
      await expect(standard).toHaveText(state.startsWith('declared')?declaredNames.join('、'):'未声明');
      await expect(standard).toHaveAttribute('data-approval-state','ready');
    }
  }
  standardsState='live';
  assert.deepEqual(fixture.errors, []); assert.deepEqual(result.writes, []);
  result.workflow = '目录筛选、选中名片、Enter进入、层属性、Esc取消选中、编辑启用保存、Ctrl+Z撤销；只读，无计算请求。';
  result.coverage = '目录没有历史模式；历史验收使用真实型号保存修订。执行版本声明、批准、冲突、读取失败及修订不一致使用只读响应契约注入，仅验证呈现与重读，不声称源库新增了声明或批准；真实声明保存与返回目录由四线走查覆盖。';
} catch (error) { result.failure = String(error.stack || error); console.error(result.failure); console.error((await page.locator('body').innerText()).slice(0, 1500)); process.exitCode = 1; }
finally { release?.(); await fixture.close(); await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2)); }
console.log(JSON.stringify({ checks: result.checks.length, screenshots: result.screenshots, failure: result.failure || null }));
