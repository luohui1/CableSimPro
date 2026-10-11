import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {expect as baseExpect} from '@playwright/test';
import {typeFixture,root} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';

// Actual release database backup, actual host and installed plugins, one browser page.
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/release/engineering.sqlite');
const output=path.join(root,'.data/type-real-use');await fs.mkdir(output,{recursive:true});
const toolbarOnly=process.argv.includes('--toolbar-only'),recordPath=path.join(output,toolbarOnly?'toolbar-record.json':'record.json');
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
const expect=baseExpect.configure({timeout:30000}),report={steps:[],clicks:0,errors:fixture.errors,runtime:fixture.runtime,layouts:[],assumptions:['工程师显式选择等截面积实心圆；不是95 mm²绞合导体的制造外径','填充外包0.1 mm、连续等效包带0.1 mm为本次工程师输入；不称作标准厚度或绕包制造参数']};
let wid;const started=performance.now();
async function click(locator){report.clicks++;await locator.click();}
async function select(label,option){await click(page.getByRole('combobox',{name:label,exact:true}));await click(page.getByRole('option',{name:option,exact:true}));}
async function step(name,work){const start=performance.now(),clicks=report.clicks;try{await work();await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});report.steps.push({name,status:'completed',seconds:+((performance.now()-start)/1000).toFixed(2),clicks:report.clicks-clicks,visibleText:(await page.getByRole('dialog').last().isVisible()?await page.getByRole('dialog').last().innerText():await page.locator('main').innerText().catch(()=>page.locator('body').innerText())).slice(-9000)});await fs.writeFile(recordPath,JSON.stringify(report,null,2));}catch(error){report.steps.push({name,status:'failed',seconds:+((performance.now()-start)/1000).toFixed(2),error:String(error),visibleText:(await page.locator('body').innerText()).slice(-9000)});await page.screenshot({path:path.join(output,name+'-failed.png')});throw error;}}
async function module(name){await click(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:new RegExp('^'+name)}));}
async function run(label){await click(page.getByRole('button',{name:label,exact:true}));const dialog=page.getByRole('dialog',{name:label+' · 预检',exact:true});await expect(dialog).toBeVisible();const gate=dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true});if(await gate.isEnabled()){await gate.check();report.clicks++;await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:180000});}else {report.steps.push({name:label,status:'blocked',reason:await dialog.innerText()});await page.keyboard.press('Escape');}}
try{
  if(!toolbarOnly){
  await page.setViewportSize({width:1366,height:768});await page.goto(fixture.url+'/types?create=1&theme=light');
  await step('create-proposal',async()=>{
    await page.getByRole('radio',{name:'按标准生成',exact:true}).check();report.clicks++;
    await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('YJV 0.6/1 kV 4×95 · 四芯设计草稿');
    await select('结构类型','四芯等截面');await select('额定电压','0.6/1 kV');
    await page.getByRole('textbox',{name:'导体截面',exact:true}).fill('95');await select('导体几何','等截面积实心圆 · 理想化');
    for(const [label,value] of [['芯间净距','0'],['填充外包厚度','0.1'],['包带等效厚度','0.1']])await page.getByRole('textbox',{name:label,exact:true}).fill(value);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/types/creation-proposals')&&r.request().method()==='POST');
    await click(page.getByRole('button',{name:'生成结构提案',exact:true}));const receipt=await response;assert.equal(receipt.status(),200,await receipt.text());
    const proposal=await receipt.json();await fs.writeFile(path.join(output,'proposal.json'),JSON.stringify(proposal,null,2));
    assert.equal(proposal.document.cable_types[0].cores.length,4);assert.equal(proposal.rows.filter(row=>row.basis==='standard_value').length,4);
    await expect(page.locator('[aria-label="结构提案"]')).toContainText('1.1 mm');await expect(page.locator('[aria-label="结构提案"]')).toContainText('mm²');
    await expect(page.getByRole('button',{name:'确认并建立草稿',exact:true})).toBeDisabled();
  });
  await step('structure',async()=>{
    await page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项',exact:true}).check();report.clicks++;
    await click(page.getByRole('button',{name:'确认并建立草稿',exact:true}));await expect(page).toHaveURL(/\/types\/[^/]+\/structure\//);wid=new URL(page.url()).pathname.split('/')[2];
    await expect(page.locator('[data-type-page=structure]')).toBeVisible();await expect(page.locator('.drawing-svg')).toBeVisible();
    const workspace=await fixture.api('/api/workspaces/'+wid);await fs.writeFile(path.join(output,'workspace.json'),JSON.stringify(workspace,null,2));
    const cores=workspace.domain.cable_types[0].cores,d=Math.sqrt(4*95e-6/Math.PI),t=.0011,s=d+2*t,R=s/Math.SQRT2+d/2+t;
    for(const core of cores){assert.ok(Math.abs(core.conductor.diameter-d)<1e-12);assert.ok(Math.abs(Math.abs(core.x)-s/2)<1e-12);assert.ok(Math.abs(Math.abs(core.z)-s/2)<1e-12);}
    report.handCheck={formula:'s=d+2t; R=s/√2+d/2+t; Af=π(R+tf)²−4π(d/2+t)²; Ab=π[(R+tf+tb)²−(R+tf)²]',d_m:d,t_m:t,s_m:s,R_m:R,diameter_m:2*(R+.0002),filler_area_m2:Math.PI*(R+.0001)**2-4*Math.PI*(d/2+t)**2,binder_area_m2:Math.PI*((R+.0002)**2-(R+.0001)**2)};
  });
  await step('geometry',async()=>{await click(page.getByRole('tab',{name:'外径与用料',exact:true}));await run('更新结构推导');await expect(page.locator('[data-type-page=quantities]')).toHaveAttribute('data-type-state','success');});
  await step('requirements',async()=>{await module('要求与标准');await run('生成要求目录');await expect(page.locator('body')).toContainText('依据已核验');});
  await step('electrical',async()=>{
    await module('电气参数');await click(page.getByRole('button',{name:'在方法页填写参数',exact:true}));
    const frequency=page.getByLabel('频率',{exact:true});await frequency.fill('50');await frequency.press('Enter');
    await click(page.getByRole('button',{name:'保存方法条件',exact:true}));await expect(page.getByRole('button',{name:'保存方法条件',exact:true})).toBeDisabled();
    await page.goto(`${fixture.url}/types/${wid}/electrical/results?theme=light`);await run('计算电气参数');await expect(page.locator('[data-type-page=electrical-results]')).toHaveAttribute('data-type-state','success');
  });
  await step('short-circuit',async()=>{
    await module('短路容量');await click(page.getByRole('button',{name:'在方法页填写参数',exact:true}));
    for(const [label,value] of [['持续时间','1'],['初始绝对温度','90'],['导体最终温度','250']]){const field=page.getByLabel(label,{exact:true});await field.fill(value);await field.press('Enter');}
    report.assumptions.push('短路条件由工程师显式给定：90 → 250 °C，1 s；不证明草稿产品已批准该终温');
    await click(page.getByRole('button',{name:'保存方法条件',exact:true}));await expect(page.getByRole('button',{name:'保存方法条件',exact:true})).toBeDisabled();
    await page.goto(`${fixture.url}/types/${wid}/short-circuit/results?theme=light`);await run('计算短路容量');await expect(page.locator('[data-type-page=short-circuit-results]')).toHaveAttribute('data-type-state','success');await expect(page.locator('body')).toContainText('4 芯相同');
  });
  await step('rating',async()=>{await module('载流量表');await expect(page.locator('[data-type-page=rating-table-results]')).toHaveAttribute('data-type-state','inapplicable');await expect(page.getByRole('button',{name:'继续完善护层与材料'})).toBeVisible();});
  await step('specification',async()=>{
    await module('规格书');await select('文档版本','内部审核版');const download=page.waitForEvent('download',{timeout:240000});download.catch(()=>{});
    await click(page.getByRole('button',{name:'导出内部审核稿',exact:true}));await(await download).saveAs(path.join(output,'four-core-draft.pdf'));
    const spec=await fixture.api(`/api/types/${wid}/specification?audience=internal`);await fs.writeFile(path.join(output,'specification.json'),JSON.stringify(spec,null,2));assert.equal(spec.ready,false);
    const geometry=spec.payload.results.geometry.artifact;
    assert.ok(Math.abs(geometry.outer_diameter_m-report.handCheck.diameter_m)<1e-8);
    for(const [role,key] of [['filler','filler_area_m2'],['binder','binder_area_m2']]){const layer=geometry.layers.find(row=>row.role===role);assert.ok(layer);assert.ok(Math.abs(layer.material_volume_m3/geometry.length_m-report.handCheck[key])<1e-8);}
    const short=spec.payload.results.short_circuit.artifact.rows.filter(row=>row.id.endsWith(':conductor-adiabatic'));assert.equal(short.length,4);
    for(const row of short){assert.equal(row.status,'available');const v=row.formula_inputs;assert.ok(Math.abs(row.value-v.K*v.S_mm2*Math.sqrt(Math.log((v.theta_f_K-273.15+v.beta_K)/(v.theta_i_K-273.15+v.beta_K))/v.t_s))<1e-8);}
    report.results={diameterMm:geometry.outer_diameter_m*1000,shortCircuitKa:short[0].value/1000,electrical:spec.payload.results.electrical.artifact.counts,standard:spec.payload.results.standards.artifact.counts,publicationReady:spec.ready};
  });
  for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/structure/section?theme=${theme}`);await expect(page.locator('.drawing-svg')).toBeVisible();report.layouts.push({width,theme,...await checkLayout(page)});}
  await step('reduced-neutral',async()=>{
    await page.setViewportSize({width:1366,height:768});await page.goto(fixture.url+'/types?create=1&theme=light');
    await page.getByRole('radio',{name:'按标准生成',exact:true}).check();report.clicks++;
    await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('YJV 0.6/1 kV 3×95+1×50 · 中性线设计草稿');await select('结构类型','3+1 · 中性线截面减小');await select('额定电压','0.6/1 kV');await select('导体几何','等截面积实心圆 · 理想化');
    for(const [label,value] of [['导体截面','95'],['中性线截面','50'],['芯间净距','0.2'],['填充外包厚度','0.15'],['包带等效厚度','0.2']])await page.getByRole('textbox',{name:label,exact:true}).fill(value);
    const received=page.waitForResponse(r=>r.url().endsWith('/api/types/creation-proposals')&&r.request().method()==='POST');await click(page.getByRole('button',{name:'生成结构提案',exact:true}));const response=await received;assert.equal(response.status(),200,await response.text());const proposal=await response.json();await fs.writeFile(path.join(output,'neutral-proposal.json'),JSON.stringify(proposal,null,2));
    assert.deepEqual(proposal.document.cable_types[0].cores.map(c=>c.conductor.nominal_area),[95e-6,95e-6,95e-6,50e-6]);assert.equal(proposal.document.cable_types[0].cores[3].layers[0].thickness,.001);
    await page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项',exact:true}).check();report.clicks++;await click(page.getByRole('button',{name:'确认并建立草稿',exact:true}));await expect(page).toHaveURL(/\/types\/[^/]+\/structure\//);const neutralId=new URL(page.url()).pathname.split('/')[2];
    await click(page.getByRole('tab',{name:'外径与用料',exact:true}));await run('更新结构推导');const spec=await fixture.api(`/api/types/${neutralId}/specification?audience=internal`),g=spec.payload.results.geometry.artifact,cores=proposal.document.cable_types[0].cores;
    const radii=cores.map(c=>c.conductor.diameter/2+c.layers[0].thickness),R=Math.max(...cores.map((c,i)=>Math.hypot(c.x,c.z)+radii[i])),filled=R+.00015;
    for(let i=0;i<4;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(cores[i].x-cores[j].x,cores[i].z-cores[j].z)>=radii[i]+radii[j]);
    assert.ok(Math.abs(g.outer_diameter_m-2*(filled+.0002))<1e-8);assert.ok(Math.abs(g.layers.find(l=>l.role==='filler').material_volume_m3/g.length_m-(Math.PI*filled**2-radii.reduce((sum,r)=>sum+Math.PI*r*r,0)))<1e-8);
    report.neutral={diameterMm:g.outer_diameter_m*1000,neutralThicknessMm:1,neutralAreaMm2:50,arrangement:'正方形芯中心；中性线多余间隙计入真实填充空间'};
  });
  }
  await step('research-trial-toolbar',async()=>{
    let study;for(const workspace of await fixture.api('/api/workspaces')){if(!/三回排管/.test(workspace.name))continue;const saved=(await fixture.api(`/api/workspaces/${workspace.id}/studies`)).find(s=>s.latest_run_id&&s.definition.method.plugin_id==='cablesim.iec60287');if(saved){study={workspace,saved};break;}}
    assert.ok(study,'发布库有真实排管研究');
    for(const width of [1366,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/studies/${study.saved.id}?workspace=${study.workspace.id}&view=section&theme=${theme}`);
      const toolbar=page.getByRole('toolbar',{name:'视图与绘图工具'}),open=page.getByRole('button',{name:'查看布置图',exact:true});await expect(toolbar.or(open).first()).toBeVisible();if(await open.isVisible())await click(open);await expect(toolbar).toBeVisible();await click(page.getByRole('button',{name:'试算模式',exact:true}));
      const metrics=await toolbar.evaluate(node=>({scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,slots:[...node.querySelectorAll('[data-drawing-toolbar-slot],.drawing-toolbar')].map(n=>({scrollWidth:n.scrollWidth,clientWidth:n.clientWidth}))}));assert.ok(metrics.scrollWidth<=metrics.clientWidth+1);assert.ok(metrics.slots.every(s=>s.scrollWidth<=s.clientWidth+1));
      const status=page.locator('.geometry-what-if .what-if-status');await expect(status).toBeVisible();const statusBox=await status.boundingBox();assert.ok(statusBox.width>=96&&statusBox.height<=40,'试算状态保持横排：'+JSON.stringify(statusBox));
      await click(page.getByRole('button',{name:'更多绘图工具',exact:true}));await click(page.getByRole('button',{name:'敷设模板',exact:true}));await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.drawing-secondary-tools')).toHaveCount(0);report.layouts.push({name:'试算工具收纳',width,theme,metrics,statusBox,...await checkLayout(page)});
      if(width===1366&&theme==='light')await page.screenshot({path:path.join(output,'research-toolbar.png'),animations:'disabled'});
    }
  });
  assert.deepEqual(fixture.errors,[]);report.totalSeconds=+((performance.now()-started)/1000).toFixed(2);console.log(toolbarOnly?'真实试算工具栏使用完成':'真实四芯流程完成');
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1;}finally{await fs.writeFile(recordPath,JSON.stringify(report,null,2));await fixture.close();}
