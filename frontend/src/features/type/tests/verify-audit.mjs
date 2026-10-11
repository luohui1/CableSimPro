import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const output=path.join(root,'.data/type-audit');await fs.mkdir(output,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/type-basis/validation/engineering.sqlite');
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
const expect=baseExpect.configure({timeout:30000}),report={checks:[],screenshots:[],errors:fixture.errors,runtime:fixture.runtime};
const actionsOnly=process.argv.includes('--actions'),statesOnly=process.argv.includes('--states');
async function visit(wid,module,tab,theme='light') {
  await page.goto(`${fixture.url}/types/${wid}/${module}/${tab}?theme=${theme}`);
  await expect(page.locator('[data-type-page]').first()).toBeVisible();
  await expect(page.locator('[data-type-page]').first()).not.toHaveAttribute('data-type-state','loading');
  await expect(page.locator('.adaptive-command-bar [data-command-role=save]').first()).toBeVisible();
}
try {
  const types=await fixture.api('/api/design/type-workspaces'),qf=types.find(t=>t.name.startsWith('起帆')),mv=types.find(t=>t.name.startsWith('YJV22'));assert.ok(qf&&mv);
  if(!statesOnly){
  if(!actionsOnly)for(const width of [1366,1920])for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    for(const [wid,module,tab] of [[qf.id,'structure','table'],[mv.id,'short-circuit','results'],[mv.id,'rating-table','results'],[qf.id,'specification','review'],[mv.id,'electrical','results'],[qf.id,'standard-check','results']]) {
      await visit(wid,module,tab,theme);
      const toolbar=page.locator('.adaptive-command-bar');
      assert.ok(await toolbar.locator('[data-command-role=primary]:visible').count()<=1,'One main command');
      const box=await toolbar.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));assert.ok(box.scroll<=box.width+1,'No horizontal command scrolling');
      if(module==='structure') {
        const canvas=page.locator('.workbench-canvas'),dock=page.locator('.workbench-dock');
        const a=await canvas.boundingBox(),b=await dock.boundingBox();assert.ok(a.height>=b.height-2,'Structure canvas occupies at least half');
        assert.ok(await canvas.locator('[data-layer-leader]').count()<=1,'Only selected layer is annotated by default');
        await page.getByRole('row',{name:'3 绝缘',exact:true}).getByRole('cell').first().click();await expect(canvas.locator('[data-layer-leader],.drawing-compact-layers button')).toHaveCount(1);
      }
      if(module==='rating-table') {
        const table=page.getByRole('table',{name:'载流量表',exact:true});await expect(table).toBeVisible();
        for(const label of ['允许电流 / A','状态','余量 / A']) {
          const h=await table.getByRole('columnheader',{name:label,exact:true}).boundingBox();assert.ok(h&&h.x+h.width<width,'Result columns visible before conditions');
        }
        assert.equal(await table.locator('details[open]').count(),0,'Conditions are folded by default');
      }
      if(module==='short-circuit') {
        const table=page.getByRole('table',{name:'短路容量',exact:true});await expect(table).toContainText('3 芯相同');
        const expand=table.locator('summary').first();await expand.click();await expect(expand.locator('..')).toContainText(/芯 1/);await expect(expand.locator('..')).toContainText(/芯 3/);await expand.click();
      }
      if(module==='specification') {
        const groups=page.getByLabel('按原因处理发布阻塞');await expect(groups).toBeVisible();
        assert.ok(await groups.locator('section').count()<20,'Blockers grouped instead of flat repeated list');
        assert.equal(await groups.locator('details[open]').count(),0);
        const visible=await groups.innerText();assert.doesNotMatch(visible,/core\/|material\/|bonding\.kind/,'No internal paths in visible blockers');
      }
      report.checks.push({module,width,theme,layout:await checkLayout(page,'.type-root')});
      if(width===1366&&theme==='light') {const image=path.join(output,module+'.png');await page.screenshot({path:image});report.screenshots.push(image);}
    }
  }
  // Exact field navigation survives the lazy method panel mounting.
  await visit(qf.id,'short-circuit','parameters');
  await page.goto(`${fixture.url}/types/${qf.id}/short-circuit/parameters?field=${encodeURIComponent('/duration_s')}`);
  await expect(page.locator('.type-method-fields [data-field-path="/duration_s"] input').first()).toBeFocused();report.checks.push({name:'method-field-deep-link'});
  // Real catalogue copy uses its stored provenance, with no repaired/fabricated data.
  await page.goto(fixture.url+'/types?create=1');const dialog=page.getByRole('dialog',{name:'新建型号设计',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox',{name:'型号名称',exact:true}).fill('隔离验收 · 库复制');
  await dialog.getByRole('searchbox',{name:'查找型号版本',exact:true}).fill('起帆');
  await dialog.getByRole('combobox',{name:'型号版本',exact:true}).click();await page.getByRole('option').first().click();
  await dialog.getByRole('button',{name:'建立草稿',exact:true}).click();await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/types\/[^/]+\/structure\/section/);report.checks.push({name:'catalogue-copy-real-provenance'});
  }else{
    for(const width of [1366,1920])for(const theme of ['light','dark'])for(const state of ['loading','empty','error']) {
      await page.setViewportSize({width,height:width===1366?768:1080});
      const pattern=`**/api/workspaces/${mv.id}/studies`;let release;const held=new Promise(resolve=>{release=resolve;});
      const handler=async route=>{if(state==='loading'){await held;await route.abort().catch(()=>{});}else await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'保存结果读取中断，请重新读取'}:[])});};
      await page.route(pattern,handler);
      try{await page.goto(`${fixture.url}/types/${mv.id}/short-circuit/results?theme=${theme}`);const content=page.locator('[data-type-page="short-circuit-results"]');await expect(content).toHaveAttribute('data-type-state',state);report.checks.push({state,width,theme,layout:await checkLayout(page,'.type-root')});if(state==='error')await expect(content.getByRole('button',{name:'重新读取'})).toBeVisible();}finally{release();await page.unroute(pattern,handler);}
    }
    // The successful state comes from a real saved plugin run, never a fake value.
    await visit(mv.id,'short-circuit','results');await page.getByRole('button',{name:'计算短路容量',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'计算短路容量 · 预检',exact:true});await expect(confirm).toBeVisible();
    await confirm.getByRole('checkbox',{name:'已核对输入来源与方法适用范围'}).check();await confirm.getByRole('button',{name:'确认并运行',exact:true}).click();await expect(confirm).toBeHidden();
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await visit(mv.id,'short-circuit','results',theme);await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','success');report.checks.push({state:'success',width,theme,layout:await checkLayout(page,'.type-root')});}
    const before=await fixture.api(`/api/workspaces/${mv.id}`),document=structuredClone(before.domain);document.cable_types[0].cores[0].layers.find(l=>l.role==='insulation').thickness+=.0001;
    await fixture.api(`/api/workspaces/${mv.id}/domain`,'PUT',{expected_revision:before.revision,document});
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await visit(mv.id,'short-circuit','results',theme);await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','historical');report.checks.push({state:'historical',width,theme,layout:await checkLayout(page,'.type-root')});}
  }
  assert.deepEqual(fixture.errors,[]);
}catch(error){report.failure=String(error.stack||error);report.log=fixture.log();console.error(report.failure);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await fixture.close();report.closed=true;await fs.writeFile(path.join(output,statesOnly?'browser-states.json':actionsOnly?'browser-actions.json':'browser.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,closed:report.closed,failure:report.failure}));
