import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';

async function textContrast(page){
  const failures=await page.evaluate(()=>{
    const rgba=color=>{const n=color.match(/[\d.]+/g)?.map(Number)||[];return n.length>=3?[...n.slice(0,3),n[3]??1]:[0,0,0,0];};
    const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat(1);
    const bg=node=>!node?[255,255,255,1]:rgba(getComputedStyle(node).backgroundColor)[3]===1?rgba(getComputedStyle(node).backgroundColor):over(rgba(getComputedStyle(node).backgroundColor),bg(node.parentElement));
    const lum=a=>a.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('.type-root button,.type-root label,.type-root td,.type-root p,.type-root span')].filter(n=>n.checkVisibility()&&!n.children.length&&n.textContent.trim()&&!n.closest('svg,[disabled],[data-disabled],[aria-hidden=true]')&&+getComputedStyle(n).opacity===1).flatMap(n=>{const background=bg(n),a=lum(over(rgba(getComputedStyle(n).color),background)),b=lum(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);return ratio<4.48?[{text:n.textContent.trim(),ratio}]:[];});
  });
  assert.deepEqual(failures,[],'Readable text contrast');
}

// One page and a private read-only backup of release inputs; never write the demo.
const stage=process.argv.includes('--before')?'before':'after';
const drawingOnly=process.argv.includes('--drawing');
const statesOnly=process.argv.includes('--states');
const interactionsOnly=process.argv.includes('--interactions');
const output=path.join(root,'.data/fix-round/3d'),capture=path.join(output,stage);
await fs.mkdir(capture,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/release/engineering.sqlite');
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
const results={stage,pages:[],interactions:[],errors:fixture.errors,runtime:fixture.runtime};
try {
  const types=await fixture.api('/api/design/type-workspaces');
  const qf=types.find(t=>t.name.startsWith('起帆')),mv=types.find(t=>t.name.startsWith('YJV22'));
  assert.ok(qf&&mv,'Two real demo designs');
  const targets=[{name:'type-list',route:'/types',issues:['type-7','type-21','type-24']}];
  for(const [kind,type] of [['qf',qf],['yjv',mv]])for(const [module,tab,issues] of [
    ['structure','table',['type-8','type-15','type-21','type-22','type-23']],
    ['structure','three',['type-3','type-4','type-16','sim-1','sim-3']],
    ['electrical','parameters',['type-6','type-12','type-13','type-14']],
    ['requirements','standards',['type-7','type-14','type-22']],
    ['rating-table','results',['type-5','type-8','type-10']],
    ['comparison','matrix',['type-24']],
    ['specification','content',['type-9']],
    ['specification','review',['type-20']],
  ])targets.push({name:`${kind}-${module}-${tab}`,route:`/types/${type.id}/${module}/${tab}`,issues});
  for(const workspace of await fixture.api('/api/workspaces')){
    if(!/110 kV 直埋|三回排管/.test(workspace.name))continue;
    const studies=await fixture.api(`/api/workspaces/${workspace.id}/studies`),study=studies.find(s=>s.latest_run_id&&s.definition.method.plugin_id==='cablesim.iec60287');
    if(!study)continue;
    const run=await fixture.api(`/api/workspaces/${workspace.id}/studies/${study.id}/runs/${study.latest_run_id}`);
    const hasField=run.output.cases.some(c=>c.artifacts?.['x-cablesim.temperature-field']);
    for(const view of ['section','cable','three'])targets.push({name:`${workspace.name.includes('110')?'buried':'duct'}-${view}`,hasField,route:`/studies/${study.id}?workspace=${workspace.id}&view=${view}`,issues:view==='three'?['sim-1','sim-2','sim-22','study-31']:['study-10','study-21','study-22']});
  }
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const target of targets){
    if(statesOnly||interactionsOnly)continue;
    if(drawingOnly&&!/^(buried|duct)-/.test(target.name))continue;
    if(process.argv.includes('--smoke')&&(width!==1366||!['qf-structure-three','yjv-structure-table','yjv-structure-three','qf-electrical-parameters','qf-specification-content','buried-three','buried-section','duct-section'].includes(target.name)))continue;
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(fixture.url+target.route+(target.route.includes('?')?'&':'?')+'theme='+theme,{waitUntil:'domcontentloaded'});
    await page.locator('.work-panel').waitFor();
    await page.locator('.type-root,.type-page,.study-workspace').first().waitFor({timeout:15000}).catch(()=>{});
    await page.evaluate(()=>document.fonts.ready);
    if(target.route.endsWith('/three')||target.route.includes('view=three'))await expect(page.locator('[data-cad-ready=true]')).toBeVisible({timeout:20000});
    const observations=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1,canvases:document.querySelectorAll('canvas').length,ready:!!document.querySelector('[data-cad-ready=true]')}));
    if(stage==='after'){
      assert.equal(observations.overflow,false,target.name+' stays in viewport');
      assert.ok(!/core\/1\.layers|添加宿主工况|采用宿主工况|尚无要求目录.*执行版本|cable_type\/ct1/.test(observations.text),target.name+' readable labels');
      if(target.route.endsWith('/three')||target.route.includes('view=three'))assert.ok(observations.ready,target.name+' rendered in software WebGL');
      if(observations.ready){
        const canvas=page.locator('.cad-canvas-host canvas').first();
        const pixels=await page.evaluate(async base64=>{const picture=new Image();picture.src='data:image/png;base64,'+base64;await picture.decode();const c=document.createElement('canvas');c.width=picture.width;c.height=picture.height;const ctx=c.getContext('2d');ctx.drawImage(picture,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let bright=0,colored=0;for(let i=0;i<p.length;i+=4){if(Math.max(p[i],p[i+1],p[i+2])>100)bright++;if(Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])>24)colored++;}return {bright,colored,total:p.length/4};},(await canvas.screenshot()).toString('base64'));
        assert.ok(pixels.bright>pixels.total*.01,target.name+' has visible lit geometry');assert.ok(pixels.colored>25,target.name+' has material or temperature color');observations.pixels=pixels;
      }
      if(target.name.endsWith('electrical-parameters')){await expect(page.getByRole('button',{name:'试算',exact:true})).toBeVisible();await expect(page.getByText('电缆结构',{exact:true}).first()).toBeVisible();}
      if(target.name.endsWith('specification-content')){const bounds=await page.locator('iframe').boundingBox();assert.ok(bounds.width>480,'Readable full-width specification');}
      if(target.name.endsWith('structure-three')){await expect(page.locator('.cad-layer-list')).toBeVisible();if(target.name.startsWith('qf'))await expect(page.getByText('波纹按等效厚度显示',{exact:false})).toBeVisible();}
      if(target.name.endsWith('structure-table')){const material=page.locator('.type-resource-cell').first(),bounds=await material.boundingBox();assert.ok(bounds.width>170,'Material column has space');const input=page.getByRole('table',{name:'型号分层',exact:true}).locator('.number-input').first();await expect(input).toBeVisible();const b=await input.boundingBox();assert.ok(b.width>=132&&b.x+b.width<=width,'Dimension digits and unit are visible');}
      if(drawingOnly&&target.name.endsWith('-section')){const diameters=await page.locator('[data-section-object^="cable/"] .drawing-hit-area').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));assert.ok(diameters.length>=3&&Math.min(...diameters)>=24,'All cable diameters remain legible in a short canvas');observations.cableDiameters=diameters;if(target.hasField)await expect(page.locator('[data-cad-field-ready=true]')).toBeVisible({timeout:15000});else{await expect(page.getByText('尚无土壤温度场',{exact:true})).toBeVisible();assert.equal(await page.locator('[data-cad-field-ready]').count(),0,'Missing saved field is never fabricated');}assert.equal(await page.getByLabel('温度色标',{exact:true}).count(),1,'One color scale for the saved temperatures');}
    }
    const image=path.join(capture,`${target.name}-${width}-${theme}.png`);await page.screenshot({path:image});
    results.pages.push({...target,width,theme,image,...observations});
    console.log(`${stage}: ${target.name} ${width} ${theme}`);
  }
  await page.setViewportSize({width:1366,height:768});
  if(statesOnly){
    const source=await fixture.api(`/api/workspaces/${qf.id}`);let fault='success',release;
    await page.route('**/api/workspaces/'+qf.id,async route=>{if(route.request().method()!=='GET')return route.continue();if(fault==='loading')await new Promise(resolve=>{release=resolve;});if(fault==='error')return route.fulfill({status:503,json:{detail:'型号输入暂时不可用，请重新读取。'}});if(fault==='empty'){const empty=structuredClone(source);empty.domain.cable_types=[];empty.domain.circuits=[];empty.domain.sections=[];empty.domain.load_cases=[];return route.fulfill({json:empty});}return route.continue();});
    for(const width of [1366,1920])for(const theme of ['light','dark'])for(const state of ['loading','empty','error','success','historical']){
      fault=state;await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${qf.id}/structure/section?theme=${theme}${state==='historical'?'&revision='+source.revision:''}`,{waitUntil:'domcontentloaded'});
      try{await expect(page.locator('[data-type-page=structure]')).toHaveAttribute('data-type-state',state,{timeout:20000});const checks=await page.evaluate(()=>{const zones=['.topbar','.command-bar','.work-body>.project-explorer','.work-body>.workbench','.work-body>.type-design-card','.work-body>.type-property-wrapper'].map(s=>document.querySelector(s)?.getBoundingClientRect()).filter(Boolean),overlap=[];for(let i=0;i<zones.length;i++)for(let j=i+1;j<zones.length;j++){const a=zones[i],b=zones[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([i,j]);}const fonts=[...document.querySelectorAll('.type-root button,.type-root label,.type-root p,.type-root td')].filter(n=>n.checkVisibility()&&n.textContent.trim()).map(n=>parseFloat(getComputedStyle(n).fontSize));return {overlap,overflow:document.documentElement.scrollWidth>innerWidth+1,font:Math.min(...fonts)};});assert.equal(checks.overflow,false);assert.deepEqual(checks.overlap,[]);assert.ok(checks.font>=13);await textContrast(page);results.interactions.push({name:'presentation-state',state,width,theme,...checks});}finally{release?.();release=undefined;}
    }
    await page.unroute('**/api/workspaces/'+qf.id);
  }
  if(stage==='after'&&!process.argv.includes('--smoke')&&!drawingOnly&&!statesOnly){
    await page.goto(`${fixture.url}/types/${qf.id}/electrical/parameters?theme=light`);const original=await fixture.api(`/api/workspaces/${qf.id}`),studies=await fixture.api(`/api/workspaces/${qf.id}/studies`);
    await page.getByRole('button',{name:'试算',exact:true}).click();await expect(page.getByRole('region',{name:'试算结果'})).toBeVisible({timeout:20000});
    assert.equal((await fixture.api(`/api/workspaces/${qf.id}`)).revision,original.revision,'Trial never saves inputs');assert.equal((await fixture.api(`/api/workspaces/${qf.id}/studies`)).length,studies.length,'Trial never creates studies');results.interactions.push({name:'real-plugin-parameter-preview',unchangedRevision:true});
    const section=targets.find(t=>t.name==='buried-section');if(section){await page.goto(fixture.url+section.route+'&theme=light');const object=page.locator('[data-section-object^="cable/"]').first();await expect(object).toBeVisible();await object.click({button:'right',force:true});await expect(page.getByRole('menuitem',{name:'适配敷设截面'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('[data-section-object^="cable/"][aria-pressed=true] .drawing-selection')).toBeVisible();await object.dblclick({force:true});await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');results.interactions.push({name:'section-context-and-dimension-edit',cancelled:true});}
  }
  for(const width of process.argv.includes('--smoke')||drawingOnly||statesOnly?[]:[1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(`${fixture.url}/types?create=1&theme=${theme}`);const dialog=page.getByRole('dialog',{name:'新建型号设计'});await expect(dialog).toBeVisible();
    for(const [name,label] of [['copy','从型号库复制'],['import','从资料导入'],['standard','按标准生成'],['blank','空白']]){
      await dialog.getByText(label,{exact:true}).click();await expect(dialog.getByRole('radio',{name:label})).toBeChecked();
      const text=await dialog.innerText();results.interactions.push({name,width,theme,text});
      if(stage==='after'&&name==='copy'){await dialog.getByRole('combobox',{name:'型号版本',exact:true}).click();const options=page.getByRole('option');assert.ok(await options.count()>=12,'Copy includes all fixed library versions');await page.keyboard.press('Escape');await dialog.getByRole('searchbox',{name:'查找型号版本'}).fill('YJV22');await dialog.getByRole('combobox',{name:'型号版本',exact:true}).click();assert.ok(await options.count()>0,'Version search finds a real cable');await page.keyboard.press('Escape');await dialog.getByRole('searchbox',{name:'查找型号版本'}).fill('');}
      await page.screenshot({path:path.join(capture,`create-${name}-${width}-${theme}.png`)});
    }
    await page.keyboard.press('Escape');
    await page.goto(`${fixture.url}/types/${qf.id}/rating-table/results?theme=${theme}`);await page.getByRole('button',{name:'添加工况',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
    results.interactions.push({name:'rating-condition',width,theme,text:await page.getByRole('dialog').innerText()});await page.screenshot({path:path.join(capture,`rating-dialog-${width}-${theme}.png`)});await page.keyboard.press('Escape');
  }
}catch(error){await page.screenshot({path:path.join(capture,'failure.png')}).catch(()=>{});results.failure=String(error.stack||error);results.backendLog=fixture.log();console.error(results.failure);process.exitCode=1;}
finally{await fixture.close();results.closed=true;await fs.writeFile(path.join(output,`${stage}${drawingOnly?'-drawing':statesOnly?'-states':interactionsOnly?'-interactions':''}.json`),JSON.stringify(results,null,2));}
console.log(JSON.stringify({stage,pages:results.pages.length,interactions:results.interactions.length,closed:results.closed}));
