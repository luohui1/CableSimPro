// Run only against a copied demo DB. FEM_RECEIPT identifies saved studies; never 8100/8200.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openHeadlessBrowser, settle } from '../../../scripts/browser.mjs';
const origin=process.env.FRONTEND_URL || 'http://127.0.0.1:8118';
assert(!['8100','8200'].includes(new URL(origin).port),'Use an isolated service');
const receipt=JSON.parse(await fs.readFile(process.env.FEM_RECEIPT,'utf8'));
const output=receipt.folder;
const owned=await openHeadlessBrowser(); const { page }=owned;
page.setDefaultTimeout(60000);
const problems=[];page.on('pageerror',error=>problems.push(error.message));
const timings=JSON.parse(await fs.readFile(path.join(output,'browser-timings.json'),'utf8').catch(()=>'{}'));
async function execute(kind,module,tab) {
  const started=Date.now();
  let run=receipt[kind+'Run'] ? {id:receipt[kind+'Run']} : null;
  if (!run) {
  await page.goto(`${origin}/studies/${receipt[kind]}/${module}/${tab}?workspace=${receipt.workspace}&theme=light`);
  await settle(page);
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'运行前预检'});
  await dialog.waitFor();
  await page.waitForFunction(()=>{const d=document.querySelector('[role=dialog]');return d?.textContent.includes('你的工况在适用范围内') || d?.textContent.includes('预检失败') || d?.textContent.includes('需要修正')},null,{timeout:900000});
  const body=await dialog.innerText();
  await fs.writeFile(path.join(output,kind+'-preflight.txt'),body);
  assert(body.includes('你的工况在适用范围内'),body);
  if(kind==='fem') {
    assert(body.includes('核时预算上限') && body.includes('节点'),'Mesh and budget required');
    await dialog.getByRole('checkbox').check();
  }
  const accepted=page.waitForResponse(r=>r.request().method()==='POST' && /\/runs$/.test(new URL(r.url()).pathname),{timeout:900000});
  await dialog.getByRole('button',{name:'确认并运行',exact:true}).click();
  const response=await accepted; assert(response.ok(),await response.text());
  run=await response.json(); receipt[kind+'Run']=run.id;
  timings[kind]={started_at:new Date(started).toISOString()};
  await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));
  }
  for(let i=0;i<1440;i++) {
    const status=await page.request.get(`${origin}/api/workspaces/${receipt.workspace}/studies/${receipt[kind]}/runs/${run.id}`,{timeout:180000});
    const current=await status.json();
    if(!['accepted','running','validating'].includes(current.status)) {
      await fs.writeFile(path.join(output,kind+'-result.json'),JSON.stringify(current));
      timings[kind]={...timings[kind],inspection_seconds:(Date.now()-started)/1000,wall_seconds:(Date.parse(current.finished)-Date.parse(current.created))/1000,status:current.status,execution:current.execution};
      assert(['succeeded','partial'].includes(current.status),JSON.stringify(current.error || current.output?.cases?.map(c=>c.error)));
      return current;
    }
    if(i%12===0)console.log(kind,JSON.stringify(current.execution || {status:current.status}));
    await page.waitForTimeout(5000);
  }
  throw Error('Run still pending; retain receipt and original job, do not resubmit.');
}
try {
  await page.setViewportSize({width:1366,height:768});
  await execute('iec','ampacity','results');
  await execute('fem','thermal-field','field');
  await page.goto(`${origin}/studies/${receipt.fem}/thermal-field/field?workspace=${receipt.workspace}&run=${receipt.femRun}&theme=light`);
  await page.getByRole('img',{name:'温度场',exact:true}).waitFor({timeout:120000});
  await settle(page);
  const hotspot=await page.locator('.workbench-canvas .field-hotspot circle').boundingBox();
  if(hotspot){await page.mouse.move(hotspot.x+hotspot.width/2,hotspot.y+hotspot.height/2);for(let i=0;i<12;i++){await page.mouse.wheel(0,-80);await page.waitForTimeout(40);}}
  await page.mouse.move(10,10);
  await page.screenshot({path:path.join(output,'fem-workbench.png')});
  await page.getByRole('tab',{name:'取样',exact:true}).click();
  await page.getByRole('button',{name:'放大结果面板',exact:true}).click();
  const table=page.getByRole('table',{name:'有限元与IEC量值对照'});
  await table.waitFor({timeout:180000});
  const comparisonText=await table.innerText();
  assert(comparisonText.includes('361.39') && comparisonText.includes('362.24'),'Expected saved FEM/IEC common currents');
  await fs.writeFile(path.join(output,'comparison.txt'),comparisonText);
  await table.scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({path:path.join(output,'fem-comparison.png')});
  assert.equal(problems.length,0,problems.join('\n'));
} finally {
  await fs.writeFile(path.join(output,'browser-timings.json'),JSON.stringify(timings,null,2));
  await owned.close();
}
