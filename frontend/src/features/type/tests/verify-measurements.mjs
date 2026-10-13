import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect as baseExpect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const output=path.join(root,'.data/type-measurements');await fs.mkdir(output,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/type-full-generation/validation.sqlite');
const saved=JSON.parse(await fs.readFile(path.join(root,'.data/type-full-generation/record.json'),'utf8'));
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture,expect=baseExpect.configure({timeout:120000});
const wid=saved.workspaceId, started=performance.now(),record={workspaceId:wid,source:process.env.E2E_DATABASE_SOURCE,steps:[],checks:[],operations:0,errors:fixture.errors,runtime:fixture.runtime};
async function click(node){record.operations++;await node.click();}
async function fill(label,value){record.operations++;const input=page.getByRole('textbox',{name:label,exact:true});await input.fill(value);await input.press('Tab');}
async function step(name,work){const start=performance.now();try{await work();record.steps.push({name,seconds:+((performance.now()-start)/1000).toFixed(2),status:'completed'});}catch(error){record.steps.push({name,status:'failed',error:String(error),body:(await page.locator('body').innerText()).slice(-14000)});await page.screenshot({path:path.join(output,name+'-failed.png')});throw error;}finally{await fs.writeFile(path.join(output,'record.json'),JSON.stringify(record,null,2));}}
async function navigate(route){await page.goto(`${fixture.url}/types/${wid}/${route}?theme=light`);}
async function runStandard(){await click(page.getByRole('button',{name:'执行标准核对',exact:true}));const dialog=page.getByRole('dialog',{name:'执行标准核对 · 预检',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();record.operations++;await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:240000});await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','success');}
async function spec(){return fixture.api(`/api/types/${wid}/specification?audience=internal`);}
try{
  await page.setViewportSize({width:1366,height:768});
  await step('baseline',async()=>{await navigate('standard-check/results');await runStandard();record.before=await spec();record.blockersBefore=record.before.payload.checks.filter(c=>c.blocking).length;await navigate('specification/review');await expect(page.locator('[aria-label="按责任处理发布阻塞"]')).toBeVisible();await page.screenshot({path:path.join(output,'review-before-1366-light.png'),animations:'disabled'});});
  await step('measurement-entry',async()=>{
    await click(page.getByRole('button',{name:'录入实测值',exact:true}));const dialog=page.getByRole('dialog',{name:'录入实测值',exact:true});await expect(dialog).toBeVisible();
    assert.ok((await dialog.getByRole('textbox').all()).length>10);for(const input of await dialog.locator('.type-measured-values input').all())assert.equal(await input.inputValue(),'','标准判据不应预填为实测值');
    await click(dialog.getByRole('combobox',{name:'实测来源',exact:true}));await click(page.getByRole('option',{name:'教学示例实测',exact:true}));
    const now=new Date(),date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    await fill('样品编号','TEACH-YJV22-240-A');await fill('测量日期',date);await fill('测量方法','教学示例：投影仪测厚、铜带搭盖长度/带宽；非厂家报告');await fill('测量记录出处','本轮流程演示记录；独立构造的教学实测，不作为制造验收数据');
    const values=[];
    for(const container of await dialog.locator('[data-measured-quantity]').all()){
      const quantity=await container.getAttribute('data-measured-quantity'),input=container.getByRole('textbox'),label=await container.locator('label').first().innerText();
      const value=quantity==='minimum_thickness'?(label.includes('外护套')?'3.0':label.includes('绝缘')?'4.1':null):quantity==='maximum_thickness'&&label.includes('绝缘')?'4.7':quantity==='minimum_tape_thickness'&&label.includes('铜带')?'0.095':quantity==='minimum_overlap'&&label.includes('铜带')?'8':null;
      if(value!==null){await input.fill(value);await input.press('Tab');record.operations++;values.push({label,quantity,value});}
    }
    record.teachingMeasurements=values;assert.equal(values.length,13,'三芯各四项加外护套最薄点');
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);record.checks.push({state:'entry',width,theme,...await checkLayout(page,'[role=dialog]')});}
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await dialog.evaluate(e=>e.scrollTo(0,0));await page.screenshot({path:path.join(output,'entry-1366-light.png'),animations:'disabled'});
    await expect(dialog.getByRole('button',{name:'保存实测记录',exact:true})).toBeDisabled();await dialog.getByRole('checkbox').check();record.operations++;
    const dateWrites=fixture.writes.length;await fill('测量日期','2026-02-30');await click(dialog.getByRole('button',{name:'保存实测记录',exact:true}));
    await expect(dialog.getByRole('textbox',{name:'测量日期',exact:true})).toBeFocused();await expect(dialog.getByText('请输入有效的测量日期，且不能晚于今天。',{exact:true})).toBeVisible();assert.equal(fixture.writes.length,dateWrites,'无效日期应定位字段且不提交');
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);record.checks.push({state:'entry-date-error',width,theme,...await checkLayout(page,'[role=dialog]')});}
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await fill('测量日期',date);
    const minimum=dialog.locator('[data-measured-quantity=minimum_thickness]').first().getByRole('textbox');
    await minimum.fill('5.0');await minimum.press('Tab');record.operations++;const writesBefore=fixture.writes.length;await click(dialog.getByRole('button',{name:'保存实测记录',exact:true}));
    await expect(minimum).toBeFocused();await expect(dialog.getByText('最薄点大于同一试样最大厚度，请核对实测记录。',{exact:true})).toBeVisible();assert.equal(fixture.writes.length,writesBefore,'矛盾的实测值应在具体字段阻止保存');
    await minimum.fill('4.1');await minimum.press('Tab');record.operations++;
    const receipt=page.waitForResponse(r=>r.url().endsWith(`/api/types/${wid}/measurements`)&&r.request().method()==='POST');await click(dialog.getByRole('button',{name:'保存实测记录',exact:true}));const response=await receipt;assert.equal(response.status(),200,await response.text());record.saved=await response.json();await expect(dialog).toBeHidden();
    assert.equal(record.saved.domain.measurements.length,10);assert.equal(record.saved.domain.cable_types[0].cores[0].layers.find(l=>l.role==='insulation').thickness,.0045,'设计标称尺寸保持');
    assert.ok(Object.values(record.saved.domain.provenance).some(s=>s.kind==='demo'&&s.reference.includes('教学示例实测')));
    record.oldRevision=record.before.payload.revision;const old=await fixture.api(`/api/workspaces/${wid}/revisions/${record.oldRevision}`);assert.equal(old.state.domain.measurements.length,0,'历史版本不变');
  });
  await step('undo-and-redo',async()=>{
    record.undoFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,120),openDialogs:[...document.querySelectorAll('[role=dialog][data-state=open]')].map(e=>e.textContent?.slice(0,80))}));
    await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeEnabled();
    await page.keyboard.press('Control+z');record.operations++;await expect.poll(async()=>(await fixture.api(`/api/workspaces/${wid}`)).domain.measurements.length,{timeout:30000}).toBe(0);
    const reverted=await fixture.api(`/api/workspaces/${wid}`);await fixture.api(`/api/workspaces/${wid}/history/redo`,'POST',{expected_revision:reverted.revision});record.operations++;await page.reload();await expect(page.locator('[aria-label="按责任处理发布阻塞"]')).toBeVisible();
    assert.equal((await fixture.api(`/api/workspaces/${wid}`)).domain.measurements.length,10);
  });
  await step('standard-result',async()=>{await navigate('standard-check/results');await runStandard();record.after=await spec();record.blockersAfter=record.after.payload.checks.filter(c=>c.blocking).length;
    const rows=record.after.payload.results.standards.artifact.rows, measured=rows.filter(r=>r.measurement_id||r.measurement_ids);assert.equal(measured.length,13);assert.ok(measured.every(r=>r.verdict==='passed'&&r.citation&&r.basis_reference));
    const coverings=rows.filter(r=>['bedding-nominal','armour-tape-nominal','oversheath-nominal'].includes(r.id.split(':').pop()));
    assert.equal(coverings.length,3);assert.ok(coverings.every(r=>r.verdict==='passed'&&r.basis_reference?.record_sha256&&r.citation),'旧生成结构须经真实查询取得当前同版标准依据，不能困在旧发行引用');
    assert.equal(rows.length,record.before.payload.results.standards.artifact.rows.length,'不能靠删除要求降低阻塞');assert.equal(rows.filter(r=>r.verdict==='uncovered').length,record.before.payload.results.standards.artifact.rows.filter(r=>r.verdict==='uncovered').length);
    assert.equal(record.after.payload.purpose,'demo');assert.equal(record.after.ready,false);assert.match(record.after.html,/教学示例实测/);assert.match(record.after.html,/TEACH-YJV22-240-A/);
    assert.doesNotMatch(record.after.html,/basis_references/,'规格书正文不外露依据接口键');
    record.measuredRows=measured.map(r=>({title:r.title,actual:r.actual,limit:r.limit,margin:r.margin,verdict:r.verdict,citation:r.citation,input_source:r.input_source}));
    const display=await fixture.api(`/api/types/${wid}/display-runs?limit=1`);assert.equal(display.items.length,1);assert.ok(display.next_cursor>0,'真实历史分页保留后续运行');
    const savedRun=display.items[0],full=await fixture.api(`/api/workspaces/${wid}/studies/${savedRun.study}/runs/${savedRun.id}?view=full`);
    assert.equal(savedRun.snapshot_view,'inputs-on-demand');assert.equal(savedRun.input_digest,full.input_digest);assert.equal(savedRun.output_digest,full.output_digest);
    assert.equal(savedRun.snapshot.workspace_state,undefined);assert.ok(savedRun.snapshot.workspace_state_ref?.sha256);
    const historical=await fixture.api(savedRun.snapshot.workspace_state_ref.url);assert.deepEqual(historical.snapshot.workspace_state,full.snapshot.workspace_state,'固定型号历史完整快照仍可按需回放');
    record.historicalRun={id:savedRun.id,revision:full.snapshot.workspace_revision,name:full.snapshot.workspace_state.domain.name};
    assert.ok(full.output.cases.some(c=>Object.keys(c.artifacts).length>0),'选取含真实工件的保存运行');
    assert.equal(savedRun.output.cases.length,full.output.cases.length);
    for(const [index,producer] of full.output.cases.entries()){
      assert.deepEqual(savedRun.output.cases[index].artifacts,producer.artifacts,'显示投影保留真实结果工件');
      assert.deepEqual(savedRun.output.cases[index].results,producer.results,'显示投影保留物理量结果');
      assert.deepEqual(savedRun.output.cases[index].artifact_digests,producer.artifact_digests);
    }
    const projectedCase=savedRun.snapshot.cases[0];assert.ok(projectedCase.input_ref);assert.equal(projectedCase.input,undefined);
    const input=await fixture.api(projectedCase.input_ref.url);assert.deepEqual(input.input,full.snapshot.cases[0].input,'完整输入可按原摘要追溯');
    record.checks.push({state:'verified-display-evidence',inputDigest:savedRun.input_digest,outputDigest:savedRun.output_digest,historyPreserved:true});
  });
  await step('review-after',async()=>{await navigate('specification/review');await expect(page.locator('[aria-label="按责任处理发布阻塞"]')).toBeVisible();
    await expect(page.getByText('保存的结构依据与当前核对方法版本不一致；重新查询依据，复核结构尺寸后重算')).toHaveCount(0);
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);record.checks.push({state:'review',width,theme,...await checkLayout(page,'.type-root')});}
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(output,'review-after-1366-light.png'),animations:'disabled'});
    await promisify(execFile)(process.env.PYTHON||path.join(root,'.venv/Scripts/python.exe'),['-c',"import sqlite3,sys;s=sqlite3.connect(sys.argv[1]);t=sqlite3.connect(sys.argv[2]);s.backup(t);t.close();s.close()",fixture.database,path.join(output,'validation.sqlite')]);
  });
  await step('structure-draft-and-undo',async()=>{
    const savedWorkspace=await fixture.api(`/api/workspaces/${wid}`);await navigate('structure/table');
    const insulation=page.locator('.type-layer-input input').nth(2);await expect(insulation).toHaveValue('4.500');
    await insulation.fill('4.6');await insulation.press('Tab');record.operations++;await expect(insulation).toHaveValue('4.600');
    await click(page.getByRole('button',{name:'撤销',exact:true}));await expect(insulation).toHaveValue('4.500');
    const unchanged=await fixture.api(`/api/workspaces/${wid}`);assert.equal(unchanged.revision,savedWorkspace.revision);assert.deepEqual(unchanged.domain,savedWorkspace.domain,'本地结构试改与撤销不改保存修订或实测记录');
  });
  await step('fixed-run-input',async()=>{
    await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=light&run=${encodeURIComponent(record.historicalRun.id)}`);
    await expect(page.locator('.type-root')).toBeVisible();await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
    await expect(page.getByText(/^保存运行 · (历史 · )?只读(?: · 演示)?$/)).toBeVisible();
    await expect(page.locator('.type-layer-input input').nth(2)).toHaveValue('4.500');
    record.checks.push({state:'fixed-run-input',runId:record.historicalRun.id,revision:record.historicalRun.revision,verified:true});
  });
  assert.deepEqual(fixture.errors.filter(e=>!e.includes('Warning: useRouter')),[]);record.seconds=+((performance.now()-started)/1000).toFixed(2);
}catch(error){record.failure=String(error.stack||error);record.log=fixture.log();console.error(record.failure);process.exitCode=1;}
finally{await fixture.close();record.closed=true;await fs.writeFile(path.join(output,'record.json'),JSON.stringify(record,null,2));}
console.log(JSON.stringify({steps:record.steps,blockersBefore:record.blockersBefore,blockersAfter:record.blockersAfter,seconds:record.seconds,operations:record.operations,failure:record.failure,closed:record.closed}));
