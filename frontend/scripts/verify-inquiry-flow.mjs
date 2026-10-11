// Run via isolated-e2e.mjs verify-inquiry.mjs with INQUIRY_FULL_FLOW=1.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot, settle } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';
import { request } from './research-fixtures.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Requires an isolated database');
const expect=baseExpect.configure({timeout:30000}), base=process.env.FRONTEND_URL;
const output=path.join(repositoryRoot,'.data/fix-round/research/inquiry');
await fs.mkdir(output,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session;
const report={flows:[],checks:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});}
async function layout(label){for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);await assertLayout(page,label);}await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.waitForTimeout(250);}
try{
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(size);await page.goto(base+'/');await settle(page);
    const started=Date.now(),title=`新建问询验收 ${size.width} ${Date.now()}`;
    await page.getByRole('button',{name:'新建研究',exact:true}).first().click();
    const chooser=page.getByRole('dialog',{name:'新建研究',exact:true});
    if(await chooser.isVisible()){
      await chooser.getByRole('combobox',{name:'研究任务',exact:true}).click();
      await page.getByRole('option',{name:'客户问询选型',exact:true}).click();
    }
    const initial=page.getByRole('dialog',{name:'新建问询'});
    await expect(initial.getByLabel('目标电流',{exact:true})).toBeVisible();
    await initial.getByLabel('目标电流',{exact:true}).fill('400');
    await initial.getByLabel('目标电流',{exact:true}).press('Tab');
    await initial.getByLabel('研究名称',{exact:true}).fill(title);
    await initial.locator('input[type=radio]').first().check();
    await expect(initial).toContainText('核对埋深、土壤和负荷');
    await initial.getByRole('button',{name:'建立研究',exact:true}).click();
    const completion=page.getByRole('dialog',{name:'补录工程师给定参数'});
    await expect(completion.locator('[data-completion-key=conductor_form]')).toBeVisible();
    assert.ok(await completion.locator('[data-completion-key]').count()>=8,'真实契约生成全部补录字段');
    await completion.getByRole('button',{name:'保存并预检',exact:true}).click();
    await expect(completion.getByRole('alert')).toContainText('导体');
    await expect(completion.locator('[data-completion-key=conductor_form] [role=combobox]').first()).toBeFocused();
    assert.doesNotMatch(await completion.innerText(),/\/parameters\/|conductor_form/);
    await layout('缺项定位');
    await expect(completion.getByRole('button',{name:'采用参考输入',exact:true})).toBeEnabled();
    await completion.getByRole('button',{name:'采用参考输入',exact:true}).click();
    await expect(completion).toContainText('尚缺 0 项');
    await expect(completion.locator('[data-completion-key=conductor_form]')).toContainText('教学');
    await layout('参数已补录');if(size.width===1366)await shot('parameters-1366');
    if(size.width===1366){
      const rejected=async route=>route.request().method()==='POST' ? route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:{code:'REQUIRED',path:'/parameters/values/conductor_form',message:'请填写导体构造模型'}})}) : route.fallback();
      await page.route('**/api/design/study-workspaces',rejected);
      await completion.getByRole('button',{name:'保存并预检',exact:true}).click();
      await expect(completion.getByRole('alert')).toContainText('导体构造模型');
      await expect(completion.locator('[data-completion-key=conductor_form] [role=combobox]').first()).toBeFocused();
      assert.doesNotMatch(await completion.innerText(),/\/parameters\//);
      await expect(completion).toContainText('目标 400 A');await expect(completion).toContainText('尚缺 0 项');
      await page.unroute('**/api/design/study-workspaces',rejected);
      report.checks.push('负向 HTTP 注入：宿主 RFC6901 错误定位到中文控件，不清除目标、候选或已填参数；随后走真实请求');
    }
    await completion.getByRole('button',{name:'保存并预检',exact:true}).click();
    const preflight=page.getByRole('dialog',{name:'运行前预检'});
    await expect(preflight.getByText('你的工况在适用范围内 ✓',{exact:true})).toBeVisible({timeout:180000});
    const url=new URL(page.url()),sid=url.pathname.split('/')[2],wid=url.searchParams.get('workspace');
    const saved=(await request(base,`/api/workspaces/${wid}/studies`)).find(row=>row.id===sid);
    assert.equal(saved.definition.driver.minimum,400);
    assert.ok(saved.definition.driver.candidate_ids.length>=2);
    assert.ok(Object.values(saved.definition.input_sources).some(source=>source.kind==='demo'&&source.reference.includes('沿用保存研究')),'参考来源随研究保存');
    await preflight.getByRole('button',{name:'确认并运行',exact:true}).click();
    await expect(page.getByLabel('结论',{exact:true})).toContainText('推荐',{timeout:180000});
    await expect(page.locator('.command-state')).not.toContainText('未运行');
    const runs=await request(base,`/api/workspaces/${wid}/studies/${sid}/runs`),run=runs.items[runs.items.length-1];
    assert.equal(run.integrity,'verified');assert.ok(['succeeded','partial'].includes(run.status));
    assert.ok(run.output.assessment.every(row=>row.status!=='failed'));
    await expect(page.getByRole('button',{name:'查看布置图',exact:true})).toBeVisible();
    assert.equal(await page.locator('.workbench-canvas').count(),0,'比较表优先，画布可展开');
    await layout('真实选型结果');await shot(`results-${size.width}`);
    const table=page.locator('.study-selection-table').first();
    const headers=await table.locator('th').evaluateAll(nodes=>nodes.map(node=>({text:node.innerText,width:node.getBoundingClientRect().width,wrap:getComputedStyle(node).whiteSpace})));
    assert.ok(headers.every(header=>header.wrap==='nowrap'),'量名与单位不拆词');
    const tableSize=await table.evaluate(node=>({available:node.clientWidth,width:node.querySelector('table').getBoundingClientRect().width}));
    assert(tableSize.width<=tableSize.available+1,'1366 下六列比较表不需横向滚动');
    await page.getByRole('button',{name:'查看布置图',exact:true}).click();
    await expect(page.locator('.workbench-canvas')).toBeVisible();
    await page.getByRole('button',{name:'收起布置图',exact:true}).click();
    const flow={...size,seconds:(Date.now()-started)/1000,wid,sid,run:run.id,candidates:saved.definition.driver.candidate_ids.length,conclusion:await page.getByLabel('结论',{exact:true}).innerText(),headers};
    report.flows.push(flow);console.log(JSON.stringify(flow));
    if(size.width===1366){
      // Pause the real submission to inspect the in-flight UI. Do not replace
      // the job or PDF response with fixtures; both come from the saved run.
      let release;const gate=new Promise(resolve=>release=resolve);
      const hold=async route=>{if(route.request().method()!=='POST')return route.fallback();await gate;await route.continue();};
      await page.route('**/delivery-jobs',hold);
      try{
        await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'生成计算书',exact:true}).click();
        const module=page.locator('.report-module');
        await expect(module.getByText('正在生成',{exact:true})).toBeVisible();
        assert.doesNotMatch(await module.innerText(),/已生成|正在生成客户计算书/);
        await expect(module.getByRole('button',{name:'取消生成',exact:true})).toHaveCount(1);
        await expect(module.getByRole('button',{name:'生成客户计算书',exact:true})).toHaveCount(0);
        await shot('report-progress-1366');
      }finally{release();await page.unrouteAll({behavior:'wait'});}
      await expect(page.getByRole('button',{name:'下载 PDF',exact:true})).toBeEnabled({timeout:90000});
      await expect(page.getByTitle('计算书预览',{exact:true})).toBeVisible();
      const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载 PDF',exact:true}).click();
      const pdf=path.join(output,'customer.pdf');await (await pending).saveAs(pdf);
      assert.equal((await fs.readFile(pdf)).subarray(0,5).toString(),'%PDF-');
      report.checks.push('计算书仅一条本次生成进度，可取消；成功后预览并下载真实 PDF');
    }
  }
  assert.deepEqual(report.errors,[]);report.checks.push('两尺寸从首页新建、缺项焦点、参考来源、真实插件选型、比较布局与画布切换');
}catch(error){report.failure={message:error.message,screen:await page.locator('body').innerText()};await shot('failure');throw error;}
finally{await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify(report,null,2));await session.close();}
