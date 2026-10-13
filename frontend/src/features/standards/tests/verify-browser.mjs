import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openHeadlessBrowser, settle } from '../../../../scripts/browser.mjs';
import { assertLayout } from '../../../../scripts/layout-assertions.mjs';

const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const output=path.join(root,'.data/standards-basis');
const owned=[];let browser;let logs='';
const scratch=path.join(root,'.tmp/standards-basis/browser-'+randomUUID());
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const p=server.address().port;await new Promise(r=>server.close(r));return p;}
function start(command,args,options={}){const child=spawn(command,args,{cwd:root,windowsHide:true,...options});owned.push(child);child.stderr?.on('data',x=>logs+=String(x));return child;}
async function ready(url,child){for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(url)).ok)return;}catch{}await pause(250);}throw Error('启动超时 '+url+' '+logs);}
async function choose(page,label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
const checks=[];
try{
  await fs.mkdir(output,{recursive:true});
  await fs.mkdir(scratch,{recursive:true});
  const apiPort=await port(),uiPort=await port();
  const python=process.env.PYTHON||'python';
  const database=path.join(scratch,'engineering.sqlite');
  const copy=start(python,['-B','-c',"import sqlite3,sys;from pathlib import Path;a=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True);b=sqlite3.connect(sys.argv[2]);a.backup(b);b.close();a.close()",path.join(root,'.data/release/engineering.sqlite'),database],{stdio:['ignore','ignore','pipe']});
  assert.equal((await once(copy,'exit'))[0],0,'发布库隔离副本失败');
  const environment={...process.env,CABLESIM_DB:database,CABLESIM_DATASETS_DIR:path.join(scratch,'datasets'),CABLESIM_AGENT_KEY_STORE:'memory',TEMP:scratch,TMP:scratch,PYTHONIOENCODING:'utf-8'};
  const backend=start(python,['-B','-c',"import os,uvicorn;from pathlib import Path;from backend.main import app;from backend.plugin_host.resident import ResidentRunner;p=Path(os.environ['TEMP']);app.state.previews.jobs=p/'previews';app.state.previews.jobs.mkdir();app.state.previews.runner=ResidentRunner(p/'preview-workers');uvicorn.run(app,host='127.0.0.1',port=int(os.environ['STANDARDS_PORT']))"],{env:{...environment,STANDARDS_PORT:String(apiPort)},stdio:['ignore','ignore','pipe']});
  await ready(`http://127.0.0.1:${apiPort}/api/health`,backend);
  const preview=start(process.execPath,[path.join(root,'frontend/node_modules/vite/bin/vite.js'),'preview','--outDir',path.join(output,'frontend-acceptance'),'--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{cwd:path.join(root,'frontend'),env:{...process.env,BACKEND_URL:`http://127.0.0.1:${apiPort}`},stdio:['ignore','ignore','pipe']});
  const url=`http://127.0.0.1:${uiPort}`;await ready(url,preview);
  browser=await openHeadlessBrowser({executable:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});const {page,context}=browser;page.setDefaultTimeout(15000);await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
  await page.setViewportSize({width:1366,height:768});
  const errors=[],initialInputs=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/plugin-queries/'))initialInputs.push(r.postDataJSON()?.input);});console.log('Own isolated services ready',apiPort,uiPort);
  await page.goto(url+'/resources/standards');await page.locator('[data-page="standards-basis"][data-state="success"]').waitFor();
  await page.getByRole('table',{name:'标准完整表格'}).waitFor();await settle(page);
  assert.equal(initialInputs.length,1,'首次浏览只执行一次目录与选表读取，不逐表预取整库');assert.equal(initialInputs[0].operation,'browse');assert.equal(initialInputs[0].locator,'表 7');
  // Admission and values come from the real host and saved release copy.
  const methods=await (await fetch(`http://127.0.0.1:${apiPort}/api/methods`)).json();
  const pin=methods.find(x=>x.method.plugin_id==='cablesim.standards-basis').method;
  const queries=[
    ['Nielsen et al.','2019','Table 1','volumetric_heat_capacity',{material:'copper'},3460000,8,9],
    ['GB/T 12706.1','2020','表 A.2','bundle_factor',{core_count:4,equal_core_sections:true,cable_arrangement:'standard'},2.42,35,41],
    ['GB/T 3956','2008','表 1','resistance_20_max',{area_m2:.000185,conductor_class:1,conductor_material:'copper',coating:'plain',conductor_form:'circular'},.101,3,6],
    ['GB/T 12706.1','2020','表 18','insulation_mechanical_test_requirement',{test_item:'老化前抗张强度最小',insulation:'EPR',insulation_test_group:'other_cable'},4.2,29,35],
    ['GB/T 12706.4','2020','表14','test_voltage',{test_item:'冲击电压试验（峰值）',u0_v:3600,u_v:6000,um_v:7200},60,15,19],
    ['GB/T 12706.2','2020','13.7','armour_tape_gap_ratio_max',{armour_kind:'tape'},.5,13,21],
    ['GB/T 12706.3','2020','10.2.2','screen_tape_measured_min_ratio',{},.9,8,13],
  ];
  const receipts=[];
  for(const [standard,edition,locator,quantity,conditions,value,printed,pdf] of queries){
    const request={schema_version:'cablesim.standards-query/1',standard,edition,locator,quantity,conditions};
    const response=await fetch(`http://127.0.0.1:${apiPort}/api/plugin-queries/cablesim.standards-basis/lookup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({release_digest:pin.release_digest,input:request})});
    const reply=await response.json();assert.equal(response.status,200,JSON.stringify(reply));
    const answer=reply.artifacts['x-cablesim.standards-basis'];assert.equal(answer.status,'resolved');assert.equal(reply.plugin_version,'0.5.0');
    const record=answer.records[0];assert.deepEqual([record.value,record.printed_page,record.pdf_page],[value,printed,pdf]);assert.equal(record.verification.status,'verified');assert.ok(record.verification.methods.length>=2);
    receipts.push({request,...reply});
  }
  await fs.writeFile(path.join(output,'real-queries.json'),JSON.stringify({source:'.data/release/engineering.sqlite (只读backup到隔离副本)',receipts},null,2));
  const soil={schema_version:'cablesim.standards-query/1',operation:'evaluate',standard:'Hopmans et al.',edition:'2002',locator:'§2.2 Eq. (1)/(2)',quantity:'soil_capacity_expression',
    conditions:{material:'soil',material_role:'porous_soil',soil_capacity_method:'three_phase',parameter_origin:'project_measured'},
    formula_inputs:{dry_bulk_density_kg_m3:1500,particle_density_kg_m3:2500,solid_specific_heat_capacity_j_kg_k:800,water_volumetric_heat_capacity_j_m3_k:4180000,air_volumetric_heat_capacity_j_m3_k:1200,water_volume_fraction:.2,phase_assumption:'single_temperature_no_phase_change'}};
  const soilResponse=await fetch(`http://127.0.0.1:${apiPort}/api/plugin-queries/cablesim.standards-basis/lookup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({release_digest:pin.release_digest,input:soil})});
  const soilReply=await soilResponse.json();assert.equal(soilResponse.status,200,JSON.stringify(soilReply));
  const soilAnswer=soilReply.artifacts['x-cablesim.standards-basis'];assert.equal(soilAnswer.calculation.output.value,2036240);assert.equal(soilAnswer.records[0].printed_page,'7-3');
  assert.equal(soilAnswer.records[0].verification.status,'verified');receipts.push({request:soil,handCheck:'1500×800 + .2×4180000 + .2×1200；手算示例，非城南现场土壤',...soilReply});
  await fs.writeFile(path.join(output,'real-queries.json'),JSON.stringify({source:'.data/release/engineering.sqlite (只读backup到隔离副本)',receipts},null,2));
  if(process.argv.includes('--before')){
    for(const size of [{width:1366,height:768},{width:1920,height:1080}]){
      await page.setViewportSize(size);await settle(page);
      await page.screenshot({path:path.join(output,`browser-before-${size.width}.png`)});
    }
    console.log('两尺寸改前截图已保存');
  }else{
  assert.equal(await page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').count(),9);
  // Source row labels are explicitly tested below using the actual table text.
  const row=page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').filter({hasText:'240'});
  const value=row.getByRole('button',{name:/查看依据：.*12\/20 kV.*5.5 mm/});await value.hover();
  await page.getByRole('tooltip').filter({hasText:'PDF 第 15 页'}).waitFor();
  await value.press('Escape');await value.click();
  await page.getByLabel('选中格详情').filter({hasText:'PDF 第 15 页'}).waitFor();
  await settle(page);
  const header=await page.getByRole('table',{name:'标准完整表格'}).locator('thead th').first().boundingBox();
  const viewport=await page.locator('.basis-table .table-scroll').boundingBox();
  assert.ok(header&&viewport&&header.y>=viewport.y-1,'选格滚动后列条件标题不可见');
  assert.equal(await row.getByRole('button',{name:/复制引用/}).count(),0);
  await page.getByRole('button',{name:'复制引用',exact:true}).click();
  const citation=await page.evaluate(()=>navigator.clipboard.readText());
  assert.equal(citation,'GB/T 12706.2—2020 表 7，第 7 页：240 mm²、12/20 kV、XLPE，5.5 mm');
  await value.focus();await page.keyboard.press('ArrowRight');
  await page.getByLabel('选中格详情').filter({hasText:'8 mm'}).waitFor();
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),citation);
  await value.focus();
  for(let i=0;i<4;i++)await page.keyboard.press('ArrowUp');
  await page.getByLabel('选中格详情').filter({hasText:'16 mm²'}).waitFor();
  await settle(page);
  const selectedAtTop=await page.locator('.basis-value[aria-pressed="true"]').boundingBox();
  const pinnedHeader=await page.getByRole('table',{name:'标准完整表格'}).locator('thead th').first().boundingBox();
  assert.ok(selectedAtTop&&pinnedHeader&&selectedAtTop.y>=pinnedHeader.y+pinnedHeader.height-1,'方向键选中格被表头遮挡');
  for(let i=0;i<4;i++)await page.keyboard.press('ArrowDown');
  assert.ok(!(await page.getByRole('table',{name:'标准完整表格'}).locator('thead').innerText()).includes('绝缘标称厚度'));
  assert.match(await page.locator('.basis-source').innerText(),/第 7 页（PDF 第 15 页）· 两路核验/);
  await page.getByRole('button',{name:'条件检索',exact:true}).click();
  await page.getByLabel('导体截面 / mm²',{exact:true}).fill('240');
  await page.getByLabel('相对地电压 / kV',{exact:true}).fill('12');
  await page.getByLabel('额定电压 / kV',{exact:true}).fill('20');
  await page.getByRole('button',{name:'查依据',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'请补齐适用条件'}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'绝缘类型',exact:true}).evaluate(el=>el===document.activeElement),true);
  await choose(page,'绝缘类型','XLPE');await page.getByRole('button',{name:'查依据',exact:true}).click();
  await page.locator('.basis-result').filter({hasText:'5.5 mm'}).waitFor();
  await page.getByLabel('导体截面 / mm²',{exact:true}).fill('');await page.getByRole('button',{name:'查依据',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'请补齐适用条件'}).waitFor();
  await choose(page,'本次会话查询记录',citation);await page.locator('[data-state="historical"]').waitFor();
  await page.keyboard.press('Control+s');await page.getByRole('status').filter({hasText:'只读依据无需保存'}).waitFor();
  await choose(page,'标准版本','GB 50217—2018');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'D.0.6'}).click();
  await page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').first().waitFor();
  assert.equal(await page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').count(),2);
  await choose(page,'标准版本','IEC 60287-1-1—2023');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'Table 2'}).click();
  await page.getByRole('button',{name:/查看依据：.*Table 2.*，a$/}).first().waitFor();
  assert.equal(await page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').count(),14);
  await choose(page,'标准版本','GB/T 12706.3—2020');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'表 18 ·'}).click();
  await page.getByRole('button',{name:/查看依据：.*表 18.*N\/mm²/}).first().waitFor();
  assert.equal(await page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').count(),9);
  const dash=page.getByRole('table',{name:'标准完整表格'}).getByRole('button').filter({hasText:/^—$/}).first();
  await dash.hover();await page.getByRole('tooltip').filter({hasText:'标准不适用（原表为破折号）'}).waitFor();await dash.press('Escape');
  assert.equal(await dash.innerText(),'—');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'表 5 ·'}).click();
  const blank=page.getByRole('button',{name:/查看依据：.*表 5.*（原表空白）$/});await blank.waitFor();
  await blank.click();await page.getByRole('button',{name:'复制引用',exact:true}).click();
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/（原表空白）$/);
  for(const theme of ['light','dark'])for(const size of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(size);
    await page.goto(url+`/resources/standards?theme=${theme}`);await page.getByRole('table',{name:'标准完整表格'}).waitFor();await settle(page);
    const selected=page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').filter({hasText:'240'}).getByRole('button',{name:/查看依据：.*12\/20 kV.*5.5 mm/});
    await selected.click();await settle(page);
    checks.push({theme,size,state:'success',...(await assertLayout(page,'标准依据成功'))});
    // Wide conductor table: only its own scroll container moves; row condition stays pinned.
    await choose(page,'标准版本','IEC 60228—2023');
    await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'Table 4 ·'}).click();
    await page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').first().waitFor();
    const scroll=page.locator('.basis-table .table-scroll');
    const before=await scroll.locator('tbody tr').first().locator('td').first().boundingBox();
    const neighborBefore=await scroll.locator('tbody tr').first().locator('td').nth(1).boundingBox();
    const horizontal=await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;return {width:el.clientWidth,total:el.scrollWidth,offset:el.scrollLeft};});
    const after=await scroll.locator('tbody tr').first().locator('td').first().boundingBox();
    const neighborAfter=await scroll.locator('tbody tr').first().locator('td').nth(1).boundingBox();
    if(size.width===1366)assert.ok(horizontal.total>horizontal.width&&horizontal.offset>0,'1366宽表没有实际横向滚动');
    if(horizontal.offset>0)assert.ok(neighborAfter.x<neighborBefore.x-1,'数值列没有随滚动移动');
    assert.ok(Math.abs(before.x-after.x)<1,'首列未固定');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await choose(page,'标准版本','GB/T 12706.2—2020');
    await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'表 7 ·'}).click();
    await page.getByRole('table',{name:'标准完整表格'}).locator('tbody tr').first().waitFor();
    await page.getByRole('button',{name:'条件检索',exact:true}).click();
    await page.getByLabel('导体截面 / mm²',{exact:true}).fill('240');
    await page.getByLabel('相对地电压 / kV',{exact:true}).fill('12');
    await page.getByLabel('额定电压 / kV',{exact:true}).fill('20');
    await choose(page,'绝缘类型','XLPE');await page.getByRole('button',{name:'查依据',exact:true}).click();
    await page.locator('.basis-result').filter({hasText:'5.5 mm'}).waitFor();
    await choose(page,'本次会话查询记录',citation);await page.locator('[data-state="historical"]').waitFor();
    await settle(page);checks.push({theme,size,state:'historical',...(await assertLayout(page,'标准依据历史'))});
    for(const state of ['empty','error','loading']){
      await page.route('**/api/plugin-queries/**',async route=>{try{if(state==='loading'){await pause(3000);await route.abort();}else if(state==='empty'){const reply=await route.fetch();const value=await reply.json();value.artifacts['x-cablesim.standards-basis'].tables=[];await route.fulfill({json:value});}else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'核验服务离线，请重新读取'}})});}catch(e){if(!/already handled|Target.*closed/.test(String(e)))throw e;}});
      await page.reload();await page.locator(`[data-page="standards-basis"][data-state="${state}"]`).waitFor();await page.evaluate(()=>document.fonts.ready);
      checks.push({theme,size,state,...(await assertLayout(page,`标准依据${state}`))});await page.unroute('**/api/plugin-queries/**');
    }
  }
  await page.reload();await page.locator('[data-page="standards-basis"][data-state="success"]').waitFor();
  await choose(page,'标准版本','GB/T 12706.1—2020');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'表 14 ·'}).click();
  const trials=page.getByRole('table',{name:'标准完整表格'});
  await trials.locator('tbody tr').nth(14).waitFor();assert.equal(await trials.locator('tbody tr').count(),15);
  const tolerance=trials.getByRole('button').filter({hasText:'200 ± 3'});await tolerance.click();
  await page.getByLabel('选中格详情').filter({hasText:'200 ± 3 °C'}).waitFor();
  assert.ok((await page.locator('.basis-source').innerText()).includes('第 17–18 页'));
  await choose(page,'标准版本','GB 50217—2018');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:/表\s*5\.5\.2\s*·/}).click();
  const formula=page.getByRole('table',{name:'标准完整表格'}).getByRole('button').filter({hasText:/^h \+ 80$/});
  await formula.click();await page.getByLabel('选中格详情').filter({hasText:'h为槽盒外壳高度，单位mm'}).waitFor();
  assert.match(await page.getByLabel('选中格详情').innerText(),/公式仅作为依据，不执行/);
  await page.setViewportSize({width:1366,height:768});
  await page.goto(url+'/resources/standards?theme=light');await page.getByRole('table',{name:'标准完整表格'}).waitFor();
  await choose(page,'标准版本','Hopmans et al.—2002');
  const thermal=page.getByRole('table',{name:'标准完整表格'});await thermal.locator('tbody tr').nth(1).waitFor();assert.equal(await thermal.locator('tbody tr').count(),2);
  await thermal.getByRole('button').first().click();await page.getByLabel('选中格详情').filter({hasText:'第 7-3 页'}).waitFor();await settle(page);
  await page.getByText('代入现场参数',{exact:true}).click();
  const soilForm=page.getByRole('form',{name:'现场土壤热容计算'});
  assert.equal(await soilForm.getAttribute('data-state'),'empty');
  for(const [key,value] of Object.entries(soil.formula_inputs)) if(key!=='phase_assumption') await soilForm.locator(`[name="${key}"]`).fill(String(value));
  await soilForm.getByLabel('确认各相同温，无冻结或相变').check();
  await soilForm.getByRole('button',{name:'计算参考热容'}).click();await soilForm.locator('[role="status"]').filter({hasText:'2036240'}).waitFor();
  assert.equal(await soilForm.getAttribute('data-state'),'success');
  await soilForm.locator('[name="water_volume_fraction"]').fill('.41');assert.equal(await soilForm.getAttribute('data-state'),'historical');
  await soilForm.getByRole('button',{name:'计算参考热容'}).click();await soilForm.getByRole('alert').filter({hasText:'孔隙率'}).waitFor();
  assert.equal(await soilForm.getAttribute('data-state'),'error');
  assert.equal(await soilForm.locator('[name="water_volume_fraction"]').evaluate(el=>el===document.activeElement),true);
  await soilForm.locator('[name="water_volume_fraction"]').fill('.2');await soilForm.getByRole('button',{name:'计算参考热容'}).click();await page.locator('form[aria-label="现场土壤热容计算"][data-state="success"]').waitFor();
  await soilForm.locator('[role="status"]').filter({hasText:'参考热容：2036240'}).waitFor();
  await page.locator('.basis-detail').evaluate(el=>el.scrollTop=el.scrollHeight);await settle(page);
  checks.push({state:'thermal-success',...(await assertLayout(page,'材料热容原表'))});
  await page.screenshot({path:path.join(output,'thermal-capacity.png')});
  await choose(page,'标准版本','GB/T 12706.1—2020');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'表 A.2 ·'}).click();
  const bundles=page.getByRole('table',{name:'标准完整表格'});await bundles.locator('tbody tr').nth(54).waitFor();assert.equal(await bundles.locator('tbody tr').count(),55);
  await page.getByRole('button',{name:'条件检索',exact:true}).click();
  await page.getByLabel('芯数',{exact:true}).fill('4');await choose(page,'等截面线芯','是');await choose(page,'电缆排列','普通排列');
  await page.getByRole('button',{name:'查依据',exact:true}).click();await page.locator('.basis-result').filter({hasText:'2.42'}).waitFor();
  await page.getByRole('button',{name:'条件检索',exact:true}).click();
  for(const [locator,label] of [['A.2.4 ·','缆芯假设直径≤40 mm'],['式 A.5 ·','4芯；一根线芯截面较小']]){
    await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:locator}).click();
    const table=page.getByRole('table',{name:'标准完整表格'});await table.getByText(label,{exact:false}).first().waitFor();
    assert.ok(!(await table.locator('tbody').innerText()).includes("{'lte'"));
    assert.ok(!(await table.locator('tbody').innerText()).includes('one_reduced'));
  }
  await choose(page,'标准版本','GB/T 12706.3—2020');
  await page.getByRole('combobox',{name:'表或条款',exact:true}).click();await page.getByRole('option').filter({hasText:'10.2.2 · 35 kV铜带屏蔽标称厚度'}).click();
  const copper=page.getByRole('table',{name:'标准完整表格'});await copper.locator('tbody tr').nth(1).waitFor();assert.equal(await copper.locator('tbody tr').count(),2);
  assert.equal(await copper.locator('thead th').count(),2,'同条款的不同判据表不得按行号拼接');assert.ok(!(await copper.locator('tbody').innerText()).includes('缺项'));
  await copper.locator('tbody tr').last().getByRole('button').first().click();await page.getByLabel('选中格详情').filter({hasText:'PDF 第 13 页'}).waitFor();await settle(page);
  checks.push({state:'copper-success',...(await assertLayout(page,'铜带制造判据'))});await page.screenshot({path:path.join(output,'copper-manufacturing.png')});
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'browser-checks.json'),JSON.stringify({checks,citation,scope:'真实backend.main、真实Executor、保存发布库的隔离副本；五态中的空/加载/断网使用明确的网络故障注入',realQueries:receipts.length},null,2));
  console.log(JSON.stringify({checks:checks.length,citation,errors}));
  }
}catch(error){
  if(browser){await browser.page.screenshot({path:path.join(output,'browser-failure.png')});if(await browser.page.locator('.basis-toolbar').count())console.log(await browser.page.locator('.basis-toolbar').evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),children:[...el.children].map(x=>({text:x.textContent,rect:x.getBoundingClientRect().toJSON()})),scrollX:window.scrollX,scrollWidth:document.documentElement.scrollWidth})));}
  throw error;
}finally{
  try{await browser?.close();}finally{
    for(const child of owned.reverse()){
      if(child.exitCode===null&&child.signalCode===null){
        const exited=once(child,'exit');
        if(process.platform==='win32'){
          const cleanup=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          const [code]=await once(cleanup,'exit');assert.equal(code,0,'任务进程树未关闭');
        }else child.kill();
        await Promise.race([exited,pause(5000)]);assert.ok(child.exitCode!==null||child.signalCode!==null,'任务服务未退出');
      }
    }
    assert.ok(scratch.startsWith(path.join(root,'.tmp/standards-basis')+path.sep),'临时目录越界');
    await fs.rm(scratch,{recursive:true,force:true});
  }
}
