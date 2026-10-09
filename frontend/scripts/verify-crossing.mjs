import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect as baseExpect} from '@playwright/test';
import {openHeadlessBrowser, outputRoot, repositoryRoot} from './browser.mjs';
import {request} from './research-fixtures.mjs';
import {assertLayout} from './layout-assertions.mjs';

if(process.env.E2E_ISOLATED!=='1')throw Error('Crossing writes require the isolated runner');
// Reuse the declared SI hand-check fixture; this is not a manufacturer rating.
const fixture=JSON.parse(execFileSync(process.env.PYTHON || 'python',['-c',
  "import sys,json;sys.path[:0]=['plugins/cablesim.iec60287/src','plugins/cablesim.iec60287/tests'];from test_three_core import document,parameters;d=document();[m.update(label=label,category=category) for m,(label,category) in zip(d['materials'],[('铜','conductor'),('XLPE','insulation'),('半导电层','semiconductor'),('填充物','filler'),('PVC','polymer'),('钢','metal'),('土壤','soil'),('管材','duct')])];d['materials'][0]['standard_kind']='copper_bare';d['sections'][0]['label']='三芯直埋';d['name']='交叉热源手算校核';print(json.dumps({'document':d,'parameters':parameters()}))"
],{cwd:repositoryRoot,encoding:'utf8',windowsHide:true}));
const base=process.env.FRONTEND_URL,expect=baseExpect.configure({timeout:60000});
const out=path.join(outputRoot,'crossing');await fs.mkdir(out,{recursive:true});
const pin=(await request(base,'/api/methods')).find(m=>m.method.plugin_id==='cablesim.iec60287').method;
const workspace=await request(base,'/api/workspaces','POST',{}),wid=workspace.id;
const study=await request(base,`/api/workspaces/${wid}/studies`,'POST',{title:'三芯直埋 · 交叉热源校核',expected_revision:workspace.revision,
  method:{...pin,capability:'steady-rating'},input_source:'study',method_input:fixture.document,parameters:fixture.parameters,driver:{kind:'single'}});
const prefix=`/api/workspaces/${wid}/studies/${study.id}`;
const session=await openHeadlessBrowser(),{page}=session,report={checks:[],layouts:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
try {
  await page.setViewportSize({width:1366,height:768});
  await page.goto(`${base}/studies/${study.id}/ampacity/results?workspace=${wid}&theme=light`);
  const section=page.getByRole('region',{name:'交叉热源',exact:true});
  await expect(section).toContainText('未设置交叉热源');
  await page.getByRole('button',{name:'添加交叉热源',exact:true}).click();
  await page.getByLabel('热源名称',{exact:true}).fill('热力管');
  await page.getByLabel('参数来源',{exact:true}).fill('工程师给定手算输入：50 W/m，非厂家额定数据。');
  for(const [label,value] of [['热源轴线埋深','.6'],['热源外径','.1'],['交叉角',String(Math.PI/2)],['单位长度发热','50']]) {
    const input=page.getByLabel(label,{exact:true});await input.fill(value);await input.press('Enter');
  }
  await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'已保存',exact:true})).toBeVisible();
  for(const size of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']) {
    await page.setViewportSize(size);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await assertLayout(page,'交叉热源输入');
    const bounds=await section.boundingBox();assert.ok(bounds);
    for(const control of await section.locator('input').all()) {
      const rect=await control.boundingBox();assert.ok(rect && rect.x>=bounds.x && rect.x+rect.width<=bounds.x+bounds.width+1,'热源字段在属性栏内完整显示');
    }
    report.layouts.push({...size,theme});
  }
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.screenshot({path:path.join(out,'inputs.png')});
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'运行前预检'});
  await expect(dialog).toContainText('你的工况在适用范围内');
  if(await dialog.getByRole('checkbox').count())await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'确认并运行',exact:true}).click();
  await page.waitForURL(url=>!!url.searchParams.get('run'));
  const rid=new URL(page.url()).searchParams.get('run'),saved=await request(base,prefix+'/runs/'+rid);
  assert.equal(saved.integrity,'verified');assert.equal(saved.status,'succeeded');
  const result=saved.output.cases[0].artifacts['x-cablesim.iec60287-trace'].crossing_derating[0];
  assert.ok(result.derated_current_a<result.baseline_current_a && result.derating_factor>0);
  await page.goto(`${base}/studies/${study.id}/ampacity/results?workspace=${wid}&run=${rid}&theme=light`);
  await expect(page.locator('.answer-bar')).toContainText('交叉降额系数');
  await expect(page.locator('.answer-bar')).toContainText('降额后允许电流');
  await expect(page.locator('.answer-bar')).toContainText('IEC 60287-3-3');
  await page.screenshot({path:path.join(out,'results.png')});
  await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'生成计算书',exact:true}).click();
  await expect(page.getByRole('button',{name:'下载 PDF',exact:true})).toBeEnabled();
  report.result=result;report.checks.push('SI输入保存','真实插件预检与运行','降额结论','计算书可下载');
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;report.screen=await page.locator('body').innerText();throw error;}
finally {await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2));await session.close();}
