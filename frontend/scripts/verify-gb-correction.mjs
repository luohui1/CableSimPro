// Real IEC and GB plugin runs, isolated DB only. One browser page at a time.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
import { assertLayout } from './layout-assertions.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Only isolated DB writes are allowed');
const base=process.env.FRONTEND_URL,expect=baseExpect.configure({timeout:30000});
const out=path.join(repositoryRoot,'.data/fix-round/research/gb-correction');await fs.mkdir(out,{recursive:true});
const evidence={checks:[],errors:[],runs:[]};
let session;
try {
  const projects=await request(base,'/api/workspaces');let selection;
  for(const project of projects){selection=(await request(base,`/api/workspaces/${project.id}/studies`)).find(s=>s.definition.driver.kind==='selection'&&s.latest_run);if(selection)break;}
  assert(selection,'real saved selection input required');
  const saved=await request(base,`/api/workspaces/${selection.workspace}/studies/${selection.id}/runs/${selection.latest_run.id}?view=full`);
  const candidate=saved.snapshot.cases.find(c=>c.input?.cable_types?.some(t=>t.label.includes('300')))||saved.snapshot.cases[0];
  const document=structuredClone(candidate.input), circuit=document.circuits[0], cable=document.cable_types.find(t=>t.id===circuit.cable_type), section=document.sections[0];
  document.circuits=[circuit];circuit.cables=[circuit.cables[0]];circuit.system.voltage=10000;
  section.kind='ground';section.enclosures=[];section.backfill=null;section.soil_layers=[];
  document.name='GB 校正与 IEC 同工况验收';section.label='三芯直埋 · 水平并列';section.layout_template={};
  section.medium.surface_temperature=298.15;section.medium.solar_irradiance=0;
  document.materials.find(m=>m.id===section.medium.material).thermal_resistivity=1.2;
  section.placements=[{cable:circuit.cables[0].id,x:0,z:-.8,enclosure:null}];
  document.sections=[section];document.load_cases[0].currents={[circuit.id]:300};
  const methods=await request(base,'/api/methods'),pin=id=>({...methods.find(row=>row.method.plugin_id===id).method,capability:'steady-rating'});
  const contracts=await request(base,'/api/input-contracts');
  const correctionContract=contracts.find(row=>row.method.plugin_id==='cablesim.gb50217-correction');assert(correctionContract);
  const created=await request(base,'/api/workspaces','POST',{}),converted=await request(base,`/api/workspaces/${created.id}/domain/conversion`,'POST',{expected_revision:created.revision});
  let workspace=await request(base,`/api/workspaces/${created.id}/domain`,'PUT',{expected_revision:converted.revision,document});
  const wid=created.id;
  async function create(title,method,parameters,driver={kind:'single'}){return await request(base,`/api/workspaces/${wid}/studies`,'POST',{title,task:'rating',method,input_source:'domain',parameters,driver,expected_revision:workspace.revision});}
  async function run(study){
    const prefix=`/api/workspaces/${wid}/studies/${study.id}`,current=await request(base,`/api/workspaces/${wid}`);
    const check=await request(base,prefix+`/preflight?expected_revision=${current.revision}&expected_study_revision=${study.revision}`);
    assert(check.ready,JSON.stringify(check.cases.map(c=>c.error)));
    let value=await request(base,prefix+'/runs','POST',{request_id:randomUUID(),expected_revision:current.revision,expected_study_revision:study.revision,lock_digest:check.lock_digest,scope_acknowledged:true});
    for(let i=0;['accepted','running','validating'].includes(value.status)&&i<180;i++){await new Promise(r=>setTimeout(r,300));value=await request(base,prefix+'/runs/'+value.id);}
    assert.equal(value.status,'succeeded',JSON.stringify(value.error));
    return await request(base,prefix+'/runs/'+value.id+'?view=full');
  }
  const iecParameters=structuredClone(candidate.parameters);delete iecParameters.crossing_sources;
  const baselineStudy=await create('GB 校正基准 · 单根 25 °C',pin('cablesim.iec60287'),iecParameters);
  const baselineRun=await run(baselineStudy);
  const baseline=baselineRun.output.cases[0].results.find(r=>r.key==='ampacity'&&r.case==='rating').value;
  // Actual same model: soil30 °C / rho1.2 / three horizontal cables / .1m net gap.
  const diameter=2*(Math.max(...cable.cores.map(c=>Math.hypot(c.x,c.z)+c.conductor.diameter/2+c.layers.reduce((a,l)=>a+(l.thickness||0),0)))+cable.common_layers.reduce((a,l)=>a+(l.thickness||0),0));
  document.circuits=Array.from({length:3},(_,i)=>({...structuredClone(circuit),id:`circuit/g${i+1}`,label:`回路 ${i+1}`,cables:[{...circuit.cables[0],id:`cable/g${i+1}`}]}));
  section.placements=document.circuits.map((c,i)=>({cable:c.cables[0].id,x:i*(diameter+.1),z:-.8,enclosure:null}));
  section.medium.surface_temperature=303.15;document.load_cases[0].currents=Object.fromEntries(document.circuits.map(c=>[c.id,300]));
  workspace=await request(base,`/api/workspaces/${wid}/domain`,'PUT',{expected_revision:workspace.revision,document});
  const parameters={baseline_current_a:baseline,baseline_ambient_k:298.15,baseline_soil_rho:1.2,baseline_kind:'manufacturer',baseline_source:'保存 IEC 基准运行：单根同型号、25 °C、土壤 1.2 K·m/W、中心埋深 0.8 m；非厂家额定值',baseline_sha256:baselineRun.output_digest,baseline_page:1,baseline_depth_m:.8,baseline_reviewed:true,basis_release_digest:correctionContract.parameter_schema.properties.basis_release_digest.default};
  const correctionStudy=await create('GB 50217 校正 · 保存基准与同工况对比',pin('cablesim.gb50217-correction'),parameters);
  const gbRun=await run(correctionStudy),iecStudy=await create('IEC 同工况对照',pin('cablesim.iec60287'),iecParameters),iecRun=await run(iecStudy);
  const gb=gbRun.output.cases[0].artifacts['x-cablesim.gb50217-correction'];assert(Math.abs(gb.total_factor-.816)<1e-12);assert(Math.abs(gb.corrected_current_a-baseline*.816)<1e-8);
  const comparison=await request(base,`/api/workspaces/${wid}/study-comparisons`,'POST',{run_ids:[gbRun.id,iecRun.id]});
  const paired=comparison.differences.flatMap(d=>d.quantities).filter(r=>r.key==='ampacity');
  const common=iecRun.output.cases[0].results.find(r=>r.key==='ampacity'&&r.case==='rating-simultaneous').value;
  assert.equal(paired.length,3);assert(paired.every(r=>r.condition==='rating-simultaneous'&&Math.abs(r.baseline-gb.corrected_current_a)<1e-8&&Math.abs(r.value-common)<1e-8),'pair only saved simultaneous capacities');
  evidence.runs=[{baseline_a:baseline,gb_a:gb.corrected_current_a,factor:gb.total_factor,iec_common_a:iecRun.output.cases[0].results.find(r=>r.key==='ampacity'&&r.case==='rating-simultaneous')?.value,comparison}];
  await fs.writeFile(path.join(out,'saved-correction.json'),JSON.stringify(gbRun,null,2));
  const delivery=await request(base,`/api/workspaces/${wid}/deliveries/current`,'POST',{run_ids:[gbRun.id],request_id:randomUUID()});
  const response=await fetch(base+`/api/workspaces/${wid}/deliveries/${delivery.id}/file`);assert(response.ok);
  const html=await response.text();assert.equal(html,delivery.html);
  const pdf=html.match(/data-report-pdf="customer"[^>]+href="data:application\/pdf;base64,([^"]+)"/);assert(pdf,'saved delivery must include customer PDF');
  const raw=Buffer.from(pdf[1],'base64');assert.equal(raw.subarray(0,5).toString(),'%PDF-');await fs.writeFile(path.join(out,'customer.pdf'),raw);
  session=await openHeadlessBrowser();const page=session.page;page.on('pageerror',e=>evidence.errors.push(e.message));
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(size);
    await page.goto(`${base}/studies/${correctionStudy.id}/ampacity/results?workspace=${wid}&theme=light&view=section`);
    await expect(page.getByLabel('结论',{exact:true})).toContainText('GB 50217');
    await expect(page.getByLabel('结论',{exact:true})).toContainText('校正后允许电流');
    const details=page.locator('details').filter({has:page.locator('summary').getByText('校正系数与标准出处',{exact:false})}).first();if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
    await expect(page.getByRole('table',{name:'GB 50217 校正系数'})).toContainText('表D.0.4');
    for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await assertLayout(page,'GB correction '+size.width+' '+theme);}
    await expect(page.getByText('正在读取保存工况的模型输入',{exact:true})).toHaveCount(0);
    const table=page.getByRole('table',{name:'GB 50217 校正系数'});
    assert(await table.evaluate(node=>node.getBoundingClientRect().width<=node.parentElement.clientWidth+1),'coefficient table must fit without its own horizontal scrollbar');
    await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,`results-${size.width}.png`)});
    await page.goto(`${base}/studies/${correctionStudy.id}/method-compare/results?workspace=${wid}&theme=light&compare=${gbRun.id},${iecRun.id}`);
    const difference=page.getByRole('table',{name:'方法结果差异'});
    await expect(difference).toContainText('载流量');
    await expect(difference).toContainText(gb.corrected_current_a.toFixed(1));
    await expect(difference).toContainText(common.toFixed(1));
    await expect(difference).toContainText('共同');
    await expect(page.locator('.evidence-summary')).toContainText('GB 50217 载流量校正');
    await expect(page.locator('.evidence-summary')).toContainText('IEC 60287');
    await page.screenshot({path:path.join(out,`comparison-${size.width}.png`)});
    await page.goto(`${base}/studies?workspace=${wid}&theme=light`);
    await page.getByRole('button',{name:'新建研究',exact:true}).first().click();
    const dialog=page.getByRole('dialog',{name:'新建研究',exact:true});
    await dialog.getByRole('button',{name:'按 GB 50217 校正',exact:true}).click();
    await expect(dialog).toContainText('GB 50217 载流量校正');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/studies/${correctionStudy.id}/ampacity/results?workspace=${wid}&theme=light&inspector=method&view=section`);
    await expect(page.locator('.study-inspector')).toContainText('基准载流量');
    await expect(page.locator('.study-inspector')).toContainText('基准原件名称与条件出处');
  }
  evidence.checks.push('two real plugins / identical actual domain / frozen basis coefficients / customer PDF / two viewports and themes');
  assert.deepEqual(evidence.errors,[]);evidence.status='passed';
} catch(error){evidence.status='failed';evidence.failure=String(error);throw error;}
finally{if(session){await session.close();evidence.cleanup={browser_closed:true};}await fs.writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));}
