import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {expect as baseExpect} from '@playwright/test';
import {typeFixture,root} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';

// One real browser, release database read-only backup, actual host/plugin receipts.
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/release/engineering.sqlite');
const output=path.join(root,'.data/type-to-study');await fs.mkdir(output,{recursive:true});
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
page.setDefaultTimeout(30000);
const expect=baseExpect.configure({timeout:30000}),report={steps:[],clicks:0,errors:fixture.errors,runtime:fixture.runtime,layouts:[],issues:[],assumptions:['四芯提案为等截面积实心圆的设计草稿；不是绞合导体实测外径。芯间净距0、填充与包带等效厚度各0.1 mm是明示工程设计输入。']};
const supportedOnly=process.argv.includes('--supported-only'),recordFile=path.join(output,supportedOnly?'supported-record.json':'record.json');
const started=performance.now();let wid,sid;
async function click(locator){report.clicks++;await locator.click();}
async function select(label,value){await click(page.getByRole('combobox',{name:label,exact:true}));await click(page.getByRole('option',{name:value,exact:true}));}
async function step(name,work){const start=performance.now(),clicks=report.clicks;try{await work();await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});report.steps.push({name,status:'completed',seconds:+((performance.now()-start)/1000).toFixed(2),clicks:report.clicks-clicks,text:(await page.locator('body').innerText()).slice(-10000)});}catch(error){report.steps.push({name,status:'failed',seconds:+((performance.now()-start)/1000).toFixed(2),error:String(error),text:(await page.locator('body').innerText()).slice(-10000)});await page.screenshot({path:path.join(output,name+'-failed.png')});throw error;}finally{await fs.writeFile(recordFile,JSON.stringify(report,null,2));}}
async function typeModule(name){await click(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:new RegExp('^'+name)}));}
async function runType(label){await click(page.getByRole('button',{name:label,exact:true}));const dialog=page.getByRole('dialog',{name:label+' · 预检',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();report.clicks++;await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:180000});}
async function openStudy(){const button=page.getByRole('button',{name:'用于载流量研究',exact:true});if(await button.isVisible())await click(button);else{await click(page.getByRole('button',{name:'更多操作',exact:true}));await click(page.getByRole('menuitem',{name:'用于载流量研究',exact:true}));}await expect(page.getByRole('dialog',{name:'新建研究',exact:true})).toBeVisible();}
async function createStudy(title){await openStudy();const dialog=page.getByRole('dialog',{name:'新建研究',exact:true});await dialog.getByRole('textbox',{name:'研究名称',exact:true}).fill(title);const received=page.waitForResponse(r=>r.url().endsWith(`/api/workspaces/${wid}/studies`)&&r.request().method()==='POST');await click(dialog.getByRole('button',{name:'建立研究',exact:true}));const response=await received;const saved=await response.json();await fs.writeFile(path.join(output,title.includes('四芯')?'four-core-study.json':'supported-study.json'),JSON.stringify(saved,null,2));assert.equal(response.status(),201,JSON.stringify(saved));sid=saved.id;await expect(page).toHaveURL(new RegExp('/studies/'+sid));await expect(page.getByRole('button',{name:'预检并运行',exact:true})).toBeVisible();return saved;}
async function relations(title){
  await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=light`);
  const card=page.locator('[data-type-card]'),details=card.locator('.relation-panel'),failure=card.getByRole('alert').filter({hasText:'关联读取失败'});
  await expect(card).toBeVisible();await card.scrollIntoViewIfNeeded();
  await click(card.getByRole('button',{name:'查看关联',exact:true}));
  await expect.poll(async()=>await details.isVisible()||await failure.isVisible()).toBe(true);
  if(await failure.isVisible()){
    report.issues.push({owner:'Agent / 统一索引',kind:'index-retry',reason:await failure.innerText()});
    await page.screenshot({path:path.join(output,'relation-index-error.png'),animations:'disabled'});
    await click(failure.getByRole('button',{name:'重新读取',exact:true}));
  }
  await expect(details).toBeVisible();await click(details.locator('summary').first());
  const link=details.locator('section[aria-label="被用于"]').getByRole('link',{name:new RegExp(title)});
  await expect(link).toBeVisible();await link.scrollIntoViewIfNeeded();await expect(link).toBeInViewport();
  const relation=await fixture.api(`/api/index/objects/type/${wid}/relations`);assert.ok(relation.used_by.some(row=>row.target.kind==='study'&&row.target.id===sid));
  await fs.writeFile(path.join(output,title.includes('四芯')?'four-core-relations.json':'supported-relations.json'),JSON.stringify(relation,null,2));
  await page.screenshot({path:path.join(output,title.includes('四芯')?'four-core-relation-card.png':'supported-relation-card.png'),animations:'disabled'});
  await click(link);await expect(page).toHaveURL(new RegExp('/studies/'+sid));
}
try{
  if(!supportedOnly){
  await page.setViewportSize({width:1366,height:768});await page.goto(fixture.url+'/types?create=1&theme=light');
  await step('four-core-created',async()=>{
    await page.getByRole('radio',{name:'按标准生成',exact:true}).check();report.clicks++;
    await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('YJV 0.6/1 kV 4×95 · 跨区设计草稿');await select('结构类型','四芯等截面');await select('额定电压','0.6/1 kV');await select('导体几何','等截面积实心圆 · 理想化');
    for(const[label,value]of[['导体截面','95'],['芯间净距','0'],['填充外包厚度','0.1'],['包带等效厚度','0.1']])await page.getByRole('textbox',{name:label,exact:true}).fill(value);
    await click(page.getByRole('button',{name:'生成结构提案',exact:true}));await expect(page.locator('[aria-label="结构提案"]')).toContainText('1.1 mm');
    await page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项',exact:true}).check();report.clicks++;await click(page.getByRole('button',{name:'确认并建立草稿',exact:true}));await expect(page).toHaveURL(/\/types\/[^/]+\/structure\//);wid=new URL(page.url()).pathname.split('/')[2];await expect(page.locator('[data-type-card]')).toBeVisible();await expect(page.locator('.drawing-svg')).toBeVisible();
  });
  await step('four-core-basis',async()=>{await typeModule('要求与标准');await runType('生成要求目录');const row=page.getByRole('row').filter({hasText:'导体 R₂₀'}).first();await expect(row).toContainText('缺字段：导体类别');await click(row.getByRole('button',{name:'填写导体类别',exact:true}));await select('导体类别','第 1 类');const dialog=page.getByRole('dialog',{name:'填写导体类别',exact:true});await click(dialog.getByRole('button',{name:'保存并查询依据',exact:true}));await expect(dialog.getByLabel('当前输入标准依据')).toContainText('依据已核验');await click(dialog.getByRole('button',{name:'返回要求清单',exact:true}));await runType('更新要求目录');report.fourCoreInput=await fixture.api('/api/workspaces/'+wid);});
  await step('four-core-method-scope',async()=>{await typeModule('载流量表');await expect(page.locator('[data-type-page=rating-table-results]')).toContainText('方法未覆盖');await expect(page.locator('[data-type-page=rating-table-results]')).toContainText('没有适用基准时不输出电流');});
  await step('four-core-study-created',async()=>{await createStudy('四芯 · 直埋单回适用性核对');report.fourCoreStudyId=sid;});
  await step('four-core-preflight',async()=>{const button=page.getByRole('button',{name:'预检并运行',exact:true});await expect(button).toBeVisible();await click(button);const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByText('正在核对已保存输入',{exact:true})).toBeHidden({timeout:180000});await expect(dialog).toContainText(/缺少|集肤效应|邻近效应|不支持|未覆盖|仅支持|仅覆盖|单芯|三芯/);await expect(dialog.getByRole('button',{name:'确认并运行',exact:true})).toBeDisabled();report.issues.push({owner:'研究',kind:'four-core',reason:await dialog.innerText()});await page.keyboard.press('Escape');});
  await step('four-core-return-link',async()=>{await relations('四芯 · 直埋单回适用性核对');await expect(page.getByRole('button',{name:'预检并运行',exact:true})).toBeVisible();});
  for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/rating-table/results?theme=${theme}`);await expect(page.getByRole('button',{name:'新建载流量研究',exact:true})).toBeVisible();report.layouts.push({width,theme,...await checkLayout(page)});}
  }
  // A separate complete release design verifies the working IEC link; it is NOT
  // presented as a 4×95 or generated 3×240 result.
  await page.setViewportSize({width:1366,height:768});
  await step('supported-design',async()=>{const types=await fixture.api('/api/design/type-workspaces'),type=types.find(row=>row.name.includes('YJV22'));assert.ok(type,'发布副本中的完整三芯设计');wid=type.id;await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=light`);await expect(page.locator('[data-type-card]')).toBeVisible();report.supportedInput=await fixture.api('/api/workspaces/'+wid);});
  await step('supported-new-study',async()=>{await openStudy();const dialog=page.getByRole('dialog',{name:'新建研究',exact:true});await dialog.getByRole('textbox',{name:'研究名称',exact:true}).fill('三芯 · 型号用于直埋单回');await click(dialog.getByRole('combobox',{name:'方法参数来源',exact:true}));await click(page.getByRole('option',{name:/沿用最近研究/}).first());await dialog.getByRole('checkbox',{name:'已核对直埋模板条件',exact:true}).check();report.clicks++;await page.screenshot({path:path.join(output,'supported-confirm-condition.png'),animations:'disabled'});const response=page.waitForResponse(r=>r.url().endsWith(`/api/workspaces/${wid}/studies`)&&r.request().method()==='POST');await click(dialog.getByRole('button',{name:'建立研究',exact:true}));const receipt=await response;assert.equal(receipt.status(),201,await receipt.text());report.supportedStudy=await receipt.json();assert.equal(report.supportedStudy.definition.method_input.sections[0].kind,'ground');assert.deepEqual(report.supportedStudy.definition.method_input.cable_types,report.supportedInput.domain.cable_types);sid=report.supportedStudy.id;await expect(page).toHaveURL(new RegExp('/studies/'+sid));});
  await step('supported-permissible-current',async()=>{await click(page.getByRole('button',{name:'预检并运行',exact:true}));const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});await expect(dialog).toContainText('你的工况在适用范围内',{timeout:180000});await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:180000});await expect.poll(async()=>{const runs=await fixture.api(`/api/workspaces/${wid}/studies/${sid}/runs`);return runs.items.find(run=>run.status==='succeeded')?.id||'';},{timeout:180000}).not.toBe('');const runs=await fixture.api(`/api/workspaces/${wid}/studies/${sid}/runs`),run=runs.items.find(run=>run.status==='succeeded');report.supportedRun=await fixture.api(`/api/workspaces/${wid}/studies/${sid}/runs/${run.id}`);await fs.writeFile(path.join(output,'supported-run.json'),JSON.stringify(report.supportedRun,null,2));const snapshot=report.supportedRun.snapshot;assert.deepEqual(snapshot.workspace_state.domain.cable_types,report.supportedInput.domain.cable_types,'型号结构完整带入保存运行');assert.deepEqual(snapshot.workspace_state.domain.materials,report.supportedInput.domain.materials,'材料事实完整带入保存运行');});
  const available=report.supportedRun.output.cases[0].results.find(row=>row.key==='ampacity'&&row.status==='available');assert.ok(available?.value>0);assert.equal(available.unit,'A');report.currentA=available.value;report.method=report.supportedRun.snapshot.definition.method;
  await step('supported-basis',async()=>{const summary=page.locator('summary').filter({hasText:'材料常数与标准出处'});await summary.scrollIntoViewIfNeeded();await click(summary);const table=page.getByRole('table',{name:'材料常数与标准出处',exact:true});await expect(table).toContainText('IEC 60287-1-1:2023');await expect(table).toContainText('第 35 页');report.basisRows=report.supportedRun.output.cases[0].evidence.material_basis.rows.map(({label,citation,status,value,unit})=>({label,citation,status,value,unit}));});
  await step('supported-return-link',async()=>{await relations('三芯 · 型号用于直埋单回');await expect(page.getByRole('button',{name:'预检并运行',exact:true})).toBeVisible();});
  report.flowSeconds=+((performance.now()-started)/1000).toFixed(2);report.flowClicks=report.clicks;
  for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=${theme}`);await expect(page.locator('[data-type-card]')).toBeVisible();await openStudy();await expect(page.getByRole('checkbox',{name:'已核对直埋模板条件',exact:true})).toBeVisible();report.layouts.push({scope:'直埋确认对话框',width,theme,...await checkLayout(page)});await page.keyboard.press('Escape');}
  assert.deepEqual((await fixture.api('/api/workspaces/'+wid)).domain,report.supportedInput.domain,'建立与运行研究不改写型号输入');
  report.totalSeconds=+((performance.now()-started)/1000).toFixed(2);assert.deepEqual(fixture.errors,[]);
}catch(error){report.failure=String(error.stack||error);report.log=fixture.log();console.error(report.failure);process.exitCode=1;}
finally{await fs.writeFile(recordFile,JSON.stringify(report,null,2));await fixture.close();}
console.log(JSON.stringify({steps:report.steps.length,seconds:report.totalSeconds,failure:report.failure}));
