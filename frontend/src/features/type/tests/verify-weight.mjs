import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { expect as baseExpect } from '@playwright/test';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

// Actual released library backup + host + OCCT plugin; one page, no approved mocks.
process.env.E2E_DATABASE_SOURCE ||= path.join(root, '.data/release/engineering.sqlite');
const output=path.join(root,'.data/type-weight-batch');await fs.mkdir(output,{recursive:true});
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
page.setDefaultTimeout(30000);const expect=baseExpect.configure({timeout:30000});
const report={steps:[],clicks:0,layouts:[],runtime:fixture.runtime,errors:fixture.errors,notes:[
  '理想化等截面积实心圆四芯设计，不是制造商的绞合成品；不含绞入、工艺损耗及公差。',
  '绝缘1.1 mm来自GB/T12706.1表7。填充、连续等效绑扎各0.1 mm与外护套1.8 mm是明示教学设计输入；不称作标准护层厚度。',
  '密度取Huang、Niu（2025）表A1，印刷68/PDF13：铜8889、XLPE1200、PVC1350 kg/m³；作为本次明示教学参考。论文未给商业配方或有效温度范围；不作标准值、厂家实测或报价保证。资源草稿不审核、不发布；固定材料版本仍是既有资源。',
]};
const started=performance.now();let wid,workspace,resourceDrafts=[];
async function click(locator){report.clicks++;await locator.click();}
async function select(label,value){await click(page.getByRole('combobox',{name:label,exact:true}));await click(page.getByRole('option',{name:value,exact:true}));}
async function step(name,work){const start=performance.now(),count=report.clicks;try{await work();report.steps.push({name,status:'completed',seconds:+((performance.now()-start)/1000).toFixed(2),clicks:report.clicks-count});}catch(e){report.steps.push({name,status:'failed',error:String(e),text:(await page.locator('body').innerText()).slice(-10000)});await page.screenshot({path:path.join(output,name+'-failed.png')});throw e;}finally{await fs.writeFile(path.join(output,'record.json'),JSON.stringify(report,null,2));}}
async function run(label){await click(page.getByRole('button',{name:label,exact:true}));const d=page.getByRole('dialog',{name:label+' · 预检',exact:true});await d.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();report.clicks++;await click(d.getByRole('button',{name:'确认并运行',exact:true}));await expect(d).toBeHidden({timeout:180000});}
async function save(){await page.keyboard.press('Control+s');report.clicks++;await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();workspace=await fixture.api('/api/workspaces/'+wid);}
try{
 await page.setViewportSize({width:1366,height:768});
 const teaching='教学用料密度表\n作者：CableSimPro 型号真实使用验证\n版本：1.0.0\n出处：Huang、Niu，High Voltage 2025，10(1):56–68，DOI 10.1049/hve2.12465；Appendix A Table A1，印刷68/PDF13。\n铜：8889 kg/m³；XLPE：1200 kg/m³；PVC：1350 kg/m³。原文摘要：34fc4f54064ac14e70b437dc99146b295aa21a9bf73d421067475559372a12d1。\n性质：本次明示采用的文献教学参考；不是标准值、厂家值或实测值。原文未指定商业配方、有效温度范围或制造公差；不作报价保证。\n教学结构：等截面积实心圆、直线拉伸；PVC实心填充、连续等效PVC绑扎和外护套均为本次设计声明，不称为论文原电缆复现。\n';
 await fs.writeFile(path.join(output,'teaching-density.md'),teaching);const digest=createHash('sha256').update(teaching).digest('hex');
 await step('density-resource-drafts',async()=>{
  for(const [key,name,value]of[['copper','铜',8889],['xlpe','XLPE',1200],['pvc','PVC',1350]]){
   const release={asset_id:'material/weight-teaching-'+key,version:'1.0.0',kind:'material',name:name+'密度 · 文献教学草稿',sources:[{kind:'project_input',reference:JSON.stringify({schema:'cablesim.density-source/1',basis:'teaching',property:'density',value,unit:'kg/m³',reference:`Huang、Niu（2025）表A1，第68页（PDF第13页） · ${name} ${value} kg/m³；教学参考，非报价保证值`,doi:'10.1049/hve2.12465',condition:'文献未给商业配方和有效温度范围；本次仅作教学采用',source_file:'source.pdf',source_sha256:'34fc4f54064ac14e70b437dc99146b295aa21a9bf73d421067475559372a12d1'}),reviewed:false}]};
   await fs.writeFile(path.join(output,key+'-density-resource.json'),JSON.stringify(release,null,2));
   await page.goto(fixture.url+'/resources/materials?theme=light');await click(page.getByRole('button',{name:'导入资源草稿',exact:true}));const d=page.getByRole('dialog',{name:'导入资源草稿',exact:true});await d.getByRole('textbox',{name:'定义内容',exact:true}).fill(JSON.stringify(release));
   const response=page.waitForResponse(r=>r.url().endsWith('/api/foundation/assets/import')&&r.request().method()==='POST');await click(d.getByRole('button',{name:'校验并导入',exact:true}));const receipt=await response;assert.equal(receipt.status(),201,await receipt.text());const draft=await receipt.json();assert.equal(draft.status,'draft');resourceDrafts.push(draft);await expect(d).toBeHidden();
  }
  report.resourceDrafts=resourceDrafts;
 });
 await step('standard-four-core-draft',async()=>{
  await page.goto(fixture.url+'/types?create=1&theme=light');await page.getByRole('radio',{name:'按标准生成',exact:true}).check();report.clicks++;
  await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('YJV 0.6/1 kV 4×95 · 教学用料设计');await select('结构类型','四芯等截面');await select('额定电压','0.6/1 kV');await select('导体几何','等截面积实心圆 · 理想化');
  for(const[label,value]of[['导体截面','95'],['芯间净距','0'],['填充外包厚度','0.1'],['包带等效厚度','0.1']])await page.getByRole('textbox',{name:label,exact:true}).fill(value);
  await click(page.getByRole('button',{name:'生成结构提案',exact:true}));await expect(page.locator('[aria-label="结构提案"]')).toContainText('1.1 mm');await page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项',exact:true}).check();report.clicks++;await click(page.getByRole('button',{name:'确认并建立草稿',exact:true}));await expect(page).toHaveURL(/\/types\/[^/]+\/structure\//);wid=new URL(page.url()).pathname.split('/')[2];workspace=await fixture.api('/api/workspaces/'+wid);
 });
 await step('fixed-material-versions',async()=>{
  const bindings=await fixture.api(`/api/types/${wid}/resources`);report.initialBindings=bindings;
  const table=page.getByRole('table',{name:'型号分层',exact:true}),cu=workspace.domain.materials.find(m=>m.standard_kind==='copper_bare');
  const group=table.getByRole('checkbox',{name:'选择全部'+cu.label+'层',exact:true});await click(group.first());await expect(group).toHaveCount(4);for(const checkbox of await group.all())await expect(checkbox).toBeChecked();await click(group.first());
  await click(page.getByRole('button',{name:'批量绑定材料版本',exact:true}));
  let previousResource;
  for(const material of workspace.domain.materials){
   const key=material.standard_kind==='copper_bare'?'copper-conductor':material.standard_kind==='XLPE'?'xlpe-mv':'pvc-reference';
   const resource=bindings.resources.find(r=>r.asset_id==='material/'+key);assert.ok(resource,JSON.stringify(bindings.resources));
   if(previousResource===resource.id)await click(page.getByRole('button',{name:material.label+'采用上一项版本',exact:true}));else await select(material.label+'资源版本',resource.name+' · '+resource.version);
   previousResource=resource.id;
  }
  const d=page.getByRole('dialog',{name:'批量材料版本',exact:true});await page.screenshot({path:path.join(output,'batch-binding-1366.png'),animations:'disabled'});await click(d.getByRole('button',{name:'查看全部差异',exact:true}));await expect(d.locator('[data-review-end]')).toHaveCount(4);for(const row of await d.locator('[data-review-end]').all())await row.scrollIntoViewIfNeeded();await expect(d.getByRole('status')).toContainText('4/4');
  const revision=workspace.revision;await click(d.getByRole('button',{name:'已查看，确认全部绑定',exact:true}));await expect(d).toBeHidden();await expect(page.getByRole('button',{name:'批量绑定材料版本',exact:true})).toBeEnabled();
  workspace=await fixture.api('/api/workspaces/'+wid);report.bindings=await fixture.api(`/api/types/${wid}/resources`);assert.ok(report.bindings.targets.filter(m=>m.role==='material').every(m=>m.binding));
  assert.equal(workspace.revision,revision+1,'四种材料在一个原子修订中绑定');
 });
 await step('add-explicit-jacket',async()=>{
  await click(page.getByRole('button',{name:'添加结构层',exact:true}));await expect(page.getByRole('combobox',{name:'所属位置',exact:true})).toHaveText('共同层');await select('结构层','外护套');await select('新层材料',workspace.domain.materials.find(m=>m.id.includes('filler')).label);const d=page.getByRole('dialog',{name:'添加结构层',exact:true});await d.getByRole('textbox',{name:'新层厚度',exact:true}).fill('1.8');await d.getByRole('textbox',{name:'新层厚度',exact:true}).press('Tab');await select('新层构造','挤包或连续层');await click(d.getByRole('button',{name:'添加到草稿',exact:true}));await save();
 });
 await step('geometry-with-missing-density',async()=>{await click(page.getByRole('tab',{name:'外径与用料',exact:true}));await run('更新结构推导');await expect(page.locator('[data-type-page=quantities]')).toContainText('材料密度');report.before=await fixture.api(`/api/types/${wid}/specification?audience=internal`);assert.equal(report.before.payload.results.geometry.artifact.mass_kg_per_km,null);});
 await step('explicit-density-inputs',async()=>{
  await click(page.getByRole('button',{name:'批量填写密度与出处',exact:true}));const d=page.getByRole('dialog',{name:'批量材料密度',exact:true});
  for(const material of workspace.domain.materials){
   const kind=material.standard_kind==='copper_bare'?'copper':material.standard_kind==='XLPE'?'xlpe':'pvc',draft=resourceDrafts.find(r=>r.asset_id.endsWith('-'+kind));const value=kind==='copper'?8889:kind==='xlpe'?1200:1350;
   if(kind==='pvc'){await select(material.label+'标准材料类别','聚氯乙烯');await d.getByRole('textbox',{name:material.id+'设计材料名称',exact:true}).fill(material.id.includes('filler')?'PVC · 填充与外护套（教学）':'PVC · 连续等效包带（教学）');}
   const number=d.getByRole('textbox',{name:material.label+'材料密度',exact:true});await number.fill(String(value));await number.press('Tab');
   const reference={schema:'cablesim.density-source/1',basis:'teaching',value,unit:'kg/m³',reference:`Huang、Niu（2025）表A1，第68页（PDF第13页） · ${kind==='copper'?'铜':kind==='xlpe'?'XLPE':'PVC'} ${value} kg/m³；教学参考，非报价保证值`,source_file:'source.pdf',source_sha256:'34fc4f54064ac14e70b437dc99146b295aa21a9bf73d421067475559372a12d1',teaching_definition_sha256:digest,asset_id:draft.asset_id,version:draft.version,content_sha256:draft.content_sha256,resource_status:'draft'};
   const sourceInput=d.getByRole('textbox',{name:material.id+'密度出处',exact:true});await sourceInput.fill(JSON.stringify(reference));await expect(sourceInput).toHaveValue(reference.reference);await sourceInput.fill(reference.reference+' · 已逐项核对');
  }
  const copper=workspace.domain.materials.find(m=>m.standard_kind==='copper_bare'),number=d.getByRole('textbox',{name:copper.label+'材料密度',exact:true});await number.fill('0');await number.press('Tab');await d.getByRole('checkbox',{name:'已逐项核对密度、出处与使用条件',exact:true}).check();report.clicks++;await expect(d.getByRole('alert').filter({hasText:'须大于 0'})).toBeVisible();await expect(d.getByRole('button',{name:'写入材料草稿',exact:true})).toBeDisabled();await number.fill('8889');await number.press('Tab');report.invalidDensityRejected=true;
  await d.getByRole('checkbox',{name:'已逐项核对密度、出处与使用条件',exact:true}).check();report.clicks++;await click(d.getByRole('button',{name:'写入材料草稿',exact:true}));await save();await expect(page.locator('[data-type-page=quantities]')).toHaveAttribute('data-type-state','historical');
 });
 await step('reconfirm-material-versions',async()=>{
  const before=await fixture.api(`/api/types/${wid}/resources`);assert.equal(before.targets.filter(m=>m.role==='material'&&m.state==='outdated').length,4);
  await click(page.getByRole('button',{name:'查看全部过期差异',exact:true}));const d=page.getByRole('dialog',{name:'批量材料版本',exact:true});await expect(d.locator('[data-review-end]')).toHaveCount(4);await expect(d).toContainText('8889');await expect(d).toContainText('1200');await expect(d).toContainText('1350');for(const row of await d.locator('[data-review-end]').all())await row.scrollIntoViewIfNeeded();await expect(d.getByRole('status')).toContainText('4/4');
  report.batchPreview=await d.innerText();await page.screenshot({path:path.join(output,'batch-differences-1366.png'),animations:'disabled'});await click(d.getByRole('button',{name:'已查看，确认全部绑定',exact:true}));await expect(d).toBeHidden();await expect(page.getByRole('button',{name:'批量绑定材料版本',exact:true})).toBeEnabled();
  report.finalBindings=await fixture.api(`/api/types/${wid}/resources`);assert.ok(report.finalBindings.targets.filter(m=>m.role==='material').every(m=>m.binding&&m.state==='current'));
  assert.equal(report.finalBindings.revision,before.revision+1);
 });
 await step('weight-and-materials',async()=>{await run('更新结构推导');await expect(page.locator('[data-type-page=quantities]')).toHaveAttribute('data-type-state','success');await expect(page.getByRole('table',{name:'主要材料用量',exact:true})).toBeVisible();const spec=await fixture.api(`/api/types/${wid}/specification?audience=internal`);report.after=spec;const a=spec.payload.results.geometry.artifact;assert.ok(a.mass_kg_per_km>0);assert.equal(a.layers.length,11);assert.equal(a.material_usage.length,4);
  for(const row of a.layers){assert.ok(row.mass_kg_per_km>0);assert.equal(row.density_source.kind,'demo');const s=JSON.parse(row.density_source.reference);assert.equal(s.resource_status,'draft');assert.equal(s.value,row.density_kg_m3);assert.ok(resourceDrafts.some(d=>d.content_sha256===s.content_sha256));assert.ok(Math.abs(row.mass_kg_per_km-row.material_volume_m3_per_km*row.density_kg_m3)<1e-9);}
  const conductor=a.layers.find(l=>l.role==='conductor'),insulation=a.layers.find(l=>l.role==='insulation');report.handChecks=[conductor,insulation].map(l=>({layer:l.label,formula:'π × (R² − r²) × 1000 × ρ',R_m:l.outer_radius_m,r_m:l.inner_radius_m,density_kg_m3:l.density_kg_m3,expected_kg_km:Math.PI*(l.outer_radius_m**2-l.inner_radius_m**2)*1000*l.density_kg_m3,actual_kg_km:l.mass_kg_per_km}));for(const h of report.handChecks)assert.ok(Math.abs(h.actual_kg_km-h.expected_kg_km)<1e-6);
  assert.ok(Math.abs(a.mass_kg_per_km-a.material_usage.reduce((sum,m)=>sum+m.mass_kg_per_km,0))<1e-8);assert.equal(report.before.payload.results.geometry.artifact.mass_kg_per_km,null);
  const oldSource=report.before.payload.sources.find(s=>s.channel==='geometry');const oldRun=await fixture.api(`/api/workspaces/${wid}/studies/${oldSource.study_id}/runs/${oldSource.run_id}`);assert.equal(oldRun.output.cases[0].artifacts['x-cablesim.cad-model'].mass_kg_per_km,null,'从数据库重新读取的历史运行不被密度修改改写');report.historicalRun=oldRun.id;
  report.results={kg_km:a.mass_kg_per_km,outer_mm:a.outer_diameter_m*1000,materials:a.material_usage};await fs.writeFile(path.join(output,'saved-weight.json'),JSON.stringify(spec,null,2));
 });
 await step('specification',async()=>{await click(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:/^规格书/}));await select('文档版本','内部审核版');const downloaded=page.waitForEvent('download',{timeout:240000});await click(page.getByRole('button',{name:'导出内部审核稿',exact:true}));await(await downloaded).saveAs(path.join(output,'teaching-weight-specification.pdf'));});
 report.flowSeconds=+((performance.now()-started)/1000).toFixed(2);assert.ok(report.clicks<60,'重量真实流程应少于60次操作');report.validationActions=0;
 for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/structure/quantities?theme=${theme}`);await expect(page.locator('[data-type-page=quantities]')).toHaveAttribute('data-type-state','success');report.layouts.push({width,theme,view:'weight',...await checkLayout(page)});
  const clipped=await page.getByRole('table',{name:'外径与用料',exact:true}).evaluate(table=>[...table.querySelectorAll('th,td')].flatMap(cell=>{const box=cell.getBoundingClientRect();if(box.bottom<0||box.top>innerHeight)return [];const range=document.createRange();range.selectNodeContents(cell);return [...range.getClientRects()].some(r=>r.width>0&&(r.left<box.left-1||r.right>box.right+1))?[cell.textContent]:[]}));assert.deepEqual(clipped,[],'用料表内容越过单元格边界');
  const nested=await page.locator('[data-type-page=quantities]').evaluate(scope=>[...scope.querySelectorAll('*')].filter(e=>/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2).map(e=>e.className));assert.deepEqual(nested,[],'用料区不建立内部滚动条');
  if(width===1366&&theme==='light')await page.screenshot({path:path.join(output,'weight-final-1366.png'),animations:'disabled'});
  await page.getByRole('button',{name:'批量绑定材料版本',exact:true}).click();report.validationActions++;const binding=page.getByRole('dialog',{name:'批量材料版本',exact:true});report.layouts.push({width,theme,view:'binding-selection',...await checkLayout(page)});
  await binding.getByRole('button',{name:'查看全部差异',exact:true}).click();report.validationActions++;await expect(binding.locator('[data-review-end]')).toHaveCount(4);report.layouts.push({width,theme,view:'binding-differences',...await checkLayout(page)});await binding.getByRole('button',{name:'关闭',exact:true}).click();report.validationActions++;await expect(binding).toBeHidden();
  await page.getByRole('button',{name:'批量填写密度与出处',exact:true}).click();report.validationActions++;const density=page.getByRole('dialog',{name:'批量材料密度',exact:true});report.layouts.push({width,theme,view:'density',...await checkLayout(page)});if(width===1366&&theme==='light'){
   await page.screenshot({path:path.join(output,'batch-density-1366.png'),animations:'disabled'});const copper=workspace.domain.materials.find(m=>m.standard_kind==='copper_bare'),section=density.getByRole('region',{name:copper.label+'密度输入',exact:true});
   const source=density.getByRole('textbox',{name:copper.id+'密度出处',exact:true});await section.locator('summary').click();report.validationActions++;await density.getByRole('button',{name:copper.label+'改用新出处',exact:true}).click();report.validationActions++;await expect(source).toHaveValue('');await source.fill('Huang、Niu（2025）表A1，第68页（PDF第13页） · 铜 8889 kg/m³，教学参考。');const number=density.getByRole('textbox',{name:copper.label+'材料密度',exact:true});await number.fill('8889');await number.press('Tab');await density.getByRole('combobox',{name:'批量密度来源类别',exact:true}).click();await page.getByRole('option',{name:'教学值',exact:true}).click();report.validationActions+=2;await density.getByRole('checkbox',{name:'已逐项核对密度、出处与使用条件',exact:true}).check();report.validationActions++;await expect(density.getByRole('button',{name:'写入材料草稿',exact:true})).toBeEnabled();
  }await density.getByRole('button',{name:'关闭',exact:true}).click();report.validationActions++;await expect(density).toBeHidden();if(width===1366&&theme==='light'){const unchanged=(await fixture.api('/api/workspaces/'+wid)).domain,copper=unchanged.materials.find(m=>m.standard_kind==='copper_bare');assert.equal(copper.density,8889,'取消批量编辑后保存密度不变');assert.equal(JSON.parse(unchanged.provenance['/materials/'+copper.id.replace(/~/g,'~0').replace(/\//g,'~1')+'/density'].reference).schema,'cablesim.density-source/1','取消重新填写出处后保存的资源来源快照不变');}
 }
 for(const draft of resourceDrafts)assert.equal((await fixture.api('/api/foundation/assets/'+draft.id)).status,'draft');
 report.totalSeconds=+((performance.now()-started)/1000).toFixed(2);assert.deepEqual(fixture.errors,[]);
}catch(error){report.failure=String(error.stack||error);report.log=fixture.log();console.error(report.failure);process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'record.json'),JSON.stringify(report,null,2));await fixture.close();}
console.log(JSON.stringify({seconds:report.flowSeconds,clicks:report.clicks,results:report.results?.kg_km,failure:report.failure}));
