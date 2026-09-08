import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
const switcher = (page: Page) => page.getByRole('navigation', {name: '工作模式'});
async function enter(page: Page, mode = '智能工程流') {
  await page.goto('/');
  await page.getByRole('button', {name: '进入' + mode, exact: true}).click();
  await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
}
async function propose(page: Page) {
  await page.getByLabel('描述本次工程任务', {exact: true}).fill('截面积改为 400 mm²，重新计算');
  await page.getByRole('button', {name: '生成任务计划', exact: true}).click();
  await expect(page.getByRole('region', {name: '待审查工程变更'})).toBeVisible();
}

test('integrated entry ships real local plates, creates no projects and requests no external service', async ({page}, info) => {
  const outside: string[] = [], writes: string[] = [];
  page.on('request', r => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== '127.0.0.1') outside.push(r.url());
    if (r.method() === 'POST') writes.push(r.url());
  });
  await page.goto('/');
  const illustrations = page.getByTestId('engineering-illustration');
  await expect(illustrations).toHaveCount(2);
  for (const plate of await illustrations.all()) {
    await expect(plate).toHaveAttribute('data-status', 'ready');
    await expect(plate).toContainText('非计算结果');
    expect(await plate.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1200);
  }
  expect(outside).toEqual([]); expect(writes).toEqual([]);
  const axe = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  await info.attach('entry-axe.json', {body: JSON.stringify(axe), contentType:'application/json'});
  expect(axe.violations).toEqual([]);
  await page.screenshot({path: info.outputPath('entry-v073.png'), fullPage: true});
});

test('missing illustration falls back without blocking either engineering entry', async ({page}) => {
  await page.route('**/engineering/*.webp', r => r.abort());
  await page.goto('/');
  for (const plate of await page.getByTestId('engineering-illustration').all()) {
    await expect(plate).toHaveAttribute('data-status', 'fallback');
    await expect(plate).toContainText('工程操作不受影响');
  }
  await page.getByRole('button', {name:'进入专业工作台', exact:true}).click();
  await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('explanatory welcome gives way to real candidate review and preserves the shared session', async ({page}, info) => {
  await enter(page);
  await expect(page.locator('.cs-welcome-visual img')).toBeVisible();
  await expect(page.locator('.cs-welcome-visual figure')).toHaveAttribute('data-status', 'ready');
  await page.screenshot({path:info.outputPath('agent-home-v073.png'),fullPage:true});
  const project = new URL(page.url()).searchParams.get('project');
  await propose(page);
  await expect(page.locator('.cs-welcome-visual')).toHaveCount(0);
  await expect(page.locator('.cs-artifacts').getByTestId('cable-portrait')).toHaveAttribute('data-area','400');
  await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeInViewport({ratio:1});
  await page.screenshot({path:info.outputPath('agent-review-v073.png'),fullPage:true});
  await page.getByRole('button',{name:'批准并执行',exact:true}).click();
  await expect(page.locator('.flow-result-metrics')).toBeVisible();
  await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
  await page.screenshot({path:info.outputPath('agent-result-v073.png'),fullPage:true});
  await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();
  await expect(page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true})).toHaveValue('400');
  expect(new URL(page.url()).searchParams.get('project')).toBe(project);
  await page.screenshot({path:info.outputPath('workbench-v073.png'),fullPage:true});
});

test('live engineering model exports six layers without presentation-only geometry', async ({page}, info) => {
  await enter(page, '专业工作台');
  await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button',{name:'导出 GLB',exact:true}).click()]);
  const file = info.outputPath('cable-v073.glb'); await download.saveAs(file);
  const bytes = await fs.readFile(file);
  expect(bytes.subarray(0,4).toString()).toBe('glTF');
  const json = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  expect(json.meshes).toHaveLength(6);
  expect(JSON.stringify(json)).not.toContain('not_solver_geometry');
  expect(json.nodes.some((n:{extras?:{units?:string}})=>n.extras?.units==='metres')).toBe(true);
});

test('desktop inspector and model text remain readable at a 1440 pixel workspace', async ({page}, info) => {
  await page.setViewportSize({width:1440,height:900}); await enter(page,'专业工作台');
  const label = page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});
  expect(await label.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(page.getByRole('button',{name:'计算载流量',exact:false}).first()).toBeInViewport({ratio:1});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  const axe = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  await info.attach('workbench-axe.json',{body:JSON.stringify(axe),contentType:'application/json'});
  expect(axe.violations).toEqual([]);
  await page.screenshot({path:info.outputPath('workbench-1440-v073.png'),fullPage:true});
});

test('document plate is local and the original document workflow is still reachable', async ({page}) => {
  await enter(page);
  await page.getByRole('navigation',{name:'工程流内容'}).getByRole('button',{name:'资料与参数核对',exact:true}).click();
  const module = page.locator('.cs-module-surface:not([hidden])');
  await expect(module.getByRole('heading',{name:'资料与工程参数',exact:true})).toBeVisible();
  await expect(module.getByTestId('engineering-illustration')).toHaveAttribute('data-status','ready');
  await expect(module).toContainText('厂家保证值');
});
