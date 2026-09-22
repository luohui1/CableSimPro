import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';

async function enter(page:Page,request:APIRequestContext){
 const r=await request.post('/api/workspaces',{data:{}});expect(r.status()).toBe(201);const w=await r.json();
 await page.goto(`/?workflow=1&project=${w.id}`);
 await expect(page.getByRole('img',{name:'已保存工程的等比例电缆截面'})).toBeVisible();return w;
}

test('grouped inspector uses saved geometry, retained drafts and existing display assets',async({page,request},info)=>{
 const w=await enter(page,request);await page.setViewportSize({width:1600,height:1000});
 const nav=page.getByRole('navigation',{name:'工程对象'});
 await nav.getByRole('button',{name:'XLPE 绝缘',exact:true}).click();
 await expect(page.locator('.wf-brand-asset')).toBeVisible();
 expect(await page.locator('.wf-brand-asset').evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);
 await expect(page.locator('.wf-material-preview')).toBeVisible();
 const group=page.locator('.wf-property-group').filter({has:page.locator('summary',{hasText:'几何与结构'})});
 const input=page.getByLabel('绝缘厚度',{exact:true});await input.fill('6.8');
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())});
 await group.locator('summary').click();await expect(input).toBeHidden();await group.locator('summary').click();await expect(input).toHaveValue('6.8');
 await nav.getByRole('button',{name:'外护套',exact:true}).click();await expect(page.getByLabel('护套厚度',{exact:true})).toBeVisible();
 await nav.getByRole('button',{name:'XLPE 绝缘',exact:true}).click();await expect(input).toHaveValue('6.8');
 expect(posts).toEqual([]);expect((await (await request.get(`/api/workspaces/${w.id}`)).json()).revision).toBe(1);
 await page.getByRole('button',{name:'保存全部修改',exact:true}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');
 await expect(page.locator('.wf-object-measures')).toContainText('6.80');
 await page.screenshot({path:info.outputPath('refined-section-and-inspector.png')});
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
});

test('real refined WebGL, one toolbar, controlled selection and honest sample export',async({page,request},info)=>{
 await page.setViewportSize({width:1600,height:1000});const w=await enter(page,request);
 const nav=page.getByRole('navigation',{name:'工程对象'});await nav.getByRole('button',{name:'XLPE 绝缘',exact:true}).click();
 await page.getByRole('button',{name:'三维结构',exact:true}).click();
 const renderer=page.getByTestId('cable-model-view');await expect(renderer).toHaveAttribute('data-renderer','webgl');
 const canvas=renderer.locator('canvas');await canvas.evaluate(el=>(el as HTMLElement).dataset.identity='same-renderer');
 await expect(page.locator('.wf-model-toolbar-host').getByRole('toolbar',{name:'三维结构工具'})).toBeVisible();
 await expect(page.locator('.wf-canvas .model-toolbar')).toHaveCount(0);
 await expect(page.locator('.wf-refined-model')).toHaveAttribute('data-selected-layer','2');
 await expect(page.locator('.wf-refined-model')).toHaveAttribute('data-sample-length-m','0.24');
 await expect(renderer.locator('.model-callouts text').first()).toBeVisible();
 await page.screenshot({path:info.outputPath('refined-live-3d.png')});
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())});
 await nav.getByRole('button',{name:'外护套',exact:true}).click();await expect(page.locator('.wf-refined-model')).toHaveAttribute('data-selected-layer','5');
 await page.getByRole('button',{name:'放大模型',exact:true}).click();await page.getByRole('button',{name:'模型适合画布',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 GLB',exact:true}).click();
 const file=await download;const path=info.outputPath('refined-sample.glb');await file.saveAs(path);
 const bytes=await fs.readFile(path);expect(bytes.toString('ascii',0,4)).toBe('glTF');
 const jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
 const root=gltf.nodes.find((n:any)=>n.extras?.display_length_m);expect(root.extras.display_length_m).toBe(.24);expect(root.extras.not_route_length).toBe(true);
 const layerNodes=gltf.nodes.filter((n:any)=>n.extras?.outer_radius_m);expect(layerNodes).toHaveLength(6);
 expect(gltf.nodes.some((n:any)=>n.name?.includes('Selected layer')||n.name?.includes('shadow'))).toBe(false);
 const prepared=await (await request.get(`/api/foundation/workspaces/${w.id}/preflight?expected_revision=1`)).json();
 layerNodes.forEach((n:any,i:number)=>expect(n.extras.outer_radius_m).toBeCloseTo(prepared.package.geometry_recipe.layers[i].outer_radius_m,10));
 await page.getByLabel('三维结构展示方式',{exact:true}).selectOption('exploded');await expect(renderer).toHaveAttribute('data-renderer','webgl');
 await page.screenshot({path:info.outputPath('refined-live-exploded.png')});
 await page.getByLabel('三维结构展示方式',{exact:true}).selectOption('cutaway');await expect(renderer).toHaveAttribute('data-renderer','webgl');
 await nav.getByRole('button',{name:'R-001 · 稳态研究',exact:true}).click();await page.getByRole('tab',{name:'C-001 · 电缆',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-identity','same-renderer');expect(posts).toEqual([]);
 expect((await (await request.get(`/api/workspaces/${w.id}`)).json()).scenario).toEqual(w.scenario);
 for(const [width,height] of [[1366,768],[1093,615],[911,512]]){
  await page.setViewportSize({width,height});await expect(renderer).toHaveAttribute('data-renderer','webgl');
  const fit=page.getByRole('button',{name:'模型适合画布',exact:true});await expect(fit).toBeInViewport();
  const save=await page.getByRole('button',{name:'保存全部修改',exact:true}).boundingBox();expect(save!.y+save!.height).toBeLessThanOrEqual(height);
  await page.screenshot({path:info.outputPath(`refined-3d-${width}.png`)});
 }
 await page.setViewportSize({width:1600,height:1000});
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
});
