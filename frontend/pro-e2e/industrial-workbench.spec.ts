import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');}

test('industrial: elevated surfaces and material toggle keep the same live canvas without writes',async({page},info)=>{
 await enter(page);
 const surface=page.getByTestId('professional-mode');
 const stage=surface.locator('.enterprise-model-stage'),inspector=surface.locator('.enterprise-inspector');
 await expect(stage).toHaveCSS('border-top-width','0px');await expect(inspector).toHaveCSS('border-top-width','0px');
 expect(await stage.evaluate(e=>getComputedStyle(e).boxShadow)).not.toBe('none');
 const project=surface.locator('.wb-project-card'),hint=project.locator('b');
 const cardBox=(await project.boundingBox())!,hintBox=(await hint.boundingBox())!;
 expect(hintBox.y+hintBox.height).toBeLessThanOrEqual(cardBox.y+cardBox.height);
 await expect(inspector.locator('.property').first()).toHaveCSS('border-bottom-width','0px');
 const model=page.getByTestId('cable-model-view'),canvas=model.locator('canvas');
 await expect(model).toHaveAttribute('data-material-preset','studio-1');
 await canvas.evaluate(e=>e.setAttribute('data-retained','material-toggle'));
 const toggle=surface.getByRole('button',{name:'材质预览',exact:true});await expect(toggle).toHaveAttribute('aria-pressed','true');
 let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++});
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');
 await expect(canvas).toHaveAttribute('data-retained','material-toggle');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');expect(writes).toBe(0);
 await page.screenshot({path:info.outputPath('industrial-material-stage.png'),fullPage:true});
 const result=await new AxeBuilder({page}).include('.enterprise-model-stage').include('.enterprise-inspector').withTags(['wcag2a','wcag2aa']).analyze();
 expect(result.violations).toEqual([]);
});

test('industrial: material preview exports only six equivalent layers and edits stay live',async({page},info)=>{
 await enter(page);
 const canvas=page.getByTestId('cable-model-view').locator('canvas');await canvas.evaluate(e=>e.setAttribute('data-retained','material-edit'));
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 GLB',exact:true}).click();
 const file=await download,bytes=await readFile((await file.path())!);
 expect(bytes.readUInt32LE(0)).toBe(0x46546c67);expect(bytes.readUInt32LE(4)).toBe(2);
 expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8').trim());
 expect(gltf.meshes).toHaveLength(6);expect(gltf.textures??[]).toHaveLength(0);
 expect(gltf.nodes.some((n:{name?:string})=>n.name?.includes('shadow')||n.name?.includes('Material preview'))).toBe(false);
 const field=page.getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
 await expect(canvas).toHaveAttribute('data-retained','material-edit');
 await page.getByRole('button',{name:'截面对照',exact:true}).click();await expect(page.getByRole('region',{name:'当前电缆分层预览',exact:true})).toContainText('300 mm²');
 await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'分层展开',exact:true}).click();
 await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
 await page.screenshot({path:info.outputPath('industrial-exploded-live.png'),fullPage:true});
});
