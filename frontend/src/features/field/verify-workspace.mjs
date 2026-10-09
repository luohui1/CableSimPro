/** Real production research canvas, one Edge page, no API mocks.
 * FRONTEND_URL=isolated preview; node .../verify-workspace.mjs <receipt.json>
 * The receipt supplies workspace/study/run IDs; host must contain that saved run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, repositoryRoot } from '../../../scripts/browser.mjs';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';

export async function verifyWorkspace(receiptPath) {
  const base=process.env.FRONTEND_URL || 'http://127.0.0.1:8118';
  assert(!['8100','8200'].includes(new URL(base).port),'Use an isolated service');
  const saved=JSON.parse(await fs.readFile(receiptPath,'utf-8'));
  const workspace=saved.workspace, study=saved.study, run=saved.run;
  assert(workspace && study && run,'Receipt requires workspace, study, run');
  const output=process.env.FIELD_EVIDENCE || path.join(repositoryRoot,'.data/fem-validation/browser');
  await fs.mkdir(output,{recursive:true});
  const url=`${base}/studies/${study}/thermal-field/field?workspace=${workspace}&run=${run}&view=field&theme=light`;
  const session=await openHeadlessBrowser(),{page}=session,errors=[],responses=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))responses.push({url:r.url(),status:r.status(),timing:r.request().timing(),bytes:r.headers()['content-length'],serverTiming:r.headers()['server-timing']});});
  try {
    await page.setViewportSize({width:1366,height:768});
    await page.goto(url);await page.waitForFunction(()=>!!document.querySelector('.study-field-slot canvas')?.width,null,{timeout:60000});
    await page.waitForLoadState('networkidle');const opens=[];
    for(let i=0;i<3;i++) {
      const start=performance.now();await page.reload();
      await page.waitForFunction(()=>!!document.querySelector('.study-field-slot canvas')?.width,null,{timeout:30000});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const elapsed=performance.now()-start;opens.push(elapsed);
      await page.waitForTimeout(500);
    }
    const canvas=page.locator('.study-field-slot canvas'),box=await canvas.boundingBox();
    const scale=page.locator('.study-field-slot .field-scale path');const before=await scale.getAttribute('d');
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-400);
    await page.waitForFunction(before=>document.querySelector('.study-field-slot .field-scale path')?.getAttribute('d')!==before,before);
    const layout=await assertLayout(page,'real research FEM canvas');
    assert.deepEqual(errors,[]);
    await canvas.dblclick();
    const hot=await page.locator('.study-field-slot .field-hotspot circle').boundingBox();
    await page.mouse.move(hot.x+hot.width/2,hot.y+hot.height/2);
    await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:5});await page.mouse.up();
    for(let i=0;i<24;i++){await page.mouse.wheel(0,-400);await page.waitForTimeout(30);}
    await page.mouse.move(20,20);await page.waitForTimeout(250);
    await page.screenshot({path:path.join(output,'research-field.png')});
    const evidence={workspace,study,run,opens_ms:opens,maximum_open_ms:Math.max(...opens),layout,errors,responses};
    await fs.writeFile(path.join(output,'workspace-performance.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({opens_ms:opens,output}));
    assert(Math.max(...opens)<=3000,`Research canvas opened in ${Math.max(...opens).toFixed(0)} ms`);
    return evidence;
  } finally {await session.close();}
}

export async function verifyReproductions(reportPath) {
  const base=process.env.FRONTEND_URL || 'http://127.0.0.1:8118';
  assert(!['8100','8200'].includes(new URL(base).port),'Use an isolated service');
  const report=JSON.parse(await fs.readFile(reportPath,'utf-8'));
  const output=process.env.FIELD_EVIDENCE || path.join(repositoryRoot,'.data/fem-validation/browser');
  await fs.mkdir(output,{recursive:true});
  const session=await openHeadlessBrowser(),{page}=session,errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.setViewportSize({width:1366,height:768});
    for(const saved of report.cases) {
      const detail=await (await page.request.get(`${base}/api/foundation/reproductions/${saved.id}`)).json();
      const row=detail.rows.find(r=>r.variant==='有限元 · 收敛网格' && r.quantity==='ampacity_a');
      assert.equal(row.open_source,saved.ampacity_a);assert.equal(row.reference,saved.reference_current_a);
      assert.equal(row.status,'outside_tolerance');assert.equal(detail.report_tolerance,null);
      assert.equal(detail.convergence_summary.passed,true);
      await page.goto(`${base}/validation/${saved.id}/results?theme=light`);
      await page.getByText('有限元 · 收敛网格',{exact:false}).first().waitFor();
      assert((await page.locator('body').innerText()).includes('超出声明容差'));
      const check={case:saved.id};checks.push(check);
      try {check.layout=await assertLayout(page,`TB 880 ${saved.id}`);}
      catch(error) {check.layout_error=error.message;}
      if(saved.id==='B02-2')await page.screenshot({path:path.join(output,'tb880-ducts.png')});
      await page.getByRole('tab',{name:'网格收敛',exact:true}).click();
      await page.getByLabel('比较量').waitFor();
      await page.getByRole('tab',{name:'输入来源',exact:true}).click();
      assert((await page.locator('body').innerText()).includes('p.75') || (await page.locator('body').innerText()).includes('p.87'));
    }
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'validation-checks.json'),JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({validation_cases:checks.length,output}));
    assert(checks.every(check=>!check.layout_error),'Validation layout gate failed; see validation-checks.json');
  } finally {await session.close();}
}

if(process.argv[1]?.replaceAll('\\','/').endsWith('/verify-workspace.mjs')) {
  if(process.env.HPC_VALIDATION_ONLY==='1')await verifyReproductions(process.argv[2]);
  else await verifyWorkspace(process.argv[2]);
}
