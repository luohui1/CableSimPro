import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function enter(page:Page,wid?:string){
 if(wid)await page.goto(`/?mode=workbench&project=${wid}`);
 else{await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click()}
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
}
async function open(page:Page){
 await page.getByRole('button',{name:'搜索命令',exact:true}).click();
 await page.getByRole('combobox',{name:'搜索工程命令'}).fill('plugin');
 await page.getByRole('option',{name:/打开插件中心/}).click();
 const dialog=page.getByRole('dialog',{name:'当前工程插件中心'});await expect(dialog).toBeVisible();return dialog;
}
async function install(request:APIRequestContext,w:any){
 const r=await request.post('/api/plugins/install-plan',{data:{plugin_id:'cablesim.thermal2d',version:'0.1.1'}});expect(r.ok()).toBe(true);const p=await r.json();
 const installed=await request.post('/api/plugins/install',{data:{plugin_id:p.plugin_id,version:p.version,state_revision:p.state_revision,plan_sha256:p.plan_sha256,approved:true,license_acknowledged:true,grants:Object.fromEntries(p.plugins.map((i:any)=>[i.plugin_id,i.permissions]))}});expect(installed.ok()).toBe(true);
 const lock=await (await request.get(`/api/plugins/workspaces/${w.id}/lock`)).json();
 const enabled=await request.post(`/api/plugins/workspaces/${w.id}/enable`,{data:{plugin_id:'cablesim.thermal2d',expected_revision:w.revision,lock_revision:lock.lock.lock_revision,enabled:true,approved:true}});expect(enabled.ok()).toBe(true);
}

test('project plugin center preserves the same canvas and does not run hidden commands',async({page},info)=>{
 await enter(page);const canvas=page.getByTestId('cable-model-view').locator('canvas');await expect(canvas).toBeVisible();
 await canvas.evaluate(el=>(el as HTMLElement).dataset.beforePlugins='retained');
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
 const dialog=await open(page);await expect(dialog.getByLabel('当前项目',{exact:true})).toBeDisabled();
 await page.screenshot({path:info.outputPath('project-plugin-center.png')});
 const result=await new AxeBuilder({page}).include('.project-plugin-dialog').withTags(['wcag2a','wcag2aa']).analyze();expect(result.violations).toEqual([]);
 await page.keyboard.press('F9');await page.keyboard.press('Control+k');expect(writes).toEqual([]);
 for(let i=0;i<12;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true)}
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(canvas).toHaveAttribute('data-before-plugins','retained');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('unsaved project input blocks plugin execution instead of using the old snapshot',async({page})=>{
 await enter(page);
 const input=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await input.fill('999999');await input.press('Tab');
 await expect(input).toHaveAttribute('aria-invalid','true');
 const dialog=await open(page);await expect(dialog).toContainText('未提交参数');
 await dialog.getByTestId('cablesim.thermal2d').click();await dialog.locator('.plugin-run>summary').click();
 await expect(dialog.getByRole('button',{name:/^执行：/})).toBeDisabled();
 await page.keyboard.press('Escape');await expect(input).toHaveValue('999999');
});

test('real mesh and FEM artifact render with verified hashes without creating ampacity',async({page,request},info)=>{
 const w=await (await request.post('/api/workspaces',{data:{}})).json();await install(request,w);
 const lock=await (await request.get(`/api/plugins/workspaces/${w.id}/lock`)).json();
 const meshResponse=await request.post(`/api/plugins/workspaces/${w.id}/invoke`,{data:{plugin_id:'cablesim.gmsh',command:'gmsh.cable-section',request_id:crypto.randomUUID(),expected_revision:1,lock_sha256:lock.lock_sha256,arguments:{resolution:16},confirmed:true}});
 expect(meshResponse.ok()).toBe(true);const mesh=await meshResponse.json();expect(mesh.status).toBe('succeeded');
 await enter(page,w.id);const dialog=await open(page);await dialog.getByTestId('cablesim.thermal2d').click();await dialog.locator('.plugin-run>summary').click();
 await dialog.getByLabel('来源任务',{exact:true}).selectOption(mesh.job_id);
 for(const [label,value] of [['导体发热功率 W/m','20'],['缆表温度 °C','30'],['导体热导率 W/(m·K)','380'],['金属屏蔽热导率 W/(m·K)','380']])await dialog.getByLabel(label,{exact:true}).fill(value);
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.url().includes('/api/plugins/'));
 await dialog.getByRole('button',{name:/^执行：/}).click();const execution=await (await response).json();expect(execution.status).toBe('succeeded');
 const panel=dialog.getByRole('region',{name:'插件研究结果'});const field=dialog.getByRole('img',{name:'已求解的有限元截面温度场'});
 await expect(field).toBeVisible();await expect(panel).toContainText(execution.result.summary.maximum_temperature_c.toFixed(4));
 expect(execution.result.summary.ampacity_a).toBeNull();
 await panel.scrollIntoViewIfNeeded();
 const fieldBox=await field.boundingBox(),topBox=await dialog.locator('.plugin-top').boundingBox();
 expect(fieldBox!.y).toBeGreaterThanOrEqual(topBox!.y+topBox!.height);
 expect(fieldBox!.y+fieldBox!.height).toBeLessThanOrEqual((await page.viewportSize())!.height);
 await page.screenshot({path:info.outputPath('project-plugin-fem.png')});
 await panel.screenshot({path:info.outputPath('plugin-fem-detail.png')});
 const requests:string[]=[];page.on('request',r=>{if(r.method()==='POST')requests.push(r.url())});
 await panel.getByRole('button',{name:'显示网格',exact:true}).click();expect(requests).toEqual([]);
 const artifact=await request.get(`/api/plugins/workspaces/${w.id}/jobs/${execution.job_id}/artifacts/field.json`);expect(artifact.ok()).toBe(true);
 const value=await artifact.json();expect(Math.max(...value.values)-273.15).toBeCloseTo(execution.result.summary.maximum_temperature_c,7);
 expect(value.association).toBe('node');expect(value.unit).toBe('K');
 await info.attach('real-plugin-run.json',{body:JSON.stringify(execution),contentType:'application/json'});
 await info.attach('real-plugin-field.json',{body:JSON.stringify(value),contentType:'application/json'});
 const after=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(after.revision).toBe(1);expect(after.scenario).toEqual(w.scenario);expect(after.runs).toEqual([]);
 await dialog.getByLabel('导体发热功率 W/m',{exact:true}).fill('40');await expect(panel).toBeHidden();
});

test('mobile project plugin dialog remains within viewport',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 // Same host event dispatched by the command menu; tests the dialog on the agent shell too.
 await page.evaluate(()=>window.dispatchEvent(new Event('csp:open-plugins')));
 const dialog=page.getByRole('dialog',{name:'当前工程插件中心'});await expect(dialog).toBeVisible();
 const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(391);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('project-plugin-mobile.png')});await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
});
