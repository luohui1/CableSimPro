import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { typeFixture, output, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const expect=baseExpect.configure({timeout:25000}),fixture=await typeFixture(),{page,context}=fixture;
const result={workflows:[],layouts:[],states:{comparison:[],specification:[]},screenshots:[],errors:fixture.errors};
async function shot(name){const file=path.join(output,'screenshots',name+'.png');await page.screenshot({path:file});result.screenshots.push(file);}
async function visit(wid,module,tab,width=1366,theme='light'){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/${module}/${tab}?theme=${theme}`);}
async function state(module,expected){const locator=page.locator(`[data-type-page=${module}-results]`);await expect(locator).toHaveAttribute('data-type-state',expected);result.states[module].push(expected);result.layouts.push({module,state:expected,...await checkLayout(page)});}
try{
  const models=await fixture.api('/api/design/cable-models'),model=models.find(item=>item.id==='system.cu-xlpe-al-compacted-400');
  const base=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256}),wid=base.id;
  const design=structuredClone(base.domain),conductor=design.cable_types[0].cores[0].conductor;
  conductor.conductor_class=2;conductor.lay_factor=1.02;conductor.r20_basis='design';
  const materialInputs={'material/cu':['copper_bare',8900],'material/semi':['other',1100],'material/xlpe':['XLPE',920],'material/al-sheath':['aluminium',2700],'material/pvc':['PVC',1400]};
  design.materials.forEach((material,index)=>{if(!materialInputs[material.id])return;const [standard_kind,density]=materialInputs[material.id];Object.assign(material,{standard_kind,density});design.provenance['/materials/'+index]={kind:'demo',reference:'结构方案演示设计输入：材料类别和密度明确给定，用于演示真实用料推导；非厂家实测值。',reviewed:false};});
  design.provenance['/cable_types/0/cores/0/conductor']={kind:'demo',reference:'明确设计假设：第2类紧压导体，绞入系数1.02；复用已有结构用料手算测试条件，非厂家制造数据。',reviewed:false};
  await fixture.api(`/api/workspaces/${wid}/domain`,'PUT',{expected_revision:base.revision,document:design});
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const module of ['comparison','specification']){await visit(wid,module,module==='comparison'?'matrix':'content',width,theme);await state(module,'empty');}
  await visit(wid,'comparison','matrix');
  await page.getByRole('button',{name:'建立方案',exact:true}).click();const dialog=page.getByRole('dialog',{name:'建立独立型号方案',exact:true});await expect(dialog.getByRole('button',{name:'建立方案',exact:true})).toBeDisabled();
  await page.getByRole('textbox',{name:'方案名称',exact:true}).fill('加厚外护套方案');await page.keyboard.press('Enter');await expect(page.locator('[data-drawing-canvas=cable]')).toBeVisible();
  const variantId=new URL(page.url()).pathname.split('/')[2];expect(variantId).not.toBe(wid);
  const variant=await fixture.api(`/api/workspaces/${variantId}`),changed=structuredClone(variant.domain),layer=changed.cable_types[0].common_layers.find(item=>item.role==='oversheath');
  layer.thickness+=.0002;changed.provenance['/cable_types/0/common_layers/4']={kind:'demo',reference:'加厚外护套设计方案：标称厚度由2.5mm调整至2.7mm，其余输入相同。',reviewed:false};
  await fixture.api(`/api/workspaces/${variantId}/domain`,'PUT',{expected_revision:variant.revision,document:changed});
  result.workflows.push({name:'Enter真实建方案、独立版本与实际输入差异',base:wid,variant:variantId});
  await visit(wid,'specification','content');await state('specification','empty');
  // Real CAD and lightweight standards calculations, each bound to its own saved variant.
  for(const id of [wid,variantId])for(const kind of ['geometry','standards']){
    const geometry=kind==='geometry',label=geometry?'更新结构推导':'执行标准核对';
    await visit(id,geometry?'structure':'standard-check',geometry?'quantities':'results');await page.getByRole('button',{name:label,exact:true}).click();
    await expect(page.getByRole('dialog',{name:label+' · 预检',exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();await page.getByRole('button',{name:'确认并运行',exact:true}).click();
    await expect(page.locator(geometry?'[data-type-page=quantities]':'[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state','success',{timeout:90000});
  }
  const comparison=await fixture.api(`/api/types/${wid}/comparison`),metric=comparison.items.find(item=>item.workspace===wid).values.standards;expect(metric.source.freshness).toBe('current');expect(metric.value).toBeGreaterThanOrEqual(0);
  const baseValues=comparison.items.find(item=>item.workspace===wid).values,variantValues=comparison.items.find(item=>item.workspace===variantId).values;
  for(const item of comparison.items)for(const key of ['outer_diameter','mass','copper_mass','standards']){expect(item.values[key].value).not.toBeNull();expect(item.values[key].state).toBe('current');}
  expect(baseValues.outer_diameter.value).toBeCloseTo(.0452,9);expect(variantValues.outer_diameter.value-baseValues.outer_diameter.value).toBeCloseTo(.0004,9);
  expect(baseValues.copper_mass.value).toBeCloseTo(.0004*1.02*8900*1000,6);expect(variantValues.mass.value).toBeGreaterThan(baseValues.mass.value);
  result.workflows.push({name:'两方案真实结构与标准运行，铜量独立手算对拍',base:baseValues,variant:variantValues});
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    for(const tab of ['matrix','parameters','geometry']){await visit(wid,'comparison',tab,width,theme);await state('comparison','success');if(tab==='matrix'){const cell=page.getByRole('button',{name:'基准方案 标准核对通过',exact:true});await expect(cell).toContainText(`${metric.value}/${metric.total}`);await cell.click();await expect(page.locator('.property-row').filter({has:page.getByText('原始数值',{exact:true})}).locator('dd')).toContainText(String(metric.value));expect(await page.locator('body').innerText()).not.toContain('{}');expect(await page.locator('body').innerText()).not.toContain('浏览器独立方案');}if(width===1366&&theme==='light'&&tab==='matrix')await shot('comparison-matrix');}
    for(const tab of ['content','preview','review','revisions']){await visit(wid,'specification',tab,width,theme);await state('specification','success');const frame=page.frameLocator('iframe[title="正式规格书预览"]');if(tab==='content'){await expect(frame.getByRole('heading',{name:'产品规格书',exact:true})).toBeVisible();await expect(frame.locator('[data-specification-section]')).toHaveCount(1);expect(await frame.locator('body').evaluate(node=>node.firstElementChild?.hasAttribute('data-specification-section'))).toBe(true);}if(tab==='preview'){await expect(frame.getByText('8. 文档修订记录',{exact:true})).toBeVisible();expect((await page.locator('iframe').boundingBox()).height).toBeGreaterThan(400);expect(await frame.locator('table tbody').evaluateAll(tables=>tables.every(table=>table.rows.length>0))).toBe(true);expect(await frame.locator('body').innerText()).not.toMatch(/material\/|core\/|conductor_screen|insulation_screen/);}if(width===1366&&theme==='light'&&tab==='preview')await shot('specification-preview');}
  }
  await visit(wid,'specification','preview');const spec=await fixture.api(`/api/types/${wid}/specification`);await page.getByRole('combobox',{name:'文档版本',exact:true}).click();await page.getByRole('option',{name:'内部审核版',exact:true}).click();await expect(page.frameLocator('iframe').locator('[data-specification-evidence]')).toHaveCount(1);const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出内部审核稿',exact:true}).click();const file=path.join(output,'specification.pdf');await (await download).saveAs(file);expect((await fs.readFile(file)).subarray(0,5).toString()).toBe('%PDF-');
  const pdfCheck=spawnSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'frontend/src/features/type/tests/check-pdf.py'),file,spec.digest],{encoding:'utf8',windowsHide:true});expect(pdfCheck.status,pdfCheck.stderr||pdfCheck.stdout).toBe(0);result.pdf=JSON.parse(pdfCheck.stdout);
  result.workflows.push({name:'真实摘要绑定PDF下载、八章与修订、来源和条款',file,digest:spec.digest,revision:spec.payload.revision});
  // The real host rejects stale export identities, while drafts remain intact.
  const rejected=await fetch(`${fixture.url}/api/types/${wid}/specification/file?expected_revision=${spec.payload.revision}&specification_digest=${'0'.repeat(64)}`);expect(rejected.status).toBe(409);
  await visit(wid,'specification','review');await page.getByRole('button',{name:'采纳为版本草稿',exact:true}).click();const adopt=page.getByRole('dialog',{name:'采纳为版本草稿',exact:true});await expect(adopt.getByRole('button',{name:'采纳为版本草稿',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(adopt).not.toBeVisible();
  await page.getByRole('button',{name:'采纳为版本草稿',exact:true}).click();await page.getByRole('checkbox',{name:'已核对当前版本与提交前校核清单',exact:true}).check();await page.getByRole('dialog',{name:'采纳为版本草稿',exact:true}).getByRole('button',{name:'采纳为版本草稿',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'提交评审',exact:true}).click();await page.getByRole('checkbox',{name:'已核对当前版本与提交前校核清单',exact:true}).check();await page.getByRole('dialog',{name:'提交评审',exact:true}).getByRole('button',{name:'提交评审',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'人工批准',exact:true})).toBeDisabled();const submitted=await fixture.api(`/api/types/${wid}/specification`);expect(submitted.lifecycle.status).toBe('submitted');expect(submitted.lifecycle.approval).toBeNull();
  result.workflows.push({name:'真实采纳与提交、Esc取消、显式核对、缺项阻止批准；无代理批准或发布',status:submitted.lifecycle.status});
  const current=await fixture.api(`/api/workspaces/${wid}`),edited=structuredClone(current.domain);edited.name+=' · 历史断言';await fixture.api(`/api/workspaces/${wid}/domain`,'PUT',{expected_revision:current.revision,document:edited});
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    for(const module of ['comparison','specification']){await visit(wid,module,module==='comparison'?'matrix':'preview',width,theme);await state(module,'historical');}
  }
  for(const module of ['comparison','specification'])for(const kind of ['loading','error'])for(const width of [1366,1920])for(const theme of ['light','dark']){
    const pattern=`**/api/types/${wid}/${module==='comparison'?'comparison':'specification?*'}`;
    await context.route(pattern,async route=>{if(kind==='loading'){await new Promise(resolve=>setTimeout(resolve,1600));return route.continue();}return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'验证读接口断开；已保存输入不变'})});});
    await visit(wid,module,module==='comparison'?'matrix':'preview',width,theme);await state(module,kind);await context.unroute(pattern);
  }
  expect(fixture.errors).toEqual([]);
}catch(error){result.failure=String(error.stack||error);result.backendLog=fixture.log();console.error(result.failure);console.error(page.url());console.error((await page.locator('body').innerText()).slice(0,2800));await shot('versions-failure').catch(()=>{});process.exitCode=1;}
finally{for(const module of Object.keys(result.states))result.states[module]=[...new Set(result.states[module])];await fs.writeFile(path.join(output,'versions-verification.json'),JSON.stringify(result,null,2));await fixture.close();}
