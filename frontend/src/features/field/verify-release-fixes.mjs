/** Repair regression against a fresh isolated release seed; no solver runs. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {openHeadlessBrowser,settle,repositoryRoot} from '../../../scripts/browser.mjs';
const out=pathToFileURL(path.resolve(process.env.SIM_FIX_EVIDENCE || path.join(repositoryRoot,'.data/fix-round/sim'))+path.sep);await fs.mkdir(out,{recursive:true});const session=await openHeadlessBrowser();const p=session.page;
const base=process.env.FRONTEND_URL || 'http://127.0.0.1:5193';const backend=process.env.BACKEND_URL || 'http://127.0.0.1:8129';assert(!['8100','8200'].includes(new URL(base).port),'Use an isolated service');const checks=[];let estimates=0;let configured=false;
const issues=[];p.on('pageerror',e=>issues.push(e.message));
try{
 const workspaces=await(await fetch(backend+'/api/workspaces')).json();const w=workspaces.find(x=>x.name.includes('城北'));
 const rows=await(await fetch(`${backend}/api/workspaces/${w.id}/studies`)).json();const s=rows.find(x=>x.definition.title.includes('有限元温度场'));
 await p.route('**/api/hpc/**/availability?*',r=>r.fulfill({json:{configured,location:'slurm',local_solver_allowed:false}}));
 await p.route('**/api/hpc/**/estimate?*',r=>r.fulfill({json:{budget_core_hours:4,node_limit:4000000}}));
 p.on('request',r=>{if(r.url().includes('/estimate?'))estimates++;});
 await p.route('**/preflight?*',r=>r.fulfill({json:{ready:false,cases:[{case_id:'case-0',status:'failed',error:{code:'INPUT_CONTRACT_VIOLATION',path:'/parameters/mesh/size_m',message:'/parameters/mesh/size_m：参数不符合所选封签契约（required）。'}}]}}));
 for(const width of [1366,1920])for(const theme of ['light','dark']){
  const beforeEstimates=estimates;
  configured=false;
  await p.setViewportSize({width,height:width===1366?768:1080});await p.emulateMedia({colorScheme:theme});
  const texts=[];
  for(const [tab,label] of [['results','结果'],['field','场图'],['samples','取样'],['diagnostics','诊断'],['convergence','收敛']]){
   await p.goto(`${base}/studies/${s.id}/thermal-field/${tab}?workspace=${w.id}&theme=${theme}`);await settle(p);await p.getByText('本方法不能在本机求解。',{exact:false}).waitFor();
   const body=await p.locator('body').innerText();texts.push(body);
   assert(body.includes('本方法不能在本机求解'),`${width}/${theme}/${tab}: compute guidance missing`);
   assert(body.includes(label+'：'),`${width}/${theme}/${tab}: tab guidance missing`);
   assert(!body.includes('超算预算不可用'));
   assert(await p.getByRole('button',{name:'预检并运行',exact:true}).isDisabled());
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'page overflow');
   checks.push({issue:'5/6/11',width,theme,tab,passed:true});
   if(theme==='light' && ['results','convergence'].includes(tab))await p.screenshot({path:fileURLToPath(new URL(`after-${width}-5-6-11-${tab}.png`,out))});
  }
  assert.equal(new Set(texts).size,5);
  assert.equal(estimates,beforeEstimates,'unconfigured methods must not estimate');
  configured=true;await p.reload();await settle(p);await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='预检并运行'&&!b.disabled));
  await p.getByRole('button',{name:'预检并运行',exact:true}).click();await p.waitForTimeout(1000);
  const dialog=p.getByRole('dialog');const body=await dialog.innerText();assert(!body.includes('/parameters'));assert(!body.includes('required'));assert(/(?:近场|局部)网格尺寸/.test(body));
  if(theme==='light')await p.screenshot({path:fileURLToPath(new URL(`after-${width}-7-preflight.png`,out))});
  const fix=dialog.getByRole('button',{name:/修正.*(?:近场|局部)网格尺寸/});await fix.click();await p.waitForFunction(()=>document.activeElement?.closest('[data-field-path]')?.getAttribute('data-field-path')==='/mesh/size_m',{timeout:12000});
  const focused=await p.evaluate(()=>document.activeElement?.closest('[data-field-path]')?.getAttribute('data-field-path'));
  assert.equal(focused,'/mesh/size_m');checks.push({issue:'7',width,theme,focus:focused,passed:true});
  if(theme==='light'){await p.waitForTimeout(500);await p.screenshot({path:fileURLToPath(new URL(`after-${width}-7-focused.png`,out))});}
  for(const id of ['cablesim.simulation','cablesim.hybrid-rating']){
   await p.goto(`${base}/plugins/${id}?theme=${theme}`);await settle(p);await p.waitForTimeout(800);
   const image=p.locator('.plugin-figure img').first();await image.waitFor();const box=await image.boundingBox();assert(box.width*22/560>=12,'diagram font below 12px');
   const svg=await(await fetch(new URL(await image.getAttribute('src'),base))).text();assert(!svg.includes('.py'));assert(!svg.includes('reference_only'));
   checks.push({issue:'shell19',width,theme,plugin:id,fontPx:box.width*22/560,passed:true});
   if(theme==='light')await p.screenshot({path:fileURLToPath(new URL(`after-${width}-shell19-${id}.png`,out))});
  }
  await p.goto(`${base}/validation?theme=${theme}`);await settle(p);await p.getByText('表1 c=1 双导线',{exact:false}).waitFor();
  assert(!(await p.locator('body').innerText()).includes('Table 1 c=1'));
  await p.getByText('二维磁准静态有限元与护套网络耦合',{exact:false}).waitFor();
  checks.push({issue:'16',width,theme,passed:true});
  if(theme==='light')await p.screenshot({path:fileURLToPath(new URL(`after-${width}-16.png`,out))});
  await p.goto(`${base}/validation/B02-2/results?theme=${theme}`);await settle(p);
  await p.getByText('TB 880 算例 0-2 · 报告涡流口径',{exact:false}).waitFor();
  assert(!(await p.locator('body').innerText()).includes('tb880-case-0-2-eddy-gp31'));
  checks.push({issue:'16',width,theme,tab:'results',passed:true});
  if(theme==='light')await p.screenshot({path:fileURLToPath(new URL(`after-${width}-16-results.png`,out))});
 }
 assert.equal(issues.length,0,issues.join('\n'));
 await fs.writeFile(new URL('browser-checks.json',out),JSON.stringify({checks,estimates,issues},null,2));
 console.log(JSON.stringify({passed:checks.length,estimates}));
}catch(error){console.log((await p.locator('body').innerText()).slice(-2200));await p.screenshot({path:fileURLToPath(new URL('after-failure.png',out))});throw error;}finally{await session.close();}
