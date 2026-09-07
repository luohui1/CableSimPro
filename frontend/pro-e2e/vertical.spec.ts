import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1')});

test('vertical heat profile, independent scope and stale boundary protection',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'场分析',exact:true}).click();
 await page.getByRole('button',{name:'竖向电热',exact:true}).click();
 await page.getByLabel('竖向轴向网格').selectOption('20');
 await page.getByRole('button',{name:'运行竖向电热',exact:false}).click();
 await expect(page.getByTestId('vertical-summary')).toContainText('734.5',{timeout:30000});
 await expect(page.getByRole('img',{name:'竖向沿高温度曲线'})).toBeVisible();
 await expect(page.locator('.vertical-panel .field-diagnostics')).toContainText('粗细网格载流量差异');
 await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'专注工作区',exact:true}).click();
 await page.setViewportSize({width:1600,height:1350});
 await page.getByTestId('vertical-summary').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('v041-vertical-heat.png'),fullPage:true});
 await page.getByLabel('顶部空气温度',{exact:true}).fill('55');
 await expect(page.locator('.vertical-panel .domain-alert')).toContainText('历史竖向研究');
 await expect(page.getByRole('button',{name:'导出研究快照'})).toBeDisabled();
 expect(errors).toEqual([]);
});

test('vertical catalog selection uses air solver and changing target invalidates review',async({page},info)=>{
 await page.getByRole('button',{name:'反向选型',exact:true}).click();
 await page.getByLabel('选型研究域').selectOption('vertical_air');
 await page.getByLabel('竖向轴向网格').selectOption('20');
 await page.getByLabel('包含演示型号').check();
 await page.getByRole('button',{name:'运行反向选型',exact:false}).click();
 await expect(page.getByTestId('selection-summary')).toContainText('满足当前筛选约束',{timeout:45000});
 await expect(page.locator('.research-badge')).toContainText('竖向空气');
 await expect(page.getByRole('button',{name:'候选送审',exact:true}).first()).toBeEnabled();
 await page.getByRole('button',{name:'专注工作区',exact:true}).click();
 await page.setViewportSize({width:1700,height:1450});
 await page.getByTestId('selection-summary').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('v041-vertical-selection.png'),fullPage:true});
 await page.getByLabel('选型目标电流').fill('900');
 await expect(page.locator('.selection-panel .domain-alert')).toContainText('选型条件已变化');
 await expect(page.getByRole('button',{name:'候选送审',exact:true}).first()).toBeDisabled();
 await page.getByLabel('选型目标电流').fill('500');
 await page.getByRole('button',{name:'专注工作区',exact:true}).click();
 await page.getByRole('button',{name:'候选送审',exact:true}).first().click();
 await expect(page.locator('.proposal-card')).toContainText('不自动触发直埋');
 let buriedCalls=0;page.on('request',r=>{if(r.url().endsWith('/calculate'))buriedCalls++});
 await page.getByRole('button',{name:'批准并执行'}).click();
 await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await expect(page.locator('.results-toolbar')).toContainText('未计算');
 expect(buriedCalls).toBe(0);
});

test('engineering labels have measurable high contrast and readable size',async({page})=>{
 const values=await page.locator('.property-title label').first().evaluate(el=>{
  const rgb=(text:string)=>text.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});
  const luminance=(c:number[])=>.2126*c[0]+.7152*c[1]+.0722*c[2];
  const color=getComputedStyle(el).color,background=getComputedStyle(el.closest('.inspector')!).backgroundColor;
  const a=luminance(rgb(color)),b=luminance(rgb(background));
  return {contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),size:parseFloat(getComputedStyle(el).fontSize)};
 });
 expect(values.contrast).toBeGreaterThan(4.5);expect(values.size).toBeGreaterThanOrEqual(13);
});
