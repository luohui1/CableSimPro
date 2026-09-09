import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile, writeFile} from 'node:fs/promises';
async function enter(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
}
async function capture(page:Page,file:string){await page.screenshot({path:file,fullPage:true});}
test('reference layout: approved image landmarks and native controls',async({page},info)=>{
 await page.setViewportSize({width:1586,height:992});await enter(page);
 await capture(page,info.outputPath('reference-default.png'));
 const selectors={header:'.ps-commandbar',rail:'.enterprise-outline',title:'.ps-view-heading',tabs:'.viewport-tabs',canvas:'[data-testid="cable-model-view"]',inspector:'.enterprise-inspector',results:'.ps-result-ribbon',footer:'.ref-status-footer'};
 const boxes:Record<string,{x:number;y:number;width:number;height:number}>= {};
 for(const [key,selector] of Object.entries(selectors)){const box=await page.locator(selector).boundingBox();expect(box,key).not.toBeNull();boxes[key]=box!;}
 await writeFile(info.outputPath('reference-landmarks.json'),JSON.stringify(boxes,null,2));
 expect(boxes.header.height).toBe(80);expect(boxes.rail.width).toBe(84);
 expect(boxes.title.x).toBeCloseTo(104,0);expect(boxes.inspector.x).toBeCloseTo(1196,0);
 expect(boxes.inspector.y).toBeCloseTo(boxes.title.y,0);
 await expect(page.locator('.enterprise-model-column')).toHaveCSS('border-top-width','0px');
 await expect(page.locator('.ps-view-heading h1')).toHaveCSS('font-weight','750');
 await expect(page.getByRole('img',{name:'当前三维坐标方向',exact:true})).toBeVisible();
 expect(boxes.tabs.y).toBeGreaterThanOrEqual(boxes.title.y+boxes.title.height-1);
 expect(boxes.canvas.width).toBeGreaterThan(1000);expect(boxes.canvas.height).toBeGreaterThan(475);
 expect(boxes.results.height).toBe(150);expect(boxes.results.y).toBeGreaterThanOrEqual(boxes.canvas.y+boxes.canvas.height-1);
 expect(boxes.footer.height).toBe(56);expect(boxes.footer.y+boxes.footer.height).toBeLessThanOrEqual(992);
 const island=(await page.getByRole('toolbar',{name:'模型工具'}).boundingBox())!;
 expect(island.y).toBeGreaterThan(boxes.canvas.y);expect(island.x+island.width).toBeLessThan(boxes.canvas.x+boxes.canvas.width);
 await expect(page.getByRole('button',{name:'计算载流量',exact:true})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const axe=await new AxeBuilder({page}).include('.reference-studio').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await info.attach('reference-axe.json',{body:JSON.stringify(axe),contentType:'application/json'});expect(axe.violations).toEqual([]);
});
test('reference layout: real solved result ribbon and analysis keep evidence and canvas',async({page},info)=>{
 await page.setViewportSize({width:1586,height:992});await enter(page);
 const canvas=page.getByTestId('cable-model-view').locator('canvas');await canvas.evaluate(e=>e.setAttribute('data-retained','reference'));
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');
 await page.getByRole('button',{name:'计算载流量',exact:true}).click();const data=await(await response).json();
 await expect(page.getByTestId('workbench-metrics')).toContainText(data.result.output.result.summary.ampacity_a.toFixed(1));
 const temperature=data.result.output.result.summary.operating_max_temperature_c;
 const inputs=data.result.output.result.input;
 const tracks=page.getByTestId('workbench-metrics').locator('progress');
 await expect(tracks).toHaveCount(2);
 expect(Number(await tracks.first().getAttribute('value'))).toBeCloseTo(temperature-inputs.installation.ambient_temperature_c,5);
 await expect(page.getByRole('button',{name:'计算载流量',exact:true})).toBeEnabled();
 await capture(page,info.outputPath('reference-computed.png'));
 await page.getByRole('button',{name:'查看分析',exact:true}).click();await expect(page.getByRole('img',{name:'当前运行径向温度曲线',exact:true})).toBeVisible();
 const ribbon=(await page.getByRole('region',{name:'当前结果摘要',exact:true}).boundingBox())!;
 const drawer=(await page.getByRole('region',{name:'结果分析',exact:true}).boundingBox())!;
 expect(ribbon.y+ribbon.height).toBeLessThanOrEqual(drawer.y+1);
 await expect(page.locator('.ps-analysis-drawer .scientific-chart')).toHaveAttribute('data-layout','compact');
 await capture(page,info.outputPath('reference-analysis.png'));
 await expect(canvas).toHaveAttribute('data-retained','reference');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出计算书',exact:true}).click();
 const file=await download;expect(await readFile((await file.path())!,'utf8')).toContain(data.result.output.result.input_sha256);
 await page.getByRole('button',{name:'关闭结果分析',exact:true}).click();
 const field=page.getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
 await expect(page.getByTestId('workbench-metrics').locator('.wb-metric strong').first()).toContainText('—');
 await expect(page.getByTestId('workbench-metrics').locator('progress')).toHaveCount(0);
 await expect(canvas).toHaveAttribute('data-retained','reference');
});
test('reference layout: model tree, tool island, commands and GLB remain interactive',async({page},info)=>{
 await page.setViewportSize({width:1586,height:992});await enter(page);
 let posts=0;page.on('request',r=>{if(r.method()==='POST')posts++});
 await page.getByRole('button',{name:'模型树',exact:true}).click();await expect(page.getByRole('region',{name:'电缆模型树'}).getByRole('button')).toHaveCount(6);
 await page.getByRole('region',{name:'电缆模型树'}).getByRole('button',{name:/XLPE/}).click();await expect(page.getByLabel('绝缘厚度',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'分层展开',exact:true}).click();await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
 await capture(page,info.outputPath('reference-layer-inspection.png'));
 await page.locator('.ps-layer-menu>summary').click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 GLB',exact:true}).click();
 const glb=await readFile((await(await download).path())!);expect(glb.readUInt32LE(0)).toBe(0x46546c67);
 const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString('utf8'));expect(json.meshes.length).toBe(6);expect(json.textures??[]).toHaveLength(0);
 await page.locator('.ps-layer-menu>summary').click();await page.getByRole('button',{name:'搜索命令',exact:true}).click();
 await page.getByRole('combobox',{name:'搜索工程命令'}).fill('温度');await capture(page,info.outputPath('reference-command-center.png'));
 expect(posts).toBe(0);
});
test('reference layout: laptop and narrow screens keep commands, inputs and status reachable',async({page},info)=>{
 await page.setViewportSize({width:1366,height:768});await enter(page);await capture(page,info.outputPath('reference-1366.png'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.setViewportSize({width:390,height:844});await capture(page,info.outputPath('reference-390.png'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const field=page.getByLabel('导体截面积',{exact:true});await field.scrollIntoViewIfNeeded();await field.fill('');
 await expect(page.getByRole('button',{name:'计算载流量',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
 await expect(field).toHaveCSS('font-size','16px');
 await page.getByRole('button',{name:'撤销未提交输入',exact:true}).click();await expect(field).toHaveValue('240');
});
