import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { openHeadlessBrowser, settle } from '../../../../scripts/browser.mjs';
import { assertLayout } from '../../../../scripts/layout-assertions.mjs';

const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const output=path.join(root,'.data/standards-basis');
const owned=[];let browser;let logs='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const p=server.address().port;await new Promise(r=>server.close(r));return p;}
function start(command,args,options={}){const child=spawn(command,args,{cwd:root,windowsHide:true,...options});owned.push(child);child.stderr?.on('data',x=>logs+=String(x));return child;}
async function ready(url,child){for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(url)).ok)return;}catch{}await pause(250);}throw Error('启动超时 '+url+' '+logs);}
async function choose(page,label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
const checks=[];
try{
  await fs.mkdir(output,{recursive:true});
  const apiPort=await port(),uiPort=await port();
  const python=process.env.PYTHON||'python';
  const backend=start(python,['-m','uvicorn','frontend.src.features.standards.tests.serve:app','--host','127.0.0.1','--port',String(apiPort)],{stdio:['ignore','ignore','pipe']});
  await ready(`http://127.0.0.1:${apiPort}/api/health`,backend);
  const preview=start(process.execPath,[path.join(root,'frontend/node_modules/vite/bin/vite.js'),'preview','--outDir',path.join(output,'frontend'),'--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{cwd:path.join(root,'frontend'),env:{...process.env,BACKEND_URL:`http://127.0.0.1:${apiPort}`},stdio:['ignore','ignore','pipe']});
  const url=`http://127.0.0.1:${uiPort}`;await ready(url,preview);
  browser=await openHeadlessBrowser({executable:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});const {page,context}=browser;page.setDefaultTimeout(15000);await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
  await page.setViewportSize({width:1366,height:768});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));console.log('Own isolated services ready',apiPort,uiPort);
  await page.goto(url+'/resources/standards');await page.locator('[data-page="standards-basis"][data-state="success"]').waitFor();
  await page.getByRole('table',{name:'标准完整表格'}).waitFor();await settle(page);
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
    if(theme==='light')await page.screenshot({path:path.join(output,`browser-after-${size.width}.png`)});
    if(theme==='light'&&size.width===1366)await page.screenshot({path:path.join(output,'browser.png')});
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
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'browser-checks.json'),JSON.stringify({checks,citation,thirdBatchTolerance:true,thirdBatchFormula:true,scope:'已挂载通用只读查询路由；本脚本经隔离真实Executor验收，不写演示库'},null,2));
  console.log(JSON.stringify({checks:checks.length,citation,errors}));
  }
}catch(error){
  if(browser){await browser.page.screenshot({path:path.join(output,'browser-failure.png')});if(await browser.page.locator('.basis-toolbar').count())console.log(await browser.page.locator('.basis-toolbar').evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),children:[...el.children].map(x=>({text:x.textContent,rect:x.getBoundingClientRect().toJSON()})),scrollX:window.scrollX,scrollWidth:document.documentElement.scrollWidth})));}
  throw error;
}finally{
  try{await browser?.close();}finally{
    for(const child of owned.reverse()){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await Promise.race([exited,pause(5000)]);assert.ok(child.exitCode!==null||child.signalCode!==null,'任务服务未退出');}}
  }
}
