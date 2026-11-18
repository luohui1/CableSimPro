import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { walkthrough } from './verify-workbench-support.mjs';
import { installReadinessObserver, waitForPageReady } from './page-readiness.mjs';

// Chromium's native PDF viewer has no DOM paint signal. Read its unmodified
// screenshot: a blob URL or a loaded iframe can still be an entirely dark shell.
// Pillow is already pinned by the same backend environment as isolated-e2e.
async function pdfPaperPaint(png) {
  const source = `import io,json,sys
from PIL import Image
im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('L')
w,h=im.size
p=im.load()
# Exclude the native toolbar, thumbnail rail and right scrollbar. Require both
# a substantial paper surface and text-like ink surrounded by that paper.
x0,x1=int(w*.45),w-24
y0,y1=64,h-12
white=ink=rows=total=0
for y in range(y0+4,y1-4,2):
    line=0
    for x in range(x0+4,x1-4,2):
        total+=1
        if p[x,y]>235: white+=1
        elif p[x,y]<150 and sum(p[x+dx,y+dy]>235 for dx,dy in ((-3,0),(3,0),(0,-3),(0,3),(-3,-3),(3,-3),(-3,3),(3,3)))>=6:
            ink+=1; line+=1
    if line>=2: rows+=1
print(json.dumps({'width':w,'height':h,'whiteFraction':white/max(total,1),'inkPixels':ink,'inkRows':rows,'painted':white/max(total,1)>=.3 and ink>=100 and rows>=10}))`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.E2E_PYTHON || process.env.PYTHON || 'python', ['-c', source], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [], errors = [];
    child.stdout.on('data', value => output.push(value));
    child.stderr.on('data', value => errors.push(value));
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(Error('PDF 预览像素读取失败：' + Buffer.concat(errors).toString().slice(0, 2000)));
      try { resolve(JSON.parse(Buffer.concat(output).toString())); }
      catch (error) { reject(error); }
    });
    child.stdin.end(png);
  });
}

// Read the real download, including escaped quotes and multiline source cells.
function csvRows(text) {
  const rows = [], input = text.replace(/^\uFEFF/, '');
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\r' || char === '\n')) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw Error('CSV 下载含未闭合的引号');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Engineering changes go through the real interface. GETs verify saved identities.
let readinessInstalled = false;
await walkthrough('research', async ({ page, expect, base, api, choose, step, check, capture, out, size, tag, report }) => {
  if (!readinessInstalled) { await installReadinessObserver(page); readinessInstalled = true; }
  const command = () => page.getByRole('toolbar', { name: '工程命令', exact: true });
  const field = label => page.getByLabel(label, { exact: true });
  async function clickCommand(label) {
    const button = command().getByRole('button', { name: label, exact: true });
    if (await button.isVisible()) return button.click();
    await command().getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  }
  async function fill(label, value) {
    await field(label).fill(value);
    await field(label).press('Enter');
  }
  async function independent(label, action) {
    try { return await step(label, action); }
    catch (error) {
      if (report.phase !== 'before') throw error;
      check(label + '可完成', false, error.message);
    }
  }
  if (report.phase === 'after') {
    const owners = await api('/api/workspaces');
    const archives = await Promise.all(owners.map(owner => api(`/api/workspaces/${owner.id}/deliveries`)));
    const count = archives.reduce((sum, items) => sum + items.length, 0);
    (report.deliveryEmptyStarts ||= []).push({ ...size, scope: 'global', applicable: count === 0, archivedCount: count,
      reason: count ? '保留已有真实交付，不清库制造全局空态；本尺寸仍验证新工程的自然空态。' : '本次隔离库尚无交付。' });
    if (count === 0) await step('00-empty-deliveries-start-research', async () => {
      const writesBefore = report.writes.length;
      await page.goto(base + '/deliveries?theme=light');
      await expect(page.getByRole('heading', { name: '还没有交付', exact: true })).toBeVisible();
      const start = page.getByRole('button', { name: '选择研究', exact: true });
      await expect(page.locator('.button-primary:visible')).toHaveCount(1);
      await expect(start).toHaveClass(/button-primary/);
      await expect(page.getByRole('button', { name: '选择型号', exact: true })).toBeVisible();
      await capture('00-global-deliveries-empty-starts');
      await start.focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(next => next.pathname === '/studies' && next.searchParams.get('theme') === 'light'
        && !next.searchParams.get('workspace'));
      await expect(page.locator('.topbar h1')).toHaveText('工程与研究');
      await expect(page.getByRole('table', { name: '研究列表', exact: true })).toBeVisible();
      const afterArchives = await Promise.all(owners.map(owner => api(`/api/workspaces/${owner.id}/deliveries`)));
      check('全局空交付可用Enter进入真实研究目录且没有生成交付', report.writes.length === writesBefore
        && afterArchives.every(items => items.length === 0), { writes: report.writes.slice(writesBefore), owners: owners.length });
    });
  }
  await step('01-create-project-and-research', async () => {
    await page.goto(base + '/?theme=light');
    await page.getByRole('button', { name: '新建研究', exact: true }).first().click();
    await choose('所属工程', '新建工程');
    await choose('研究任务', '额定载流量');
    await field('研究名称').fill('直埋载流量 · ' + tag);
    await choose('引用型号版本', /^YJL02-12\/20 kV 1×400（结构演示）/);
    await choose('计算方法', /^IEC 60287/);
    await capture('01-new-project-form');
    const projectName = page.getByRole('textbox', { name: '工程名称', exact: true });
    check('新建工程可以填写明确工程名', await projectName.count() > 0);
    if (await projectName.count()) await projectName.fill('直埋线路 · ' + tag);
    check('研究可从选择电缆进入新建型号', await page.getByRole('button', { name: /新建型号|新建电缆/ }).count() > 0);
    await page.getByRole('button', { name: '建立研究', exact: true }).first().click();
    await page.waitForURL(/\/studies\/[^/?]+\/ampacity\/results/);
    await expect(page.getByRole('button', { name: '预检并运行', exact: true })).toBeVisible();
    const treeName = page.locator('.project-explorer .explorer-study-name b').filter({ hasText: tag });
    await expect(treeName).toBeVisible();
    check('工程树显示完整研究名称', await treeName.evaluate(node => node.scrollWidth <= node.clientWidth + 1
      && node.scrollHeight <= node.clientHeight + 1), { title: await treeName.innerText() });
    if (report.phase === 'after') {
      const createdUrl = new URL(page.url()), createdSid = createdUrl.pathname.split('/')[2], createdWid = createdUrl.searchParams.get('workspace');
      expect(createdWid).toBeTruthy();
      const [workspaceIndex, typeIndex, projectStudies] = await Promise.all([
        api('/api/workspaces'), api('/api/design/type-workspaces'), api(`/api/workspaces/${createdWid}/studies`),
      ]);
      const typeIds = new Set(typeIndex.map(item => item.id));
      const projectIds = new Set(workspaceIndex.filter(item => !typeIds.has(item.id)).map(item => item.id));
      const savedProject = workspaceIndex.find(item => item.id === createdWid);
      expect(savedProject?.name).toBe('直埋线路 · ' + tag);
      expect(projectStudies.some(item => item.id === createdSid && item.workspace === createdWid)).toBe(true);
      const sidebar = page.locator('.workbench-sidebar');
      const currentProject = sidebar.locator('a.tree-object').filter({ hasText: savedProject.name });
      await expect(currentProject).toHaveCount(1);
      await expect(currentProject).toHaveAttribute('aria-current', 'page');
      await expect(currentProject.locator('.tree-label')).toHaveText(savedProject.name);
      await expect(currentProject.locator('.tree-count')).toHaveText(String(projectStudies.length));
      await expect(currentProject).toBeInViewport({ ratio: 1 });
      if (projectIds.size > 3) await expect(sidebar.getByRole('link', { name: `全部 ${projectIds.size} 个工程`, exact: true })).toBeVisible();
      const objects = await sidebar.locator('a.tree-object').evaluateAll(links => links.map(link => {
        const url = new URL(link.href);
        return { name: link.textContent.trim(), path: url.pathname, workspace: url.searchParams.get('workspace'), current: link.getAttribute('aria-current') };
      }));
      const projectLinks = objects.filter(item => item.path === '/studies');
      check('新建后工程目录立即显示当前工程、真实研究数及正确分组', projectIds.has(createdWid)
        && projectLinks.some(item => item.workspace === createdWid && item.current === 'page')
        && projectLinks.every(item => projectIds.has(item.workspace))
        && objects.filter(item => item.path.startsWith('/types/')).every(item => typeIds.has(item.path.split('/')[2]))
        && (projectIds.size > 3 || projectLinks.length === projectIds.size),
      { workspace: createdWid, study: createdSid, studyCount: projectStudies.length, projectCount: projectIds.size, visibleObjects: objects });
      await capture('01-created-project-navigation');

      // Use the new directory entry immediately, without reloading the app or
      // waiting for the index's stale time to hide a missing invalidation.
      await currentProject.focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(next => next.pathname === '/studies' && next.searchParams.get('workspace') === createdWid);
      const projectTable = page.getByRole('table', { name: '本工程研究', exact: true });
      const studyLink = projectTable.getByRole('link', { name: '直埋载流量 · ' + tag, exact: true });
      await expect(studyLink).toBeVisible();
      await expect(projectTable.locator('tbody tr')).toHaveCount(projectStudies.length);
      const createdStudy = projectStudies.find(item => item.id === createdSid);
      const savedRuns = await api(`/api/workspaces/${createdWid}/studies/${createdSid}/runs?view=summary&limit=100`);
      const studyRow = projectTable.getByRole('row').filter({ has: page.getByRole('link', { name: '直埋载流量 · ' + tag, exact: true }) });
      const stateCell = studyRow.locator('.status-mark');
      await expect(stateCell).toHaveText('未运行');
      const stateText = (await stateCell.innerText()).trim();
      await capture('01-project-directory-keyboard-navigation');
      check('尚无运行的新研究在工程目录显示未运行', !!createdStudy && createdStudy.latest_run == null
        && savedRuns.items.length === 0 && stateText === '未运行',
      { workspace: createdWid, study: createdSid, latestRun: createdStudy?.latest_run ?? null,
        runCount: savedRuns.items.length, visibleStatus: stateText });
      await studyLink.click();
      await page.waitForURL(next => next.pathname === `/studies/${createdSid}/ampacity/results` && next.searchParams.get('workspace') === createdWid);
      await expect(page.getByRole('button', { name: '预检并运行', exact: true })).toBeVisible();
      check('新工程目录可用键盘进入并用鼠标返回同一研究', new URL(page.url()).searchParams.get('workspace') === createdWid);
    }
  });
  const url = new URL(page.url());
  const sid = url.pathname.split('/')[2], wid = url.searchParams.get('workspace');
  expect(wid).toBeTruthy();
  if (report.phase === 'after') {
    expect((await api(`/api/workspaces/${wid}`)).domain.name).toBe('直埋线路 · ' + tag);
  }
  const prefix = `/api/workspaces/${wid}/studies/${sid}`;
  if (report.phase === 'after') await step('01b-empty-project-deliveries-return-to-same-study', async () => {
    const before = await api(`/api/workspaces/${wid}`), beforeArchives = await api(`/api/workspaces/${wid}/deliveries`);
    expect(beforeArchives).toEqual([]);
    const writesBefore = report.writes.length;
    await page.locator('.workbench-sidebar').getByRole('link', { name: '交付', exact: true }).click();
    await page.waitForURL(next => next.pathname === '/deliveries');
    await choose('所属', before.domain.name);
    await expect(page.getByRole('heading', { name: '这个工程还没有交付', exact: true })).toBeVisible();
    const start = page.getByRole('button', { name: '打开工程研究', exact: true });
    await expect(page.locator('.button-primary:visible')).toHaveCount(1);
    await expect(start).toHaveClass(/button-primary/);
    await expect(page.getByRole('button', { name: '打开型号规格书', exact: true })).toHaveCount(0);
    await capture('01b-new-project-deliveries-empty');
    await start.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(next => next.pathname === '/studies' && next.searchParams.get('workspace') === wid
      && next.searchParams.get('theme') === 'light');
    const studyLink = page.getByRole('table', { name: '本工程研究', exact: true })
      .getByRole('link', { name: '直埋载流量 · ' + tag, exact: true });
    await expect(studyLink).toBeVisible();
    await capture('01b-delivery-start-preserves-project');
    await studyLink.click();
    await page.waitForURL(next => next.pathname === `/studies/${sid}/ampacity/results` && next.searchParams.get('workspace') === wid
      && next.searchParams.get('theme') === 'light');
    await expect(page.getByRole('button', { name: '预检并运行', exact: true })).toBeVisible();
    const after = await api(`/api/workspaces/${wid}`), afterArchives = await api(`/api/workspaces/${wid}/deliveries`);
    check('新工程空交付可用键盘打开本工程并用鼠标返回同一研究且零写入', after.revision === before.revision
      && isDeepStrictEqual(after.domain, before.domain) && afterArchives.length === 0 && report.writes.length === writesBefore,
    { workspace: wid, study: sid, revision: after.revision, writes: report.writes.slice(writesBefore) });
    (report.deliveryEmptyStarts ||= []).push({ ...size, scope: 'project', applicable: true, workspace: wid, study: sid, archivedCount: 0 });
  });
  if (report.phase === 'after') await step('01c-empty-report-tabs-return-to-current-calculation', async () => {
    const before = await api(`/api/workspaces/${wid}`), beforeStudy = await api(prefix);
    expect((await api(prefix + '/runs?view=summary&limit=100')).items).toEqual([]);
    expect(await api(`/api/workspaces/${wid}/deliveries`)).toEqual([]);
    const writesBefore = report.writes.length;
    for (const [tab, label, keyboard] of [['content', '内容', false], ['sources', '来源', true], ['preview', '预览', false]]) {
      await page.locator('.project-explorer').getByRole('link', { name: '计算书内容', exact: true }).click();
      await page.waitForURL(next => next.pathname === `/studies/${sid}/report/content` && next.searchParams.get('workspace') === wid);
      if (tab !== 'content') await page.getByRole('tablist', { name: '计算书页签', exact: true }).getByRole('tab', { name: label, exact: true }).click();
      await page.waitForURL(next => next.pathname === `/studies/${sid}/report/${tab}`);
      await expect(page.getByRole('heading', { name: '尚无可交付运行', exact: true })).toBeVisible();
      const start = page.getByRole('button', { name: '返回载流量', exact: true });
      await expect(page.locator('.button-primary:visible')).toHaveCount(1);
      await expect(start).toHaveClass(/button-primary/);
      await capture('01c-empty-report-' + tab + '-start');
      if (keyboard) { await start.focus(); await page.keyboard.press('Enter'); }
      else await start.click();
      await page.waitForURL(next => next.pathname === `/studies/${sid}/ampacity/results`
        && next.searchParams.get('workspace') === wid && next.searchParams.get('theme') === 'light'
        && !next.searchParams.get('run') && !next.searchParams.get('delivery')
        && next.searchParams.get('generate') !== 'true' && next.searchParams.get('preflight') !== 'true');
      await expect(page.getByRole('button', { name: '预检并运行', exact: true })).toBeVisible();
      const [after, afterStudy, runs, archives] = await Promise.all([
        api(`/api/workspaces/${wid}`), api(prefix), api(prefix + '/runs?view=summary&limit=100'), api(`/api/workspaces/${wid}/deliveries`),
      ]);
      check(`未运行计算书${label}页可${keyboard ? '用Enter' : '用鼠标'}返回同一研究计算入口且零写入`, after.revision === before.revision
        && isDeepStrictEqual(after.domain, before.domain) && afterStudy.revision === beforeStudy.revision
        && isDeepStrictEqual(afterStudy.definition, beforeStudy.definition) && runs.items.length === 0
        && archives.length === 0 && report.writes.length === writesBefore,
      { workspace: wid, study: sid, tab, revision: after.revision, studyRevision: afterStudy.revision, writes: report.writes.slice(writesBefore) });
      (report.deliveryEmptyStarts ||= []).push({ ...size, scope: 'study-report', tab, applicable: true, workspace: wid, study: sid,
        runCount: runs.items.length, archivedCount: archives.length });
      await capture('01c-report-' + tab + '-returned-to-same-calculation');
    }
  });
  await step('02-installation-load-and-environment', async () => {
    await page.getByRole('button', { name: '更多绘图工具', exact: true }).click();
    await page.getByRole('button', { name: '敷设模板', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '敷设模板', exact: true });
    await choose('模板', '单回品字', dialog);
    await dialog.getByLabel('中心埋深', { exact: true }).fill('0.9');
    await dialog.getByRole('button', { name: '应用模板', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (await page.locator('.drawing-secondary-tools').isVisible()) await page.keyboard.press('Escape');
    await fill('介质热阻率', '0.8');
    await fill('回路 1 · 电流', '500');
    check('草稿显示改了几项', /改了\s*\d+\s*项|\d+\s*(?:项修改|处未保存)/.test(await command().innerText()));
    await command().getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
  });
  const savedInputUrl = page.url();
  await independent('03a-drag-placement-and-undo', async () => {
    const before = await api(`/api/workspaces/${wid}`);
    const cable = page.getByRole('button', { name: /^选择电缆 .*A$/ });
    await expect(cable).toBeVisible();
    const point = await cable.locator('.drawing-hit-area').boundingBox();
    expect(point).toBeTruthy();
    const x = point.x + point.width / 2, y = point.y + point.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 20, y - 12, { steps: 8 }); await page.mouse.up();
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await capture('03a-placement-drag-is-unsaved');
    check('图上拖动先暂存，不改保存工程', JSON.stringify((await api(`/api/workspaces/${wid}`)).domain) === JSON.stringify(before.domain));
    await clickCommand('撤销');
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    check('图上拖动可撤销，保存工程保持原值', JSON.stringify((await api(`/api/workspaces/${wid}`)).domain) === JSON.stringify(before.domain));
  });
  if (report.phase === 'before' && await command().getByRole('button', { name: '保存修改', exact: true }).isVisible()) {
    await clickCommand('撤销');
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
  }
  await independent('03-keyboard-undo-and-redo', async () => {
    await fill('介质热阻率', '1.1');
    await page.getByRole('button', { name: '更多绘图工具', exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(0.8);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(1.1);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(0.8);
  });
  if (report.phase === 'before' && Number(await field('介质热阻率').inputValue()) !== 0.8) {
    // Return through the interface to the saved input before continuing independent results checks.
    const leaveDraft = dialog => dialog.accept();
    page.on('dialog', leaveDraft);
    try { await page.goto(savedInputUrl); }
    finally { page.off('dialog', leaveDraft); }
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(0.8);
  }
  async function run(previous) {
    await page.getByRole('button', { name: '预检并运行', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '运行前预检' });
    await expect(dialog).toContainText('你的工况在适用范围内', { timeout: 90000 });
    if (await dialog.getByRole('checkbox').count()) await dialog.getByRole('checkbox').check();
    await capture('run-preflight');
    await dialog.getByRole('button', { name: '确认并运行', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 90000 });
    await page.waitForURL(next => !!next.searchParams.get('run') && next.searchParams.get('run') !== previous, { timeout: 120000 });
    const id = new URL(page.url()).searchParams.get('run');
    const saved = await api(prefix + '/runs/' + id);
    expect(saved.integrity).toBe('verified');
    expect(saved.status).toBe('succeeded');
    return saved;
  }
  let first, second;
  await step('04-run-and-read-conclusion', async () => {
    first = await run();
    const conclusion = page.getByRole('region', { name: '载流量结论', exact: true });
    await expect(conclusion).toBeVisible();
    await expect(conclusion).toContainText(/允许|载流量/);
    await expect(conclusion).toContainText(/最热|温限/);
  });
  await independent('05-temperature-and-loss-details', async () => {
    for (const [label, shot] of [['温度与电流', '05-layer-temperatures'], ['损耗', '05-losses']]) {
      const detail = page.locator('details.study-detail-group').filter({ has: page.locator('summary', { hasText: label }) });
      check('结果可展开' + label, await detail.count() > 0);
      if (await detail.count()) {
        if (await detail.getAttribute('open') === null) await detail.locator('summary').click();
        const table = detail.getByRole('table');
        await expect(table).toBeVisible();
        // Reading the table means bringing its data into the clipped result
        // panel, not merely finding an offscreen DOM node after expansion.
        const rows = table.getByRole('row');
        await rows.nth(1).scrollIntoViewIfNeeded();
        await expect(rows.nth(1)).toBeInViewport();
        if (report.phase === 'after') for (const phase of ['A','B','C'])
          await expect(table).toContainText(new RegExp(phase + '\\s*相'));
        await capture(shot);
        await rows.last().scrollIntoViewIfNeeded();
        await expect(rows.last()).toBeInViewport();
        await capture(shot + '-last-rows');
        await detail.locator('summary').click();
      }
    }
  });
  await step('06-change-one-condition-and-rerun', async () => {
    await fill('介质热阻率', '1.1');
    await page.keyboard.press('Control+s');
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    await expect(page.locator('.study-history-line')).toBeVisible();
    const oldRun = await api(prefix + '/runs/' + first.id);
    check('输入保存后旧运行保持历史且不能当作当前结果交付', oldRun.freshness === 'historical', oldRun.freshness);
    const reportButton = command().getByRole('button', { name: '生成计算书', exact: true });
    if (await reportButton.isVisible()) await expect(reportButton).toBeDisabled();
    else {
      await command().getByRole('button', { name: '更多操作', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: '生成计算书', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
    }
    await capture('06-previous-result-is-historical');
    second = await run(first.id);
    const preserved = await api(prefix + '/runs/' + first.id);
    expect(preserved.input_digest).toBe(first.input_digest);
    expect(second.input_digest).not.toBe(first.input_digest);
  });
  const resultUrl = page.url();
  await independent('07-compare-saved-runs', async () => {
    await choose('分析', '方法对比');
    const table = page.getByRole('table', { name: '可比较运行', exact: true });
    await expect(table).toBeVisible();
    const choices = table.getByRole('checkbox');
    const saved = await api(prefix + '/runs?view=summary&limit=100');
    expect(saved.items.filter(item => item.integrity === 'verified' && item.status === 'succeeded')).toHaveLength(2);
    await expect(choices.first()).toBeVisible();
    await capture('07-saved-runs-available-for-selection');
    if (!check('两次真实保存运行均可在界面勾选比较', await choices.count() === 2,
      { saved: saved.items.map(item => item.id), visibleChoices: await choices.count(), screen: await table.innerText() })) return;
    await choices.nth(0).check(); await choices.nth(1).check();
    await page.getByRole('button', { name: '比较所选运行', exact: true }).click();
    await page.getByRole('tab', { name: '输入差异', exact: true }).click();
    const difference = page.getByRole('table', { name: '对比输入差异', exact: true });
    await expect(difference).toBeVisible();
    const soil = difference.getByRole('row').filter({hasText:'热阻率'});
    await expect(soil.first()).toBeVisible();
    await soil.first().evaluate(row => row.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const soilText = await soil.first().innerText();
    await capture('07-input-differences');
    check('对比指出改动的具体条件及前后值', /0[.]8/.test(soilText) && /1[.]1/.test(soilText), soilText);
    check('保存输入的土壤材料名称以中文显示', /土壤/.test(soilText) && !/v0 soil/.test(soilText), soilText);
    await page.getByRole('tab', { name: '结果', exact: true }).click();
    const results = page.getByRole('table', { name: '方法结果差异', exact: true });
    await expect(results).toBeVisible();
    async function checkResultWidth(position) {
      const geometry = await results.evaluate(table => {
        let left = 0, right = innerWidth;
        const containers = [];
        for (let node = table.parentElement; node; node = node.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowX)) {
            const box = node.getBoundingClientRect();
            left = Math.max(left, box.left); right = Math.min(right, box.right);
            containers.push({ width: node.clientWidth, content: node.scrollWidth });
          }
        }
        const box = table.getBoundingClientRect();
        const clipped = [...table.querySelectorAll('tr > :last-child')].flatMap(cell => {
          const bounds = cell.getBoundingClientRect();
          return bounds.left < left - 1 || bounds.right > right + 1 || cell.scrollWidth > cell.clientWidth + 1
            ? [{ text: cell.textContent, left: bounds.left, right: bounds.right, width: cell.clientWidth, content: cell.scrollWidth }] : [];
        });
        return { left, right, tableLeft: box.left, tableRight: box.right, width: table.clientWidth, content: table.scrollWidth, containers, clipped };
      });
      check(`比较结果${position}五列无需横向滚动且差值完整显示`, geometry.tableLeft >= geometry.left - 1
        && geometry.tableRight <= geometry.right + 1 && geometry.content <= geometry.width + 1
        && geometry.containers.every(item => item.content <= item.width + 1) && geometry.clipped.length === 0, geometry);
    }
    await results.locator('thead').evaluate(header => header.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await capture('07-result-differences-start');
    await checkResultWidth('首部');
    await results.locator('tbody tr').last().evaluate(row => row.scrollIntoView({ block: 'end', inline: 'nearest' }));
    await capture('07-result-differences-end');
    await checkResultWidth('尾部');
    const csvButton = page.getByRole('button', { name: '导出对比 CSV', exact: true });
    const pending = page.waitForEvent('download', { timeout: 90000 });
    await csvButton.click();
    const file = await pending;
    const csvPath = path.join(out, 'comparison-' + tag + '.csv');
    await file.saveAs(csvPath);
    const csv = await fs.readFile(csvPath, 'utf8'), [headers, ...exported] = csvRows(csv);
    expect(headers).toEqual(['物理量', '对象', '输出条件', '基准 / SI', '对照 / SI', '差值 / SI', '单位', '来源']);
    expect(exported.length).toBeGreaterThan(0);
    expect(exported.every(row => row.length === headers.length)).toBe(true);

    const evidencePending = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载未配对量与固定记录', exact: true }).click();
    const evidenceFile = await evidencePending, evidencePath = path.join(out, 'comparison-evidence-' + tag + '.json');
    await evidenceFile.saveAs(evidencePath);
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
    await capture('07-fixed-comparison-evidence-download');
    const fullRuns = await Promise.all([first, second].map(saved => api(prefix + '/runs/' + saved.id + '?view=full')));
    const byRun = new Map(fullRuns.map(saved => [saved.id, saved]));
    expect(evidence.sources.map(source => source.run_id).sort()).toEqual([...byRun.keys()].sort());
    check('独立 JSON 下载保留两次运行的完整固定输入与方法清单', evidence.sources.every(source => {
      const saved = byRun.get(source.run_id);
      return saved.integrity === 'verified' && source.sequence === saved.sequence
        && isDeepStrictEqual(source.snapshot, saved.snapshot);
    }), { runs: [...byRun.keys()], bytes: (await fs.stat(evidencePath)).size });

    // Excel documents a 32,767-character cell limit. The compact source should
    // remain substantially below it, without truncating any saved identity.
    // https://support.microsoft.com/en-us/excel/excel-specifications-and-limits
    const maxCellChars = Math.max(...exported.flatMap(row => row.map(cell => cell.length)));
    const maxSourceChars = Math.max(...exported.map(row => row[7].length));
    check('CSV 单元格可由表格软件完整保存且来源不重复整份快照', maxCellChars <= 32767 && maxSourceChars <= 4096,
      { rows: exported.length, bytes: Buffer.byteLength(csv, 'utf8'), maxCellChars, maxSourceChars });
    const expected = evidence.differences.flatMap(difference => difference.quantities.map(quantity => ({ difference, quantity })));
    expect(exported).toHaveLength(expected.length);
    const matched = new Set();
    for (const row of exported) {
      const source = JSON.parse(row[7]);
      expect(Object.keys(source).sort()).toEqual(['baseline', 'comparison', 'quantity']);
      expect(Object.keys(source.quantity).sort()).toEqual(['case_id', 'condition', 'entity', 'key', 'unit']);
      const index = expected.findIndex(({ difference, quantity }) => difference.baseline_run_id === source.baseline.run_id
        && difference.run_id === source.comparison.run_id && ['case_id', 'condition', 'entity', 'key', 'unit'].every(key => quantity[key] === source.quantity[key]));
      expect(index, 'CSV 每行必须对应真实比较中的唯一物理量与运行对').toBeGreaterThanOrEqual(0);
      expect(matched.has(index), 'CSV 不能以重复行替代遗漏结果').toBe(false); matched.add(index);
      const { quantity } = expected[index];
      expect(row[3]).not.toBe(''); expect(row[4]).not.toBe(''); expect(row[5]).not.toBe('');
      expect([Number(row[3]), Number(row[4]), Number(row[5]), row[6]])
        .toEqual([quantity.baseline, quantity.value, quantity.difference, quantity.unit ?? '']);
      for (const role of ['baseline', 'comparison']) {
        const trace = source[role], saved = byRun.get(trace.run_id);
        expect(saved, '来源必须指向本次勾选的真实保存运行').toBeTruthy();
        const outputCase = saved.output.cases.find(item => item.case_id === source.quantity.case_id);
        expect(outputCase, 'CSV 的物理量工况必须存在于对应保存运行').toBeTruthy();
        const method = outputCase.method || saved.snapshot.definition.method;
        expect(trace).toEqual({
          workspace_id: saved.workspace, study_id: saved.study, run_id: saved.id, sequence: saved.sequence,
          input_digest: saved.input_digest, output_digest: saved.output_digest,
          method: { plugin_id: method.plugin_id, capability: method.capability, version: method.version, release_digest: method.release_digest },
        });
      }
    }
    check('CSV 每行基准与对照的运行、摘要、方法版本及 SI 数值均与固定记录一致', matched.size === expected.length,
      { rows: matched.size, runs: fullRuns.map(saved => ({ id: saved.id, sequence: saved.sequence, input_digest: saved.input_digest, output_digest: saved.output_digest })) });
    await csvButton.scrollIntoViewIfNeeded();
  });
  await independent('08-calculation-book-download', async () => {
    await page.goto(resultUrl);
    await expect(page.getByRole('region', { name: '载流量结论', exact: true })).toBeVisible();
    await expect(command()).toBeVisible();
    await clickCommand('生成计算书');
    await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({ timeout: 90000 });
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    const file = await pending, target = path.join(out, 'calculation-book-' + tag + '.pdf');
    await file.saveAs(target);
    const pdf = await fs.readFile(target), pdfSha256 = createHash('sha256').update(pdf).digest('hex');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await page.waitForURL(next => !!next.searchParams.get('delivery'));
    const deliveryId = new URL(page.url()).searchParams.get('delivery');
    expect(deliveryId).toBeTruthy();
    const delivery = await api(`/api/workspaces/${wid}/deliveries/${deliveryId}?view=summary`);
    const source = delivery.sources?.find(item => item.run_id === second.id);
    check('计算书引用本次保存运行及准确输入输出摘要', !!source
      && source.input_digest === second.input_digest && source.output_digest === second.output_digest,
      { run: second.id, delivery: deliveryId, source });
    if (report.phase === 'after') {
      const frame = page.locator('iframe[title="计算书预览"]');
      await expect(frame).toBeVisible();
      await expect(frame).toHaveAttribute('src', /^blob:/);
      const binding = await frame.evaluate(async node => {
        const bytes = await (await fetch(node.src)).arrayBuffer();
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        return { src: node.src, bytes: bytes.byteLength, sha256, signature: new TextDecoder().decode(bytes.slice(0, 5)) };
      });
      expect(binding).toMatchObject({ bytes: pdf.length, sha256: pdfSha256, signature: '%PDF-' });
      const started = Date.now(), attempts = [];
      let pixels, screenshot;
      try {
        await expect.poll(async () => {
          screenshot = await frame.screenshot({ animations: 'disabled' });
          pixels = await pdfPaperPaint(screenshot);
          attempts.push({ elapsedMs: Date.now() - started, ...pixels });
          return pixels.painted;
        }, { timeout: 30000, intervals: [100, 250, 500], message: '真实计算书预览必须绘出纸面与文字，黑色外壳不算完成' }).toBe(true);
      } finally {
        if (screenshot) await fs.writeFile(path.join(out, 'calculation-book-preview-' + tag + '.png'), screenshot);
        (report.pdfPreviews ||= []).push({ ...size, run: second.id, delivery: deliveryId, download: path.basename(target),
          preview: 'calculation-book-preview-' + tag + '.png', binding, attempts });
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await frame.getAttribute('src')).toBe(binding.src);
      expect(new URL(page.url()).searchParams.get('delivery')).toBe(deliveryId);
      const finalScreenshot = await frame.screenshot({ animations: 'disabled' });
      const finalPixels = await pdfPaperPaint(finalScreenshot);
      await fs.writeFile(path.join(out, 'calculation-book-preview-' + tag + '.png'), finalScreenshot);
      Object.assign(report.pdfPreviews.at(-1), { finalPixels,
        screenshotSha256: createHash('sha256').update(finalScreenshot).digest('hex') });
      check('计算书预览与原始下载字节一致且已绘出实际纸面文字', finalPixels.painted,
        { run: second.id, delivery: deliveryId, pdfSha256, preview: binding, pixels: finalPixels });
    }
  });
  await independent('08b-official-calculation-pdf-and-excel', async () => {
    // The formal T4 route is deliberately separate from archived HTML/PDF.
    // It must export the already verified second run without launching a solver.
    await expect(page).toHaveURL(/delivery=/);
    const opener = page.getByRole('button', { name: '正式交付（PDF / Excel）', exact: true });
    await expect(opener).toBeEnabled({ timeout: 60000 });
    const savedBefore = await api('/api/workspaces/' + wid);
    await opener.click();
    const dialog = page.getByRole('dialog', { name: '正式交付文件', exact: true });
    await expect(dialog).toBeVisible();
    const documentFields = [
      ['正式文件单位名称', 'T1 隔离工程验收单位'],
      ['正式文件编号', 'T1-CALC-' + tag],
      ['正式文件版次', 'A'],
    ];
    for (const [label, value] of documentFields) await dialog.getByRole('textbox', { name: label, exact: true }).fill(value);
    const endpoint = '/api/formal-deliveries';
    const [response] = await Promise.all([
      page.waitForResponse(reply => new URL(reply.url()).pathname === endpoint + '/preview'
        && reply.request().method() === 'POST', { timeout: 180000 }),
      dialog.getByRole('button', { name: '核对来源并预览', exact: true }).click(),
    ]);
    const model = await response.json();
    const request = response.request().postDataJSON();
    const validSources = Object.values(model.sources || {}).every(value => !Object.hasOwn(value || {}, 'payload'));
    check('正式计算书从实际二次运行生成完整模型预览', response.ok() && model.kind === 'calculation'
      && request.kind === 'calculation' && request.source.workspace_id === wid
      && request.source.expected_revision === savedBefore.revision
      && request.source.runs.length === 1
      && request.source.runs[0].run_id === second.id
      && request.source.runs[0].input_digest === second.input_digest
      && request.source.runs[0].output_digest === second.output_digest
      && /^[a-f0-9]{64}$/.test(model.model_digest)
      && /^[a-f0-9]{64}$/.test(model.source_digest) && validSources,
      { kind: model.kind, run: request.source.runs, expectedRevision: request.source.expected_revision,
        sourceDigest: model.source_digest, modelDigest: model.model_digest });
    await dialog.getByRole('checkbox', { name: '已核对正式交付来源和签栏', exact: true }).check();
    for (const format of ['pdf', 'xlsx']) {
      const [reply, download] = await Promise.all([
        page.waitForResponse(item => new URL(item.url()).pathname === endpoint + '/export'
          && item.request().method() === 'POST', { timeout: 180000 }),
        page.waitForEvent('download', { timeout: 180000 }),
        dialog.getByRole('button', { name: format === 'pdf' ? '下载正式 PDF' : '下载 Excel', exact: true }).click(),
      ]);
      const file = path.join(out, 'formal-calculation-' + tag + '.' + format);
      await download.saveAs(file);
      const bytes = await fs.readFile(file), headers = reply.headers(), payload = reply.request().postDataJSON();
      const byteDigest = createHash('sha256').update(bytes).digest('hex');
      check('正式计算书' + format.toUpperCase() + '文件与预览和实发字节完全同源', reply.ok()
        && payload.expected_model_digest === model.model_digest && payload.format === format
        && headers['x-delivery-model-sha256'] === model.model_digest
        && headers['x-delivery-source-sha256'] === model.source_digest
        && headers['x-artifact-sha256'] === byteDigest
        && (format === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : bytes.subarray(0, 2).toString() === 'PK'),
        { file: path.basename(file), bytes: bytes.length, sha256: byteDigest,
          sourceDigest: headers['x-delivery-source-sha256'], modelDigest: headers['x-delivery-model-sha256'] });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const savedAfter = await api('/api/workspaces/' + wid);
    check('正式文件预览和双格式导出不改写研究输入', savedAfter.revision === savedBefore.revision
      && JSON.stringify(savedAfter.domain) === JSON.stringify(savedBefore.domain),
      { beforeRevision: savedBefore.revision, afterRevision: savedAfter.revision });
  });
  await independent('09-create-type-from-research', async () => {
    const sidebar = page.locator('.workbench-sidebar');
    const visibleObjects = () => sidebar.locator('a.tree-object').evaluateAll(links => links.map(link => {
      const url = new URL(link.href);
      return { name: link.textContent.trim(), path: url.pathname, workspace: url.searchParams.get('workspace'), current: link.getAttribute('aria-current') };
    }));
    if (report.phase === 'after') {
      let releaseRequest, finishRequest, held = false;
      const release = new Promise(resolve => { releaseRequest = resolve; });
      const finished = new Promise(resolve => { finishRequest = resolve; });
      const endpoint = url => url.pathname === '/api/design/type-workspaces';
      const holdIndex = async route => {
        if (route.request().method() !== 'GET' || held) return route.continue();
        held = true;
        try { await release; await route.continue(); }
        finally { finishRequest(); }
      };
      // Exercise the observed index race with a genuine delayed GET. No input,
      // status, response or index membership is replaced by the walkthrough.
      await page.route(endpoint, holdIndex);
      try {
        const spacesRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspaces' && response.request().method() === 'GET');
        const typesRequested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/design/type-workspaces' && request.method() === 'GET');
        await page.goto(base + '/?theme=light');
        const response = await spacesRead;
        expect(response.ok(), '分类必须先取得真实工作区索引').toBe(true);
        await response.finished(); await typesRequested;
        await expect(sidebar.getByText('正在读取工程与型号', { exact: true })).toBeVisible();
        const waiting = await visibleObjects();
        check('型号索引未返回时不把工作区猜成工程', held && waiting.length === 0, { held, visibleObjects: waiting });
        await capture('09-sidebar-waits-for-real-type-index');
      } finally {
        releaseRequest();
        if (held) await finished;
        await page.unroute(endpoint, holdIndex);
      }
      await expect(sidebar.getByText('正在读取工程与型号', { exact: true })).toHaveCount(0);
    } else await page.goto(base + '/?theme=light');
    await page.getByRole('button', { name: '新建研究', exact: true }).first().click();
    const create = page.getByRole('dialog', {name:'新建研究',exact:true});
    await expect(create.getByRole('combobox', {name:'研究任务',exact:true})).toBeVisible();
    const entry = create.getByRole('button', {name:'新建型号',exact:true});
    await expect(entry).toBeEnabled();
    check('研究中的新建型号入口可操作', await entry.isVisible() && await entry.isEnabled());
    await capture('09-create-type-entry');
    await entry.click();
    await page.waitForURL(url => url.pathname === '/types' && url.searchParams.get('create') === 'true');
    const typeCreate = page.getByRole('dialog', {name:'新建型号设计',exact:true});
    const typeName = typeCreate.getByRole('textbox', {name:'型号名称',exact:true});
    await expect(typeName).toBeEditable();
    await expect(typeCreate.getByRole('radiogroup', {name:'起点',exact:true})).toBeVisible();
    await typeName.fill('研究转型号 · ' + tag);
    await expect(typeName).toHaveValue('研究转型号 · ' + tag);
    check('研究入口实际打开可编辑的型号创建表单', await typeCreate.isVisible() && await typeName.isEditable());
    if (report.phase === 'after') {
      const submit = typeCreate.getByRole('button', {name:'建立草稿',exact:true});
      await expect(typeCreate.getByRole('combobox', {name:'型号版本',exact:true})).toBeVisible();
      await expect(submit).toBeDisabled();
      const reason = typeCreate.getByRole('status').filter({hasText:'请选择一个可复制的型号版本'});
      await expect(reason).toBeVisible();
      check('型号创建禁用时就地说明缺少固定版本', await submit.getAttribute('aria-describedby') === await reason.getAttribute('id'));
      await capture('09-create-type-disabled-reason');
      const options = await api('/api/types/creation-options');
      const selected = options.library.find(item => /结构演示/.test(item.name)) || options.library[0];
      expect(selected, '必须选择真实型号起点，不伪造候选').toBeTruthy();
      const version = selected.version.replace(/\+engineering$/, '（工程版）').replace(/\+[^\s]+$/, '（定制版）');
      await choose('型号版本', selected.name + ' · ' + version, typeCreate);
      await expect(submit).toBeEnabled();
      await capture('09-create-type-selected-version');
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/types' && response.request().method() === 'POST'),
        submit.click(),
      ]);
      expect(response.ok()).toBe(true);
      const created = await response.json();
      await page.waitForURL(next => next.pathname === `/types/${created.id}/structure/section`);
      await expect(page.getByRole('navigation', {name:'型号浏览器',exact:true})).toBeVisible();
      const saved = await api(`/api/types/${created.id}/workspace`), pin = saved.type_origin_reference;
      check('从研究入口建立真实独立草稿并保留固定版本来源', saved.id !== wid && saved.domain.name === '研究转型号 · ' + tag
        && saved.type_creation?.kind === 'library' && saved.type_lifecycle?.status === 'draft'
        && pin?.id === selected.id && pin?.version === selected.version && pin?.content_sha256 === selected.content_sha256,
      {workspace:saved.id, source:pin, lifecycle:saved.type_lifecycle});
      const [typeIndex, workspaceIndex] = await Promise.all([api('/api/design/type-workspaces'), api('/api/workspaces')]);
      expect(typeIndex.some(item => item.id === saved.id), '新型号必须真实出现在宿主型号索引').toBe(true);
      const currentType = sidebar.locator('a.tree-object[aria-current="page"]').filter({ hasText: saved.domain.name });
      await expect(currentType).toHaveCount(1);
      await expect(currentType).toHaveAttribute('href', new RegExp(`/types/${saved.id}/structure/table(?:\\?|$)`));
      await expect(currentType).toBeInViewport({ ratio: 1 });
      if (typeIndex.length > 3) await expect(sidebar.getByRole('link', { name: `全部 ${typeIndex.length} 个型号设计`, exact: true })).toBeVisible();
      const typeIds = new Set(typeIndex.map(item => item.id));
      const projectIds = new Set(workspaceIndex.filter(item => !typeIds.has(item.id)).map(item => item.id));
      const objects = await visibleObjects();
      const typeLinks = objects.filter(item => item.path.startsWith('/types/'));
      check('创建后侧栏当前型号与总数刷新且工程分组不混入型号', objects.filter(item => item.path === '/studies').every(item => projectIds.has(item.workspace))
        && typeLinks.every(item => typeIds.has(item.path.split('/')[2]))
        && (typeIndex.length > 3 || typeLinks.length === typeIndex.length),
      { created: saved.id, typeCount: typeIndex.length, projectCount: projectIds.size, visibleObjects: objects });
    }
  });
  if (report.phase === 'after') await step('10-saved-sweep-canvas-draft-survives-maximize', async () => {
    const projects = await api('/api/workspaces');
    const studies = (await Promise.all(projects.map(project => api(`/api/workspaces/${project.id}/studies`)))).flat();
    const scan = studies.find(row => row.definition.driver?.kind === 'sweep'
      && row.definition.input_source === 'domain' && row.latest_run?.status === 'succeeded'
      && row.definition.method.plugin_id === 'cablesim.iec60287');
    expect(scan, '发布库必须有真实保存的扫描研究；本回归不新建结果或启动计算').toBeTruthy();
    const scanPrefix = `/api/workspaces/${scan.workspace}/studies/${scan.id}`;
    async function savedInputs() {
      const [workspace, study, runs, run] = await Promise.all([
        api(`/api/workspaces/${scan.workspace}`), api(scanPrefix),
        api(scanPrefix + '/runs?view=summary&limit=100'), api(scanPrefix + '/runs/' + scan.latest_run.id + '?view=full'),
      ]);
      return { workspace: { id: workspace.id, revision: workspace.revision, domain: workspace.domain },
        study: { id: study.id, revision: study.revision, definition: study.definition },
        runs: runs.items.map(item => ({ id: item.id, sequence: item.sequence, status: item.status })),
        run: { id: run.id, integrity: run.integrity, status: run.status, input_digest: run.input_digest,
          output_digest: run.output_digest, snapshot: run.snapshot, output: run.output } };
    }
    const baseline = await savedInputs(), writesStart = report.writes.length;
    expect(baseline.run.integrity).toBe('verified');
    expect(baseline.run.status).toBe('succeeded');
    expect(baseline.run.snapshot.definition.driver.kind).toBe('sweep');
    const source = { workspace: scan.workspace, workspaceRevision: baseline.workspace.revision,
      study: scan.id, studyRevision: baseline.study.revision, run: baseline.run.id,
      inputDigest: baseline.run.input_digest, outputDigest: baseline.run.output_digest };
    await page.goto(`${base}/studies/${scan.id}/sweep/curve?workspace=${scan.workspace}&theme=light&inspector=input`);
    const workbench = page.locator('.study-workbench[data-analysis="sweep"]');
    const canvas = workbench.locator('.workbench-canvas');
    await expect(page.locator('.study-sweep-results .series-chart')).toBeVisible();
    const mountedChart = await page.locator('.study-sweep-results .series-chart').elementHandle();
    expect(mountedChart).toBeTruthy();
    const chartLabel = await page.locator('.study-sweep-results .series-chart').getByRole('img').getAttribute('aria-label');
    await expect(workbench).toHaveAttribute('data-dock', 'max');
    await expect(canvas).toHaveCount(0);
    check('保存扫描先显示真实曲线，未打开的隐藏画布尚未挂载', true, source);
    await capture('10-saved-sweep-before-opening-canvas');

    const inspectorTabs = page.getByRole('tablist', { name: '属性分页', exact: true });
    await inspectorTabs.getByRole('tab', { name: '方法', exact: true }).click();
    const scanVariable = page.getByRole('combobox', { name: '扫描变量', exact: true });
    await expect(scanVariable).toBeVisible();
    const variableName = page.locator('.study-sweep-variable-name');
    await expect(variableName).toBeVisible();
    await variableName.scrollIntoViewIfNeeded();
    const variableLayout = await variableName.evaluate(node => {
      const box = node.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
      return { text: node.textContent, font: parseFloat(getComputedStyle(node).fontSize),
        complete: rects.length > 0 && rects.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1
          && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1),
        inView: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth };
    });
    const variableControl = await scanVariable.evaluate(node => {
      const box = node.getBoundingClientRect();
      return { height: box.height, text: node.textContent.trim(), description: node.getAttribute('aria-describedby'),
        inView: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth };
    });
    expect(variableControl.description).toBe(await variableName.getAttribute('id'));
    expect(variableLayout.text).toContain(variableControl.text);
    expect(variableLayout.text).toMatch(/\/\s*\S/);
    check('扫描变量使用32px控件并关联完整可见说明', Math.abs(variableControl.height - 32) <= 1 && variableControl.inView, variableControl);
    check('已保存扫描变量在方法栏以正文尺寸完整显示名称与单位', variableLayout.complete && variableLayout.inView && variableLayout.font >= 14, variableLayout);
    await scanVariable.focus();
    await page.keyboard.press('Space');
    const variableOptions = page.locator('.study-sweep-variable-options');
    const selectedVariable = variableOptions.getByRole('option', { selected: true });
    await expect(selectedVariable).toHaveText(variableLayout.text);
    await capture('10-saved-sweep-variable-keyboard-options');
    await page.keyboard.press('Escape');
    await expect(variableOptions).toBeHidden();
    await expect(scanVariable).toBeFocused();
    await expect(variableName).toHaveText(variableLayout.text);
    await capture('10-saved-sweep-variable-name-and-unit');
    await inspectorTabs.getByRole('tab', { name: '输入', exact: true }).click();
    check('属性分页往返保留已加载曲线实例与结果量', await mountedChart.evaluate(node => node.isConnected)
      && await page.locator('.study-sweep-results .series-chart').getByRole('img').getAttribute('aria-label') === chartLabel,
    { chartLabel });
    await mountedChart.dispose();

    await page.getByRole('button', { name: '还原结果面板', exact: true }).click();
    await expect(canvas).toBeVisible();
    const layingView = canvas.getByRole('button', { name: '敷设截面', exact: true });
    await expect(layingView).toBeVisible();
    if (size.width === 1920) { await layingView.focus(); await page.keyboard.press('Enter'); }
    else await layingView.click();
    await expect(layingView).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/view=section/);
    await expect(canvas.locator('[data-drawing-canvas="laying"]')).toBeVisible();
    await capture('10-sweep-select-laying-view');
    const cable = canvas.locator('[data-section-object^="cable/"]').first();
    await expect(cable).toBeVisible();
    const identity = await cable.getAttribute('data-section-object');
    const placement = baseline.workspace.domain.sections.flatMap(section => section.placements)
      .find(item => 'cable/' + item.cable === identity);
    expect(placement, '图中电缆必须来自保存工程的真实敷设').toBeTruthy();
    await cable.click();
    const xField = field('水平位置 x'), zField = field('高程 z');
    await expect(xField).toBeEditable();
    await expect(zField).toBeEditable();
    const coordinates = async () => ({ x: Number(await xField.inputValue()), z: Number(await zField.inputValue()) });
    const original = await coordinates();
    expect(original.x).toBeCloseTo(placement.x, 3);
    expect(original.z).toBeCloseTo(placement.z, 3);
    const edited = { ...original, x: Number((original.x + 0.025).toFixed(3)) };
    await fill('水平位置 x', String(edited.x));
    await expect.poll(coordinates).toEqual(edited);
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await capture('10-sweep-canvas-coordinate-edit-is-unsaved');

    const mountedDrawing = await canvas.locator('[data-drawing-canvas="laying"]').elementHandle();
    expect(mountedDrawing).toBeTruthy();
    await inspectorTabs.getByRole('tab', { name: '方法', exact: true }).click();
    await expect(page).toHaveURL(/inspector=method/);
    await expect(page.getByRole('combobox', { name: '扫描变量', exact: true })).toBeVisible();
    await inspectorTabs.getByRole('tab', { name: '输入', exact: true }).click();
    await expect.poll(coordinates).toEqual(edited);
    await expect(cable).toHaveAttribute('aria-pressed', 'true');
    check('路由属性分页往返保留画布实例和未保存坐标', await mountedDrawing.evaluate(node => node.isConnected), { identity, edited });
    await mountedDrawing.dispose();
    await capture('10-sweep-route-change-keeps-canvas-and-draft');

    const point = await cable.locator('.drawing-hit-area').boundingBox();
    expect(point).toBeTruthy();
    const x = point.x + point.width / 2, y = point.y + point.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 20, y - 12, { steps: 8 }); await page.mouse.up();
    await expect.poll(coordinates).not.toEqual(edited);
    const dragged = await coordinates();
    await expect(cable).toHaveAttribute('aria-pressed', 'true');
    await capture('10-sweep-canvas-drag-is-unsaved');

    await page.getByRole('button', { name: '放大结果面板', exact: true }).click();
    await expect(workbench).toHaveAttribute('data-dock', 'max');
    await expect(canvas).toHaveCount(1);
    await expect(canvas).not.toBeVisible();
    await expect.poll(coordinates).toEqual(dragged);
    await capture('10-sweep-maximized-with-unsaved-coordinates');
    await page.getByRole('button', { name: '还原结果面板', exact: true }).click();
    await expect(canvas.locator('[data-drawing-canvas="laying"]')).toBeVisible();
    await expect(cable).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(coordinates).toEqual(dragged);
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    check('扫描画布放大再还原后保留所选电缆、手填与拖动后的未保存坐标', true,
      { ...source, cable: identity, original, edited, dragged });
    check('扫描画布切换与未保存编辑不改工程、研究或保存运行', isDeepStrictEqual(await savedInputs(), baseline), source);
    await capture('10-sweep-restored-with-selection-and-draft');

    await clickCommand('撤销');
    await expect.poll(coordinates).toEqual(edited);
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await capture('10-sweep-undo-drag-keeps-coordinate-edit');
    await clickCommand('撤销');
    await expect.poll(coordinates).toEqual(original);
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    await expect(cable).toHaveAttribute('aria-pressed', 'true');
    check('扫描画布可逐次撤销拖动和坐标编辑，恢复保存输入且保留选择', true,
      { cable: identity, original, edited, dragged, restored: await coordinates() });
    check('画布恢复回归全过程不写保存库，也不启动试算或新运行',
      isDeepStrictEqual(await savedInputs(), baseline) && report.writes.length === writesStart,
      { ...source, writes: report.writes.slice(writesStart) });
  });
  if (report.phase === 'after') await step('11-section-inputs-and-model-navigation', async () => {
    const projects = await api('/api/workspaces');
    const studies = (await Promise.all(projects.map(project => api(`/api/workspaces/${project.id}/studies`)))).flat();
    const selection = studies.find(row => row.definition.driver?.kind === 'selection'
      && row.definition.input_source === 'domain' && row.latest_run?.status === 'succeeded');
    expect(selection, '发布库必须有真实保存的选型研究；不为导航回归制造运行').toBeTruthy();
    const sourcePrefix = `/api/workspaces/${selection.workspace}/studies/${selection.id}`;
    async function readSource() {
      const [workspace, study, runs, run] = await Promise.all([
        api(`/api/workspaces/${selection.workspace}`), api(sourcePrefix),
        api(sourcePrefix + '/runs?view=summary&limit=100'), api(sourcePrefix + '/runs/' + selection.latest_run.id + '?view=full'),
      ]);
      return { workspace: { id: workspace.id, revision: workspace.revision, domain: workspace.domain },
        study: { id: study.id, revision: study.revision, definition: study.definition },
        runs: runs.items.map(item => ({ id: item.id, sequence: item.sequence, status: item.status })),
        run: { id: run.id, workspace: run.workspace, study: run.study, sequence: run.sequence, status: run.status, integrity: run.integrity,
          input_digest: run.input_digest, output_digest: run.output_digest, snapshot: run.snapshot, output: run.output } };
    }
    const before = await readSource(), writesStart = report.writes.length;
    expect(before.run.integrity).toBe('verified');
    expect(before.run.workspace).toBe(selection.workspace);
    expect(before.run.study).toBe(selection.id);
    expect(before.run.snapshot.definition.driver.kind).toBe('selection');
    const savedDocument = before.run.snapshot.definition.input_source === 'study'
      ? before.run.snapshot.definition.method_input : before.run.snapshot.workspace_state.domain;
    expect(savedDocument.schema_version).toBe('cablesim.domain/1');
    const source = { workspace: selection.workspace, study: selection.id, run: before.run.id,
      workspaceRevision: before.workspace.revision, studyRevision: before.study.revision,
      inputDigest: before.run.input_digest, outputDigest: before.run.output_digest };
    const target = (module, tab, fixed = false) => `${base}/studies/${selection.id}/${module}/${tab}?`
      + new URLSearchParams({ workspace: selection.workspace, theme: 'light', inspector: 'input', ...(fixed ? { run: before.run.id } : {}) });
    const workbench = page.locator('.study-workbench');
    const canvas = workbench.locator('.workbench-canvas');
    const candidateEvidence = [];
    async function savedSelectionReady(label) {
      const table = page.getByRole('table', { name: '真实选型候选', exact: true });
      await expect(table).toBeVisible();
      const assessments = before.run.output.assessment;
      expect(Array.isArray(assessments) && assessments.length > 0, '候选来自所选保存运行的实际判定').toBe(true);
      const collapsed = table.locator('button[aria-expanded="false"]');
      while (await collapsed.count()) await collapsed.first().click();
      await expect(table.locator('tbody tr.data-row')).toHaveCount(assessments.length);
      const rows = [];
      for (const assessment of assessments) {
        const index = /^case-(\d+)$/.exec(assessment.case_id);
        expect(index, '候选工况必须指向真实保存快照').toBeTruthy();
        const payload = before.run.snapshot.candidate_snapshots[Number(index[1])]?.payload;
        expect(payload).toBeTruthy();
        const name = payload.name || payload.cable_type?.label;
        const row = table.locator('[id="row-真实选型候选-' + assessment.case_id + '"]');
        await expect(row).toHaveAttribute('aria-label', '选择 ' + name);
        const cells = await row.locator('td').allTextContents();
        expect(cells).toHaveLength(6);
        expect(cells[0].trim()).toBe(name);
        for (const [column, actual, precision] of [
          [1, (payload.cable_type?.cores?.[0]?.conductor?.nominal_area ?? payload.specification?.area_m2) * 1e6, 0],
          [2, assessment.value, 1], [3, assessment.margin, 1],
        ]) {
          const text = cells[column].split('（')[0].replace(/\s/g, '').replace(/−/g, '-');
          if (typeof actual !== 'number' || !Number.isFinite(actual)) expect(text).toBe('—');
          else expect(Number(text)).toBe(Number(actual.toFixed(precision)));
        }
        if (assessment.unit !== undefined) expect(assessment.unit).toBe('A');
        const verdict = { satisfied: '满足', not_satisfied: '不满足', not_applicable: '不适用', failed: '失败' }[assessment.status];
        expect(verdict, '未知候选判定不得作为就绪结果').toBeTruthy();
        expect(cells[4].trim()).toBe(verdict);
        rows.push({ caseId: assessment.case_id, name, current: assessment.value, margin: assessment.margin, status: assessment.status, cells });
      }
      const conditionLinks = page.locator('[aria-label="本次计算工况"] a');
      await expect(conditionLinks.first()).toBeVisible();
      const links = await conditionLinks.evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, href: node.href })));
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const location = new URL(link.href);
        expect(location.pathname.startsWith(`/studies/${selection.id}/`)).toBe(true);
        expect(location.searchParams.get('workspace')).toBe(selection.workspace);
        expect(location.searchParams.get('run')).toBe(before.run.id);
        expect(location.searchParams.get('theme')).toBe('light');
      }
      const state = await waitForPageReady(page, { includeCanvas: false });
      expect(state.errors, '加载结束还必须没有结果错误').toEqual([]);
      candidateEvidence.push({ label, url: page.url(), ...source, rows, links });
    }

    await page.goto(target('selection', 'results'));
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    await expect(workbench).toHaveAttribute('data-analysis', 'selection');
    await expect(canvas).toHaveCount(0);
    await savedSelectionReady('selection-entry');
    await capture('11-selection-default-canvas-collapsed');
    for (const keyboard of [false, true]) {
      const modelLink = page.locator('.project-explorer a.explorer-item[href*="view=section"]').first();
      await expect(modelLink).toBeVisible();
      const destination = new URL(await modelLink.getAttribute('href'), base);
      expect(destination.pathname).toBe(`/studies/${selection.id}/selection/results`);
      expect(destination.searchParams.get('workspace')).toBe(selection.workspace);
      if (keyboard) { await modelLink.focus(); await page.keyboard.press('Enter'); }
      else await modelLink.click();
      await page.waitForURL(next => next.pathname === destination.pathname && next.searchParams.get('view') === 'section');
      await expect(canvas.locator('[data-drawing-canvas="laying"]')).toBeVisible();
      await expect(workbench).not.toHaveAttribute('data-dock', 'max');
      await expect(page.getByRole('group', { name: '模型视图', exact: true }).getByRole('button', { name: '敷设截面', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await savedSelectionReady(keyboard ? 'model-keyboard' : 'model-mouse');
      await capture(keyboard ? '11-model-link-keyboard-reopens-canvas' : '11-model-link-mouse-opens-canvas');
      await clickCommand('收起布置图');
      await page.waitForURL(next => !next.searchParams.get('view'));
      await expect(canvas).toHaveCount(0);
    }
    check('选型默认收图，真实模型链接经鼠标和Enter可再次展开', true, source);

    function sourceValue(document, pointer) {
      return pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((owner, part) => {
        expect(owner !== null && typeof owner === 'object', `来源路径 ${pointer} 的父对象必须存在`).toBe(true);
        return Array.isArray(owner) ? owner.find(item => item.id === part || item.cable === part) : owner[part];
      }, document);
    }
    const caseInputs = new Map();
    async function readCandidateInput(caseId) {
      if (!caseInputs.has(caseId)) {
        const value = await api('/api/workspaces/' + selection.workspace + '/studies/' + selection.id
          + '/runs/' + before.run.id + '/cases/' + encodeURIComponent(caseId) + '/input');
        expect(value.integrity).toBe('verified');
        expect(value.run_id).toBe(before.run.id);
        expect(value.case_id).toBe(caseId);
        expect(value.run_input_digest).toBe(before.run.input_digest);
        expect(value.input_digest).toMatch(/^[a-f0-9]{64}$/);
        const savedCase = before.run.snapshot.cases.find(item => item.case_id === caseId);
        expect(savedCase, '所选工况必须存在于同次完整输入快照').toBeTruthy();
        expect(value.input).toEqual(savedCase.input);
        caseInputs.set(caseId, value);
      }
      return caseInputs.get(caseId);
    }
    async function observeCandidateField(caseId) {
      const result = before.run.output.cases.find(item => item.case_id === caseId);
      expect(result, '场图必须来自当前选择的真实保存工况').toBeTruthy();
      const digest = result.artifact_digests['x-cablesim.temperature-field'];
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
      const slot = canvas.locator('.study-field-slot');
      await expect(slot).toBeVisible();
      await expect(slot).toHaveAttribute('data-run-id', before.run.id);
      await expect(slot).toHaveAttribute('data-case-id', caseId);
      await expect(slot).toHaveAttribute('data-field-digest', digest);
      await expect(slot.locator('canvas.field-canvas')).toHaveAttribute('data-audit-first-draw', /.+/, { timeout: 60000 });
      const ready = await waitForPageReady(page, { timeout: 60000 });
      expect(ready.errors).toEqual([]);
      return { runId: before.run.id, caseId, fieldDigest: digest, text: await slot.innerText(), ready };
    }
    const tableEvidence = [];
    for (const fixed of [false, true]) {
      for (const [tab, label] of [['coordinates', '敷设坐标与尺寸'], ['media', '介质参数']]) {
        await page.goto(target('section', tab, fixed));
        await page.waitForURL(next => next.pathname === `/studies/${selection.id}/section/${tab}`
          && next.searchParams.get('workspace') === selection.workspace && (next.searchParams.get('run') || '') === (fixed ? before.run.id : ''));
        const table = page.getByRole('table', { name: label, exact: true });
        await expect(table).toBeVisible();
        // A visible async table can still be rendering its empty/loading row.
        // Wait for one real bound input before checking all saved values.
        let fields = [];
        // A successful visibility assertion may race the table's query-driven
        // remount. Retain the whole actual input snapshot from one DOM read;
        // retry only while no real controls exist (never fabricate values).
        await expect.poll(async () => {
          fields = await table.locator('.number-field').evaluateAll(nodes => nodes.map(node => {
            const input = node.querySelector('input');
            return { path: node.dataset.fieldPath, value: input?.value, full: input?.title, readOnly: input?.readOnly };
          }));
          return fields.filter(field => field.path && field.value !== undefined).length;
        }, { timeout: 60000, message: '等待保存敷设输入表真实数值控件稳定挂载' }).toBeGreaterThan(0);
        let fixedCaseEvidence;
        if (fixed) {
          const wrapper = page.locator('.study-saved-candidate-input');
          const caseId = await wrapper.getAttribute('data-case-id');
          expect(caseId, '固定敷设输入必须明确来自哪一个候选').toBeTruthy();
          const input = await readCandidateInput(caseId);
          await expect(wrapper).toHaveAttribute('data-run-id', before.run.id);
          await expect(wrapper).toHaveAttribute('data-input-digest', input.input_digest);
          fixedCaseEvidence = { caseId, inputDigest: input.input_digest, field: await observeCandidateField(caseId) };
        }
        const document = fixed ? caseInputs.get(fixedCaseEvidence.caseId).input : before.workspace.domain;
        if (tab === 'media') {
          const legacySoil = document.materials.filter(material => material.label === 'v0 soil' && material.category === 'soil');
          expect(legacySoil.length, '从本次保存输入核对实际旧土壤显示，不制造迁移材料').toBeGreaterThan(0);
          for (const material of legacySoil) {
            const row = table.locator('[id="row-' + label + '-' + material.id + '"]');
            await expect(row.getByRole('cell').first()).toHaveText('旧版土壤材料');
            await expect(row.getByRole('cell').last()).toHaveText('旧版土壤材料');
          }
          await expect(table).not.toContainText('v0 soil');
          check('介质对象与材料引用一致显示中文，原保存名称留在来源中', true,
            { fixed, materials: legacySoil.map(material => ({ id: material.id, originalLabel: material.label })) });
        }
        for (const field of fields) {
          const raw = sourceValue(document, field.path);
          expect(raw == null || typeof raw === 'number', `表格字段 ${field.path} 必须来自所选实际输入`).toBe(true);
          if (raw == null) { expect(field.value).toBe(''); expect(field.full).toBe('未提供'); }
          else {
            const expectedValue = /\/(inner_diameter|outer_diameter)$/.test(field.path) ? raw * 1000 : raw;
            expect(Number(field.full.match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)?.[0])).toBe(expectedValue);
            expect(Number.isFinite(Number(field.value))).toBe(true);
          }
          if (fixed) expect(field.readOnly).toBe(true);
        }
        if (fixed) await expect(page.getByText('固定运行敷设输入 · 只读', { exact: true })).toBeVisible();
        const returnToResult = command().getByRole('button', { name: '返回问询选型', exact: true });
        // The return action is navigation only, even on an immutable saved run.
        await expect(returnToResult).toHaveClass(/button-primary/);
        await expect(returnToResult).toBeEnabled();
        await expect(page.locator('.button-primary:visible,.button-run:visible')).toHaveCount(1);
        await capture(`11-${fixed ? 'saved' : 'current'}-section-${tab}`);
        tableEvidence.push({ tab, fixed, fields, fixedCaseEvidence });
        if (tab === 'coordinates') { await returnToResult.focus(); await page.keyboard.press('Enter'); }
        else await returnToResult.click();
        await page.waitForURL(next => next.pathname === `/studies/${selection.id}/selection/results`
          && next.searchParams.get('workspace') === selection.workspace && next.searchParams.get('theme') === 'light'
          && (next.searchParams.get('run') || '') === (fixed ? before.run.id : ''));
        await savedSelectionReady(`${fixed ? 'saved' : 'current'}-${tab}-return`);
      }
    }
    let savedCad;
    for (const [tab, view, drawing] of [['section', 'section', 'laying-section'], ['three-dimensional', 'three', 'laying-cad']]) {
      await page.goto(target('section', tab, true));
      await page.waitForURL(next => next.pathname === `/studies/${selection.id}/selection/results`
        && next.searchParams.get('view') === view && next.searchParams.get('run') === before.run.id
        && next.searchParams.get('workspace') === selection.workspace && next.searchParams.get('theme') === 'light');
      const modelSize = canvas.locator('.study-model-size');
      if (view === 'three') {
        // Opening 3D gives the model the available height. Restore the actual
        // results through the UI before checking the same saved candidate table.
        await expect(workbench).toHaveAttribute('data-canvas', 'max');
        await expect(modelSize).toHaveText('还原模型布局');
        await expect(modelSize).toHaveAttribute('aria-pressed', 'true');
        await modelSize.click();
        await expect(workbench).not.toHaveAttribute('data-canvas', 'max');
        await expect(modelSize).toBeFocused();
      }
      // The template canvas may mount before the run and then be replaced by
      // its hydrated saved candidate. Wait for that actual result first.
      await savedSelectionReady('saved-alias-' + view);
      await expect(canvas.locator(`[data-drawing-mount="${drawing}"]`)).toBeVisible();
      await expect(workbench).not.toHaveAttribute('data-dock', 'max');
      if (view === 'three') {
        const cad = canvas.locator('.cad-viewport'), thermal = cad.locator('.cad-thermal-overlay');
        await expect(cad).toHaveAttribute('data-cad-ready', 'true', { timeout: 60000 });
        await expect(cad).toHaveAttribute('aria-busy', 'false');
        await expect(cad).toHaveAttribute('data-cad-result-state', /^(success|historical)$/);
        await expect(thermal).toHaveAttribute('data-run-id', before.run.id);
        const caseId = await thermal.getAttribute('data-case-id');
        expect(before.run.output.assessment.some(item => item.case_id === caseId)).toBe(true);
        expect(before.run.output.cases.some(item => item.case_id === caseId)).toBe(true);
        const slice = cad.locator('.cad-temperature-host');
        if (await slice.count()) {
          await expect(slice.locator('canvas')).toHaveAttribute('data-cad-field-ready', 'true', { timeout: 60000 });
        }
        await expect(cad.locator('.cad-result-status')).toContainText(/保存运行|历史运行/);
        await expect(cad.locator('.cad-result-status')).toHaveAttribute('title', new RegExp(`运行 ${before.run.sequence} .*工况 ${caseId}$`));
        const renderer = cad.locator('.cad-canvas-host canvas');
        await expect(renderer).toHaveAttribute('data-webgl-renderer', /.+/);
        await expect.poll(async () => Number(await renderer.getAttribute('data-webgl-colors'))).toBeGreaterThan(8);
        const viewport = await cad.elementHandle(), rendererNode = await renderer.elementHandle(), location = page.url();
        const modelLayouts = [];
        async function observeModelLayout(expanded, label) {
          if (expanded) {
            await expect(workbench).toHaveAttribute('data-canvas', 'max');
            await expect(workbench.locator('.workbench-dock')).toBeHidden();
            await expect(modelSize).toHaveText('还原模型布局');
            await expect.poll(() => renderer.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(240);
          } else {
            await expect(workbench).not.toHaveAttribute('data-canvas', 'max');
            await expect(page.getByRole('table', { name: '真实选型候选', exact: true })).toBeVisible();
            await expect(modelSize).toHaveText('放大模型');
          }
          await expect(modelSize).toHaveAttribute('aria-pressed', String(expanded));
          await expect(cad).toHaveAttribute('aria-busy', 'false');
          // Preserve the real renderer and its saved case. data-webgl-size is
          // only the first-frame diagnostic; the final PNG below exercises a
          // fresh renderer capture at the expanded dimensions.
          expect(await viewport.evaluate(node => node.isConnected && node === document.querySelector('.workbench-canvas .cad-viewport'))).toBe(true);
          expect(await rendererNode.evaluate(node => node.isConnected && node === document.querySelector('.workbench-canvas .cad-canvas-host canvas'))).toBe(true);
          expect(page.url()).toBe(location);
          await expect(thermal).toHaveAttribute('data-run-id', before.run.id);
          await expect(thermal).toHaveAttribute('data-case-id', caseId);
          const geometry = await cad.evaluate(node => {
            const stage = node.querySelector('.cad-stage'), rect = stage.getBoundingClientRect(), boundary = node.getBoundingClientRect();
            const controls = [...node.querySelectorAll('.cad-tools button,.cad-tools [role="combobox"]')].map(control => {
              const box = control.getBoundingClientRect();
              return { label: control.getAttribute('aria-label') || control.textContent.trim(), fontSize: parseFloat(getComputedStyle(control).fontSize),
                visible: control.checkVisibility(), inside: box.left >= boundary.left - 1 && box.right <= boundary.right + 1
                  && box.top >= boundary.top - 1 && box.bottom <= boundary.bottom + 1 && box.bottom <= innerHeight };
            });
            return { stage: { width: rect.width, height: rect.height }, controls };
          });
          if (expanded) {
            expect(geometry.stage.width).toBeGreaterThanOrEqual(320);
            expect(geometry.controls.length).toBeGreaterThan(0);
            expect(geometry.controls.every(control => control.visible && control.inside && control.fontSize >= 13)).toBe(true);
          }
          modelLayouts.push({ label, expanded, ...geometry });
          await capture(label);
        }
        await observeModelLayout(false, '11-saved-three-mouse-restores-results');
        await modelSize.focus();
        await page.keyboard.press('Enter');
        await observeModelLayout(true, '11-saved-three-keyboard-expands-model');
        await expect(modelSize).toBeFocused();
        await page.keyboard.press('Enter');
        await observeModelLayout(false, '11-saved-three-keyboard-restores-results');
        await expect(modelSize).toBeFocused();
        await modelSize.click();
        await observeModelLayout(true, '11-saved-three-mouse-expands-model');
        await cad.getByRole('button', { name: '全景', exact: true }).click();
        await expect(cad).toHaveAttribute('data-cad-mode', 'scene');
        const fit = cad.getByRole('button', { name: '适应窗口 F', exact: true });
        await fit.focus();
        await page.keyboard.press('Enter');
        await expect(cad).toHaveAttribute('aria-busy', 'false');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(page.url()).toBe(location);
        expect(await viewport.evaluate(node => node.isConnected && node === document.querySelector('.workbench-canvas .cad-viewport')
          && node.dataset.cadReady === 'true' && node.getAttribute('aria-busy') === 'false')).toBe(true);
        await expect(cad.locator('.cad-state-overlay,.cad-error-bar,.cad-slice-error')).toHaveCount(0);
        const imageDownload = page.waitForEvent('download');
        await cad.getByRole('button', { name: '导出 PNG', exact: true }).click();
        const png = await imageDownload, imagePath = path.join(out, 'selection-saved-three-' + tag + '.png');
        await png.saveAs(imagePath);
        const bytes = await fs.readFile(imagePath);
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const imageSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
        expect(imageSize.width).toBeGreaterThanOrEqual(640);
        expect(imageSize.height).toBeGreaterThanOrEqual(480);
        await expect(cad.locator('.cad-slice-error')).toHaveCount(0);
        await expect(thermal).toHaveAttribute('data-run-id', before.run.id);
        await expect(thermal).toHaveAttribute('data-case-id', caseId);
        savedCad = { ...source, caseId, url: page.url(), modelLayouts, image: path.basename(imagePath), imageSize, bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          viewport: await cad.evaluate(node => ({ state: node.dataset.cadState, resultState: node.dataset.cadResultState,
            ready: node.dataset.cadReady, firstDisplayMs: Number(node.dataset.cadFirstDisplayMs), busy: node.getAttribute('aria-busy') })),
          renderer: await renderer.evaluate(node => ({ renderer: node.dataset.webglRenderer, colors: Number(node.dataset.webglColors), size: node.dataset.webglSize })),
          status: await cad.locator('.cad-result-status').getAttribute('title') };
        // The product's existing export rejects dirty/provisional images and a
        // field runId different from the selected saved run; do not bypass it.
        check('固定三维已绘制所选保存运行工况，真实导出保留运行绑定', true, savedCad);
        check('三维默认放大，键鼠可还原和放大同一模型，实际绘图区与查看工具完整可用', true, { ...source, caseId, modelLayouts, imageSize });
      } else await expect(canvas.locator('[data-drawing-canvas="laying"]')).toBeVisible();
      await expect(page.getByRole('group', { name: '模型视图', exact: true })
        .getByRole('button', { name: view === 'three' ? '三维' : '敷设截面', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await capture(`11-saved-section-alias-${view}`);
    }

    // Reuse the selected, verified archive and its real IEC field. Layout
    // changes must not create a run, change its case, or remount the renderer.
    const fieldWritesStart = report.writes.length;
    await canvas.getByRole('button', { name: '土壤温度场', exact: true }).click();
    await page.waitForURL(next => next.searchParams.get('view') === 'field'
      && next.searchParams.get('run') === before.run.id && next.searchParams.get('workspace') === selection.workspace);
    const fieldSlot = canvas.locator('.study-field-slot'), soilField = fieldSlot.locator('.field-view');
    const fieldRenderer = soilField.locator('canvas.field-canvas'), basis = fieldSlot.locator('.field-basis');
    const modelSize = canvas.locator('.study-model-size');
    await expect(fieldSlot).toHaveAttribute('data-run-id', before.run.id);
    await expect(fieldSlot).toHaveAttribute('data-case-id', /.+/);
    const caseId = await fieldSlot.getAttribute('data-case-id');
    const savedCase = before.run.output.cases.find(item => item.case_id === caseId);
    expect(savedCase, '场图工况必须来自此保存运行').toBeTruthy();
    expect(before.run.output.assessment.some(item => item.case_id === caseId)).toBe(true);
    const savedField = savedCase.artifacts['x-cablesim.temperature-field'];
    expect(savedField.source.binding).toBe('iec-trace');
    expect(savedField.source.trace_sha256).toBe(savedCase.artifact_digests['x-cablesim.iec60287-trace']);
    expect(savedCase.artifact_digests['x-cablesim.temperature-field']).toMatch(/^[a-f0-9]{64}$/);
    const trace = Object.values(savedCase.artifacts).find(artifact => Array.isArray(artifact?.operating?.cable_states));
    const currents = [...new Set((trace?.operating.cable_states || []).map(state => state.current_a).filter(value => typeof value === 'number' && Number.isFinite(value)))];
    const loadLabel = currents.length === 1 ? `保存负荷 ${Number(currents[0].toFixed(1))} A`
      : currents.length ? `保存负荷 ${currents.map(value => Number(value.toFixed(1)) + ' A').join(' / ')}` : '保存负荷（详见本次运行输入）';
    const expectedBasis = `${loadLabel} · 额定温升需按允许电流另行运行`;
    const expectedTitle = `${loadLabel}的保存温度场；允许电流是温限下的能力。查看额定温升，请按允许电流另行运行。${savedField.analytical_soil_view.limitations.join('；')}`;
    const fixedTemperature = value => Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
    await expect(soilField).toHaveAttribute('aria-label', `土壤温度场（IEC 解析） · ${loadLabel}`);
    await expect(basis).toHaveText(expectedBasis);
    await expect(basis).toHaveAttribute('title', expectedTitle);
    await expect(soilField.locator('[data-field-label="hotspot"] text')).toHaveText(`土壤最高 ${fixedTemperature(savedField.hotspot.temperature_k - 273.15)} °C`);
    const fieldNode = await soilField.elementHandle(), rendererNode = await fieldRenderer.elementHandle(), fieldUrl = page.url();
    const fieldLayouts = [];
    async function observeFieldLayout(expanded, label) {
      if (expanded) {
        await expect(workbench).toHaveAttribute('data-canvas', 'max');
        await expect(workbench.locator('.workbench-dock')).toBeHidden();
      } else {
        await expect(workbench).not.toHaveAttribute('data-canvas', 'max');
        await expect(page.getByRole('table', { name: '真实选型候选', exact: true })).toBeVisible();
      }
      await expect(modelSize).toHaveText(expanded ? '还原模型布局' : '放大模型');
      await expect(modelSize).toHaveAttribute('aria-pressed', String(expanded));
      await expect(fieldSlot).toHaveAttribute('data-run-id', before.run.id);
      await expect(fieldSlot).toHaveAttribute('data-case-id', caseId);
      expect(page.url()).toBe(fieldUrl);
      const ready = await waitForPageReady(page, { timeout: 60000 });
      expect(ready.errors).toEqual([]);
      await expect(fieldRenderer).toHaveAttribute('data-audit-first-draw', /.+/);
      // The first draw alone does not prove that a resize has painted. Wait for
      // the existing WebGL buffer and SVG viewport to match the actual layout.
      await expect.poll(() => soilField.evaluate(node => {
        const canvas = node.querySelector('canvas'), svg = node.querySelector('svg');
        if (!canvas || !svg) return false;
        const plot = canvas.getBoundingClientRect(), box = node.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
        return plot.width > 0 && plot.height > 0 && Math.abs(canvas.width - plot.width * ratio) <= 2
          && Math.abs(canvas.height - plot.height * ratio) <= 2 && Math.abs(Number(svg.getAttribute('width')) - box.width) <= 1
          && Math.abs(Number(svg.getAttribute('height')) - box.height) <= 1;
      })).toBe(true);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await fieldNode.evaluate(node => node.isConnected && node === document.querySelector('.study-field-slot .field-view'))).toBe(true);
      expect(await rendererNode.evaluate(node => node.isConnected && node === document.querySelector('.study-field-slot canvas.field-canvas'))).toBe(true);
      const geometry = await canvas.evaluate(node => {
        const rect = box => ({ left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height });
        const bounds = element => rect(element.getBoundingClientRect());
        const unclipped = element => {
          const box = bounds(element);
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), clip = bounds(parent);
            if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { box.left = Math.max(box.left, clip.left); box.right = Math.min(box.right, clip.right); }
            if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { box.top = Math.max(box.top, clip.top); box.bottom = Math.min(box.bottom, clip.bottom); }
          }
          return box;
        };
        const field = node.querySelector('.field-view'), basis = node.querySelector('.field-basis'), range = document.createRange();
        range.selectNodeContents(basis);
        const style = getComputedStyle(basis);
        const dock = node.parentElement.querySelector('.workbench-dock');
        return { model: bounds(node), modelVisible: unclipped(node), viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
          field: bounds(field), plot: bounds(field.querySelector('canvas')), toolbar: bounds(node.querySelector('.study-canvas-toolbar')),
          legend: bounds(field.querySelector('.field-colorbar')), orientation: field.dataset.colorbarPosition,
          dock: { visible: dock.checkVisibility(), rect: bounds(dock), clip: unclipped(dock), toolbar: bounds(dock.querySelector('.workbench-dock-bar')),
            controls: [...dock.querySelectorAll('.workbench-dock-bar button')].map(button => ({ text: button.textContent, rect: bounds(button), visible: button.checkVisibility() })) },
          ticks: [...field.querySelectorAll('.field-colorbar text')].map(text => ({ text: text.textContent, rect: bounds(text), fontSize: parseFloat(getComputedStyle(text).fontSize) })),
          basis: { rect: bounds(basis), text: basis.textContent, title: basis.title, textRects: [...range.getClientRects()].map(rect),
            fontSize: parseFloat(style.fontSize), textOverflow: style.textOverflow, visible: basis.checkVisibility(),
            clientWidth: basis.clientWidth, scrollWidth: basis.scrollWidth, clientHeight: basis.clientHeight, scrollHeight: basis.scrollHeight } };
      });
      const inside = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      expect(geometry.basis.text).toBe(expectedBasis);
      expect(geometry.basis.title).toBe(expectedTitle);
      expect(geometry.basis.visible).toBe(true);
      expect(geometry.basis.fontSize).toBeGreaterThanOrEqual(14);
      expect(geometry.basis.textOverflow).not.toBe('ellipsis');
      expect(geometry.basis.scrollWidth).toBeLessThanOrEqual(geometry.basis.clientWidth + 1);
      expect(geometry.basis.scrollHeight).toBeLessThanOrEqual(geometry.basis.clientHeight + 1);
      expect(geometry.basis.textRects.length).toBeGreaterThan(0);
      expect(geometry.basis.textRects.every(box => inside(box, geometry.basis.rect))).toBe(true);
      expect(geometry.plot.height, 'IEC 绘图区必须留出超过上下各48px的拟合边距').toBeGreaterThan(96);
      for (const box of [geometry.field, geometry.basis.rect, geometry.legend, geometry.plot, geometry.toolbar]) {
        expect(inside(box, geometry.modelVisible) && inside(box, geometry.viewport)).toBe(true);
      }
      expect(inside(geometry.legend, geometry.field)).toBe(true);
      expect(overlaps(geometry.basis.rect, geometry.legend) || overlaps(geometry.basis.rect, geometry.plot)
        || overlaps(geometry.plot, geometry.legend) || overlaps(geometry.field, geometry.toolbar)).toBe(false);
      expect(geometry.ticks.length).toBeGreaterThanOrEqual(3);
      expect(geometry.ticks.every(tick => tick.fontSize >= 13 && inside(tick.rect, geometry.field) && !overlaps(tick.rect, geometry.basis.rect))).toBe(true);
      if (!expanded) {
        expect(geometry.dock.visible && inside(geometry.dock.toolbar, geometry.dock.clip) && inside(geometry.dock.toolbar, geometry.viewport)).toBe(true);
        expect(geometry.dock.rect.height).toBeGreaterThan(geometry.dock.toolbar.height);
        expect(geometry.dock.controls.length).toBeGreaterThan(0);
        expect(geometry.dock.controls.every(control => control.visible && inside(control.rect, geometry.dock.toolbar) && inside(control.rect, geometry.viewport))).toBe(true);
      }
      const shot = await capture(label);
      fieldLayouts.push({ label, expanded, screenshot: shot.screenshot, ...geometry });
    }
    await observeFieldLayout(false, '11-saved-soil-field-full-basis-and-colorbar');
    const splitter = workbench.getByRole('separator', { name: '拖动调整画布与结果区高度，双击复原', exact: true });
    const originalSplit = Number(await splitter.getAttribute('aria-valuenow'));
    expect(originalSplit >= 15 && originalSplit <= 85 && originalSplit % 5 === 0).toBe(true);
    await splitter.focus();
    await page.keyboard.press('Home');
    await expect(splitter).toHaveAttribute('aria-valuenow', '15');
    await expect(workbench).toHaveAttribute('data-split', '15');
    await observeFieldLayout(false, '11-saved-soil-field-minimum-split');
    const records = workbench.locator('.workbench-dock-bar').getByRole('button', { name: '运行记录', exact: true });
    await records.focus();
    await expect(records).toBeFocused();
    // Restore the user's original proportion through the existing keyboard UI.
    await splitter.focus();
    for (let share = 15; share < originalSplit; share += 5) await page.keyboard.press('ArrowDown');
    await expect(splitter).toHaveAttribute('aria-valuenow', String(originalSplit));
    await modelSize.click();
    await observeFieldLayout(true, '11-saved-soil-field-mouse-expands-model');
    await modelSize.focus();
    await page.keyboard.press('Enter');
    await observeFieldLayout(false, '11-saved-soil-field-keyboard-restores-model');
    await expect(modelSize).toBeFocused();
    expect(fieldLayouts[2].field.height).toBeGreaterThan(fieldLayouts[0].field.height);
    expect(Math.abs(fieldLayouts[3].field.height - fieldLayouts[0].field.height)).toBeLessThanOrEqual(1);
    const savedSoilField = { ...source, caseId, url: fieldUrl, fieldDigest: savedCase.artifact_digests['x-cablesim.temperature-field'],
      traceDigest: savedField.source.trace_sha256, layouts: fieldLayouts, writes: report.writes.slice(fieldWritesStart) };
    expect(savedSoilField.writes).toEqual([]);
    check('保存土壤温度场说明全文、色标刻度与绘图区完整可见且互不覆盖', true, savedSoilField);
    check('鼠标放大与Enter还原保留同一场图实例、保存运行和工况', true, savedSoilField);
    check('坐标和介质表分别读取当前输入与固定运行输入，固定输入只读且可键鼠返回', true, { ...source, tables: tableEvidence });
    check('旧截面与三维入口保留固定运行并打开正确模型视图', true, source);
    check('选型正文和工况链接均来自同一真实保存运行，不把读取外壳当结果', candidateEvidence.length === 9,
      { ...source, pages: candidateEvidence });
    const caseNavigation = [];
    const hasField = item => before.run.output.cases.some(row => row.case_id === item.case_id
      && row.artifacts?.['x-cablesim.temperature-field']);
    const selectedCases = [
      before.run.output.assessment.find(item => item.status === 'satisfied' && hasField(item)),
      before.run.output.assessment.find(item => item.status === 'not_satisfied' && hasField(item)),
    ];
    expect(selectedCases.every(Boolean), '实际运行须同时有满足与不满足候选，不能造数据代验').toBe(true);
    for (const [trial, assessment] of selectedCases.entries()) {
      const caseId = assessment.case_id, keyboard = trial === 1;
      const index = Number(/^case-(\d+)$/.exec(caseId)?.[1]);
      const payload = before.run.snapshot.candidate_snapshots[index].payload;
      const name = payload.name || payload.cable_type?.label;
      const input = await readCandidateInput(caseId);
      await page.goto(target('selection', 'results', true));
      const table = page.getByRole('table', { name: '真实选型候选', exact: true });
      const candidate = table.locator('[id="row-真实选型候选-' + caseId + '"]');
      await expect(candidate).toBeVisible();
      if (keyboard) { await candidate.focus(); await page.keyboard.press('Enter'); }
      else await candidate.click();
      await page.waitForURL(next => next.searchParams.get('case') === caseId && next.searchParams.get('run') === before.run.id);
      await expect(candidate).toHaveAttribute('aria-selected', 'true');
      await clickCommand('查看布置图');
      const initialField = await observeCandidateField(caseId);
      await capture('12-selected-' + caseId + '-field');
      const pages = [];
      for (const [tab, label] of [['coordinates', '敷设坐标与尺寸'], ['media', '介质参数']]) {
        const link = page.locator('[aria-label="本次计算工况"] a[href*="/section/' + tab + '"]').first();
        await expect(link).toBeVisible();
        const href = new URL(await link.getAttribute('href'), base);
        expect(href.searchParams.get('run')).toBe(before.run.id);
        expect(href.searchParams.get('case')).toBe(caseId);
        if (tab === 'coordinates') { await link.focus(); await page.keyboard.press('Enter'); }
        else await link.click();
        await page.waitForURL(next => next.pathname.endsWith('/section/' + tab)
          && next.searchParams.get('case') === caseId && next.searchParams.get('run') === before.run.id);
        const wrapper = page.locator('.study-saved-candidate-input');
        await expect(wrapper).toHaveAttribute('data-run-id', before.run.id);
        await expect(wrapper).toHaveAttribute('data-case-id', caseId);
        await expect(wrapper).toHaveAttribute('data-input-digest', input.input_digest);
        await expect(wrapper).toContainText('保存候选 · ' + name);
        const fields = await page.getByRole('table', { name: label, exact: true }).locator('.number-field').evaluateAll(nodes =>
          nodes.map(node => { const field = node.querySelector('input'); return {
            path: node.dataset.fieldPath, value: field?.value, full: field?.title, readOnly: field?.readOnly,
          }; }));
        expect(fields.length).toBeGreaterThan(0);
        for (const field of fields) {
          expect(field.readOnly).toBe(true);
          const raw = sourceValue(input.input, field.path);
          expect(raw == null || typeof raw === 'number').toBe(true);
          if (raw == null) { expect(field.value).toBe(''); expect(field.full).toBe('未提供'); }
          else {
            const expectedValue = /\/(inner_diameter|outer_diameter)$/.test(field.path) ? raw * 1000 : raw;
            expect(Number(field.full.match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)?.[0])).toBe(expectedValue);
          }
        }
        const fieldBefore = await observeCandidateField(caseId);
        await capture('12-selected-' + caseId + '-' + tab);
        // A copied saved URL or a cold reload must retain the same candidate.
        const location = page.url();
        await page.reload();
        await expect(wrapper).toHaveAttribute('data-case-id', caseId);
        await expect(wrapper).toHaveAttribute('data-input-digest', input.input_digest);
        expect(page.url()).toBe(location);
        const fieldAfter = await observeCandidateField(caseId);
        expect(fieldAfter.fieldDigest).toBe(initialField.fieldDigest);
        await capture('12-reloaded-' + caseId + '-' + tab);
        pages.push({ tab, href: href.href, url: location, name, fields, inputDigest: input.input_digest, fieldBefore, fieldAfter });
        const back = command().getByRole('button', { name: '返回问询选型', exact: true });
        if (tab === 'coordinates') { await back.focus(); await page.keyboard.press('Enter'); } else await back.click();
        await page.waitForURL(next => next.pathname.endsWith('/selection/results')
          && next.searchParams.get('case') === caseId && next.searchParams.get('run') === before.run.id);
        await expect(candidate).toHaveAttribute('aria-selected', 'true');
        await clickCommand('查看布置图');
        expect((await observeCandidateField(caseId)).fieldDigest).toBe(initialField.fieldDigest);
      }
      const modelLink = page.locator('.project-explorer a.explorer-item[href*="view=section"]').first();
      const modelHref = new URL(await modelLink.getAttribute('href'), base);
      expect(modelHref.searchParams.get('run')).toBe(before.run.id);
      expect(modelHref.searchParams.get('case')).toBe(caseId);
      if (keyboard) { await modelLink.focus(); await page.keyboard.press('Enter'); } else await modelLink.click();
      await page.waitForURL(next => next.searchParams.get('view') === 'section'
        && next.searchParams.get('run') === before.run.id && next.searchParams.get('case') === caseId);
      await expect(canvas.locator('[data-drawing-canvas="laying"]')).toBeVisible();
      await capture('12-selected-' + caseId + '-model-link');
      await canvas.getByRole('button', { name: '土壤温度场', exact: true }).click();
      expect((await observeCandidateField(caseId)).fieldDigest).toBe(initialField.fieldDigest);
      const cableLink = page.locator('.project-explorer a.explorer-item[href*="view=cable"]').first();
      await expect(cableLink).toBeVisible();
      const cableHref = new URL(await cableLink.getAttribute('href'), base);
      expect(cableHref.searchParams.get('run')).toBe(before.run.id);
      expect(cableHref.searchParams.get('case')).toBe(caseId);
      if (keyboard) { await cableLink.focus(); await page.keyboard.press('Enter'); } else await cableLink.click();
      await page.waitForURL(next => next.searchParams.get('view') === 'cable'
        && next.searchParams.get('run') === before.run.id && next.searchParams.get('case') === caseId);
      const cableFrame = canvas.locator('.cable-section[aria-label="电缆等比例截面"]');
      await expect(cableFrame.locator('[data-drawing-canvas="cable"]')).toBeVisible();
      await expect(cableFrame).toHaveAttribute('data-cable-section-state', /^(success|historical)$/);
      const savedCable = input.input.cable_types[0];
      expect(savedCable, '电缆截面来自同一候选实际保存输入').toBeTruthy();
      await expect(cableLink).toContainText(savedCable.label);
      const expectedLayers = [...savedCable.cores.flatMap(core =>
        [core.id + '/conductor', ...core.layers.map(layer => core.id + '/' + layer.role)]),
        ...savedCable.common_layers.map(layer => 'common/' + layer.role)].sort();
      const drawnLayers = cableFrame.locator('svg[data-drawing-canvas="cable"] path[data-layer-id]');
      await expect(drawnLayers).toHaveCount(expectedLayers.length);
      expect((await drawnLayers.evaluateAll(nodes => nodes.map(node => node.dataset.layerId))).sort()).toEqual(expectedLayers);
      const core = savedCable.cores[0];
      const conductorPath = cableFrame.locator('svg[data-drawing-canvas="cable"] path[data-layer-id="' + core.id + '/conductor"]');
      if (keyboard) { await conductorPath.focus(); await page.keyboard.press('Enter'); } else await conductorPath.click();
      await expect(conductorPath).toHaveAttribute('aria-pressed', 'true');
      const details = cableFrame.getByLabel('所选层尺寸与材料', { exact: true });
      const dimension = details.getByRole('button');
      const conductorMaterial = input.input.materials.find(material => material.id === core.conductor.material);
      expect(conductorMaterial).toBeTruthy();
      await expect(details).toContainText(conductorMaterial.label);
      await expect(dimension).toHaveText('直径 ' + (core.conductor.diameter * 1000).toFixed(1) + ' mm');
      await expect(dimension).toBeDisabled();
      const cableEvidence = { href: cableHref.href, cableId: savedCable.id, cableName: savedCable.label,
        expectedLayers, drawnLayers: await drawnLayers.evaluateAll(nodes => nodes.map(node => ({
          id: node.dataset.layerId, profile: node.dataset.profileKind, path: node.getAttribute('d'),
        }))), conductorDiameterM: core.conductor.diameter, conductorMaterial: conductorMaterial.label,
        conductorText: await details.innerText() };
      await capture('12-selected-' + caseId + '-actual-cable-structure');
      const insulation = core.layers.find(layer => layer.role === 'insulation');
      expect(insulation, '实际选型电缆应提供可核对的绝缘层').toBeTruthy();
      const insulationPath = cableFrame.locator('svg[data-drawing-canvas="cable"] path[data-layer-id="' + core.id + '/' + insulation.role + '"]');
      await insulationPath.focus(); await page.keyboard.press('Enter');
      await expect(insulationPath).toHaveAttribute('aria-pressed', 'true');
      const insulationMaterial = input.input.materials.find(material => material.id === insulation.material);
      expect(insulationMaterial).toBeTruthy();
      await expect(details).toContainText(insulationMaterial.label);
      await expect(dimension).toHaveText('厚度 ' + Number((insulation.thickness * 1000).toFixed(2)) + ' mm');
      await expect(dimension).toBeDisabled();
      cableEvidence.insulation = { thicknessM: insulation.thickness, material: insulationMaterial.label, text: await details.innerText() };
      await conductorPath.dblclick();
      await expect(page.locator('.drawing-editor-panel')).toHaveCount(0);
      await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
      await capture('12-selected-' + caseId + '-saved-cable-remains-readonly');
      let draftModel;
      if (trial === 0) {
        // Edit the real current input; the selected saved model must remain
        // immutable while this separate draft survives a view round trip.
        const draftInput = field('介质热阻率');
        await expect(draftInput).toBeEditable();
        const original = Number(await draftInput.inputValue());
        expect(Number.isFinite(original)).toBe(true);
        const edited = Number((original + 0.1).toFixed(3));
        await fill('介质热阻率', String(edited));
        await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
        await canvas.getByRole('button', { name: '三维', exact: true }).click();
        const cad = canvas.locator('.cad-viewport'), thermal = cad.locator('.cad-thermal-overlay');
        await expect(cad).toHaveAttribute('data-cad-ready', 'true', { timeout: 60000 });
        await expect(cad).toHaveAttribute('aria-busy', 'false');
        await expect(cad).toHaveAttribute('data-cad-result-state', 'success');
        await expect(thermal).toHaveAttribute('data-run-id', before.run.id);
        await expect(thermal).toHaveAttribute('data-case-id', caseId);
        await expect(cad.locator('.cad-canvas-host canvas')).toHaveAttribute('data-webgl-renderer', /.+/);
        await expect.poll(async () => Number(await cad.locator('.cad-canvas-host canvas').getAttribute('data-webgl-colors'))).toBeGreaterThan(8);
        if (await cad.locator('.cad-temperature-host').count())
          await expect(cad.locator('.cad-temperature-host canvas')).toHaveAttribute('data-cad-field-ready', 'true', { timeout: 60000 });
        await expect.poll(async () => Number(await draftInput.inputValue())).toBe(edited);
        await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
        await capture('12-selected-' + caseId + '-saved-three-with-current-draft');
        draftModel = { original, edited, caseId, runId: before.run.id, status: await cad.locator('.cad-result-status').innerText() };
        const returnCable = page.locator('.project-explorer a.explorer-item[href*="view=cable"]').first();
        await returnCable.focus(); await page.keyboard.press('Enter');
        await expect(cableFrame.locator('[data-drawing-canvas="cable"]')).toBeVisible();
        await conductorPath.focus(); await page.keyboard.press('Enter');
        await expect(dimension).toHaveText('直径 ' + (core.conductor.diameter * 1000).toFixed(1) + ' mm');
        await expect(dimension).toBeDisabled();
        await expect.poll(async () => Number(await draftInput.inputValue())).toBe(edited);
        await capture('12-selected-' + caseId + '-cable-preserves-current-draft');
        await clickCommand('撤销');
        await expect.poll(async () => Number(await draftInput.inputValue())).toBe(original);
        await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
      }
      caseNavigation.push({ ...source, caseId, name, keyboard, inputDigest: input.input_digest, initialField, pages,
        modelHref: modelHref.href, cable: cableEvidence, draftModel });
    }
    expect(caseNavigation.some(item => item.cable.conductorDiameterM !== before.workspace.domain.cable_types[0]?.cores[0]?.conductor.diameter),
      '实际候选至少有一个导体尺寸不同于当前工程，才能识别错误回退').toBe(true);
    check('候选电缆的实际SVG层、导体和绝缘尺寸与材料来自同工况，保存模型不可编辑', true,
      { ...source, cables: caseNavigation.map(item => ({ caseId: item.caseId, ...item.cable })) });
    check('当前输入草稿在保存候选三维和电缆视图往返中保留，可撤销且不替换保存模型', true,
      { ...source, draftModel: caseNavigation[0].draftModel });
    const invalid = new URL(target('section', 'coordinates', true));
    invalid.searchParams.set('case', 'not-a-saved-candidate');
    await page.goto(invalid.href);
    await expect(page.getByText('保存候选无法核对', { exact: true })).toBeVisible();
    await expect(canvas.locator('.study-field-slot')).toHaveCount(0);
    await expect(page.locator('.study-saved-candidate-input')).toHaveCount(0);
    await capture('12-invalid-candidate-never-shows-another-field');
    const recover = page.getByRole('button', { name: '返回候选结果', exact: true });
    await recover.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(next => next.pathname.endsWith('/selection/results')
      && !next.searchParams.get('case') && next.searchParams.get('run') === before.run.id);
    await expect(page.getByRole('table', { name: '真实选型候选', exact: true })).toBeVisible();
    check('真实候选经坐标、介质、冷重载、返回及模型链接始终保留同工况与保存摘要', caseNavigation.length === 2,
      { ...source, candidates: caseNavigation });
    check('不存在的保存候选明确报错，可用Enter返回且不会显示另一工况', true, { ...source, invalidUrl: invalid.href, recoveredUrl: page.url() });
    check('模型入口与坐标介质回归不写工程、研究、运行或启动计算', isDeepStrictEqual(await readSource(), before)
      && report.writes.length === writesStart, { ...source, writes: report.writes.slice(writesStart) });
    (report.sectionNavigation ||= []).push({ ...size, ...source, tables: tableEvidence, candidates: candidateEvidence, caseNavigation, savedCad, savedSoilField });
  });
});
