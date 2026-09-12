import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const pid='cablesim.electrothermal-reference';
test.setTimeout(240_000);

async function prepare(request:APIRequestContext,r20:boolean){
 let w=await (await request.post('/api/workspaces',{data:{}})).json();
 if(r20){const edit=await request.post(`/api/workspaces/${w.id}/edit`,{data:{expected_revision:1,changes:[{path:'cable.r20_ohm_km',value:.0754}],label:'browser explicit R20'}});expect(edit.ok()).toBe(true);w=await edit.json()}
 let catalog=await (await request.get('/api/plugins/catalog')).json();let item=catalog.items.find((i:any)=>i.manifest.plugin_id===pid);expect(item).toBeTruthy();
 if(!item.installed){
  const planResponse=await request.post('/api/plugins/install-plan',{data:{plugin_id:pid,version:'0.1.0'}});expect(planResponse.ok()).toBe(true);const p=await planResponse.json();
  const installed=await request.post('/api/plugins/install',{data:{plugin_id:pid,version:'0.1.0',plan_sha256:p.plan_sha256,state_revision:p.state_revision,approved:true,license_acknowledged:true,grants:Object.fromEntries(p.plugins.map((i:any)=>[i.plugin_id,i.permissions]))}});expect(installed.ok()).toBe(true);
  catalog=await installed.json();item=catalog.items.find((i:any)=>i.manifest.plugin_id===pid);
 }
 let lock=await (await request.get(`/api/plugins/workspaces/${w.id}/lock`)).json();
 if(!lock.lock.plugins.some((p:any)=>p.plugin_id===pid&&p.release_sha256===item.release_sha256)){
  const enabled=await request.post(`/api/plugins/workspaces/${w.id}/enable`,{data:{plugin_id:pid,expected_revision:w.revision,lock_revision:lock.lock.lock_revision,enabled:true,approved:true}});expect(enabled.ok()).toBe(true);lock=await enabled.json();
 }
 return w;
}
async function open(page:Page,w:any){
 await page.goto(`/?mode=workbench&project=${w.id}`);await expect(page.getByTestId('session-revision')).toHaveText(`rev.${w.revision}`);
 await page.getByRole('button',{name:'搜索命令',exact:true}).click();await page.getByRole('combobox',{name:'搜索工程命令'}).fill('plugin');await page.getByRole('option',{name:/打开插件中心/}).click();
 const dialog=page.getByRole('dialog',{name:'当前工程插件中心'});await dialog.getByTestId(pid).click();await dialog.locator('.plugin-run>summary').click();return dialog;
}
async function fill(page:Page){
 for(const [label,value] of [['20°C电阻温度系数 K⁻¹','0.00393'],['电热研究导体热导率 W/(m·K)','380'],['电热研究屏蔽热导率 W/(m·K)','380']])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByLabel('电阻与损耗系数依据',{exact:true}).fill('Synthetic reference fixture; not manufacturer data');
}

test('electrothermal requires saved R20 and explicit coefficient consent',async({page,request})=>{
 const w=await prepare(request,false);const dialog=await open(page,w);await expect(dialog).toContainText('缺少明确的 R20');await fill(page);
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/invoke'))posts.push(r.url())});
 const run=dialog.getByRole('button',{name:'执行：运行电热反馈研究',exact:true});await expect(run).toBeDisabled();
 await dialog.getByRole('checkbox',{name:/我已核对电阻和损耗系数/}).check();await expect(run).toBeDisabled();expect(posts).toEqual([]);
 expect((await (await request.get(`/api/plugins/workspaces/${w.id}/jobs`)).json()).items).toEqual([]);
});

test('real ampacity bracket and larger-domain comparison render without promoting the result',async({page,request},info)=>{
 const w=await prepare(request,true),baseline=await (await request.get(`/api/workspaces/${w.id}`)).json();const dialog=await open(page,w);await expect(dialog).toContainText('0.0754 Ω/km');await fill(page);
 await expect(dialog.getByRole('button',{name:'执行：运行电热反馈研究',exact:true})).toBeDisabled();
 await dialog.getByRole('checkbox',{name:/我已核对电阻和损耗系数/}).check();
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.url().includes('/api/plugins/'));
 await dialog.getByRole('button',{name:'执行：运行电热反馈研究',exact:true}).click();const r=await response;expect(r.ok()).toBe(true);const out=await r.json();const s=out.result.summary;
 expect(out.status).toBe('succeeded');expect(s.ampacity_a).toBeGreaterThan(0);expect(s.bracket.lower_max_temperature_c).toBeLessThanOrEqual(90);expect(s.bracket.upper_max_temperature_c).toBeGreaterThan(90);expect(s.bracket.upper_a-s.bracket.lower_a).toBeLessThanOrEqual(.01);
 expect(s.complete_iec_60287).toBe(false);expect(s.electromagnetic_field_solved).toBe(false);expect(s.domain_comparison.mesh_independence_certified).toBe(false);expect(s.domain_comparison.infinite_domain_accuracy_certified).toBe(false);
 const panel=dialog.getByRole('region',{name:'电热反馈研究结果'}),metrics=panel.getByRole('region',{name:'电热反馈与电流反求'});
 await expect(panel.getByRole('img',{name:'三相电缆与土壤有限元温度场'})).toBeVisible();await expect(metrics).toContainText(s.ampacity_a.toFixed(2));
 await expect(metrics).toContainText(s.domain_comparison.ampacity_a.toFixed(2));expect(out.promoted_to_current_ampacity).toBe(false);
 await metrics.scrollIntoViewIfNeeded();await metrics.screenshot({path:info.outputPath('electrothermal-ampacity-summary.png')});await page.screenshot({path:info.outputPath('electrothermal-project.png')});
 await panel.getByRole('img').screenshot({path:info.outputPath('electrothermal-field.png')});
 const artifact=await request.get(`/api/plugins/workspaces/${w.id}/jobs/${out.job_id}/artifacts/field.json`);expect(artifact.ok()).toBe(true);const field=await artifact.json();expect(Math.max(...field.values)-273.15).toBeCloseTo(s.maximum_temperature_c,7);
 await info.attach('electrothermal-run.json',{body:JSON.stringify(out,null,2),contentType:'application/json'});
 expect(await (await request.get(`/api/workspaces/${w.id}`)).json()).toEqual(baseline);
 const accessibility=await new AxeBuilder({page}).include('.project-plugin-dialog').withTags(['wcag2a','wcag2aa']).analyze();expect(accessibility.violations).toEqual([]);
 await dialog.getByLabel('20°C电阻温度系数 K⁻¹',{exact:true}).fill('0.004');await expect(panel).toBeHidden();
});

test('operating point uses saved current and does not label it as ampacity',async({page,request})=>{
 const w=await prepare(request,true);const dialog=await open(page,w);await expect(dialog).toContainText('0.0754 Ω/km');await fill(page);
 await dialog.getByLabel('电热研究任务',{exact:true}).selectOption('operating-point');await dialog.getByRole('checkbox',{name:/我已核对电阻和损耗系数/}).check();
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.url().includes('/api/plugins/'));
 await dialog.getByRole('button',{name:'执行：运行电热反馈研究',exact:true}).click();const r=await response;expect(r.ok()).toBe(true);const out=await r.json();
 expect(out.result.summary.ampacity_a).toBeNull();expect(out.result.summary.domain_comparison).toBeNull();expect(out.result.summary.evaluated_current_a).toBe(w.scenario.operating_current_a);
 await expect(dialog.getByRole('region',{name:'电热反馈研究结果'})).toContainText('当前工程运行电流');
});
