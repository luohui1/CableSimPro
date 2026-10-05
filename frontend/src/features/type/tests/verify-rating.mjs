import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

process.env.E2E_DATABASE_SOURCE ||= path.join(root, '.data/standard-check/validation.sqlite');
const expect = baseExpect.configure({ timeout: 25000 }), fixture = await typeFixture(), { page, context } = fixture;
const result = { workflows: [], states: [], layouts: [], screenshots: [], errors: fixture.errors, localSolverRuns: 0, iecAlgebraRuns:0 };
async function shot(name) { if (name !== 'rating-table-light-1366' && name !== 'rating-table-parameters' && !name.includes('failure')) return; await page.evaluate(() => document.fonts.ready); const file = path.join(output, 'screenshots', name + '.png'); await page.screenshot({ path: file }); result.screenshots.push(file); }
async function layout() { result.layouts.push(await checkLayout(page)); }
try {
  // User-authorized local IEC algebra only. FEM and simulation remain forbidden.
  await context.route('**/api/workspaces/*/studies/*/runs', async route => { if (route.request().method() === 'POST') { const url=new URL(route.request().url()),parts=url.pathname.split('/'),study=(await fixture.api(`/api/workspaces/${parts[3]}/studies`)).find(study=>study.id===parts[5]); if(study?.definition.method.plugin_id!=='cablesim.iec60287' || study.definition.method.capability!=='steady-rating'){result.localSolverRuns++;return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({detail:'仅允许 IEC 60287 标准代数验收'})});}result.iecAlgebraRuns++; } return route.continue(); });
  const models = await fixture.api('/api/design/cable-models'), model = models.find(model => model.id === 'system.cu-xlpe-al-240');
  const empty = await fixture.api('/api/design/type-workspaces', 'POST', { model_id: model.id, content_sha256: model.content_sha256 }), wid = empty.id;
  await page.setViewportSize({ width: 1366, height: 768 }); await page.goto(`${fixture.url}/types/${wid}/rating-table/results`);
  await expect(page.locator('[data-type-page=rating-table-results]')).toHaveAttribute('data-type-state', 'empty'); result.states.push('empty'); await shot('rating-table-empty');
  await page.getByRole('button', { name: '添加工况', exact: true }).click();
  await page.getByRole('textbox', { name: '工况名称', exact: true }).fill('隔离验收直埋'); await page.keyboard.press('Enter');
  await expect(page.getByRole('table', { name: '载流量表', exact: true })).toBeVisible();
  await page.keyboard.press('Control+s'); await expect(page.getByText('已保存型号与方法条件', { exact: true })).toBeVisible();
  const savedStudy = (await fixture.api(`/api/workspaces/${wid}/studies`)).find(study => study.definition.driver.kind === 'batch');
  expect(savedStudy.definition.driver.cases).toHaveLength(1); const condition = savedStudy.definition.driver.cases[0].metadata.condition;
  expect(condition.name).toBe('隔离验收直埋'); expect(condition.source).toBeTruthy();
  await page.getByRole('textbox',{name:'隔离验收直埋 中心埋深',exact:true}).fill('0.91');
  const compilePattern=`**/api/design/workspaces/${wid}/rating-table-definition`;let releaseCompile,enteredCompile;const entered=new Promise(resolve=>enteredCompile=resolve),gate=new Promise(resolve=>releaseCompile=resolve);
  await context.route(compilePattern,async route=>{enteredCompile();await gate;await route.continue();});
  await page.getByRole('button',{name:'添加工况',exact:true}).click();await page.getByRole('textbox',{name:'工况名称',exact:true}).fill('应随撤销取消');await page.getByRole('button',{name:'采用宿主工况',exact:true}).click();await entered;
  await page.getByRole('combobox',{name:'工况排列',exact:true}).focus();await page.keyboard.press('Control+z');await expect(page.getByText('已撤销未保存工况修改',{exact:true})).toBeVisible();releaseCompile();await expect(page.getByRole('dialog')).not.toBeVisible();await context.unroute(compilePattern);await expect(page.getByRole('table',{name:'载流量表',exact:true}).locator('tbody tr')).toHaveCount(1);
  result.workflows.push({name:'真实编译响应迟到时不恢复已撤销工况草稿'});
  await page.getByRole('tab',{name:'方法参数',exact:true}).click();
  await expect(page.locator('.parameter-form')).toBeVisible({timeout:60000});
  const ks=page.getByRole('textbox',{name:'集肤系数 kₛ',exact:true}),kp=page.getByRole('textbox',{name:'邻近系数 kₚ',exact:true});
  await ks.fill('1');await kp.fill('1');
  await page.getByRole('combobox',{name:'外部热阻形式',exact:true}).click();await page.getByRole('option',{name:'精确形式',exact:true}).click();
  await page.getByRole('combobox',{name:'涡流分支',exact:true}).click();await page.getByRole('option',{name:'忽略',exact:true}).click();
  await page.getByRole('textbox',{name:'系数来源',exact:true}).fill('明确合成验收条件；ks=kp=1，未作为厂家默认值');
  await page.getByRole('textbox',{name:'初始护套温度',exact:true}).fill('70');
  await page.keyboard.press('Control+s');await expect(page.getByText('已保存型号与方法条件',{exact:true})).toBeVisible();
  const sourced=(await fixture.api(`/api/workspaces/${wid}/studies`)).find(item=>item.id===savedStudy.id);expect(sourced.definition.input_sources['/parameters/ks'].kind).toBe('user');expect(sourced.definition.input_sources['/parameters/ks'].reference).toContain('明确合成验收条件');
  await layout();await shot('rating-table-parameters');
  await page.getByRole('tab',{name:'结果表',exact:true}).click();
  await page.getByRole('button',{name:'计算所选工况',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'计算所选工况 · 预检',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();
  await page.getByRole('button',{name:'确认并运行',exact:true}).click();
  await expect(page.locator('[data-type-page=rating-table-results]')).toHaveAttribute('data-type-state','success',{timeout:60000});result.states.push('success');
  const currentStudy=(await fixture.api(`/api/workspaces/${wid}/studies`)).filter(item=>item.definition.driver.kind==='batch').sort((a,b)=>b.created.localeCompare(a.created))[0],currentRuns=(await fixture.api(`/api/workspaces/${wid}/studies/${currentStudy.id}/runs`)).items,realRun=currentRuns.find(item=>item.integrity==='verified' && item.freshness==='current');
  expect(realRun).toBeTruthy();const realRows=await fixture.api(`/api/design/workspaces/${wid}/rating-table-runs/${realRun.id}`);expect(realRows.rows[0].value_a).toBeGreaterThan(0);
  result.workflows.push({name:'本机真实IEC代数当前成功态',run:realRun.id,current:realRun.freshness,currentA:realRows.rows[0].value_a,method:realRun.snapshot.definition.method});
  await shot('rating-table-light-1366');
  result.workflows.push({ name: '宿主默认模板、正式工况编译与方法保存', study: savedStudy.id, condition });
  const field = page.getByRole('textbox', { name: '隔离验收直埋 中心埋深', exact: true }); await field.fill('0.9234567890123');
  await page.getByRole('button', { name: '标准核对', exact: true }).click(); await page.getByRole('button', { name: '载流量表', exact: true }).click();
  await expect(field).toHaveValue('0.9234567890123'); await page.keyboard.press('Control+s'); await expect(page.getByText('已保存型号与方法条件', { exact: true })).toBeVisible();
  const updated = (await fixture.api(`/api/workspaces/${wid}/studies`)).find(study => study.id === currentStudy.id); expect(updated.definition.driver.cases[0].metadata.condition.depth_m).toBe(0.9234567890123);
  await field.fill('0.876'); await page.keyboard.press('Escape'); await expect(field).toHaveValue('0.9234567890123'); await page.locator('.type-result-toolbar').first().click(); await page.keyboard.press('Control+z'); await expect(page.getByText('已撤销未保存工况修改', { exact: true })).toBeVisible();
  // A server revision conflict must retain the complete pending field text.
  await field.fill('0.999999'); const current = await fixture.api(`/api/workspaces/${wid}`), changed = structuredClone(current.domain); changed.name += ' · 并发修订'; await fixture.api(`/api/workspaces/${wid}/domain`, 'PUT', { expected_revision: current.revision, document: changed });
  await page.keyboard.press('Control+s'); await expect(page.locator('[role=alert]').filter({ hasText: '型号已更新' })).toBeVisible(); await expect(field).toHaveValue('0.999999');
  await page.locator('.type-result-toolbar').first().click(); await page.keyboard.press('Control+z');
  result.workflows.push({ name: '跨模块保留完整文本、CtrlS真实保存、Esc恢复、CtrlZ仅撤销工况草稿、409保留输入' });
  const types = await fixture.api('/api/design/type-workspaces'); let chosen;
  for (const type of types) {
    const studies = await fixture.api(`/api/workspaces/${type.id}/studies`);
    for (const study of studies.filter(study => study.definition.driver?.kind === 'batch' && study.definition.driver.cases?.every(item => item.metadata?.kind === 'type-rating-table'))) {
      const runs = (await fixture.api(`/api/workspaces/${type.id}/studies/${study.id}/runs`)).items.filter(run => run.integrity === 'verified' && ['succeeded', 'partial'].includes(run.status)); if (runs.length) { chosen = { wid: type.id, study, run: runs.sort((a, b) => b.created.localeCompare(a.created))[0] }; break; }
    }
    if (chosen) break;
  }
  if (!chosen) throw Error('实际验收源没有完整性通过的载流量表运行');
  const data = await fixture.api(`/api/design/workspaces/${chosen.wid}/rating-table-runs/${chosen.run.id}`), row = data.rows.find(row => row.value_a !== null); if (!row) throw Error('实际验收源没有载流量数值');
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 }); await page.goto(`${fixture.url}/types/${chosen.wid}/rating-table/results?theme=${theme}`); await expect(page.getByRole('table', { name: '载流量表', exact: true })).toBeVisible();
    await page.getByRole('row', { name: row.name, exact: true }).click(); await expect(page.locator('.property-row').filter({ has: page.getByText('完整电流精度', { exact: true }) }).locator('dd')).toContainText(String(row.value_a)); await layout();
    result.states.push(await page.locator('[data-type-page=rating-table-results]').getAttribute('data-type-state'));
  }
  expect(await page.getByRole('table', { name: '载流量表', exact: true }).locator('tbody tr').count()).toBe(data.rows.length);
  result.workflows.push({ name: '实际保存电流、拒算与未运行行、完整精度和条件来源', wid: chosen.wid, run: chosen.run.id, rows: data.rows.length });
  await page.goto(`${fixture.url}/types/${chosen.wid}/rating-table/results?run=${chosen.run.id}`); await expect(page.getByRole('button', { name: '添加工况', exact: true })).toBeDisabled(); await expect(page.getByRole('textbox', { name: row.name + ' 中心埋深', exact: true })).toHaveAttribute('readonly', ''); await shot('rating-table-fixed-run');
  for (const kind of ['loading', 'error']) {
    const pattern = `**/api/workspaces/${chosen.wid}/studies`; await context.route(pattern, async route => { if (kind === 'loading') { await new Promise(resolve => setTimeout(resolve, 1800)); return route.continue(); } return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '验证载流量工况读取失败' }) }); });
    await page.goto(`${fixture.url}/types/${chosen.wid}/rating-table/results`); await expect(page.locator('[data-type-page=rating-table-results]')).toHaveAttribute('data-type-state', kind); result.states.push(kind); await shot('rating-table-' + kind); await context.unroute(pattern);
  }
  expect(fixture.errors).toEqual([]); expect(result.localSolverRuns).toBe(0);expect(result.iecAlgebraRuns).toBe(1);
} catch (error) { result.failure = String(error.stack || error); result.failureUrl = page.url(); console.error(result.failure); console.error(page.url()); console.error((await page.locator('body').innerText()).slice(0, 2500)); await shot('rating-table-failure').catch(() => {}); process.exitCode = 1; }
finally { result.states = [...new Set(result.states)]; await fs.writeFile(path.join(output, 'rating-verification.json'), JSON.stringify(result, null, 2)); await fixture.close(); }
