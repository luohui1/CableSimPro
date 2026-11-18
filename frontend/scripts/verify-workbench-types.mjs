import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { walkthrough } from './verify-workbench-support.mjs';

const fixedTypeRoutes = {
  structure: { module: 'structure', tab: 'quantities', page: 'quantities', label: '结构推导', table: '外径与用料', action: '更新结构推导' },
  'standard-check': { module: 'standard-check', tab: 'results', page: 'standard-check-results', label: '标准核对', table: '标准核对', action: '执行标准核对' },
  electrical: { module: 'electrical', tab: 'results', page: 'electrical-results', label: '电气参数', table: '电气参数', action: '计算电气参数' },
  'short-circuit': { module: 'short-circuit', tab: 'results', page: 'short-circuit-results', label: '短路容量', table: '短路容量', action: '计算短路容量' },
  'rating-table': { module: 'rating-table', tab: 'results', page: 'rating-table-results', label: '载流量表', table: '载流量表', action: '计算所选工况' },
};
let fixedTypeArchiveSources;
let declaredTypeSeedIds, declaredTypeSeedId;
function archivedTypeModule(run) {
  const definition = run?.snapshot?.definition, method = definition?.method, driver = definition?.driver;
  if (run?.integrity !== 'verified' || !['succeeded', 'partial'].includes(run.status) || !method?.release_digest) return null;
  const artifacts = (run.output?.cases || []).filter(item => item.status === 'succeeded')
    .flatMap(item => Object.values(item.artifacts || {}));
  if (method.plugin_id === 'cablesim.iec60287' && method.capability === 'steady-rating'
    && driver?.kind === 'batch' && Array.isArray(driver.cases) && driver.cases.length
    && driver.cases.every(item => item.metadata?.kind === 'type-rating-table')) return 'rating-table';
  if (method.plugin_id === 'cablesim.cable-geometry' && method.capability === 'concentric-model'
    && artifacts.some(item => item?.schema === 'cablesim.cad-model/1')) return 'structure';
  if (method.plugin_id === 'cablesim.standard-check' && method.capability === 'dimensions'
    && artifacts.some(item => item?.schema === 'cablesim.standard-check/1')) return 'standard-check';
  if (method.plugin_id === 'cablesim.type-electrical' && ['electrical', 'short-circuit'].includes(method.capability)
    && artifacts.some(item => item?.schema === 'cablesim.type-analysis/1' && item.capability === method.capability)) return method.capability;
  return null;
}

// Run with isolated-e2e.mjs and the engineering demo database. All writes below
// are mouse/keyboard actions; GETs only verify the state returned by this host.
// Deliberately incomplete engineering inputs remain visible in the evidence.
await walkthrough('types', async ({ page, expect, base, api, choose, capture, step, check, out, size, tag, report }) => {
  const name = origin => `T1 型号走查 · ${origin} · ${tag}`;
  const versionLabel = value => String(value || '').replace(/\+engineering$/, '（工程版）').replace(/\+[^\s]+$/, '（定制版）') || '未提供';
  const workspace = id => api(`/api/workspaces/${encodeURIComponent(id)}`);
  const visibleText = () => page.locator('body').innerText();
  const toolbar = () => page.getByRole('toolbar', { name: '型号命令', exact: true });
  const layers = () => page.getByRole('table', { name: '型号分层', exact: true });
  const dirty = async () => await toolbar().locator('.command-state').count() > 0
    && (await toolbar().locator('.command-state').innerText()).includes('未保存');
  async function primary(label, context) {
    const buttons = page.locator('.type-root .button-primary:visible');
    await expect(buttons, context + '只显示一个主操作').toHaveCount(1);
    await expect(buttons).toHaveText(label);
    check(context + '唯一主操作为' + label, true, { buttons: await buttons.allInnerTexts() });
    return buttons;
  }
  async function activate(locator, keyboard) {
    if (keyboard) { await locator.focus(); await locator.press('Enter'); }
    else await locator.click();
  }
  async function readableResultColumns(label) {
    const table = page.getByRole('table', { name: label, exact: true });
    await expect(table).toBeVisible();
    const layout = await table.evaluate(node => {
      let left = 0, right = innerWidth;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(parent).overflowX)) {
          const bounds = parent.getBoundingClientRect(); left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
        }
      }
      const bounds = node.getBoundingClientRect();
      const cells = [...node.querySelectorAll('thead th,tbody tr.data-row:first-child td')].map(cell => {
        const range = document.createRange(); range.selectNodeContents(cell);
        const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
        return { text: cell.textContent.trim(), complete: rects.every(rect => rect.left >= left - 1 && rect.right <= right + 1) };
      });
      return { left, right, tableLeft: bounds.left, tableRight: bounds.right, cells,
        complete: bounds.left >= left - 1 && bounds.right <= right + 1 && cells.every(cell => cell.complete) };
    });
    check(label + '的要求数值和最右状态在原水平位置完整显示', layout.complete, layout, { fatal: false });
  }
  async function catalogDeclaration(input, names, label, keyboard) {
    await page.waitForURL(url => url.pathname === '/types' && url.searchParams.get('theme') === 'light');
    await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
    await field('查找型号', input.domain.name);
    const row = page.locator(`[id="row-型号-${input.id}"]`);
    const declaration = row.locator(`[data-type-execution-standards="${input.id}"]`);
    await expect(declaration).toHaveText(names.length ? names.join('、') : '未声明');
    await expect(declaration).toHaveAttribute('data-declaration-state', names.length ? 'declared' : 'undeclared');
    await expect(declaration).toHaveAttribute('data-approval-state', 'ready');
    await declaration.scrollIntoViewIfNeeded();
    await expect(declaration).toBeInViewport({ ratio: 1 });
    if (keyboard !== undefined) {
      if (keyboard) { await declaration.focus(); await expect(declaration).toBeFocused(); }
      else await declaration.hover();
      const explanation = page.locator('.tooltip-content:visible');
      await expect(explanation).toContainText(names.length ? '已明确声明执行版本' : '未声明执行版本');
      await expect(explanation).toContainText('尚无当前已批准要求');
      await capture(label + '-读取声明与批准说明');
      await page.keyboard.press('Escape');
      await expect(explanation).toBeHidden();
    }
    await capture(label);
    return row;
  }
  async function declaredSeed() {
    const owners = await api('/api/design/type-workspaces'), checked = [];
    // Freeze original seed identities before this walkthrough creates any designs.
    declaredTypeSeedIds ||= owners.map(owner => owner.id);
    for (const owner of owners.filter(item => declaredTypeSeedId ? item.id === declaredTypeSeedId : declaredTypeSeedIds.includes(item.id))) {
      const input = await api('/api/types/' + encodeURIComponent(owner.id) + '/workspace');
      const source = input.domain.provenance?.['/execution_standards'];
      const evidence = { workspace: owner.id, revision: input.revision, reviewed: source?.reviewed === true };
      checked.push(evidence);
      if (input.type_plan_source || source?.kind !== 'standard' || source.reviewed !== true) continue;
      let items;
      try { const value = JSON.parse(source.reference); if (value.schema === 'cablesim.execution-standards/1') items = value.items; }
      catch { evidence.reason = '原声明无法解析'; continue; }
      if (!Array.isArray(items) || !items.length || !items.every(item => typeof item.standard === 'string'
        && item.standard.trim() && /^[a-f0-9]{64}$/.test(item.source_digest))) continue;
      const approval = await api('/api/types/' + encodeURIComponent(owner.id) + '/standards-summary');
      evidence.approval = approval;
      if (approval.revision !== input.revision || !Array.isArray(approval.standards) || approval.standards.length) continue;
      const runs = await api('/api/types/' + encodeURIComponent(owner.id) + '/display-runs?after=0&limit=5&recent=true&module=requirements');
      const run = runs.items.find(item => item.freshness === 'current' && item.snapshot?.workspace_revision === input.revision
        && archivedTypeModule(item) === 'standard-check');
      if (!run) { evidence.reason = '没有当前完整性通过的标准核对运行'; continue; }
      const ledger = await api('/api/design/type-workspaces/' + encodeURIComponent(owner.id) + '/requirements?run_id=' + encodeURIComponent(run.id));
      evidence.approvedCount = ledger.approved_count;
      if (ledger.run_id !== run.id || ledger.source_current !== true || ledger.approved_count !== 0
        || !Array.isArray(ledger.items) || ledger.items.some(item => item.state === 'approved')) continue;
      declaredTypeSeedId = owner.id;
      return { input, names: [...new Set(items.map(item => item.standard.trim()))], runId: run.id, source, checked };
    }
    check('执行标准目录走查有真实已声明且零批准的原始型号', false, { checked, originalSeedIds: declaredTypeSeedIds });
    throw new Error('未找到真实已声明且零批准的原始型号，不能跳过或用本轮创建对象替代');
  }
  async function verifyDeclaredSeedNavigation() {
    const source = await declaredSeed(), before = source.input, writesBefore = report.writes.length;
    const evidence = { ...size, workspace: before.id, revision: before.revision, names: source.names,
      domainSha256: createHash('sha256').update(JSON.stringify(before.domain)).digest('hex'),
      declaration: source.source, run: source.runId, approvedCount: 0, candidates: source.checked, navigations: [] };
    (report.typeDeclarationNavigation ||= []).push(evidence);
    try {
      await page.goto(base + '/types?theme=light');
      for (const keyboard of [false, true]) {
        const mode = keyboard ? '键盘' : '鼠标';
        const row = await catalogDeclaration(before, source.names, '执行版本声明-' + mode + '-目录', keyboard);
        await activate(row.locator('button.object-link'), keyboard);
        await page.waitForURL(url => url.pathname === '/types/' + encodeURIComponent(before.id) + '/structure/section');
        const navigation = page.getByRole('navigation', { name: '型号浏览器', exact: true });
        await activate(navigation.getByRole('button', { name: /^要求与标准/ }), keyboard);
        await activate(page.getByRole('tab', { name: '执行标准', exact: true }), keyboard);
        await page.waitForURL(url => url.pathname === '/types/' + encodeURIComponent(before.id) + '/requirements/standards'
          && !url.searchParams.get('run') && !url.searchParams.get('revision'));
        const requirements = page.locator('[data-type-page="requirements-results"]');
        await expect(requirements).toHaveAttribute('data-type-state', 'success');
        const declaration = page.locator('[aria-label="已声明执行标准"]');
        await expect(declaration).toContainText('执行版本已声明');
        for (const name of source.names) await expect(declaration).toContainText(name);
        await expect(requirements.getByText('0 项已批准', { exact: true })).toBeVisible();
        const shot = await capture('执行版本声明-' + mode + '-详情与目录一致且零批准');
        evidence.navigations.push({ mode, url: page.url(), screenshot: shot.screenshot });
        await activate(page.getByRole('navigation', { name: '对象', exact: true }).getByRole('link', { name: '型号设计', exact: true }), keyboard);
        await catalogDeclaration(before, source.names, '执行版本声明-' + mode + '-返回目录');
        await page.reload();
        await catalogDeclaration(before, source.names, '执行版本声明-' + mode + '-目录刷新');
      }
    } finally {
      const after = await api('/api/types/' + encodeURIComponent(before.id) + '/workspace');
      const ledger = await api('/api/design/type-workspaces/' + encodeURIComponent(before.id) + '/requirements?run_id=' + encodeURIComponent(source.runId));
      const approval = await api('/api/types/' + encodeURIComponent(before.id) + '/standards-summary');
      evidence.after = { revision: after.revision, declaration: after.domain.provenance?.['/execution_standards'], approvedCount: ledger.approved_count,
        domainSha256: createHash('sha256').update(JSON.stringify(after.domain)).digest('hex'),
        approval, writes: report.writes.slice(writesBefore) };
      check('已声明零批准型号键鼠往返及刷新未写入且保留原修订领域与声明', report.writes.length === writesBefore
        && after.revision === before.revision && JSON.stringify(after.domain) === JSON.stringify(before.domain)
        && JSON.stringify(after.domain.provenance?.['/execution_standards']) === JSON.stringify(source.source)
        && ledger.source_current === true && ledger.approved_count === 0
        && approval.revision === before.revision && approval.standards.length === 0, evidence.after, { fatal: false });
    }
  }
  let teachingSource;
  async function teachingDesign() {
    if (teachingSource) return teachingSource;
    const candidates = (await api('/api/design/type-workspaces')).filter(item => item.name === 'YJV22-8.7/15 3×300');
    for (const seed of candidates) {
      const original = await workspace(seed.id);
      // A previous viewport's independent copy retains the engineering model
      // name. Resolve the actual seed identity, never that more-recent copy.
      if (original.type_plan_source) continue;
      const studies = await api(`/api/workspaces/${seed.id}/studies`);
      if (!studies.some(item => item.definition.driver.kind === 'batch' && /教学/.test(item.definition.parameters?.source || ''))) continue;
      teachingSource = { seed, original, studies }; return teachingSource;
    }
    return null;
  }

  async function verifyRatingParameterControls({ wid, sid, definition, draftSource }) {
    const prefix = `/api/workspaces/${encodeURIComponent(wid)}/studies/${encodeURIComponent(sid)}`;
    const [studyBefore, workspaceBefore] = await Promise.all([api(prefix), workspace(wid)]);
    const writesBefore = report.writes.length, start = new URL(page.url());
    const expectedParameters = (definition || studyBefore.definition).parameters;
    const fixedParameters = [], fixedConditions = [];
    const form = page.locator('.parameter-form'), mode = form.getByRole('combobox', { name: '额定模式', exact: true });
    const explanation = page.getByRole('region', { name: '载流量参数说明', exact: true });
    await expect(mode).toBeDisabled();
    if (!Object.hasOwn(expectedParameters, 'rating_mode')) await expect(mode).toHaveText('请选择');
    await expect(explanation).toContainText('计算时同名参数以逐行工况为准');
    await expect(explanation).toContainText('全局额定模式只读');
    await expect(explanation).toContainText('空白不表示逐行工况未保存');
    const modeBefore = await mode.innerText(), wasDirty = await dirty();
    async function verifyFixedParameters() {
      if (!start.searchParams.has('run')) return;
      await advanced(form);
      for (const [key, label] of [['ks', '集肤效应系数'], ['kp', '邻近效应系数']]) {
        if (!Object.hasOwn(expectedParameters, key)) continue;
        const input = form.getByLabel(new RegExp('^(?:\\*\\s*)?' + label + '$'));
        await expect(input).toHaveValue(String(expectedParameters[key]));
        await expect(input).not.toBeEditable();
        fixedParameters.push({ key, value: await input.inputValue(), readOnly: true });
      }
      if (typeof expectedParameters.source === 'string') {
        const sourceEditor = form.locator('.parameter-structured[data-field-path="/source"] details.parameter-source');
        if (await sourceEditor.getAttribute('open') === null) await sourceEditor.locator(':scope > summary').click();
        const input = sourceEditor.getByLabel('来源', { exact: true });
        await expect(input).toHaveValue(expectedParameters.source);
        await expect(input).not.toBeEditable();
        fixedParameters.push({ key: 'source', value: await input.inputValue(), readOnly: true });
      }
    }
    await verifyFixedParameters();
    if (draftSource !== undefined) {
      expect(wasDirty, '本段必须有真实未保存方法草稿').toBe(true);
      await expect(form.getByRole('combobox', { name: '运行输出', exact: true })).toBeEnabled();
      await expect(form.getByLabel('来源', { exact: true })).toHaveValue(draftSource);
      expect(studyBefore.definition.parameters.source, '已有教学来源草稿尚未写入保存参数').not.toBe(draftSource);
    }
    await explanation.scrollIntoViewIfNeeded();
    await expect(explanation).toBeInViewport({ ratio: 1 });
    const visibleReason = await explanation.evaluate(node => [...node.querySelectorAll('p')].map(item => ({
      text: item.textContent, display: getComputedStyle(item).display, font: parseFloat(getComputedStyle(item).fontSize),
      width: item.clientWidth, scrollWidth: item.scrollWidth,
    })));
    check('全局额定模式只读原因与逐行优先级使用可见正文', visibleReason.every(item => item.display !== 'none'
      && item.font >= 13 && item.width > 0 && item.scrollWidth <= item.width + 1), visibleReason);
    const label = start.searchParams.has('run') ? '固定运行' : '未保存草稿';
    const beforeShot = await capture('载流量表-' + label + '-全局模式只读与逐行说明');
    const conditions = explanation.getByRole('button', { name: '查看逐行工况', exact: true });
    await conditions.focus();
    await expect(conditions).toBeFocused();
    await conditions.press('Enter');
    await page.waitForURL(url => url.pathname === `/types/${encodeURIComponent(wid)}/rating-table/results`
      && ['theme', 'run', 'revision'].every(key => url.searchParams.get(key) === start.searchParams.get(key)));
    await expect(page.getByRole('table', { name: '载流量表', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '型号有未保存修改', exact: true })).toHaveCount(0);
    expect(await dirty(), '同一工况表导航保留原草稿状态').toBe(wasDirty);
    if (start.searchParams.has('run')) {
      const conditions = definition.driver.cases.map(item => item.metadata.condition);
      const table = page.getByRole('table', { name: '载流量表', exact: true });
      for (const condition of conditions) {
        const row = table.getByRole('row', { name: condition.name, exact: true });
        await row.focus(); await row.press('Enter');
        const editor = page.locator('details.type-rating-edit');
        await expect(editor.locator(':scope > summary')).toHaveText('所选工况条件 · ' + condition.name);
        if (await editor.getAttribute('open') === null) await editor.locator(':scope > summary').click();
        await expect(editor.getByLabel('工况名称', { exact: true })).toHaveValue(condition.name);
        await expect(editor.getByLabel('工况名称', { exact: true })).not.toBeEditable();
        const observed = { caseId: condition.case_id, name: condition.name };
        const conditionFields = [['ambient_temperature_c', '环境温度'],
          ...(condition.layout === 'air' ? [] : [['depth_m', '中心埋深'], ['soil_rho_k_m_w', '土壤热阻率']]),
          ['spacing_m', '中心距']];
        for (const [key, label] of conditionFields) {
          const input = editor.getByRole('textbox', { name: condition.name + ' ' + label, exact: true });
          await expect(input).toHaveValue(condition[key] == null ? '' : String(condition[key]));
          await expect(input).not.toBeEditable(); observed[key] = await input.inputValue();
        }
        const sourceInput = editor.getByLabel('条件来源', { exact: true });
        await expect(sourceInput).toHaveValue(condition.source || '');
        await expect(sourceInput).not.toBeEditable();
        await expect(editor.getByRole('combobox', { name: '排列', exact: true })).toBeDisabled();
        await expect(editor.getByRole('combobox', { name: '载流量口径', exact: true })).toBeDisabled();
        fixedConditions.push({ ...observed, source: await sourceInput.inputValue(), readOnly: true });
      }
    }
    const resultsUrl = page.url(), resultShot = await capture('载流量表-' + label + '-键盘查看逐行工况');
    const parameterTab = page.getByRole('tab', { name: '方法参数', exact: true });
    await parameterTab.focus();
    await parameterTab.press('Enter');
    await page.waitForURL(url => url.pathname === start.pathname
      && ['theme', 'run', 'revision'].every(key => url.searchParams.get(key) === start.searchParams.get(key)));
    await expect(mode).toBeDisabled();
    await expect(mode).toHaveText(modeBefore);
    await verifyFixedParameters();
    expect(await dirty(), '返回参数页仍保留原草稿状态').toBe(wasDirty);
    if (draftSource !== undefined) {
      await advanced(form);
      const sourceEditor = form.locator('.parameter-structured[data-field-path="/source"] details.parameter-source');
      if (await sourceEditor.getAttribute('open') === null) await sourceEditor.locator(':scope > summary').click();
      await expect(sourceEditor.getByLabel('来源', { exact: true })).toHaveValue(draftSource);
    }
    const [studyAfter, workspaceAfter] = await Promise.all([api(prefix), workspace(wid)]);
    expect(studyAfter.id).toBe(studyBefore.id);
    expect(studyAfter.revision).toBe(studyBefore.revision);
    expect(studyAfter.definition).toEqual(studyBefore.definition);
    expect(workspaceAfter.id).toBe(workspaceBefore.id);
    expect(workspaceAfter.revision).toBe(workspaceBefore.revision);
    expect(workspaceAfter.domain).toEqual(workspaceBefore.domain);
    const evidence = { ...size, workspace: wid, study: sid, run: start.searchParams.get('run'),
      revision: start.searchParams.get('revision'), start: start.href, results: resultsUrl, returned: page.url(),
      modeText: modeBefore, parametersBefore: studyBefore.definition.parameters, parametersAfter: studyAfter.definition.parameters,
      fixedParameters, fixedConditions, draftSource, wasDirty, visibleReason,
      screenshots: [beforeShot.screenshot, resultShot.screenshot], writes: report.writes.slice(writesBefore) };
    (report.ratingParameterNavigation ||= []).push(evidence);
    check('全局额定模式不可编辑且键盘工况往返保留身份、参数与草稿并且零写入', evidence.writes.length === 0, evidence);
  }

  async function fixedTypeSources() {
    if (fixedTypeArchiveSources) return fixedTypeArchiveSources;
    const found = new Map(), owners = await api('/api/design/type-workspaces');
    for (const owner of owners) {
      let cursor = 0;
      for (let index = 0; index < 400; index++) {
        const saved = await api('/api/types/' + encodeURIComponent(owner.id) + '/display-runs?limit=5&after=' + cursor);
        expect(Array.isArray(saved.items), '型号保存运行必须是实际分页响应').toBeTruthy();
        for (const candidate of saved.items) {
          const module = archivedTypeModule(candidate);
          if (!module || found.has(module)) continue;
          const fullPath = '/api/workspaces/' + encodeURIComponent(owner.id) + '/studies/'
            + encodeURIComponent(candidate.study) + '/runs/' + encodeURIComponent(candidate.id) + '?view=full';
          try {
            const run = await api(fullPath);
            expect(run.id).toBe(candidate.id);
            expect(run.workspace).toBe(owner.id);
            expect(run.study).toBe(candidate.study);
            expect(run.snapshot.study_id).toBe(candidate.study);
            expect(run.snapshot.workspace_id || run.snapshot.workspace).toBe(owner.id);
            expect(run.input_digest).toBe(candidate.input_digest);
            expect(run.output_digest).toBe(candidate.output_digest);
            expect(archivedTypeModule(run), '分类来自完整原运行，不能借当前研究定义').toBe(module);
            expect(run.snapshot.workspace_state?.domain, '固定运行必须有原型号领域快照').toBeTruthy();
            found.set(module, { module, wid: owner.id, sid: run.study, rid: run.id, fullPath, run });
          } catch (error) {
            check('固定型号运行完整档案可核实', false,
              { module, workspace: owner.id, run: candidate.id, error: error.message }, { fatal: false });
          }
        }
        if (found.size === Object.keys(fixedTypeRoutes).length || saved.next_cursor === null || saved.next_cursor === undefined) break;
        expect(saved.next_cursor, '型号保存运行游标必须前进').toBeGreaterThan(cursor);
        cursor = saved.next_cursor;
        expect(index, '未遍历完历史时不能宣称没有种子').toBeLessThan(399);
      }
      if (found.size === Object.keys(fixedTypeRoutes).length) break;
    }
    // The second viewport rereads these same original identities. The first
    // viewport's UI-created designs cannot become replacement seed evidence.
    fixedTypeArchiveSources = [...found.values()];
    return fixedTypeArchiveSources;
  }
  async function verifyFixedTypeNavigation(source) {
    const target = fixedTypeRoutes[source.module], current = await workspace(source.wid);
    const prefix = '/api/workspaces/' + encodeURIComponent(source.wid) + '/studies/' + encodeURIComponent(source.sid);
    const studyBefore = await api(prefix), archiveBefore = await api(source.fullPath);
    expect(archiveBefore.integrity).toBe('verified');
    expect(archiveBefore.snapshot).toEqual(source.run.snapshot);
    expect(archiveBefore.input_digest).toBe(source.run.input_digest);
    expect(archiveBefore.output_digest).toBe(source.run.output_digest);
    const fullEndpoint = new URL(base + source.fullPath).pathname;
    const rowsEndpoint = '/api/design/workspaces/' + encodeURIComponent(source.wid) + '/rating-table-runs/' + encodeURIComponent(source.rid);
    const ratingBefore = source.module === 'rating-table' ? await api(rowsEndpoint + '?view=rows') : null;
    const writesBefore = report.writes.length;
    const evidence = { ...size, module: source.module, workspace: source.wid, study: source.sid, run: source.rid,
      inputDigest: archiveBefore.input_digest, outputDigest: archiveBefore.output_digest,
      workspaceRevision: archiveBefore.snapshot.workspace_revision, studyRevision: archiveBefore.snapshot.study_revision,
      currentWorkspaceRevision: current.revision, method: archiveBefore.snapshot.definition.method,
      applicable: true, navigations: [] };
    (report.fixedTypeRunNavigation ||= []).push(evidence);
    const historyRequests = [], historyByRequest = new WeakMap(), historyUpdates = new Set();
    const historyEndpoint = '/api/types/' + encodeURIComponent(source.wid) + '/display-runs';
    evidence.historyRequests = historyRequests;
    const notifyHistory = () => { for (const wake of [...historyUpdates]) wake(); };
    const onHistoryRequest = request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === historyEndpoint && !url.searchParams.has('recent')) {
        const read = { url: url.pathname + url.search, after: Number(url.searchParams.get('after')),
          limit: Number(url.searchParams.get('limit')), state: 'requested', requestedAt: Date.now() };
        historyRequests.push(read); historyByRequest.set(request, read); notifyHistory();
      }
    };
    const onHistoryResponse = response => {
      const read = historyByRequest.get(response.request());
      if (!read) return;
      read.http = response.status(); read.state = 'reading-body';
      void (async () => {
        try {
          expect(read.http, '页面实际完整历史响应必须成功').toBe(200);
          const bytes = await response.body(), payload = JSON.parse(bytes.toString('utf8'));
          read.bytes = bytes.length; read.sha256 = createHash('sha256').update(bytes).digest('hex');
          expect(Array.isArray(payload.items), '完整历史响应必须包含真实运行数组').toBe(true);
          // This flag means full-directory mode on every page; only a null
          // next_cursor establishes the end of that actual response chain.
          expect(payload.history_complete, '历史不能被 recent 摘要冒充').toBe(true);
          expect(Object.hasOwn(payload, 'next_cursor'), '完整历史响应必须给出末页或下一游标').toBe(true);
          expect(payload.next_cursor === null || Number.isSafeInteger(payload.next_cursor)
            && payload.next_cursor > read.after, '完整历史下一游标必须前进或明确结束').toBe(true);
          read.historyComplete = payload.history_complete; read.nextCursor = payload.next_cursor;
          read.runs = payload.items.map(run => ({ id: run.id, workspace: run.workspace, study: run.study,
            sequence: run.sequence, integrity: run.integrity, inputDigest: run.input_digest, outputDigest: run.output_digest,
            workspaceRevision: run.snapshot?.workspace_revision, studyRevision: run.snapshot?.study_revision,
            artifactSchemas: (run.output?.cases || []).filter(item => item.status === 'succeeded')
              .flatMap(item => Object.values(item.artifacts || {}).map(artifact => artifact?.schema)) }));
          if (read.state !== 'failed') read.state = 'complete';
        } catch (error) { read.state = 'failed'; read.error = error.message; }
        finally { read.finishedAt = Date.now(); notifyHistory(); }
      })();
    };
    const onHistoryFailed = request => {
      const read = historyByRequest.get(request);
      if (!read) return;
      // A navigation-aborted history is a failure here, even though the shared
      // console/network collector excludes ordinary ERR_ABORTED requests.
      read.state = 'failed'; read.error = request.failure()?.errorText || '完整历史请求失败';
      read.finishedAt = Date.now(); notifyHistory();
    };
    page.on('request', onHistoryRequest);
    page.on('response', onHistoryResponse);
    page.on('requestfailed', onHistoryFailed);
    async function completedHistory(readsBefore) {
      const deadline = Date.now() + 30000;
      for (;;) {
        const reads = historyRequests.slice(readsBefore), failed = reads.find(read => read.state === 'failed');
        if (failed) throw new Error('页面完整历史未完成：' + failed.url + ' · ' + failed.error);
        if (reads.length && reads.every(read => read.state === 'complete') && reads.at(-1).nextCursor === null) {
          expect(reads.length, '完整历史读取不得越过原有分页上限').toBeLessThanOrEqual(400);
          for (const [index, read] of reads.entries()) {
            expect(read.limit).toBe(5);
            expect(read.after, '实际请求必须连接上一响应的游标，且每页只读一次')
              .toBe(index === 0 ? 0 : reads[index - 1].nextCursor);
            expect(read.runs.length).toBeLessThanOrEqual(read.limit);
            for (const [position, run] of read.runs.entries()) {
              expect(run.workspace).toBe(source.wid);
              expect(typeof run.id === 'string' && run.id.length > 0 && Number.isSafeInteger(run.sequence)
                && run.sequence > (position === 0 ? read.after : read.runs[position - 1].sequence),
              '历史运行必须有真实且按游标递增的身份').toBe(true);
            }
            if (read.nextCursor !== null) expect(read.nextCursor).toBe(read.runs.at(-1)?.sequence);
          }
          const runs = reads.flatMap(read => read.runs);
          expect(new Set(runs.map(run => run.id)).size, '完整历史不能重复同一运行').toBe(runs.length);
          const selected = runs.filter(run => run.id === source.rid);
          expect(selected, '页面最终完整历史必须包含确切原运行').toHaveLength(1);
          expect(selected[0]).toMatchObject({ workspace: source.wid, study: source.sid, integrity: 'verified',
            inputDigest: archiveBefore.input_digest, outputDigest: archiveBefore.output_digest,
            workspaceRevision: archiveBefore.snapshot.workspace_revision, studyRevision: archiveBefore.snapshot.study_revision });
          return reads;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('页面完整历史未在原有 30 秒验证等待内读至末页');
        await new Promise((resolve, reject) => {
          const wake = () => { clearTimeout(timer); historyUpdates.delete(wake); resolve(); };
          const timer = setTimeout(() => { historyUpdates.delete(wake); reject(new Error('页面完整历史响应链未完成')); }, remaining);
          historyUpdates.add(wake);
        });
      }
    }
    async function openRunRecord() {
      await page.goto(base + '/runs?theme=light');
      const table = page.getByRole('table', { name: '运行', exact: true });
      await expect(table).toBeVisible();
      const query = studyBefore.definition?.title || studyBefore.title;
      expect(typeof query === 'string' && query.length > 0, '检索使用当前真实研究名，运行身份仍按保存ID核对').toBeTruthy();
      const responsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && url.pathname === '/api/index/objects'
          && url.searchParams.get('kind') === 'run' && url.searchParams.get('q') === query;
      });
      await page.getByRole('group', { name: '运行筛选', exact: true }).getByRole('textbox').fill(query);
      const response = await responsePromise;
      expect(response.ok(), '实际运行检索返回成功').toBeTruthy();
      const filtered = await response.json();
      expect(filtered.total, '真实运行必须能按所属研究检索').toBeGreaterThan(0);
      await expect.poll(() => table.locator('tbody tr.data-row').evaluateAll(rows => rows.map(row => row.id)))
        .toEqual(filtered.items.map(item => 'row-运行-' + item.id));
      const row = table.locator('[id="row-运行-' + source.rid + '"]');
      let shown = 0;
      for (let index = 0; !await row.count() && index < Math.ceil(filtered.total / 10); index++) {
        const more = page.getByRole('button', { name: /^加载更多（已显示 / });
        if (!await more.isVisible()) break;
        shown = await table.locator('tbody tr.data-row').count();
        await more.click();
        await expect.poll(() => table.locator('tbody tr.data-row').count()).toBeGreaterThan(shown);
      }
      await expect(row, '实际运行目录必须包含所选原运行').toBeVisible();
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport({ ratio: 1 });
      const link = row.getByRole('cell').first().getByRole('link').first();
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href'), url = new URL(href, base);
      expect(url.pathname).toBe('/studies/' + encodeURIComponent(source.sid));
      expect(url.searchParams.get('run')).toBe(source.rid);
      return { link, href: url.pathname + url.search };
    }
    async function openFixed(label, action) {
      const readsBefore = historyRequests.length, startedAt = Date.now();
      const [archiveResponse, ratingResponse] = await Promise.all([
        page.waitForResponse(response => {
          const url = new URL(response.url());
          return response.request().method() === 'GET' && url.pathname === fullEndpoint && url.searchParams.get('view') === 'full';
        }, { timeout: 90000 }),
        source.module === 'rating-table' ? page.waitForResponse(response =>
          response.request().method() === 'GET' && new URL(response.url()).pathname === rowsEndpoint
            && new URL(response.url()).searchParams.get('view') === 'rows', { timeout: 90000 }) : Promise.resolve(null),
        action(),
      ]);
      expect(archiveResponse.status(), '界面读取原运行完整输入').toBe(200);
      const observed = await archiveResponse.json();
      expect(observed.id).toBe(source.rid);
      expect(observed.workspace).toBe(source.wid);
      expect(observed.study).toBe(source.sid);
      expect(observed.integrity).toBe('verified');
      expect(observed.input_digest).toBe(archiveBefore.input_digest);
      expect(observed.output_digest).toBe(archiveBefore.output_digest);
      expect(observed.snapshot, '界面读取确切原版本，不能替换当前型号输入').toEqual(archiveBefore.snapshot);
      if (ratingResponse) {
        expect(ratingResponse.status(), '界面读取原载流量表结果行').toBe(200);
        const rating = await ratingResponse.json();
        expect(rating.run.id).toBe(source.rid);
        expect(rating.run.workspace).toBe(source.wid);
        expect(rating.run.study).toBe(source.sid);
        expect(rating.run.integrity).toBe('verified');
        expect(rating.run.input_digest).toBe(archiveBefore.input_digest);
        expect(rating.run.output_digest).toBe(archiveBefore.output_digest);
        expect(rating.rows).toEqual(ratingBefore.rows);
      }
      await page.waitForURL(url => url.pathname === '/types/' + encodeURIComponent(source.wid) + '/' + target.module + '/' + target.tab
        && url.searchParams.get('run') === source.rid && url.searchParams.get('theme') === 'light');
      const surface = page.locator('[data-type-page="' + target.page + '"]');
      await expect(surface).toHaveAttribute('data-type-state', /^(success|historical)$/);
      await expect(surface.getByRole('table', { name: target.table, exact: true })).toBeVisible();
      await expect(page.locator('.type-root .topbar')).toContainText('保存运行');
      await expect(page.locator('.type-root .topbar')).toContainText('只读');
      await expect(toolbar().getByRole('button', { name: '保存', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: '修改型号名称', exact: true })).toBeDisabled();
      const calculate = toolbar().getByRole('button', { name: target.action, exact: true });
      await expect(calculate).toBeDisabled();
      if (source.module === 'structure' && await surface.getAttribute('data-type-state') === 'historical') {
        await expect(surface.locator('.stale-banner')).toContainText('历史输入和保存结果保持只读');
        await expect(surface).not.toContainText('保存修改后点击');
        await expect(surface.getByRole('button', { name: '打开当前型号', exact: true })).toBeEnabled();
      }
      if (ratingBefore) {
        expect(await surface.getByRole('table', { name: target.table, exact: true }).locator('tbody tr.data-row')
          .evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')))).toEqual(ratingBefore.rows.map(row => row.name));
        await expect(surface.getByRole('button', { name: '添加工况', exact: true })).toBeDisabled();
        await expect(surface.getByRole('checkbox', { name: '选择全部工况', exact: true })).toBeDisabled();
      }
      const subjectReadyMs = Date.now() - startedAt;
      const shot = await capture('固定型号运行-' + target.label + '-' + label);
      const navigation = { label, url: page.url(), screenshot: shot.screenshot, archiveHttp: archiveResponse.status(),
        ratingHttp: ratingResponse?.status(), run: observed.id, inputDigest: observed.input_digest,
        outputDigest: observed.output_digest, workspaceRevision: observed.snapshot.workspace_revision,
        studyRevision: observed.snapshot.study_revision, subjectReadyMs, subjectCaptureMs: Date.now() - startedAt,
        historyAtCapture: historyRequests.slice(readsBefore).map(read => ({ after: read.after, state: read.state, nextCursor: read.nextCursor })) };
      evidence.navigations.push(navigation);
      // This verification wait starts after the ready-subject screenshot. It
      // does not replace first-paint evidence or alter the performance budget.
      const historyWaitStarted = Date.now();
      try {
        navigation.historyReads = await completedHistory(readsBefore);
        navigation.historyCompleteMs = Math.max(...navigation.historyReads.map(read => read.finishedAt)) - startedAt;
        navigation.historyVerificationWaitMs = Date.now() - historyWaitStarted;
        await expect(surface).toHaveAttribute('data-type-state', /^(success|historical)$/);
        expect(page.url(), '后台历史完成不能替换当前选中运行').toBe(navigation.url);
        await expect(page.getByText('保存运行目录不可用', { exact: true })).toHaveCount(0);
        check(target.label + ' · ' + label + '的页面完整历史响应链已读至末页且每页只读取一次', true,
          { run: source.rid, historyReads: navigation.historyReads, subjectReadyMs, historyCompleteMs: navigation.historyCompleteMs });
      } catch (error) {
        navigation.historyError = error.message; navigation.historyReads = historyRequests.slice(readsBefore);
        check(target.label + ' · ' + label + '的页面完整历史响应链完成', false,
          { run: source.rid, error: error.message, historyReads: navigation.historyReads }, { fatal: false });
        throw error;
      }
      if (!evidence.historyPicker && ['structure', 'standard-check'].includes(source.module)) {
        const picker = page.getByRole('combobox', { name: '保存运行', exact: true });
        const schema = source.module === 'structure' ? 'cablesim.cad-model/1' : 'cablesim.standard-check/1';
        const selectable = navigation.historyReads.flatMap(read => read.runs)
          .filter(run => run.integrity === 'verified' && run.artifactSchemas.includes(schema));
        await expect(picker).toBeVisible();
        await expect(page.getByRole('button', { name: '全部保存运行', exact: true })).toHaveCount(0);
        await activate(picker, size.width === 1366);
        const options = page.getByRole('option');
        await expect(options).toHaveCount(selectable.length + 1);
        for (const run of selectable) await expect(options.filter({ hasText: '运行 ' + run.sequence + ' ·' })).toHaveCount(1);
        await expect(page.getByRole('option', { selected: true })).toContainText('运行 ' + archiveBefore.sequence + ' ·');
        const historyShot = await capture('固定型号运行-' + target.label + '-完整历史目录可选');
        evidence.historyPicker = { runs: selectable.map(run => run.id), selectedRun: source.rid, screenshot: historyShot.screenshot };
        await page.keyboard.press('Escape');
        await expect(options).toHaveCount(0);
      }
      if (!evidence.readOnlyReason) {
        // CommandBar wraps a native disabled button in the real tooltip trigger.
        const trigger = calculate.locator('xpath=..');
        await expect(trigger).toHaveClass(/command-disabled/);
        await trigger.hover();
        await expect(page.getByRole('tooltip')).toHaveText('运行快照保持只读');
        await expect(page.locator('.tooltip-content:visible')).toBeVisible();
        const reasonShot = await capture('固定型号运行-' + target.label + '-计算禁用说明');
        evidence.readOnlyReason = { text: '运行快照保持只读', screenshot: reasonShot.screenshot };
        await page.keyboard.press('Escape');
        await expect(page.locator('.tooltip-content:visible')).toBeHidden();
        await capture('固定型号运行-' + target.label + '-键盘关闭禁用说明');
      }
      check(target.label + ' · ' + label + '保留确切运行与只读状态且未写入', report.writes.length === writesBefore,
        { run: source.rid, url: page.url(), writes: report.writes.slice(writesBefore) });
    }
    try {
      let record = await openRunRecord();
      await capture('固定型号运行-' + target.label + '-运行目录鼠标入口');
      await openFixed('运行目录鼠标打开', () => record.link.click());
      record = await openRunRecord();
      await record.link.focus();
      await expect(record.link).toBeFocused();
      await capture('固定型号运行-' + target.label + '-运行目录键盘焦点');
      await openFixed('运行目录键盘打开', () => record.link.press('Enter'));
      await openFixed('研究根链接冷打开', () => page.goto(base + record.href));
      await openFixed('刷新保留原运行', () => page.reload());
      const legacy = new URL(record.href, base);
      legacy.pathname += source.module === 'rating-table' ? '/batch/space' : '/ampacity/results';
      legacy.searchParams.set('workspace', source.wid);
      evidence.legacyUrl = legacy.pathname + legacy.search;
      await openFixed(source.module === 'rating-table' ? '旧批量空间链接打开' : '旧载流量结果链接打开',
        () => page.goto(legacy.href));
      await openFixed('旧入口转到型号后刷新', () => page.reload());
      if (source.module === 'rating-table') {
        const parameters = new URL(page.url());
        parameters.pathname = `/types/${encodeURIComponent(source.wid)}/rating-table/parameters`;
        parameters.searchParams.set('revision', String(archiveBefore.snapshot.workspace_revision));
        const readsBefore = historyRequests.length;
        await page.goto(parameters.href);
        await verifyRatingParameterControls({ wid: source.wid, sid: source.sid, definition: archiveBefore.snapshot.definition });
        const parameterEvidence = report.ratingParameterNavigation.at(-1);
        parameterEvidence.historyReads = await completedHistory(readsBefore);
        check('固定载流量参数冷直达及只读往返后的页面完整历史已读至末页', true,
          { run: source.rid, historyReads: parameterEvidence.historyReads });
      }
      const openCurrent = page.getByRole('button', { name: '打开当前型号', exact: true });
      if (source.module === 'structure' && await openCurrent.isVisible()) {
        if (size.width === 1366) { await openCurrent.focus(); await openCurrent.press('Enter'); }
        else await openCurrent.click();
        await page.waitForURL(url => url.pathname === '/types/' + encodeURIComponent(source.wid) + '/structure/table'
          && url.searchParams.get('theme') === 'light' && !url.searchParams.get('run') && !url.searchParams.get('revision'));
        await expect(layers()).toBeVisible();
        await expect(page.locator('.type-root .topbar')).not.toContainText('保存运行');
        const currentShot = await capture('固定型号运行-结构推导-打开同一当前型号');
        evidence.currentInputEntry = { workspace: source.wid, revision: current.revision, url: page.url(), screenshot: currentShot.screenshot };
        record = await openRunRecord();
        await openFixed('当前型号返回保存运行', () => record.link.click());
        check('历史结构推导可键鼠返回同一当前型号并重新打开原保存运行', true, evidence.currentInputEntry);
      }
    } finally {
      page.off('request', onHistoryRequest);
      page.off('response', onHistoryResponse);
      page.off('requestfailed', onHistoryFailed);
      const [afterWorkspace, afterStudy, afterArchive] = await Promise.all([workspace(source.wid), api(prefix), api(source.fullPath)]);
      check(target.label + '固定入口检查没有改动当前输入或原运行', report.writes.length === writesBefore
        && afterWorkspace.revision === current.revision && JSON.stringify(afterWorkspace.domain) === JSON.stringify(current.domain)
        && afterStudy.revision === studyBefore.revision && JSON.stringify(afterStudy.definition) === JSON.stringify(studyBefore.definition)
        && afterArchive.input_digest === archiveBefore.input_digest && afterArchive.output_digest === archiveBefore.output_digest
        && JSON.stringify(afterArchive.snapshot) === JSON.stringify(archiveBefore.snapshot),
      { run: source.rid, currentRevision: afterWorkspace.revision, snapshotRevision: afterArchive.snapshot.workspace_revision,
        writes: report.writes.slice(writesBefore) }, { fatal: false });
    }
  }

  async function dismissDialog() {
    for (let count = 0; count < 3 && await page.getByRole('dialog').count(); count++) {
      const current = page.getByRole('dialog').first();
      const leave = page.getByRole('dialog', { name: '型号有未保存修改', exact: true });
      if (await leave.isVisible()) await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
      else await page.keyboard.press('Escape');
      await expect(current).toBeHidden();
    }
  }
  async function attempt(label, action) {
    try { return await step(label, action); }
    catch (error) {
      check(label, false, { error: error.message, state: await visibleText() }, { fatal: false });
      await dismissDialog();
      return undefined;
    } finally { await recoverSavedDraft(label); }
  }
  async function recoverSavedDraft(label) {
    await dismissDialog();
    if (!await dirty()) return;
    const id = new URL(page.url()).pathname.split('/')[2];
    const saved = await workspace(id);
    // Undo the active module's unsaved commands one at a time. Do not switch to
    // structure and accidentally undo a saved domain version for a method draft.
    let restored = false;
    for (let count = 0; count < 64 && await dirty(); count++) {
      const undo = await command('撤销');
      if (!undo || !await undo.isEnabled()) break;
      const previous = await toolbar().locator('.command-state').innerText();
      await undo.click();
      try {
        await expect.poll(async () => await dirty() ? toolbar().locator('.command-state').innerText() : '', { timeout: 10000 }).not.toBe(previous);
      } catch { break; }
    }
    restored = !await dirty();
    check(label + '之后可用撤销恢复已保存输入', restored, await visibleText());
    if (!restored) {
      const leave = dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      page.on('dialog', leave);
      try { await page.reload(); } finally { page.off('dialog', leave); }
      await expect(page.getByRole('navigation', { name: '型号浏览器', exact: true })).toBeVisible();
      await expect.poll(dirty).toBe(false);
    }
    const current = await workspace(id);
    check(label + '恢复未改动保存版本', current.revision === saved.revision
      && JSON.stringify(current.domain) === JSON.stringify(saved.domain), { workspace: id, revision: current.revision });
    await capture(label + (restored ? '-撤销草稿恢复已保存输入' : '-明确重载恢复已保存输入'));
  }
  async function responseFor(method, endpoint, action, timeout = 90000) {
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === method, { timeout }),
      action(),
    ]);
    expect(response.ok(), `${method} ${endpoint}: HTTP ${response.status()}${response.ok() ? '' : ' ' + await response.text()}`).toBeTruthy();
    return response.json();
  }
  async function field(label, value, scope = page) {
    // BuzzForm includes the visible required marker in the accessible name.
    const input = scope.getByLabel(new RegExp('^(?:\\*\\s*)?' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(input).toBeVisible();
    await input.fill(String(value));
    await input.press('Tab');
  }
  async function advanced(scope = page) {
    for (const section of await scope.locator('details.parameter-advanced').all()) {
      if (await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
    }
  }
  async function fillRatingParameters(parameters, source) {
    const form = page.locator('.parameter-form');
    await expect(form.locator('.buzzform-contract').first()).toBeVisible();
    await advanced(form);
    for (const [key, label] of [['ks', '集肤效应系数'], ['kp', '邻近效应系数']]) {
      expect(Number.isFinite(parameters[key]), key + '必须来自已保存的教学条件').toBeTruthy();
      await field(label, parameters[key], form);
    }
    const celsius = value => Number((value - 273.15).toPrecision(12));
    for (const [key, label, fields] of [
      ['solver', '求解设置', [['initial_sheath_temperature_k', '护套迭代初温', celsius],
        ['max_iterations', '最大迭代次数'], ['current_tolerance_a', '电流容差']]],
      ['duct', '排管模型', [['u', '排管系数 u'], ['v_per_m', '管内热阻直径系数'],
        ['y_per_m_k', '管内热阻温径系数'], ['initial_mean_air_temperature_k', '管内平均空气初温', celsius]]],
    ]) {
      expect(parameters[key], label + '必须来自已保存的教学条件').toBeTruthy();
      const group = form.locator(`.parameter-structured[data-field-path="/${key}"]`);
      // Optional objects start unset. Configure them through the visible editor,
      // then open the newly mounted advanced fields before entering source data.
      await choose(label + ' · 配置', '逐项配置', group);
      await expect(group.locator(':scope > .buzzform-contract')).toBeVisible();
      await advanced(group);
      for (const [fieldKey, fieldLabel, convert = value => value] of fields) {
        expect(Number.isFinite(parameters[key][fieldKey]), key + '/' + fieldKey + '必须来自已保存的教学条件').toBeTruthy();
        await field(fieldLabel, convert(parameters[key][fieldKey]), group);
      }
    }
    expect(parameters.t4_form).toBe('exact');
    expect(parameters.eddy).toBe('ignored');
    expect(parameters.reference_basis).toBe('iec2023');
    await choose('外部热阻形式', '精确形式', form);
    await choose('涡流损耗处理', '忽略', form);
    await choose('参考依据', 'IEC 2023 依据', form);
    const sourceEditor = form.locator('.parameter-structured[data-field-path="/source"] details.parameter-source');
    await expect(sourceEditor).toBeVisible();
    if (await sourceEditor.getAttribute('open') === null) await sourceEditor.locator(':scope > summary').click();
    await field('来源', source, sourceEditor);
  }
  async function openNew(origin, title) {
    await dismissDialog();
    await page.goto(base + '/types?theme=light');
    await expect(page.locator('[data-type-page="list"][data-type-state="success"], [data-type-page="list"][data-type-state="empty"]')).toBeVisible();
    await page.getByRole('button', { name: '新建型号', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建型号设计', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: origin, exact: true }).check();
    await field('型号名称', title, dialog);
    return dialog;
  }
  async function create(dialog, origin) {
    const result = await responseFor('POST', '/api/types', () => dialog.getByRole('button', {
      name: origin === 'standard' ? '确认并建立草稿' : '建立草稿', exact: true,
    }).click());
    expect(typeof result.id).toBe('string');
    await expect(page).toHaveURL(new RegExp('/types/' + result.id + '/structure/section'));
    await expect(page.getByRole('navigation', { name: '型号浏览器', exact: true })).toBeVisible();
    check(`${origin} 起点保留真实来源且建立独立草稿`, result.type_creation?.kind === origin && result.type_lifecycle?.status === 'draft', {
      workspace: result.id, creation: result.type_creation, lifecycle: result.type_lifecycle,
    });
    await expectIdentity(result);
    return result;
  }
  async function expectIdentity(value) {
    const heading = page.locator('.topbar h1');
    await expect(heading).toContainText(value.domain.name);
    if (value.type_lifecycle?.name) await expect(heading).toContainText(value.type_lifecycle.name);
    check('页头同时保留真实型号与方案身份', await heading.evaluate(node => node.scrollWidth <= node.clientWidth + 1
      && node.scrollHeight <= node.clientHeight + 1), { model: value.domain.name, plan: value.type_lifecycle?.name, heading: await heading.innerText() });
  }
  async function module(label) {
    await dismissDialog();
    await page.getByRole('navigation', { name: '型号浏览器', exact: true }).getByRole('button', {
      name: new RegExp('^' + label),
    }).click();
    const result = {
      '结构 ·': 'structure', '标准核对': 'standard-check-results', '要求与标准': 'requirements-results',
      '电气参数': 'electrical-results', '短路容量': 'short-circuit-results',
      '载流量表': 'rating-table-results', '方案对比': 'comparison-results',
      '规格书': 'specification-results',
    }[label];
    const content = page.locator(`[data-type-page="${result}"]`).last();
    await expect(content).toBeVisible();
    await expect(content).not.toHaveAttribute('data-type-state', 'loading');
  }
  async function save(id) {
    if (await dirty()) await page.keyboard.press('Control+s');
    await savedState();
    return workspace(id);
  }
  async function savedState() {
    await expect(toolbar().locator('.command-state')).not.toContainText('未保存');
    await expect(page.getByText('结构修改待保存。', { exact: true })).toHaveCount(0);
    await expect(toolbar().locator('button[aria-busy="true"]')).toHaveCount(0);
  }
  async function command(label, required = false) {
    // Dialog dismissal restores the background accessibility tree after its
    // closing transition. Wait for the real toolbar before choosing an action.
    await expect(toolbar()).toBeVisible();
    let button = toolbar().getByRole('button', { name: label, exact: true });
    const more = toolbar().getByRole('button', { name: '更多操作', exact: true });
    if (required) await expect(button.or(more).first()).toBeVisible();
    if (await button.isVisible()) return button;
    if (await more.isVisible()) {
      await more.click();
      await expect(page.getByRole('menu')).toBeVisible();
      const item = page.getByRole('menuitem', { name: new RegExp('^' + label) });
      if (await item.isVisible()) return item;
      await page.keyboard.press('Escape');
    }
    return null;
  }
  async function run(label, resultPage, repairRejected) {
    await expect(page.locator(`[data-type-page="${resultPage}"]`)).not.toHaveAttribute('data-type-state', 'loading');
    const button = await command(label, true);
    if (!check(label + '可从当前页面启动', button && await button.isEnabled(), await visibleText())) return false;
    const [response] = await recordShortCircuitTransfer(label, () => Promise.all([
      page.waitForResponse(value => value.request().method() === 'GET'
        && /^\/api\/workspaces\/[^/]+\/studies\/[^/]+\/preflight$/.test(new URL(value.url()).pathname), { timeout: 90000 }),
      button.click(),
    ]));
    expect(response.ok()).toBeTruthy();
    const preflight = await response.json();
    (report.preflights ||= []).push({ label, ...size, path: new URL(response.url()).pathname, payload: preflight });
    const dialog = page.getByRole('dialog', { name: label + ' · 预检', exact: true });
    await expect(dialog).toBeVisible({ timeout: 90000 });
    if (!preflight.ready) {
      for (const trace of await dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^追溯$/ }) }).all()) {
        if (await trace.getAttribute('open') === null) await trace.locator(':scope > summary').click();
      }
    }
    await capture(label + '-真实预检');
    if (!preflight.ready && repairRejected && await repairRejected({ preflight, dialog })) return run(label, resultPage);
    const ack = dialog.getByRole('checkbox', { name: '已核对输入来源与方法适用范围', exact: true });
    if (!check(label + '通过真实预检', preflight.ready && await ack.isVisible(), { visible: await dialog.innerText(), preflight })) {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      return false;
    }
    await ack.check();
    await dialog.getByRole('button', { name: '确认并运行', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 180000 });
    await expect(page.locator(`[data-type-page="${resultPage}"]`)).toHaveAttribute('data-type-state', 'success', { timeout: 180000 });
    check(label + '取得当前保存结果', true);
    return true;
  }
  async function recordShortCircuitTransfer(label, action) {
    if (label !== '计算短路容量') return action();
    const sequence = (report.shortCircuitTransfers ||= []).length + 1;
    const prefix = `short-circuit-${size.width}-${tag}-${sequence}`;
    const trace = { label, ...size, files: [] }, writes = [];
    const onResponse = response => {
      const endpoint = new URL(response.url()).pathname;
      if (response.request().method() !== 'POST' || !/^\/api\/types\/[^/]+\/short-circuit-basis$/.test(endpoint)) return;
      const file = prefix + '-prepare-response.json';
      writes.push(response.text().then(raw => fs.writeFile(path.join(out, file), raw)));
      trace.files.push({ kind: 'raw preparation response', path: endpoint, status: response.status(), file });
    };
    const onRequest = request => {
      const endpoint = new URL(request.url()).pathname;
      if (request.method() !== 'POST' || !/^\/api\/workspaces\/[^/]+\/studies$/.test(endpoint)) return;
      const raw = request.postData();
      if (!raw || JSON.parse(raw).method?.capability !== 'short-circuit') return;
      const file = prefix + '-study-request.json';
      writes.push(fs.writeFile(path.join(out, file), raw));
      trace.files.push({ kind: 'actual UI study request', path: endpoint, file });
    };
    page.on('response', onResponse); page.on('request', onRequest);
    try { return await action(); }
    finally {
      page.off('response', onResponse); page.off('request', onRequest);
      await Promise.all(writes);
      report.shortCircuitTransfers.push(trace);
    }
  }
  const digest = value => createHash('sha256').update(value).digest('hex');
  async function savedNotationInputs(id) {
    const [saved, studies] = await Promise.all([workspace(id), api(`/api/workspaces/${id}/studies`)]);
    return {
      workspace: Object.fromEntries(['id', 'revision', 'domain', 'type_reference', 'type_creation', 'type_plan_source', 'type_lifecycle', 'resource_bindings']
        .filter(key => key in saved).map(key => [key, saved[key]])),
      studies: studies.map(({ id, revision, definition }) => ({ id, revision, definition })).sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
  async function notationGeometry(locator, token, iframe) {
    const result = await locator.evaluate((node, needle) => {
      const rect = value => ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height });
      const bounds = node.getBoundingClientRect(), style = getComputedStyle(node), runs = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode, parent = text.parentElement;
        if (!text.textContent?.trim() || !parent) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        const font = getComputedStyle(parent), matches = [];
        for (let start = text.textContent.indexOf(needle); start >= 0; start = text.textContent.indexOf(needle, start + needle.length)) {
          const match = document.createRange(); match.setStart(text, start); match.setEnd(text, start + needle.length);
          matches.push(...[...match.getClientRects()].map(rect));
        }
        runs.push({ text: text.textContent, fontSize: parseFloat(font.fontSize), fontFamily: font.fontFamily,
          lineHeight: font.lineHeight, rects: [...range.getClientRects()].map(rect), matches });
      }
      let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const ancestors = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/(hidden|auto|scroll|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
        if (/(hidden|auto|scroll|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
        ancestors.push({ tag: parent.tagName, className: parent.className, box: rect(box), overflowX: css.overflowX,
          overflowY: css.overflowY, clientWidth: parent.clientWidth, scrollWidth: parent.scrollWidth, scrollTop: parent.scrollTop });
      }
      return { text: node.textContent, html: node.outerHTML, bounds: rect(bounds), clip, runs, ancestors,
        fontSize: parseFloat(style.fontSize), lineHeight: style.lineHeight, whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        section: node.closest('[data-specification-section]')?.getAttribute('data-specification-section') || null };
    }, token);
    const absolute = await locator.boundingBox();
    if (!absolute) throw new Error('原文节点没有可采集的屏幕位置');
    const offset = { x: absolute.x - result.bounds.left, y: absolute.y - result.bounds.top };
    let outer = { left: 0, top: 0, right: size.width, bottom: size.height };
    if (iframe) outer = await iframe.evaluate(node => {
      const box = node.getBoundingClientRect();
      const clip = { left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(innerWidth, box.right), bottom: Math.min(innerHeight, box.bottom) };
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(hidden|auto|scroll|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, bounds.left); clip.right = Math.min(clip.right, bounds.right); }
        if (/(hidden|auto|scroll|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, bounds.top); clip.bottom = Math.min(clip.bottom, bounds.bottom); }
      }
      return clip;
    });
    const clip = { left: Math.max(outer.left, result.clip.left + offset.x), top: Math.max(outer.top, result.clip.top + offset.y),
      right: Math.min(outer.right, result.clip.right + offset.x), bottom: Math.min(outer.bottom, result.clip.bottom + offset.y) };
    const matches = result.runs.flatMap(run => run.matches).map(rect => ({ ...rect,
      left: rect.left + offset.x, right: rect.right + offset.x, top: rect.top + offset.y, bottom: rect.bottom + offset.y }));
    return { ...result, offset, viewportClip: clip, viewportMatches: matches,
      tokenFullyVisible: matches.length > 0 && matches.every(rect => rect.width > 0 && rect.height > 0
        && rect.left >= clip.left - 1 && rect.right <= clip.right + 1 && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1),
      minimumFontSize: Math.min(...result.runs.map(run => run.fontSize)),
      textWithinHorizontalBounds: result.runs.every(run => run.rects.every(rect => rect.left >= result.bounds.left - 1 && rect.right <= result.bounds.right + 1)) };
  }
  async function captureNotationEvidence(id, label, specification = false) {
    // Evidence is collected independently of the existing visible-name failure.
    // Scroll real controls only; rendered text, source HTML and inputs stay intact.
    const sequence = (report.notationEvidence ||= []).length + 1, prefix = `notation-${size.width}-${tag}-${sequence}`;
    const entry = { label, ...size, workspace: id, kind: specification ? 'formal-specification' : 'standard-result', files: [], targets: [] };
    report.notationEvidence.push(entry);
    const write = async (suffix, value) => {
      const file = prefix + suffix; await fs.writeFile(path.join(out, file), value); entry.files.push(file); return file;
    };
    const iframe = specification ? page.locator('iframe[title="正式规格书预览"]') : null;
    const surface = specification ? page.frameLocator('iframe[title="正式规格书预览"]') : page;
    let before, specBefore, frameBefore;
    try {
      before = await savedNotationInputs(id);
      await write('-saved-before.json', JSON.stringify(before, null, 2));
      await expect(surface.locator('body')).toBeVisible();
      await surface.locator('body').evaluate(async () => { await document.fonts.ready; });
      if (specification) {
        specBefore = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
        await write('-host-before.html', specBefore.html);
        await write('-specification-before.json', JSON.stringify(specBefore, null, 2));
        frameBefore = await iframe.getAttribute('srcdoc');
        await write('-iframe-before.html', frameBefore || '');
        await write('-iframe-aria.txt', await surface.locator('body').ariaSnapshot());
        await write('-iframe-text.txt', await surface.locator('body').textContent() || '');
      } else await write('-body-aria.txt', await page.locator('body').ariaSnapshot());
      for (const token of specification ? ['Case2/10', '附录 A/B'] : ['附录 A/B']) {
        const targets = surface.getByText(token, { exact: false });
        try { await expect(targets.first()).toBeAttached(); }
        catch (error) {
          entry.targets.push({ token, error: error.message });
          check(label + '保留原文 ' + token, false, { token, evidence: prefix, error: error.message }, { fatal: false });
          continue;
        }
        const count = await targets.count();
        check(label + '保留原文 ' + token, count > 0, { token, count, evidence: prefix }, { fatal: false });
        for (let index = 0; index < count; index++) {
          const target = targets.nth(index), item = { token, index }; entry.targets.push(item);
          try {
            await target.scrollIntoViewIfNeeded();
            let geometry = await notationGeometry(target, token, iframe);
            // A long table cell can exceed a viewport. Centre the actual token
            // with wheel input instead of moving or splitting its text nodes.
            for (let turn = 0; turn < 4 && !geometry.tokenFullyVisible; turn++) {
              const first = geometry.viewportMatches[0], clip = geometry.viewportClip;
              if (!first || clip.right <= clip.left || clip.bottom <= clip.top) break;
              const delta = (first.top + first.bottom - clip.top - clip.bottom) / 2;
              if (Math.abs(delta) < 1) break;
              await page.mouse.move((clip.left + clip.right) / 2, (clip.top + clip.bottom) / 2);
              await page.mouse.wheel(0, delta);
              try {
                await expect.poll(async () => (await notationGeometry(target, token, iframe)).viewportMatches[0]?.top,
                  { timeout: 3000 }).not.toBe(first.top);
              } catch { break; }
              geometry = await notationGeometry(target, token, iframe);
            }
            // The document preview intentionally disallows page scripts. Read
            // its geometry from the test runner instead of scheduling an rAF
            // callback inside that sandbox, which the browser must reject.
            let previousBounds;
            await expect.poll(async () => {
              const bounds = await target.boundingBox();
              const stable = Boolean(previousBounds && bounds && ['x', 'y', 'width', 'height']
                .every(key => Math.abs(bounds[key] - previousBounds[key]) < 1));
              previousBounds = bounds;
              return stable;
            }, { timeout: 3000 }).toBe(true);
            geometry = await notationGeometry(target, token, iframe);
            const shot = await capture(label + '-' + (token === 'Case2/10' ? '算例来源' : '附录诊断') + '-' + (index + 1));
            item.screenshot = shot.screenshot;
            item.geometry = await write(`-target-${entry.targets.length}.json`, JSON.stringify(geometry, null, 2));
            item.originalText = await write(`-target-${entry.targets.length}.txt`, geometry.text || '');
            check(label + '原文目标实际位于截图可视区 ' + token + '-' + (index + 1), geometry.tokenFullyVisible,
              { screenshot: shot.screenshot, geometry: item.geometry, clip: geometry.viewportClip, matches: geometry.viewportMatches }, { fatal: false });
            check(label + '原文字号与水平边界 ' + token + '-' + (index + 1), geometry.minimumFontSize >= 13 && geometry.textWithinHorizontalBounds,
              { screenshot: shot.screenshot, geometry: item.geometry, minimumFontSize: geometry.minimumFontSize }, { fatal: false });
          } catch (error) {
            item.error = error.message;
            const shot = await capture(label + '-原文定位失败-' + entry.targets.length).catch(() => null);
            item.screenshot = shot?.screenshot;
            check(label + '原文位置取证 ' + token + '-' + (index + 1), false, item, { fatal: false });
          }
        }
      }
    } catch (error) {
      entry.error = error.message;
      check(label + '独立原文取证', false, { error: error.message, evidence: prefix }, { fatal: false });
    } finally {
      try {
        const after = await savedNotationInputs(id);
        await write('-saved-after.json', JSON.stringify(after, null, 2));
        check(label + '滚动未改动保存输入引用及方法版本', Boolean(before) && JSON.stringify(after) === JSON.stringify(before),
          { before: prefix + '-saved-before.json', after: prefix + '-saved-after.json' }, { fatal: false });
        if (specification && specBefore) {
          const specAfter = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
          const frameAfter = await iframe.getAttribute('srcdoc');
          await write('-host-after.html', specAfter.html);
          await write('-specification-after.json', JSON.stringify(specAfter, null, 2));
          entry.htmlIdentity = { before: digest(specBefore.html), after: digest(specAfter.html),
            iframeBefore: digest(frameBefore || ''), iframeAfter: digest(frameAfter || ''), specificationDigest: specAfter.digest };
          check(label + '正式HTML与规格书版本原文未改写', specBefore.html === specAfter.html && frameBefore === frameAfter
            && specBefore.digest === specAfter.digest && JSON.stringify(specBefore.payload) === JSON.stringify(specAfter.payload)
            && JSON.stringify(specBefore.lifecycle) === JSON.stringify(specAfter.lifecycle), entry.htmlIdentity, { fatal: false });
        }
      } catch (error) {
        entry.identityError = error.message;
        check(label + '原文与保存身份回读', false, { error: error.message, evidence: prefix }, { fatal: false });
      }
      try {
        await write('-evidence.json', JSON.stringify(entry, null, 2));
        if (specification) {
          const cover = page.getByRole('navigation', { name: '规格书章节', exact: true }).getByRole('button').first();
          if (await cover.isVisible()) await cover.click();
        }
      } catch (error) {
        entry.finishError = error.message;
        check(label + '原文取证保存与章节恢复', false, { error: error.message, evidence: prefix }, { fatal: false });
      }
    }
  }
  function observeOriginalPdf(id, label) {
    const pending = [], responses = [], sequence = (report.pdfOriginalEvidence ||= []).length + 1;
    const prefix = `original-pdf-${size.width}-${tag}-${sequence}`;
    const onResponse = response => {
      const url = new URL(response.url());
      if (url.pathname !== `/api/types/${id}/specification/file`) return;
      const headers = response.headers();
      const item = { url: response.url(), status: response.status(), method: response.request().method(),
        requestIdentity: Object.fromEntries(url.searchParams),
        hostIdentity: { artifact: headers['x-artifact-sha256'], specification: headers['x-specification-sha256'], audience: headers['x-specification-audience'] } };
      responses.push(item);
      pending.push((async () => {
        try {
          const bytes = await response.body();
          item.file = prefix + '-' + responses.indexOf(item) + (response.ok() ? '.pdf' : '.txt');
          await fs.writeFile(path.join(out, item.file), bytes);
          item.bytes = bytes.length; item.sha256 = digest(bytes); item.pdf = bytes.subarray(0, 5).toString() === '%PDF-';
        } catch (error) { item.error = error.message; }
      })());
    };
    page.on('response', onResponse);
    return async downloaded => {
      page.off('response', onResponse); await Promise.all(pending);
      const evidence = { label, ...size, workspace: id, responses,
        status: downloaded ? 'downloaded' : 'no-download', explanation: downloaded ? '对照同次真实UI导出响应字节' : '本次真实流程没有下载PDF；保留原生成或下载失败，不另行绕过门槛。' };
      report.pdfOriginalEvidence.push(evidence);
      try {
        if (downloaded) {
          const bytes = await fs.readFile(downloaded); evidence.download = { file: path.basename(downloaded), bytes: bytes.length, sha256: digest(bytes) };
          const original = responses.find(item => item.pdf && item.sha256 === evidence.download.sha256
            && item.sha256 === item.hostIdentity.artifact && item.hostIdentity.specification === item.requestIdentity.specification_digest
            && item.hostIdentity.audience === item.requestIdentity.audience);
          evidence.identicalBytes = Boolean(original && bytes.equals(await fs.readFile(path.join(out, original.file))));
          check(label + '下载PDF与宿主原始响应逐字节一致', evidence.identicalBytes, evidence, { fatal: false });
        }
        await fs.writeFile(path.join(out, prefix + '.json'), JSON.stringify(evidence, null, 2));
      } catch (error) {
        evidence.error = error.message;
        check(label + 'PDF原始字节取证', false, { error: error.message, evidence: prefix }, { fatal: false });
      }
    };
  }
  async function generateSpecification(id, label, suffix, expectedIncomplete = false) {
    await module('规格书');
    await choose('文档版本', '客户版');
    await page.getByRole('tab', { name: '内容', exact: true }).click();
    await expect(page.getByTitle('正式规格书预览')).toBeVisible();
    await capture(label + '-生成前缺项与章节');
    if (suffix === 'teaching') await captureNotationEvidence(id, label + '-生成前原文', true);
    const generate = await command('生成规格书', true);
    if (!check(label + '有可启动的生成操作', generate && await generate.isEnabled(), await visibleText())) return;
    let download, downloaded;
    const finishPdfEvidence = observeOriginalPdf(id, label);
    const listener = item => { download = item; };
    page.on('download', listener);
    try {
      const response = await responseFor('POST', `/api/types/${id}/specification/generate`, () => generate.click(), 360000);
      await expect(page.locator('[data-type-page="specification-results"]')).not.toHaveAttribute('data-type-state', 'loading', { timeout: 180000 });
      if (expectedIncomplete) {
        const spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
        const mass = spec.payload.checks.find(item => item.id === 'geometry/mass' && item.blocking);
        check(label + '因真实材料密度或构造缺项拒绝客户交付', response.status === 'blocked' && response.channel === 'geometry'
          && response.details === '结构外径或用料缺少完整输入。' && !download
          && mass?.quantities?.some(row => row.quantity_missing?.includes('材料密度')), { response, blocker: mass });
        await capture(label + '-保留真实用料缺项');
        const repair = page.getByRole('button', { name: '查看结构推导条件', exact: true });
        await expect(repair).toBeVisible();
        await repair.click();
        await expect(page).toHaveURL(/\/structure\/quantities/);
        await expect(page.getByRole('table', { name: '外径与用料', exact: true })).toBeVisible();
        check(label + '拒绝后可定位结构用料缺项', true);
        return;
      }
      if (!check(label + '生成通过全部真实方法', response.status === 'generated', response)) {
        await capture(label + '-生成受阻的真实原因');
        const repair = page.getByRole('button', { name: /^查看.+条件$/ }).first();
        check(label + '生成受阻时给出可跳转的条件入口', await repair.isVisible(), await visibleText());
        return;
      }
      await expect.poll(() => Boolean(download), { timeout: 60000 }).toBe(true);
      const filename = path.join(out, `types-${size.width}-${tag}-${suffix}-customer.pdf`);
      await download.saveAs(filename);
      downloaded = filename;
      const bytes = await fs.readFile(filename);
      const spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
      check(label + '客户下载是有效PDF且引用五项当前结果', bytes.subarray(0, 5).toString() === '%PDF-'
        && spec.payload.sources.length === 5 && spec.payload.sources.every(source => source.freshness === 'current'), {
        file: path.basename(filename), bytes: bytes.length, sources: spec.payload.sources,
      });
    } finally {
      page.off('download', listener);
      await finishPdfEvidence(downloaded);
      if (suffix === 'teaching') await captureNotationEvidence(id, label + '-生成后原文', true);
    }
  }
  async function reviewSpecification(id, label, expectedIncomplete = false) {
    await module('规格书');
    await choose('文档版本', '客户版');
    await page.getByRole('tab', { name: '审核与发布', exact: true }).click();
    let spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
    const blockers = spec.payload.checks.filter(item => item.blocking === true);
    await capture(label + '-审核与发布清单');
    if (expectedIncomplete) {
      const mass = blockers.find(item => item.id === 'geometry/mass');
      const submit = page.getByRole('button', { name: '提交评审', exact: true });
      check(label + '保留真实用料缺项且禁止提交评审', !spec.ready && await submit.isDisabled()
        && mass?.message === '单位长度用料缺少完整材料密度或构造输入。'
        && mass?.quantities?.some(row => row.quantity_missing?.includes('材料密度')),
      { ready: spec.ready, blockers });
      for (const group of await page.locator('.type-review-groups > section > details').all()) {
        if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
      }
      const item = page.locator('[data-check-id="geometry/mass"]');
      await item.getByRole('button', { name: /^填写/ }).click();
      await expect(page).toHaveURL(/\/structure\/table.*field=/);
      const target = new URL(page.url()).searchParams.get('field');
      check(label + '审核缺项可定位真实密度或构造字段', /\/(?:density|lay_factor|tape_width|tape_count|tape_application)$/.test(target || ''), { target });
      await capture(label + '-审核缺项定位到结构字段');
      return;
    }
    if (!check(label + '满足当前声明范围的提交审核条件', spec.ready && blockers.length === 0, { ready: spec.ready, blockers, exclusions: spec.payload.release_exclusions || [] })) {
      const submit = page.getByRole('button', { name: '提交评审', exact: true });
      check(label + '校核未闭合时禁止发布并显示实际原因', await submit.isDisabled() && blockers.length > 0, await visibleText());
      return;
    }
    for (const action of ['采纳为版本草稿', '提交评审', '人工批准', '发布型号版本']) {
      const button = page.locator('.type-result-summary').getByRole('button', { name: action, exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      const dialog = page.getByRole('dialog', { name: action, exact: true });
      if (action === '提交评审') {
        await field('变更摘要', 'T1 隔离走查：核对固定来源、真实保存输入及计算结果；仅作为测试版本。', dialog);
        await field('编制人', 'T1 隔离走查', dialog);
      }
      await capture(label + '-' + action + '-确认前');
      await dialog.getByRole('checkbox', { name: '已核对当前版本与提交前校核清单', exact: true }).check();
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 90000 });
    }
    spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
    check(label + '人工审核发布闭环', spec.lifecycle.status === 'published', spec.lifecycle);
    await page.getByRole('tab', { name: '修订记录', exact: true }).click();
    await expect(page.getByRole('table', { name: '文档修订记录', exact: true })).toBeVisible();
  }

  async function declareTeachingScope(id) {
    await module('规格书');
    await choose('文档版本', '客户版');
    await page.getByRole('tab', { name: '审核与发布', exact: true }).click();
    const before = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
    const original = await workspace(id), declarations = new Map((before.payload.release_exclusions || [])
      .map(item => [item.check_id, item.reason])), captured = new Set();
    const row = key => page.locator('[data-check-id=' + JSON.stringify(key) + ']');
    const excluded = () => page.locator('[data-review-group="已声明不含"]');
    async function openChecks() {
      for (const detail of await page.locator('.type-review-groups > section > details').all()) {
        if (await detail.getAttribute('open') === null) await detail.locator(':scope > summary').click();
      }
    }
    await openChecks();
    // The interface, not a copied backend eligibility function, identifies the
    // items the engineer can explicitly exclude from this teaching delivery.
    const ids = await page.locator('[data-check-id]').filter({ has: page.locator('.type-scope-declaration') })
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-check-id')));
    expect(ids.length, '真实保存检查须有可声明的未量测或未覆盖项').toBeGreaterThan(0);
    const absentShort = before.payload.checks.find(item => item.id === 'short_circuit/missing' && item.blocking);
    if (absentShort) {
      await expect(row(absentShort.id).locator('.type-scope-declaration')).toHaveCount(0);
      check('短路缺少保存运行没有限定范围绕行入口', true, absentShort);
    }
    const initialBlocker = row(absentShort?.id || ids[0]);
    await initialBlocker.scrollIntoViewIfNeeded();
    await expect(initialBlocker, '限定范围前的真实阻断项完整进入截图视口').toBeInViewport({ ratio: 1 });
    await capture('教学交付-逐项限定范围前仍保留真实阻断');
    const endpoint = `/api/types/${id}/release-scope`;
    async function confirm(key, reason) {
      await openChecks();
      const item = row(key), disclosure = item.locator('.type-scope-declaration');
      await expect(disclosure).toBeVisible();
      if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click();
      const input = disclosure.getByRole('textbox', { name: /^不含原因：/ });
      const button = disclosure.getByRole('button', { name: '本人确认不含此项', exact: true });
      const writesBefore = report.writes.length;
      await input.fill('');
      await expect(button).toBeDisabled();
      await input.fill(reason); await input.press('Tab');
      await expect(button).toBeEnabled();
      expect(report.writes.length, '填写范围原因尚未执行确认或写入').toBe(writesBefore);
      const [response] = await Promise.all([
        page.waitForResponse(value => value.request().method() === 'POST' && new URL(value.url()).pathname === endpoint),
        button.click(),
      ]);
      expect(response.ok(), await response.text()).toBeTruthy();
      const request = response.request().postDataJSON(), receipt = await response.json();
      expect(request.human_confirmed).toBe(true);
      expect(request.expected_revision).toBe(original.revision);
      expect(response.request().headers()['x-cablesim-actor']).toBe('human');
      declarations.set(key, reason);
      expect(receipt.exclusions.map(item => item.check_id).sort()).toEqual([...declarations.keys()].sort());
      expect(receipt.exclusions.find(item => item.check_id === key)?.reason).toBe(reason);
      await expect(item).toHaveCount(0);
      await expect(excluded().getByText(reason, { exact: false })).toBeVisible();
      return receipt;
    }
    for (const [index, key] of ids.entries()) {
      const checkRow = before.payload.checks.find(item => item.id === key), result = checkRow?.result;
      expect(checkRow?.blocking).toBe(true);
      expect(['failed', 'fail'].includes(result?.status) || ['failed', 'fail'].includes(result?.verdict)
        || result?.satisfied === false, '不满足结果不能被范围声明移除').toBe(false);
      const title = result?.title || checkRow.message;
      const category = result?.basis === 'measurement' ? '尚无实测记录'
        : ['uncovered', 'not_applicable'].includes(result?.status || result?.verdict) ? '方法未覆盖' : '工程条件未完备';
      const reason = category === '尚无实测记录'
        ? `本次隔离教学交付不含“${title}”的出厂检验合格证明；尚无同一试样的实测记录，不以设计值代替。`
        : category === '方法未覆盖'
          ? `本次隔离教学交付不含“${title}”的保证值或符合性结论；保存方法未覆盖此项，须以适用方法与证据另行核对。`
          : `本次隔离教学交付不含“${title}”的符合性结论；设计条件或依据尚不完整，须补齐并重新核对后另行交付。`;
      const receipt = await confirm(key, reason);
      if (!captured.has(category)) {
        const declared = excluded().locator('.type-review-item').filter({ hasText: reason });
        await declared.scrollIntoViewIfNeeded();
        await expect(declared, category + '的已保存声明完整进入截图视口').toBeInViewport({ ratio: 1 });
        await capture('教学交付-明确声明不含-' + category); captured.add(category);
      }
      if (index === 0) {
        const saved = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
        const active = saved.payload.checks.find(item => item.id === key);
        expect(active).toMatchObject({ excluded: true, blocking: false, exclusion_reason: reason, result });
        const decision = excluded().locator('.type-review-item').filter({ hasText: reason });
        await responseFor('POST', endpoint, () => decision.getByRole('button', { name: '撤销声明', exact: true }).click());
        declarations.delete(key);
        await expect(row(key)).toHaveCount(1); await openChecks();
        await expect(row(key)).toBeVisible();
        const restored = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
        expect(restored.payload.checks.find(item => item.id === key)).toEqual(checkRow);
        expect(restored.payload.release_exclusions.some(item => item.check_id === key)).toBe(false);
        check('撤销限定范围恢复原检查阻断及完整证据', true, { check: key, original: checkRow });
        await row(key).scrollIntoViewIfNeeded();
        await expect(row(key), '撤销后恢复的原检查项完整进入截图视口').toBeInViewport({ ratio: 1 });
        await capture('教学交付-撤销不含声明后恢复原缺项');
        await confirm(key, reason);
      }
      (report.scopeDeclarations ||= []).push({ ...size, workspace: id, revision: original.revision,
        check: key, category, reason, original: checkRow, receipt: receipt.exclusions.find(item => item.check_id === key) });
    }
    const after = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
    expect(after.payload.sources).toEqual(before.payload.sources);
    expect(after.payload.results).toEqual(before.payload.results);
    expect(after.payload.document).toEqual(before.payload.document);
    expect(after.lifecycle.status).toBe(before.lifecycle.status);
    for (const checkRow of before.payload.checks) {
      const current = after.payload.checks.find(item => item.id === checkRow.id), reason = declarations.get(checkRow.id);
      expect(current).toEqual(reason ? { ...checkRow, excluded: true, blocking: false, exclusion_reason: reason } : checkRow);
    }
    expect(after.payload.release_exclusions.length).toBe(declarations.size);
    for (const audience of ['customer', 'internal']) {
      const specification = audience === 'customer' ? after : await api(`/api/types/${id}/specification?audience=internal&view=detail`);
      const documentText = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.textContent, specification.html);
      expect(documentText).toContain('本次发布不含项');
      for (const reason of declarations.values()) expect(documentText).toContain(reason);
    }
    const current = await workspace(id);
    expect(current.revision).toBe(original.revision);
    expect(current.domain).toEqual(original.domain);
    if (absentShort) {
      expect(after.payload.checks.find(item => item.id === absentShort.id)).toEqual(absentShort);
      expect(after.ready).toBe(false);
      await expect(page.getByRole('button', { name: '提交评审', exact: true })).toBeDisabled();
      check('逐项限定范围仍保留短路缺运行并阻止客户发布', true, { remaining: after.payload.checks.filter(item => item.blocking) });
    }
    check('限定交付逐项回读且未改写输入结果或批准状态', true, { workspace: id, revision: current.revision,
      count: declarations.size, categories: [...captured], remaining: after.payload.checks.filter(item => item.blocking).map(item => item.id) });
    await page.reload();
    await expect(page.locator('[data-type-page="specification-results"]')).not.toHaveAttribute('data-type-state', 'loading');
    await page.getByRole('tab', { name: '审核与发布', exact: true }).click();
    await expect(excluded().locator('.type-review-item')).toHaveCount(declarations.size);
    await openChecks();
    // Remaining blockers and a long declaration list need separate viewports.
    const remaining = after.payload.checks.filter(item => item.blocking);
    if (remaining.length) {
      const blocker = row(absentShort?.id || remaining[0].id);
      await blocker.scrollIntoViewIfNeeded();
      await expect(blocker, '重载后的剩余阻断详情完整进入截图视口').toBeInViewport({ ratio: 1 });
      await capture('教学交付-重载保留真实剩余阻断详情');
    }
    const decisions = excluded().locator('.type-review-item');
    const declarationHeader = excluded().locator(':scope > header');
    await declarationHeader.scrollIntoViewIfNeeded();
    await expect(declarationHeader, '声明分组及数量完整进入截图视口').toBeInViewport({ ratio: 1 });
    await capture('教学交付-重载保留声明分组和数量');
    await decisions.first().scrollIntoViewIfNeeded();
    await expect(decisions.first(), '重载后的首项声明完整进入截图视口').toBeInViewport({ ratio: 1 });
    await capture('教学交付-重载保留逐项声明首项');
    if (declarations.size > 1) {
      await decisions.last().scrollIntoViewIfNeeded();
      await expect(decisions.last(), '重载后的末项声明完整进入截图视口').toBeInViewport({ ratio: 1 });
      await capture('教学交付-重载保留逐项声明末项');
    }
  }

  if (report.phase === 'after') {
    const owners = await api('/api/workspaces');
    const archives = await Promise.all(owners.map(owner => api(`/api/workspaces/${owner.id}/deliveries`)));
    const count = archives.reduce((sum, items) => sum + items.length, 0);
    (report.deliveryEmptyStarts ||= []).push({ ...size, scope: 'global', applicable: count === 0, archivedCount: count,
      reason: count ? '保留已有真实交付，不清库制造全局空态；本尺寸仍验证新型号的自然空态。' : '本次隔离库尚无交付。' });
    if (count === 0) await attempt('00-空交付可从真实型号目录开始', async () => {
      const writesBefore = report.writes.length;
      await page.goto(base + '/deliveries?theme=light');
      await expect(page.getByRole('heading', { name: '还没有交付', exact: true })).toBeVisible();
      await expect(page.locator('.button-primary:visible')).toHaveCount(1);
      await expect(page.getByRole('button', { name: '选择研究', exact: true })).toHaveClass(/button-primary/);
      const start = page.getByRole('button', { name: '选择型号', exact: true });
      await expect(start).toBeVisible();
      await expect(start).not.toHaveClass(/button-primary/);
      await capture('交付-全局自然空态与两条起步入口');
      await start.click();
      await page.waitForURL(next => next.pathname === '/types' && next.searchParams.get('theme') === 'light');
      await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
      const afterArchives = await Promise.all(owners.map(owner => api(`/api/workspaces/${owner.id}/deliveries`)));
      check('全局空交付可用鼠标进入真实型号目录且没有生成交付', report.writes.length === writesBefore
        && afterArchives.every(items => items.length === 0), { writes: report.writes.slice(writesBefore), owners: owners.length });
    });
    const sources = await attempt('00a-读取已有型号运行并辨识保存类型', async () => {
      await page.goto(base + '/runs?theme=light');
      await expect(page.getByRole('table', { name: '运行', exact: true })).toBeVisible();
      return fixedTypeSources();
    });
    for (const [module, target] of Object.entries(fixedTypeRoutes)) {
      const source = sources?.find(item => item.module === module);
      if (!source) {
        (report.fixedTypeRunNavigation ||= []).push({ ...size, module, applicable: false, status: 'cloud-unverified',
          reason: '当前隔离库没有完整性通过且包含对应保存工件的原型号运行；未创建或替换种子。' });
        check(target.label + '固定运行入口云端有可验证原种子', false, { status: 'cloud-unverified', module }, { fatal: false });
        continue;
      }
      await attempt('00b-' + target.label + '从真实运行目录与旧链接回到固定只读结果', () => verifyFixedTypeNavigation(source));
    }
  }
  const options = await api('/api/types/creation-options');
  await attempt('01-型号列表与批量操作入口', async () => {
    await page.goto(base + '/types?theme=light');
    await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
    await expect(page.getByRole('button', { name: '新建型号', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: '查找型号', exact: true })).toBeVisible();
    await field('查找型号', 'YJV22');
    await expect(page.getByRole('table', { name: '型号', exact: true })).toContainText('YJV22');
    await capture('型号列表-真实筛选');
    await field('查找型号', '');
    const table = page.getByRole('table', { name: '型号', exact: true });
    check('型号列表可选择多个型号批量操作', await table.getByRole('checkbox').count() > 1, await visibleText());
  });
  await attempt('01a-已有执行版本声明且零批准的型号键鼠往返目录与详情', verifyDeclaredSeedNavigation);

  const library = await attempt('02-从真实型号库引用建立草稿', async () => {
    const dialog = await openNew('从型号库复制', name('库引用'));
    const source = options.library.find(item => /YJV22/.test(item.name) && /300/.test(item.name)) || options.library[0];
    if (!check('库引用起点可开始', Boolean(source), await dialog.innerText())) return null;
    await choose('型号版本', source.name + ' · ' + versionLabel(source.version), dialog);
    await capture('库引用-固定型号版本与来源');
    const created = await create(dialog, 'library');
    const next = await primary('标准核对', '新建型号的已保存结构页');
    await expect(next).toBeEnabled();
    const writesBefore = report.writes.length;
    await next.click();
    await expect(page).toHaveURL(new RegExp('/types/' + created.id + '/standard-check/results'));
    await primary('执行标准核对', '结构下一步进入标准核对页');
    const afterNavigation = await workspace(created.id);
    check('结构下一步只导航而不自动保存计算或批准', afterNavigation.revision === created.revision
      && JSON.stringify(afterNavigation.domain) === JSON.stringify(created.domain)
      && report.writes.length === writesBefore, { workspace: created.id, writes: report.writes.slice(writesBefore) });
    await capture('结构下一步-真实进入标准核对且未自动运行');
    await module('结构 ·');
    await primary('标准核对', '返回已保存结构页');
    return created;
  });

  if (report.phase === 'after' && library) await attempt('02a-新型号空交付打开同一规格书', async () => {
    const before = await workspace(library.id), beforeArchives = await api(`/api/workspaces/${library.id}/deliveries`);
    expect(beforeArchives).toEqual([]);
    const typeIndex = await api('/api/design/type-workspaces');
    expect(typeIndex.some(item => item.id === library.id)).toBe(true);
    const writesBefore = report.writes.length;
    await page.locator('.workbench-sidebar').getByRole('link', { name: '交付', exact: true }).click();
    await page.waitForURL(next => next.pathname === '/deliveries');
    await choose('所属', before.domain.name);
    await expect(page.getByRole('heading', { name: '这个型号还没有交付', exact: true })).toBeVisible();
    const start = page.getByRole('button', { name: '打开型号规格书', exact: true });
    await expect(page.locator('.button-primary:visible')).toHaveCount(1);
    await expect(start).toHaveClass(/button-primary/);
    await expect(page.getByRole('button', { name: '打开工程研究', exact: true })).toHaveCount(0);
    await capture('交付-新型号自然空态和真实规格书入口');
    await start.click();
    await page.waitForURL(next => next.pathname === `/types/${library.id}/specification/content`
      && next.searchParams.get('theme') === 'light');
    await expect(page.locator('[data-type-page="specification-results"]')).toHaveAttribute('data-type-state', /^(?:empty|historical|success)$/);
    const specification = await api(`/api/types/${library.id}/specification?audience=customer&view=detail`);
    expect(specification.payload.workspace_id).toBe(library.id);
    expect(specification.payload.revision).toBe(before.revision);
    await expectIdentity(before);
    await expect(page.getByRole('button', { name: '生成规格书', exact: true })).toBeVisible();
    await capture('交付-入口只打开同一型号规格书且未生成');
    const after = await workspace(library.id), afterArchives = await api(`/api/workspaces/${library.id}/deliveries`);
    check('新型号空交付明确打开本型号规格书且零保存零计算零交付', after.revision === before.revision
      && JSON.stringify(after.domain) === JSON.stringify(before.domain) && afterArchives.length === 0 && report.writes.length === writesBefore,
    { workspace: library.id, revision: after.revision, specificationDigest: specification.digest, writes: report.writes.slice(writesBefore) });
    (report.deliveryEmptyStarts ||= []).push({ ...size, scope: 'type', applicable: true, workspace: library.id, archivedCount: 0 });
    await module('结构 ·');
    await primary('标准核对', '交付入口返回已保存结构页');
  });

  let editFixture;
  await attempt('02b-键盘修改型号名称并核对保存与取消', async () => {
    // Keep this editable fixture independent of the calculation model, whose
    // original missing provenance must remain available to the rating check.
    const dialog = await openNew('从型号库复制', name('名称与来源编辑'));
    const source = options.library.find(item => /YJV22/.test(item.name) && /300/.test(item.name)) || options.library[0];
    if (!check('名称与来源编辑有真实独立起点', Boolean(source), await dialog.innerText())) return;
    await choose('型号版本', source.name + ' · ' + versionLabel(source.version), dialog);
    editFixture = await create(dialog, 'library');
    const before = await workspace(editFixture.id), title = name('名称已编辑');
    const opener = page.getByRole('button', { name: '修改型号名称', exact: true });
    await opener.click();
    const rename = page.getByRole('dialog', { name: '修改型号名称', exact: true });
    const input = rename.getByRole('textbox', { name: '新的型号名称', exact: true });
    await expect(input).toHaveValue(before.domain.name);
    await input.fill(title);
    await input.press('Enter');
    await expect(rename).toBeHidden();
    await expect.poll(dirty).toBe(true);
    await primary('保存', '型号名称编辑后');
    const uncommitted = await workspace(editFixture.id);
    check('确认名称仅修改草稿而不隐式保存', uncommitted.revision === before.revision
      && JSON.stringify(uncommitted.domain) === JSON.stringify(before.domain), { workspace: before.id, revision: before.revision });
    await capture('型号名称-键盘确认后的未保存草稿');
    const saved = await save(editFixture.id);
    const nameSource = { kind: 'user', reference: '工程师在型号工作区填写', reviewed: false };
    // A real name edit adds its own unreviewed provenance. Every other field,
    // source and fixed reference must remain exactly as it was before the edit.
    expect(saved.domain).toEqual({ ...before.domain, name: title,
      provenance: { ...before.domain.provenance, '/name': nameSource } });
    expect(saved.type_lifecycle?.name).toBe(before.type_lifecycle?.name);
    check('型号名称经键盘保存后真实回读且方案身份不变', saved.domain.name === title && saved.revision > before.revision, {
      workspace: saved.id, before: before.domain.name, after: saved.domain.name,
      revision: saved.revision, plan: saved.type_lifecycle?.name,
    });
    await expectIdentity(saved);
    const typeIndex = await api('/api/design/type-workspaces');
    expect(typeIndex.find(row => row.id === saved.id)?.name).toBe(title);
    const currentLink = page.getByRole('complementary', { name: '导航', exact: true })
      .locator('a.tree-object[aria-current="page"]');
    await expect(currentLink).toHaveCount(1);
    await expect(currentLink).toHaveText(title);
    await expect(currentLink).toHaveAttribute('title', title);
    await expect(currentLink).toBeInViewport({ ratio: 1 });
    expect(new URL(await currentLink.getAttribute('href'), base).pathname).toBe(`/types/${saved.id}/structure/table`);
    check('保存改名后当前导航立即采用真实目录名称', true, { workspace: saved.id,
      name: title, source: saved.domain.provenance['/name'], href: await currentLink.getAttribute('href') });
    await primary('标准核对', '型号名称真实保存后');
    await capture('型号名称-真实保存与独立方案身份');

    await opener.click();
    await expect(input).toHaveValue(title);
    await input.fill(name('取消的名称'));
    await input.press('Escape');
    await expect(rename).toBeHidden();
    await expect(opener).toBeFocused();
    await expect.poll(dirty).toBe(false);
    const cancelled = await workspace(editFixture.id);
    check('取消改名未写入保存版本且焦点返回原入口', cancelled.revision === saved.revision
      && JSON.stringify(cancelled.domain) === JSON.stringify(saved.domain), { workspace: saved.id, revision: cancelled.revision });
    await expect(page.locator('.topbar h1')).toContainText(title);
    await primary('标准核对', 'Escape取消名称编辑后');
    await capture('型号名称-Escape取消且焦点返回入口');

    await module('方案对比');
    await expect(page.locator('[data-type-page="comparison-results"]')).not.toHaveAttribute('data-type-state', 'loading');
    const comparisonPrimary = await page.getByRole('button', { name: '采纳为新版本草稿', exact: true }).isVisible()
      ? '采纳为新版本草稿' : '建立方案';
    await primary(comparisonPrimary, '比较页已保存状态');
    const comparisonWrites = report.writes.length;
    await opener.click();
    await input.fill(name('比较页未保存名称'));
    await input.press('Enter');
    await expect(rename).toBeHidden();
    await expect.poll(dirty).toBe(true);
    await primary('保存', '比较页有未保存输入时');
    await capture('方案对比-未保存输入以保存为唯一主操作');
    await (await command('撤销')).click();
    await expect.poll(dirty).toBe(false);
    await primary(comparisonPrimary, '比较页撤销未保存输入后');
    const comparisonCancelled = await workspace(editFixture.id);
    check('比较页取消输入不写入保存版本或自动建立方案', comparisonCancelled.revision === saved.revision
      && JSON.stringify(comparisonCancelled.domain) === JSON.stringify(saved.domain) && report.writes.length === comparisonWrites,
    { workspace: saved.id, revision: comparisonCancelled.revision, writes: report.writes.slice(comparisonWrites) });
    await capture('方案对比-取消后恢复方案主操作');
  });

  await attempt('02c-结构来源逐字录入保存并撤销未保存修改', async () => {
    if (!check('结构来源编辑使用独立创建的真实型号', Boolean(editFixture))) return;
    await page.goto(base + '/types/' + editFixture.id + '/structure/table?theme=light');
    await expect(layers()).toBeVisible();
    const before = await workspace(editFixture.id), cable = before.domain.cable_types[0];
    const reference = before.type_creation?.source?.references?.['/cable_type']?.reference;
    if (!check('结构来源录入有真实型号版本出处', typeof reference === 'string' && Boolean(reference.trim()), {
      workspace: before.id, origin: before.type_creation?.source,
    })) return;
    const escape = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
    const sourcePath = '/cable_types/' + escape(cable.id);
    const editor = page.locator('.type-structure-source');
    if (await editor.getAttribute('open') === null) await editor.locator(':scope > summary').press('Enter');
    const input = editor.getByRole('textbox', { name: '型号结构来源', exact: true });
    await expect(input).toBeVisible();
    const previousText = await input.inputValue();
    // If the same citation is already present, a trailing line break exercises
    // the editor without inventing a different engineering source.
    const enteredReference = previousText === reference ? reference + '\n' : reference;
    await input.fill(enteredReference);
    await input.press('Tab');
    await expect.poll(dirty).toBe(true);
    await primary('保存', '结构来源未保存时');
    const uncommitted = await workspace(editFixture.id);
    check('来源录入仅进入草稿且未自动批准或保存', uncommitted.revision === before.revision
      && JSON.stringify(uncommitted.domain) === JSON.stringify(before.domain), { workspace: before.id, path: sourcePath });
    const undo = await command('撤销');
    expect(undo, '结构来源有可用的撤销入口').not.toBeNull();
    await undo.click();
    await expect.poll(dirty).toBe(false);
    await expect(input).toHaveValue(previousText);
    await primary('标准核对', '撤销结构来源编辑后');
    const cancelled = await workspace(editFixture.id);
    check('撤销来源编辑恢复原出处且保存修订未改变', cancelled.revision === before.revision
      && JSON.stringify(cancelled.domain) === JSON.stringify(before.domain), { workspace: before.id, revision: cancelled.revision });
    await input.scrollIntoViewIfNeeded();
    await capture('型号结构来源-撤销未保存编辑后保留原出处');

    await input.fill(enteredReference);
    await input.press('Tab');
    await expect.poll(dirty).toBe(true);
    const saved = await save(editFixture.id), source = saved.domain.provenance[sourcePath];
    await primary('标准核对', '结构来源真实保存后');
    expect({ ...saved.domain, provenance: before.domain.provenance }).toEqual(before.domain);
    for (const [key, value] of Object.entries(before.domain.provenance || {})) {
      if (key !== sourcePath) expect(saved.domain.provenance[key]).toEqual(value);
    }
    expect(saved.type_resource_bindings).toEqual(before.type_resource_bindings);
    check('结构来源真实保存且物性逐字段来源与固定引用保持', saved.revision > before.revision
      && source.kind === 'user' && source.reviewed === false && source.reference === enteredReference, {
      workspace: saved.id, revision: saved.revision, path: sourcePath, originalReference: reference, saved: source,
    });
    (report.structureEditSources ||= []).push({ ...size, workspace: saved.id, revision: saved.revision,
      path: sourcePath, originalReference: reference, enteredReference, saved: source });
    await page.reload();
    await expect(layers()).toBeVisible();
    if (await editor.getAttribute('open') === null) await editor.locator(':scope > summary').press('Enter');
    await expect(input).toHaveValue(enteredReference);
    await input.scrollIntoViewIfNeeded();
    await capture('型号结构来源-重载后保留真实全文与待核对状态');
  });

  await attempt('03-从零建立型号并通过缺项定位填写截面', async () => {
    const dialog = await openNew('空白', name('从零'));
    await choose('结构类型', '单芯', dialog);
    const blank = await create(dialog, 'blank');
    const before = await api('/api/types/' + encodeURIComponent(blank.id) + '/workspace'), writesBefore = report.writes.length;
    expect(before.domain.provenance?.['/execution_standards'], '真实空白型号尚未保存执行版本声明').toBeUndefined();
    try {
      await activate(page.getByRole('navigation', { name: '对象', exact: true }).getByRole('link', { name: '型号设计', exact: true }), true);
      const row = await catalogDeclaration(before, [], '空白型号-目录真实未声明', true);
      await activate(row.locator('button.object-link'), true);
      await page.waitForURL(url => url.pathname === '/types/' + encodeURIComponent(blank.id) + '/structure/section');
    } finally {
      const after = await api('/api/types/' + encodeURIComponent(blank.id) + '/workspace');
      const evidence = { ...size, workspace: blank.id, origin: 'blank', revision: before.revision,
        domainSha256: createHash('sha256').update(JSON.stringify(before.domain)).digest('hex'),
        afterDomainSha256: createHash('sha256').update(JSON.stringify(after.domain)).digest('hex'),
        afterRevision: after.revision, declaration: after.domain.provenance?.['/execution_standards'] ?? null, writes: report.writes.slice(writesBefore) };
      (report.typeDeclarationNavigation ||= []).push(evidence);
      check('空白型号目录未声明核对未写入且保留原修订领域输入', report.writes.length === writesBefore
        && after.revision === before.revision && JSON.stringify(after.domain) === JSON.stringify(before.domain)
        && after.domain.provenance?.['/execution_standards'] === undefined, evidence, { fatal: false });
    }
    await expect(page.getByRole('region', { name: '型号缺项', exact: true })).toBeVisible();
    await capture('从零-缺项与可开始的操作');
    await page.getByRole('button', { name: '芯 1 · 导体截面', exact: true }).click();
    const input = page.getByRole('textbox', { name: '标称截面', exact: true });
    await expect(input).toBeFocused();
    await field('标称截面', '70');
    const saved = await save(blank.id);
    check('缺项定位后可以键盘录入并保存真实截面', saved.domain.cable_types[0].cores[0].conductor.nominal_area === 70e-6, {
      workspace: blank.id, nominal_area: saved.domain.cable_types[0].cores[0].conductor.nominal_area,
    });
  });

  const standard = await attempt('04-按标准生成完整护层提案并确认', async () => {
    const dialog = await openNew('按标准生成', name('标准提案'));
    await choose('生成范围', '完整护层 · 核对附录依据', dialog);
    await choose('结构类型', '单芯', dialog);
    await choose('额定电压', '0.6/1 kV', dialog);
    await choose('导体材料', '铜', dialog);
    await field('导体截面', '70', dialog);
    await choose('导体几何', '等截面积实心圆 · 理想化', dialog);
    await choose('半导电屏蔽', '无半导电屏蔽层', dialog);
    await choose('护层构造', 'PVC 挤包内衬 + PVC 外护套', dialog);
    await dialog.getByRole('button', { name: '生成结构提案', exact: true }).click();
    await expect(dialog.getByRole('region', { name: '结构提案', exact: true })).toBeVisible({ timeout: 90000 });
    await dialog.getByText('提案范围与缺项', { exact: true }).click();
    await capture('标准提案-标准值推导条件和缺项');
    await expect(dialog.getByRole('button', { name: '确认并建立草稿', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: '已核对标准值、推导条件与缺项', exact: true }).check();
    return create(dialog, 'standard');
  });

  await attempt('04b-批量建立方案下载审核稿并核对真实门禁', async () => {
    if (!check('批量走查具有两个独立的真实创建对象', Boolean(library && standard))) return;
    const sources = await Promise.all([workspace(library.id), workspace(standard.id)]);
    await page.goto(base + '/types?theme=light');
    await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
    const preview = page.getByRole('button', { name: '预览批量操作', exact: true });
    await expect(preview).toBeDisabled();
    check('未选择型号时批量入口说明开始方式', (await visibleText()).includes('先勾选列表中的型号，再预览操作。'));
    const sourceRow = id => page.locator(`[id="row-型号-${id}"]`);
    const first = sourceRow(sources[0].id).getByRole('checkbox');
    await first.focus(); await page.keyboard.press('Space'); await expect(first).toBeChecked();
    await sourceRow(sources[1].id).getByRole('checkbox').check();
    await choose('批量操作', '建立方案'); await preview.click();
    let dialog = page.locator('.type-batch-dialog');
    await expect(page.getByRole('dialog', { name: '建立方案 · 操作预览', exact: true })).toBeVisible();
    await expect(dialog.locator('[data-batch-state="ready"]')).toHaveCount(2);
    const requested = sources.map((source, index) => ({ source, name: name('批量方案' + (index + 1)) }));
    for (const entry of requested) {
      const input = dialog.locator(`[data-batch-workspace="${entry.source.id}"]`).getByRole('textbox', { name: /^新方案名称：/ });
      await input.fill(entry.name); await input.press('Tab');
    }
    const acknowledge = () => dialog.getByRole('checkbox', { name: '已核对所选对象与操作内容，同意执行勾选项。', exact: true });
    const confirm = dialog.getByRole('button', { name: '确认建立方案（2 项）', exact: true });
    await expect(confirm).toBeDisabled(); await acknowledge().check();
    await capture('批量方案-真实对象与新方案名确认');
    const responses = await Promise.all([
      ...requested.map(entry => page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/types/${entry.source.id}/plans`, { timeout: 180000 })),
      confirm.click(),
    ]);
    const copies = [];
    for (let index = 0; index < requested.length; index++) {
      expect(responses[index].ok()).toBeTruthy();
      const result = await responses[index].json(), copied = await workspace(result.workspace_id), original = await workspace(requested[index].source.id);
      check('批量方案' + (index + 1) + '真实建立且保留原型号', copied.id !== original.id
        && copied.type_lifecycle?.name === requested[index].name && copied.type_lifecycle?.status === 'draft'
        && JSON.stringify(copied.domain) === JSON.stringify(requested[index].source.domain)
        && original.revision === requested[index].source.revision && JSON.stringify(original.domain) === JSON.stringify(requested[index].source.domain), { source: original.id, copy: copied.id, lifecycle: copied.type_lifecycle });
      copies.push(copied);
    }
    await expect(dialog.locator('[data-batch-state="success"]')).toHaveCount(2);
    await capture('批量方案-两项真实执行结果');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    for (const copied of copies) {
      await field('查找型号', copied.type_lifecycle.name);
      await expect(sourceRow(copied.id)).toContainText('方案：' + copied.type_lifecycle.name);
      await expect(sourceRow(copied.id).getByRole('button', { name: copied.domain.name, exact: true })).toBeVisible();
    }
    check('列表重载后可按实际方案名查找并区分对象', true);
    await capture('批量方案-重载后按真实方案名查找');
    await field('查找型号', '');
    for (const copied of copies) await sourceRow(copied.id).getByRole('checkbox').check();
    await choose('批量操作', '下载规格书'); await choose('批量文档版本', '内部审核版'); await preview.click();
    dialog = page.locator('.type-batch-dialog');
    await expect(dialog.locator('[data-batch-state="ready"]')).toHaveCount(2);
    await acknowledge().check();
    const downloads = [], onDownload = download => downloads.push(download);
    page.on('download', onDownload);
    try {
      await dialog.getByRole('button', { name: '确认下载规格书（2 项）', exact: true }).click();
      await expect(dialog.locator('[data-batch-state="success"]')).toHaveCount(2, { timeout: 180000 });
      await expect.poll(() => downloads.length, { timeout: 60000 }).toBe(2);
      for (let index = 0; index < downloads.length; index++) {
        const filename = path.join(out, `types-${size.width}-${tag}-batch-internal-${index + 1}.pdf`);
        await downloads[index].saveAs(filename);
        const bytes = await fs.readFile(filename);
        check('批量内部审核稿' + (index + 1) + '实际下载有效PDF', bytes.subarray(0, 5).toString() === '%PDF-', { file: path.basename(filename), bytes: bytes.length });
      }
    } finally { page.off('download', onDownload); }
    await capture('批量下载-两份内部审核PDF与逐项结果');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(dialog).toBeHidden();
    await choose('批量操作', '生成规格书'); await choose('批量文档版本', '客户版'); await preview.click();
    await expect(dialog.locator('[data-batch-state="ready"]')).toHaveCount(2);
    await expect(dialog.locator('.type-batch-scope')).toHaveCount(2);
    for (const scope of await dialog.locator('.type-batch-scope').all()) {
      await expect(scope).toHaveAttribute('open', '');
      for (const channel of ['结构与用料', '电气参数', '载流量表', '短路容量', '标准核对']) await expect(scope).toContainText(channel);
    }
    await dialog.getByRole('checkbox', { name: '已核对各型号的补算范围与保存条件，同意预检通过后计算。', exact: true }).check();
    await capture('批量生成-明确核对五通道补算范围');
    const generated = await Promise.all([
      ...copies.map(copied => page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/types/${copied.id}/specification/generate`, { timeout: 360000 })),
      dialog.getByRole('button', { name: '确认生成规格书（2 项）', exact: true }).click(),
    ]);
    for (let index = 0; index < copies.length; index++) {
      expect(generated[index].ok()).toBeTruthy();
      const result = await generated[index].json();
      check('批量缺项对象' + (index + 1) + '仅因真实用料缺项停止', result.status === 'blocked' && result.channel === 'geometry'
        && result.details === '结构外径或用料缺少完整输入。', result);
    }
    await expect(dialog.locator('[data-batch-state="failed"]')).toHaveCount(2);
    check('批量生成逐项显示真实拒绝并保留修正入口', await dialog.getByRole('button', { name: '查看相关输入', exact: true }).count() === 2);
    await capture('批量生成-保留两项真实用料缺项与定位入口');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(dialog).toBeHidden();
    await choose('批量操作', '提交审核'); await preview.click();
    await expect(dialog.locator('[data-batch-state="blocked"]')).toHaveCount(2);
    check('批量审核保留人工采纳门禁并说明每项原因', await dialog.getByText('请先在方案对比中采纳为新版本草稿。', { exact: true }).count() === 2
      && await dialog.getByRole('button', { name: '确认提交审核', exact: true }).isDisabled());
    await capture('批量审核-未采纳草稿的真实门禁与修正入口');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(dialog).toBeHidden();
  });

  const main = library || standard;
  if (!check('至少一个真实起点进入后续型号设计', Boolean(main), '型号库引用与标准提案均未建立草稿')) return;
  await page.goto(base + `/types/${main.id}/structure/section?theme=light`);
  await expect(layers()).toBeVisible();

  await attempt('05-尺寸编辑撤销重做与前端校核', async () => {
    const before = await workspace(main.id);
    const inputs = layers().getByRole('textbox', { name: '绝缘厚度', exact: true });
    const input = inputs.first();
    await expect(input).toBeVisible();
    const original = await input.inputValue();
    const changed = (Number(original) + 0.1).toFixed(3);
    await input.fill(changed);
    await input.press('Tab');
    await expect(toolbar().locator('.command-state')).toContainText('未保存');
    check('编辑时不隐式写入保存版本', (await workspace(main.id)).revision === before.revision);
    await capture('结构编辑-未保存的尺寸');
    check('单个尺寸和其来源合并为一处未保存', /^1 处未保存$/.test(await toolbar().locator('.command-state').innerText()), await visibleText());
    const problem = page.locator('[data-geometry-problem]').filter({ visible: true }).first();
    const located = check('几何重叠以中文说明并提供真实位置入口', await problem.isVisible()
      && /芯\s*2/.test(await problem.innerText()) && await problem.getByRole('button', { name: /^定位芯\s*2位置$/ }).isVisible(), await visibleText());
    if (located) {
      await problem.getByRole('button', { name: /^定位芯\s*2位置$/ }).click();
      await expect(page).toHaveURL(/\/structure\/table.*field=/);
      const target = new URL(page.url()).searchParams.get('field');
      await expect.poll(() => page.locator(':focus').evaluate(element => element.closest('[data-field-path]')?.getAttribute('data-field-path'))).toBe(target);
      const focused = await page.locator(':focus').evaluate(element => element.closest('[data-field-path]')?.getAttribute('data-field-path'));
      check('几何错误定位到对应芯位置输入', /\/cores\/[^/]+\/x$/.test(target || '') && focused === target, { target, focused });
      await capture('结构编辑-中文错误定位真实芯位置');
    }
    // Blur the editor: Ctrl+Z must undo a design command, not an input's text.
    await page.getByRole('navigation', { name: '型号浏览器', exact: true }).click({ position: { x: 12, y: 12 } });
    await page.keyboard.press('Control+z');
    await expect(input).toHaveValue(original);
    const redo = await command('重做');
    const hasRedo = check('结构修改有可操作的重做入口', redo && await redo.isEnabled(), await visibleText());
    if (hasRedo) {
      await redo.click();
      await expect.poll(async () => Number(await input.inputValue())).toBe(Number(changed));
      await capture('结构编辑-撤销后重做');
    }
    // The three-core reference has fixed source positions: increasing one
    // insulation thickness can overlap another core. Retain the real preview
    // error, but do not PUT an intentionally invalid document. The first before
    // artifact preserves the rejected save; following steps need clean input.
    if (await dirty()) {
      const undo = await command('撤销');
      await expect(undo).toBeEnabled();
      await undo.click();
    }
    await expect(input).toHaveValue(original);
    await expect.poll(dirty).toBe(false);
    check('撤销恢复原保存尺寸且未写入非法几何', (await workspace(main.id)).revision === before.revision);
    await capture('结构编辑-撤销恢复合法保存输入');
  });

  await attempt('05b-合法尺寸编辑保存并撤销保存版本', async () => {
    await module('结构 ·');
    const before = await workspace(main.id);
    const input = layers().getByRole('textbox', { name: '绝缘厚度', exact: true }).first();
    const original = await input.inputValue();
    // A small reduction leaves the source's fixed core centres unchanged and
    // avoids the overlap seen in the first walk. This is an isolated edit only.
    const changed = Math.max(Number(original) - 0.1, Number(original) * 0.9).toFixed(3);
    await input.fill(changed);
    await input.press('Tab');
    const second = layers().getByRole('textbox', { name: '绝缘厚度', exact: true }).nth(1);
    let secondOriginal, secondChanged;
    if (before.domain.cable_types[0].cores.length > 1) {
      secondOriginal = await second.inputValue();
      secondChanged = Math.max(Number(secondOriginal) - 0.1, Number(secondOriginal) * 0.9).toFixed(3);
      await second.fill(secondChanged); await second.press('Tab');
      check('两处尺寸编辑准确显示两处未保存', (await toolbar().locator('.command-state').innerText()) === '2 处未保存', await visibleText());
      await page.getByRole('navigation', { name: '型号浏览器', exact: true }).click({ position: { x: 12, y: 12 } });
      await page.keyboard.press('Control+z');
      await expect(second).toHaveValue(secondOriginal);
      await expect.poll(async () => Number(await input.inputValue())).toBe(Number(changed));
      check('逐步撤销只恢复最后一处尺寸', (await toolbar().locator('.command-state').innerText()) === '1 处未保存');
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(async () => Number(await second.inputValue())).toBe(Number(secondChanged));
      check('键盘重做恢复刚撤销的尺寸', (await toolbar().locator('.command-state').innerText()) === '2 处未保存');
      await capture('结构编辑-两处修改逐步撤销并重做');
    }
    await save(main.id);
    await expect.poll(async () => (await workspace(main.id)).revision).toBeGreaterThan(before.revision);
    await capture('结构编辑-合法尺寸已保存');
    const undo = await command('撤销');
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(input).toHaveValue(original);
    await expect.poll(async () => (await workspace(main.id)).domain).toEqual(before.domain);
    check('尺寸可保存且撤销保留原工程输入与来源', true);
    const redo = await command('重做');
    await expect(redo).toBeEnabled(); await redo.click();
    await expect.poll(async () => Number(await input.inputValue())).toBe(Number(changed));
    if (secondOriginal !== undefined) await expect.poll(async () => Number(await second.inputValue())).toBe(Number(secondChanged));
    check('已保存型号版本也可通过真实服务重做', (await workspace(main.id)).revision > before.revision);
    await capture('结构编辑-保存版本重做');
    await (await command('撤销')).click();
    await expect.poll(async () => (await workspace(main.id)).domain).toEqual(before.domain);
    await expect(input).toHaveValue(original);
  });

  await attempt('06-添加结构层并查找删除入口', async () => {
    await module('结构 ·');
    const doc = (await workspace(main.id)).domain;
    const material = doc.materials.find(item => ['insulation', 'sheath', 'polymer'].includes(item.category))
      || doc.materials.find(item => /XLPE|PVC|聚乙烯|聚氯乙烯/.test(item.label));
    if (!check('新增层可选择本型号真实材料', Boolean(material), doc.materials.map(item => ({ name: item.label, category: item.category })))) return;
    await page.getByRole('button', { name: '添加结构层', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加结构层', exact: true });
    await choose('所属位置', '共同层', dialog);
    await choose('结构层', '隔离层', dialog);
    await choose('新层材料', material.label, dialog);
    await field('新层厚度', '0.2', dialog);
    await choose('新层构造', '挤包或连续层', dialog);
    await dialog.getByRole('button', { name: '添加到草稿', exact: true }).click();
    await expect(dialog).toBeHidden();
    const added = layers().getByRole('row').filter({ hasText: '隔离层' });
    await expect(added).toHaveCount(1);
    await added.click();
    await expectIdentity(await workspace(main.id));
    await capture('结构编辑-新层与属性');
    const remove = page.getByRole('button', { name: /删除(?:所选)?结构层|删除(?:所选)?层|移除(?:所选)?层/ }).first();
    const canRemove = check('新加的结构层有删除入口', await remove.isVisible(), await visibleText());
    if (canRemove) {
      await remove.click();
      const deletion = page.getByRole('dialog', { name: '删除结构层', exact: true });
      await expect(deletion).toBeVisible();
      await deletion.getByRole('button', { name: '删除', exact: true }).click();
      await expect(deletion).toBeHidden();
      await expect(added).toHaveCount(0);
      const undo = await command('撤销', true);
      if (!check('删除新增层后仍可撤销', undo && await undo.isEnabled(), await visibleText())) return;
      await expect(page.getByRole('heading', { name: '外护套', exact: true })).toBeVisible();
      const materialReference = page.getByRole('combobox', { name: '材料引用', exact: true });
      await expect(materialReference).toBeVisible();
      await expect(materialReference.locator(':scope > span:not([data-select-arrow])')).toBeVisible();
      const materialWidth = await materialReference.evaluate(control => {
        const selected = control.querySelector(':scope > span:not([data-select-arrow])');
        const rect = control.getBoundingClientRect();
        return { text: selected.textContent.trim(), scrollWidth: selected.scrollWidth, clientWidth: selected.clientWidth,
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      });
      check('外护套材料引用控件完整位于视口内', materialWidth.left >= 0 && materialWidth.top >= 0
        && materialWidth.right <= materialWidth.viewportWidth && materialWidth.bottom <= materialWidth.viewportHeight, materialWidth);
      check('外护套材料引用已选文字完整显示且无截断', Boolean(materialWidth.text) && materialWidth.clientWidth > 0
        && materialWidth.scrollWidth <= materialWidth.clientWidth + 1, materialWidth);
      await capture('结构编辑-删除新增层后仍可撤销');
      await undo.click();
      await expect(added).toHaveCount(1);
      const redo = await command('重做', true);
      await expect(redo).toBeEnabled(); await redo.click();
      await expect(added).toHaveCount(0);
      check('删除结构层可撤销重做且恢复后没有虚假修改', !await dirty(), await visibleText());
      await capture('结构编辑-删除层撤销重做后恢复原结构');
    } else {
      const undo = await command('撤销');
      if (undo && await undo.isEnabled()) await undo.click();
    }
    await expect(added).toHaveCount(0);
    await save(main.id);
  });

  await attempt('07-标准核对与不满足项定位', async () => {
    await module('标准核对');
    if (!await run('执行标准核对', 'standard-check-results')) return;
    const table = page.getByRole('table', { name: '标准核对', exact: true });
    await expect(table).toBeVisible();
    const issues = table.getByRole('row').filter({ hasText: /不满足|待补|缺项|不适用|未覆盖/ });
    check('标准核对结果逐项可读', await table.getByRole('row').count() > 1, await table.innerText());
    await readableResultColumns('标准核对');
    await capture('标准核对-真实结果');
    if (await issues.count()) {
      await issues.first().click();
      const locate = page.getByRole('button', { name: '定位结构层', exact: true });
      const repair = issues.first().getByRole('button').first();
      if (await locate.isVisible()) {
        await locate.click();
        await expect(page).toHaveURL(/\/structure\/table.*layer=/);
        await expect(layers().getByRole('row', { selected: true })).toBeVisible();
        check('标准核对不满足项可定位到结构层', true);
      } else if (await repair.isVisible()) {
        const from = page.url();
        await repair.click();
        await expect.poll(() => page.url()).not.toBe(from);
        check('标准核对缺项有真实修正入口', true, await visibleText());
      } else check('标准核对不满足项可定位修正', false, await visibleText());
    } else check('本次标准结果没有需要定位的不满足项', true, '当前真实输入全部通过；没有伪造不满足结果。');
  });

  for (const analysis of [
    { module: '电气参数', result: 'electrical-results', inputs: [['工作温度', '90'], ['频率', '50']] },
    { module: '短路容量', result: 'short-circuit-results', inputs: [['持续时间', '1'], ['初始绝对温度', '90'], ['导体最终温度', '250']] },
  ]) {
    await attempt(`08-${analysis.module}-填写方法条件并运行`, async () => {
      await module(analysis.module);
      await page.getByRole('tab', { name: '方法参数', exact: true }).click();
      await primary('试算', analysis.module + '方法参数未编辑时');
      // Units come from the installed method contract: degrees C, Hz and seconds.
      // These are explicit isolated teaching conditions, not manufacturer evidence.
      for (const [label, value] of analysis.inputs) await field(label, value);
      if (analysis.module === '电气参数') {
        const cable = (await workspace(main.id)).domain.cable_types[0];
        if (cable.rating?.u0) await field('运行相电压', cable.rating.u0);
        await advanced(page.locator('.type-method-fields'));
        for (const label of ['集肤效应系数', '邻近效应系数', '成缆绞入系数']) await field(label, '1');
        await choose('R₂₀ 长度基准', '成品电缆长度');
        if (cable.cores.length === 3) await choose('相间排列', '品字排列');
        // The steel-armour reference cannot be declared non-magnetic. Leave
        // that branch and unsupported impedance explicitly unresolved.
      } else {
        await choose('金属容量校核口径', '绝热容量');
      }
      await primary('保存', analysis.module + '方法参数有未保存修改时');
      await capture(analysis.module + '-明示教学方法条件');
      await page.getByRole('button', { name: '保存方法条件', exact: true }).click();
      await savedState();
      await primary('试算', analysis.module + '方法参数保存后');
      await page.getByRole('tab', { name: '结果', exact: true }).click();
      if (!await run('计算' + analysis.module, analysis.result)) return;
      const table = page.getByRole('table', { name: analysis.module, exact: true });
      await expect(table).toBeVisible();
      check(analysis.module + '显示保存的计算项与缺项原因', await table.getByRole('row').count() > 1, await table.innerText());
      await table.getByRole('row').nth(1).click();
    });
  }

  await attempt('09-建立载流量工况表并运行', async () => {
    await module('载流量表');
    await page.getByRole('button', { name: '添加工况', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加工况', exact: true });
    const caseName = '25°C 直埋教学工况 ' + tag;
    await field('工况名称', caseName, dialog);
    const three = (await workspace(main.id)).domain.cable_types[0].cores.length === 3;
    await choose('工况排列', three ? '三芯直埋 · 单回' : '直埋 · 品字', dialog);
    await field('交流频率 / Hz', '50', dialog);
    await dialog.getByRole('button', { name: '添加到工况表', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 90000 });
    await page.getByText('所选工况条件 · ' + caseName, { exact: true }).click();
    for (const [label, value] of [['环境温度', '25'], ['中心埋深', '1'], ['土壤热阻率', '1'], ['中心距', '0.2']]) {
      await field(caseName + ' ' + label, value);
    }
    await field('条件来源', 'T1 隔离走查明示教学条件：25°C、埋深 1 m、土壤热阻率 1 K·m/W、中心距 0.2 m；不是工程现场实测或批准数据。');
    await choose('接地', '两端接地');
    await save(main.id);
    const conditionSummary = page.getByRole('table', { name: '载流量表', exact: true })
      .getByRole('row', { name: caseName, exact: true }).locator('.type-rating-condition > summary');
    await expect(conditionSummary).toHaveText('25.0 °C · 1.00 m');
    await conditionSummary.scrollIntoViewIfNeeded();
    const conditionLayout = await conditionSummary.evaluate(node => {
      const box = node.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
      return { text: node.textContent, font: parseFloat(getComputedStyle(node).fontSize),
        complete: rects.length > 0 && rects.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1
          && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1),
        inView: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth };
    });
    check('工况摘要完整显示温度和埋深', conditionLayout.complete && conditionLayout.inView && conditionLayout.font >= 13, conditionLayout);
    await capture('载流量表-工况与来源已保存');
    await page.getByRole('tab', { name: '方法参数', exact: true }).click();
    const teaching = await teachingDesign();
    expect(teaching, '方法条件须能追溯到发布种子的教学型号').toBeTruthy();
    const teachingSeed = teaching.seed;
    const parameters = teaching.studies.find(item => item.definition.driver.kind === 'batch'
      && /教学/.test(item.definition.parameters?.source || ''))?.definition.parameters;
    const source = `T1 隔离走查：复用发布教学型号 ${teachingSeed.name} 已保存的方法参数（${parameters.source}）；直埋工况未启用排管分支，管内参数仅按方法合同保留，非现场测量或批准数据。`;
    await fillRatingParameters(parameters, source);
    (report.ratingSources ||= []).push({ ...size, copy: main.id, source: teachingSeed.id, parameters });
    const beforeSave = (await api(`/api/workspaces/${main.id}/studies`))
      .filter(item => item.definition.driver.kind === 'batch').sort((a, b) => b.created.localeCompare(a.created))[0];
    expect(beforeSave, '新增工况已经保存，方法条件仍是未保存草稿').toBeTruthy();
    await verifyRatingParameterControls({ wid: main.id, sid: beforeSave.id, draftSource: source });
    await save(main.id);
    const ratingStudy = (await api(`/api/workspaces/${main.id}/studies`))
      .filter(item => item.definition.driver.kind === 'batch').sort((a, b) => b.created.localeCompare(a.created))[0];
    expect(ratingStudy?.definition.parameters).toMatchObject({ ...parameters, source });
    check('载流量方法条件与明确教学来源已保存', ratingStudy?.definition.parameters.ks === 1
      && ratingStudy?.definition.parameters.kp === 1
      && /T1 隔离走查/.test(ratingStudy?.definition.input_sources?.['/parameters/ks']?.reference || ''), ratingStudy?.definition);
    await capture('载流量表-方法参数与来源已保存');
    await page.getByRole('tab', { name: '结果表', exact: true }).click();
    if (!await run('计算所选工况', 'rating-table-results', async ({ preflight, dialog }) => {
      const before = await workspace(main.id), cable = before.domain.cable_types[0];
      const escape = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
      const sourcePath = '/cable_types/' + escape(cable.id);
      const backendPaths = ['/provenance/' + escape('/cable_types/' + cable.id), '/provenance/' + escape(sourcePath)];
      const errors = preflight.cases.filter(item => item.status !== 'succeeded').map(item => item.error);
      const sourceGap = errors.length > 0 && errors.every(error => error?.code === 'DOMAIN_NOT_SUPPORTED'
        && backendPaths.includes(error.path)
        && error.message === 'provenance/cable_types：三芯尺寸、成缆绞距、屏蔽电阻与铠装绕包需可追溯来源；请补齐型号来源。');
      if (!sourceGap) return false;
      const source = before.type_creation?.source?.references?.['/cable_type'];
      if (!source?.reference?.trim()) return false;
      const locate = dialog.getByRole('button', { name: '填写型号结构来源', exact: true });
      if (!check('载流量结构来源缺项能定位真实出处字段', await locate.isVisible(), { errors, source })) return false;
      await locate.click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/structure\/table.*field=/);
      const input = page.getByRole('textbox', { name: '型号结构来源', exact: true });
      await expect(input).toBeFocused();
      check('缺失结构来源保持空白且没有自动确认', await input.inputValue() === '', { sourcePath });
      await capture('载流量表-缺项定位到型号结构来源');
      // Copy the original catalogue snapshot verbatim. It explicitly labels the
      // model as standard-derived; no manufacturer measurement is invented.
      await input.fill(source.reference);
      await input.press('Tab');
      await save(main.id);
      const after = await workspace(main.id);
      expect(after.domain.provenance[sourcePath]).toEqual({ kind: 'user', reference: source.reference, reviewed: false });
      expect({ ...after.domain, provenance: before.domain.provenance }).toEqual(before.domain);
      for (const [key, value] of Object.entries(before.domain.provenance)) if (key !== sourcePath) expect(after.domain.provenance[key]).toEqual(value);
      (report.structureSources ||= []).push({ ...size, workspace: main.id, path: sourcePath,
        originalSource: before.type_creation.source, enteredReference: source.reference, saved: after.domain.provenance[sourcePath] });
      check('结构出处经真实UI保存且原尺寸与逐字段来源保留', true, { sourcePath, revision: after.revision, reference: source.reference });
      await capture('载流量表-保留原始来源全文与待核对状态');
      await module('载流量表');
      return true;
    })) return;
    const table = page.getByRole('table', { name: '载流量表', exact: true });
    const currentStudy = (await api(`/api/workspaces/${main.id}/studies`))
      .filter(item => item.definition.driver.kind === 'batch').sort((a, b) => b.created.localeCompare(a.created))[0];
    const current = (await api(`/api/workspaces/${main.id}/studies/${currentStudy.id}/runs`)).items
      .filter(item => item.freshness === 'current' && item.integrity === 'verified').sort((a, b) => b.created.localeCompare(a.created))[0];
    const results = current && await api(`/api/design/workspaces/${main.id}/rating-table-runs/${current.id}`);
    const value = results?.rows.find(row => row.name === caseName);
    check('载流量表显示当前工况的真实正电流', Boolean(value && value.value_a > 0)
      && (await table.innerText()).includes(caseName), { row: value, visible: await table.innerText() });
  });

  await attempt('10-缺项草稿拒绝客户交付并定位真实缺项', () => generateSpecification(main.id, '缺项草稿规格书', 'incomplete', true));

  await attempt('10b-预览章节并下载保留缺项的内部审核稿', async () => {
    await module('规格书');
    await choose('文档版本', '内部审核版');
    await expect(page.getByTitle('正式规格书预览')).toBeVisible();
    const before = await api(`/api/types/${main.id}/specification?audience=internal&view=detail`);
    const chapters = page.getByRole('navigation', { name: '规格书章节', exact: true });
    const frame = page.getByTitle('正式规格书预览');
    await expect.poll(() => frame.evaluate(node => node.contentDocument?.readyState)).toBe('complete');
    await expect(page.frameLocator('iframe[title="正式规格书预览"]').locator('[data-specification-section="cover"]')).toBeVisible();
    // Observe actual rendering while a person reads the unchanged document.
    // No source/result is substituted, and the original browser API is restored.
    const previewObservation = await frame.evaluateHandle(node => {
      const original = DOMParser.prototype.parseFromString;
      const observation = { node, document: node.contentDocument, source: node.srcdoc, parses: 0, loads: 0 };
      const loaded = () => observation.loads++;
      node.addEventListener('load', loaded);
      DOMParser.prototype.parseFromString = function(source, type) {
        if (type === 'text/html' && String(source).includes('data-specification-section')) observation.parses++;
        return original.call(this, source, type);
      };
      return { observation, restore: () => { DOMParser.prototype.parseFromString = original; node.removeEventListener('load', loaded); } };
    });
    const readingWrites = report.writes.length;
    try {
      const structureChapter = chapters.getByRole('button', { name: '结构尺寸表', exact: true });
      await structureChapter.click();
      await expect(structureChapter).toHaveAttribute('aria-current', 'page');
      await expect(page.frameLocator('iframe[title="正式规格书预览"]').locator('[data-specification-section="structure"]')).toBeVisible();
      const coverChapter = chapters.getByRole('button', { name: '封面', exact: true });
      await coverChapter.focus(); await coverChapter.press('Enter');
      await expect(coverChapter).toHaveAttribute('aria-current', 'page');
      await structureChapter.focus(); await structureChapter.press('Enter');
      await expect(structureChapter).toHaveAttribute('aria-current', 'page');
      await capture('规格书-内部审核稿结构章节与缺项');
      const retained = await previewObservation.evaluate(({ observation: value }) => ({
        sameElement: value.node === document.querySelector('iframe[title="正式规格书预览"]'),
        sameDocument: value.node.contentDocument === value.document, sameSource: value.node.srcdoc === value.source,
        parses: value.parses, loads: value.loads,
      }));
      check('规格书章节鼠标与键盘往返复用同一原文与预览，不重复解析或写入',
        retained.sameElement && retained.sameDocument && retained.sameSource && retained.parses === 0
        && retained.loads === 0 && report.writes.length === readingWrites, { ...retained, writes: report.writes.slice(readingWrites) });
    } finally {
      await previewObservation.evaluate(value => value.restore());
      await previewObservation.dispose();
    }
    const finishPdfEvidence = observeOriginalPdf(main.id, '内部审核稿');
    let downloaded;
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 180000 }),
        page.getByRole('button', { name: '导出内部审核稿', exact: true }).click(),
      ]);
      const filename = path.join(out, `types-${size.width}-${tag}-internal.pdf`);
      await download.saveAs(filename); downloaded = filename;
      const bytes = await fs.readFile(filename);
      const after = await api(`/api/types/${main.id}/specification?audience=internal&view=detail`);
      check('内部审核稿下载是有效PDF且保留原校核与生命周期', bytes.subarray(0, 5).toString() === '%PDF-'
        && after.ready === before.ready && after.lifecycle.status === before.lifecycle.status
        && JSON.stringify(after.payload.checks) === JSON.stringify(before.payload.checks), {
        file: path.basename(filename), bytes: bytes.length, ready: after.ready,
        blockers: after.payload.checks.filter(item => item.blocking).map(item => item.id),
      });
    } finally { await finishPdfEvidence(downloaded); }
    await expect(page.locator('[data-type-page="specification-results"]')).not.toHaveAttribute('data-type-state', 'loading');
    const currentChapter = chapters.locator('button[aria-current="page"]');
    await expect(currentChapter).toHaveCount(1);
    await expect(currentChapter).toHaveAttribute('aria-label', '封面');
    const coverHeading = page.frameLocator('iframe[title="正式规格书预览"]')
      .locator('[data-specification-section="cover"]').getByRole('heading', { name: '产品规格书', exact: true });
    await expect(coverHeading).toBeInViewport({ ratio: 1 });
    const bounds = await coverHeading.boundingBox(), dockBounds = await page.locator('.workbench-dock-body').boundingBox();
    const navigationBounds = await page.locator('.type-specification-navigation').boundingBox();
    check('内部审核稿导出后封面正文与当前章节一致', Boolean(bounds && dockBounds && navigationBounds
      && bounds.y >= Math.max(dockBounds.y, navigationBounds.y + navigationBounds.height)
      && bounds.y + bounds.height <= dockBounds.y + dockBounds.height
      && bounds.x >= dockBounds.x && bounds.x + bounds.width <= dockBounds.x + dockBounds.width), {
      chapter: await currentChapter.getAttribute('aria-label'),
      heading: await coverHeading.innerText(), bounds, dockBounds, navigationBounds,
    });
    await expect(chapters.getByRole('button', { name: '结构尺寸表', exact: true })).not.toHaveAttribute('aria-current', 'page');
    await capture('规格书-内部审核稿导出后封面与章节一致');
  });

  await attempt('11-缺项草稿保留审核门禁并定位字段', () => reviewSpecification(main.id, '缺项草稿规格书', true));

  await attempt('12-建立独立改版方案并保留原型号', async () => {
    await module('方案对比');
    const original = await workspace(main.id);
    await page.getByRole('button', { name: '建立方案', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '建立独立型号方案', exact: true });
    await field('方案名称', name('改版'), dialog);
    const branch = await responseFor('POST', `/api/types/${main.id}/plans`, () => dialog.getByRole('button', { name: '建立方案', exact: true }).click());
    expect(branch.workspace_id).not.toBe(main.id);
    await expect(page).toHaveURL(new RegExp('/types/' + branch.workspace_id + '/structure/section'));
    await expect(layers()).toBeVisible();
    const branched = await workspace(branch.workspace_id);
    const source = await workspace(main.id);
    check('独立改版可编辑且不改变原保存型号', branched.type_lifecycle?.status === 'draft' && source.revision === original.revision, {
      source: main.id, originalRevision: original.revision, savedRevision: source.revision,
      branch: branch.workspace_id, lifecycle: branched.type_lifecycle,
    });
    check('独立改版在详情中以真实方案名区分', branched.type_lifecycle?.name === name('改版')
      && (await page.locator('.topbar h1').innerText()).includes(name('改版')), {
      requested: name('改版'), plan: branched.type_lifecycle?.name, model: branched.domain.name, original: original.domain.name,
    });
    await expectIdentity(branched);
    const input = layers().getByRole('textbox', { name: '绝缘厚度', exact: true }).first();
    const originalValue = Number(await input.inputValue());
    const revisedValue = Math.max(originalValue - 0.1, originalValue * 0.9).toFixed(3);
    await input.fill(revisedValue);
    await input.press('Tab');
    await save(branch.workspace_id);
    await expect.poll(async () => (await workspace(branch.workspace_id)).revision).toBeGreaterThan(branched.revision);
    const originalAfterEdit = await workspace(main.id);
    check('独立方案修改保存不回写原型号', originalAfterEdit.revision === original.revision
      && JSON.stringify(originalAfterEdit.domain) === JSON.stringify(original.domain));
    await capture('改版-独立修改已保存且原型号保留');
    await module('方案对比');
    await page.getByRole('tab', { name: '参数差异', exact: true }).click();
    const differences = page.getByRole('table', { name: '方案参数差异', exact: true });
    await expect(differences.getByRole('row').filter({ hasText: /芯 1.*绝缘.*厚度/ })).toBeVisible();
    check('改版比较显示真实保存的厚度差异', (await differences.innerText()).includes(revisedValue)
      && (await differences.innerText()).includes(originalValue.toFixed(3)), await differences.innerText());
    check('多方案比较表与完整方案标题在当前宽度内可读', await differences.evaluate(table => {
      const box = table.getBoundingClientRect();
      return [...table.querySelectorAll('th')].every(cell => cell.scrollWidth <= cell.clientWidth + 1)
        && box.right <= innerWidth && [...(function* () { for (let node = table.parentElement; node; node = node.parentElement) yield node; })()]
          .filter(node => /auto|scroll|hidden/.test(getComputedStyle(node).overflowX))
          .every(node => node.scrollWidth <= node.clientWidth + 1);
    }), await differences.innerText());
    await primary('采纳为新版本草稿', '已有独立改版的比较页');
    await capture('改版-原型号与独立方案参数对比');
  });

  // This is a separate design object. The manufacturer's library copy above
  // intentionally retains its missing densities and manufacturing facts.
  // Read the release demo's saved teaching conditions, then enter them through
  // real forms in an independent plan. No evidence or approval is fabricated.
  const delivery = await attempt('13-打开来源完整的教学型号并建立独立交付方案', async () => {
    const teaching = await teachingDesign();
    if (!check('发布种子提供独立的三芯教学型号', Boolean(teaching), '按真实型号名、非方案副本及已保存教学条件定位原始种子')) return null;
    const { seed, original, studies } = teaching;
    const conditions = parameters => parameters && Object.fromEntries(Object.entries(parameters)
      .filter(([key]) => !['basis_references', 'cable_type_id', 'circuit_id'].includes(key)));
    const electrical = conditions(studies.find(item => item.definition.parameters?.temperature_k
      && item.definition.parameters?.core_lay_factor && item.definition.parameters?.sources)?.definition.parameters);
    const short = conditions(studies.find(item => item.definition.parameters?.duration_s
      && item.definition.parameters?.metal_initial_temperature_k && item.definition.parameters?.sources)?.definition.parameters);
    const rating = studies.find(item => item.definition.driver.kind === 'batch'
      && /教学/.test(item.definition.parameters?.source || ''))?.definition;
    const cable = original.domain.cable_types[0];
    const used = new Set([...cable.cores.flatMap(core => [core.conductor.material, ...core.layers.map(layer => layer.material)]),
      ...cable.common_layers.map(layer => layer.material)]);
    const densities = original.domain.materials.filter(material => used.has(material.id)).map(material => ({ label: material.label, density: material.density }));
    if (!check('教学型号保存完整密度及可追溯的计算条件', densities.length > 0 && densities.every(material => material.density > 0)
      && electrical && short && rating && Object.values(electrical.sources).every(value => /教学/.test(value))
      && Object.values(short.sources).every(value => /教学/.test(value)), { source: seed, densities, electrical, short, rating: rating?.parameters })) return null;
    await page.goto(base + '/types?theme=light');
    await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
    await field('查找型号', seed.name);
    await page.locator(`[id="row-型号-${seed.id}"]`).getByRole('button', { name: seed.name, exact: true }).click();
    await expect(layers()).toBeVisible();
    await capture('教学交付-已保存的来源完整型号');
    await module('方案对比');
    await page.getByRole('button', { name: '建立方案', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '建立独立型号方案', exact: true });
    const title = name('教学交付副本');
    await field('方案名称', title, dialog);
    const branch = await responseFor('POST', `/api/types/${seed.id}/plans`, () => dialog.getByRole('button', { name: '建立方案', exact: true }).click());
    await expect(page).toHaveURL(new RegExp('/types/' + branch.workspace_id + '/structure/section'));
    await expect(layers()).toBeVisible();
    // The plan name distinguishes this copy; preserve its engineering model
    // identity, geometry and source facts for the genuine calculation workflow.
    const copied = await workspace(branch.workspace_id), source = await workspace(seed.id);
    check('教学交付副本独立保存且保留源型号和来源', branch.workspace_id !== seed.id && copied.type_lifecycle?.name === title
      && (await page.locator('.topbar h1').innerText()).includes(title) && copied.domain.name === original.domain.name
      && JSON.stringify(copied.domain.cable_types) === JSON.stringify(original.domain.cable_types)
      && JSON.stringify(copied.domain.materials) === JSON.stringify(original.domain.materials)
      && source.revision === original.revision && JSON.stringify(source.domain) === JSON.stringify(original.domain), {
      source: seed.id, sourceRevision: original.revision, copy: branch.workspace_id, copyRevision: copied.revision,
    });
    (report.deliverySources ||= []).push({ ...size, source: seed.id, sourceRevision: original.revision,
      copy: branch.workspace_id, origin: original.type_origin_reference, densities, electrical, short, rating: rating.parameters });
    return { id: branch.workspace_id, source: seed.id, original, electrical, short, rating };
  });
  if (!delivery) return;

  await attempt('14-教学交付副本运行真实结构推导', async () => {
    await module('结构 ·');
    await page.getByRole('tab', { name: '外径与用料', exact: true }).click();
    if (!await run('更新结构推导', 'quantities')) return;
    await expect(page.getByRole('table', { name: '外径与用料', exact: true })).toBeVisible();
  });
  await attempt('15-教学交付副本运行真实标准核对', async () => {
    await module('标准核对');
    if (!await run('执行标准核对', 'standard-check-results')) return;
    await expect(page.getByRole('table', { name: '标准核对', exact: true })).toBeVisible();
    await captureNotationEvidence(delivery.id, '教学标准核对-附录原文');
    await readableResultColumns('标准核对');
    const before = await workspace(delivery.id), writesBefore = report.writes.length;
    await module('要求与标准');
    await activate(page.getByRole('tab', { name: '待批准导入', exact: true }), size.width === 1366);
    await expect(page.locator('[data-type-page="requirements-results"]')).toHaveAttribute('data-type-state', 'success');
    await readableResultColumns('要求清单');
    await capture('教学待批准要求-原水平位置完整状态');
    await activate(page.getByRole('tab', { name: '执行标准', exact: true }), size.width === 1920);
    await readableResultColumns('执行标准');
    await capture('教学执行标准-完整固定资源链接');
    await module('标准核对');
    const after = await workspace(delivery.id);
    check('核对要求与执行版本的原屏阅读没有写入或改动批准', report.writes.length === writesBefore
      && after.revision === before.revision && JSON.stringify(after.domain) === JSON.stringify(before.domain),
    { beforeRevision: before.revision, afterRevision: after.revision, writes: report.writes.slice(writesBefore) });
  });
  const celsius = value => Number((value - 273.15).toPrecision(12));
  for (const analysis of [
    { label: '电气参数', result: 'electrical-results', parameters: delivery.electrical, fields: [
      ['temperature_k', '工作温度', celsius], ['frequency_hz', '频率'], ['phase_voltage_v', '运行相电压'],
      ['ks', '集肤效应系数'], ['kp', '邻近效应系数'], ['spacing_m', '导体中心距', value => value * 1000], ['core_lay_factor', '成缆绞入系数'],
    ], selections: [['r20_length_basis', 'R₂₀ 长度基准', { finished_cable: '成品电缆长度', straight_core: '直线线芯长度' }],
      ['arrangement', '相间排列', { trefoil: '品字排列', flat: '水平排列' }]] },
    { label: '短路容量', result: 'short-circuit-results', parameters: delivery.short, fields: [
      ['duration_s', '持续时间'], ['initial_temperature_k', '初始绝对温度', celsius], ['final_temperature_k', '导体最终温度', celsius],
      ['metal_initial_temperature_k', '金属组件初始温度', celsius], ['metal_final_temperature_k', '金属组件最终温度', celsius],
      ['contact_factor', '金属接触因数'], ['inner_thermal_resistivity', '内侧介质热阻率'], ['outer_thermal_resistivity', '外侧介质热阻率'],
      ['inner_volumetric_heat_capacity', '内侧介质体积热容'], ['outer_volumetric_heat_capacity', '外侧介质体积热容'],
    ], selections: [] },
  ]) {
    await attempt('16-教学交付副本录入已有来源并运行' + analysis.label, async () => {
      await module(analysis.label);
      await page.getByRole('tab', { name: '方法参数', exact: true }).click();
      await expect(page.locator('.type-method-fields .buzzform-contract')).toBeVisible();
      await advanced(page.locator('.type-method-fields'));
      for (const [key, label, convert = value => value] of analysis.fields) {
        expect(Number.isFinite(analysis.parameters[key]), key + '必须来自已保存的教学条件').toBeTruthy();
        await field(label, convert(analysis.parameters[key]));
      }
      for (const [key, label, labels] of analysis.selections) {
        expect(labels[analysis.parameters[key]], key + '必须来自已保存的教学条件').toBeTruthy();
        await choose(label, labels[analysis.parameters[key]]);
      }
      await page.getByRole('button', { name: '保存方法条件', exact: true }).click();
      await savedState();
      await capture('教学交付-' + analysis.label + '-已有来源条件已保存');
      await page.getByRole('tab', { name: '结果', exact: true }).click();
      if (!await run('计算' + analysis.label, analysis.result)) return;
      await expect(page.getByRole('table', { name: analysis.label, exact: true })).toBeVisible();
    });
  }
  await attempt('17-教学交付副本录入已有工况并运行载流量表', async () => {
    const condition = delivery.rating.driver.cases.map(item => item.metadata?.condition)
      .find(item => item?.layout === 'three_core_buried_single');
    expect(condition, '教学种子必须提供真实保存的三芯直埋单回条件').toBeTruthy();
    const parameters = delivery.rating.parameters, caseName = '已有来源的教学直埋工况 ' + tag;
    await module('载流量表');
    await page.getByRole('button', { name: '添加工况', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加工况', exact: true });
    await field('工况名称', caseName, dialog);
    await choose('工况排列', '三芯直埋 · 单回', dialog);
    await field('交流频率 / Hz', condition.frequency_hz, dialog);
    await dialog.getByRole('button', { name: '添加到工况表', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 90000 });
    await page.getByText('所选工况条件 · ' + caseName, { exact: true }).click();
    for (const [key, label] of [['ambient_temperature_c', '环境温度'], ['depth_m', '中心埋深'], ['soil_rho_k_m_w', '土壤热阻率']]) {
      await field(caseName + ' ' + label, condition[key]);
    }
    await field(caseName + ' 中心距', condition.spacing_m ?? '');
    expect(condition.bonding).toBe('both_ends');
    expect(condition.rating_basis).toBe('simultaneous');
    await choose('接地', '两端接地');
    await choose('载流量口径', '全回路等负荷');
    await field('条件来源', condition.source);
    await save(delivery.id);
    await page.getByRole('tab', { name: '方法参数', exact: true }).click();
    await fillRatingParameters(parameters, parameters.source);
    await save(delivery.id);
    const saved = (await api(`/api/workspaces/${delivery.id}/studies`)).filter(item => item.definition.driver.kind === 'batch')
      .sort((a, b) => b.created.localeCompare(a.created))[0];
    expect(saved?.definition.parameters).toMatchObject(parameters);
    await capture('教学交付-载流量工况与已有来源已保存');
    await page.getByRole('tab', { name: '结果表', exact: true }).click();
    if (!await run('计算所选工况', 'rating-table-results')) return;
    const study = (await api(`/api/workspaces/${delivery.id}/studies`)).filter(item => item.definition.driver.kind === 'batch')
      .sort((a, b) => b.created.localeCompare(a.created))[0];
    const current = (await api(`/api/workspaces/${delivery.id}/studies/${study.id}/runs`)).items
      .filter(item => item.freshness === 'current' && item.integrity === 'verified').sort((a, b) => b.created.localeCompare(a.created))[0];
    const result = current && await api(`/api/design/workspaces/${delivery.id}/rating-table-runs/${current.id}`);
    check('教学交付载流量由当前真实运行取得正电流', result?.rows.some(row => row.name === caseName && row.value_a > 0), result);
  });
  await attempt('17b-教学交付逐项限定范围并保留未闭合门禁', () => declareTeachingScope(delivery.id));
  await attempt('18-教学交付副本生成客户规格书并下载真实PDF', () => generateSpecification(delivery.id, '教学交付规格书', 'teaching'));
  await attempt('19-教学交付副本逐项审核并执行版本流程', () => reviewSpecification(delivery.id, '教学交付规格书'));
  const sourceAfterDelivery = await workspace(delivery.source);
  check('交付计算和文档流程没有改动原教学型号', sourceAfterDelivery.revision === delivery.original.revision
    && JSON.stringify(sourceAfterDelivery.domain) === JSON.stringify(delivery.original.domain));
});
