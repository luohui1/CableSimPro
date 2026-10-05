import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, outputRoot, settle } from './browser.mjs';
import { moduleDefinitions } from '../src/pages/study-modules.ts';
import { typeModules } from '../src/features/type/module-definitions.ts';

const base = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const requested = process.argv.find(arg => arg.startsWith('--route='))?.slice(8);
const directory = path.join(outputRoot, process.env.CAPTURE_DIRECTORY || 'pages');
await fs.mkdir(directory, { recursive: true });
const session = await openHeadlessBrowser(), manifest = [], blockedWrites = [];
await session.context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
    blockedWrites.push({ method: route.request().method(), url: route.request().url() });
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
async function get(endpoint) {
  const reply = await fetch(base + endpoint);
  if (!reply.ok) throw Error(endpoint + ': HTTP ' + reply.status);
  return reply.json();
}
async function pages() {
  if (requested) {
    if (!requested.startsWith('/') || requested.startsWith('//')) throw Error('--route must be a frontend path');
    return [['page', requested]];
  }
  const routes = [['home','/'],['types','/types'],['studies','/studies'],['library','/library'],
    ['documents','/library/documents'],['deliveries','/library/deliveries'],['plugins','/plugins'],
    ['settings','/settings'],['reproductions','/library/reproductions']];
  const types = await get('/api/design/type-workspaces'), workspaces = await get('/api/workspaces');
  if (types[0]) for (const module of typeModules) for (const [tab] of module.tabs)
    routes.push(['type-' + module.id + '-' + tab, '/types/' + types[0].id + '/' + module.id + '/' + tab]);
  const studies = [];
  for (const workspace of workspaces) for (const study of await get('/api/workspaces/' + workspace.id + '/studies'))
    studies.push({ ...study, workspace: workspace.id });
  const study = studies.find(item => item.definition.driver?.kind === 'selection') || studies[0];
  if (study) for (const [module, definition] of Object.entries(moduleDefinitions))
    for (const tab of definition.tabs)
      routes.push(['study-' + module + '-' + tab.id, '/studies/' + study.id + '/' + module + '/' + tab.id + '?workspace=' + study.workspace]);
  const reproductions = await get('/api/foundation/reproductions');
  if (reproductions.items?.[0]) for (const tab of ['results','overlay','convergence','sources','scope'])
    routes.push(['reproduction-' + tab, '/library/reproductions/' + reproductions.items[0].id + '/' + tab]);
  return routes;
}
try {
  for (const [name, route] of await pages()) {
    const page = await session.context.newPage(), errors = [];
    await page.setViewportSize({ width: 1366, height: 768 });
    page.on('pageerror', error => errors.push(error.message));
    try {
      const response = await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await settle(page);
      await page.screenshot({ path: path.join(directory, name + '.png') });
      manifest.push({ name, route, screenshot: name + '.png', httpStatus: response.status(), errors });
    } catch (error) { manifest.push({ name, route, error: error.message, errors }); }
    finally { await page.close(); }
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ base, readonly: true, pages: manifest, blockedWrites }, null, 2));
  console.log('正式前端截图：' + manifest.length + ' 页；未执行写入或求解。');
  if (manifest.some(item => item.error || item.httpStatus >= 400 || item.errors.length)) throw Error('部分页面失败，见截图清单');
} finally { await session.close(); }
