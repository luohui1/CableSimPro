// No rebinding or synthetic output: regenerate from the sealed saved evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect as baseExpect} from '@playwright/test';
import {openHeadlessBrowser,repositoryRoot} from './browser.mjs';
import {request} from './research-fixtures.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('必须使用隔离库');
const base=process.env.FRONTEND_URL,receipt=JSON.parse(await fs.readFile(process.env.FEM_RECEIPT,'utf8'));
const out=path.join(repositoryRoot,'.data/fix-round/research/type-input/fem/report');await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session,expect=baseExpect.configure({timeout:60000});
const record={receipt,errors:[],writes:[],source:process.env.E2E_DATABASE_SOURCE};
page.on('pageerror',error=>record.errors.push(error.message));
page.on('request',req=>{if(req.url().includes('/api/')&&!['GET','HEAD'].includes(req.method()))record.writes.push({path:new URL(req.url()).pathname,body:req.postDataJSON()});});
try{
  await page.setViewportSize({width:1366,height:768});
  const start=Date.now();await page.goto(`${base}/studies/${receipt.study}/thermal-field/results?workspace=${receipt.workspace}&run=${receipt.run}&theme=light`);
  await expect(page.locator('.answer-bar')).toContainText('已收敛');record.openSeconds=(Date.now()-start)/1000;
  record.summary=await request(base,`/api/workspaces/${receipt.workspace}/runs/${receipt.run}/fem-conclusion`);
  record.run=await request(base,`/api/workspaces/${receipt.workspace}/studies/${receipt.study}/runs/${receipt.run}`);
  record.chapter=await request(base,`/api/hpc/workspaces/${receipt.workspace}/chapters/${receipt.run}?iec_run_id=${receipt.iec_run}&convergence_id=${receipt.convergence}`);
  assert.equal(String(record.chapter.execution.job_id),receipt.job_id);
  await page.screenshot({path:path.join(out,'conclusion.png')});
  const button=page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'生成计算书',exact:true});
  if(record.run.version_status?.status==='stale'){
    await expect(button).toBeDisabled();
    record.formalGeneration={status:'blocked',reason:record.run.version_status,sourceUnchanged:true};
    for(const audience of ['customer','internal']){
      const response=await page.request.get(`${base}/api/workspaces/${receipt.workspace}/deliveries/${receipt.delivery}/pdf?audience=${audience}`);
      assert.equal(response.status(),200);await fs.writeFile(path.join(out,'saved-'+audience+'.pdf'),await response.body());
    }
    console.log('当前版本正式生成被过期门禁拒绝；已核对真实章节并读取原保存 PDF，未改写运行版本。');
  }else{
  assert.ok(await button.isEnabled(),'保存结果必须通过当前正式交付门禁；不绕过历史或未收敛限制');
  const generation=Date.now();await button.click();await expect(page.getByRole('button',{name:'下载 PDF',exact:true})).toBeEnabled();record.previewSeconds=(Date.now()-generation)/1000;
  await page.screenshot({path:path.join(out,'preview.png')});
  const generated=record.writes.findLast(item=>item.path.endsWith('/delivery-jobs'));assert.ok(generated);
  assert.equal(generated.body.fem_chapter.fem_run_id,receipt.run);
  // The preview URL is the saved delivery; downloads use that same immutable book.
  const did=new URL(page.url()).searchParams.get('delivery');assert.ok(did);
  for(const audience of ['customer','internal']){
    const response=await page.request.get(`${base}/api/workspaces/${receipt.workspace}/deliveries/${did}/pdf?audience=${audience}`);
    assert.equal(response.status(),200,await response.text().catch(()=>''));await fs.writeFile(path.join(out,audience+'.pdf'),await response.body());
  }
  }
  assert.ok(!record.writes.some(row=>row.path.endsWith('/runs')),'仅读取保存结果，不提交求解器');assert.deepEqual(record.errors,[]);
}catch(error){record.failure=String(error.stack||error);record.screen=await page.locator('body').innerText();await page.screenshot({path:path.join(out,'failed.png')});console.error(record.failure);process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'record.json'),JSON.stringify(record,null,2));await session.close();}
