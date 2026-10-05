import {expect as playwrightExpect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,repositoryRoot,settle} from './browser.mjs';

if(process.env.E2E_ISOLATED!=='1')throw Error('只允许独立验收数据库');
const base=process.env.FRONTEND_URL;
if(!base)throw Error('需要明确指定本任务预览地址');
const output=path.join(repositoryRoot,'.data/hybrid/browser');
const expect=playwrightExpect.configure({timeout:20000});
const session=await openHeadlessBrowser();const {page}=session;
const checks=[];const errors=[];
page.on('pageerror',error=>errors.push(error.message));
async function json(endpoint){const response=await fetch(base+endpoint);if(!response.ok)throw Error(endpoint+': '+response.status);return response.json();}
async function choose(label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
try{
  for(const family of ['direct_double','duct','backfill']){
    const model=(await json('/api/model-artifacts')).filter(value=>value.family===family&&value.availability==='available').sort((a,b)=>b.model_version.localeCompare(a.model_version,undefined,{numeric:true}))[0];
    if(!model)throw Error(family+' 缺少真实训练模型');
    await page.goto(base+'/studies');await settle(page);
    await page.getByRole('button',{name:'新建研究',exact:true}).click();
    await choose('研究任务','混合载流量参考研究');
    await page.getByRole('textbox',{name:'研究名称',exact:true}).fill('浏览器混合场景 '+family);
    await choose('引用训练模型',model.name+' · '+model.model_version);
    await page.getByRole('button',{name:'建立研究',exact:true}).click();
    await expect(page).toHaveURL(/\/hybrid\/results/);
    const wid=new URL(page.url()).searchParams.get('workspace');const sid=/\/studies\/([^/]+)/.exec(page.url())[1];
    if(family==='direct_double'||family==='backfill'){
      const label=family==='direct_double'?'邻回负荷':'回填热阻率';
      const input=page.getByRole('textbox',{name:label,exact:true});
      const original=Number(await input.inputValue());
      const amended=family==='direct_double'?original+(original<165?.5:-.5):original+(original<1.3?.01:-.01);
      await input.fill(amended.toFixed(family==='direct_double'?2:3));await input.press('Enter');await page.keyboard.press('Control+s');
      await expect(page.getByRole('button',{name:'预测',exact:true})).toBeEnabled();
      const saved=await json('/api/workspaces/'+wid+'/domain');
      const document=saved.document;
      const actual=family==='direct_double'?document.load_cases[0].currents[document.circuits[1].id]:document.materials.find(value=>value.id===document.sections[0].backfill.material).thermal_resistivity;
      if(Math.abs(actual-amended)>1e-6)throw Error(label+'未保存到实际SI工况');
    }
    await page.getByRole('button',{name:'预测',exact:true}).click();
    await expect(page.getByRole('table',{name:'混合预测结果'})).toBeVisible({timeout:60000});
    const run=(await json(`/api/workspaces/${wid}/studies/${sid}/runs`)).items.at(-1);
    const prediction=run.output.cases[0].artifacts['x-cablesim.hybrid-prediction'];
    if(prediction.family!==family||prediction.model_sha256!==model.model_sha256||prediction.authority!=='reference_only'||prediction.engineering_approval!==false)throw Error('预测来源或工程边界不一致');
    const layouts=[];
    for(const [width,height]of [[1366,768],[1920,1080]]){
      await page.setViewportSize({width,height});await settle(page);
      const layout=await page.evaluate(()=>{
        const fields=[...document.querySelectorAll('.hybrid-inputs .number-field')];
        return {overflow:document.documentElement.scrollWidth>innerWidth,
          minimumFont:Math.min(...[...document.querySelectorAll('.hybrid-study label,.hybrid-study th,.hybrid-study td')].map(element=>parseFloat(getComputedStyle(element).fontSize))),
          overlap:fields.some((element,i)=>fields.slice(i+1).some(other=>{const a=element.getBoundingClientRect(),b=other.getBoundingClientRect();return a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;}))};
      });
      if(layout.overflow||layout.overlap||layout.minimumFont<13)throw Error('场景布局门禁失败：'+JSON.stringify(layout));
      layouts.push({width,height,...layout});await page.screenshot({path:path.join(output,family+'-'+width+'.png'),fullPage:true});
    }
    checks.push({family,workspaceId:wid,studyId:sid,runId:run.id,modelSha256:model.model_sha256,layouts});
  }
  if(errors.length)throw Error(errors.join('; '));
  await fs.writeFile(path.join(output,'family-verification.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors}));
}finally{await session.close();}
