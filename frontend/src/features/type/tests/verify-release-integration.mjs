import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect as baseExpect} from '@playwright/test';
import {root,typeFixture} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';
import {createPerformanceAudit} from '../../../../scripts/performance-audit.mjs';

const phase=process.env.TYPE_RELEASE_PHASE||'after';
const uiOnly=process.env.TYPE_RELEASE_UI_ONLY==='1';
assert.ok(['before','after'].includes(phase));
const output=path.join(root,'.data/type-release-integration',phase+(uiOnly?'-interaction':''));await fs.mkdir(output,{recursive:true});
process.env.PERFORMANCE_PASS='type-release-'+phase;
const fixture=await typeFixture({main:true,build:process.env.E2E_FRONTEND_DIST||path.join(root,'frontend/dist')});
const {page,context}=fixture,expect=baseExpect.configure({timeout:30000});
const result={phase,source:process.env.E2E_DATABASE_SOURCE,checks:[],errors:fixture.errors,runtime:fixture.runtime};
await fs.writeFile(path.join(output,'runtime.json'),JSON.stringify({rootPid:process.pid,...fixture.runtime,database:fixture.database},null,2));
const route=(id,module,tab,theme='light')=>`/types/${id}/${module}/${tab}?theme=${theme}`;
async function matrix(state){for(const width of [1366,1920])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  result.checks.push({state,width,theme,...await checkLayout(page,'.type-root')});
}await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');}
try{
  const types=await fixture.api('/api/design/type-workspaces');
  const mv=types.find(t=>t.name.includes('3×240')),hv=types.find(t=>t.name.includes('110 kV')),other=types.find(t=>t.name.includes('3×300'));
  assert.ok(mv&&hv&&other,'真实发布库必须包含三个独立型号设计');
  const workspace=await fixture.api('/api/workspaces/'+mv.id),review=await fixture.api(`/api/types/${mv.id}/specification?audience=internal&view=detail`);
  assert.equal(review.ready,false);assert.equal(review.payload.purpose,'demo');
  assert.equal(workspace.domain.measurements.length,12);
  assert.ok(workspace.domain.measurements.every(m=>JSON.parse(m.source.reference).label==='教学示例实测'));
  const overlaps=Object.entries(workspace.domain.provenance).filter(([key])=>key.startsWith('/factory_measurements/')&&key.endsWith('/minimum_overlap'));
  assert.equal(overlaps.length,3);assert.ok(overlaps.every(([,source])=>JSON.parse(source.reference).label==='教学示例实测'));
  const rows=review.payload.results.standards.artifact.rows;
  assert.equal(rows.filter(r=>r.id.endsWith(':screen-area')).length,3);
  assert.ok(rows.filter(r=>r.id.endsWith(':screen-area')).every(r=>r.verdict==='missing'&&r.actual===10));
  result.seed={id:mv.id,name:mv.name,revision:workspace.revision,blockers:review.payload.checks.filter(c=>c.blocking),source:workspace.type_creation};
  const audit=uiOnly?null:await createPerformanceAudit({page,context,root,base:fixture.url});
  // Every timing navigates the real application. Cold/hot are browser-cache
  // states; server caches are retained, as in the shared inspection contract.
  const surfaces=[
    ...['requirements/list','standard-check/results','specification/review'].map(part=>({id:mv.id,part})),
    ...['rating-table/parameters','rating-table/results','specification/review','specification/revisions','electrical/parameters','short-circuit/parameters','short-circuit/results'].map(part=>({id:other.id,part})),
    {id:hv.id,part:'requirements/list'},
  ];
  await page.setViewportSize({width:1366,height:768});
  if(audit)for(const surface of surfaces)for(let sample=1;sample<=3;sample++)for(const kind of ['cold','hot'])
    await audit.measure({route:`/types/${surface.id}/${surface.part}`,label:surface.part+' · '+sample,owner:'三维'},kind);
  if(audit){await audit.save({complete:true,scope:'R29 型号要求、核对、审核与原九项加载候选',errors:fixture.errors,uncovered:[]});result.performance=audit.report.counts;}
  if(phase==='after'){
    if(audit)assert.ok(audit.report.pages.every(p=>!p.terminalErrors.length),'性能须是可用内容，不能拿错误提示算成功');
    for(const [module,tab]of[['requirements','list'],['standard-check','results'],['specification','review']]){
      await page.goto(fixture.url+route(mv.id,module,tab));await expect(page.locator(`[data-type-page="${module==='requirements'?'requirements':module==='specification'?'specification':'standard-check'}-results"]`)).not.toHaveAttribute('data-type-state','loading');
      await matrix(module);if(module==='specification')await page.screenshot({path:path.join(output,'teaching-review-1366-light.png'),animations:'disabled'});
    }
    // This design has never run electrical analysis: an actual saved empty
    // state, not fabricated evidence. Its retained geometry is truly historical.
    await page.goto(fixture.url+route(mv.id,'electrical','results'));
    await expect(page.locator('[data-type-page="electrical-results"]')).toHaveAttribute('data-type-state','empty');await matrix('empty');
    await page.goto(fixture.url+route(mv.id,'structure','quantities'));
    await expect(page.locator('[data-type-page="quantities"]')).toHaveAttribute('data-type-state','historical');await matrix('historical');
    let releaseLoading;const loadingGate=new Promise(resolve=>{releaseLoading=resolve;});
    await page.route('**/api/types/'+mv.id+'/display-runs*',async request=>{await loadingGate;await request.continue();});
    try{
      await page.goto(fixture.url+route(mv.id,'requirements','list'),{waitUntil:'domcontentloaded'});
      await expect(page.locator('[data-type-page="requirements-results"]')).toHaveAttribute('data-type-state','loading');await matrix('loading-delayed-network');
    }finally{releaseLoading();await page.unrouteAll({behavior:'wait'});}
    for(const module of ['electrical','short-circuit']){
      await page.goto(fixture.url+route(hv.id,module,'parameters'));await expect(page.locator('.type-method-fields')).toBeVisible();await matrix(module+'-success');
      // Broken installation is a deliberate fault injection; engineering outputs
      // and normal flows use the real host and saved release data throughout.
      const diagnostic='cablesim.standard-check: src/cablesim_standard_check/manufacturing.py 与清单摘要不一致';
      await page.route('**/api/methods*',r=>r.fulfill({status:409,json:{detail:{code:'PACKAGE_DIGEST_MISMATCH',message:diagnostic}}}));
      await page.reload();await expect(page.getByText('标准核对插件文件与发布记录不一致，请联系管理员重新安装。',{exact:true})).toBeVisible();
      assert.ok(!(await page.locator('.type-root').innerText()).includes('manufacturing.py'));
      await matrix(module+'-error');await page.screenshot({path:path.join(output,`${module}-diagnostic-1366-light.png`),animations:'disabled'});const details=page.locator('.type-method-error-detail').first();assert.equal(await details.getAttribute('open'),null);
      await details.locator('summary').click();await expect(details.locator('p')).toContainText(diagnostic);await expect(details.locator('p')).toBeVisible();await details.locator('summary').click();await page.unroute('**/api/methods*');
    }
    const evidence=await fixture.api(`/api/types/${other.id}/display-runs?recent=true&limit=100`);
    const batch=evidence.items.find(item=>item.snapshot?.definition?.driver?.kind==='batch');
    assert.ok(batch,'发布库保留真实载流量工况运行');
    const endpoint=`/api/design/workspaces/${other.id}/rating-table-runs/${batch.id}`;
    const compact=await fixture.api(endpoint+'?view=rows'),full=await fixture.api(endpoint);
    assert.deepEqual(compact.rows,full.rows);assert.equal(compact.run.input_digest,full.run.input_digest);assert.equal(compact.run.output_digest,full.run.output_digest);
    assert.ok(!('output' in compact.run)&&!('snapshot' in compact.run));
    assert.ok(batch.snapshot.definition.driver.cases.every(c=>!('input'in c)&&c.input_ref?.sha256));
    result.ratingProjection={rows:compact.rows.length,compactBytes:Buffer.byteLength(JSON.stringify(compact)),fullBytes:Buffer.byteLength(JSON.stringify(full)),digestsPreserved:true};
    result.faultInjection='仅安装损坏的错误态和真实请求延迟的加载态；正常计算、空态、历史与发布种子无模拟结果';
    if(audit)assert.equal(audit.report.counts.mainOverBudget,0,'内容预算未达标，查看逐请求瀑布');
  }
  assert.deepEqual(fixture.errors,[]);result.complete=true;
}catch(error){result.failure=String(error.stack||error);result.log=fixture.log();result.failedPage=page.url();result.failedText=await page.locator('body').innerText().catch(()=>null);console.error(result.failure);process.exitCode=1;}
finally{await fixture.close();result.closed=true;await fs.writeFile(path.join(output,'real-use.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify({phase,seed:result.seed?.id,performance:result.performance,complete:result.complete,failure:result.failure,closed:result.closed}));
