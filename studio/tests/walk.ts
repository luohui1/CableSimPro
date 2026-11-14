// Hands-on walk of the workbench: the real host, the real computing core, real clicks, at 1366×768 and 1920×1080.
// Every step saves a screenshot and runs a layout probe: no label on the drawing may overlap another label or a tool,
// and no text may be cut off unless it ends in an ellipsis on purpose.
//
//   npm run build && npm run walk [output folder]
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createApp } from '../host/server.ts';
import type { ProjectView, RunRecord } from '../shared/types.ts';

const out = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', '.tmp', 'studio-walk'));
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'cable-studio-walk-'));
const app = createApp({ home, runtime: null });
await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

async function op<T>(id: string, params: unknown): Promise<T> {
  const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${id}: ${JSON.stringify(body)}`);
  return body as T;
}

// Two real projects, computed by the real method: a single circuit without a published field, three circuits with one.
const trefoil = (await op<ProjectView>('project.create', { name: '走查 110 kV 品字形', model_id: 'system.yjq02-110kv-800' })).meta.id;
await op('conditions.set', { project: trefoil, currents_a: [600] });
await op<RunRecord>('run.rate', { project: trefoil });
await op<RunRecord>('run.sweep', { project: trefoil, variable: 'soil_thermal_resistivity', values: [1, 1.2, 1.4, 1.6, 1.8, 2] });
const row = (await op<ProjectView>('project.create', { name: '走查 10 kV 三回水平', model_id: 'huayuan.yjv22-15kv-240' })).meta.id;
await op('installation.set', { project: row, layout: 'three_core_buried_horizontal', depth_m: 1.2 });
await op('conditions.set', { project: row, currents_a: [300] });
await op<RunRecord>('run.select', { project: row, target_current_a: 300 });
await op<RunRecord>('run.rate', { project: row });

/** Runs in the page: returns one line per layout problem. */
function probe(): string[] {
  const issues: string[] = [];
  const box = (element: Element) => element.getBoundingClientRect();
  const shown = (element: Element) => {
    const rect = box(element);
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  };
  const cross = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

  for (const element of document.querySelectorAll('body *')) {
    if (!(element instanceof HTMLElement) || element.children.length || !element.textContent?.trim() || !shown(element)) continue;
    const style = getComputedStyle(element);
    if (style.textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible') {
      issues.push(`cut off: "${element.textContent.trim().slice(0, 40)}"`);
    }
    const rect = box(element);
    if (rect.right > innerWidth + 1 || rect.left < -1) issues.push(`outside the window: "${element.textContent.trim().slice(0, 40)}"`);
  }

  const labels = [...document.querySelectorAll('[data-chip], svg[role="img"] text')].filter(shown);
  const tools = [...document.querySelectorAll('[data-overlays] > *')].filter(shown);
  labels.forEach((label, index) => {
    for (const other of labels.slice(index + 1)) {
      if (cross(box(label), box(other))) issues.push(`labels overlap: "${label.textContent}" × "${other.textContent}"`);
    }
    for (const tool of tools) {
      if (cross(box(label), box(tool))) issues.push(`label under a tool: "${label.textContent}"`);
    }
  });
  return issues;
}

const problems: string[] = [];
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const [width, height] of [[1366, 768], [1920, 1080]] as const) {
    const page: Page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => problems.push(`${width} page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`${width} console error: ${message.text()}`); });
    const check = async (label: string) => {
      await page.waitForTimeout(650);
      await page.screenshot({ path: join(out, `${width}-${label}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} ${label}: ${issue}`);
    };

    for (const [name, project] of [['row', row], ['trefoil', trefoil]] as const) {
      await page.goto(`${base}/p/${project}`);
      await page.waitForSelector('[data-gpu]:not([data-gpu="pending"])');
      const gpu = await page.getAttribute('[data-gpu]', 'data-gpu');
      if (gpu === 'none') problems.push(`${width} ${name}: the GPU layer did not start`);
      await check(`${name}-result`);

      await page.getByRole('button', { name: '全景' }).click();
      await check(`${name}-overview`);
      await page.getByRole('button', { name: '电缆簇' }).click();

      const cable = await page.locator('[data-cable]').first().boundingBox();
      if (!cable) throw new Error('no cable on the drawing');
      await page.mouse.click(cable.x + cable.width / 2, cable.y + cable.height / 2);
      await page.getByRole('tab', { name: '对象' }).click();
      await check(`${name}-object`);

      await page.getByRole('button', { name: /^额定/ }).click();
      await page.getByRole('tab', { name: '为什么是这个数' }).click();
      await check(`${name}-rated`);
      await page.getByRole('button', { name: /^保存负荷/ }).click();

      await page.getByRole('tab', { name: '方法' }).click();
      await check(`${name}-method`);

      for (const slot of ['电缆', '敷设', '工况', '方法']) {
        await page.getByRole('button', { name: new RegExp(`^${slot}`) }).first().click();
        await check(`${name}-premise-${slot}`);
        await page.keyboard.press('Escape');
      }

      // The other run of the project: a sweep or a selection.
      await page.getByRole('button', { name: /^#\d/ }).filter({ hasNotText: '校核' }).first().click();
      await check(`${name}-other-run`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await app.close();
  rmSync(home, { recursive: true, force: true });
}

console.log(`screenshots: ${out}`);
if (problems.length) {
  console.error(`${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('layout probe: 0 problems at 1366×768 and 1920×1080');
