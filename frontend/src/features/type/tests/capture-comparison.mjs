import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openHeadlessBrowser, settle } from '../../../../scripts/browser.mjs';
import { root, output } from './fixture.mjs';

const directory = path.join(output, 'comparisons'); await fs.mkdir(directory, { recursive: true });
const base = process.env.WORKBENCH_URL || 'http://127.0.0.1:8027/design/workbench/';
const origin = new URL(base).origin;
const session = await openHeadlessBrowser();
let prior = { pages: [], errors: [], blockedWrites: [] };
try { prior = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')); } catch { /* The first capture has no prior manifest. */ }
const result = { reference: base, pages: prior.pages || [], errors: prior.errors || [], blockedWrites: prior.blockedWrites || [] };
const modules = process.argv.slice(2); if (!modules.length) modules.push('list', 'structure');
try {
  await session.context.route('**/*', route => { if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { result.blockedWrites.push({ url: route.request().url(), method: route.request().method() }); return route.abort('blockedbyclient'); } return route.continue(); });
  session.page.on('pageerror', error => result.errors.push(error.message));
  let types = [];
  try { const response = await fetch(origin + '/api/design/type-workspaces'); if (response.ok) types = await response.json(); else result.errors.push('型号列表读取：' + response.status); } catch (error) { result.errors.push(String(error)); }
  const wid = Array.isArray(types) ? types.find(item => item.id)?.id : undefined;
  const definitions = {
    list: { route: '/types', right: 'types-success' },
    structure: { route: wid ? `/types/${wid}/structure/section` : '/types', right: 'structure-light-1366' },
    'standard-check': { route: wid ? `/types/${wid}/standard-check` : '/types', right: 'standard-check-light-1366' },
    electrical: { route: wid ? `/types/${wid}/electrical/results` : '/types', right: 'electrical-light-1366' },
    'short-circuit': { route: wid ? `/types/${wid}/short-circuit/results` : '/types', right: 'short-circuit-light-1366' },
    'rating-table': { route: wid ? `/types/${wid}/rating-table` : '/types', right: 'rating-table-light-1366' },
    comparison: { route: wid ? `/types/${wid}/comparison/matrix` : '/types', right: 'comparison-light-1366' },
    specification: { route: wid ? `/types/${wid}/specification/content` : '/types', right: 'specification-light-1366' },
  };
  await session.page.setViewportSize({ width: 1366, height: 768 });
  for (const name of modules) {
    const definition = definitions[name]; if (!definition) throw Error('未知模块：' + name);
    const url = base + '#' + definition.route, left = path.join(directory, name + '-8027.png'), right = path.join(output, 'screenshots', definition.right + '.png');
    await session.page.goto(url, { waitUntil: 'domcontentloaded' }); await settle(session.page); await session.page.screenshot({ path: left });
    const body = await session.page.locator('body').innerText();
    const comparison = path.join(directory, name + '-comparison.png');
    const source = "from PIL import Image,ImageDraw;import sys;a=Image.open(sys.argv[1]).convert('RGB');b=Image.open(sys.argv[2]).convert('RGB');o=Image.new('RGB',(a.width+b.width,max(a.height,b.height)+32),'white');o.paste(a,(0,32));o.paste(b,(a.width,32));d=ImageDraw.Draw(o);d.text((12,8),'8027 reference - actual service state',fill='black');d.text((a.width+12,8),'Migrated frontend - isolated verified UI',fill='black');o.save(sys.argv[3])";
    const rendered = spawnSync(process.env.PYTHON || path.join(root, '.venv/Scripts/python.exe'), ['-c', source, left, right, comparison], { windowsHide: true, encoding: 'utf8' });
    if (rendered.status !== 0) throw Error(rendered.stderr || rendered.error || '并排图生成失败');
    result.pages = result.pages.filter(item => item.module !== name);
    result.pages.push({ module: name, url, legacyObject: wid || null, fallbackToList: name !== 'list' && !wid, referenceState: body.slice(0, 1500), left, right, comparison });
  }
} catch (error) { result.failure = String(error.stack || error); console.error(result.failure); process.exitCode = 1; }
finally { await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(result, null, 2)); await session.close(); }
