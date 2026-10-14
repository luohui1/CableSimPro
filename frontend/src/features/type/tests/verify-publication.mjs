import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect as baseExpect} from '@playwright/test';
import {root,typeFixture} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';
import {createPerformanceAudit} from '../../../../scripts/performance-audit.mjs';

const performanceOnly=process.env.TYPE_PUBLISH_PERFORMANCE_ONLY==='1';
const out=path.join(root,'.data/type-publish',performanceOnly?'performance-browser':'browser');await fs.mkdir(out,{recursive:true});
const fixture=await typeFixture({main:true,build:process.env.E2E_FRONTEND_DIST||path.join(root,'frontend/dist'),readOnly:performanceOnly});
const {page,context}=fixture,expect=baseExpect.configure({timeout:30000});
const report={source:process.env.E2E_DATABASE_SOURCE,steps:[],layouts:[],errors:fixture.errors,runtime:fixture.runtime};
const began=Date.now();let clicks=0;
const count=spec=>spec.payload.checks.filter(item=>item.blocking).length;
const target='41bdf226-ac2c-49f5-a1e4-5b63f94934ee';
const route=(module,tab)=>fixture.url+`/types/${target}/${module}/${tab}?theme=light`;
async function matrix(state){for(const width of [1366,1920])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  report.layouts.push({state,width,theme,...await checkLayout(page,'.type-root')});
}await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');}
async function spec(){return fixture.api(`/api/types/${target}/specification?view=detail`);}
try{
  let current=await spec();assert.equal(current.payload.purpose,'demo');
  assert.equal(current.payload.sources.length,5,'五个模块必须是真实保存运行');
  assert.ok(current.payload.sources.every(source=>source.freshness==='current'));
  const short=current.payload.results.short_circuit.artifact;
  const sharing=short.rows.find(row=>row.id.endsWith('parallel-fault-sharing'));
  assert.equal(sharing.status,'available');assert.equal(sharing.formula_inputs.components.length,4);
  assert.equal(short.rows.filter(row=>row.id.endsWith('metallic_screen-fault-check')&&row.satisfied===true).length,3);
  report.steps.push({operation:'五模块当前真实证据',blocking:count(current),sources:current.payload.sources,sharing});
  if(!performanceOnly){
  await page.goto(route('requirements','list'));
  await expect(page.locator('[data-type-page="requirements-results"]')).toHaveAttribute('data-type-state','success');
  const available=page.locator('[role="checkbox"][aria-label^="选择"]:not(:disabled):not([aria-disabled="true"])');
  const requiredCount=await available.count();assert.ok(requiredCount>0);
  for(const box of await available.all()){await box.check();clicks++;}
  await page.getByRole('button',{name:'批准所选要求',exact:true}).click();clicks++;
  const requirementDialog=page.getByRole('dialog',{name:'批准所选要求'});
  await requirementDialog.getByLabel('审批人').fill('真实使用工程师');
  await requirementDialog.getByRole('checkbox').check();
  await requirementDialog.getByRole('button',{name:'批准所选要求',exact:true}).click();clicks+=3;
  await expect(requirementDialog).not.toBeVisible();
  report.steps.push({operation:'人工核对当前要求定义',selected:requiredCount});
  await page.goto(route('short-circuit','results'));await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state','success');
  await matrix('short-circuit-success');await page.screenshot({path:path.join(out,'short-circuit-1366-light.png')});
  await page.goto(route('specification','review'));await expect(page.locator('[data-type-page="specification-results"]')).toHaveAttribute('data-type-state','success');
  await matrix('review-success');await page.screenshot({path:path.join(out,'review-before-1366-light.png')});
  const reasons=check=>check.id==='geometry/mass'?'本教学尺寸规格不含重量报价，缺少配方密度和制造证明，须另行核定。':check.channel==='standards'?(check.id.includes('screen')?'本教学规格不含屏蔽固定截面出厂合格声明；标准未规定固定截面，三芯短路校核已在独立章节计算。':'本教学规格不含额外包带的标准厚度与假设直径合格声明，当前方法未覆盖此构造，须另行核定。'):check.channel==='electrical'?'本次发布不含钢铠装完整线路阻抗；实际敷设、接地和大地回流须在工程研究中另行计算。':'本次只采用明确条件下的绝热容量，不含缺介质热参数的非绝热容量结果；须另行核定热参数。';
  while(count(current)){
    const check=current.payload.checks.find(item=>item.blocking);
    assert.ok(['geometry','electrical','short_circuit','standards'].includes(check.channel));
    assert.notEqual(check.result?.status,'failed');assert.notEqual(check.result?.verdict,'failed');
    const candidate=page.locator('[data-check-id='+JSON.stringify(check.id)+']');
    if(!await candidate.isVisible()){
      for(const group of await page.locator('.type-review-groups > section > details').all())if(!await group.getAttribute('open')){await group.locator(':scope > summary').click();clicks++;}
    }
    const declaration=candidate.locator('.type-scope-declaration');await expect(declaration).toBeVisible();
    await declaration.locator(':scope > summary').click();clicks++;
    await declaration.locator('input').fill(reasons(check));clicks++;
    const before=count(current);await declaration.getByRole('button',{name:'本人确认不含此项',exact:true}).click();clicks++;
    await expect.poll(async()=>count(await spec())).toBe(before-1);
    current=await spec();report.steps.push({operation:'人工逐项声明',item:check.id,reason:reasons(check),blocking:count(current)});
    await expect(page.locator('.type-result-summary')).toContainText(`${count(current)} 项阻止发布`);
  }
  // Undo is a real scope mutation; it restores the original blocking result.
  await page.getByRole('button',{name:'撤销声明',exact:true}).first().click();clicks++;
  await expect.poll(async()=>count(await spec())).toBe(1);current=await spec();
  const check=current.payload.checks.find(item=>item.blocking);
  for(const group of await page.locator('.type-review-groups > section > details').all())if(!await group.getAttribute('open')){await group.locator(':scope > summary').click();clicks++;}
  const declaration=page.locator('[data-check-id='+JSON.stringify(check.id)+']').locator('.type-scope-declaration');
  if(!await declaration.getAttribute('open')){await declaration.locator(':scope > summary').click();clicks++;}
  await declaration.locator('input').fill(reasons(check));await declaration.getByRole('button',{name:'本人确认不含此项',exact:true}).click();clicks+=2;
  await expect.poll(async()=>count(await spec())).toBe(0);current=await spec();assert.equal(current.ready,true);
  await matrix('scoped-success');await page.screenshot({path:path.join(out,'review-after-1366-light.png')});
  for(const name of ['采纳为版本草稿','提交评审','人工批准','发布型号版本']){
    await page.locator('.type-result-summary').getByRole('button',{name,exact:true}).click();clicks++;
    const dialog=page.getByRole('dialog',{name});await expect(dialog).toBeVisible();
    if(name==='提交评审'){await dialog.getByLabel('变更摘要').fill('真实五模块计算；教学设计参数与明确不含项随客户规格保存');await dialog.getByLabel('编制人').fill('真实使用工程师');clicks+=2;}
    await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name,exact:true}).click();clicks+=2;
    await expect(dialog).not.toBeVisible();current=await spec();report.steps.push({operation:name,blocking:count(current),status:current.lifecycle.status});
  }
  assert.equal(current.lifecycle.status,'published');assert.ok(current.lifecycle.approval.release_exclusions.length);
  execFileSync(process.env.PYTHON||path.join(root,'.venv/Scripts/python.exe'),['-c',"import sqlite3,sys;from pathlib import Path;s=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True);t=sqlite3.connect(sys.argv[2]);s.backup(t);t.close();s.close()",fixture.database,path.join(root,'.data/type-publish/published.sqlite')],{windowsHide:true});
  for(const audience of ['customer','internal']){
    const value=await fixture.api(`/api/types/${target}/specification?audience=${audience}&view=detail`);
    assert.ok(value.html.includes('本次发布不含项')&&value.html.includes('教学'));
    assert.ok(value.html.includes('GB/T 12706.2'),'人工批准的执行标准必须进入规格书');
    const response=await fetch(fixture.url+`/api/types/${target}/specification/file?expected_revision=${value.payload.revision}&specification_digest=${value.digest}&audience=${audience}`);
    if(response.status!==200)throw Error('规格书导出 '+response.status+' '+await response.text());const pdf=Buffer.from(await response.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');await fs.writeFile(path.join(out,audience+'.pdf'),pdf);
  }
  await matrix('published');
  }else{
    assert.equal(current.lifecycle.status,'published');assert.equal(count(current),0);
    assert.ok(current.lifecycle.approval.release_exclusions.length);
    await page.goto(route('specification','review'));
    await expect(page.locator('[data-type-page="specification-results"]')).toHaveAttribute('data-type-state','success');
    await matrix('published-read');
  }
  process.env.PERFORMANCE_PASS=performanceOnly?'type-publish-sealed':'type-publish';const audit=await createPerformanceAudit({page,context,root,base:fixture.url});
  for(const part of ['specification/review','electrical/results','short-circuit/results','rating-table/results'])for(let sample=1;sample<=3;sample++)for(const kind of ['cold','hot'])await audit.measure({route:`/types/${target}/${part}`,label:part+' · '+sample,owner:'三维'},kind);
  await audit.save({complete:true,scope:'真实发布后的型号页，冷热各三次',errors:fixture.errors,uncovered:[]});report.performance=audit.report.counts;
  assert.ok(audit.report.pages.every(value=>!value.terminalErrors.length));
  if(performanceOnly){
    await page.goto(route('specification','content'));
    await expect(page.locator('[data-type-page="specification-results"]')).toHaveAttribute('data-type-state','success');
    await page.getByRole('navigation',{name:'规格书章节'}).getByRole('button',{name:'结构尺寸表',exact:true}).click();
    const frame=page.frameLocator('iframe[title="正式规格书预览"]');
    const svg=frame.locator('[data-specification-section="structure"] svg');
    await expect(svg).toBeVisible();assert.ok(await svg.locator('circle').count()>0);
    report.sectionPreview=await svg.evaluate(element=>{
      const box=element.viewBox.baseVal;
      return {circles:element.querySelectorAll('circle').length,overflow:[...element.querySelectorAll('text,circle')].flatMap(node=>{
        const b=node.getBBox();return b.x<0||b.y<0||b.x+b.width>box.width||b.y+b.height>box.height?[node.textContent||node.tagName]:[];
      })};
    });
    assert.deepEqual(report.sectionPreview.overflow,[]);
    await page.screenshot({path:path.join(out,'published-section-1366-light.png')});
  }
  assert.deepEqual(fixture.errors,[]);report.complete=true;
}catch(error){report.failure=String(error.stack||error);report.failedText=await page.locator('body').innerText().catch(()=>null);report.log=fixture.log();process.exitCode=1;console.error(report.failure);}
finally{report.elapsed_s=(Date.now()-began)/1000;report.operations=clicks;await fixture.close();report.closed=true;await fs.writeFile(path.join(out,'real-use.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({complete:report.complete,operations:clicks,elapsed_s:report.elapsed_s,performance:report.performance,failure:report.failure,closed:report.closed}));
