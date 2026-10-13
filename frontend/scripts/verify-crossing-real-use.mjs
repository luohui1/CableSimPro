// Real installed IEC plugin, private copy of the official release seed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect as baseExpect} from '@playwright/test';
import {openHeadlessBrowser,repositoryRoot,settle} from './browser.mjs';
import {request} from './research-fixtures.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('必须使用隔离发布库');
const base=process.env.FRONTEND_URL,out=path.resolve(repositoryRoot,process.env.CROSSING_OUTPUT || '.data/fix-round/research/crossing-real-use');
await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session,expect=baseExpect.configure({timeout:30000});
const reviewOnly=process.env.CROSSING_REVIEW_ONLY==='1';
const evidence=reviewOnly ? JSON.parse(await fs.readFile(path.join(out,'record.json'),'utf8')) : {steps:[],clicks:0,errors:[],source:process.env.E2E_DATABASE_SOURCE};
delete evidence.failure;delete evidence.screen;
page.on('pageerror',error=>evidence.errors.push(error.message));
const api=endpoint=>request(base,endpoint);
async function click(node){await node.click();evidence.clicks++;}
async function capture(name){if(name!=='failed'){await expect(page.getByRole('toolbar',{name:'工程命令',includeHidden:true})).toBeVisible();if(['baseline','crossing-result','crossing-basis'].includes(name)){await click(page.getByRole('button',{name:'敷设截面',exact:true}));await expect(page.locator('.drawing-svg')).toBeVisible();}}
  for(const width of [1366,1920]){await page.setViewportSize({width,height:width===1366?768:1080});await settle(page);
  const labels=await page.locator('.explorer-calc').evaluateAll(rows=>rows.map(row=>{const label=row.querySelector('b'),state=row.querySelector('.explorer-state');return label&&state?{height:label.getBoundingClientRect().height,line:Number.parseFloat(getComputedStyle(label).lineHeight),nameBottom:label.getBoundingClientRect().bottom,stateTop:state.getBoundingClientRect().top,title:row.title}:null;}).filter(Boolean));
  for(const label of labels){assert(label.height<=label.line*1.2,'研究名应为一行');assert(label.stateTop>=label.nameBottom-1,'状态应在名称下方');assert(label.title,'省略名称须保留完整悬停说明');}
  await page.screenshot({path:path.join(out,`${name}-${width}.png`),animations:'disabled'});}await page.setViewportSize({width:1366,height:768});}
async function step(name,work){const start=Date.now(),clicks=evidence.clicks;try{await work();evidence.steps.push({name,status:'passed',seconds:(Date.now()-start)/1000,clicks:evidence.clicks-clicks});console.log(JSON.stringify(evidence.steps.at(-1)));}catch(error){evidence.steps.push({name,status:'failed',seconds:(Date.now()-start)/1000,error:String(error)});await capture('failed');throw error;}finally{await fs.writeFile(path.join(out,'record.json'),JSON.stringify(evidence,null,2));}}
async function open(study){await page.goto(`${base}/studies/${study.id}/ampacity/results?workspace=${study.workspace}&theme=light`);await expect(page.getByLabel('属性',{exact:true})).toBeVisible();}
async function addHeat(){const inspector=page.getByLabel('属性',{exact:true});await click(inspector.getByRole('button',{name:'添加',exact:true}));
  for(const[label,value]of [['热源名称','交叉热力管道 · 工程师给定'],['热源轴线埋深','1.5'],['热源外径','0.1'],['交叉角','90'],['单位长度发热','20'],['参数来源','工程师给定场景：轴线埋深1.5 m、外径0.1 m、正交90°、固定发热20 W/m；非厂家额定数据']]){
    const input=inspector.getByRole('textbox',{name:label,exact:true});await input.fill(value);await input.press('Tab');
  }
  await page.keyboard.press('Control+s');await expect(page.getByRole('toolbar',{name:'工程命令'}).locator('[data-command-role=save]:visible')).toHaveText('已保存');
}
async function useInstalledMethod(){const inspector=page.getByLabel('属性',{exact:true});
  await click(inspector.getByRole('tab',{name:'方法',exact:true}));
  await click(inspector.getByRole('combobox',{name:'方法版本',exact:true}));
  await click(page.getByRole('option').filter({hasText:'IEC 60287'}).filter({hasNotText:'保存版本'}).first());
  await click(inspector.getByRole('tab',{name:'输入',exact:true}));
}
async function run(study,name){await click(page.getByRole('button',{name:'预检并运行',exact:true}));const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});await expect(dialog).toContainText('你的工况在适用范围内',{timeout:180000});await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:180000});let rid;
  await expect.poll(async()=>{const runs=await api(`/api/workspaces/${study.workspace}/studies/${study.id}/runs`);rid=runs.items.find(row=>row.status==='succeeded'&&row.freshness==='current')?.id;return !!rid;},{timeout:180000}).toBe(true);
  const saved=await api(`/api/workspaces/${study.workspace}/studies/${study.id}/runs/${rid}`);await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(saved,null,2));return saved;
}
try{
  await page.setViewportSize({width:1366,height:768});const studies=[];
  for(const project of await api('/api/workspaces'))studies.push(...await api(`/api/workspaces/${project.id}/studies`));
  await fs.writeFile(path.join(out,'studies.json'),JSON.stringify(studies,null,2));
  const hv=studies.find(row=>(row.title || row.definition?.title || '').includes('110 kV'));assert(hv,'发布种子须含城南110 kV研究');
  let three=hv;
  if(!reviewOnly){
  await step('110kV输入与适用范围实测',async()=>{await open(hv);await useInstalledMethod();await addHeat();await capture('110-input');await click(page.getByRole('button',{name:'预检并运行',exact:true}));const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});await expect(dialog).toContainText('接触电缆组',{timeout:180000});await expect(dialog).toContainText('第 1 条');await expect(dialog).toContainText('三维热仿真');await expect(dialog.getByRole('button',{name:'确认并运行',exact:true})).toBeDisabled();evidence.hv={study:hv.title,scope:await dialog.innerText(),status:'not_applicable',reason:'接触品字形不严格满足叠加原理；IEC 60287-3-3:2007 第1条说明直接计算偏乐观；未生成降额值或计算书'};await capture('110-scope');await page.keyboard.press('Escape');});
  if(process.env.CROSSING_CITY_ONLY==='1'){assert.deepEqual(evidence.errors,[]);process.exitCode=0;}
  else {
  await step('从真实三芯型号建立支持范围内研究',async()=>{
    const type=(await api('/api/design/type-workspaces')).find(row=>row.name.includes('YJV22'));assert(type);
    await page.goto(`${base}/types/${type.id}/structure/table?theme=light`);await expect(page.locator('[data-type-card]')).toBeVisible();
    const use=page.getByRole('button',{name:'用于载流量研究',exact:true});
    if(await use.isVisible())await click(use);else{await click(page.getByRole('button',{name:'更多操作',exact:true}));await click(page.getByRole('menuitem',{name:'用于载流量研究',exact:true}));}
    const dialog=page.getByRole('dialog',{name:'新建研究',exact:true});await dialog.getByRole('textbox',{name:'研究名称',exact:true}).fill('三芯直埋 · 交叉热源实测');
    await click(dialog.getByRole('combobox',{name:'方法参数来源',exact:true}));await click(page.getByRole('option',{name:/沿用最近研究/}));await dialog.getByRole('checkbox',{name:'已核对直埋模板条件',exact:true}).check();evidence.clicks++;
    const response=page.waitForResponse(r=>r.url().endsWith(`/api/workspaces/${type.id}/studies`)&&r.request().method()==='POST');await click(dialog.getByRole('button',{name:'建立研究',exact:true}));three=await(await response).json();assert(three.id);evidence.supportedStudy=three;
  });
  let baseline,derated;
  await step('三芯直埋基准真实运行',async()=>{await open(three);baseline=await run(three,'baseline-run');await capture('baseline');});
  await step('添加交叉热源并预检运行',async()=>{await addHeat();await capture('three-input');derated=await run(three,'crossing-run');evidence.conclusion=await page.getByLabel('结论',{exact:true}).innerText();await capture('crossing-result');});
  await step('保存依据与降额一致性',async()=>{const values=run=>run.output.cases[0].results;const amp=run=>values(run).find(row=>row.key==='ampacity'&&row.status==='available').value;evidence.baselineA=amp(baseline);evidence.deratedA=amp(derated);assert(evidence.deratedA<evidence.baselineA);assert(evidence.deratedA>0);const source=derated.snapshot.definition.parameters.crossing_heat_sources[0];assert(source.source.includes('非厂家额定'));assert.equal(source.angle_rad,Math.PI/2,'90°必须保存为SI弧度');await click(page.getByRole('tab',{name:'结果详情',exact:true}));await expect(page.locator('body')).toContainText('60287-3-3');await capture('crossing-basis');});
  await step('生成预览与下载真实客户计算书',async()=>{const start=Date.now();await click(page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'生成计算书',exact:true}));await expect(page.getByRole('button',{name:'下载 PDF',exact:true})).toBeEnabled({timeout:90000});await expect(page.getByTitle('计算书预览',{exact:true})).toBeVisible();evidence.previewSeconds=(Date.now()-start)/1000;const download=page.waitForEvent('download');await click(page.getByRole('button',{name:'下载 PDF',exact:true}));await(await download).saveAs(path.join(out,'customer.pdf'));assert.equal((await fs.readFile(path.join(out,'customer.pdf'))).subarray(0,5).toString(),'%PDF-');await capture('report');});
  }
  }
  if(process.env.CROSSING_CITY_ONLY!=='1'){
  await step('逐页核对真实计算书',async()=>{
    const result=execFileSync(process.env.PYTHON || 'python',['-c',[
      'import json,re,sys,fitz',
      'from pathlib import Path',
      'p=Path(sys.argv[1]);r=json.loads((p/"crossing-run.json").read_text(encoding="utf-8"));c=r["output"]["cases"][0]["artifacts"]["x-cablesim.iec60287-trace"]["crossing_derating"][0]',
      'd=fitz.open(p/"customer.pdf");cover=re.sub(r"\\s+","",d[0].get_text());text=re.sub(r"\\s+","","".join(v.get_text() for v in d))',
      'assert all(v in cover for v in ("90°C温限下降额前允许电流","90°C温限下降额后允许电流","交叉降额系数"))',
      'assert "0A工况" not in cover and "最热导体温度" not in cover and "未提供" not in cover',
      'assert all(v in cover for v in ("{:.1f}A".format(c["baseline_current_a"]),"{:.1f}A".format(c["derated_current_a"]),"{:.4f}".format(c["derating_factor"])))',
      'assert all(v in text for v in ("IEC60287-3-3:2007","非厂家额定数据","1.500","20.00","交叉热源降额"))',
      'assert not re.search(r"cable/|circuit/|cablesim\\.|\\+engineering|crossing_heat_sources",text)',
      'for i in range(min(2,len(d))):d[i].get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(p/f"customer-page-{i+1}.png")',
      'print(json.dumps({"pages":len(d),"factor":c["derating_factor"],"crossingRiseK":c["crossing_rise_k"],"source":c["sources"]},ensure_ascii=False))',
    ].join('\n'),out],{cwd:repositoryRoot,encoding:'utf8'});evidence.pdfCheck=JSON.parse(result);console.log(result.trim());
  });
  await step('校验失败普通层与追溯层分开',async()=>{
    const diagnostic='电缆实体建模：源码与清单摘要不一致 · src/cablesim_cable_geometry/main.py';
    await page.route('**/api/input-contracts',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:{code:'PLUGIN_SEAL_INVALID',message:diagnostic}})}));
    const scan=studies.find(row=>row.definition?.driver.kind==='sweep');assert(scan,'使用已有真实参数扫描研究校验错误显示');
    await page.goto(`${base}/studies/${scan.id}/sweep/settings?workspace=${scan.workspace}&theme=light&inspector=method`);
    const notice=page.getByRole('alert').filter({hasText:'电缆实体建模插件校验失败'});await expect(notice.first()).toBeVisible();await expect(notice.first()).not.toContainText('src/');
    const trace=page.locator('details').filter({has:page.locator('summary').getByText('插件校验追溯',{exact:true})}).first();await expect(trace).toBeVisible();await expect(trace.locator('.study-detail-content')).toBeHidden();await capture('error-layer');await click(trace.locator('summary'));await expect(trace).toContainText(diagnostic);
    evidence.errorState={mode:'仅封签失败状态使用拦截响应，未用于任何计算',diagnostic};await page.unroute('**/api/input-contracts');
  });
  assert.deepEqual(evidence.errors,[]);
  }
}catch(error){evidence.failure=String(error.stack||error);evidence.screen=await page.locator('body').innerText();console.error(evidence.failure);process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'record.json'),JSON.stringify(evidence,null,2));await session.close();}
