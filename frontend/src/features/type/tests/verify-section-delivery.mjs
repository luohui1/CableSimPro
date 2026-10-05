import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const expect=baseExpect.configure({timeout:25000}),fixture=await typeFixture({main:true}),{page,context}=fixture;
const result={layouts:[],screenshots:[],errors:fixture.errors};
async function visit(wid,width=1366,theme='light',suffix=''){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/structure/section?theme=${theme}${suffix}`);}
async function state(expected){await expect(page.locator('[data-type-page=structure]')).toHaveAttribute('data-type-state',expected);result.layouts.push({state:expected,...await checkLayout(page)});}
async function leaders(){
  await expect(page.locator('[data-layer-leader]')).toHaveCount(9);
  const crossed=await page.locator('[data-layer-leader]').evaluateAll(paths=>{
    const lines=paths.map(p=>{const n=p.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);return [[n[0],n[1]],[n[2],n[3]],[n[4],n[3]]];});
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const hits=[];for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++)for(let a=0;a<2;a++)for(let b=0;b<2;b++){
      const [p,q]=lines[i].slice(a,a+2),[r,s]=lines[j].slice(b,b+2);
      if(cross(p,q,r)*cross(p,q,s)<-1e-6&&cross(r,s,p)*cross(r,s,q)<-1e-6)hits.push([i,j]);
    }return hits;
  });expect(crossed).toEqual([]);
  expect(new Set(await page.locator('[data-label-core]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-label-core')))).size).toBe(1);
  const overlap=await page.locator('.drawing-layer-name').evaluateAll(nodes=>{const b=nodes.map(n=>n.getBoundingClientRect());return b.flatMap((a,i)=>b.slice(i+1).filter(c=>Math.min(a.right,c.right)-Math.max(a.left,c.left)>1&&Math.min(a.bottom,c.bottom)-Math.max(a.top,c.top)>1));});expect(overlap).toEqual([]);
}
async function shot(name){const p=path.join(output,'screenshots',name+'.png');await page.screenshot({path:p});result.screenshots.push(p);}
try{
  const models=await fixture.api('/api/design/cable-models'),model=models.find(m=>m.id==='system.specification-yjv22-300');
  const original=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256}),wid=original.id;
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await visit(wid,width,theme);await state('success');
    for(const [number,name] of [[1,'芯 1 · 导体'],[6,'芯 2 · 导体'],[11,'芯 3 · 导体']]){await page.getByRole('row',{name:`${number} ${name}`,exact:true}).click();await leaders();}
  }
  await visit(wid);await page.getByRole('row',{name:'1 芯 1 · 导体',exact:true}).click();await shot('three-core-readable');
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const kind of ['empty','loading','error']){
    const mask='**/api/workspaces/'+wid;await context.route(mask,async route=>{if(kind==='loading'){await new Promise(r=>setTimeout(r,2000));return route.continue();}if(kind==='error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'验收连接中断'})});const d=await(await route.fetch()).json();d.domain.cable_types=[];d.domain.circuits=[];return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d)});});
    await visit(wid,width,theme);await state(kind);await context.unroute(mask);
  }
  const sector=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256}),document=structuredClone(sector.domain);
  document.name='三芯扇形 · 几何示例';document.cable_types[0].label=document.name;
  document.cable_types[0].cores.forEach((core,i)=>{const angle=i*120;Object.assign(core,{x:.009*Math.cos(angle*Math.PI/180),z:.009*Math.sin(angle*Math.PI/180)});Object.assign(core.conductor,{form:'sectoral',diameter:.04,sector_angle_deg:120,sector_rotation_deg:angle});});
  await fixture.api('/api/workspaces/'+sector.id+'/domain','PUT',{expected_revision:sector.revision,document});
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await visit(sector.id,width,theme);await state('success');
    for(const number of [1,6,11]){await page.getByRole('row',{name:`${number} 芯 ${(number-1)/5+1} · 导体`,exact:true}).click();await leaders();await expect(page.locator('[data-cable-dimensions]')).toContainText('标称截面 300 mm²');await expect(page.locator('[data-cable-dimensions]')).toContainText('宽 34.6 × 高 20.0 mm');}
  }
  await visit(sector.id);await page.getByRole('row',{name:'1 芯 1 · 导体',exact:true}).click();await shot('sector-readable');
  const height=page.locator('.type-property-fields').getByRole('textbox',{name:'导体扇形高度',exact:true});await expect(height).toHaveValue('20.000');await height.fill('21');await height.press('Enter');await page.keyboard.press('Control+s');await expect(page.getByText('已保存型号草稿',{exact:true})).toBeVisible();
  const changed=await fixture.api('/api/workspaces/'+sector.id);expect(changed.domain.cable_types[0].cores[0].conductor.diameter).toBe(.042);expect(changed.domain.cable_types[0].cores[0].conductor.nominal_area).toBe(.0003);
  for(const width of [1366,1920])for(const theme of ['light','dark']){await visit(sector.id,width,theme,'&revision='+(sector.revision+1));await state('historical');}
  await page.goto(`${fixture.url}/types/${wid}/specification/preview?theme=light`);
  const downloaded=page.waitForEvent('download',{timeout:180000});downloaded.catch(()=>{});
  const generated=page.waitForResponse(r=>r.url().endsWith(`/api/types/${wid}/specification/generate`)&&r.request().method()==='POST',{timeout:180000});
  await page.getByRole('button',{name:'生成规格书',exact:true}).click();const body=await(await generated).json();expect(body.status,JSON.stringify(body)).toBe('generated');
  const pdf=path.join(output,'specification-yjv22-customer.pdf');await(await downloaded).saveAs(pdf);
  const spec=await fixture.api(`/api/types/${wid}/specification`),geometry=spec.payload.results.geometry.artifact;
  const copper=geometry.layers.filter(l=>l.role==='conductor').reduce((sum,l)=>sum+l.mass_kg_per_km,0);
  const handDiameter=2*(33/Math.sqrt(3)+16.5+.2+2+1.6+3.7),handCopper=3*300e-6*1.02*8900*1000;
  expect(geometry.outer_diameter_m*1000).toBeCloseTo(handDiameter,8);expect(copper).toBeCloseTo(handCopper,6);expect(spec.lifecycle.approval).toBeNull();
  result.handCheck={outerDiameterMm:geometry.outer_diameter_m*1000,handDiameterMm:handDiameter,copperKgPerKm:copper,handCopperKgPerKm:handCopper,totalKgPerKm:geometry.mass_kg_per_km};
  result.specification={file:pdf,digest:spec.digest};expect(fixture.errors).toEqual([]);
}catch(error){result.failure=String(error.stack||error);console.error(result.failure);console.error((await page.locator('body').innerText()).slice(-1800));process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'section-delivery-verification.json'),JSON.stringify(result,null,2));await fixture.close();}
