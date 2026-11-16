// The rating workbench used the way an engineer uses it, in a real browser with the real host and core, at 1366×768 and
// 1920×1080: a new project from a cable of the library, the check, reading the answer, changing a condition and checking
// again, sweeping a condition, choosing a section for a target current, switching between the records, taking the sheet.
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
    const view = () => get<ProjectView>(`/api/projects/${projectId()}`);
    const shownNumber = async () => Number(await page.locator('.text-metric').first().innerText());
    const gpuReady = async () => {
      await page.waitForSelector('[data-gpu]:not([data-gpu="pending"])');
      if ((await page.getAttribute('[data-gpu]', 'data-gpu')) === 'none') problems.push(`${width}: the GPU layer did not start`);
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
