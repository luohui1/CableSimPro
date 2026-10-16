/** Actual React/WebGL browser regression; synthetic fixtures, no solver or engineering DB. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, '.tmp'), { recursive: true });
const directory = await mkdtemp(join(root, '.tmp', 'visual-browser-'));
const output = join(root, 'test-results', 'visualization');
await mkdir(output, { recursive: true });
let server, browser;
const errors = [], checks = [];
try {
  const tokens = (await readFile(join(root, '..', 'design', 'tokens.css'), 'utf8')).replace(/^@import.*$/gm, '');
  await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><title>CableSimPro 可视化回归</title><style>${tokens}\n*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--text);font:var(--text-body) var(--font-ui)}.fixture-banner{padding:var(--space-4);border-bottom:1px solid var(--border)}.fixture-banner button{margin-right:var(--space-2)}main{padding:var(--space-4);max-width:1600px;margin:auto}#selection{display:block;padding:var(--space-2)}</style><div id="root"></div><script type="module" src="./entry.tsx"></script></html>`);
  await writeFile(join(directory, 'entry.tsx'), `import {StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';import{StudyVisualWorkbench}from '@/features/thermal-workbench';import{makeRun}from '../../scripts/visualization-fixture.mjs';
function App(){const [run,setRun]=useState(makeRun),[mounted,setMounted]=useState(true),[selection,setSelection]=useState('');return <><header className="fixture-banner"><strong>CableSimPro / 合成界面测试数据，不是工程结果</strong><div><button onClick={()=>setRun(makeRun())}>恢复测试输入</button><button onClick={()=>setRun({...makeRun(),integrity:'invalid'})}>测试损坏输入</button><button onClick={()=>setMounted(v=>!v)}>切换挂载</button></div><output id="selection">{selection}</output></header><main>{mounted&&<StudyVisualWorkbench run={run} onSelect={s=>setSelection(s.title)}/>}</main></>};createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);`);
  // The test entry uses real production components without the unrelated native OCCT build chain.
  server = await createServer({ configFile: false, root, plugins: [react()], resolve: { alias: { '@': join(root, 'src') } }, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === 'object');
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `http://127.0.0.1:${address.port}/.tmp/${directory.split(/[\\/]/).at(-1)}/index.html`;
  await page.goto(url);
  const ready = () => expect(page.locator('[data-surface-state]')).toHaveAttribute('data-surface-state', 'ready', { timeout: 20000 });
  await ready(); checks.push('React StrictMode / real WebGL2 first display');
  assert.equal(await page.locator('canvas').evaluate(c => c.getContext('webgl2').getError()), 0);
  await page.getByRole('button', { name: 'B 相', exact: true }).click();
  await expect(page.getByRole('group', { name: /^B 相径向热阻网络/ })).toBeVisible();
  await page.getByRole('group', { name: /^B 相径向热阻网络/ }).getByRole('button').first().click();
  await expect(page.locator('#selection')).toContainText('B 相');checks.push('3D object / network phase / property selection');
  const canvas = page.locator('canvas'), box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);await page.mouse.down();await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 8 });await page.mouse.up();
  await page.getByRole('button', { name: '端面', exact: true }).click();await page.getByRole('button', { name: '轴测', exact: true }).click();
  await page.getByLabel('场景剖切位置', { exact: true }).press('Home');await page.getByLabel('场景剖切位置', { exact: true }).press('ArrowRight');await ready();checks.push('orbit / camera presets / clip');
  await expect(page.locator('[data-time-cursor]')).toHaveText('0 s');
  await page.getByRole('button', { name: '下一个保存时间步' }).click();await expect(page.locator('[data-time-cursor]')).toHaveText('25 s');await expect(page.locator('[data-time-value]')).toHaveText('37 °C');
  await page.getByLabel('动态曲线对象', { exact: true }).selectOption('phase:B');await expect(page.locator('[data-time-value]')).toHaveText('20 °C');await expect(page.getByText('0 s · 保持前值', { exact: true })).toBeVisible();checks.push('irregular time steps / Celsius / sample-and-hold');
  await page.getByLabel('回放速度', { exact: true }).selectOption('3600');await page.getByRole('button', { name: '播放', exact: true }).click();await expect(page.locator('[data-time-cursor]')).toHaveText('500 s');await expect(page.getByRole('button', { name: '重播', exact: true })).toHaveAttribute('aria-pressed', 'false');checks.push('physical-time playback / stop at end');
  await page.getByLabel('可视化工况', { exact: true }).selectOption('display-b');await ready();await expect(page.locator('[data-time-cursor]')).toHaveText('0 s');checks.push('case-scoped reset');
  await page.getByRole('button', { name: '保存场图', exact: true }).click();await ready();await expect(page.getByText('固定场快照 · 节点间线性着色 · 非动态三维场', { exact: true })).toBeVisible();checks.push('saved 2D field / fixed scientific color scale');
  await page.getByRole('button', { name: '结构', exact: true }).click();await ready();
  await page.getByText(/^原始时间步与导出/).click();const download = page.waitForEvent('download');await page.getByRole('button', { name: '导出此曲线 CSV', exact: true }).click();const file = await download;const stream = await file.createReadStream();let csv='';for await(const chunk of stream)csv+=chunk;assert(csv.includes('time_s,maximum_temperature_c'));assert(csv.includes('25,37'));checks.push('numeric-only CSV with declared units');
  await page.getByText(/^原始时间步与导出/).click();
  await page.screenshot({ path: join(output, 'workbench-light.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');await ready();await page.screenshot({ path: join(output, 'workbench-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 640, height: 1000 });await ready();assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Narrow viewport has horizontal overflow');await page.screenshot({ path: join(output, 'workbench-narrow.png'), fullPage: true });checks.push('light / dark / 640px layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();await page.getByRole('button', { name: '下一个保存时间步' }).click();await expect(page.locator('[data-time-cursor]')).toHaveText('25 s');checks.push('reduced-motion accessible stepping');
  await page.setViewportSize({ width: 1440, height: 1080 });
  await canvas.evaluate(c => { const extension=c.getContext('webgl2').getExtension('WEBGL_lose_context'); if(!extension)throw new Error('Context-loss extension unavailable');extension.loseContext(); });
  await expect(page.getByText('场景暂不可用', { exact: true })).toBeVisible();await page.getByRole('button', { name: '重载场景', exact: true }).click();await ready();checks.push('context loss / retry on fresh canvas');
  await page.getByRole('button', { name: '切换挂载', exact: true }).click();await expect(canvas).toHaveCount(0);await page.getByRole('button', { name: '切换挂载', exact: true }).click();await ready();checks.push('unmount / GPU disposal / remount');
  await page.getByRole('button', { name: '测试损坏输入', exact: true }).click();await expect(page.getByText('可视化不可用', { exact: true })).toBeVisible();await expect(canvas).toHaveCount(0);checks.push('unverified run fails closed');
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log(JSON.stringify({ status: 'passed', checks, errors, scope: 'Synthetic data, real React/WebGL; not complete application or numerical acceptance' }, null, 2));
} finally {
  await browser?.close();await server?.close();await rm(directory, { recursive: true, force: true });
}
