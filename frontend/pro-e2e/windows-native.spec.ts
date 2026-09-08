import {test,expect} from '@playwright/test';
test('Windows renders Chinese with real sans fonts at configured device scale',async({page},info)=>{
 await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const doc=await cdp.send('DOM.getDocument');
 const node=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'.property-title label'});
 const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
 expect(fonts.fonts.some((f:{glyphCount:number})=>f.glyphCount>0)).toBe(true);
 expect(fonts.fonts.filter((f:{familyName:string;glyphCount:number})=>f.glyphCount>0&&/SimSun|Times New Roman|宋体/i.test(f.familyName))).toEqual([]);
 const layout=await page.evaluate(()=>({scale:devicePixelRatio,width:innerWidth,scroll:document.documentElement.scrollWidth,userAgent:navigator.userAgent,font:getComputedStyle(document.querySelector('.property-title label')!).fontFamily}));
 expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);expect(layout.scale).toBe(info.project.use.deviceScaleFactor);
 await info.attach('windows-fonts-and-scale.json',{body:JSON.stringify({fonts,layout},null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('windows-model-input.png'),fullPage:true});
});
