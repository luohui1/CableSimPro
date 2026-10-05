import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openHeadlessBrowser, outputRoot, repositoryRoot, settle } from './browser.mjs';

const base = process.env.FRONTEND_URL || 'http://127.0.0.1:5175';
const output = path.join(outputRoot, 'components');
const reference = path.resolve(repositoryRoot, '..', '前端多版', 'kimi-vercel', 'screenshots');
await fs.mkdir(output, { recursive: true });
const session = await openHeadlessBrowser();
const checks = [];
try {
  const { page } = session;
  for (const theme of ['light','dark']) {
    await page.setViewportSize({width:1920,height:1080}); await page.goto(`${base}/gallery?theme=${theme}`); await settle(page);
    const layout = await page.evaluate(() => ({theme:document.documentElement.dataset.theme, width:innerWidth, height:innerHeight, documentOverflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight, mainOverflow:document.querySelector('.main-content').scrollWidth>document.querySelector('.main-content').clientWidth}));
    assert.equal(layout.documentOverflow,false); assert.equal(layout.mainOverflow,false); checks.push({surface:'gallery',...layout});
    await page.screenshot({path:path.join(output,`gallery-${theme}-1920.png`)});
  }
  const cdp=await session.context.newCDPSession(page);
  for (const scale of [1.25,1.5]) {
    for (const surface of ['gallery','gallery/selection']) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:Math.floor(1366/scale),height:Math.floor(768/scale),deviceScaleFactor:scale,mobile:false});
      await page.goto(`${base}/${surface}?theme=light&state=success&tab=results`); await settle(page);
      const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio,documentOverflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,mainOverflow:document.querySelector('.main-content').scrollWidth>document.querySelector('.main-content').clientWidth}));
      assert.equal(layout.documentOverflow,false); assert.equal(layout.mainOverflow,false); checks.push({surface,scale,kind:'CDP emulation, not Windows system DPI',...layout});
      await page.screenshot({path:path.join(output,`${surface==='gallery'?'gallery':'selection'}-scale-${scale*100}.png`)});
    }
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride'); await page.setViewportSize({width:1366,height:768});
  for(const theme of ['light','dark']) {
    await page.goto(`${base}/gallery/selection?theme=${theme}&state=success&tab=results`); await settle(page);
    const own=await page.screenshot({path:path.join(output,`selection-${theme}-1366.png`)});
    const original=await fs.readFile(path.join(reference,`selection-${theme}-1366.png`));
    await page.evaluate(({original,own})=>{
      const host=document.createElement('div'); host.id='comparison';
      const style=document.createElement('style'); style.textContent='body>*:not(#comparison){display:none!important}#comparison{display:grid;grid-template-columns:1366px 1366px;background:var(--panel);color:var(--text);font:inherit}#comparison figure{margin:0}#comparison figcaption{height:32px;padding:4px 16px;font-size:var(--text-note)}#comparison img{display:block;width:1366px;height:768px}';document.head.append(style);
      for(const [label,data] of [['kimi-vercel：只读原截图',original],['本次 frontend：定稿组件库',own]]){const figure=document.createElement('figure');const caption=document.createElement('figcaption');caption.textContent=label;const img=document.createElement('img');img.src='data:image/png;base64,'+data;figure.append(caption,img);host.append(figure);}document.body.append(host);
    },{original:original.toString('base64'),own:own.toString('base64')});
    await page.setViewportSize({width:2732,height:800}); await page.locator('#comparison img').last().evaluate(img=>img.decode());
    await page.screenshot({path:path.join(output,`selection-comparison-${theme}.png`)}); await page.setViewportSize({width:1366,height:768});
  }
  await fs.writeFile(path.join(output,'comparison-verification.json'),JSON.stringify({checks,reference,modifiedReference:false},null,2));
  console.log('已完成浅深色并排对比、陈列页 1920 检查、125/150% CDP 缩放模拟。Windows 系统 DPI 未实机验证。');
} finally { await session.close(); }
