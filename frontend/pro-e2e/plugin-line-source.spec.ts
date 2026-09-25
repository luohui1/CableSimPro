import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('successful buried FEM job is independently compared without changing the project',async({page,request},info)=>{
 const w=await (await request.post('/api/workspaces',{data:{}})).json();
 const plan=await (await request.post('/api/plugins/install-plan',{data:{plugin_id:'cablesim.line-source-crosscheck',version:'0.1.0'}})).json();
 expect(plan.plugins.map((p:any)=>p.plugin_id)).toEqual(['cablesim.buried-reference','cablesim.line-source-crosscheck']);
 const install=await request.post('/api/plugins/install',{data:{plugin_id:plan.plugin_id,version:plan.version,state_revision:plan.state_revision,plan_sha256:plan.plan_sha256,approved:true,license_acknowledged:true,grants:Object.fromEntries(plan.plugins.map((p:any)=>[p.plugin_id,p.permissions]))}});expect(install.ok()).toBe(true);
 let lock=await (await request.get(`/api/plugins/workspaces/${w.id}/lock`)).json();
 const enabled=await request.post(`/api/plugins/workspaces/${w.id}/enable`,{data:{plugin_id:plan.plugin_id,expected_revision:1,lock_revision:lock.lock.lock_revision,enabled:true,approved:true}});expect(enabled.ok()).toBe(true);lock=await enabled.json();
 const source=await request.post(`/api/plugins/workspaces/${w.id}/invoke`,{data:{plugin_id:'cablesim.buried-reference',command:'skfem.buried-reference',request_id:crypto.randomUUID(),expected_revision:1,lock_sha256:lock.lock_sha256,arguments:{conductor_powers_w_m:[20,20,20],conductor_k_w_m_k:380,metal_screen_k_w_m_k:380,domain_scale:8,resolution:16},confirmed:true}});expect(source.ok()).toBe(true);const buried=await source.json();
 await page.goto(`/?mode=workbench&project=${w.id}`);await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'搜索命令',exact:true}).click();await page.getByRole('combobox',{name:'搜索工程命令'}).fill('plugin');await page.getByRole('option',{name:/打开插件中心/}).click();
 const dialog=page.getByRole('dialog',{name:'当前工程插件中心'});await dialog.getByTestId('cablesim.line-source-crosscheck').click();await dialog.locator('.plugin-run>summary').click();
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.request().postDataJSON()?.command==='validation.line-source-buried');
 await dialog.getByRole('button',{name:'执行：核对半空间线热源解析温升',exact:true}).click();const compared=await (await response).json();
 const panel=dialog.getByRole('region',{name:'半空间线热源交叉核对结果'});await expect(panel).toBeVisible();
 await expect(panel).toContainText(compared.result.summary.maximum_absolute_difference_k.toFixed(4));
 await expect(panel).toContainText('差异不是自动合格判据');
 expect(compared.result.summary.engineering_acceptance).toBe(false);expect(compared.promoted_to_current_ampacity).toBe(false);
 await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:info.outputPath('line-source-crosscheck.png')});
 const a11y=await new AxeBuilder({page}).include('.project-plugin-dialog').withTags(['wcag2a','wcag2aa']).analyze();expect(a11y.violations).toEqual([]);
 const after=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(after.revision).toBe(1);expect(after.scenario).toEqual(w.scenario);expect(after.runs).toEqual([]);
 const artifact=await request.get(`/api/plugins/workspaces/${w.id}/jobs/${compared.job_id}/artifacts/line-source.json`);expect(artifact.ok()).toBe(true);const report=await artifact.json();
 expect(report.source_job_id).toBe(buried.job_id);expect(report.maximum_absolute_difference_k).toBeGreaterThan(.4);expect(report.maximum_absolute_difference_k).toBeLessThan(.7);
 await info.attach('line-source-report.json',{body:JSON.stringify(report),contentType:'application/json'});
});
