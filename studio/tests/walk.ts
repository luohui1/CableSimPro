// Hands-on walk: the real host, computing core and clicks on desktop, plus the product library at 390×844.
// Every step saves a screenshot and runs a layout probe: no label on the drawing may overlap another label or a tool,
// and no text may be cut off unless it ends in an ellipsis on purpose.
//
//   npm run build && npm run walk [output folder]
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createApp } from '../host/server.ts';
import type { ProjectView, RunRecord, SeriesDeclaration, TableInspection } from '../shared/types.ts';

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

// The library screen reads an actual imported workbook, not hand-authored rows.
const sample = await op<{ upload: string; declarations: { sheet: string; series: SeriesDeclaration }[] }>('library.import.sample', {});
const uploadDir = join(home, 'uploads', sample.upload);
copyFileSync(join(uploadDir, readdirSync(uploadDir)[0]), join(out, '人民电缆公开结构表.xlsx'));
let imported = 0;
let armoured = '';
for (const declaration of sample.declarations.filter(item => /^表[123] /.test(item.sheet))) {
  const inspection = await op<TableInspection>('library.import.inspect', { upload: sample.upload, designation: declaration.series.designation });
  const sheet = inspection.sheets.find(item => item.name === declaration.sheet)!;
  const result = await op<{ imported: number }>('library.import.commit', { upload: sample.upload, sheet: sheet.name, first_data_row: sheet.first_data_row,
    mapping: Object.fromEntries(sheet.columns!.filter(column => column.suggested).map(column => [column.suggested!, column.index])), series: declaration.series });
  imported += result.imported;
  if (declaration.series.designation === 'YJV22') armoured = declaration.series.name;
}
if (imported !== 35) throw new Error(`expected 35 real imported specifications, got ${imported}`);

/** Runs in the page: returns one line per layout problem. */
function probe(): string[] {
  const issues: string[] = [];
  const box = (element: Element) => element.getBoundingClientRect();
  const shown = (element: Element) => {
    const rect = box(element);
    const style = getComputedStyle(element);
    // Screen-reader labels are intentionally clipped to a 1px box; they are not visible text overflow.
    const screenReaderOnly = style.position === 'absolute' && rect.width <= 1 && rect.height <= 1
      && (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)');
    if (screenReaderOnly) return false;
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

  const labels = [...document.querySelectorAll('[data-chip], [data-dimension], svg[role="img"] text')].filter(shown);
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
  for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844]] as const) {
    const page: Page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => problems.push(`${width} page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`${width} console error: ${message.text()}`); });
    const check = async (label: string) => {
      await page.waitForTimeout(650);
      await page.screenshot({ path: join(out, `${width}-${label}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} ${label}: ${issue}`);
    };

    await page.goto(base);
    await page.waitForURL('**/library');
    const search = page.getByRole('searchbox', { name: '搜索产品系列' });
    await search.fill('人民电缆');
    await page.getByRole('button', { name: /^全部规格\s*35$/ }).waitFor();
    await page.getByRole('button', { name: /^草稿\s*35$/ }).click();
    if (await page.getByRole('button', { name: /^查看规格：/ }).count() !== 3) problems.push(`${width} library: expected three imported series`);
    await check('library');

    await search.fill('不存在的本厂型号');
    await page.getByRole('heading', { name: '没有匹配的系列' }).waitFor();
    await check('library-empty');
    const searchBox = await search.boundingBox();
    if (!searchBox) throw new Error('search field is not visible');
    await search.click({ position: { x: searchBox.width - 9, y: searchBox.height / 2 } });
    if (await search.inputValue() !== '') problems.push(`${width} library: search clear control did not clear the query`);
    await page.getByRole('button', { name: /^草稿\s*35$/ }).waitFor();
    await search.fill('不存在的本厂型号');
    await page.getByRole('heading', { name: '没有匹配的系列' }).waitFor();
    await page.getByRole('button', { name: '清除筛选' }).click();
    await search.fill('人民电缆');
    await page.getByRole('button', { name: `查看规格：${armoured}` }).click();
    const specification = page.getByRole('button', { name: '3×240，第 1 版，草稿，打开断面工作台' });
    await specification.waitFor();
    await check('library-specifications');
    await page.getByText('系列声明与资料来源', { exact: true }).click();
    await page.getByText('系列声明与资料来源', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await check('library-source');
    if (width === 390) {
      await page.close();
      continue;
    }
    await specification.click();
    await page.waitForURL('**/p/*');
    const opened = await (await fetch(`${base}/api/projects/${new URL(page.url()).pathname.split('/').at(-1)}`)).json() as ProjectView;
    if (!opened.parts.cable.name.includes('3×240')) problems.push(`${width} library: opened a different specification`);
    await page.getByRole('link', { name: '产品库', exact: true }).click();
    await page.waitForURL('**/library');

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
      await page.getByRole('tab', { name: '选中的电缆' }).click();
      await check(`${name}-object`);

      await page.getByRole('button', { name: /^带满/ }).click();
      await page.getByRole('tab', { name: '为什么是这个数' }).click();
      await check(`${name}-rated`);
      await page.getByRole('button', { name: /^现在 / }).click();

      await page.getByRole('tab', { name: '算法和可信度' }).click();
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

    // Changing the inputs on the screen. Every change is answered by a draft; keeping the draft makes a record.
    await page.goto(`${base}/p/${row}`);
    await page.waitForSelector('[data-gpu]:not([data-gpu="pending"])');
    const inputs = async () => (await (await fetch(`${base}/api/projects/${row}`)).json()) as ProjectView;
    const drafted = () => page.getByText('草算，还没存').waitFor();

    const depth = width === 1366 ? 1.5 : 1.3;
    await page.locator('[data-dimension="depth"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(depth));
    await page.keyboard.press('Enter');
    await drafted();
    await check('edit-depth');
    if ((await inputs()).parts.installation.depth_m !== depth) problems.push(`${width} edit: the depth typed on the drawing was not saved`);

    const outer = await page.locator('[data-cable]').last().boundingBox();
    if (!outer) throw new Error('no cable to drag');
    const before = (await inputs()).preview?.layout.spacing ?? 0;
    await page.mouse.move(outer.x + outer.width / 2, outer.y + outer.height / 2);
    await page.mouse.down();
    await page.mouse.move(outer.x + outer.width / 2 + 60, outer.y + outer.height / 2, { steps: 8 });
    await page.screenshot({ path: join(out, `${width}-edit-dragging.png`) });
    await page.mouse.up();
    await drafted();
    await check('edit-drag');
    const after = (await inputs()).parts.installation.spacing_m ?? 0;
    if (!(after > before)) problems.push(`${width} edit: dragging the outer cable outward did not widen the spacing (${before} -> ${after})`);

    const load = width === 1366 ? 320 : 310;
    await page.getByRole('button', { name: /^工况/ }).first().click();
    await page.getByLabel(/负荷电流$/).first().fill(String(load));
    await page.getByLabel(/负荷电流$/).first().press('Enter');
    await drafted();
    await check('edit-load');
    await page.keyboard.press('Escape');
    if ((await inputs()).parts.conditions.currents_a[0] !== load) problems.push(`${width} edit: the load typed in the conditions was not saved`);

    await page.locator('[data-gpu]').click({ position: { x: 300, y: 250 } });
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(900);
    if ((await inputs()).parts.conditions.currents_a[0] === load) problems.push(`${width} edit: Ctrl+Z did not undo the load change`);
    await drafted();

    const records = (await inputs()).runs.length;
    await page.getByRole('button', { name: '存为记录' }).click();
    await page.getByRole('button', { name: '出计算书' }).waitFor();
    await check('edit-kept');
    if ((await inputs()).runs.length !== records + 1) problems.push(`${width} edit: keeping the draft did not add a run record`);
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
console.log('layout probe: 0 problems at 1366×768 and 1920×1080; product library also checked at 390×844');
