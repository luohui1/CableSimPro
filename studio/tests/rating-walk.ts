// The rating workbench used the way an engineer uses it, in a real browser with the real host and core, at 1366×768 and
// 1920×1080: a new project from a cable of the library that is made and checked in one step, reading the answer, changing a
// condition at the side and applying it, sweeping a condition, choosing a section for a target current, the run records
// in their row, the sheet; then the layouts that draw several cables, circuits and ducts, the changes made on the drawing
// itself, and the word before the page is left with changes that were not applied.
// Every step saves a screenshot and runs the layout probe (tests/probe.ts).
//
//   npm run build && node tests/rating-walk.ts [output folder]
//   CABLE_STUDIO_WALK_BASE=http://127.0.0.1:8214 CABLE_STUDIO_WALK_MODEL=<library id> node tests/rating-walk.ts   (a host already running)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createApp } from '../host/server.ts';
import type { ProjectView, RunRecord } from '../shared/types.ts';
import { probe } from './probe.ts';

/** The cable the walk starts from: a public three-core 3×240 that comes with the software. */
const MODEL = process.env.CABLE_STUDIO_WALK_MODEL ?? 'huayuan.yjv22-15kv-240';
/** A run of the method takes a few seconds; a selection over a series takes longer. */
const RUN = 90_000;

export async function walkRating(browser: Browser, base: string, out: string, problems: string[], model = MODEL) {
  const get = async <T>(path: string): Promise<T> => (await fetch(`${base}${path}`)).json() as Promise<T>;
  const op = async <T>(id: string, params: unknown): Promise<T> => {
    const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json();
    if (!response.ok) throw new Error(`${id}: ${JSON.stringify(body)}`);
    return body as T;
  };

  // Layouts that draw more than one cable, each checked by the real method: three single-core cables in trefoil (no field
  // published), three three-core circuits in a row (with a field), and single-core cables in ducts (the air and wall
  // resistances of the duct).
  const trefoil = (await op<ProjectView>('project.create', { name: '走查 110 kV 品字形', model_id: 'system.yjq02-110kv-800' })).meta.id;
  await op('conditions.set', { project: trefoil, currents_a: [600] });
  await op<RunRecord>('run.rate', { project: trefoil });
  const row = (await op<ProjectView>('project.create', { name: '走查 10 kV 三回水平', model_id: 'huayuan.yjv22-15kv-240' })).meta.id;
  await op('installation.set', { project: row, layout: 'three_core_buried_horizontal', depth_m: 1.2 });
  await op('conditions.set', { project: row, currents_a: [300] });
  await op<RunRecord>('run.rate', { project: row });
  const ducts = (await op<ProjectView>('project.create', { name: '走查 10 kV 排管', model_id: 'system.cu-xlpe-10kv-240' })).meta.id;
  await op('installation.set', { project: ducts, layout: 'ducts' });
  await op<RunRecord>('run.rate', { project: ducts });
  // Three circuits with very different loads: the first is over its limit, the method says which cable is hottest.
  const mixed = (await op<ProjectView>('project.create', { name: '走查 10 kV 三回负荷不等', model_id: 'huayuan.yjv22-15kv-240' })).meta.id;
  await op('installation.set', { project: mixed, layout: 'three_core_buried_horizontal', depth_m: 1.2 });
  await op('conditions.set', { project: mixed, currents_a: [600, 100, 100] });
  await op<RunRecord>('run.rate', { project: mixed });
  // A project that has only a sweep: no check has been run.
  const sweepOnly = (await op<ProjectView>('project.create', { name: '走查 只有扫描', model_id: 'huayuan.yjv22-15kv-240' })).meta.id;
  await op<RunRecord>('run.sweep', { project: sweepOnly, variable: 'soil_thermal_resistivity', values: [1, 1.5, 2] });

  for (const [width, height] of [[1366, 768], [1920, 1080]] as const) {
    const page: Page = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
    page.on('pageerror', error => problems.push(`${width} page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`${width} console error: ${message.text()}`); });
    const check = async (label: string) => {
      await page.waitForTimeout(650);
      await page.screenshot({ path: join(out, `${width}-${label}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} ${label}: ${issue}`);
    };
    const projectId = () => /\/p\/(p-[0-9a-f]+)/.exec(page.url())![1];
    const view = (id = projectId()) => get<ProjectView>(`/api/projects/${id}`);
    const record = (run: string, id = projectId()) => get<RunRecord>(`/api/projects/${id}/runs/${run}`);
    const shownNumber = async () => Number(await page.locator('.text-metric').first().innerText());
    const gpuReady = async () => {
      await page.waitForSelector('[data-gpu]:not([data-gpu="pending"])');
      if ((await page.getAttribute('[data-gpu]', 'data-gpu')) === 'none') problems.push(`${width}: the GPU layer did not start`);
    };
    const waitFor = async (what: string, done: () => Promise<boolean>, timeout = 15_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await done()) return;
        await page.waitForTimeout(150);
      }
      throw new Error(`timed out: ${what}`);
    };
    const rail = () => page.getByRole('navigation', { name: '运行记录' });
    const editor = () => page.locator('section[aria-label="已知条件"]');
    /** What an engineer does with a number field: click it, replace what is in it by typing. */
    const typeInto = async (selector: string, text: string) => {
      await page.locator(selector).click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(text);
    };
    /** A given of the line above the drawing; the ones that seldom change are folded into one button on the narrower screen. */
    const given = async (label: string) => {
      const button = () => page.getByRole('button', { name: new RegExp(`^${label} `) }).first();
      for (let attempt = 0; ; attempt += 1) {
        try {
          if (!(await button().isVisible())) await page.getByRole('button', { name: /^其余 \d 项/ }).click({ timeout: 3000 });
          await button().click({ timeout: 3000 });
          return;
        } catch (error) {
          // The folded group may be closing as it is looked at: look again.
          if (attempt === 2) throw error;
          await page.waitForTimeout(300);
        }
      }
    };
    const waiting = () => page.getByRole('button', { name: /改了 \d 项，还没应用/ });

    // 1. A new project from a cable of the library: the address carries the cable, the form is filled by the host, and one
    //    press makes the project and runs the check.
    await page.goto(`${base}/workbench?model=${encodeURIComponent(model)}`);
    await page.getByRole('button', { name: '建好并计算' }).waitFor();
    await page.getByText('敷设方式', { exact: true }).waitFor();
    await check('new-project');
    const name = `走查 ${width}`;
    await page.locator('#project-name').fill(name);
    await page.getByText('三芯直埋 · 单回', { exact: true }).click();
    await typeInto('#new-soil', '1');
    await typeInto('#new-current', '300');
    await page.getByRole('button', { name: '建好并计算' }).click();
    await page.waitForURL(/\/p\/p-/, { timeout: RUN });
    await page.getByRole('button', { name: '导出计算书' }).waitFor({ timeout: RUN });
    await gpuReady();
    const created = await view();
    assert.equal(created.meta.name, name);
    assert.equal(created.parts.installation.layout, 'three_core_buried_single');
    assert.equal(created.parts.conditions.currents_a[0], 300);
    assert.equal(created.runs.length, 1, 'the new project was checked in the same step');

    // 2. The answer on the screen is the host's number; the method is named, its plugin's identifier is not.
    const first = created.runs[0];
    const checked = await record(first.id);
    assert.equal(checked.status, 'succeeded');
    const ampacity = checked.summary!.ampacity!.value_a;
    assert.equal(await shownNumber(), Number(ampacity.toFixed(1)), 'the allowed current on the screen is the one the method saved');
    const limiting = checked.summary!.operating!.cables.find(cable => cable.id === checked.summary!.ampacity!.limiting_cable)!;
    await page.getByText(`${limiting.conductor_c.toFixed(1)} / ${limiting.limit_c}`).first().waitFor();
    await page.getByText('先到温限', { exact: true }).waitFor();
    await page.getByText(`余量 ${Math.abs(checked.summary!.circuits![0].margin_a!).toFixed(1)} A`).waitFor();
    await page.getByText(`${checked.method_card!.method} ${checked.method_version}`).first().waitFor();
    assert.equal(await page.getByText(checked.plugin_id).count(), 0, 'the plugin identifier is not on the screen');
    await rail().getByRole('button', { name: /^#1 / }).waitFor();
    await check('result');

    await page.getByRole('button', { name: '电缆簇' }).click();
    await check('result-cluster');
    const cable = await page.locator('[data-cable]').first().boundingBox();
    if (!cable) throw new Error('no cable on the drawing');
    await page.mouse.click(cable.x + cable.width / 2, cable.y + cable.height / 2);
    await page.getByRole('button', { name: '算法与可信度' }).click();
    assert.equal(await page.getByText(checked.plugin_id).count(), 0, 'nor in the method card');
    await check('result-method');
    await page.getByRole('button', { name: '全景' }).click();
    await page.getByRole('button', { name: '放大' }).click();
    await page.getByRole('button', { name: '回到这个视图的全貌' }).click();

    // 3. Every given opens the editor at its field; nothing is changed by looking.
    const FOCUSED: Record<string, string> = { 型号: 'edit-cable', 敷设: 'edit-layout', 埋深: 'edit-depth', 土壤热阻率: 'edit-soil', 环境: 'edit-ambient', 负荷: 'edit-load', 系统: 'edit-voltage', 护套: 'edit-bonding', 方法: 'edit-ks' };
    for (const label of ['型号', '敷设', '埋深', '土壤热阻率', '环境', '负荷', '系统', '护套', '方法']) {
      await given(label);
      await editor().waitFor();
      await page.waitForFunction(id => document.activeElement?.id === id, FOCUSED[label], { timeout: 5000 });
      await check(`given-${label}`);
      await editor().getByRole('button', { name: '关闭' }).click();
      await editor().waitFor({ state: 'detached' });
    }
    assert.equal((await view()).inputs_sha256, created.inputs_sha256, 'opening the editor changes nothing');

    // 4. Change one condition at the side: nothing is written to the project, the answer stays as it was, and the changes can
    //    be taken back, made again and dropped.
    const soil = width === 1366 ? '1.6' : '1.4';
    await given('土壤热阻率');
    await typeInto('#edit-soil', soil);
    await editor().getByText('改了 1 项').waitFor();
    await page.getByRole('button', { name: /^土壤热阻率.*已改/ }).waitFor();
    await page.getByText(/条件改了 1 项，画面仍是运行记录 #1/).waitFor();
    assert.equal((await view()).inputs_sha256, created.inputs_sha256, 'a change waits in the editor: the project is not written');
    assert.equal((await view()).runs.length, 1);
    await check('changed');
    await editor().getByText('现在是 1 K·m/W').waitFor();
    await editor().getByRole('button', { name: /^撤销/ }).click();
    await editor().getByText('没有改动').waitFor();
    await editor().getByRole('button', { name: /^重做/ }).click();
    await editor().getByText('改了 1 项').waitFor();
    await editor().getByRole('button', { name: '放弃' }).click();
    await editor().waitFor({ state: 'detached' });
    assert.equal(await page.getByText('改了').count(), 0, 'dropped changes leave nothing marked');
    assert.equal(await shownNumber(), Number(ampacity.toFixed(1)));

    // The same change again, applied: it is written, the check is run, and the record is the new current answer.
    await given('土壤热阻率');
    await typeInto('#edit-soil', soil);
    await editor().getByText('改了 1 项').waitFor();
    await editor().getByRole('button', { name: '按新条件计算' }).click();
    await rail().getByRole('button', { name: /^#2 / }).waitFor({ timeout: RUN });
    await page.getByText('先到温限', { exact: true }).waitFor();
    assert.equal((await view()).parts.conditions.soil_thermal_resistivity, Number(soil));
    assert.ok(await shownNumber() < Number(ampacity.toFixed(1)), 'a worse soil carries less');
    await rail().getByRole('button', { name: /^#1 .*输入改过/ }).waitFor();
    await check('result-again');

    // 5. Sweep one condition: a curve and a table, saved as a record that opens at its own address, and its numbers as a file.
    await page.getByRole('button', { name: '扫一个条件' }).click();
    const points = Number(await page.locator('#sweep-count').inputValue());
    await check('sweep-form');
    await page.getByRole('button', { name: '运行扫描' }).click();
    await page.waitForURL(/run=run-/, { timeout: RUN });
    await page.getByRole('img', { name: /随.*变化的曲线/ }).waitFor();
    assert.equal(await page.locator('table tbody tr').count(), points, 'one row for each point of the sweep');
    await check('sweep');
    await page.getByRole('button', { name: '导体温度', exact: true }).click();
    await check('sweep-conductor');
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出 CSV' }).click()]);
    const csv = readFileSync(await file.path(), 'utf8');
    assert.ok(csv.startsWith(String.fromCharCode(0xfeff)), 'a spreadsheet reads Chinese from a file with the byte-order mark');
    assert.equal(csv.trim().split('\r\n').length, 4 + 1 + points, 'what the file is about, its header, and a line for each point');
    const swept = await record((await view()).runs.find(run => run.kind === 'sweep')!.id);
    const point = swept.sweep!.points[0];
    assert.ok(csv.includes('允许电流 (A)') && csv.includes(`${swept.sweep!.label} (${swept.sweep!.unit})`), 'the columns say their units');
    assert.ok(csv.includes(`\r\n${point.value},${Number(point.ampacity_a!.toFixed(1))},`), 'the first point is the first line, in the numbers the screen shows');
    assert.ok(csv.includes(`${swept.method_card!.method} ${swept.method_version}`), 'the file says which method made the numbers');

    // 6. Choose a section for a target current: the table of sizes, and the one the rule chose; it can be taken over as a change.
    await page.getByRole('button', { name: '按电流选型' }).click();
    await page.locator('#selection-target').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('300');
    await page.getByRole('button', { name: '运行选型' }).click();
    await page.getByText('选定规格', { exact: true }).waitFor({ timeout: RUN });
    await check('selection');
    const adopt = page.getByRole('button', { name: '改用这个型号' });
    assert.equal(await adopt.count(), 1, 'a smaller size than the 3×240 carries 300 A: it is offered');
    const before = (await view()).inputs_sha256;
    await adopt.click();
    await editor().waitFor();
    await editor().getByText('改了 1 项').waitFor();
    assert.equal((await view()).inputs_sha256, before, 'taking the size over is a change waiting in the editor, not a write');
    await check('selection-adopted');
    await editor().getByRole('button', { name: '放弃' }).click();
    await editor().waitFor({ state: 'detached' });

    // 7. The run records in their row: the one of the check as it was, with the givens it was computed from; a given of an
    //    earlier record leads back to the present state, where it is edited.
    await rail().getByRole('button', { name: /^#1 / }).click();
    await page.waitForURL(/run=run-/);
    await page.getByRole('button', { name: '土壤热阻率 1 K·m/W' }).waitFor();
    await page.getByRole('button', { name: '回到现在的结果' }).waitFor();
    await check('record-opened');
    await page.getByRole('button', { name: '土壤热阻率 1 K·m/W' }).click();
    await editor().waitFor();
    await page.waitForURL(url => !url.search.includes('run='));
    await editor().getByRole('button', { name: '关闭' }).click();

    // 8. The sheet: the copper button of a record that is shown opens the printable calculation sheet of that record.
    await rail().getByRole('button', { name: /^#1 / }).click();
    const sheetButton = page.getByRole('button', { name: '导出计算书' });
    await sheetButton.waitFor();
    const [sheet] = await Promise.all([page.context().waitForEvent('page'), sheetButton.click()]);
    await sheet.waitForLoadState();
    assert.match(await sheet.locator('body').innerText(), new RegExp(`允许电流 ${ampacity.toFixed(1)} A`));
    assert.match(sheet.url(), new RegExp(`/api/projects/${projectId()}/reports/${first.id}`));
    await sheet.close();
    await check('sheet-exported');

    // 9. Layouts with several cables, circuits and ducts: the drawing's labels, the table of the cables, every group of the
    //    answer opened, and the numbers following the cable that is chosen on the drawing.
    const groups = ['各电缆', '损耗', '热阻', '表面温升由谁加的', '运行提示', '算法与可信度'];
    for (const [label, id] of [['trefoil', trefoil], ['row', row], ['ducts', ducts], ['mixed', mixed]] as const) {
      await page.goto(`${base}/p/${id}`);
      await gpuReady();
      await page.getByRole('button', { name: '导出计算书' }).waitFor();
      await check(`${label}-result`);
      await page.getByRole('button', { name: '电缆簇' }).click();
      await check(`${label}-cluster`);
      const outer = await page.locator('[data-cable]').last().boundingBox();
      if (!outer) throw new Error(`${label}: no cable on the drawing`);
      await page.mouse.click(outer.x + outer.width / 2, outer.y + outer.height / 2);
      for (const group of groups) {
        const trigger = page.getByRole('button', { name: new RegExp(`^${group}`) });
        if (await trigger.count()) await trigger.first().click();
      }
      await check(`${label}-answer`);
      await page.locator('section', { has: page.getByRole('heading', { name: '结论', exact: true }) }).locator('> div').last()
        .evaluate(element => { element.scrollTop = element.scrollHeight; });
      await check(`${label}-answer-end`);
      const saved = await get<ProjectView>(`/api/projects/${id}`);
      const states = (await record(saved.runs[0].id, id)).summary!.operating!.cables;
      assert.equal(await page.locator('[data-cable]').count(), states.length, 'a cable is drawn for each state of the run');
      if (label === 'trefoil') await page.getByRole('row', { name: /A 相/ }).waitFor();
      // The allowed current of several circuits is the one they have together: no margin is claimed beside it.
      if (label === 'row' || label === 'mixed') assert.equal(await page.getByText('余量').count(), 0, `${label}: a margin beside the allowed current of all circuits`);
      if (label === 'mixed') {
        // The hottest cable is the method's, not the one that reaches its limit first at the allowed current, and the load that is too high is said.
        const rated = (await record(saved.runs[0].id, id)).summary!;
        assert.equal(rated.operating!.within_limit, false);
        await page.getByText(/已经超过温限/).waitFor();
        await page.getByText(`导体温度 · 回路 ${/c(\d)/.exec(rated.operating!.hottest_cable!)![1]}`).waitFor();
        await check('mixed-over-limit');
      }
      if (label === 'ducts') {
        await given('埋深');
        await editor().waitFor();
        await page.locator('#edit-inner').waitFor();
        await check('ducts-depth-editor');
        await editor().getByRole('button', { name: '关闭' }).click();
        await editor().waitFor({ state: 'detached' });
        // The conclusion comes back as it starts (its groups folded): the group of the thermal resistances is opened again.
        await page.getByRole('button', { name: /^热阻/ }).click();
        await page.getByText('T₄ 管内空气').waitFor();
      }
    }

    // 10. Changes made on the drawing itself wait like the others: type the depth in its capsule (Escape keeps what was), drag
    //     the outer cable; both are marked and drawn as an outline, neither is written; undo takes them back; applied, they are written.
    await page.goto(`${base}/p/${row}`);
    await gpuReady();
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    const original = await view(row);
    const depth = width === 1366 ? 1.5 : 1.3;
    await page.locator('[data-dimension="depth"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1.9');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    assert.equal(await waiting().count(), 0, 'Escape on the capsule keeps the depth as it was');
    // The depth typed twice: two changes of one field, and Ctrl+Z takes back the second only.
    const typedFirst = width === 1366 ? 1.4 : 1.6;
    await page.locator('[data-dimension="depth"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(typedFirst));
    await page.keyboard.press('Enter');
    await page.getByText(`中心埋深 ${typedFirst} m`).waitFor();
    await page.locator('[data-dimension="depth"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(depth));
    await page.keyboard.press('Enter');
    await waiting().waitFor();
    await page.locator('[data-dimension="depth"][data-changed]').waitFor();
    await page.getByText(`中心埋深 ${depth} m`).waitFor();
    assert.equal((await view(row)).inputs_sha256, original.inputs_sha256, 'the depth typed on the drawing is not written yet');
    assert.ok(await page.locator('svg circle[stroke-dasharray="6 4"]').count() > 0, 'the cables are outlined where they would be');
    await check('canvas-depth');
    await page.locator('[data-gpu]').click({ position: { x: 300, y: 250 } });
    await page.keyboard.press('Control+Z');
    await page.getByText(`中心埋深 ${typedFirst} m`).waitFor();
    await page.keyboard.press('Control+Y');
    await page.getByText(`中心埋深 ${depth} m`).waitFor();

    const target = await page.locator('[data-cable]').last().boundingBox();
    if (!target) throw new Error('no cable to drag');
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2 + 60, target.y + target.height / 2, { steps: 8 });
    await page.screenshot({ path: join(out, `${width}-canvas-dragging.png`) });
    await page.mouse.up();
    await page.getByRole('button', { name: /改了 2 项，还没应用/ }).waitFor();
    assert.equal((await view(row)).inputs_sha256, original.inputs_sha256, 'the dragged spacing is not written yet');
    assert.equal((await view(row)).runs.length, original.runs.length, 'nothing was run');
    await page.locator('[data-dimension="spacing"][data-changed]').waitFor();
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    await check('canvas-drag');

    // Undo takes the changes back one step at a time: the spacing, the second depth (the first stays), the first depth; nothing is
    // left marked and the record is still the current answer.
    await page.locator('[data-gpu]').click({ position: { x: 300, y: 250 } });
    await page.keyboard.press('Control+Z');
    await page.getByRole('button', { name: /改了 1 项，还没应用/ }).waitFor();
    await page.keyboard.press('Control+Z');
    await page.getByText(`中心埋深 ${typedFirst} m`).waitFor();
    await page.keyboard.press('Control+Z');
    await waitFor('nothing is left waiting', async () => (await waiting().count()) === 0);
    assert.equal((await view(row)).inputs_sha256, original.inputs_sha256);
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    await check('canvas-undone');

    // The depth once more, opened from the header's mark and applied: written, checked, and the current answer.
    await page.locator('[data-dimension="depth"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(depth));
    await page.keyboard.press('Enter');
    await waiting().click();
    await editor().getByText('改了 1 项').waitFor();
    await editor().getByRole('button', { name: '按新条件计算' }).click();
    await rail().getByRole('button', { name: /^#2 / }).waitFor({ timeout: RUN });
    await page.getByText('先到温限', { exact: true }).waitFor();
    assert.equal((await view(row)).parts.installation.depth_m, depth, 'the depth typed on the drawing is the one saved');
    await check('canvas-applied');

    // 11. A project with only a sweep: its records can be reached and the answer says that no check has been run; an address
    //     that names a record the project does not have says so; a method parameter and a cable of the same core count are
    //     changed and applied; a cable with another core count is not offered.
    await page.goto(`${base}/p/${sweepOnly}`);
    await rail().getByRole('button', { name: /^#1 扫描/ }).waitFor();
    await page.getByText('还没有校核', { exact: true }).first().waitFor();
    await check('only-sweep');
    await rail().getByRole('button', { name: /^#1 扫描/ }).click();
    await page.getByRole('img', { name: /随.*变化的曲线/ }).waitFor();
    await check('only-sweep-opened');
    await page.goto(`${base}/p/${sweepOnly}?run=run-00000000`);
    await page.getByText('没有这条运行记录').waitFor();
    await check('unknown-record');
    await page.getByRole('button', { name: '回到现在' }).click();
    await page.waitForURL(url => !url.search.includes('run='));

    const eddy = async () => ((await view(sweepOnly)).preview?.parameters as { eddy?: string }).eddy;
    const eddyBefore = await eddy();
    await given('方法');
    await page.locator('#edit-ks').waitFor();
    await check('method-parameters');
    await page.locator('#edit-eddy').click();
    await page.getByRole('option', { name: eddyBefore === 'trefoil' ? '不计' : '计入' }).click();
    await editor().getByText('改了 1 项').waitFor();
    assert.equal(await eddy(), eddyBefore, 'the parameter is changed in the editor only');
    await editor().getByRole('button', { name: '按新条件计算' }).click();
    await waitFor('the eddy losses changed and a check was run', async () => (await eddy()) !== eddyBefore && (await view(sweepOnly)).runs.some(run => run.kind === 'rating'), RUN);
    // The screen is done when the editor has closed: until then a given asks for nothing.
    await editor().waitFor({ state: 'detached', timeout: RUN });
    await rail().getByRole('button', { name: /^#2 校核/ }).waitFor();

    const beforeCable = await view(sweepOnly);
    await given('型号');
    await editor().getByRole('button', { name: '更换型号…' }).click();
    const picker = page.getByRole('dialog');
    await picker.getByPlaceholder('搜索规格或系列').fill('YJL02');
    assert.equal(await picker.getByRole('row', { name: /YJL02/ }).count(), 0, 'a cable with another core count is not offered');
    await picker.getByPlaceholder('搜索规格或系列').fill('3×300');
    await picker.getByRole('row', { name: /3×300/ }).first().click();
    await check('cable-picker');
    await picker.getByRole('button', { name: '用这一款' }).click();
    await editor().getByText('改了 1 项').waitFor();
    assert.equal((await view(sweepOnly)).parts.cable.id, beforeCable.parts.cable.id, 'the cable is changed in the editor only');
    await editor().getByRole('button', { name: '按新条件计算' }).click();
    await waitFor('the cable of the project changed', async () => (await view(sweepOnly)).parts.cable.id !== beforeCable.parts.cable.id, RUN);
    await editor().waitFor({ state: 'detached', timeout: RUN });
    await check('cable-changed');

    // 12. The word before a page is left with changes that were not applied: staying keeps them, leaving drops them.
    await given('埋深');
    await typeInto('#edit-depth', '1.7');
    await editor().getByText('改了 1 项').waitFor();
    await page.getByRole('link', { name: '新建工程' }).click();
    await page.getByRole('alertdialog').waitFor();
    await check('leave-asked');
    await page.getByRole('button', { name: '留在这里' }).click();
    await page.getByRole('alertdialog').waitFor({ state: 'detached' });
    await editor().getByText('改了 1 项').waitFor();
    await page.getByRole('link', { name: '新建工程' }).click();
    await page.getByRole('button', { name: '放弃改动并离开' }).click();
    await page.waitForURL(/\/workbench/);

    // 13. The host refuses the second of two writes: the first is taken back, the project is as it was (its digest says so), and the
    //     changes are still in the editor with the host's words.
    await page.goto(`${base}/p/${row}`);
    await gpuReady();
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    const beforeRefusal = await view(row);
    let refused = 0;
    await page.route('**/api/ops/installation.set', async route => {
      refused += 1;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INPUT_INVALID', message: '走查：宿主拒绝了这次敷设改动。' } }) });
    });
    await given('型号');
    await editor().getByRole('button', { name: '更换型号…' }).click();
    await page.getByRole('dialog').getByPlaceholder('搜索规格或系列').fill('3×300');
    await page.getByRole('dialog').getByRole('row', { name: /YJV22.*3×300/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: '用这一款' }).click();
    await typeInto('#edit-depth', '1.7');
    await editor().getByText('改了 2 项').waitFor();
    await editor().getByRole('button', { name: '按新条件计算' }).click();
    await editor().getByText(/没有应用，工程还是原来的条件：走查：宿主拒绝了这次敷设改动。/).waitFor({ timeout: RUN });
    assert.equal(refused, 1, 'the write was asked for once');
    await check('apply-refused');
    const afterRefusal = await view(row);
    assert.equal(afterRefusal.inputs_sha256, beforeRefusal.inputs_sha256, 'the cable written before the refusal was taken back');
    assert.equal(afterRefusal.runs.length, beforeRefusal.runs.length, 'no check was run');
    await editor().getByText('改了 2 项').waitFor();
    await page.unroute('**/api/ops/installation.set');
    await editor().getByRole('button', { name: '放弃' }).click();
    await page.close();
  }
}

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', '.tmp', 'studio-rating-walk'));
  mkdirSync(out, { recursive: true });
  const live = process.env.CABLE_STUDIO_WALK_BASE;
  const home = live ? null : mkdtempSync(join(tmpdir(), 'cable-studio-rating-walk-'));
  const app = home ? createApp({ home, runtime: null }) : null;
  if (app) await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  const base = live ?? `http://127.0.0.1:${(app!.server.address() as AddressInfo).port}`;
  const problems: string[] = [];
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await walkRating(browser, base, out, problems);
  } catch (error) {
    // What the layout probe found before a step failed is not lost with it.
    if (problems.length) console.error(`${problems.length} problem(s) found before it stopped:\n${problems.join('\n')}`);
    throw error;
  } finally {
    await browser.close();
    await app?.close();
    if (home) rmSync(home, { recursive: true, force: true });
  }
  console.log(`screenshots: ${out}`);
  if (problems.length) {
    console.error(`${problems.length} problem(s):\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log('layout probe: 0 problems at 1366×768 and 1920×1080');
}
