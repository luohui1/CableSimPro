import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

let originalSeedIds;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pointer = (...parts) => '/' + parts.map(value => String(value).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

function screenRows(document) {
  return document.cable_types.flatMap(cable => [
    ...cable.cores.flatMap(core => core.layers.filter(layer => layer.role === 'metallic_screen').map(layer => ({
      cable, layer, row: core.id + '/' + layer.role,
      root: pointer('cable_types', cable.id, 'cores', core.id, 'layers', layer.role),
      entity: cable.id + '/' + (cable.cores.length > 1 ? core.id + '/' : '') + layer.role,
    }))),
    ...cable.common_layers.filter(layer => layer.role === 'metallic_screen').map(layer => ({
      cable, layer, row: 'common/' + layer.role,
      root: pointer('cable_types', cable.id, 'common_layers', layer.role),
      entity: cable.id + '/' + layer.role,
    })),
  ]).filter(item => item.layer.form === 'tape' && item.layer.tape_application === 'helical_overlap'
    && (item.layer.tape_width == null || item.layer.overlap == null));
}

// Only actual seed inputs, HTTP responses and UI actions are evidence. This
// check neither supplies missing engineering values nor starts a saved run.
export async function verifyTypeGeometryInput({ page, expect, base, api, capture, check, out, size, tag, report, confirmExpectedGeometryFailure }) {
  const owners = await api('/api/design/type-workspaces');
  originalSeedIds ||= owners.map(item => item.id);
  const sources = [], checked = [];
  for (const family of ['YJV32', 'YJV-single']) {
    for (const owner of owners.filter(item => originalSeedIds.includes(item.id)
      && (family === 'YJV32' ? /^YJV32-/.test(item.name) : /^YJV-/.test(item.name)))) {
      const input = await api('/api/types/' + encodeURIComponent(owner.id) + '/workspace');
      const rows = screenRows(input.domain).filter(item => item.cable === input.domain.cable_types[0]
        && (family === 'YJV32' ? item.cable.cores.length > 1 : item.cable.cores.length === 1));
      checked.push({ family, workspace: owner.id, revision: input.revision, missingRows: rows.map(item => item.root),
        published: input.type_lifecycle?.status === 'published', plan: !!input.type_plan_source });
      if (!rows.length || input.type_plan_source || input.type_lifecycle?.status === 'published') continue;
      sources.push({ family, input }); break;
    }
    expect(sources.some(item => item.family === family), '必须有真实原始 ' + family + ' 缺项型号，不能补值或制造错误').toBe(true);
  }
  const keyboard = size.width === 1366;
  const activate = async locator => { if (keyboard) { await locator.focus(); await locator.press('Enter'); } else await locator.click(); };
  const toolbar = () => page.getByRole('toolbar', { name: '型号命令', exact: true });
  const tabs = () => page.getByRole('tablist', { name: '属性分页', exact: true });
  const settlePaint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function openAgent() {
    await activate(tabs().getByRole('tab', { name: 'Agent', exact: true }));
    await expect(page.locator('.type-agent-panel .agent-panel')).toBeVisible();
    await settlePaint();
    await expect(tabs().getByRole('tab', { name: 'Agent', exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  async function entities(wid) {
    const root = '/api/workspaces/' + encodeURIComponent(wid);
    const [workspace, input, studies, deliveries] = await Promise.all([
      api(root), api('/api/types/' + encodeURIComponent(wid) + '/workspace'), api(root + '/studies'), api(root + '/deliveries'),
    ]);
    const directory = []; let cursor = 0, complete = false;
    for (let pageIndex = 0; pageIndex < 400; pageIndex++) {
      const page = await api('/api/types/' + encodeURIComponent(wid) + '/display-runs?after=' + cursor + '&limit=5');
      expect(Array.isArray(page.items), '保存运行目录须返回真实数组').toBe(true);
      directory.push(...page.items);
      if (page.next_cursor === null) { complete = true; break; }
      expect(Number.isSafeInteger(page.next_cursor) && page.next_cursor > cursor, '保存运行目录游标须前进').toBe(true);
      cursor = page.next_cursor;
    }
    expect(complete, '保存运行目录必须读至末页').toBe(true);
    expect(new Set(directory.map(item => item.id)).size).toBe(directory.length);
    const runs = [];
    for (const item of directory) {
      const run = await api(root + '/studies/' + encodeURIComponent(item.study) + '/runs/' + encodeURIComponent(item.id) + '?view=full');
      expect(run.id).toBe(item.id); expect(run.workspace).toBe(wid); expect(run.study).toBe(item.study);
      runs.push(run);
    }
    return { workspace, input, studies, deliveries, directory, runs };
  }
  async function saveBytes(filename, bytes) {
    await fs.writeFile(path.join(out, filename), bytes);
    return { file: filename, bytes: bytes.length, sha256: sha256(bytes) };
  }
  for (const source of sources) {
    const wid = source.input.id, endpoint = '/api/workspaces/' + encodeURIComponent(wid) + '/geometry-preview';
    const prefix = 'geometry-input-' + tag + '-' + source.family;
    const before = await entities(wid), writesBefore = report.writes.length, networkBefore = report.network.length;
    expect(before.input).toEqual(source.input);
    const evidence = { ...size, family: source.family, workspace: wid, revision: source.input.revision,
      checked, originalSeedIds, responses: [], navigations: [],
      missingValuesSupplied: false, savedRunsStarted: false,
      before: await saveBytes(prefix + '-before.json', Buffer.from(JSON.stringify(before, null, 2) + '\n')) };
    (report.geometryInputNavigation ||= []).push(evidence);
    let issue, completed = false;
    const confirmations = [];
    async function readFailure(action, label, expectedDocument) {
      const [response] = await Promise.all([
        page.waitForResponse(reply => new URL(reply.url()).pathname === endpoint && reply.request().method() === 'POST', { timeout: 90000 }),
        action(),
      ]);
      const body = await response.body(), request = response.request(), requestBody = request.postDataBuffer();
      expect(requestBody, '真实预览请求必须有原始输入正文').not.toBeNull();
      const record = { label, url: response.url(), status: response.status(), method: request.method(),
        response: await saveBytes(prefix + '-' + label + '-response.json', body),
        request: await saveBytes(prefix + '-' + label + '-request.json', requestBody),
        responseContentType: response.headers()['content-type'], requestContentType: request.headers()['content-type'] };
      evidence.responses.push(record);
      expect(response.status(), '保留同轮实际几何预览 422，不将截面包络当作成功三维').toBe(422);
      const payload = JSON.parse(body.toString('utf8')), submitted = JSON.parse(requestBody.toString('utf8'));
      const detail = payload.detail ?? payload, diagnostic = typeof detail === 'string' ? detail : detail?.message;
      expect(typeof diagnostic === 'string' && diagnostic.length > 0, '原始接口诊断必须可确定，不能自造错误正文').toBe(true);
      expect(submitted.expected_revision).toBe(source.input.revision);
      expect(submitted.document).toEqual(expectedDocument);
      expect(submitted.parameters).toMatchObject({ cable_type_id: source.input.domain.cable_types[0].id, include_exact: false });
      const matches = screenRows(submitted.document).flatMap(row => [
        ...(row.layer.tape_width == null && diagnostic === row.entity + '.tape_width必须是范围内的正数' ? [{ ...row, field: 'tape_width' }] : []),
        ...(row.layer.overlap == null && diagnostic === row.entity + '.overlap：重叠绕包需明确 0–1 的搭盖率' ? [{ ...row, field: 'overlap' }] : []),
      ]);
      expect(matches, '实际 422 必须唯一对应本请求真实缺项层，不能猜测或替换字段').toHaveLength(1);
      const found = matches[0];
      record.diagnostic = diagnostic; record.field = found.root + '/' + found.field;
      record.layer = found.row; record.methodPin = submitted.method;
      record.missing = ['tape_width', 'overlap'].filter(key => found.layer[key] == null);
      confirmations.push({ response, record });
      return { ...found, path: record.field, diagnostic, record };
    }
    async function showFailure(found, readOnly, label) {
      const cad = page.locator('.type-canvas [data-cad-state]');
      await expect(cad).toHaveAttribute('data-cad-state', 'error');
      await expect(cad).toContainText('缺失');
      for (const [key, text] of [['tape_width', '带宽'], ['overlap', '搭盖比例']]) {
        if (found.layer[key] == null) await expect(cad).toContainText(text);
      }
      await expect(cad).toContainText(readOnly ? '所选输入只读，请查看缺项层' : '请在“构造与用料”填写有依据的实际值');
      await expect(cad).not.toContainText('metallic_screen');
      await expect(cad).not.toContainText('tape_width');
      await expect(cad).not.toContainText('overlap');
      const help = page.getByRole('group', { name: '三维输入缺项', exact: true });
      await expect(help.getByRole('button', { name: readOnly ? '查看缺项层' : '定位屏蔽层输入', exact: true })).toBeVisible();
      await expect(help.getByRole('button', { name: '技术信息', exact: true })).toBeVisible();
      const shot = await capture('屏蔽层缺项-' + source.family + '-' + label);
      evidence.navigations.push({ label, url: page.url(), screenshot: shot.screenshot, cadState: await cad.getAttribute('data-cad-state') });
      await activate(help.getByRole('button', { name: '技术信息', exact: true }));
      const dialog = page.getByRole('dialog', { name: '技术信息', exact: true });
      await expect(dialog).toContainText('HTTP 422');
      await expect(dialog).not.toContainText(found.diagnostic);
      await expect(dialog).not.toContainText('metallic_screen');
      const [download] = await Promise.all([page.waitForEvent('download'),
        activate(dialog.getByRole('button', { name: '下载原始诊断', exact: true }))]);
      expect(download.suggestedFilename()).toBe('三维预览原始诊断.txt');
      const filename = prefix + '-' + label + '-diagnostic.txt';
      await download.saveAs(path.join(out, filename));
      const downloaded = await fs.readFile(path.join(out, filename)), expected = Buffer.from(found.diagnostic, 'utf8');
      expect(downloaded.equals(expected), '下载字节必须逐字等于同轮 422 的 ApiError.message；不加 BOM、换行或改写原文').toBe(true);
      found.record.download = { file: filename, bytes: downloaded.length, sha256: sha256(downloaded),
        expectedDiagnosticSHA256: sha256(expected), sameBytes: true };
      const dialogShot = await capture('屏蔽层缺项-' + source.family + '-' + label + '-技术信息与原诊断下载');
      evidence.navigations.push({ label: label + '-技术信息', url: page.url(), screenshot: dialogShot.screenshot });
      await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    }
    async function locate(found, readOnly, expectedContext, label) {
      const action = page.getByRole('group', { name: '三维输入缺项', exact: true })
        .getByRole('button', { name: readOnly ? '查看缺项层' : '定位屏蔽层输入', exact: true });
      await activate(action);
      await page.waitForURL(url => url.pathname === '/types/' + encodeURIComponent(wid) + '/structure/three'
        && url.searchParams.get('theme') === 'light' && url.searchParams.get('layer') === found.row
        && url.searchParams.get('field') === found.path
        && url.searchParams.get('run') === (expectedContext.run || null)
        && url.searchParams.get('revision') === (expectedContext.revision || null));
      await expect(tabs().getByRole('tab', { name: '输入', exact: true })).toHaveAttribute('aria-selected', 'true');
      const wrapper = page.locator('.type-property-fields [data-field-path=' + JSON.stringify(found.path) + ']');
      const input = wrapper.locator('input');
      await expect(input).toBeVisible();
      await expect(input, '必须真正聚焦实际输入；仅有 URL 或延迟组件外壳不足').toBeFocused();
      await expect.poll(() => wrapper.evaluate(node => {
        let count = 0;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) { count++; if (!parent.open) return false; }
        }
        return count > 0;
      }), { message: '构造与用料及其祖先分组必须实际展开' }).toBe(true);
      await expect(input).toHaveValue('');
      if (readOnly) { await expect(input).not.toBeEditable(); await expect(input).toHaveAttribute('readonly', ''); }
      else await expect(input).toBeEditable();
      const shot = await capture('屏蔽层缺项-' + source.family + '-' + label);
      evidence.navigations.push({ label, url: page.url(), screenshot: shot.screenshot, field: found.path, focused: true, groupsOpen: true, readOnly });
    }
    try {
      await page.goto(base + '/types?theme=light');
      await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
      const search = page.getByRole('searchbox', { name: '查找型号', exact: true });
      await search.fill(source.input.domain.name);
      const row = page.locator('[id=' + JSON.stringify('row-型号-' + wid) + ']');
      await expect(row).toBeVisible();
      await activate(row.locator('button.object-link'));
      await page.waitForURL(url => url.pathname === '/types/' + encodeURIComponent(wid) + '/structure/section');
      await openAgent();
      issue = await readFailure(() => activate(page.getByRole('group', { name: '模型视图', exact: true })
        .getByRole('button', { name: '三维剥切', exact: true })), 'current', source.input.domain);
      await showFailure(issue, false, '当前真实缺项');
      await locate(issue, false, {}, '从Agent首次定位');
      const sameURL = page.url();
      await openAgent();
      await settlePaint();
      await expect(tabs().getByRole('tab', { name: 'Agent', exact: true })).toHaveAttribute('aria-selected', 'true');
      await locate(issue, false, {}, '同URL再次定位');
      expect(page.url()).toBe(sameURL);
      await openAgent();
      const layerTable = page.getByRole('table', { name: '型号分层', exact: true });
      const other = layerTable.locator('tbody tr.data-row');
      const otherRows = await other.evaluateAll(nodes => nodes.map(node => node.id));
      const otherId = otherRows.find(id => id !== 'row-型号分层-' + issue.row);
      expect(otherId, '实际分层表必须有另一个层供选择').toBeTruthy();
      await layerTable.locator('[id=' + JSON.stringify(otherId) + ']').locator('td').nth(1).click();
      await settlePaint();
      await expect(tabs().getByRole('tab', { name: 'Agent', exact: true }), '旧 field 查询不能在选择其他层时夺回输入分页').toHaveAttribute('aria-selected', 'true');
      await locate(issue, false, {}, '其他层后重新定位');

      // A real saved revision is always historical in loadWorkspace. Do not
      // pretend its missing CAD archive is a new 422 or silently reopen a draft.
      const revision = await api('/api/workspaces/' + encodeURIComponent(wid) + '/revisions/' + source.input.revision);
      expect(revision.workspace).toBe(wid); expect(revision.revision).toBe(source.input.revision);
      expect(revision.state.domain).toEqual(source.input.domain);
      const query = new URLSearchParams({ theme: 'light', revision: String(revision.revision), layer: issue.row, field: issue.path });
      await page.goto(base + '/types/' + encodeURIComponent(wid) + '/structure/three?' + query);
      await expect(page.locator('.type-root .topbar')).toContainText('历史');
      await expect(page.locator('.type-root .topbar')).toContainText('只读');
      const historicalInput = page.locator('.type-property-fields [data-field-path=' + JSON.stringify(issue.path) + '] input');
      await expect(historicalInput).toBeVisible(); await expect(historicalInput).toBeFocused();
      await expect(historicalInput).not.toBeEditable(); await expect(historicalInput).toHaveValue('');
      await expect(toolbar().getByRole('button', { name: '保存', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: '定位屏蔽层输入', exact: true })).toHaveCount(0);
      const historyURL = new URL(page.url());
      expect(historyURL.searchParams.get('revision')).toBe(String(revision.revision));
      expect(historyURL.searchParams.get('field')).toBe(issue.path); expect(historyURL.searchParams.has('run')).toBe(false);
      const historicalCad = page.locator('.type-canvas [data-cad-state]');
      await expect(historicalCad).toHaveAttribute('data-cad-state', /^(error|historical)$/);
      if (await historicalCad.getAttribute('data-cad-state') === 'error') {
        await expect(historicalCad).toContainText('历史型号未保存 CAD 工件；未以当前输入替代');
      }
      const historyShot = await capture('屏蔽层缺项-' + source.family + '-真实历史修订保持只读');
      evidence.historical = { revision: revision.revision, url: page.url(), screenshot: historyShot.screenshot,
        field: issue.path, inputReadOnly: true, cadText: await historicalCad.innerText(),
        source: await saveBytes(prefix + '-historical-revision.json', Buffer.from(JSON.stringify(revision, null, 2) + '\n')) };

      const fixed = before.runs.find(run => run.integrity === 'verified' && run.freshness === 'current'
        && run.snapshot?.workspace_revision === source.input.revision);
      if (fixed) {
        expect(fixed.snapshot.workspace_state?.domain).toEqual(source.input.domain);
        const fixedURL = base + '/types/' + encodeURIComponent(wid) + '/structure/three?theme=light&run=' + encodeURIComponent(fixed.id);
        const fixedIssue = await readFailure(() => page.goto(fixedURL), 'fixed-run', fixed.snapshot.workspace_state.domain);
        await showFailure(fixedIssue, true, '实际固定运行只读');
        await locate(fixedIssue, true, { run: fixed.id }, '固定运行查看缺项层');
        await expect(page.locator('.type-root .topbar')).toContainText('保存运行');
        await expect(toolbar().getByRole('button', { name: '保存', exact: true })).toBeDisabled();
        evidence.fixedRun = { status: 'verified', id: fixed.id, inputDigest: fixed.input_digest, outputDigest: fixed.output_digest,
          snapshotRevision: fixed.snapshot.workspace_revision, url: page.url() };
      } else evidence.fixedRun = { status: 'cloud-unverified', reason: '此真实缺项原型号没有当前且完整性通过的保存运行；未创建运行或替换快照。历史修订只读已独立核对。' };
      check(source.family + '真实422保留且中文缺项可键鼠定位、重复定位及下载原始诊断', true,
        { workspace: wid, revision: source.input.revision, responses: evidence.responses, navigations: evidence.navigations,
          historical: evidence.historical, fixedRun: evidence.fixedRun });
      completed = true;
    } finally {
      const after = await entities(wid), writes = report.writes.slice(writesBefore);
      evidence.after = await saveBytes(prefix + '-after.json', Buffer.from(JSON.stringify(after, null, 2) + '\n'));
      evidence.observedWrites = writes;
      evidence.readOnlyPreviewRequests = writes.filter(item => item.method === 'POST' && item.path === endpoint);
      evidence.unexpectedWrites = writes.filter(item => item.method !== 'POST' || item.path !== endpoint);
      evidence.observedNetwork = report.network.slice(networkBefore);
      evidence.completeEntitiesUnchanged = JSON.stringify(after) === JSON.stringify(before);
      // Keep all raw failures and POST records. A response becomes an expected
      // negative check only after every UI assertion and complete entity comparison.
      check(source.family + '定位和诊断下载零持久写入且完整原实体与保存运行不变',
        evidence.completeEntitiesUnchanged && evidence.unexpectedWrites.length === 0,
        { before: evidence.before, after: evidence.after, completeEntitiesUnchanged: evidence.completeEntitiesUnchanged,
          writes, unexpectedWrites: evidence.unexpectedWrites, original422Retained: evidence.observedNetwork }, { fatal: false });
      if (completed && evidence.completeEntitiesUnchanged && evidence.unexpectedWrites.length === 0) {
        for (const { response, record } of confirmations) {
          record.expectedFailureConfirmation = await confirmExpectedGeometryFailure(response, {
            kind: 'type-geometry-missing-screen-input', workspace: wid,
            reason: '真实缺项原输入的负向走查：已逐字验证422诊断下载、实际定位焦点及展开、只读边界和零持久写入。',
            uniqueMissingInputVerified: true, downloadVerified: record.download?.sameBytes === true,
            navigationVerified: evidence.navigations.some(item => item.focused && item.groupsOpen && item.field === record.field),
            completeEntitiesUnchanged: true, zeroPersistentWrites: true,
            response: record.response, request: record.request, download: record.download,
            diagnostic: record.diagnostic, missing: record.missing, field: record.field,
            evidencePointer: '/geometryInputNavigation/' + report.geometryInputNavigation.indexOf(evidence),
            before: evidence.before, after: evidence.after,
          });
        }
      }
    }
  }
}
