import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const expect=baseExpect.configure({timeout:25000}),fixture=await typeFixture({main:true}),{page,context}=fixture;
const result={workflows:[],layouts:[],screenshots:[],geometry:[],errors:fixture.errors};
let wid;
async function visit(tab='section',width=1366,theme='light',query=''){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/structure/${tab}?theme=${theme}${query}`);}
async function state(expected){await expect(page.locator('[data-type-page=structure]')).toHaveAttribute('data-type-state',expected);result.layouts.push({page:'structure',state:expected,...await checkLayout(page)});}
async function shot(name){await page.evaluate(()=>document.fonts.ready);const filename=path.join(output,'screenshots',name+'.png');await page.screenshot({path:filename});result.screenshots.push(filename);}
async function cad(){await expect(page.locator('.cad-viewport')).toHaveAttribute('aria-busy','false',{timeout:120000});await expect(page.locator('.cad-viewport')).toHaveAttribute('data-cad-state','success');await expect(page.locator('.cad-canvas-host canvas')).toBeVisible();}
async function select(label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
page.on('response',async response=>{if(response.url().endsWith('/geometry-preview')&&response.ok()){const body=await response.json().catch(()=>null),model=body?.artifacts?.['x-cablesim.cad-model'];if(model)result.geometry.push({digest:model.input_sha256,diameter:model.outer_diameter_m,layers:model.layers.map(row=>({entity:row.entity,source:row.source_target,peel:row.peel_fraction,profile:row.section_profile.outer.kind}))});}});
try{
  const models=await fixture.api('/api/design/cable-models'),model=models.find(m=>m.id==='system.specification-yjv22-300');expect(model).toBeTruthy();
  const initial=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256});wid=initial.id;
  await visit();await state('success');
  await expect(page.locator('.drawing-ring')).toHaveCount(19);
  const labels=await page.locator('.drawing-layer-name').allTextContents();expect(labels).toHaveLength(9);expect(labels.filter(label=>label==='导体')).toHaveLength(1);expect(labels).toContain('铠装');
  await page.getByRole('row',{name:'8 芯 2 · 绝缘',exact:true}).click();
  await expect(page.locator('.type-property-fields').getByRole('textbox',{name:'绝缘厚度',exact:true})).toHaveValue('4.500');
  await shot('multicore-section');
  await page.getByRole('tab',{name:'三维剥切',exact:true}).click();await cad();
  expect(result.geometry.at(-1).layers).toHaveLength(19);
  const conductors=result.geometry.at(-1).layers.filter(row=>row.source.role==='conductor');expect(conductors).toHaveLength(3);expect(new Set(conductors.map(row=>row.peel)).size).toBe(1);
  expect(new Set(conductors.map(row=>row.source.core_id)).size).toBe(3);
  await expect(page.locator('[data-cad-layer-label]')).toContainText('芯 2');
  await shot('multicore-three');
  await page.getByRole('button',{name:'端面',exact:true}).click();await expect(page.locator('.cad-viewport')).toHaveAttribute('data-cad-view','end');
  result.workflows.push('三芯19层真实CAD、独立芯身份、同层剥切长度与二维/三维选层联动');

  const specificationWid=wid;
  async function generateSpecification(){
    const wid=specificationWid;
  await page.goto(`${fixture.url}/types/${wid}/specification/preview?theme=light`);
  const download=page.waitForEvent('download',{timeout:180000});download.catch(()=>{});
  const generated=page.waitForResponse(response=>response.url().endsWith(`/api/types/${wid}/specification/generate`)&&response.request().method()==='POST',{timeout:180000});
  await page.getByRole('button',{name:'生成规格书',exact:true}).click();
  const response=await generated,body=await response.json();expect(body.status,JSON.stringify(body)).toBe('generated');
  const file=path.join(output,'specification-yjv22-customer.pdf');await (await download).saveAs(file);
  const specification=await fixture.api(`/api/types/${wid}/specification`);await fs.writeFile(path.join(output,'specification-yjv22-source.json'),JSON.stringify(specification));
  expect(specification.lifecycle.approval).toBeNull();expect(specification.ready).toBe(false);
  for(const channel of ['geometry','electrical','short_circuit','rating','standards'])expect(specification.payload.results[channel]).toBeTruthy();
  for(const row of specification.payload.results.rating.rows){expect(row.condition.rating_basis).toBe('simultaneous');if(row.condition.circuit_count>1)expect(row.condition.rating_basis_name).toBe('全回路等负荷允许电流');}
  const geometry=specification.payload.results.geometry;result.specification={file,digest:specification.digest,geometry};
  const current=await fixture.api('/api/workspaces/'+wid);expect(current.domain).toEqual(initial.domain);expect(current.domain.measurements).toEqual([]);
  result.workflows.push('YJV22五项当前真实运行、客户PDF下载、原始输入不变且未生成实测或批准记录');
  }

  await visit();await page.getByRole('row',{name:'19 外护套',exact:true}).click();
  await page.locator('.type-property-fields').getByRole('textbox',{name:'外护套厚度',exact:true}).fill('3.800');
  await page.locator('.type-property-fields').getByRole('textbox',{name:'外护套厚度',exact:true}).press('Enter');
  await page.getByRole('button',{name:'添加结构层',exact:true}).click();
  await select('所属位置','共同层');await select('结构层','隔离层');await select('新层材料','聚氯乙烯');
  await page.getByRole('textbox',{name:'新层厚度',exact:true}).fill('0.200');await page.getByRole('textbox',{name:'新层厚度',exact:true}).press('Tab');
  await select('新层构造','挤包或连续层');await page.getByRole('button',{name:'添加到草稿',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('.drawing-ring')).toHaveCount(20);
  await page.getByRole('row',{name:'20 外护套',exact:true}).click();
  await expect(page.locator('.type-property-fields').getByRole('textbox',{name:'外护套厚度',exact:true})).toHaveValue('3.800');
  await page.getByRole('button',{name:'撤销',exact:true}).focus();await page.keyboard.press('Control+z');await expect(page.locator('.drawing-ring')).toHaveCount(19);
  await page.getByRole('button',{name:'添加线芯',exact:true}).click();await page.getByRole('textbox',{name:'新芯位置 x',exact:true}).fill('0');await page.getByRole('textbox',{name:'新芯位置 x',exact:true}).press('Tab');
  await page.getByRole('textbox',{name:'新芯位置 z',exact:true}).fill('0');await page.getByRole('textbox',{name:'新芯位置 z',exact:true}).press('Tab');
  await page.getByRole('button',{name:'添加到草稿',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('重叠');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'添加线芯',exact:true}).click();await page.getByRole('textbox',{name:'新芯位置 x',exact:true}).fill('60');await page.getByRole('textbox',{name:'新芯位置 x',exact:true}).press('Tab');
  await page.getByRole('textbox',{name:'新芯位置 z',exact:true}).fill('0');await page.getByRole('textbox',{name:'新芯位置 z',exact:true}).press('Tab');await page.getByRole('button',{name:'添加到草稿',exact:true}).click();
  await page.keyboard.press('Control+s');await expect(page.getByText('已保存型号草稿',{exact:true})).toBeVisible();
  const four=await fixture.api('/api/workspaces/'+wid);expect(four.domain.cable_types[0].cores).toHaveLength(4);expect(four.domain.cable_types[0].construction).toBe('multi_core');
  await page.getByRole('button',{name:'撤销',exact:true}).focus();await page.keyboard.press('Control+z');await expect(page.getByText('已恢复上一份型号输入',{exact:true})).toBeVisible();
  expect((await fixture.api('/api/workspaces/'+wid)).domain.cable_types[0].cores).toHaveLength(3);
  result.workflows.push('添加层/线芯、重叠拒绝、Enter、Esc、Ctrl+S与保存前后Ctrl+Z');

  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await visit('section',width,theme);await state('success');
    const overlappingLabels=await page.locator('.drawing-layer-name').evaluateAll(nodes=>{const boxes=nodes.map(n=>n.getBoundingClientRect());return boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));});expect(overlappingLabels).toEqual([]);
    await visit('table',width,theme);await state('success');
    await visit('three',width,theme);await cad();await state('success');
    await visit('section',width,theme,'&revision='+initial.revision);await state('historical');await expect(page.getByRole('button',{name:'添加线芯',exact:true})).toBeDisabled();
    for(const kind of ['empty','loading','error']){
      const mask='**/api/workspaces/'+wid;await context.route(mask,async route=>{if(kind==='loading'){await new Promise(resolve=>setTimeout(resolve,2000));return route.continue();}if(kind==='error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'验收连接中断'})});const data=await(await route.fetch()).json();data.domain.cable_types=[];data.domain.circuits=[];return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
      await visit('section',width,theme);await state(kind);await context.unroute(mask);
    }
  }

  const sector=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256}),sectorDoc=structuredClone(sector.domain);
  sectorDoc.name='三芯扇形 · 几何构造示例';sectorDoc.cable_types[0].label=sectorDoc.name;
  for(let i=0;i<3;i++){const core=sectorDoc.cable_types[0].cores[i],angle=i*120;Object.assign(core,{x:.009*Math.cos(angle*Math.PI/180),z:.009*Math.sin(angle*Math.PI/180)});Object.assign(core.conductor,{form:'sectoral',diameter:.04,sector_angle_deg:120,sector_rotation_deg:angle});
    const root='/cable_types/cable_type~1ct1/cores/'+core.id.replaceAll('/','~1');for(const tail of ['/x','/z','/conductor/form','/conductor/diameter','/conductor/sector_angle_deg','/conductor/sector_rotation_deg'])sectorDoc.provenance[root+tail]={kind:'demo',reference:'扇形几何教学输入：圆弧半径20 mm、夹角120°、圆心偏移9 mm；非厂家结构或电气计算适用性声明。',reviewed:false};}
  await fixture.api('/api/workspaces/'+sector.id+'/domain','PUT',{expected_revision:sector.revision,document:sectorDoc});wid=sector.id;
  await visit();await state('success');await expect(page.locator('.drawing-ring[data-profile-kind=sector]')).toHaveCount(15);await shot('sector-section');
  await page.getByRole('button',{name:'选择层号 1 芯 1 · 导体',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('tab',{name:'三维剥切',exact:true}).click();await cad();await shot('sector-three');
  expect(result.geometry.at(-1).layers.filter(row=>row.profile==='sector')).toHaveLength(15);result.workflows.push('三个扇形芯、真实平行层/铜带包络、圆弧角度与三维原生显示');

  const single=models.find(m=>m.id==='system.specification-cu-xlpe-al-400');
  const work=await fixture.api('/api/design/study-workspaces','POST',{model_id:single.id,content_sha256:single.content_sha256});
  const methods=await fixture.api('/api/methods'),method=methods.find(row=>row.method.plugin_id==='cablesim.cable-geometry');
  const study=await fixture.api(`/api/workspaces/${work.id}/studies`,'POST',{expected_revision:work.revision,title:'地下敷设CAD回归',input_source:'domain',method:{...method.method,capability:'installation-scene'},parameters:{section_id:work.domain.sections[0].id}});
  for(const kind of ['trefoil','ducts','backfill']){
    const saved=await fixture.api('/api/workspaces/'+work.id),d=await fixture.api(`/api/design/workspaces/${work.id}/section-template`,'POST',{expected_revision:saved.revision,document:saved.domain,kind});
    await fixture.api('/api/workspaces/'+work.id+'/domain','PUT',{expected_revision:saved.revision,document:d});
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/studies/${study.id}/section/three-dimensional?workspace=${work.id}&theme=${theme}`);await cad();result.layouts.push({page:'installation',kind,...await checkLayout(page)});}
    if(kind!=='trefoil'){await page.setViewportSize({width:1366,height:768});await page.goto(`${fixture.url}/studies/${study.id}/section/three-dimensional?workspace=${work.id}&theme=light`);await cad();await shot('installation-'+kind);}
  }
  result.workflows.push('地下单芯接触直埋、排管和回填生产页面原生场景');
  if(process.env.TYPE_E2E_UI_ONLY!=='1')await generateSpecification();
  expect(fixture.errors).toEqual([]);
}catch(error){result.failure=String(error.stack||error);result.backendLog=fixture.log();console.error(result.failure);console.error(page.url());console.error((await page.locator('body').innerText()).slice(0,3500));await shot('multicore-failure').catch(()=>{});process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'multicore-verification.json'),JSON.stringify(result,null,2));await fixture.close();}
