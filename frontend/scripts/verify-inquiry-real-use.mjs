// Run with E2E_DATABASE_SOURCE=<release database> through isolated-e2e.mjs.
// Every write is a visible engineering action; API reads only retain evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect as baseExpect} from '@playwright/test';
import {openHeadlessBrowser,repositoryRoot,settle} from './browser.mjs';
import {request} from './research-fixtures.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Use the isolated release database runner');
const expect=baseExpect.configure({timeout:30000}),base=process.env.FRONTEND_URL;
const phase=process.env.REAL_USE_PHASE || 'before';
const reportFix=process.env.REAL_USE_REPORT_FIX==='1';
const out=path.join(repositoryRoot,process.env.REAL_USE_REPORT_CLOSE==='1' ? '.data/fix-round/research/report-close' : reportFix?'.data/fix-round/research/report-fix':'.data/fix-round/research/real-use',phase);
await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session;
const evidence={phase,steps:[],errors:[],clicks:0,source:process.env.E2E_DATABASE_SOURCE};
const reportNetwork=[];const requestStarts=new Map();let reportPayload;
page.on('request',req=>{if(/deliver|\/runs\//.test(req.url()))requestStarts.set(req,Date.now());if(req.method()==='POST' && req.url().endsWith('/delivery-jobs'))reportPayload=req.postDataJSON();});
page.on('response',async res=>{if(!requestStarts.has(res.request()))return;const entry={url:res.url(),status:res.status(),seconds:(Date.now()-requestStarts.get(res.request()))/1000};if(/delivery-jobs/.test(res.url())){try{entry.job=await res.json();}catch{}}reportNetwork.push(entry);});
const targetCurrent=Number(process.env.REAL_USE_TARGET_A || 450);
const started=Date.now();
page.on('pageerror',e=>evidence.errors.push(e.message));
async function click(locator){await locator.click();evidence.clicks++;}
async function fill(locator,value){await locator.fill(String(value));await locator.press('Tab');}
async function step(name,intent,fn){const start=Date.now(),clicks=evidence.clicks;await fn();await page.screenshot({path:path.join(out,name+'.png')});const entry={name,intent,seconds:(Date.now()-start)/1000,clicks:evidence.clicks-clicks,url:page.url()};evidence.steps.push(entry);console.log(JSON.stringify(entry));}
try{
  await page.setViewportSize({width:1366,height:768});await page.goto(base+'/');await settle(page);
  if(process.env.REAL_USE_FEM_ONLY!=='1'){
  await step('01-new-project','从首页建立新的客户询价工程',async()=>{
    await click(page.getByRole('button',{name:'新建研究',exact:true}).first());
    const chooser=page.getByRole('dialog',{name:'新建研究',exact:true});
    await click(chooser.getByRole('combobox',{name:'研究任务',exact:true}));
    await click(page.getByRole('option',{name:'客户问询选型',exact:true}));
    const initial=page.getByRole('dialog',{name:'新建问询'});
    await initial.getByLabel('工程名称',{exact:true}).fill('客户甲 · 10 kV 三回排管工程');
    await fill(initial.getByLabel('目标电流',{exact:true}),targetCurrent);
    await initial.getByLabel('研究名称',{exact:true}).fill(`客户询价 · ${targetCurrent} A 三回排管`);
    await initial.locator('input[type=radio]').first().check();evidence.clicks++;
    evidence.range=await initial.locator('.inquiry-range').innerText();
    await click(initial.getByRole('button',{name:'建立研究',exact:true}));
  });
  await step('02-engineering-parameters','补录结构参数，保留参考来源声明',async()=>{
    const completion=page.getByRole('dialog',{name:'补录工程师给定参数'});
    await expect(completion.locator('[data-completion-key=conductor_form]')).toBeVisible();
    await expect(completion.getByRole('button',{name:'采用参考输入',exact:true})).toBeEnabled();
    await click(completion.getByRole('button',{name:'采用参考输入',exact:true}));
    await expect(completion).toContainText('尚缺 0 项');
    evidence.reference=await completion.locator('.demo-row').innerText();
  });
  await click(page.getByRole('dialog',{name:'补录工程师给定参数'}).getByRole('button',{name:'保存并预检',exact:true}));
  const preflight=page.getByRole('dialog',{name:'运行前预检'});
  await expect(preflight).toBeVisible();await page.keyboard.press('Escape');
  const location=new URL(page.url()),sid=location.pathname.split('/')[2],wid=location.searchParams.get('workspace');
  evidence.study={wid,sid};
  await step('03-three-ducts','将参考的单回直埋改成客户三回排管',async()=>{
    await click(page.getByRole('button',{name:'查看布置图',exact:true}));
    await click(page.getByRole('button',{name:'更多绘图工具',exact:true}));
    await click(page.getByRole('button',{name:'敷设模板',exact:true}));
    const dialog=page.getByRole('dialog',{name:'敷设模板',exact:true});
    await click(dialog.getByRole('combobox',{name:'模板',exact:true}));
    await click(page.getByRole('option',{name:'三芯排管',exact:true}));
    await click(dialog.getByRole('button',{name:'应用模板',exact:true}));
    await expect(dialog).not.toBeVisible();
  });
  await step('04-customer-conditions',`设置地温30°C、土壤1.2 K·m/W，并核对${targetCurrent} A负荷`,async()=>{
    const inspector=page.getByLabel('属性',{exact:true});
    await fill(inspector.getByLabel('地表温度',{exact:true}),30);
    await fill(inspector.getByLabel('介质热阻率',{exact:true}),1.2);
    const currents=inspector.getByLabel(/回路.*电流/);
    assert.equal(await currents.count(),3,'模板必须生成三回路');
    for(let i=0;i<await currents.count();i++)await fill(currents.nth(i),targetCurrent);
    const voltages=inspector.getByLabel(/系统线电压/);
    assert.equal(await voltages.count(),3,'每回路应能明确填写系统电压');
    for(let i=0;i<await voltages.count();i++)await fill(voltages.nth(i),10);
    evidence.conditionControls=await inspector.locator('input').evaluateAll(nodes=>nodes.map(n=>({label:n.labels?.[0]?.textContent,value:n.value})));
    const persisted=page.waitForResponse(response=>response.request().method()==='PUT' && response.url().endsWith(`/api/workspaces/${wid}/domain`));
    await click(page.getByRole('toolbar',{name:'工程命令'}).locator('[data-command-role=save]:visible'));
    assert((await persisted).ok(),'客户工况保存应有成功回执');
    await expect(page.getByRole('toolbar',{name:'工程命令'}).locator('[data-command-role=save]:visible')).toHaveText('已保存');
    evidence.workspace=await request(base,`/api/workspaces/${wid}`);
    assert.equal(evidence.workspace.domain.name,'客户甲 · 10 kV 三回排管工程');
    assert.deepEqual(evidence.workspace.domain.circuits.map(c=>c.system.voltage),[10000,10000,10000]);
    assert.equal(evidence.workspace.domain.sections[0].medium.surface_temperature,303.15);
  });
  await step('05-preflight','核对候选、输入来源和适用范围',async()=>{
    const command=page.getByRole('toolbar',{name:'工程命令'});
    evidence.commandButtons=await command.getByRole('button').allTextContents();
    await click(command.getByRole('button',{name:/运行|预检/}).first());
    await expect(preflight.getByText('你的工况在适用范围内 ✓',{exact:true})).toBeVisible({timeout:180000});
  });
  await step('06-selection',`运行真实IEC选型，读取是否满足${targetCurrent} A`,async()=>{
    await click(preflight.getByRole('button',{name:'确认并运行',exact:true}));
    await expect(page.locator('.study-selection-table').first()).toBeVisible({timeout:180000});
    evidence.conclusion=await page.getByLabel('结论',{exact:true}).innerText();
    const runs=await request(base,`/api/workspaces/${wid}/studies/${sid}/runs`);
    const savedInput=runs.items[0].snapshot.cases[0].input;
    evidence.saved_conditions={circuits:savedInput.circuits,sections:savedInput.sections,loads:savedInput.load_cases,materials:savedInput.materials};
    assert.deepEqual(savedInput.circuits.map(c=>c.system.voltage),[10000,10000,10000],'实际插件快照必须使用10 kV');
    if(reportFix){const raw=await fetch(`${base}/api/workspaces/${wid}/studies/${sid}/runs`);assert(raw.ok);await fs.writeFile(path.join(out,'saved-runs.json'),await raw.text());}
    evidence.runs=runs.items.map(run=>({id:run.id,status:run.status,integrity:run.integrity,output_digest:run.output_digest,
      assessment:run.output?.assessment,cases:run.output?.cases?.map(c=>({case_id:c.case_id,status:c.status,error:c.error,
        results:c.results?.filter(q=>['ampacity','conductor_temperature'].includes(q.key))}))}));
    assert.ok(runs.items.some(r=>['succeeded','partial'].includes(r.status)));
  });
  await step('07-basis','展开热路与标准常数出处，核对最热候选',async()=>{
    await click(page.getByRole('tab',{name:'结果详情',exact:true}));
    const details=page.locator('details').filter({has:page.locator('summary').getByText('热路 · K·m/W',{exact:true})});
    await click(details.locator('summary'));
    await click(page.locator('details').filter({has:page.locator('summary').getByText('材料常数与标准出处',{exact:false})}).locator('summary'));
    await expect(page.getByRole('table',{name:'材料常数与标准出处'})).toContainText('IEC 60287');
    evidence.basis=await page.locator('.heat-detail').innerText();
  });
  await step('08-gb-scope','尝试GB校正对照，保留排管未覆盖的限制',async()=>{
    await click(page.getByLabel('工程浏览器',{exact:true}).getByRole('button',{name:'新建研究',exact:true}));
    const dialog=page.getByRole('dialog',{name:'新建研究',exact:true});
    await click(dialog.getByRole('button',{name:'按 GB 50217 校正',exact:true}));
    await expect(dialog.getByLabel('方法适用范围')).toContainText('D.0.4 / D.0.5');
    await expect(dialog.getByLabel('方法适用范围')).toContainText('其他分支明确拒绝');
    evidence.gb={status:'scope_review_only',scope:await dialog.innerText(),reason:'排管未覆盖，仅核对清单范围，未运行校正或编造值'};
  });
  await page.keyboard.press('Escape');
  await step('09-customer-report','按所选保存运行生成并预览客户计算书',async()=>{
    const previewStarted=Date.now();
    await click(page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'生成计算书',exact:true}));
    await expect(page.getByRole('button',{name:'下载 PDF',exact:true})).toBeEnabled({timeout:90000});
    await expect(page.getByTitle('计算书预览',{exact:true})).toBeVisible();
    evidence.preview_seconds=(Date.now()-previewStarted)/1000;
  });
  await step('10-download','下载客户版PDF并核对实际文件',async()=>{
    const pending=page.waitForEvent('download');await click(page.getByRole('button',{name:'下载 PDF',exact:true}));
    const pdf=path.join(out,'customer.pdf');await (await pending).saveAs(pdf);
    assert.equal((await fs.readFile(pdf)).subarray(0,5).toString(),'%PDF-');evidence.pdf=pdf;
  });
  evidence.workflow_seconds=(Date.now()-started)/1000;evidence.workflow_clicks=evidence.clicks;
  if(reportFix){
    await click(page.getByRole('combobox',{name:'PDF 版本',exact:true}));await click(page.getByRole('option',{name:'内部审核版',exact:true}));
    const pending=page.waitForEvent('download');await click(page.getByRole('button',{name:'下载 PDF',exact:true}));await (await pending).saveAs(path.join(out,'internal.pdf'));
    const did=new URL(page.url()).searchParams.get('delivery');
    const savedBook=await fetch(`${base}/api/workspaces/${wid}/deliveries/${did}`);assert(savedBook.ok);await fs.writeFile(path.join(out,'delivery.json'),await savedBook.text());
    assert(reportPayload?.section_images?.length,'实际截面附图须随交付保存');
    const badSource={...reportPayload,request_id:crypto.randomUUID(),section_images:reportPayload.section_images.map(image=>({...image,case_id:'case-0'}))};
    const refusal=await fetch(`${base}/api/workspaces/${wid}/delivery-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(badSource)});
    assert(refusal.ok,'错配附图须进入真实交付来源校验，而非请求格式校验');
    let refused=await refusal.json();
    for(let i=0;i<200 && ['queued','running'].includes(refused.state);i++){
      await new Promise(resolve=>setTimeout(resolve,100));
      refused=await request(base,`/api/workspaces/${wid}/delivery-jobs/${refused.id}`);
    }
    evidence.inconsistentImage={status:refusal.status,job:refused};
    assert.equal(refused.state,'failed','其他候选的附图不能混入首页候选计算书');
    assert.equal(refused.error?.code,'REPORT_SOURCE_INCONSISTENT','拒绝须明确来自候选来源一致性门禁');
    assert(!refused.delivery_id,'错误附图不能生成交付');
    const checked=execFileSync(process.env.PYTHON || 'python',['-c',[
      'import json,re,sys,fitz',
      'from pathlib import Path',
      'from backend.kernel.report_selection import context',
      'from backend.kernel.study_pdf import validate_sources',
      'p=Path(sys.argv[1]);r=json.loads((p/"saved-runs.json").read_text(encoding="utf-8"))["items"][0]',
      'validate_sources([r]);s=context(r);metrics=["{:.1f}A".format(s["quantity"]["value"]),"{:.1f}°C".format(s["temperature_c"]),"{:.1f}K".format(s["margin_k"])]',
      'checks=[]',
      'for audience in ("customer","internal"):',
      ' with fitz.open(p/(audience+".pdf")) as pdf:',
      '  cover=re.sub(r"\\s+","",pdf[0].get_text());text="\\n".join(page.get_text() for page in pdf)',
      '  assert all(v in cover for v in metrics),(audience,metrics,cover)',
      '  target=r["snapshot"]["definition"]["driver"]["minimum"]',
      '  assert "90°C温限下允许电流" in cover',
      '  assert f"{target:g}A时最热导体温度" in cover and f"{target:g}A时温限余量" in cover',
      '  assert re.sub(r"\\s+","",s["candidate"]["payload"]["name"]) in cover',
      '  assert "全回路共同能力" in cover and "其他回路维持" not in cover',
      '  assert ("最接近，不满足" in cover)==(not s["recommended"])',
      '  assert "候选比较与推荐" in text and "保存负荷下的温度与损耗" in text',
      '  assert not re.search(r"(?:cable/|circuit/|cablesim\\.|\\+engineering)",text)',
      '  for i in range(len(pdf)):pdf[i].get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(p/f"{audience}-page-{i+1}.png")',
      '  checks.append({"audience":audience,"pages":len(pdf),"metrics":metrics,"case":s["case_id"]})',
      '(p/"pdf-source-check.json").write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding="utf-8")',
      'print("Real saved candidate and PDF cover/conclusion checked")',
    ].join('\n'),out],{cwd:repositoryRoot,encoding:'utf8'});
    console.log(checked);
    await fs.writeFile(path.join(out,'report-network.json'),JSON.stringify(reportNetwork,null,2));
  }
  }
  if(process.env.REAL_USE_WORKFLOW_ONLY!=='1')await step('11-fem-parameters','打开发布库实际有限元研究，修改并保存网格，核对三级分层',async()=>{
    const projects=await request(base,'/api/workspaces');let fem;
    for(const project of projects){fem=(await request(base,`/api/workspaces/${project.id}/studies`)).find(row=>row.definition.method.capability==='iec-thermal-field');if(fem)break;}
    assert(fem,'发布库须有真实有限元研究');
    await page.goto(`${base}/studies/${fem.id}/thermal-field/results?workspace=${fem.workspace}&theme=light&inspector=method`);
    const form=page.getByLabel('有限元方法参数',{exact:true});
    await expect(form).toBeVisible();
    const methods=await request(base,'/api/methods'),installed=methods.find(row=>row.method.plugin_id==='cablesim.simulation');
    const contract=await request(base,'/api/input-contracts');
    assert(installed,'当前安装仿真方法');
    if(!contract.some(row=>row.method.release_digest===fem.definition.method.release_digest)){
      await click(form.getByRole('combobox',{name:'方法版本',exact:true}));
      await click(page.getByRole('option').filter({hasText:'电缆有限元仿真'}).filter({hasText:installed.method.version}).first());
      evidence.method_choice={from:fem.definition.method.version,to:installed.method.version,source:'工程师在真实方法版本下拉框明确选择；未改写旧运行'};
    }
    await expect(form.locator('input[data-field-path="/mesh/size_m"]')).toBeVisible();
    await expect(form.locator('input[data-field-path="/mesh/far_size_m"]')).toBeVisible();
    await expect(form.locator('input[data-field-path="/mesh/transition_m"]')).toBeVisible();
    await expect(form.locator('input[data-field-path="/mesh/max_nodes"]')).toBeVisible();
    await expect(form.getByRole('combobox',{name:'侧边与底边',exact:true})).toBeVisible();
    await fill(form.locator('input[data-field-path="/mesh/size_m"]'),2.5);
    const persisted=page.waitForResponse(response=>response.request().method()==='PUT' && response.url().endsWith(`/api/workspaces/${fem.workspace}/studies/${fem.id}`));
    await click(page.getByRole('toolbar',{name:'工程命令'}).locator('[data-command-role=save]:visible'));
    const receipt=await persisted;
    evidence.mesh_save={status:receipt.status(),request:receipt.request().postDataJSON()};
    assert(receipt.ok(),'网格保存须返回真实成功回执');
    await expect(page.getByRole('toolbar',{name:'工程命令'}).locator('[data-command-role=save]:visible')).toHaveText('已保存');
    const saved=await request(base,`/api/workspaces/${fem.workspace}/studies/${fem.id}`);
    const configuration=saved.definition.modules?.['thermal-field'] || saved.definition;
    assert.equal(configuration.parameters.mesh.size_m,0.0025,'当前有限元模块的2.5 mm应保存为SI 0.0025 m');
    assert.equal(configuration.method.version,installed.method.version,'明确选择的方法版本应保存在该模块');
    evidence.saved_mesh_m=configuration.parameters.mesh.size_m;
    const advanced=form.locator('.parameter-advanced');assert.equal(await advanced.evaluate(n=>n.open),false);
    await click(advanced.locator('summary'));await expect(form.locator('input[data-field-path="/tolerance_k"]')).toBeVisible();
    evidence.fem={study:fem.id,fields:await form.locator('[data-field-path]').evaluateAll(nodes=>nodes.map(n=>n.dataset.fieldPath))};
    await page.screenshot({path:path.join(out,'fem-1366.png')});
    await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:path.join(out,'fem-1920.png')});
    await page.setViewportSize({width:1366,height:768});
  });
  assert.deepEqual(evidence.errors,[]);evidence.status='passed_with_scope_limit';
}catch(error){evidence.status='failed';evidence.failure={message:error.message,body:await page.locator('body').innerText()};await page.screenshot({path:path.join(out,'failure.png')});throw error;}
finally{evidence.elapsed_seconds=(Date.now()-started)/1000;await fs.writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));if(reportFix)await fs.writeFile(path.join(out,'report-network.json'),JSON.stringify(reportNetwork,null,2));await session.close();}
