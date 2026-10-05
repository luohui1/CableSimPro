import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { openHeadlessBrowser, settle, outputRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';

if (process.env.E2E_ISOLATED !== '1') throw Error('仅在独立数据库验收');
const base = process.env.FRONTEND_URL, phase = process.env.AUDIT_PHASE || 'after';
const output = path.join(outputRoot, 'accessibility');
await fs.mkdir(output, { recursive: true });
const session = await openHeadlessBrowser(), { page } = session;
const report = { phase, performance: [], pages: [], errors: [] };
report.previewDocuments = [];
page.on('pageerror', e => report.errors.push(e.message));
const get = async p => { const r = await fetch(base + p); if (!r.ok) throw Error(p); return r.json(); };
const save = () => fs.writeFile(path.join(output, phase + '.json'), JSON.stringify(report, null, 2));
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  for (let run = 0; run < 3; run++) {
    await page.goto('about:blank');
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '最近研究', exact: true }).waitFor();
    await page.locator('tbody tr').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const timing = await page.evaluate(() => ({ renderMs: performance.now(), fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, scripts: performance.getEntriesByType('resource').filter(x => new URL(x.name).pathname.endsWith('.js')).map(x => new URL(x.name).pathname) }));
    const scripts = await Promise.all([...new Set(timing.scripts)].map(async url => ({ url, gzipBytes: gzipSync(await fs.readFile(path.join('dist', url))).length })));
    report.performance.push({ ...timing, scripts, gzipBytes: scripts.reduce((sum, x) => sum + x.gzipBytes, 0) });
  }
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await save();
  if (process.env.AUDIT_PERFORMANCE_ONLY === '1') { console.log(JSON.stringify(report.performance)); }
  else {
    const workspaces = await get('/api/workspaces'), studies = [];
    for (const w of workspaces) for (const s of await get('/api/workspaces/' + w.id + '/studies')) studies.push({ ...s, wid: w.id });
    const types = await get('/api/design/type-workspaces');
    const routes = ['/', '/studies', '/types', '/library', '/library/documents', '/plugins', '/settings', '/library/reproductions', '/plugins/cablesim.iec60287'];
    for (const tab of ['results', 'overlay', 'convergence', 'sources', 'scope']) routes.push('/library/reproductions/E02/' + tab);
    const modules = { cable: ['section','layers','references'], section: ['section','three-dimensional','coordinates','media'], conditions:['inputs'], ampacity:['results','parameters'], selection:['results','settings'], 'thermal-field':['field','samples','parameters','diagnostics','convergence'], sweep:['curve','points','settings'], batch:['space','results','execution'], 'method-compare':['inputs','results','evidence'], simulation:['inputs','results','evidence'], report:['content','sources','preview'], hybrid:['results','validation','sources'], transient:['results','history','field','samples','diagnostics','convergence','parameters'], 'sheath-losses':['results','losses','parameters'], electrothermal:['results','field','samples','parameters','diagnostics','convergence'] };
    for (const [module,tabs] of Object.entries(modules)) {
      const study = studies.find(s => module === 'sweep' ? s.definition.driver.kind === 'sweep' : module === 'method-compare' ? s.definition.driver.kind === 'crosscheck' : ['thermal-field','electrothermal'].includes(module) ? s.definition.title.includes('温度场') : s.definition.driver.kind === 'selection') || studies[0];
      for (const tab of tabs) routes.push(`/studies/${study.id}/${module}/${tab}?workspace=${study.wid}`);
    }
    const type = types.find(t => t.name.startsWith('YJV22')) || types[0];
    for (const [module,tabs] of Object.entries({ structure:['section','three','table','quantities'], requirements:['list','standards','pending'], 'standard-check':['results'], electrical:['results','parameters'], 'short-circuit':['results','parameters'], 'rating-table':['results','parameters'], comparison:['matrix','parameters','geometry'], specification:['content','preview','review','revisions'] })) for (const tab of tabs) routes.push(`/types/${type.id}/${module}/${tab}`);
    for (const route of routes.filter(r => !process.env.AUDIT_FILTER || process.env.AUDIT_FILTER.split(',').some(filter=>r.includes(filter)))) {
      await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await settle(page);
      await page.locator('.provider-state [aria-busy="true"]').waitFor({state:'hidden',timeout:30000});
      await page.waitForFunction(()=>![...document.querySelectorAll('.main-content .state-view[aria-busy=true]')].some(e=>!e.closest('.cad-viewport')),null,{timeout:30000});
      const cadRoute=route.includes('/three-dimensional') || route.includes('/structure/three');
      if(cadRoute) await page.waitForFunction(()=>!document.querySelector('.cad-state-overlay [aria-busy=true]'),null,{timeout:45000});
      if (route.includes('/specification/')) {
        for (const frame of await page.locator('iframe[srcdoc]').all()) {
          const html = await frame.getAttribute('srcdoc');
          const preview = await session.context.newPage();
          try {
            // Same saved HTML, inspected separately because the production preview
            // correctly prevents running scripts inside its sandbox.
            await preview.setContent(html, {waitUntil:'domcontentloaded'});
            const result = await new AxeBuilder({page:preview}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
            report.previewDocuments.push({route,violations:result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}))});
          } finally { await preview.close(); }
        }
      }
      for (const theme of ['light','dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        // Sandboxed document previews forbid script injection. Audit their shell here;
        // preview content has a separate document check below.
        const result = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        const violations = result.violations.map(v => ({ id:v.id, impact:v.impact, nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary})) }));
        const keyboard = await page.evaluate(() => ({ positiveTabIndex: [...document.querySelectorAll('[tabindex]')].filter(e=>Number(e.getAttribute('tabindex'))>0).map(e=>e.outerHTML), tables:document.querySelectorAll('table').length, focusProblems:[], tabStops:[] }));
        await page.locator('body').click({position:{x:2,y:2}});
        for (let i=0;i<18;i++) {
          await page.keyboard.press('Tab');
          const focus = await page.evaluate(()=>{const e=document.activeElement;if(!e || e===document.body)return null;const s=getComputedStyle(e),b=e.getBoundingClientRect();return {tag:e.tagName,name:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,60),hidden:!!e.closest('[aria-hidden=true]')||!b.width||!b.height||s.clipPath!=='none',visible:s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0||s.boxShadow!=='none'};});
          if(focus){keyboard.tabStops.push(focus);if(focus.hidden||!focus.visible)keyboard.focusProblems.push(focus);}
        }
        const rows=page.locator('tr.data-row[tabindex="0"]');
        if(await rows.count()>1){const previousUrl=page.url();await rows.first().focus();await page.keyboard.press('ArrowDown');const down=await page.evaluate(()=>document.activeElement?.id);if(page.url()!==previousUrl || down!==await rows.nth(1).getAttribute('id',{timeout:1000}).catch(()=>null))keyboard.focusProblems.push({table:'ArrowDown did not focus next row'});if(page.url()===previousUrl){await page.keyboard.press('ArrowUp');if(!await rows.first().evaluate(e=>e===document.activeElement))keyboard.focusProblems.push({table:'ArrowUp did not return to first row'});}else{await page.goto(previousUrl);await settle(page);}}
        const layoutProblems=[];
        for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(100);
          try { await assertLayout(page,route+' '+theme+' '+viewport.width); } catch(e) {layoutProblems.push({width:viewport.width,error:String(e),bounds:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,outside:[...document.querySelectorAll('body *')].filter(e=>['absolute','fixed'].includes(getComputedStyle(e).position)&&e.getBoundingClientRect().bottom>innerHeight+1).slice(-12).map(e=>({html:e.outerHTML.slice(0,500),rect:e.getBoundingClientRect().toJSON()})),zones:[...document.querySelectorAll('.app-shell,.type-root,.work-panel,.main-content,.type-property-wrapper,.property-panel,[data-radix-popper-content-wrapper]')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),overflow:getComputedStyle(e).overflow}))}))});}
        }
        await page.setViewportSize({width:1366,height:768});
        const canvases=cadRoute ? await page.locator('.cad-viewport canvas').evaluateAll(nodes=>nodes.map(e=>({width:e.width,height:e.height,visibleWidth:e.getBoundingClientRect().width,visibleHeight:e.getBoundingClientRect().height}))) : [];
        const cadStates=cadRoute ? await page.locator('.cad-viewport').evaluateAll(nodes=>nodes.map(e=>e.getAttribute('data-cad-state'))) : [];
        if(cadStates.some(state=>state!=='error'&&state!=='empty')&&!canvases.length)layoutProblems.push({canvas:'CAD view declares data but has no canvas'});
        if(canvases.some(c=>c.width<=0||c.height<=0||c.visibleWidth<=0||c.visibleHeight<=0))layoutProblems.push({canvas:'CAD canvas has zero dimensions'});
        if(cadRoute&&theme==='light')await page.screenshot({path:path.join(output,route.includes('/structure/')?'type-cad.png':'study-cad.png')});
        report.pages.push({route,theme,violations,keyboard,layoutProblems,canvases,cadStates});
        console.log(route+' '+theme+': '+violations.reduce((n,v)=>n+v.nodes.length,0));
        await save();
      }
      if(['/types','/plugins','/library/reproductions'].includes(route)) {
        const row=page.locator('tr.data-row[tabindex="0"]').first();await row.focus();await page.keyboard.press('Enter');await page.waitForURL(url=>url.pathname!==route,{timeout:10000});
      }
    }
    report.problemCount = report.pages.reduce((n,p)=>n+p.violations.reduce((sum,v)=>sum+v.nodes.length,0)+p.keyboard.positiveTabIndex.length+p.keyboard.focusProblems.length+p.layoutProblems.length,0) + report.previewDocuments.reduce((n,p)=>n+p.violations.reduce((sum,v)=>sum+v.nodes.length,0),0);
    console.log('问题实例总数：'+report.problemCount);
    await save();
    if (phase !== 'before') { assert.equal(report.problemCount, 0); assert.equal(report.errors.length, 0); }
  }
} finally { await save(); await session.close(); }
