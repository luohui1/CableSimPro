import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, outputRoot, settle } from './browser.mjs';

const referenceMode = process.argv.includes('--references');
const referenceTarget = process.argv.find(argument => argument.startsWith('--reference='))?.split('=')[1];
const base = process.env.WORKBENCH_URL || 'http://127.0.0.1:8027';
const directory = referenceMode ? path.join(outputRoot, 'references') : path.join(outputRoot, process.env.CAPTURE_DIRECTORY || 'pages');
await fs.mkdir(directory, { recursive: true });
const session = await openHeadlessBrowser();
let { page } = session;
let manifest = [];
const blockedWrites = [];
if (process.argv.includes('--resume')) {
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')).pages.filter(item => item.screenshot && !item.screenshotError); } catch { /* First capture. */ }
}
if (referenceMode && referenceTarget) {
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')).pages.filter(item => item.name !== referenceTarget); } catch { /* First capture. */ }
}
try {
  await page.setViewportSize({ width: 1920, height: 1080 });
  if (referenceMode) {
    const references = [
      ['linear', 'https://linear.app/docs/display-options'],
      ['vercel', 'https://vercel.com/blog/dashboard-redesign'],
      ['onshape', 'https://cad.onshape.com/help/Content/Home/user_interface_basics.htm'],
      ['figma', 'https://help.figma.com/hc/en-us/articles/23954856027159-Navigating-UI3'],
      ['chatgpt', 'https://openai.com/index/introducing-canvas/'],
      ['shadcn-sidebar', 'https://ui.shadcn.com/view/sidebar-01'],
    ];
    for (const [name, url] of references) {
      if (referenceTarget && name !== referenceTarget) continue;
      let error = null;
      let response;
      try { response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); await settle(page); } catch (e) { error = e.message; }
      const text = await page.locator('body').innerText().catch(() => '');
      const blocked = /verify you are human|verification required|access denied|just a moment|error code|request blocked|page not found|403 forbidden/i.test(text) || (response?.status() ?? 200) >= 400;
      if (!blocked && name === 'onshape') {
        await page.getByText('Part Studio interface', { exact: true }).click();
        await settle(page);
      }
      const images = await page.locator('img').evaluateAll(elements => elements.map((el, index) => ({ index, width: el.naturalWidth, height: el.naturalHeight, visible: el.getBoundingClientRect().height > 0 })).filter(x => x.width >= 600 && x.height >= 250 && x.visible)).catch(() => []);
      if (!blocked && images.length) {
        await page.locator('img').nth(images[0].index).scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(500);
      }
      const screenshot = blocked ? `unavailable/${name}.png` : `${name}.png`;
      if (blocked) await fs.mkdir(path.join(directory, 'unavailable'), { recursive: true });
      await page.screenshot({ path: path.join(directory, screenshot), fullPage: false });
      let interfaceScreenshot = null;
      if (!blocked && images.length) {
        interfaceScreenshot = `${name}-interface.png`;
        await page.locator('img').nth(images[0].index).screenshot({ path: path.join(directory, interfaceScreenshot) });
      }
      manifest.push({ name, url, resolvedUrl: page.url(), httpStatus: response?.status(), blocked, error, screenshot, interfaceScreenshot, embeddedImages: images.length, title: await page.title() });
      await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), base, pages: manifest }, null, 2));
      console.log(`参考截图：${name} · ${blocked ? '访问受阻' : error ? '加载存在错误' : '已读取'}`);
    }
    // Repository visual references are inspected as references, not reused as implementation.
    for (const filename of ['workspace', 'style-guide']) {
      if (referenceTarget) continue;
      await page.goto(`${base}/design/reference/${filename}.html`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.screenshot({ path: path.join(directory, `cablesim-${filename}.png`), fullPage: false });
      manifest.push({ name: `cablesim-${filename}`, url: page.url(), screenshot: `cablesim-${filename}.png`, kind: 'repository-reference' });
    }
  } else {
    // A page capture never creates a study, calls a solver, edits inputs or approves anything.
    await page.route('**/api/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) { blockedWrites.push({ method: route.request().method(), url: route.request().url() }); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const get = async endpoint => {
      const response = await fetch(base + endpoint);
      if (!response.ok) return null;
      return response.json();
    };
    const workspaces = await get('/api/workspaces') || [];
    const typeWorkspaces = await get('/api/design/type-workspaces') || [];
    const studies = [];
    for (const workspace of workspaces) {
      const list = await get(`/api/workspaces/${workspace.id}/studies`);
      for (const study of list || []) studies.push({ ...study, workspace: workspace.id });
    }
    const type = typeWorkspaces.find(item => /YJV|型号|三芯|CAD/.test(item.name)) || typeWorkspaces[0] || workspaces[0];
    const study = studies.find(item => /选型|问询/.test(item.definition?.title)) || studies[0];
    const routes = [['home', '/'], ['types', '/types'], ['studies', '/studies'], ['library', '/library'], ['plugins', '/plugins'], ['settings', '/settings'], ['reproductions', '/library/reproductions'], ['simulation-list', '/simulation']];
    const typeModules = {
      structure: ['section', 'three', 'table', 'quantities'],
      requirements: [null],
      'standard-check': [null],
      electrical: ['results', 'parameters', 'section'],
      'short-circuit': ['results', 'parameters', 'section'],
      'rating-table': [null],
      comparison: ['matrix', 'parameters', 'geometry'],
      specification: ['content', 'preview', 'review', 'revisions'],
    };
    if (type) for (const [module, tabs] of Object.entries(typeModules)) for (const tab of tabs) routes.push([`type-${module}-${tab || 'main'}`, `/types/${type.id}/${module}${tab ? '/' + tab : ''}`]);
    const studyModules = {
      cable: ['section', 'layers', 'references'], section: ['section', 'three-dimensional', 'coordinates', 'media'],
      conditions: ['main'], ampacity: ['results', 'parameters', 'losses', 'diagnostics'],
      'thermal-field': ['field', 'samples', 'parameters', 'diagnostics'], selection: ['results', 'settings'],
      sweep: ['curve', 'points', 'settings'], batch: ['space', 'results', 'execution'],
      'method-compare': ['results', 'inputs', 'evidence'], report: ['content', 'sources', 'preview'],
    };
    if (study) {
      for (const [module, tabs] of Object.entries(studyModules)) {
        const owner = studies.find(item => module === 'selection' ? item.definition?.modules?.selection : module === 'batch' ? item.definition?.modules?.batch : module === 'thermal-field' ? item.definition?.modules?.['thermal-field'] || item.definition?.method?.plugin_id === 'cablesim.simulation' : false) || study;
        for (const tab of tabs) routes.push([`study-${module}-${tab}`, `/studies/${owner.id}/${module}${tab === 'main' ? '' : '/' + tab}?task=rating`]);
      }
      for (const owner of studies) {
        const runs = await get(`/api/workspaces/${owner.workspace}/studies/${owner.id}/runs`);
        const runList = Array.isArray(runs) ? runs : runs?.items || runs?.runs || [];
        if (runList[0]) { routes.push(['study-run', `/studies/${owner.id}/ampacity/results/runs/${runList[0].id}?task=rating`]); break; }
      }
      if (!routes.some(([name]) => name === 'study-run')) routes.push(['study-run-unavailable', `/studies/${study.id}/ampacity/results/runs/missing-run?task=rating`]);
    }
    const simulationStudy = studies.find(item => item.definition?.method_input?.schema_version === 'cablesim.simulation-problem/1');
    if (simulationStudy) for (const tab of ['results', 'inputs', 'evidence']) routes.push([`simulation-${tab}`, `/studies/${simulationStudy.id}/simulation/${tab}`]);
    else console.log('未覆盖：仿真复现独立适配器的3个详情页签，当前服务没有对应已保存研究。');
    // Source-declared reproduction detail routes are captured even if the running server lacks them.
    const reproductions = await get('/api/foundation/reproductions');
    const entries = Array.isArray(reproductions) ? reproductions : reproductions?.items || [];
    const reproduction = entries[0]?.id || 'E17';
    for (const tab of ['results', 'overlay', 'convergence', 'sources', 'scope']) routes.push([`reproduction-${tab}`, `/library/reproductions/${reproduction}/${tab}`]);
    for (const [name, route] of routes) {
      if (manifest.some(item => item.name === name)) continue;
      // Destroy each page's model/viewer lifetime before the next capture.
      await page.close();
      page = await session.context.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.route('**/api/**', network => {
        if (!['GET', 'HEAD'].includes(network.request().method())) { blockedWrites.push({ method: network.request().method(), url: network.request().url() }); return network.abort('blockedbyclient'); }
        return network.continue();
      });
      const pageErrors = [];
      const listener = error => pageErrors.push(error.message);
      page.on('pageerror', listener);
      let navigationError = null;
      try {
        await page.goto(`${base}/design/workbench/#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await settle(page);
        await page.waitForTimeout(500);
      } catch (error) { navigationError = error.message; }
      const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      let screenshotError = null;
      try {
        await page.bringToFront();
        await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: false });
      } catch {
        try {
          const cdp = await session.context.newCDPSession(page);
          const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
          await fs.writeFile(path.join(directory, `${name}.png`), Buffer.from(image.data, 'base64'));
          await cdp.detach();
        } catch (error) { screenshotError = error.message; }
      }
      page.off('pageerror', listener);
      manifest.push({ name, route, url: page.url(), screenshot: screenshotError ? null : `${name}.png`, screenshotError, navigationError, pageErrors,
        emptyDocument: !body.trim(),
        visibleFailure: /本机 API 未连接|HOST_DEPENDENCIES_MISMATCH|API endpoint not found|读取失败/.test(body),
        bodyPreview: body.slice(0, 500),
      });
      await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), base, readonly: true, blockedWrites, pages: manifest }, null, 2));
      console.log(`样板截图：${name}`);
    }
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), base, readonly: true, blockedWrites, pages: manifest }, null, 2));
  console.log(`共 ${manifest.length} 个视图；截图 ${manifest.filter(p => p.screenshot).length} 张；可见服务错误 ${manifest.filter(p => p.visibleFailure).length}；空白文档 ${manifest.filter(p => p.emptyDocument).length}；未执行写入或计算。`);
} finally { await session.close(); }
