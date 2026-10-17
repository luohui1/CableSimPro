/** Real shared components in the original shell. Fixtures are UI-only, never engineering results. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, '.tmp'), { recursive: true });
const directory = await mkdtemp(join(root, '.tmp', 'ui-controls-'));
const output = join(root, 'test-results', 'visualization');
await mkdir(output, { recursive: true });
let server, browser;
const errors = [], checks = [];
try {
  const tokens = (await readFile(join(root, '..', 'design', 'tokens.css'), 'utf8')).replace(/^@import.*$/gm, '');
  await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><title>公共交互回归 / 合成界面输入</title><style>${tokens}</style><div id="root"></div><script type="module" src="./entry.tsx"></script></html>`);
  await writeFile(join(directory, 'entry.tsx'), `import{StrictMode,useState}from'react';import{createRoot}from'react-dom/client';import{createRootRoute,createRouter,createMemoryHistory,RouterProvider}from'@tanstack/react-router';
import{AppShell}from'@/components/app-shell';import{DataTable}from'@/components/data-table';import{PropertyPanel}from'@/components/property-panel';import{Button}from'@/components/ui/button';import{Dialog}from'@/components/ui/dialog';import{NumberField}from'@/components/ui/number-field';import{EmptyState}from'@/components/states';import'@fontsource/noto-sans-sc/400.css';import'@fontsource/noto-sans-sc/600.css';import'@/styles/theme.css';import'@/styles/research.css';
const records=[1,2,3].map(i=>({id:String(i),name:'记录 '+i}));
function App(){const[open,setOpen]=useState(false),[theme,setTheme]=useState('light'),[collapsed,setCollapsed]=useState(true),[value,setValue]=useState(12.3456789),[counts,setCounts]=useState({first:0,second:0,inline:0,saves:0,commits:0,native:0});
const add=key=>setCounts(previous=>({...previous,[key]:previous[key]+1}));const columns=[{id:'name',label:'名称',render:row=>row.name},{id:'action',label:'行内操作',render:row=><><button type="button" onClick={()=>add('inline')}>内联操作 {row.id}</button><label><input type="checkbox"/>勾选 {row.id}</label></>}];
return <><AppShell title="公共交互回归 · 长标题保持原工程工作区结构" status={<span>合成界面输入 / 未运行求解器</span>} theme={theme} onTheme={()=>{const next=theme==='light'?'dark':'light';setTheme(next);document.documentElement.dataset.theme=next;}} onUnavailable={()=>{}} actions={<Button onClick={()=>setOpen(true)}>打开表单</Button>} sidebar={<><button type="button" className="module-item">研究输入</button><button type="button" className="module-item">研究结果</button></>} propertyCollapsed={collapsed} property={<PropertyPanel title="长名称与来源字段" collapsed={collapsed} onToggle={()=>setCollapsed(v=>!v)} groups={[{label:'显示信息',items:[{label:'输入摘要',value:'0123456789abcdef'.repeat(6)},{label:'名称',value:'带有完整来源信息的工程对象'.repeat(8)},{label:'数值',value:'12.3456789',unit:'m'}]}]}/>}
><div className="input-module"><p>公共组件交互回归，以下为测试记录。</p><div>{Object.entries(counts).map(([key,n])=><output key={key} data-counter={key}>{n}</output>)}<output data-committed-value>{String(value)}</output></div>{['first','second'].map(key=><section key={key} aria-label={key==='first'?'第一张表':'第二张表'}><DataTable label="相同表格名称" columns={columns} groups={[{id:'same',label:'记录组',rows:records}]} rowLabel={row=>row.name} onSelect={()=>add(key)} onActivate={()=>add(key)}/></section>)}
<section aria-label="无分组标题表"><DataTable label="不显示组标题" showGroups={false} columns={[columns[0]]} groups={[{id:'collapsed',label:'默认收起',defaultCollapsed:true,rows:[{id:'visible',name:'仍可见的原始记录'}]}]} rowLabel={row=>row.name}/></section>
<section aria-label="长表"><DataTable label="全部原始记录" showGroups={false} columns={[columns[0]]} groups={[{id:'long',label:'长表',rows:Array.from({length:40},(_,i)=>({id:String(i),name:'记录 '+i}))}]} rowLabel={row=>row.name}/></section><EmptyState/></div></AppShell>
<Dialog open={open} onOpenChange={setOpen} title="表单交互核对" description="验证输入法、校验与焦点；不会写入工程数据。" initialFocus="form" actions={<Button variant="primary" onClick={()=>add('saves')}>确认测试输入</Button>}><div className="input-module"><input aria-label="禁用的首个输入" disabled defaultValue="不可编辑"/><NumberField label="测试温度" value={value} unit="°C" precision={2} min={0} max={90} required onCommit={next=>{setValue(next);add('commits');}}/><label className="text-field">普通文本<input aria-label="普通文本"/></label><form onSubmit={event=>{event.preventDefault();add('native');}}><label className="text-field">原生表单<input aria-label="原生表单"/></label></form>{Array.from({length:24},(_,i)=><label className="text-field" key={i}>长表单字段 {i+1}<input aria-label={'长表单字段 '+(i+1)} defaultValue="用于检查滚动，不是工程参数"/></label>)}</div></Dialog></>}
const route=createRootRoute({component:App});const router=createRouter({routeTree:route,history:createMemoryHistory({initialEntries:['/']})});createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>);`);
  server = await createServer({ configFile: false, root, plugins: [react(), tailwind()], optimizeDeps: { entries: [join(directory, 'index.html')] }, resolve: { alias: { '@': join(root, 'src') } }, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '..')] } } });
  await server.listen();
  const address = server.httpServer.address(); assert(address && typeof address === 'object');
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', item => { if (item.type() === 'error') errors.push(item.text()); });
  await page.goto(`http://127.0.0.1:${address.port}/.tmp/${basename(directory)}/index.html`);
  await expect(page.locator('.app-shell')).toHaveCount(1);
  const first = page.getByRole('region', { name: '第一张表', exact: true }), second = page.getByRole('region', { name: '第二张表', exact: true });
  const counter = key => page.locator(`[data-counter="${key}"]`);
  await first.getByRole('button', { name: '内联操作 1', exact: true }).click();
  await first.getByLabel('勾选 1', { exact: true }).check();
  await expect(counter('inline')).toHaveText('1'); await expect(counter('first')).toHaveText('0');
  checks.push('nested button and checkbox label do not activate their data row');
  await second.getByRole('row', { name: '记录 1', exact: true }).focus();
  await page.keyboard.press('ArrowDown'); await expect(second.getByRole('row', { name: '记录 2', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(second.getByRole('row', { name: '记录 3', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await expect(second.getByRole('row', { name: '记录 1', exact: true })).toBeFocused();
  await expect(counter('first')).toHaveText('0');
  assert.equal(await second.locator('tr.data-row[tabindex="0"]').count(), 1);
  checks.push('duplicate table labels and record IDs keep local roving keyboard focus');
  await expect(page.getByText('仍可见的原始记录', { exact: true })).toBeVisible();
  assert.equal(await page.getByRole('region', { name: '长表', exact: true }).locator('tr.data-row').count(), 40);
  checks.push('headerless groups remain readable and long tables retain all records');
  const open = page.getByRole('button', { name: '打开表单', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: '表单交互核对', exact: true });
  const numeric = dialog.getByLabel('测试温度', { exact: true });
  await expect(numeric).toBeFocused();
  await numeric.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  await expect(counter('commits')).toHaveText('0'); await expect(counter('saves')).toHaveText('0');
  await numeric.press('Enter'); await expect(counter('commits')).toHaveText('1');
  await expect(page.locator('[data-committed-value]')).toHaveText('12.3456789'); await expect(counter('saves')).toHaveText('0');
  checks.push('autofocus skips disabled fields; IME and rounded displays preserve original precision');
  await numeric.fill('not-a-number'); await numeric.press('Enter');
  await expect(numeric).toHaveAttribute('aria-invalid', 'true'); await expect(counter('saves')).toHaveText('0');
  await numeric.press('Escape'); await expect(dialog).toBeVisible(); await expect(numeric).toHaveValue('12.35');
  await numeric.press('Escape'); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
  checks.push('invalid values cannot confirm; first Escape restores numeric text, second closes with focus return');
  await open.click();
  await dialog.getByLabel('普通文本', { exact: true }).dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true });
  await expect(counter('saves')).toHaveText('0');
  await dialog.getByLabel('普通文本', { exact: true }).press('Enter'); await expect(counter('saves')).toHaveText('1');
  await dialog.getByLabel('原生表单', { exact: true }).press('Enter'); await expect(counter('native')).toHaveText('1'); await expect(counter('saves')).toHaveText('1');
  checks.push('plain text keeps Enter confirmation and native forms submit exactly once');
  await page.setViewportSize({ width: 360, height: 800 });
  const footer = await dialog.locator('.dialog-actions').boundingBox(); assert(footer && footer.y >= 0 && footer.y + footer.height <= 801, 'Dialog actions must stay inside the viewport');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(dialog).toHaveCount(0);
  checks.push('long dialog scrolls its body without hiding the actions');
  for (const width of [640, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.getByRole('complementary', { name: '模块导航', exact: true });
    await page.getByRole('button', { name: '模块导航', exact: true }).click(); await expect(nav).toBeVisible();
    await nav.getByRole('button', { name: '研究输入', exact: true }).focus(); await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '模块导航', exact: true })).toBeFocused(); await expect(nav).not.toBeVisible();
    await page.getByRole('button', { name: '展开属性面板', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '所选对象属性', exact: true })).toBeVisible();
    const pane = await page.locator('.property-panel').boundingBox(); assert(pane && pane.width <= width && pane.height <= 900 * .35 + 1);
    await page.getByRole('button', { name: '收起属性面板', exact: true }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Document overflow at ${width}px`);
  }
  checks.push('640/360/320px navigation and inspectors remain accessible, without page overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const skip = page.getByRole('link', { name: '跳到工作区', exact: true }); await skip.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.main-content')).toBeFocused();
  checks.push('theme control and skip link keep the original shell and route');
  await page.screenshot({ path: join(output, 'shared-controls-desktop.png'), fullPage: false });
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log(JSON.stringify({ status: 'passed', checks, errors, scope: 'Shared production components; UI-only fixtures, not solver or numerical validation' }, null, 2));
} catch (error) { console.error(JSON.stringify({ status: 'failed', checks, errors }, null, 2)); throw error; }
finally { await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
