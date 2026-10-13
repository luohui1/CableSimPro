import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect as baseExpect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const output=path.join(root,'.data/type-full-generation');await fs.mkdir(output,{recursive:true});
const refresh=process.argv.includes('--refresh'),previous=refresh?JSON.parse(await fs.readFile(path.join(output,'record.json'),'utf8')):null,recordFile=path.join(output,refresh?'refresh-record.json':'record.json');
process.env.E2E_DATABASE_SOURCE ||= path.join(root,refresh?'.data/type-full-generation/validation.sqlite':'.data/release/engineering.sqlite');
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
const expect=baseExpect.configure({timeout:120000}),report={steps:[],checks:[],operations:0,errors:fixture.errors,runtime:fixture.runtime,
  engineeringInputs:['本次显式选择等面积实心圆，不能称作绞合导体制造外径','两层半导电屏蔽各0.7mm、单铜带0.1mm×100mm，为本次工程师输入，不称标准值','铜带搭盖15%按GB/T12706.2—2020 10.2.3第10页标称值手工填写；双钢带宽20mm、最大轴向间隙2mm为本次明确工艺设计输入，不称标准值','未填物性、实测最薄点和实测搭盖率，发布仍受阻']};
let wid;const start=performance.now();
async function click(node){report.operations++;await node.click();}
async function fill(label,value){report.operations++;await page.getByRole('textbox',{name:label,exact:true}).fill(value);}
async function select(label,option){await click(page.getByRole('combobox',{name:label,exact:true}));await click(page.getByRole('option',{name:option,exact:true}));}
async function step(name,work){const started=performance.now(),count=report.operations;try{await work();report.steps.push({name,seconds:+((performance.now()-started)/1000).toFixed(2),operations:report.operations-count,status:'completed',text:(await page.locator('body').innerText()).slice(-10000)});await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});}catch(error){report.steps.push({name,status:'failed',error:String(error),text:(await page.locator('body').innerText()).slice(-10000)});await page.screenshot({path:path.join(output,name+'-failed.png')});throw error;}finally{await fs.writeFile(recordFile,JSON.stringify(report,null,2));}}
async function module(name){await click(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:new RegExp('^'+name)}));}
async function run(label){await click(page.getByRole('button',{name:label,exact:true}));const dialog=page.getByRole('dialog',{name:label+' · 预检',exact:true});await expect(dialog).toBeVisible();const gate=dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true});assert.equal(await gate.count(),1,await dialog.innerText());await gate.check();report.operations++;await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:240000});}
try{
  await page.setViewportSize({width:1366,height:768});
  if(refresh){wid=previous.workspaceId;assert.ok(wid);await page.goto(`${fixture.url}/types/${wid}/requirements/list?theme=light`);}
  else{await page.goto(fixture.url+'/types?create=1&theme=light');
  await step('proposal',async()=>{
    await page.getByRole('radio',{name:'按标准生成',exact:true}).check();report.operations++;
    await fill('型号名称','YJV22 8.7/15 kV 3×240 · 完整护层草稿');
    await select('生成范围','完整护层 · 核对附录依据');await select('结构类型','三芯');await select('额定电压','8.7/15 kV');
    await fill('导体截面','240');await select('导体几何','等截面积实心圆 · 理想化');await fill('芯间净距','0');
    await select('半导电屏蔽','导体屏蔽 + 绝缘屏蔽');await select('护层构造','PVC 挤包内衬 + 双钢带 + PVC 外护套');
    for(const [label,value] of [['导体屏蔽厚度','0.7'],['绝缘屏蔽厚度','0.7'],['铜带单带厚度','0.1'],['铜带宽度','100']])await fill(label,value);
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);report.checks.push({state:'input',theme,width,...await checkLayout(page,'[role=dialog]')});}
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/types/creation-proposals')&&r.request().method()==='POST',{timeout:180000});
    await click(page.getByRole('button',{name:'生成结构提案',exact:true}));const receipt=await response;assert.equal(receipt.status(),200,await receipt.text());const proposal=await receipt.json();
    await fs.writeFile(path.join(output,'proposal.json'),JSON.stringify(proposal,null,2));
    const section=page.locator('[aria-label="结构提案"]');await expect(section).toContainText('3.4 mm');await expect(section).toContainText('GB/T 12706.2');
    await expect(page.getByRole('button',{name:'确认并建立草稿',exact:true})).toBeDisabled();
    const common=proposal.document.cable_types[0].common_layers;assert.deepEqual(common.map(l=>l.role),['bedding','armour','oversheath']);assert.equal(common[0].thickness,.0018);assert.equal(common[1].nominal_tape_thickness,.0005);assert.equal(common[2].thickness,.0034);
    report.handCheck='17.5+2×4.5+3=29.5；铜带10mm²增量0.8=>30.3；×2.16=>65.4；内衬假设0.6=>66.6；钢带0.5×4=>68.6；0.035×68.6+1=3.401=>3.4mm';
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);report.checks.push({state:'proposal',theme,width,...await checkLayout(page,'[role=dialog]')});}
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  });
  await step('structure',async()=>{await page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项',exact:true}).check();report.operations++;await click(page.getByRole('button',{name:'确认并建立草稿',exact:true}));await expect(page).toHaveURL(/\/types\/[^/]+\/structure\//);wid=new URL(page.url()).pathname.split('/')[2];await expect(page.locator('.drawing-svg')).toBeVisible();});
  await step('manufacturing-inputs',async()=>{
    await click(page.getByRole('tab',{name:'外径与用料',exact:true}));await click(page.getByRole('button',{name:'更新结构推导',exact:true}));
    const d=page.getByRole('dialog',{name:'更新结构推导 · 预检',exact:true});await expect(d).toContainText('搭盖比例');
    assert.doesNotMatch((await d.innerText()).split('追溯')[0],/cable_type\/|core\/\d/,'普通提示不能外露内部结构路径');
    await click(d.getByRole('button',{name:'定位芯 1 · 金属屏蔽',exact:true}));
    for(let i=1;i<=3;i++){
      if(i>1)await click(page.getByRole('table',{name:'型号分层',exact:true}).getByRole('row').filter({hasText:'芯 '+i+' · 金属屏蔽'}));
      const details=page.locator('.type-property-detail').filter({has:page.locator('summary',{hasText:'构造与用料'})});if(await details.getAttribute('open')===null)await click(details.locator('summary'));
      const input=page.getByRole('textbox',{name:'搭盖比例',exact:true});await input.fill('15');report.operations++;await input.press('Tab');
    }
    await click(page.getByRole('table',{name:'型号分层',exact:true}).getByRole('row').filter({hasText:'铠装'}));
    const details=page.locator('.type-property-detail').filter({has:page.locator('summary',{hasText:'构造与用料'})});if(await details.getAttribute('open')===null)await click(details.locator('summary'));
    for(const[label,value]of[['带宽','20'],['最大轴向间隙','2']]){const input=page.getByRole('textbox',{name:label,exact:true});await input.fill(value);report.operations++;await input.press('Tab');}
    await page.keyboard.press('Control+s');report.operations++;await expect(page.getByText('结构修改待保存。',{exact:true})).toBeHidden();await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
  });
  await step('geometry',async()=>{await click(page.getByRole('tab',{name:'外径与用料',exact:true}));await run('更新结构推导');await expect(page.locator('[data-type-page=quantities]')).toHaveAttribute('data-type-state','success');});
  }
  await step('requirements',async()=>{await module('要求与标准');await run(refresh?'更新要求目录':'生成要求目录');await expect(page.locator('body')).toContainText('依据已核验');await expect(page.locator('body')).toContainText('表 9');await expect(page.locator('body')).toContainText('0.09 mm');});
  await step('standard-check',async()=>{await module('标准核对');await run('执行标准核对');await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','success');await expect(page.locator('body')).toContainText('满足');});
  await step('specification',async()=>{await module('规格书');await select('文档版本','内部审核版');const download=page.waitForEvent('download',{timeout:240000});download.catch(()=>{});await click(page.getByRole('button',{name:'导出内部审核稿',exact:true}));await(await download).saveAs(path.join(output,'full-structure-draft.pdf'));const spec=await fixture.api(`/api/types/${wid}/specification?audience=internal`);await fs.writeFile(path.join(output,'specification.json'),JSON.stringify(spec,null,2));report.publication={ready:spec.ready,issues:spec.payload.checks.filter(c=>c.blocking).map(c=>({channel:c.channel,message:c.message})),counts:spec.payload.results.standards.artifact.counts};assert.equal(spec.ready,false);assert.ok(spec.payload.results.geometry.artifact);});
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const route of ['requirements/list','structure/table','structure/quantities']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/${route}?theme=${theme}`);
    if(route==='structure/table')await expect(page.getByRole('table',{name:'型号分层',exact:true})).toBeVisible();
    else await expect(page.locator(route==='requirements/list'?'[data-type-page=requirements-results]':'[data-type-page=quantities]')).toHaveAttribute('data-type-state','success');
    report.checks.push({state:route,width,theme,...await checkLayout(page,'.type-root')});}
  assert.deepEqual(fixture.errors.filter(e=>!e.includes('Warning: useRouter')),[]);
  report.totalSeconds=+((performance.now()-start)/1000).toFixed(2);
  report.workspaceId=wid;
  await promisify(execFile)(process.env.PYTHON||path.join(root,'.venv/Scripts/python.exe'),['-c',"import sqlite3,sys;s=sqlite3.connect(sys.argv[1]);t=sqlite3.connect(sys.argv[2]);s.backup(t);t.close();s.close()",fixture.database,path.join(output,'validation.sqlite')]);
}catch(error){report.failure=String(error.stack||error);report.log=fixture.log();console.error(report.failure);process.exitCode=1;}
finally{await fixture.close();report.closed=true;await fs.writeFile(recordFile,JSON.stringify(report,null,2));}
console.log(JSON.stringify({steps:report.steps.map(s=>({name:s.name,status:s.status,seconds:s.seconds})),operations:report.operations,totalSeconds:report.totalSeconds,failure:report.failure,closed:report.closed}));
