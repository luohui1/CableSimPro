// Actual type -> independent study -> saved run, against a private release copy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect as baseExpect} from '@playwright/test';
import {openHeadlessBrowser,repositoryRoot} from './browser.mjs';
import {request} from './research-fixtures.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('必须使用隔离发布库');
const base=process.env.FRONTEND_URL,out=path.join(repositoryRoot,'.data/fix-round/research/type-input/browser');
await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session,expect=baseExpect.configure({timeout:30000});
const report={steps:[],errors:[],writes:[],source:process.env.E2E_DATABASE_SOURCE};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('request',req=>{if(req.url().includes('/api/')&&req.method()!=='GET')report.writes.push({path:new URL(req.url()).pathname,method:req.method()});});
page.setDefaultTimeout(30000);
const api=endpoint=>request(base,endpoint);
async function select(label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value}).first().click();}
async function capture(name){for(const width of [1366,1920]){await page.setViewportSize({width,height:width===1366?768:1080});await page.screenshot({path:path.join(out,`${name}-${width}.png`),animations:'disabled'});}await page.setViewportSize({width:1366,height:768});}
async function step(name,work){const start=Date.now();try{await work();report.steps.push({name,seconds:(Date.now()-start)/1000,status:'passed'});console.log(JSON.stringify(report.steps.at(-1)));}catch(error){report.steps.push({name,status:'failed',seconds:(Date.now()-start)/1000,error:String(error)});await capture('failed');throw error;}finally{await fs.writeFile(path.join(out,'record.json'),JSON.stringify(report,null,2));}}
async function openStudy(){const button=page.getByRole('button',{name:'用于载流量研究',exact:true});if(await button.isVisible())await button.click();else{await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'用于载流量研究',exact:true}).click();}return page.getByRole('dialog',{name:'新建研究',exact:true});}
let wid,sid,original;
try{
  await page.setViewportSize({width:1366,height:768});
  await step('四芯真实设计进入研究',async()=>{
    await page.goto(base+'/types?create=1&theme=light');
    await page.getByRole('radio',{name:'按标准生成',exact:true}).check();
    await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('YJV 0.6/1 kV 4×95 · 适用性复验');
    await select('结构类型','四芯等截面');await select('额定电压','0.6/1 kV');await select('导体几何','等截面积实心圆 · 理想化');
    for(const[label,value]of[['导体截面','95'],['芯间净距','0'],['填充外包厚度','0.1'],['包带等效厚度','0.1']])await page.getByRole('textbox',{name:label,exact:true}).fill(value);
    await page.getByRole('button',{name:'生成结构提案',exact:true}).click();
    await page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项',exact:true}).check();
    await page.getByRole('button',{name:'确认并建立草稿',exact:true}).click();await expect(page).toHaveURL(/\/types\/[^/]+\/structure\//);
    wid=new URL(page.url()).pathname.split('/')[2];original=await api('/api/workspaces/'+wid);await expect(page.locator('[data-type-card]')).toBeVisible();
    const dialog=await openStudy();await dialog.getByRole('textbox',{name:'研究名称',exact:true}).fill('四芯 · IEC 适用性复验');
    const response=page.waitForResponse(r=>r.url().endsWith(`/api/workspaces/${wid}/studies`)&&r.request().method()==='POST');
    await dialog.getByRole('button',{name:'建立研究',exact:true}).click();const saved=await(await response).json();sid=saved.id;report.fourStudy=saved;
    await expect(page).toHaveURL(new RegExp('/studies/'+sid));
  });
  await step('四芯先拒绝适用性而非补系数',async()=>{
    const preflight=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preflight'));
    await page.getByRole('button',{name:'预检并运行',exact:true}).click();report.fourPreflight=await(await preflight).json();
    const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});
    await expect(dialog).toContainText('IEC 60287 插件当前不覆盖四芯');await expect(dialog).toContainText('GB 50217');await expect(dialog).not.toContainText('集肤效应构造系数');
    await expect(dialog.getByRole('button',{name:'确认并运行',exact:true})).toBeDisabled();await capture('four-preflight');await page.keyboard.press('Escape');
    assert.deepEqual((await api('/api/workspaces/'+wid)).domain,original.domain);
  });
  await step('三芯真实型号建立独立直埋研究',async()=>{
    const type=(await api('/api/design/type-workspaces')).find(row=>row.name.includes('YJV22'));assert.ok(type);
    wid=type.id;original=await api('/api/workspaces/'+wid);await page.goto(`${base}/types/${wid}/structure/table?theme=light`);await expect(page.locator('[data-type-card]')).toBeVisible();
    const dialog=await openStudy();await dialog.getByRole('textbox',{name:'研究名称',exact:true}).fill('三芯 · 独立输入编辑复验');
    await select('方法参数来源',/沿用最近研究/);await dialog.getByRole('checkbox',{name:'已核对直埋模板条件',exact:true}).check();
    const response=page.waitForResponse(r=>r.url().endsWith(`/api/workspaces/${wid}/studies`)&&r.request().method()==='POST');
    await dialog.getByRole('button',{name:'建立研究',exact:true}).click();const saved=await(await response).json();sid=saved.id;report.threeStudy=saved;
    await expect(page).toHaveURL(new RegExp('/studies/'+sid));await expect(page.locator('.drawing-svg')).toBeVisible();
    await expect(page.getByText('历史敷设截面保持只读。',{exact:true})).toHaveCount(0);
    await expect(page.locator('.project-explorer')).toContainText('本研究模型（独立输入）');await capture('independent-editable');
  });
  await step('独立输入画布编辑与保存不改型号',async()=>{
    await page.getByRole('button',{name:'编辑中心埋深，单位 m',exact:true}).press('Enter');
    const editor=page.locator('.drawing-editor-panel input');await editor.fill('0.9');await editor.press('Enter');
    await page.keyboard.press('Control+s');
    await expect.poll(async()=>{const study=await api(`/api/workspaces/${wid}/studies/${sid}`);return study.definition.method_input.sections[0].placements[0].z;}).toBe(-0.9);
    assert.deepEqual((await api('/api/workspaces/'+wid)).domain,original.domain,'独立模型保存不能改写型号');
    await page.getByRole('button',{name:'编辑中心埋深，单位 m',exact:true}).press('Enter');await editor.fill('0.8');await editor.press('Enter');await page.keyboard.press('Control+s');
    await expect.poll(async()=>{const study=await api(`/api/workspaces/${wid}/studies/${sid}`);return study.definition.method_input.sections[0].placements[0].z;}).toBe(-0.8);
    await capture('independent-saved');
  });
  await step('真实插件运行与零负荷场标识',async()=>{
    await page.getByRole('button',{name:'预检并运行',exact:true}).click();const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});
    await expect(dialog).toContainText('你的工况在适用范围内',{timeout:180000});await dialog.getByRole('button',{name:'确认并运行',exact:true}).click();await expect(dialog).toBeHidden({timeout:180000});
    let rid;await expect.poll(async()=>{const runs=await api(`/api/workspaces/${wid}/studies/${sid}/runs`);rid=runs.items.find(row=>row.status==='succeeded')?.id;return !!rid;},{timeout:180000}).toBe(true);
    const run=await api(`/api/workspaces/${wid}/studies/${sid}/runs/${rid}`);report.run={id:run.id,input_digest:run.input_digest,output_digest:run.output_digest,status:run.status,version_status:run.version_status};await fs.writeFile(path.join(out,'run.json'),JSON.stringify(run,null,2));
    const current=run.output.cases[0].results.find(row=>row.key==='ampacity'&&row.status==='available');assert.ok(Math.abs(current.value-565.476149)<0.1);report.currentA=current.value;
    await page.getByRole('button',{name:'土壤温度场',exact:true}).click();await expect(page.locator('.field-basis')).toContainText('保存负荷 0 A');await expect(page.locator('.field-basis')).toContainText('按允许电流另行运行');
    assert.deepEqual((await api('/api/workspaces/'+wid)).domain,original.domain);await capture('zero-load-field');
  });
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=String(error.stack||error);report.screen=await page.locator('body').innerText();console.error(report.failure);process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'record.json'),JSON.stringify(report,null,2));await session.close();}
