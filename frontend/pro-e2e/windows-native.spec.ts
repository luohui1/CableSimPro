import {test,expect} from '@playwright/test';
test('Windows renders Chinese with real sans fonts at configured device scale',async({page,request},info)=>{
 const created=await request.post('/api/workspaces',{data:{}});expect(created.ok()).toBe(true);const w=await created.json();
 await page.goto(`/?project=${w.id}`);await expect(page.getByTestId('workflow-revision')).toHaveText('rev.1');
 await page.getByRole('navigation',{name:'工程对象'}).getByRole('button',{name:'XLPE 绝缘',exact:true}).click();
 const selector='.wf-property label';await expect(page.locator(selector).first()).toBeVisible();
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const doc=await cdp.send('DOM.getDocument');
 const node=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
 const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
 expect(fonts.fonts.some((f:{glyphCount:number})=>f.glyphCount>0)).toBe(true);
 expect(fonts.fonts.filter((f:{familyName:string;glyphCount:number})=>f.glyphCount>0&&/SimSun|Times New Roman|宋体/i.test(f.familyName))).toEqual([]);
 const layout=await page.evaluate(s=>({scale:devicePixelRatio,width:innerWidth,scroll:document.documentElement.scrollWidth,userAgent:navigator.userAgent,font:getComputedStyle(document.querySelector(s)!).fontFamily}),selector);
 expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);expect(layout.scale).toBe(info.project.use.deviceScaleFactor);
 await info.attach('windows-fonts-and-scale.json',{body:JSON.stringify({fonts,layout},null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('windows-model-input.png')});
});
