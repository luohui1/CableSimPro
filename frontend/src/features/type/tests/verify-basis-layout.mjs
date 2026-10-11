import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const output=path.join(root,'.data/type-basis');await fs.mkdir(output,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/fix-round/3d/validation/release/engineering.sqlite');
const threeOnly=process.argv.includes('--three');
const fixture=await typeFixture({main:true,software:threeOnly,build:path.join(output,'frontend')}),{page}=fixture;
const results={checks:[],screenshots:[],errors:fixture.errors,runtime:fixture.runtime};
try {
  const types=await fixture.api('/api/design/type-workspaces'),qf=types.find(t=>t.name.startsWith('起帆')),mv=types.find(t=>t.name.startsWith('YJV22'));
  assert.ok(qf&&mv);
  if(!threeOnly){for(const width of [1366,1920])for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    for(const [name,route] of [['structure',`/types/${qf.id}/structure/table`],['specification',`/types/${qf.id}/specification/content`],['requirements',`/types/${mv.id}/requirements/list`],['requirements-qf',`/types/${qf.id}/requirements/list`]]) {
      await page.goto(fixture.url+route+'?theme='+theme);
      const content=page.locator(`[data-type-page="${name==='structure'?'structure':name.startsWith('requirements')?'requirements-results':'specification-results'}"]`);
      await expect(content).toBeVisible({timeout:30000});
      await expect(content).not.toHaveAttribute('data-type-state','loading',{timeout:30000});
      const layout=await checkLayout(page);
      if(name.startsWith('requirements')&&process.env.E2E_DATABASE_SOURCE.includes('type-basis/validation')) {
        await expect(content).toHaveAttribute('data-type-state','success');
        const table=page.getByRole('table',{name:'要求清单',exact:true});
        await expect(table).toContainText(/依据已核验/);
        await expect(table).toContainText(name==='requirements-qf'?/GB\/T 11017\.2—2024 表 2，第 4 页/:/GB\/T 12706\.2—2020 表 7，第 7 页/);
        await expect(table).toContainText(/GB\/T 3956—2008 表 2，第 4 页/);
        await expect(table).toContainText(name==='requirements-qf'?'0.0221 Ω/km':'0.0601 Ω/km');
      }
      if(name==='structure') {
        await expect(page.getByRole('navigation',{name:'型号浏览器'})).not.toContainText(qf.name);
        await expect(page.getByRole('button',{name:'修改型号名称'})).toBeVisible();
        const diagram=page.locator('svg[data-drawing-canvas="cable"]');
        if(await diagram.count()) {
          const lines=await diagram.locator('[data-layer-leader]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
          if(width===1920)assert.ok(lines.length>=8,'Complete layer labels');
          const geometry=await diagram.evaluate(svg=>{
            const groups=[...svg.querySelectorAll('[data-layer-number]')];
            const positions=groups.map(g=>{const a=g.querySelector('circle'),texts=[...g.querySelectorAll('text')].map(t=>{const b=t.getBBox();return {x:b.x,y:b.y,w:b.width,h:b.height};});return {anchor:[Number(a?.getAttribute('cx')),Number(a?.getAttribute('cy'))],texts,points:(g.querySelector('[data-layer-leader]')?.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)||[]).map(Number).reduce((list,n,i,array)=>i%2?list:[...list,[n,array[i+1]]],[])};});
            const side=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);let crossings=0;
            for(let i=0;i<positions.length;i++)for(let j=0;j<i;j++)for(let a=1;a<positions[i].points.length;a++)for(let b=1;b<positions[j].points.length;b++){const [p,q]=positions[i].points.slice(a-1,a+1),[r,s]=positions[j].points.slice(b-1,b+1);if(side(p,q,r)*side(p,q,s)<-1e-7&&side(r,s,p)*side(r,s,q)<-1e-7)crossings++;}
            const spacing=positions.slice(1).map((p,i)=>Math.hypot(p.anchor[0]-positions[i].anchor[0],p.anchor[1]-positions[i].anchor[1]));
            const labels=positions.flatMap(p=>p.texts),overlap=[];for(let i=0;i<labels.length;i++)for(let j=0;j<i;j++){const a=labels[i],b=labels[j];if(Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.y+a.h,b.y+b.h)>Math.max(a.y,b.y))overlap.push([i,j]);}
            return {crossings,spacing,overlap};
          });
          assert.equal(geometry.crossings,0,'Real model leaders do not intersect');assert.ok(geometry.spacing.every(d=>d>=8),'Real model anchor spacing');assert.deepEqual(geometry.overlap,[],'Real model labels do not overlap');results.checks.push({name:'leaders',width,theme,geometry});
        }
      }
      if(name==='specification') {
        const frame=page.locator('iframe[title="正式规格书预览"]');await expect(frame).toBeVisible();
        await expect.poll(()=>frame.evaluate(f=>f.contentDocument?.documentElement.scrollHeight<=f.clientHeight+2)).toBe(true);
        assert.ok((await frame.boundingBox()).width>480);
        const nav=page.getByRole('navigation',{name:'规格书章节'});
        const scroll=await nav.evaluate(n=>({scroll:n.scrollHeight,height:n.clientHeight}));assert.ok(scroll.scroll<=scroll.height+1,'Chapter navigation has no nested scroll');
        await expect(page.getByRole('button',{name:/项阻止发布 · 查看第一项/})).toHaveCount(1);
      }
      results.checks.push({name,width,theme,layout});
      if(width===1366&&theme==='light') {if(name==='structure')await expect(page.getByText('正在读取资源绑定',{exact:true})).toHaveCount(0,{timeout:20000});const image=path.join(output,name+'.png');await page.screenshot({path:image});results.screenshots.push(image);}
    }
  }
  // Fault injection changes transport states only; engineering values remain
  // the isolated saved records. One page is reused throughout the matrix.
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const state of ['loading','empty','error']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    const pattern=`**/api/workspaces/${mv.id}/studies`;
    let release;const held=new Promise(resolve=>{release=resolve;});
    const handler=async route=>{if(state==='loading'){await held;await route.abort().catch(()=>{});}else await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'要求目录读取中断，请重新读取。'}:[])});};
    await page.route(pattern,handler);
    try {
      await page.goto(`${fixture.url}/types/${mv.id}/requirements/list?theme=${theme}`);
      const content=page.locator('[data-type-page="requirements-results"]');
      await expect(content).toHaveAttribute('data-type-state',state,{timeout:20000});
      const layout=await checkLayout(page);results.checks.push({name:'requirements-transport',state,width,theme,layout});
      if(state==='error')await expect(content.getByRole('button',{name:'重新读取'})).toBeVisible();
    }finally{release();await page.unroute(pattern,handler);}
  }
  // A real input revision makes the saved evidence historical; no replacement
  // numerical result is supplied by the test.
  const prior=await fixture.api(`/api/workspaces/${qf.id}`),changed=structuredClone(prior.domain);
  changed.cable_types[0].cores[0].layers.find(layer=>layer.role==='insulation').thickness+=.0001;
  await fixture.api(`/api/workspaces/${qf.id}/domain`,'PUT',{expected_revision:prior.revision,document:changed});
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const [module,tab,pageName] of [['requirements','list','requirements-results'],['specification','content','specification-results']]) {
    await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${qf.id}/${module}/${tab}?theme=${theme}`);
    const content=page.locator(`[data-type-page="${pageName}"]`);
    await expect(content).toHaveAttribute('data-type-state','historical',{timeout:30000});
    results.checks.push({name:'historical-'+module,width,theme,layout:await checkLayout(page)});
  }
  }
  const studies=[];
  for(const w of await fixture.api('/api/workspaces'))if(/直埋|三回排管/.test(w.name))for(const s of await fixture.api(`/api/workspaces/${w.id}/studies`))if(s.latest_run_id&&s.definition.method.plugin_id==='cablesim.iec60287') {studies.push({w,s});break;}
  for(const {w,s} of studies)for(const width of [1366,1920])for(const theme of ['light','dark'])for(const view of threeOnly?['three']:['cable','section']) {
    await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/studies/${s.id}?workspace=${w.id}&view=${view}&theme=${theme}`);
    const openCanvas=page.getByRole('button',{name:'查看布置图',exact:true}),toolbar=page.getByRole('toolbar',{name:'视图与绘图工具'});
    await expect(toolbar.or(openCanvas).first()).toBeVisible({timeout:20000});
    if(await openCanvas.isVisible())await openCanvas.click();
    await expect(toolbar).toBeVisible();
    if(view!=='three')await expect(toolbar.locator('[data-drawing-toolbar-slot] .drawing-toolbar')).toBeVisible({timeout:20000});
    else {
      await expect(page.locator('[data-cad-ready=true]')).toBeVisible({timeout:20000});
      const canvas=page.locator('.cad-canvas-host canvas').first(),diagnostics=await canvas.evaluate(n=>({renderer:n.dataset.webglRenderer,colors:Number(n.dataset.webglColors)}));
      assert.match(diagnostics.renderer,/SwiftShader/i);assert.ok(diagnostics.colors>8,'Software WebGL contains geometry and temperature colors');
      results.checks.push({name:'software-webgl',width,theme,diagnostics});
    }
    const layout=await checkLayout(page,'.workbench-canvas');results.checks.push({name:w.name,view,width,theme,layout,scope:'Owned canvas and combined drawing toolbar'});
    if(view==='section'||view==='three') {
      const field=page.locator('canvas.cad-temperature-slice');
      if(await field.count()) {await expect(field).toHaveAttribute('data-cad-field-ready','true');await expect(field).toHaveAttribute('data-webgl-premultiplied','true');}
    }
    if(view==='section') {assert.equal(await page.getByLabel('温度色标',{exact:true}).count(),1);if(w.name.includes('排管'))await expect(page.getByLabel('排管编号图例')).toBeVisible();}
    if(width===1366&&theme==='light') {const image=path.join(output,`${w.name.includes('排管')?'duct':'buried'}-${view}.png`);await page.screenshot({path:image});results.screenshots.push(image);}
  }
  if(threeOnly) {
    const w=studies[0].w,workspace=await fixture.api(`/api/workspaces/${w.id}`);
    const unrun=await fixture.api(`/api/workspaces/${w.id}/studies`,'POST',{
      ...studies[0].s.definition,title:'未运行三维验收',expected_revision:workspace.revision});
    assert.ok(!unrun.latest_run_id,'The isolated study was created without running a method');
    for(const width of [1366,1920])for(const theme of ['light','dark']) {
      await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/studies/${unrun.id}?workspace=${w.id}&view=three&theme=${theme}`);
      const open=page.getByRole('button',{name:'查看布置图',exact:true}),toolbar=page.getByRole('toolbar',{name:'视图与绘图工具'});
      await expect(toolbar.or(open).first()).toBeVisible();if(await open.isVisible())await open.click();
      await expect(page.locator('[data-cad-ready=true]')).toBeVisible({timeout:20000});
      await expect(page.getByText('三维图已选入计算书',{exact:true})).toHaveCount(0);
      results.checks.push({name:'unrun-report-image-state',width,theme,layout:await checkLayout(page,'.workbench-canvas')});
    }
  }
} catch(error) {results.failure=String(error.stack||error);results.log=fixture.log();console.error(results.failure);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally {await fixture.close();results.closed=true;await fs.writeFile(path.join(output,threeOnly?'browser-three.json':'browser.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify({checks:results.checks.length,closed:results.closed,failure:results.failure}));
