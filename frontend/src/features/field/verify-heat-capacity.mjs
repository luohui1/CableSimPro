/** Real basis preparation on a release-copy service; no solver requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,repositoryRoot} from '../../../scripts/browser.mjs';
import {checkLayout} from '../type/tests/ui-checks.mjs';
const front=process.env.FRONTEND_URL,back=process.env.BACKEND_URL;
for(const url of [front,back])assert(url&&new URL(url).hostname==='127.0.0.1'&&!['8100','8200'].includes(new URL(url).port),'Private copy required');
const out=process.env.HPC_REAL_EVIDENCE || path.join(repositoryRoot,'.data/fix-round/simulation-performance');
await fs.mkdir(out,{recursive:true});
async function api(url,body){const response=await fetch(back+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});assert(response.ok,`${url}: ${response.status} ${await response.clone().text()}`);return response.json();}
const workspaces=await api('/api/workspaces');let studies=[];
for(const workspace of workspaces)studies.push(...await api(`/api/workspaces/${workspace.id}/studies`));
const study=studies.find(value=>value.definition.title.includes('城南线路'));assert(study);
const responseRuns=await api(`/api/workspaces/${study.workspace}/studies/${study.id}/runs?view=summary`);
const runs=Array.isArray(responseRuns)?responseRuns:responseRuns.items;
const source=runs.find(value=>value.status==='succeeded');assert(source,'Release-copy saved Chengnan run is required');
const saved=await api(`/api/workspaces/${study.workspace}/studies/${study.id}/runs/${source.id}?view=full`);
assert.equal(saved.integrity,'verified');
const sourceCheck=await api(`/api/hpc/workspaces/${study.workspace}/studies/${study.id}/step-responses/source-check?source_run_id=${source.id}`);
assert.equal(sourceCheck.solver_submitted,false);
assert.equal(sourceCheck.status,'unsupported');
assert(sourceCheck.reason.includes('标准方法结果'),'The actual release source is an IEC run, not a saved FEM preload');
const input=saved.snapshot.cases[0].input;
assert.equal(input.circuits.length,1);assert.equal(input.circuits[0].cables.length,3);
const used=new Set();function visit(value){if(typeof value==='string')used.add(value);else if(value&&typeof value==='object')Object.values(value).forEach(visit);}
Object.entries(input).filter(([key])=>key!=='materials').forEach(([,value])=>visit(value));
await fs.writeFile(path.join(out,'chengnan-admission.json'),JSON.stringify({sourceCheck,input_sha256:saved.input_digest,identity_kind:'saved_run_input_digest',output_sha256:saved.output_digest,source_run_id:source.id,source_study_id:study.id,materials:input.materials.filter(material=>used.has(material.id)),new_core_hours:0},null,2));
const session=await openHeadlessBrowser();const {page}=session;
const errors=[],requests=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))requests.push(new URL(request.url()).pathname);});
try {
  await page.setViewportSize({width:1366,height:768});
  await page.goto(front+`/studies/${study.id}/transient/results?theme=light`);
  const form=page.getByRole('region',{name:'暂态材料热容准备'});
  await form.getByRole('button',{name:'选择热容依据',exact:true}).waitFor({timeout:60000});
  await form.getByText('暂态尚不能提交',{exact:false}).waitFor({timeout:60000});
  assert((await form.innerText()).includes(sourceCheck.reason));
  await page.screenshot({path:path.join(out,'chengnan-before-submission.png')});
  assert(!requests.some(url=>url.includes('plugin-queries')),'Overview must not eagerly load source tables');
  await form.getByRole('button',{name:'选择热容依据',exact:true}).click();
  await form.getByRole('combobox',{name:'材料域',exact:true}).waitFor({timeout:60000});
  async function choose(label,name){await form.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:false}).first().click();}
  await choose('材料域','铜');
  await choose('热容正文依据',/^铜 · Nielsen/);
  await form.getByRole('button',{name:'采用到所选材料',exact:true}).click();
  await form.getByRole('table').getByText('3,460,000',{exact:true}).waitFor({timeout:60000});
  checks.push('铜采用真实 Nielsen 2019 Table 1 查询值，保留 PDF 页码及摘要');
  await choose('材料域','土壤');
  await form.getByRole('combobox',{name:'热容正文依据',exact:true}).click();
  await page.getByRole('option').filter({hasText:/三相/}).first().click();
  await form.locator('#capacity-water_volume_fraction').waitFor();
  assert.equal(await form.locator('#capacity-water_volume_fraction').inputValue(),'');
  assert.equal(await form.locator('#capacity-phase_assumption').isChecked(),false);
  const teaching={dry_bulk_density_kg_m3:'1450',particle_density_kg_m3:'2650',solid_specific_heat_capacity_j_kg_k:'800',water_volumetric_heat_capacity_j_m3_k:'4180000',air_volumetric_heat_capacity_j_m3_k:'1200',water_volume_fraction:'0.9'};
  for(const [key,value] of Object.entries(teaching))await form.locator('#capacity-'+key).fill(value);
  await form.locator('#capacity-site-source').fill('教学参数：仅用于公式输入与来源检查，不作为城南工程热容。');
  await form.locator('#capacity-phase_assumption').check();
  await form.getByRole('button',{name:'采用到所选材料',exact:true}).click();
  await form.getByRole('alert').waitFor({timeout:60000});
  assert((await form.getByRole('alert').innerText()).includes('含水率'));
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'capacity-water_volume_fraction');
  checks.push('教学含水率超过孔隙率，真实公式接口拒绝');
  await form.locator('#capacity-water_volume_fraction').fill('0.2');
  await form.getByRole('button',{name:'采用到所选材料',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.heat-capacity-form tr')].some(row=>/土壤/.test(row.innerText)&&/1,996,303/.test(row.innerText)),null,{timeout:60000});
  await form.getByRole('button',{name:'检查热容与来源',exact:true}).click();
  await form.getByText('热容依据仍有缺项，不能提交暂态求解。',{exact:true}).waitFor();
  const downloaded=page.waitForEvent('download');
  await form.getByRole('button',{name:'导出热容准备文件',exact:true}).click();
  const download=await downloaded;const file=path.join(out,'teaching-capacities.json');await download.saveAs(file);
  const exported=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(exported.scope,'material_sources_only');assert.equal(exported.input_ready,false);assert(exported.missing.length>0);
  assert(exported.missing.every(region=>used.has(region.id)||region.id==='material/soil'),'Do not require unused catalog materials');
  const adopted=Object.keys(exported.capacities);assert.equal(adopted.length,2);
  for(const evidence of Object.values(exported.evidence)){assert.match(evidence.record.source_sha256,/^[a-f0-9]{64}$/);assert(evidence.record.pdf_page>0);}
  const valid=await api('/api/hpc/heat-capacity/preflight',{regions:adopted,capacities:exported.capacities});
  assert.equal(valid.input_ready,true);assert.equal(valid.solver_submitted,false);assert.equal(valid.scope,'material_sources_only');
  checks.push('两种教学材料通过真实插件 Capacity 契约；城南完整材料缺项保持拒绝');
  const invalid=structuredClone(exported.capacities);delete invalid[adopted[0]].source_sha256;
  assert.equal((await api('/api/hpc/heat-capacity/preflight',{regions:adopted,capacities:invalid})).input_ready,false);
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});
    if(await page.locator('html').getAttribute('data-theme')!==theme){await page.locator('.sidebar-foot').getByRole('button').click();await page.getByRole('menuitem',{name:theme==='dark'?'切换深色模式':'切换浅色模式',exact:true}).click();}
    await form.locator('#capacity-water_volume_fraction').scrollIntoViewIfNeeded();
    const layout=await form.evaluate(element=>({overflow:document.documentElement.scrollWidth>innerWidth,small:[...element.querySelectorAll('label,p,button,td')].filter(node=>parseFloat(getComputedStyle(node).fontSize)<13).map(node=>node.textContent),unit:element.querySelector('#capacity-water_volume_fraction')?.closest('[data-slot="input-group"]')?.innerText}));
    assert.equal(layout.overflow,false);assert.deepEqual(layout.small,[]);assert(layout.unit.includes('m³/m³'));
    checks.push({width,theme,layout,appearance:await checkLayout(page,'.heat-capacity-form')});
    if(width===1366&&theme==='light')await page.screenshot({path:path.join(out,'heat-capacity-input.png')});
  }
  const fem=studies.find(value=>value.definition.title.includes('当前方法复核'));assert(fem);
  for(const width of [1366,1920]){
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(front+`/studies/${fem.id}/thermal-field/field?theme=light`);
    const strip=page.getByRole('region',{name:'保存温度场结论',exact:true});
    await strip.waitFor({timeout:60000});
    const conclusion=await strip.innerText();assert(conclusion.includes('超温')&&!conclusion.includes('无法判断'));
    const typography=await strip.evaluate(el=>[...el.querySelectorAll('[data-conclusion-part]')].map(node=>({part:node.getAttribute('data-conclusion-part'),size:parseFloat(getComputedStyle(node).fontSize)})));
    assert(typography.filter(row=>row.part==='value').every(row=>row.size===20));
    checks.push({width,saved_fem_conclusion:conclusion,typography,appearance:await checkLayout(page,'.conclusion-strip')});
    if(width===1366)await page.screenshot({path:path.join(out,'saved-fem-conclusion.png')});
  }
  const femRuns=await api(`/api/workspaces/${fem.workspace}/studies/${fem.id}/runs?view=summary`);
  const femSource=(Array.isArray(femRuns)?femRuns:femRuns.items).find(value=>value.status==='succeeded');assert(femSource);
  const fieldUrl=`/api/hpc/workspaces/${fem.workspace}/fields/${femSource.id}/view`;
  async function readField(){const start=performance.now(),response=await fetch(back+fieldUrl);assert(response.ok);return {value:await response.json(),cache:response.headers.get('x-cablesim-read-cache'),elapsed_ms:Math.round(performance.now()-start)};}
  const initial=await readField(),warm=await readField();assert.equal(warm.cache,'hit');
  assert.deepEqual(initial.value,warm.value);
  const currentDomain=await api(`/api/workspaces/${fem.workspace}/domain`),edited=structuredClone(currentDomain.document);
  edited.sections[0].label+=' · 隔离副本缓存失效核对';
  const save=await fetch(back+`/api/workspaces/${fem.workspace}/domain`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:currentDomain.revision,document:edited})});
  assert(save.ok,await save.clone().text());const updated=await save.json();
  try{
    const invalidated=await readField();assert.equal(invalidated.cache,'miss');
    assert.equal(invalidated.value.output_digest,initial.value.output_digest);
    assert.equal(invalidated.value.input_digest,initial.value.input_digest);
    checks.push({saved_field_receipt:{warm_ms:warm.elapsed_ms,commit_cache:invalidated.cache,saved_input_and_output_preserved:true}});
  }finally{await api(`/api/workspaces/${fem.workspace}/history/undo`,{expected_revision:updated.revision});}
  const restored=await readField();assert.equal(restored.cache,'miss');assert.equal(restored.value.freshness,initial.value.freshness);
  assert.deepEqual(errors,[]);assert(requests.every(url=>url==='/api/hpc/heat-capacity/preflight'||url==='/api/plugin-queries/cablesim.standards-basis/lookup'),requests.join(';'));
  console.log(JSON.stringify({checks,requests,new_core_hours:0}));
} finally {
  await fs.writeFile(path.join(out,'heat-capacity-real-use.json'),JSON.stringify({checks,requests,errors,sourceCheck,new_core_hours:0,full_engineering_preflight:'not_passed_missing_material_sources_and_uncovered_geometry'},null,2));
  await session.close();
}
