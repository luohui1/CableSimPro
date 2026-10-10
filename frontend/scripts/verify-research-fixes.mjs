import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as playwrightExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { request as baseRequest, currentSelection } from './research-fixtures.mjs';
const expect=playwrightExpect.configure({timeout:30000});
async function request(...args){try{return await baseRequest(...args);}catch(error){throw Error(args[1]+': '+error.message);}}

if(process.env.E2E_ISOLATED !== '1')throw Error('修复验收只允许隔离库');
const base=process.env.FRONTEND_URL,phase=process.env.FIX_PHASE || 'after';
const out=path.join(repositoryRoot,'.data/fix-round/research',phase);
await fs.mkdir(out,{recursive:true});
const report={phase,screens:[],checks:[],errors:[]};
const projects=await request(base,'/api/workspaces'),studies=[];
for(const project of projects)for(const row of await request(base,`/api/workspaces/${project.id}/studies`))studies.push(row);
let rating=studies.find(row=>row.definition.driver.kind==='single'&&row.definition.method.plugin_id==='cablesim.iec60287'&&row.latest_run);
let selection=studies.find(row=>row.definition.driver.kind==='selection'&&row.latest_run);
const sweep=studies.find(row=>row.definition.driver.kind==='sweep'&&row.latest_run);
assert(rating&&selection,'需要有保存运行的 IEC 与询价研究');
let current;
if(phase==='after' && process.env.FIX_REQUIRED_ONLY!=='1'){
 if(process.env.FIX_PREVIEW_ONLY!=='1' && process.env.FIX_FINAL_ONLY!=='1'){current=await currentSelection(base);selection=current.study;}
 const catalog=await request(base,'/api/methods');
 const installed=catalog.find(item=>item.method.plugin_id===rating.definition.method.plugin_id);
 const workspace=await request(base,`/api/workspaces/${rating.workspace}`);
 rating=await request(base,`/api/workspaces/${rating.workspace}/studies/${rating.id}`,'PUT',{
   ...rating.definition,method:{...installed.method,capability:rating.definition.method.capability},expected_revision:workspace.revision,expected_study_revision:rating.revision});
}
const session=await openHeadlessBrowser(),{page}=session;
page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));
const url=(row,module,tab,extra='')=>`${base}/studies/${row.id}/${module}/${tab}?workspace=${row.workspace}&theme=light${extra}`;
async function capture(name,ids){
  await page.waitForTimeout(300);
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(200);
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,minimum:Math.min(...Array.from(document.querySelectorAll('.workbench-inspector :is(label,dt,dd,h2,p,button)')).filter(node=>node.textContent.trim()&&node.getBoundingClientRect().height>0).map(node=>parseFloat(getComputedStyle(node).fontSize)))}));
    if(phase==='after'){assert.equal(layout.overflow,false,`${name} ${viewport.width} 页面横向越界`);assert(layout.minimum>=13,`${name} 属性栏字号 ${layout.minimum}`);}
    const file=path.join(out,`${name}-${viewport.width}.png`);await page.screenshot({path:file});
    report.screens.push({name,ids,viewport,file,layout});
  }
  console.log('复测截图：'+name);
}
async function go(address){await page.goto(address);await expect(page.getByRole('toolbar',{name:'工程命令'})).toBeVisible();}
async function checkRequired(){
 const contracts=await request(base,'/api/input-contracts');
 const contract=contracts.find(item=>item.method.capability==='electrothermal-steady' && item.parameter_schema.required?.includes('electromagnetic_options'));
 assert(contract,'安装方法必须提供电磁必填组的准确契约');
 // 给定负荷求温度同样使用电热方法的准确参数契约，缺项留给预检定位；不提交超算。
 const task='operating',module='electrothermal';
 const workspace=await request(base,`/api/workspaces/${rating.workspace}`);
 const created=await request(base,`/api/workspaces/${rating.workspace}/studies`,'POST',{
   title:'电磁必填参数定位验收',task,method:contract.method,expected_revision:workspace.revision,input_source:'domain',parameters:{},driver:{kind:'single'}});
 // 隔离库不携带用户的超算凭据。仅注入计算位置已配置这一 UI 条件；
 // 缺项仍由真实宿主预检产生，不提交任务，也不注入物理结果。
 await page.route(`**/api/hpc/workspaces/${created.workspace}/studies/${created.id}/availability**`,async route=>{
   const response=await route.fetch(),value=await response.json();await route.fulfill({response,json:{...value,configured:true}});
 });
 await go(url(created,module,'results','&inspector=method'));
 await expect(page.locator('[data-field-path="/electromagnetic_options"]').first()).toBeVisible();
 await expect(page.locator('.study-method-config')).toContainText('必填');
 await capture('fem-required',['sim-4','sim-13']);
 await page.getByRole('button',{name:'预检并运行',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});
 await expect(dialog).toBeVisible();
 report.preflight=await request(base,`/api/workspaces/${created.workspace}/studies/${created.id}/preflight?expected_revision=${workspace.revision}&expected_study_revision=${created.revision}`);
 console.log('缺项预检：'+JSON.stringify(report.preflight.cases?.map(item=>item.error)));
 await expect(dialog.getByRole('button',{name:/修正.*后重新预检/}).first()).toBeVisible();
 report.preflightButtons=await dialog.getByRole('button').allTextContents();
 await dialog.getByRole('button',{name:/修正.*后重新预检/}).first().click();
 await expect(dialog).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>document.activeElement?.closest('[data-field-path]')?.getAttribute('data-field-path'))).toMatch(/^\/electromagnetic_options/);
 report.checks.push('有限元电磁必填组直接可见，缺项没有隐入高级折叠');
 report.checks.push('预检缺项中文按钮回到方法页并聚焦电磁输入组');
}
async function checkPreview(){
 await go(url(rating,'ampacity','results','&view=section'));
 const currentInput=page.locator('.inspector-conditions').getByRole('textbox',{name:/电流/}).first();
 const original=await currentInput.inputValue(),originalConclusion=await page.locator('.conclusion').first().innerText();
 await currentInput.fill(String(Number(original)+50));await currentInput.press('Tab');
 const response=page.waitForResponse(reply=>new URL(reply.url()).pathname.endsWith('/preview'));
 await page.getByRole('button',{name:'试算',exact:true}).click();const trial=await (await response).json();
 assert.equal(trial.persisted,false);assert.equal(trial.status,'succeeded');
 await expect(page.getByRole('status',{name:'试算结果'})).toBeVisible();
 await expect(page.locator('.conclusion').first()).not.toHaveText(originalConclusion);
 await expect(page.locator('.preview-delta').first()).toContainText('较保存值');
 assert(trial.snapshot.workspace_state.domain,'试算图必须采用实际试算的领域输入');
 await capture('preview',[9,14,15,21]);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.getByRole('status',{name:'试算结果'})).toHaveCount(0);
 await expect(currentInput).toHaveValue(original);
 report.checks.push('真实试算更新结论、显示较保存值差值，撤销恢复输入并清掉试算条');
}
try{
 if(process.env.FIX_REQUIRED_ONLY==='1'){await checkRequired();}else if(process.env.FIX_PREVIEW_ONLY==='1'){await checkPreview();}else if(process.env.FIX_FINAL_ONLY==='1'){await checkPreview();await checkRequired();}else{
 await go(url(rating,'ampacity','results'));await expect(page.locator('.conclusion').first()).toBeVisible();
 await capture('rating',[1,2,3,6,9,14,15,19,20,21,29]);
 const state=await page.locator('.command-state').innerText();
 await go(url(rating,'ampacity','results','&inspector=method'));await expect(page.locator('.study-method-config')).toBeVisible();await capture('method',[11,23]);
 await page.getByRole('button',{name:'新建研究',exact:true}).first().click();await expect(page.getByRole('dialog',{name:'新建研究',exact:true})).toBeVisible();await capture('add-study',[5]);await page.keyboard.press('Escape');
 await go(url(rating,'sweep','curve'));await capture('sweep',[6,7,13,24,30]);
 if(phase==='after'){assert.equal(await page.locator('.command-state').innerText(),state,'切子模块不能改变研究状态');report.checks.push('子模块状态一致');}
 if(sweep){
   await go(url(sweep,'sweep','curve'));await capture('saved-sweep',[13,30]);
   if(phase==='after'){
     await expect(page.getByRole('table',{name:'扫描点结果'})).toHaveCount(0);
     const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出逐点 CSV',exact:true}).click();
     const csvFile=path.join(out,'扫描结果.csv');await (await download).saveAs(csvFile);
     const csv=await fs.readFile(csvFile,'utf8');assert(csv.includes('物理量')&&csv.includes('方法版本'));
     assert(!csv.includes('cablesim.')&&!csv.includes('/input/')&&!csv.includes('"ampacity"'));report.checks.push('工程精度中文 CSV 不露内部路径与方法标识');
   }
   await go(url(sweep,'sweep','curve','&inspector=method'));
   if(phase==='after'){
     const samples=sweep.definition.driver.samples,variable=Object.keys(samples[0].changes)[0];
     await expect(page.getByRole('textbox',{name:'起点',exact:true})).toHaveValue(Number(samples[0].changes[variable]).toFixed(3));
     await expect(page.getByRole('textbox',{name:'终点',exact:true})).toHaveValue(Number(samples.at(-1).changes[variable]).toFixed(3));
     report.checks.push('已保存扫描范围按真实采样点回填');
   }
 }else await go(url(rating,'sweep','curve','&inspector=method'));
 await capture('sweep-settings',[7,23]);
 await go(url(rating,'ampacity','detail'));await capture('heat-detail',[16]);
 await go(url(rating,'ampacity','validation'));await capture('validation',[11]);
 await go(url(selection,'selection','results',current ? `&run=${current.run.id}` : ''));await expect(page.getByRole('table',{name:'真实选型候选'})).toBeVisible();await capture('selection',[26]);
 await page.getByRole('button',{name:'运行记录',exact:true}).click();await capture('records',[25]);await page.keyboard.press('Escape');
 await page.goto(`${base}/studies?workspace=${rating.workspace}&theme=light`);await expect(page.getByRole('button',{name:'编辑模型',exact:true})).toBeVisible();await capture('project',[17,18,19,20]);
 await page.goto(base+'/?theme=light');await page.getByRole('button',{name:'新建研究',exact:true}).first().click();await capture('global-create',['shell-5']);await page.keyboard.press('Escape');
 if(phase==='after'){
   await page.goto(base+'/?theme=light');await page.getByRole('button',{name:'新建研究',exact:true}).first().click();
   await expect(page.getByRole('combobox',{name:'所属工程'})).toBeVisible();await expect(page.getByRole('combobox',{name:'研究任务'})).toContainText('运行温度');await page.keyboard.press('Escape');report.checks.push('全局创建可选工程、默认运行温度');
   await page.goto(`${base}/studies?workspace=${selection.workspace}&theme=light`);await page.getByRole('button',{name:'编辑模型',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'编辑工程模型'})).toBeVisible();await capture('model-edit',[18]);await page.keyboard.press('Escape');report.checks.push('工程编辑模型进入可编辑坐标');
   await go(url(selection,'selection','results',`&run=${current.run.id}`));await page.getByRole('button',{name:'撤销',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'撤销已保存修改'})).toBeVisible();await capture('undo-confirm',[2]);await page.getByRole('button',{name:'取消',exact:true}).click();report.checks.push('保存历史撤销明确确认；取消不写入');
   const checkedRun=await request(base,`/api/workspaces/${selection.workspace}/studies/${selection.id}/runs/${current.run.id}`);
   report.sourceRun={id:checkedRun.id,freshness:checkedRun.freshness,version_status:checkedRun.version_status,availability:checkedRun.method_availability};
   assert.equal(checkedRun.freshness,'current',JSON.stringify(report.sourceRun));
   await page.getByRole('button',{name:'生成计算书',exact:true}).click();
   await expect(page.getByTitle('计算书预览')).toBeVisible({timeout:120000});
   const generated=new URL(page.url()).searchParams.get('delivery');assert(generated,'完成后自动选中刚生成的交付');
   assert.notEqual(generated,current.book.id);current.book={id:generated};report.checks.push('生成完成自动显示新交付');
   await go(url(selection,'report','content',`&run=${current.run.id}&delivery=${current.book.id}`));await expect(page.getByRole('region',{name:'计算书内容'})).toBeVisible();await capture('report-content',[8,33]);
   await go(url(selection,'report','sources',`&run=${current.run.id}&delivery=${current.book.id}`));await expect(page.locator('.report-sources').first()).toContainText('源运行');await capture('report-sources',[8]);
   await go(url(selection,'report','preview',`&run=${current.run.id}&delivery=${current.book.id}`));await expect(page.getByTitle('计算书预览')).toBeVisible();await capture('report-preview',[8]);report.checks.push('计算书内容、来源、预览三种内容独立');
   await checkPreview();
   await checkRequired();
 }
 }
 assert.equal(report.errors.length,0,report.errors.join('\n'));
 report.outcome='passed';
}catch(error){report.outcome='failed';report.failure=error.message;throw error;}
finally{await fs.writeFile(path.join(out,process.env.FIX_REQUIRED_ONLY==='1'?'required-evidence.json':process.env.FIX_PREVIEW_ONLY==='1'?'preview-evidence.json':process.env.FIX_FINAL_ONLY==='1'?'final-evidence.json':'evidence.json'),JSON.stringify(report,null,2));await session.close();}
