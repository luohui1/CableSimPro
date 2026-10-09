import { expect as playwrightExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, repositoryRoot, settle } from './browser.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('物理对比验收只允许独立测试数据库');
const base=process.env.FRONTEND_URL, output=path.join(repositoryRoot,'.data/hybrid/physics/browser');
await fs.mkdir(output,{recursive:true});
const expect=playwrightExpect.configure({timeout:30000});
const session=await openHeadlessBrowser(), {page}=session;
const checks=[],layouts=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function json(url,options){const r=await fetch(base+url,options);if(!r.ok)throw Error(url+': '+r.status+' '+await r.text());return r.json();}
async function choose(label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
async function layout(name,width,height){
  await page.setViewportSize({width,height});await settle(page);
  const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,
    minimum:Math.min(...[...document.querySelectorAll('.hybrid-study button,.hybrid-study td,.hybrid-study th,.hybrid-study p,.hybrid-study summary,.hybrid-study dt,.hybrid-study dd')].filter(e=>e.getBoundingClientRect().height>0).map(e=>parseFloat(getComputedStyle(e).fontSize)))}));
  if(state.overflow||state.minimum<13)throw Error('布局门禁失败 '+JSON.stringify(state));
  layouts.push({name,width,height,...state});await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
}
let wid,sid,rid,run;
try{
  await page.setViewportSize({width:1366,height:768});
  await page.goto(base+'/studies');await settle(page);
  await page.getByRole('button',{name:'新建研究',exact:true}).click();
  await choose('研究任务','混合载流量参考研究');
  await page.getByRole('textbox',{name:'研究名称',exact:true}).fill('标准与分层热场浏览器核验');
  const models=(await json('/api/model-artifacts')).filter(m=>m.availability==='available'&&m.family==='layered_soil');
  const model=models.sort((a,b)=>b.model_version.localeCompare(a.model_version,undefined,{numeric:true}))[0];
  if(!model)throw Error('缺少真实分层模型模板');
  await choose('引用训练模型',model.name+' · '+model.model_version);
  await page.getByRole('button',{name:'建立研究',exact:true}).click();
  await expect(page).toHaveURL(/\/hybrid\/results/);
  sid=/\/studies\/([^/]+)/.exec(page.url())[1];wid=new URL(page.url()).searchParams.get('workspace');
  await page.getByRole('link',{name:'方法对比',exact:true}).click();
  await page.getByRole('tab',{name:'输入差异',exact:true}).click();
  await choose('对比物理','热传导／分层土壤');
  await page.getByRole('button',{name:'采用物理对比',exact:true}).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('heading',{name:'标准与物理场对比',exact:true})).toBeVisible();checks.push('configure-save');
  await page.getByRole('tab',{name:'结果',exact:true}).click();
  await expect(page.getByText('尚无标准与物理场对比',{exact:true})).toBeVisible();checks.push('empty');
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);checks.push('escape-preflight');
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  await page.getByRole('checkbox',{name:'已核对适用范围，按已保存版本运行',exact:true}).check();
  await page.getByRole('button',{name:'确认并运行',exact:true}).dblclick();
  await expect(page.getByText('运行尚未完成',{exact:true})).toBeVisible({timeout:60000});checks.push('loading');
  const endpoint=`/api/workspaces/${wid}/studies/${sid}/runs`;
  for(let attempt=0;attempt<180;attempt++){
    const data=await json(endpoint);run=data.items.at(-1);rid=run?.id;
    if(run?.status==='succeeded')break;
    if(run?.status==='failed'||run?.status==='interrupted'){
      if(String(run.error?.code).startsWith('REMOTE_')){
        await page.getByRole('button',{name:'恢复原超算运行',exact:true}).click();
      }else throw Error(JSON.stringify(run.error||run.output?.cases));
    }
    if(attempt%12===0)console.log('物理对比超算状态 '+(run?.status||'pending'));
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  if(run?.status!=='succeeded')throw Error('物理对比未在等待窗口内完成，原运行保留');
  if((await json(endpoint)).items.length!==1)throw Error('重复点击生成了多个超算运行');checks.push('single-run');
  await page.reload();await expect(page.getByRole('table',{name:'标准与物理场结果'})).toBeVisible();
  const payload=run.output.cases[0].artifacts['x-cablesim.physics-comparison'];
  if(!payload.valid||!payload.solver.slurm_job_id)throw Error('缺少通过门禁的真实Slurm物理结果');
  await expect(page.getByRole('table',{name:'标准与物理场结果'})).toContainText('均匀土壤IEC对照');
  await expect(page.getByRole('table',{name:'标准与物理场结果'})).toContainText('两层土壤解析参照');checks.push('real-physics-success');
  await layout('comparison-1366',1366,768);await layout('comparison-1920',1920,1080);
  await page.getByRole('tab',{name:'证据',exact:true}).click();await expect(page.locator('.physics-evidence')).toContainText(payload.input_sha256);checks.push('provenance');
  await layout('evidence-1366',1366,768);
  const domain=await json(`/api/workspaces/${wid}/domain`);
  domain.document.sections[0].medium.surface_temperature+=1;
  await json(`/api/workspaces/${wid}/domain`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expected_revision:domain.revision,document:domain.document})});
  await page.reload();await expect(page.locator('.topbar .status-mark')).toContainText('已过期');checks.push('historical');
  await page.getByRole('tab',{name:'结果',exact:true}).click();await layout('history-1366',1366,768);
  // Real read transport failure must leave the saved server-side run intact.
  await page.route('**'+endpoint+'*',route=>route.abort('internetdisconnected'));
  await page.reload();await expect(page.getByRole('button',{name:'重新读取',exact:true})).toBeVisible();checks.push('read-error');
  await page.unroute('**'+endpoint+'*');await page.getByRole('button',{name:'重新读取',exact:true}).click();
  await expect(page.getByRole('table',{name:'标准与物理场结果'})).toBeVisible();checks.push('read-recovery');
  if(errors.length)throw Error(errors.join('; '));
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,layouts,errors,wid,sid,rid,slurmJobId:payload.solver.slurm_job_id,payload,run},null,2));
  console.log(JSON.stringify({checks,layouts,slurmJobId:payload.solver.slurm_job_id}));
}catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.message,wid,sid,rid,run,text:await page.locator('body').innerText()},null,2));throw error;}
finally{await session.close();}
