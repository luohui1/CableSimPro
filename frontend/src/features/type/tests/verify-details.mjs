import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect as baseExpect} from '@playwright/test';
import {typeFixture,root} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';
import {checkDetailRules} from './detail-checks.mjs';

const output=path.join(root,'.data/type-detail');await fs.mkdir(output,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/type-basis/validation/engineering.sqlite');
const fixture=await typeFixture({main:true,build:process.env.E2E_TYPE_BUILD||path.join(output,'frontend')}),{page}=fixture;
const expect=baseExpect.configure({timeout:30000}),report={checks:[],screenshots:[],errors:fixture.errors,runtime:fixture.runtime};
const statesOnly=process.argv.includes('--states');
const focused=process.argv.includes('--focused');
const curveOnly=process.argv.includes('--curve');
async function visit(wid,module,tab,theme='light'){
  await page.goto(`${fixture.url}/types/${wid}/${module}/${tab}?theme=${theme}`);
  const content=page.locator(`[data-type-page="${module==='structure'?'structure':module==='requirements'?'requirements-results':module==='comparison'?'comparison-results':module==='specification'?'specification-results':module==='geometry'?'quantities':module+'-results'}"]`).last();
  await expect(content).toBeVisible();await expect(content).not.toHaveAttribute('data-type-state','loading');return content;
}
async function check(name,scope='.type-root'){
  report.checks.push({name,viewport:page.viewportSize(),layout:await checkLayout(page,scope),details:await checkDetailRules(page,scope)});
  console.log('通过 '+name);
}
try {
  const types=await fixture.api('/api/design/type-workspaces'),qf=types.find(t=>t.name.startsWith('起帆')),mv=types.find(t=>t.name.startsWith('YJV22'));assert.ok(qf&&mv);
  if(!statesOnly){
  for(const width of [1366,1920])for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    for(const type of curveOnly?[mv]:[qf,mv])for(const [module,tab] of curveOnly?[['short-circuit','results']]:focused?[['short-circuit','results'],['rating-table','results'],['electrical','results'],['structure','materials']]:[['structure','table'],['requirements','list'],['standard-check','results'],['electrical','results'],['short-circuit','results'],['rating-table','results'],['comparison','matrix'],['specification','content'],['structure','quantities']]) {
      if(tab==='quantities'){await page.goto(`${fixture.url}/types/${type.id}/structure/quantities?theme=${theme}`);await expect(page.locator('[data-type-page="quantities"]')).not.toHaveAttribute('data-type-state','loading');}
      else await visit(type.id,module,tab,theme);
      if(tab==='materials')await expect(page.locator('.type-material-comparison').getByRole('table',{name:'材料物性核对',exact:true})).toBeVisible();
      await check(`${type.name}/${module}/${tab}/${theme}`);
      if(['short-circuit','rating-table','standard-check','electrical'].includes(module)) {
        const table=page.locator('[data-type-page] table').first();
        if(await table.count()&&await table.locator('tbody tr.data-row').count()) {
          await table.locator('tbody tr.data-row').first().getByRole('cell').first().click();
          await check(`${type.name}/${module}/selected/${theme}`);
          const trace=page.locator('.type-result-trace');await expect(trace).toBeVisible();assert.equal(await trace.getAttribute('open'),null);
          if(module==='short-circuit') {
            const formula=page.locator('[data-saved-formula]').first();
            await expect(formula).toBeVisible();assert.ok(await formula.locator('sub').count()>=3,'Saved short-circuit formula uses semantic subscripts');
            assert.doesNotMatch(await formula.innerText(),/[_{}]/,'No typesetting code in the displayed formula');
            const bounds=await formula.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));assert.ok(bounds.scroll<=bounds.width+1,'Formula fits its full-width row');
            assert.match(await formula.innerText(),/√/);await expect(page.locator('.property-panel')).toContainText(/第 \d+ 页（PDF 第 \d+ 页）/);
            await trace.locator('summary').click();await expect(trace).toContainText(/完整显示精度/);await check(`${type.name}/trace-expanded/${theme}`);await trace.locator('summary').click();
            const curve=page.locator('.type-curve-disclosure');assert.equal(await curve.getAttribute('open'),null,'Curve folded by default');
            const dimensions=await table.locator('..').evaluate(n=>({height:n.clientHeight,scroll:n.scrollHeight}));assert.ok(dimensions.scroll<=dimensions.height+2,'Entire result table lays out by content');
            await curve.locator('summary').click();await expect(curve.locator('.type-curve').or(curve.getByText('此运行未保存时间曲线',{exact:true})).or(curve.getByText('所选组件未生成有效时间曲线',{exact:true}))).toBeVisible();
            const sampling=page.getByRole('combobox',{name:'采样时间',exact:true});
            if(await sampling.count()){
              await sampling.click();await page.getByRole('option').first().click();await check(`${type.name}/curve-sample/${theme}`);
              const fontSizes=await curve.locator('svg text').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)*Math.hypot(node.getScreenCTM().a,node.getScreenCTM().b)));assert.ok(fontSizes.every(size=>size>=13-.01),'Rendered chart axes stay at least 13 px');
              if(curveOnly&&width===1366&&theme==='light'){await curve.scrollIntoViewIfNeeded();const screenshot=path.join(output,'short-circuit-curve.png');await page.screenshot({path:screenshot});report.screenshots.push(screenshot);}
            }
            await curve.locator('summary').click();
          }
          if(module==='rating-table') {
            for(const summary of await table.locator('.type-rating-condition summary').all()) {
              assert.ok(await summary.getAttribute('title'),'Full condition remains available on hover');
              assert.equal(await summary.evaluate(n=>getComputedStyle(n).whiteSpace),'nowrap');
            }
            assert.doesNotMatch(await table.innerText(),/三芯直埋单回 · 三芯直埋/,'Condition name is not repeated with its layout');
            for(const current of await table.locator('td[data-column=current]').allTextContents())assert.match(current,/^(?:[\d −]+\.\d|—)$/,'Current has 0.1 A precision');
            const all=page.getByRole('checkbox',{name:'选择全部工况',exact:true});await expect(all).toBeVisible();
            const first=table.getByRole('checkbox').first();
            if(!await first.isDisabled()){
              await all.check();await first.uncheck();if(await table.getByRole('checkbox').count()>1)await expect(all).toHaveAttribute('data-state','indeterminate');
              await all.check();await expect(all).toBeChecked();await all.uncheck();await expect(all).not.toBeChecked();
              const shape=await all.evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,radius:parseFloat(getComputedStyle(n).borderRadius)}));assert.equal(shape.width,shape.height);assert.ok(shape.radius<shape.width/2,'Checkbox is square, not a solid dot');
            }
          }
          if(type.id===mv.id&&width===1366&&theme==='light'&&['short-circuit','rating-table'].includes(module)){await visit(type.id,module,tab,theme);await page.getByRole('table',{name:module==='rating-table'?'载流量表':'短路容量',exact:true}).locator('tbody tr.data-row').first().getByRole('cell').nth(module==='rating-table'?1:0).click();const screenshot=path.join(output,module+'.png');await page.screenshot({path:screenshot});report.screenshots.push(screenshot);}
        }
      }
    }
  }
  if(!focused&&!curveOnly){const studies=[];
  for(const w of await fixture.api('/api/workspaces'))if(/直埋|三回排管/.test(w.name))for(const s of await fixture.api(`/api/workspaces/${w.id}/studies`))if(s.latest_run_id&&s.definition.method.plugin_id==='cablesim.iec60287'){studies.push({w,s});break;}
  assert.ok(studies.length>=2,'Real saved research drawing fixtures');
  for(const {w,s} of studies)for(const width of [1366,1920])for(const theme of ['light','dark'])for(const view of ['cable','section']){
    await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/studies/${s.id}?workspace=${w.id}&view=${view}&theme=${theme}`);
    const open=page.getByRole('button',{name:'查看布置图',exact:true}),toolbar=page.getByRole('toolbar',{name:'视图与绘图工具'});
    await expect(toolbar.or(open).first()).toBeVisible();if(await open.isVisible())await open.click();await expect(toolbar).toBeVisible();
    await expect(page.locator('svg[data-drawing-canvas]')).toBeVisible();await check(`${w.name}/${view}/${theme}`,'.workbench-canvas');
  }
  }
  }else {
    for(const width of [1366,1920])for(const theme of ['light','dark'])for(const state of ['loading','empty','error']){
      await page.setViewportSize({width,height:width===1366?768:1080});const pattern=`**/api/workspaces/${mv.id}/studies`;let release;const held=new Promise(resolve=>{release=resolve;});
      const handler=async route=>{if(state==='loading'){await held;await route.abort().catch(()=>{});}else await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'保存结果读取中断，请重新读取'}:[])});};await page.route(pattern,handler);
      try{await page.goto(`${fixture.url}/types/${mv.id}/short-circuit/results?theme=${theme}`);await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state',state);await check(`${state}/${theme}`);if(state==='error')await expect(page.getByRole('button',{name:'重新读取',exact:true})).toBeVisible();}finally{release();await page.unroute(pattern,handler);}
    }
    // Success and history are real saved evidence, never invented numerical output.
    await visit(mv.id,'short-circuit','results');await page.getByRole('button',{name:'计算短路容量',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'计算短路容量 · 预检',exact:true});await expect(confirm).toBeVisible();await confirm.getByRole('checkbox',{name:'已核对输入来源与方法适用范围'}).check();await confirm.getByRole('button',{name:'确认并运行',exact:true}).click();await expect(confirm).toBeHidden();
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});const content=await visit(mv.id,'short-circuit','results',theme);await expect(content).toHaveAttribute('data-type-state','success');await check(`success/${theme}`);}
    const before=await fixture.api(`/api/workspaces/${mv.id}`),document=structuredClone(before.domain);document.cable_types[0].cores[0].layers.find(l=>l.role==='insulation').thickness+=.0001;await fixture.api(`/api/workspaces/${mv.id}/domain`,'PUT',{expected_revision:before.revision,document});
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});const content=await visit(mv.id,'short-circuit','results',theme);await expect(content).toHaveAttribute('data-type-state','historical');await check(`historical/${theme}`);}
  }
  assert.deepEqual(fixture.errors,[]);
}catch(error){report.failure=String(error.stack||error);report.log=fixture.log();console.error(report.failure);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await fixture.close();report.closed=true;await fs.writeFile(path.join(output,statesOnly?'browser-states.json':curveOnly?'browser-curve.json':focused?'browser-focused.json':'browser.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,closed:report.closed,failure:report.failure}));
