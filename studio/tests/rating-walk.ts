// The rating workbench used the way an engineer uses it, in a real browser with the real host and core, at 1366×768 and
// 1920×1080: a new project from a cable of the library, the check, reading the answer, changing a condition and checking
// again, sweeping a condition, choosing a section for a target current, switching between the records, taking the sheet;
// then the layouts that draw several cables, circuits and ducts, and the changes made on the drawing itself.
// Every step saves a screenshot and runs the layout probe (tests/probe.ts).
//
//   npm run build && node tests/rating-walk.ts [output folder]
//   CABLE_STUDIO_WALK_BASE=http://127.0.0.1:8214 CABLE_STUDIO_WALK_MODEL=<library id> node tests/rating-walk.ts   (a host already running)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createApp } from '../host/server.ts';
import type { ProjectView, RunRecord } from '../shared/types.ts';
import { probe } from './probe.ts';

/** The cable the walk starts from: a public three-core 3×240 that comes with the software. */
const MODEL = process.env.CABLE_STUDIO_WALK_MODEL ?? 'huayuan.yjv22-15kv-240';

export async function walkRating(browser: Browser, base: string, out: string, problems: string[], model = MODEL) {
  const get = async <T>(path: string): Promise<T> => (await fetch(`${base}${path}`)).json() as Promise<T>;
  const op = async <T>(id: string, params: unknown): Promise<T> => {
    const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json();
    if (!response.ok) throw new Error(`${id}: ${JSON.stringify(body)}`);
    return body as T;
  };

  // Three layouts that draw more than one cable, each checked by the real method: three single-core cables in trefoil (no
  // field published), three three-core circuits in a row (with a field), and single-core cables in ducts (the air and wall
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
    const page: Page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => problems.push(`${width} page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`${width} console error: ${message.text()}`); });
    const check = async (label: string) => {
      await page.waitForTimeout(650);
      await page.screenshot({ path: join(out, `${width}-${label}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} ${label}: ${issue}`);
    };
    const projectId = () => /\/p\/(p-[0-9a-f]+)/.exec(page.url())![1];
    const view = (id = projectId()) => get<ProjectView>(`/api/projects/${id}`);
    const shownNumber = async () => Number(await page.locator('.text-metric').first().innerText());
    const gpuReady = async () => {
      await page.waitForSelector('[data-gpu]:not([data-gpu="pending"])');
      if ((await page.getAttribute('[data-gpu]', 'data-gpu')) === 'none') problems.push(`${width}: the GPU layer did not start`);
    };
    const waitFor = async (what: string, done: () => Promise<boolean>) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await done()) return;
        await page.waitForTimeout(150);
      }
      throw new Error(`timed out: ${what}`);
    };

    // 1. A new project from a cable of the library: the address carries the cable, the form is filled by the host.
    await page.goto(`${base}/workbench?model=${encodeURIComponent(model)}`);
    await page.getByRole('button', { name: '创建工程' }).waitFor();
    await page.getByText('敷设方式', { exact: true }).waitFor();
    await check('new-project');
    const name = `走查 ${width}`;
    await page.getByLabel('工程名称').fill(name);
    await page.getByRole('button', { name: /^三芯直埋 · 单回/ }).click();
    await page.getByLabel('土壤热阻率').fill('1');
    await page.getByLabel('负荷电流').fill('300');
    await page.getByRole('button', { name: '创建工程' }).click();
    await page.waitForURL(/\/p\/p-/);
    await page.getByRole('button', { name: '运行校核' }).waitFor();
    await gpuReady();
    const created = await view();
    assert.equal(created.meta.name, name);
    assert.equal(created.parts.installation.layout, 'three_core_buried_single');
    assert.equal(created.parts.conditions.currents_a[0], 300);
    assert.equal(created.runs.length, 0, 'a new project has no record: nothing has been run');
    await check('project-empty');

    // 2. The check: the copper button is the next step, and the answer on the screen is the host's number.
    await page.getByRole('button', { name: '运行校核' }).click();
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    const first = (await view()).runs[0];
    const record = await get<RunRecord>(`/api/projects/${projectId()}/runs/${first.id}`);
    assert.equal(record.status, 'succeeded');
    const ampacity = record.summary!.ampacity!.value_a;
    assert.equal(await shownNumber(), Number(ampacity.toFixed(1)), 'the allowed current on the screen is the one the method saved');
    const limiting = record.summary!.operating!.cables.find(cable => cable.id === record.summary!.ampacity!.limiting_cable)!;
    await page.getByText(`${limiting.conductor_c.toFixed(1)} / ${limiting.limit_c}`).first().waitFor();
    await page.getByText('先到温限', { exact: true }).waitFor();
    const margin = record.summary!.circuits![0].margin_a!;
    await page.getByText(`余量 ${Math.abs(margin).toFixed(1)} A`).waitFor();
    await check('result');

    await page.getByRole('button', { name: '电缆簇' }).click();
    await check('result-cluster');
    const cable = await page.locator('[data-cable]').first().boundingBox();
    if (!cable) throw new Error('no cable on the drawing');
    await page.mouse.click(cable.x + cable.width / 2, cable.y + cable.height / 2);
    await page.getByRole('button', { name: '算法与可信度' }).click();
    await check('result-method');
    await page.getByRole('button', { name: '全景' }).click();
    await page.getByRole('button', { name: '放大' }).click();
    await page.getByRole('button', { name: '回到这个视图的全貌' }).click();

    // 3. Every given opens its editor; nothing is changed by looking.
    for (const given of ['型号', '敷设', '埋深', '土壤热阻率', '环境', '负荷', '系统', '护套', '方法']) {
      await page.getByRole('button', { name: new RegExp(`^${given}`) }).first().click();
      await page.getByRole('dialog').waitFor();
      await check(`given-${given}`);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
    assert.equal((await view()).inputs_sha256, created.inputs_sha256, 'opening an editor changes nothing');

    // 4. Change one condition: the given is marked, the answer is marked out of date, and the copper button asks for a new check.
    await page.getByRole('button', { name: /^土壤热阻率/ }).click();
    await page.getByRole('textbox', { name: '土壤热阻率' }).fill(width === 1366 ? '1.6' : '1.4');
    await page.getByRole('button', { name: '应用' }).click();
    await page.getByText('条件已改 · 已过期').waitFor();
    await page.getByRole('button', { name: '运行校核' }).waitFor();
    await page.getByRole('button', { name: /^土壤热阻率.*已改/ }).waitFor();
    assert.equal((await view()).parts.conditions.soil_thermal_resistivity, width === 1366 ? 1.6 : 1.4);
    assert.equal(await shownNumber(), Number(ampacity.toFixed(1)), 'the old answer stays until it is run again');
    await check('changed');
    await page.getByRole('button', { name: '运行校核' }).click();
    // The old record keeps a quiet sheet button of its own; the answer is new when its out-of-date mark is gone.
    await page.getByText('条件已改 · 已过期').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    assert.ok(await shownNumber() < Number(ampacity.toFixed(1)), 'a worse soil carries less');
    await check('result-again');

    // 5. Sweep one condition: a curve and a table, saved as a record that opens at its own address.
    await page.getByRole('button', { name: '扫一个条件' }).click();
    const points = Number(await page.getByRole('textbox', { name: '点数' }).inputValue());
    await check('sweep-form');
    await page.getByRole('button', { name: '运行扫描' }).click();
    await page.waitForURL(/run=run-/);
    await page.getByRole('img', { name: /变化时的允许电流曲线/ }).waitFor();
    const sweep = (await view()).runs.find(run => run.kind === 'sweep')!;
    assert.equal(await page.locator('table tbody tr').count(), points, 'one row for each point of the sweep');
    await check('sweep');
    assert.ok(sweep.id);

    // 6. Choose a section for a target current.
    await page.getByRole('button', { name: '选截面' }).click();
    await page.getByRole('textbox', { name: '目标电流' }).fill('300');
    await page.getByRole('button', { name: '运行选型' }).click();
    await page.getByText(/^选中 /).waitFor();
    await check('selection');

    // 7. The records: the list, and opening the one of the check as it was.
    await page.getByRole('button', { name: /^运行记录 \d/ }).click();
    await page.getByRole('dialog').waitFor();
    await check('runs');
    const rating = (await view()).runs.filter(run => run.kind === 'rating')[0];
    await page.getByRole('row', { name: new RegExp(`#${rating.sequence}\\s`) }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByText('允许电流', { exact: true }).first().waitFor();
    assert.ok(page.url().includes(`run=${rating.id}`));
    await check('record-opened');

    // 8. The sheet: the copper button of a current, successful record opens the printable calculation sheet.
    await page.getByRole('button', { name: /^运行记录 \d/ }).click();
    await page.getByRole('row', { name: new RegExp(`#${rating.sequence}\\s`) }).click();
    const sheetButton = page.getByRole('button', { name: '导出计算书' });
    await sheetButton.waitFor();
    const [sheet] = await Promise.all([page.context().waitForEvent('page'), sheetButton.click()]);
    await sheet.waitForLoadState();
    assert.match(await sheet.locator('body').innerText(), new RegExp(`允许电流 ${(await shownNumber()).toFixed(1)} A`));
    assert.match(sheet.url(), new RegExp(`/api/projects/${projectId()}/reports/${rating.id}`));
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
      const states = (await get<RunRecord>(`/api/projects/${id}/runs/${saved.runs[0].id}`)).summary!.operating!.cables;
      assert.equal(await page.locator('[data-cable]').count(), states.length, 'a cable is drawn for each state of the run');
      if (label === 'trefoil') await page.getByRole('row', { name: /A 相/ }).waitFor();
      // The allowed current of several circuits is the one they have together: no margin is claimed beside it.
      if (label === 'row' || label === 'mixed') assert.equal(await page.getByText('余量').count(), 0, `${label}: a margin beside the allowed current of all circuits`);
      if (label === 'mixed') {
        // The hottest cable is the method's, not the one that reaches its limit first at the allowed current, and the load that is too high is said.
        const rated = (await get<RunRecord>(`/api/projects/${id}/runs/${saved.runs[0].id}`)).summary!;
        assert.equal(rated.operating!.within_limit, false);
        await page.getByText(/已经超过温限/).waitFor();
        await page.getByText(`导体温度 · 回路 ${/c(\d)/.exec(rated.operating!.hottest_cable!)![1]}`).waitFor();
        await check('mixed-over-limit');
      }
      if (label === 'ducts') {
        await page.getByRole('button', { name: /^埋深/ }).click();
        await page.getByRole('textbox', { name: '管内径' }).waitFor();
        await check('ducts-depth-editor');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.getByText('T₄ 管内空气').waitFor();
      }
    }

    // 10. Changes made on the drawing itself: type the depth in its capsule, drag the outer cable, undo both.
    await page.goto(`${base}/p/${row}`);
    await gpuReady();
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    const original = await view(row);
    const depth = width === 1366 ? 1.5 : 1.3;
    await page.locator('[data-dimension="depth"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1.9');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    assert.equal((await view(row)).parts.installation.depth_m, original.parts.installation.depth_m, 'Escape on the capsule keeps the depth as it was');
    await page.locator('[data-dimension="depth"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(depth));
    await page.keyboard.press('Enter');
    await page.getByText('条件已改 · 已过期').waitFor();
    await page.getByRole('button', { name: '运行校核' }).waitFor();
    assert.equal((await view(row)).parts.installation.depth_m, depth, 'the depth typed on the drawing is the one saved');
    await page.getByText(`中心埋深 ${depth} m`).waitFor();
    await check('canvas-depth');

    const before = (await view(row)).preview?.layout.spacing ?? 0;
    const target = await page.locator('[data-cable]').last().boundingBox();
    if (!target) throw new Error('no cable to drag');
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2 + 60, target.y + target.height / 2, { steps: 8 });
    await page.screenshot({ path: join(out, `${width}-canvas-dragging.png`) });
    await page.mouse.up();
    await waitFor('the spacing widened', async () => ((await view(row)).preview?.layout.spacing ?? 0) > before);
    await check('canvas-drag');

    // Undo takes both changes back, and the record of the check is the current answer again.
    await page.locator('[data-gpu]').click({ position: { x: 300, y: 250 } });
    await page.keyboard.press('Control+Z');
    await waitFor('the first undo', async () => ((await view(row)).preview?.layout.spacing ?? 0) <= before + 1e-9);
    await page.keyboard.press('Control+Z');
    await waitFor('the second undo', async () => (await view(row)).inputs_sha256 === original.inputs_sha256);
    await page.getByRole('button', { name: '导出计算书' }).waitFor();
    await check('canvas-undone');

    // 11. A project with only a sweep: its records can be reached and the answer says that no check has been run; an address
    //     that names a record the project does not have says so; a method parameter and a cable of another core count are
    //     changed and taken back.
    await page.goto(`${base}/p/${sweepOnly}`);
    await page.getByRole('button', { name: /^运行记录 \d · 扫描/ }).waitFor();
    await page.getByText('还没有校核', { exact: true }).first().waitFor();
    await check('only-sweep');
    await page.goto(`${base}/p/${sweepOnly}?run=run-00000000`);
    await page.getByText('没有这条运行记录').waitFor();
    await check('unknown-record');
    await page.getByRole('button', { name: '回到现在' }).click();
    await page.waitForURL(url => !url.search.includes('run='));

    const eddy = async () => ((await view(sweepOnly)).preview?.parameters as { eddy?: string }).eddy;
    const eddyBefore = await eddy();
    await page.getByRole('button', { name: /^护套/ }).click();
    await page.getByRole('button', { name: eddyBefore === 'trefoil' ? '不计' : '计入' }).click();
    await page.getByRole('button', { name: '应用' }).click();
    await waitFor('the eddy losses changed', async () => (await eddy()) !== eddyBefore);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.keyboard.press('Control+Z');
    await waitFor('the first change of a method parameter taken back', async () => (await eddy()) === eddyBefore);

    const beforeCable = await view(sweepOnly);
    await page.getByRole('button', { name: /^型号/ }).click();
    await page.getByRole('dialog').getByPlaceholder('搜索型号或系列').fill('YJL02');
    await page.getByRole('dialog').getByRole('row', { name: /YJL02.*1×240/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: '应用' }).click();
    await waitFor('a single-core cable', async () => (await view(sweepOnly)).parts.cable.summary.cores === 1);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.notEqual((await view(sweepOnly)).parts.installation.layout, beforeCable.parts.installation.layout);
    await check('cable-changed');
    await page.keyboard.press('Control+Z');
    await waitFor('the cable and its laying back', async () => (await view(sweepOnly)).inputs_sha256 === beforeCable.inputs_sha256);
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
