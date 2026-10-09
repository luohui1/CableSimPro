import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, outputRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
import { assertLayout } from './layout-assertions.mjs';

if (process.env.E2E_ISOLATED !== '1') throw Error('场景验收只能使用隔离工程库');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({timeout:30000});
const out = path.join(outputRoot, 'research-scenarios', process.env.SCENARIO_PHASE || 'before');
await fs.mkdir(out,{recursive:true});
const session = await openHeadlessBrowser(), {page} = session;
page.setDefaultTimeout(15000);
const report = {steps:[],errors:[],writes:[],actions:[],layouts:[],threeSecondTests:[],transport:[]};
let measuring=true;
await page.exposeBinding('__scenarioAction',(_,{kind,name})=>{if(measuring)report.actions.push({kind,name,time:performance.now()});});
await page.addInitScript(()=>{
  // Radix selects commit on pointer events and can suppress click. Count the
  // physical pointer action once, including opening/selecting each dropdown.
  document.addEventListener('pointerdown',event=>{
    const target=event.target instanceof Element ? event.target.closest('button,a,[role="option"],input[type="checkbox"]') : null;
    if(target)void window.__scenarioAction({kind:'click',name:target.getAttribute('aria-label') || target.textContent.trim()});
  },true);
  document.addEventListener('change',event=>{if(event.target instanceof HTMLInputElement && event.target.type!=='checkbox')void window.__scenarioAction({kind:'field',name:event.target.id});},true);
});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))report.writes.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postDataJSON()});});
async function step(name, action) {
  const start=performance.now();
  await action();
  report.steps.push({name,seconds:Math.round((performance.now()-start)/10)/100});
  console.log(name+'：'+report.steps.at(-1).seconds+' s');
}
async function variants(label) {
  const start=performance.now();measuring=false;
  for(const size of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']) {
    await page.setViewportSize(size);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.waitForTimeout(200);await assertLayout(page,label);report.layouts.push({label,...size,theme});
  }
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  measuring=true;return performance.now()-start;
}
async function choose(label, pattern, scope=page) {
  await scope.getByRole('combobox',{name:label,exact:true}).click();
  await page.getByRole('option',{name:pattern}).click();
}
try {
  let excluded=0;const inquiryStart=performance.now();
  await page.setViewportSize({width:1366,height:768});
  await step('首页新建研究',async()=>{
    await page.goto(base+'/?theme=light');
    await page.getByRole('button',{name:'新建研究',exact:true}).first().click();
    await choose('研究任务','运行温度');
  });
  await step('型号与方法',async()=>{
    await page.getByLabel('研究名称',{exact:true}).fill('客户问询 · 12/20 kV 品字直埋');
    await choose('引用型号版本',/^YJL02-12\/20 kV 1×400（结构演示）/);
    await choose('计算方法',/^IEC 60287/);
    await page.getByRole('button',{name:'建立研究',exact:true}).first().click();
    await page.waitForURL(/\/studies\/[^/?]+\/ampacity\/results/);
    await expect(page.getByRole('button',{name:'预检并运行',exact:true})).toBeVisible();
  });
  report.createdUrl=page.url();
  report.threeSecondTests.push({screen:'新研究',purpose:'给定负荷校核温限',conclusion:'未运行',next:'敷设模板 → 填工况 → 保存 → 预检并运行'});
  excluded+=await variants('未运行工作台');
  await step('截面模板与工况',async()=>{
    await page.getByRole('button',{name:'敷设模板',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'敷设模板',exact:true});
    await choose('模板','单回品字',dialog);
    await dialog.getByLabel('中心埋深',{exact:true}).fill('0.9');
    await dialog.getByRole('button',{name:'应用模板',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await page.getByLabel('介质热阻率',{exact:true}).fill('0.8');
    await page.getByLabel('介质热阻率',{exact:true}).press('Enter');
    await page.getByLabel('回路 1 · 电流',{exact:true}).fill('500');
    await page.getByLabel('回路 1 · 电流',{exact:true}).press('Enter');
    await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'保存修改',exact:true}).click();
    await expect(page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'已保存',exact:true})).toBeVisible();
  });
  const url=new URL(page.url()), sid=url.pathname.split('/')[2], wid=url.searchParams.get('workspace');
  const prefix=`/api/workspaces/${wid}/studies/${sid}`;
  async function run() {
    await page.getByRole('button',{name:'预检并运行',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'运行前预检'});
    await expect(dialog).toContainText('你的工况在适用范围内',{timeout:60000});
    if(await dialog.getByRole('checkbox').count()) await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button',{name:'确认并运行',exact:true}).click();
    await expect(dialog).toHaveCount(0,{timeout:60000});
    await page.waitForURL(url=>!!url.searchParams.get('run'),{timeout:90000});
    const id=new URL(page.url()).searchParams.get('run');
    const saved=await request(base,prefix+'/runs/'+id);
    assert.equal(saved.integrity,'verified');assert.equal(saved.status,'succeeded');
    return saved;
  }
  await step('预检与实际 IEC 运行',async()=>{report.inquiry=await run();});
  await expect(page.locator('.conclusion')).toBeVisible();
  await expect(page.locator('.conclusion')).toContainText(/500.*满足温限.*最热/);
  report.conclusion=await page.locator('.conclusion').allTextContents();
  await page.screenshot({path:path.join(out,'inquiry.png')});
  await step('生成与下载客户计算书',async()=>{
    await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'生成计算书',exact:true}).click();
    await expect(page.getByRole('button',{name:'下载 PDF',exact:true})).toBeEnabled({timeout:60000});
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'下载 PDF',exact:true}).click();
    const file=await download; await file.saveAs(path.join(out,'customer.pdf'));
    const bytes=await fs.readFile(path.join(out,'customer.pdf'));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  });
  report.inquirySeconds=+( (performance.now()-inquiryStart-excluded)/1000).toFixed(2);
  report.inquiryClicks=report.actions.filter(action=>action.kind==='click').length;
  report.inquiryFieldEdits=report.actions.filter(action=>action.kind==='field').length;
  assert.ok(report.inquirySeconds<180,'客户问询必须在 3 分钟内完成');
  report.threeSecondTests.push({screen:'校核结论',purpose:'判断客户负荷',conclusion:report.conclusion.join(' '),next:'生成计算书 → 下载 PDF'});
  excluded=0;const sensitivityStart=performance.now(),sensitivityActionStart=report.actions.length;
  await step('打开同一研究并设置扫描',async()=>{
    await page.locator('.explorer-calc[aria-current="page"]').click();
    await choose('分析','参数扫描');
    await choose('扫描变量',/土壤热阻率/);
    for(const [label,value] of [['起点','0.6'],['终点','2.0'],['步长','0.2']]) {
      await page.getByLabel(label,{exact:true}).fill(value);await page.getByLabel(label,{exact:true}).press('Enter');
    }
    await page.getByLabel('范围出处',{exact:true}).fill('FRONTEND_REQUIREMENTS §6.1 参数敏感性验收计划，工程师指定 0.6–2.0 K·m/W');
    await page.getByRole('button',{name:'应用扫描设置',exact:true}).click();
    await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'保存修改',exact:true}).click();
    await expect(page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'已保存',exact:true})).toBeVisible();
  });
  await step('真实逐点扫描',async()=>{report.sweep=await run();});
  await step('扫描曲线与 CSV',async()=>{
    await expect(page.locator('.series-chart')).toBeVisible();
    await expect(page.locator('.sweep-critical')).toContainText('1.8–2');
    report.critical=await page.locator('.sweep-critical').innerText();
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出逐点 CSV',exact:true}).click();
    const file=await download;await file.saveAs(path.join(out,'sensitivity.csv'));
    report.csv=await fs.readFile(path.join(out,'sensitivity.csv'),'utf8');
    assert.match(report.csv,/单位/);assert.match(report.csv,/来源/);assert.match(report.csv,/cablesim.iec60287/);
  });
  report.threeSecondTests.push({screen:'敏感性曲线',purpose:'土壤热阻率对能力的影响',conclusion:report.critical,next:'方法对比 / 导出逐点 CSV'});
  excluded+=await variants('真实扫描曲线');
  await page.screenshot({path:path.join(out,'sensitivity.png')});
  await step('同输入方法对比配置',async()=>{
    await choose('分析','方法对比');
    await choose('对照方法版本',/交叉校核参考/);
    await page.getByRole('button',{name:'采用对照方法',exact:true}).click();
    await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'保存修改',exact:true}).click();
    await expect(page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'已保存',exact:true})).toBeVisible();
  });
  await step('IEC 与热网络真实对比',async()=>{report.comparison=await run();});
  await step('差异表与对比 CSV',async()=>{
    await expect(page.getByRole('table',{name:'方法结果差异'})).toBeVisible();
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出对比 CSV',exact:true}).click();
    const file=await download;await file.saveAs(path.join(out,'method-comparison.csv'));
    report.comparisonCsv=await fs.readFile(path.join(out,'method-comparison.csv'),'utf8');
    assert.match(report.comparisonCsv,/单位/);assert.match(report.comparisonCsv,/来源/);
    assert.match(report.comparisonCsv,/cablesim.thermal-network/);
  });
  report.sensitivitySeconds=+((performance.now()-sensitivityStart-excluded)/1000).toFixed(2);
  report.sensitivityClicks=report.actions.slice(sensitivityActionStart).filter(action=>action.kind==='click').length;
  report.sensitivityFieldEdits=report.actions.slice(sensitivityActionStart).filter(action=>action.kind==='field').length;
  report.threeSecondTests.push({screen:'方法差异',purpose:'同输入 IEC 与简化热网络对比',conclusion:'保存插件结果逐项显示差值，参考方法不作通过依据',next:'导出对比 CSV / 返回曲线'});
  await variants('真实方法差异');
  // Post-flow states use the real saved runs; no response numeric values are fabricated.
  measuring=false;
  await page.locator('.explorer-calc[aria-current="page"]').click();
  await variants('成功负荷校核');measuring=false;
  await page.getByRole('button',{name:'敷设模板',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'敷设模板',exact:true});
  await modal.getByLabel('中心埋深',{exact:true}).fill('-1');
  const writesBefore=report.writes.length;
  await modal.getByRole('button',{name:'应用模板',exact:true}).click();
  await expect(modal).toContainText('请输入大于 0');assert.equal(report.writes.length,writesBefore,'非法埋深不能写入');
  await variants('模板字段错误');measuring=false;
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
  await page.getByLabel('介质热阻率',{exact:true}).fill('1.1');await page.getByLabel('介质热阻率',{exact:true}).press('Enter');
  // Text fields keep native text undo; research undo applies after leaving the editor.
  await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'敷设模板',exact:true}).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async()=>Number(await page.getByLabel('介质热阻率',{exact:true}).inputValue())).toBe(0.8);
  await page.getByLabel('介质热阻率',{exact:true}).fill('1.1');await page.getByLabel('介质热阻率',{exact:true}).press('Enter');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'已保存',exact:true})).toBeVisible();
  await expect(page.locator('.study-history-line')).toContainText('历史');
  await variants('历史校核结果');measuring=false;
  await page.goto(base+`/studies?workspace=${wid}`);await expect(page.getByRole('table',{name:'本工程研究'})).toBeVisible();
  await expect(page.locator('.command-state')).toHaveText(/待重算|已保存/);await variants('工程首页短状态');
  let releaseContract;
  const contractGate=new Promise(resolve=>{releaseContract=resolve;});
  const held=async route=>{await contractGate;await route.continue();};
  await page.route('**/api/input-contracts',held);
  try {
    await page.goto(report.createdUrl+'&inspector=method');
    await expect(page.getByText('正在读取方法输入契约',{exact:true})).toBeVisible();
    await variants('方法契约加载');
  } finally {
    releaseContract();
    // Wait for the held handler before removing it; otherwise navigation can
    // auto-handle the request while its delayed continue() is still pending.
    await page.unrouteAll({behavior:'wait'});
  }
  await page.route('**/api/input-contracts',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'验收注入：契约服务暂不可用'})}));
  await page.reload();
  await expect(page.getByText('方法契约不可用',{exact:true})).toBeVisible();
  await variants('方法契约错误');
  const preservedDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出已保存参数',exact:true}).click();
  const preservedFile=await preservedDownload;
  await preservedFile.saveAs(path.join(out,'saved-method-parameters.json'));
  const preserved=JSON.parse(await fs.readFile(path.join(out,'saved-method-parameters.json'),'utf8'));
  assert.equal(preserved.method.plugin_id,'cablesim.iec60287');
  assert.ok(Object.keys(preserved.parameters).length,'契约服务故障不丢保存参数');
  await page.unroute('**/api/input-contracts');
  await page.getByRole('button',{name:'重新读取契约',exact:true}).click();
  await expect(page.getByText('方法契约不可用',{exact:true})).toHaveCount(0);
  assert.deepEqual(report.errors,[]);
  console.log(JSON.stringify({inquiry:{seconds:report.inquirySeconds,clicks:report.inquiryClicks},sensitivity:{seconds:report.sensitivitySeconds,clicks:report.sensitivityClicks},out}));
  report.screen=await page.locator('body').innerText();
} catch(error) {
  report.failure=error.stack;
  report.screen=await page.locator('body').innerText().catch(()=> '');
  await page.screenshot({path:path.join(out,'key-screen.png')}).catch(()=>{});
  throw error;
} finally {
  await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));
  await session.close();
}
