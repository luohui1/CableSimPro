import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect as baseExpect} from '@playwright/test';
import {root,typeFixture} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';

const output=path.join(root,'.data/type-rule-integration');await fs.mkdir(output,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/type-measurements/validation.sqlite');
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
const expect=baseExpect.configure({timeout:120000}),wid='4c637df1-bcb7-49c7-9570-e8e3ceae8494';
const result={source:process.env.E2E_DATABASE_SOURCE,steps:[],checks:[],operations:0,errors:fixture.errors,runtime:fixture.runtime},started=performance.now();
const route=(module,tab,theme='light')=>`${fixture.url}/types/${wid}/${module}/${tab}?theme=${theme}`;
async function click(node){result.operations++;await node.click();}
async function fill(label,value){const input=page.getByRole('textbox',{name:label,exact:true});result.operations++;await input.fill(value);await input.press('Tab');}
async function matrix(state,selector='.type-root'){for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);result.checks.push({state,width,theme,...await checkLayout(page,selector)});}await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');}
async function step(name,work){const at=performance.now();console.log(name+' started');try{await work();result.steps.push({name,status:'passed',seconds:+((performance.now()-at)/1000).toFixed(3)});}catch(error){result.steps.push({name,status:'failed',error:String(error),body:(await page.locator('body').innerText()).slice(-16000)});await page.screenshot({path:path.join(output,name+'-failed.png')});throw error;}finally{await fs.writeFile(path.join(output,'real-use.json'),JSON.stringify(result,null,2));}}
async function run(){await click(page.getByRole('button',{name:'执行标准核对',exact:true}));const dialog=page.getByRole('dialog',{name:'执行标准核对 · 预检',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();result.operations++;await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:240000});await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','success');}
const spec=()=>fixture.api(`/api/types/${wid}/specification?audience=internal`);
async function choose(dialog,label,option){await click(dialog.getByRole('combobox',{name:label,exact:true}));await click(page.getByRole('option',{name:option,exact:true}));}
try{
  await page.setViewportSize({width:1366,height:768});
  await step('current-rules',async()=>{await page.goto(route('standard-check','results'));await run();result.before=await spec();result.blockersBefore=result.before.payload.checks.filter(c=>c.blocking).length;
    const rows=result.before.payload.results.standards.artifact.rows;
    const screens=rows.filter(r=>r.id.endsWith(':screen-area'));assert.equal(screens.length,3);assert.ok(screens.every(r=>r.verdict==='missing'&&r.source_status==='original-verified'&&r.printed_page===10));
    const inner=rows.find(r=>r.id.endsWith(':bedding-minimum')),armour=rows.find(r=>r.id.endsWith(':armour-tape-measured'));assert.ok(Math.abs(inner.limit-1.24)<1e-12&&Math.abs(armour.limit-.45)<1e-12);await matrix('success');
    await page.goto(route('specification','review'));await expect(page.locator('[aria-label="按责任处理发布阻塞"]')).toBeVisible();await page.screenshot({path:path.join(output,'review-before-1366-light.png'),animations:'disabled'});
  });
  await step('teaching-measurements',async()=>{await click(page.getByRole('button',{name:'录入实测值',exact:true}));const dialog=page.getByRole('dialog',{name:'录入实测值',exact:true});await expect(dialog).toBeVisible();
    for(const field of await dialog.locator('.type-measured-values input').all())assert.equal(await field.inputValue(),'');
    await choose(dialog,'实测来源','教学示例实测');const today=new Date(),date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
    await fill('样品编号','TEACH-MV240-MANUFACTURING');await fill('测量日期',date);await fill('测量方法','教学投影仪测内衬最薄点；按17.7.2测铠装带平均厚度');await fill('测量记录出处','教学构造示例，仅用于真实功能验收，不作为厂家检验报告');
    await fill('内衬层最薄点','1.30');await fill('铠装金属带实测厚度','0.46');
    await matrix('measurement-entry','[role=dialog]');await dialog.getByRole('checkbox').check();result.operations++;await click(dialog.getByRole('button',{name:'保存实测记录',exact:true}));await expect(dialog).toBeHidden();
    await page.goto(route('standard-check','results'));await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','historical');await matrix('historical');await run();
  });
  await step('engineering-inputs',async()=>{await page.goto(route('specification','review'));await click(page.getByRole('button',{name:'录入工程输入',exact:true}));const dialog=page.getByRole('dialog',{name:'录入工程输入',exact:true});await expect(dialog).toBeVisible();
    assert.equal(await dialog.getByRole('button',{name:'保存工程输入',exact:true}).isEnabled(),false);
    for(const core of [1,2,3]){await fill(`芯 ${core} · 屏蔽设计截面`,'10');await fill(`芯 ${core} · 屏蔽短路电流`,'1');await fill(`芯 ${core} · 屏蔽短路持续时间`,'1');await fill(`芯 ${core} · 屏蔽短路容量依据`,'教学输入：尚未独立验证短路容量，不能判通过');}
    await choose(dialog,'公共护层 · 金属层间纵向阻水隔层','否');await fill('公共护层 · 铠装第 1 层最大间隙率','35');await fill('公共护层 · 铠装第 2 层最大间隙率','45');await fill('工程输入出处','教学制造构造声明，非厂家证明，未批准材料符合性');
    await matrix('engineering-entry','[role=dialog]');await dialog.evaluate(node=>{node.scrollTop=0;for(const child of node.querySelectorAll('*'))if(child.scrollHeight>child.clientHeight)child.scrollTop=0;});await page.screenshot({path:path.join(output,'engineering-entry-1366-light.png'),animations:'disabled'});
    await dialog.getByRole('checkbox').check();result.operations++;await click(dialog.getByRole('button',{name:'保存工程输入',exact:true}));await expect(dialog).toBeHidden();
    await page.goto(route('standard-check','results'));await run();const after=await spec(),rows=after.payload.results.standards.artifact.rows;
    assert.equal(rows.find(r=>r.id.endsWith(':armour-tape-gap')).verdict,'passed');assert.deepEqual(rows.find(r=>r.id.endsWith(':armour-tape-gap')).per_layer_values,[.35,.45]);
    assert.ok(rows.filter(r=>r.id.endsWith(':screen-area')).every(r=>r.verdict==='missing'&&r.actual===10&&r.formula===null&&Object.keys(r.engineering_sources).length===4));
    assert.equal(rows.find(r=>r.id.endsWith(':armour-separation')).source_status,'original-verified');
    await click(page.getByRole('button',{name:'录入工程输入',exact:true}));const second=page.getByRole('dialog',{name:'录入工程输入',exact:true});await expect(second).toBeVisible();
    // Explicit teaching declaration of this material condition, never an automatic inference from layer names.
    await choose(second,'公共护层 · 隔离层材料已确认符合隔离套要求','是');await fill('工程输入出处','教学示例：显式声明挤包内衬兼隔离层材料符合性；不作为厂家证明');await second.getByRole('checkbox').check();result.operations++;await click(second.getByRole('button',{name:'保存工程输入',exact:true}));await expect(second).toBeHidden();await run();
    result.after=await spec();result.blockersAfter=result.after.payload.checks.filter(c=>c.blocking).length;
    result.remaining=result.after.payload.checks.filter(c=>c.blocking).map(c=>({id:c.id,channel:c.channel,message:c.message,title:c.result?.title,reason:c.result?.reason}));
    assert.ok(result.blockersAfter<result.blockersBefore);assert.equal(result.after.ready,false);assert.equal(result.after.payload.purpose,'demo');
    const customer=await fixture.api(`/api/types/${wid}/specification?audience=customer`),display=await fixture.api(`/api/types/${wid}/specification?audience=customer&view=detail`);
    assert.equal(display.digest,customer.digest);assert.equal(display.html,customer.html);assert.equal(display.ready,customer.ready);assert.equal(display.payload_full_ref.digest,customer.digest);
    assert.deepEqual(display.payload.results.geometry.artifact.layers.map(l=>[l.inner_radius_m,l.outer_radius_m,l.material_volume_m3]),customer.payload.results.geometry.artifact.layers.map(l=>[l.inner_radius_m,l.outer_radius_m,l.material_volume_m3]));
    assert.ok([1,2,3].every(core=>customer.html.includes(`芯 ${core} · 屏蔽标称截面`)));await fs.writeFile(path.join(output,'customer-rules.html'),customer.html);
    await page.goto(route('specification','review'));await expect(page.locator('[aria-label="按责任处理发布阻塞"]')).toBeVisible();await matrix('review-after');await page.screenshot({path:path.join(output,'review-after-1366-light.png'),animations:'disabled'});
  });
  await step('saved-history',async()=>{
    await page.goto(route('standard-check','results'));await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','success');
    const recent=await fixture.api(`/api/types/${wid}/display-runs?recent=true&limit=100`),archive=await fixture.api(`/api/types/${wid}/display-runs?limit=100`);
    assert.equal(recent.history_complete,false);assert.equal(archive.history_complete,true);assert.ok(recent.items.length<archive.items.length);
    const cadRun=recent.items.find(entry=>entry.output.cases.some(c=>c.artifacts['x-cablesim.cad-model']));assert.ok(cadRun);
    const projected=cadRun.output.cases.find(c=>c.artifacts['x-cablesim.cad-model']).artifacts['x-cablesim.cad-model'],full=await fixture.api(projected.exact_geometry_ref.url);
    assert.equal(full.integrity,'verified');assert.equal(full.output_digest,cadRun.output_digest);assert.equal(full.input_digest,cadRun.input_digest);
    const exact=full.output.cases.find(c=>c.artifacts['x-cablesim.cad-model']).artifacts['x-cablesim.cad-model'];assert.ok(exact.step_text.length>0);assert.equal(projected.step_text,undefined);
    assert.deepEqual(projected.layers.map(l=>[l.inner_radius_m,l.outer_radius_m,l.material_volume_m3]),exact.layers.map(l=>[l.inner_radius_m,l.outer_radius_m,l.material_volume_m3]));
    const standard=entry=>entry.snapshot.definition.method.plugin_id==='cablesim.standard-check',older=archive.items.find(entry=>standard(entry)&&!recent.items.some(last=>last.id===entry.id));assert.ok(older);
    await click(page.getByRole('button',{name:'全部保存运行',exact:true}));await expect(page.getByRole('button',{name:'全部保存运行',exact:true})).toBeHidden();
    await click(page.getByRole('combobox',{name:'保存运行',exact:true}));await click(page.getByRole('option').filter({hasText:`运行 ${older.sequence} ·`}));
    await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','historical');await matrix('saved-historical');
    result.history={recent:recent.items.length,all:archive.items.length,openedSequence:older.sequence,sourceRevision:older.snapshot.workspace_revision};
  });
  await step('empty-loading-error',async()=>{
    const draft=await fixture.api('/api/types','POST',{request_id:crypto.randomUUID(),origin:'blank',name:'教学空白状态',construction:'single_core'}),emptyId=draft.id;
    const endpoint='**/api/types/'+emptyId+'/display-runs*';let release;
    await page.route(endpoint,async route=>{await new Promise(resolve=>release=resolve);await route.continue();});
    const navigation=page.goto(`${fixture.url}/types/${emptyId}/standard-check/results?theme=light`);await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','loading');await matrix('loading');release();await navigation;await page.unroute(endpoint);await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','empty');await matrix('empty');
    await page.route(endpoint,route=>route.fulfill({status:503,json:{detail:'验收注入断网状态，未修改工程结果'}}));await page.reload();await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','error',{timeout:45000});await matrix('error');await page.unroute(endpoint);result.faultInjection='仅错误与加载状态延迟请求；正常流程无模拟结果';
  });
  await promisify(execFile)(process.env.PYTHON||path.join(root,'.venv/Scripts/python.exe'),['-c','import sqlite3,sys;s=sqlite3.connect(sys.argv[1]);t=sqlite3.connect(sys.argv[2]);s.backup(t);t.close();s.close()',fixture.database,path.join(output,'accepted.sqlite')]);
  assert.deepEqual(fixture.errors,[]);result.seconds=+((performance.now()-started)/1000).toFixed(2);result.complete=true;
}catch(error){result.failure=String(error.stack||error);result.log=fixture.log();console.error(result.failure);process.exitCode=1;}
finally{await fixture.close();result.closed=true;await fs.writeFile(path.join(output,'real-use.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify({steps:result.steps,blockersBefore:result.blockersBefore,blockersAfter:result.blockersAfter,operations:result.operations,seconds:result.seconds,failure:result.failure,closed:result.closed}));
