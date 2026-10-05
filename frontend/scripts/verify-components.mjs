import { expect as playwrightExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, outputRoot, settle } from './browser.mjs';

const base = process.env.FRONTEND_URL || 'http://127.0.0.1:5175';
const expect = playwrightExpect.configure({ timeout: 10000 });
const output = path.join(outputRoot, 'components');
await fs.mkdir(output, { recursive: true });
const session = await openHeadlessBrowser();
const { page, context } = session;
const errors = [], external = new Set(), api = new Set(), captures = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
page.on('request', request => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.origin !== new URL(base).origin) external.add(request.url()); if (url.pathname.startsWith('/api')) api.add(request.url()); });
const selectionUrl = (theme = 'light', state = 'success') => `${base}/gallery/selection?theme=${theme}&state=${state}&tab=results`;
async function assertLayout() {
  const layout = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('button, h1, h2, h3, td, th, p, span, dt, dd, label')].filter(el => el.textContent.trim() && el.getBoundingClientRect().height > 0);
    const r = document.querySelector('.work-panel').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, documentOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight, minimumFont: Math.min(...visible.map(el => Number.parseFloat(getComputedStyle(el).fontSize))), fontsLoaded: document.fonts.check('14px "Noto Sans SC"'), panel: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, rail: document.querySelector('.nav-rail').getBoundingClientRect().width, bodyFont: getComputedStyle(document.body).fontFamily, horizontalContentOverflow: document.querySelector('.main-content').scrollWidth > document.querySelector('.main-content').clientWidth };
  });
  expect(layout.documentOverflow).toBe(false); expect(layout.minimumFont).toBeGreaterThanOrEqual(13); expect(layout.fontsLoaded).toBe(true); expect(layout.panel.right).toBeLessThanOrEqual(layout.width); expect(layout.panel.bottom).toBeLessThanOrEqual(layout.height); expect(layout.rail).toBe(56); expect(layout.horizontalContentOverflow).toBe(false);
  checks.push({ url: page.url(), ...layout });
}
async function capture(filename) { await settle(page); await assertLayout(); await page.screenshot({ path: path.join(output, filename), fullPage: true }); captures.push(filename); console.log(`已截图 ${filename}`); }
try {
  for (const [width, height, theme] of [[1366,768,'light'],[1920,1080,'light'],[1366,768,'dark'],[1920,1080,'dark']]) {
    await page.setViewportSize({ width, height }); await page.goto(selectionUrl(theme)); await expect(page.getByRole('table', { name: '选型候选' })).toBeVisible();
    await capture(`selection-${theme}-${width}.png`);
    const geometry = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.data-row')].map(el => el.getBoundingClientRect().height), values: [...document.querySelectorAll('.conclusion-metrics dd')].map(el => getComputedStyle(el).fontSize), dots: [...document.querySelectorAll('.is-verdict .status-symbol')].map(el => el.getBoundingClientRect().width), numeric: getComputedStyle(document.querySelector('td.numeric')).fontVariantNumeric, underline: getComputedStyle(document.querySelector('.tabs-trigger[data-state="active"]')).borderBottomWidth }));
    expect(geometry.rows.every(height => height === 40)).toBe(true); expect(geometry.values).toEqual(['28px','28px','28px']); expect(geometry.dots.every(width => width === 6)).toBe(true); expect(geometry.numeric).toContain('tabular-nums'); expect(geometry.underline).toBe('2px');
    // Property value, unit and source remain on the same baseline.
    expect(await page.locator('.property-row dd').first().evaluate(el => el.querySelector('.source-badge').getBoundingClientRect().top - el.getBoundingClientRect().top < 5)).toBe(true);
    await expect(page.getByText('页面状态', { exact: true })).toHaveCount(0);
    await expect(page.getByText('开发状态', { exact: true })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const theme of ['light','dark']) {
    await page.goto(`${base}/gallery?theme=${theme}`); await expect(page.getByRole('heading',{ name:'公共组件陈列' })).toBeVisible(); await capture(`gallery-${theme}-1366.png`);
    // Supplemental full-content capture preserves 1366px width; required viewport screenshots stay above.
    const css = await page.addStyleTag({ content: '.app-shell{height:auto;min-height:100vh;overflow:visible}.work-panel{overflow:visible}.work-body{min-height:auto}.main-content{overflow:visible}' });
    await page.screenshot({ path:path.join(output,`gallery-${theme}-full.png`), fullPage:true }); captures.push(`gallery-${theme}-full.png`); await css.evaluate(el=>el.remove());
  }
  // Each result state in both desktop sizes/themes; requested five screenshots use light 1366.
  for (const [width,height,theme] of [[1366,768,'light'],[1920,1080,'light'],[1366,768,'dark'],[1920,1080,'dark']]) {
    await page.setViewportSize({width,height});
    for (const state of ['empty','loading','error','success','historical']) {
      await page.goto(selectionUrl(theme,state)); await settle(page); await assertLayout();
      if(state==='empty') await expect(page.getByRole('heading',{name:'尚无选型结果'})).toBeVisible();
      if(state==='loading') await expect(page.getByText('正在读取选型结果')).toBeVisible();
      if(state==='error') await expect(page.getByRole('alert')).toContainText('网络连接不可用');
      if(state==='historical') await expect(page.getByRole('region',{name:'历史结论'})).toBeVisible();
      if(state==='success') await expect(page.getByRole('table',{name:'选型候选'})).toBeVisible();
      if(width===1366&&theme==='light') await capture(`selection-${state}-1366.png`);
    }
  }
  await page.setViewportSize({width:1366,height:768}); await page.goto(selectionUrl());
  await page.getByRole('button',{name:'演示数据',exact:true}).click(); await expect(page.locator('.status-detail')).toContainText('未调用计算插件'); await page.keyboard.press('Escape'); await expect(page.locator('.status-detail')).toHaveCount(0);
  await page.getByRole('combobox',{name:'显示'}).click(); await page.getByRole('option',{name:'不适用',exact:true}).click(); await expect(page.getByRole('row',{name:/选择.*3×300/})).toHaveCount(0);
  const na = page.getByRole('row',{name:/选择.*3×150/}); await na.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.property-panel h2')).toContainText('3×150');
  await page.getByRole('combobox',{name:'显示'}).click(); await expect(page.getByRole('option',{name:'不适用',exact:true})).toBeFocused(); await page.keyboard.press('Home'); await expect(page.getByRole('option',{name:'全部候选',exact:true})).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.getByRole('row',{name:/选择.*3×300/})).toBeVisible();
  await page.getByRole('button',{name:'收起满足',exact:true}).click(); await expect(page.getByRole('row',{name:/选择.*3×300/})).toHaveCount(0); await page.getByRole('button',{name:'展开满足',exact:true}).click();
  const first = page.getByRole('row',{name:/选择.*3×300/}); await first.focus(); await page.keyboard.press('ArrowDown'); await expect(page.locator('.property-panel h2')).toContainText('3×400');
  await page.getByRole('button',{name:'收起属性面板'}).click(); await expect(page.getByRole('button',{name:'展开属性面板'})).toBeVisible(); await page.getByRole('button',{name:'展开属性面板'}).click();
  await page.locator('.check-toggle').click(); await expect(page.locator('.check-details')).toContainText('未执行标准判定'); await page.locator('.check-toggle').click(); await expect(page.locator('.check-details')).toHaveCount(0);
  await page.getByRole('button',{name:'预览计算书',exact:true}).click(); await expect(page.getByRole('dialog')).toContainText('静态预览'); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button',{name:'预览计算书',exact:true})).toBeFocused();
  await page.getByRole('tab',{name:'候选结果'}).focus(); await page.keyboard.press('ArrowRight'); await expect(page).toHaveURL(/tab=settings/); await expect(page.getByLabel('目标电流')).toHaveAttribute('readonly',''); await page.goBack(); await expect(page).toHaveURL(/tab=results/);
  await page.keyboard.press('Control+s'); await expect(page.getByRole('dialog')).toContainText('保存尚未接入'); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Control+z'); await expect(page.getByRole('dialog')).toContainText('撤销尚未接入'); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`${base}/gallery?theme=light`); const input=page.getByLabel('目标电流',{exact:true}); await input.fill('-2'); await input.press('Enter'); await expect(input).toHaveAttribute('aria-invalid','true'); await expect(input).toBeFocused(); await expect(page.getByText('不得小于 1 A')).toBeVisible(); await input.press('Escape'); await expect(input).toHaveValue('400');
  await input.fill('450'); await input.press('Enter'); await expect(input).toHaveValue('450'); await input.fill('abc'); await input.press('Enter'); await expect(page.getByText('请输入有效数值')).toBeVisible(); await input.press('Escape'); await expect(input).toHaveValue('450');
  await input.fill(''); await input.press('Enter'); await expect(page.getByText('请填写目标电流',{exact:true})).toBeVisible(); await input.press('Escape'); await expect(input).toHaveValue('450');
  await input.fill('1001'); await input.press('Enter'); await expect(page.getByText('不得大于 1000 A',{exact:true})).toBeVisible(); await input.press('Escape'); await expect(input).toHaveValue('450');
  await input.fill('451'); await input.press('Control+z'); await expect(page.getByRole('dialog')).toHaveCount(0); await input.press('Escape');
  await page.getByRole('button',{name:'打开对话框'}).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button',{name:'确认',exact:true}).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button',{name:'打开对话框'})).toBeFocused();
  const standard=page.getByRole('combobox',{name:'标准选择'}); await standard.focus(); await page.keyboard.press('Space'); await expect(page.getByRole('option',{name:'标准控件',exact:true})).toBeFocused(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('option',{name:'第二选项',exact:true})).toBeFocused(); await page.keyboard.press('Enter'); await expect(standard).toContainText('第二选项'); await expect(standard).toBeFocused();
  await page.getByRole('button',{name:'来源提示',exact:true}).focus(); await expect(page.getByRole('tooltip')).toContainText('鼠标悬停'); await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
  for(const state of ['empty','loading','error','historical']){ await page.getByRole('combobox',{name:'页面状态'}).click(); await page.getByRole('option',{name:({empty:'空',loading:'加载',error:'错误',historical:'历史结果'})[state],exact:true}).click(); await assertLayout(); }
  await page.emulateMedia({reducedMotion:'reduce'}); await page.goto(selectionUrl('dark','loading')); await settle(page); const transform=await page.locator('.glyph-running').first().evaluate(el=>getComputedStyle(el).transform); await page.waitForTimeout(200); expect(await page.locator('.glyph-running').first().evaluate(el=>getComputedStyle(el).transform)).toBe(transform);
  await page.goto(selectionUrl('dark')); await context.setOffline(true); await page.getByRole('row',{name:/选择.*3×400/}).click(); await expect(page.locator('.property-panel h2')).toContainText('3×400'); await context.setOffline(false);
  await page.goto(`${base}/not-a-route`); await expect(page.getByRole('heading',{name:'页面不存在'})).toBeVisible(); await expect(page.getByRole('link',{name:'返回研究列表'})).toHaveAttribute('href','/studies?theme=light');
  expect(errors).toEqual([]); expect([...external]).toEqual([]); expect([...api]).toEqual([]);
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({captures,checks,errors,external:[...external],api:[...api],keyboard:'passed',states:'passed',reducedMotion:'passed',offlineLoadedApp:'passed'},null,2));
  console.log('组件与页面验证通过：五态、分组/折叠/筛选/选择、属性联动、字段校验、对话框与焦点、页签后退、快捷键、减少动态、已加载页面离线操作。');
} catch(error) { await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,url:page.url(),errors},null,2)); throw error; }
finally { await session.close(); }
