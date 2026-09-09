import {test, expect, type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function enter(page: Page) {
 await page.goto('/');
 await page.getByRole('button', {name: '进入智能工程流', exact: true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 return new URL(page.url()).searchParams.get('project')!;
}
async function propose(page: Page, message: string) {
 await page.getByLabel('描述本次工程任务', {exact: true}).fill(message);
 await page.getByRole('button', {name: '生成任务计划', exact: true}).click();
 await expect(page.getByRole('region', {name: '待审查工程变更', exact: true})).toBeVisible();
}
async function approve(page: Page) {
 const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/approve'));
 await page.getByRole('button', {name: '批准并执行', exact: true}).click();
 const result = await response;
 expect(result.status()).toBe(200);
 const payload = await result.json();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.getByTestId('sweep-study')).toBeVisible();
 return payload;
}
const numeric = (text: string) => Number(text.replaceAll(',', '').trim());

test('sweep study: reviewed temperature points show real headroom, CSV and version invalidation', async ({page, request}, info) => {
 const wid = await enter(page);
 const baseline = (await (await request.get(`/api/workspaces/${wid}`)).json()).scenario;
 let approvals = 0;
 page.on('request', r => {if (r.method() === 'POST' && r.url().endsWith('/approve')) approvals++;});
 await propose(page, '比较环境温度 -10、25、40 °C 下的载流量');
 const plan = page.getByRole('region', {name: '扫描计划明细', exact: true});
 await expect(plan).toContainText('-10 / 25 / 40');
 await expect(plan).toContainText('原工况已列入');
 expect(approvals).toBe(0);
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await page.screenshot({path: info.outputPath('sweep-plan-review.png'), fullPage: true});
 const payload = await approve(page);
 expect(payload.workspace.scenario).toEqual(baseline);
 expect(payload.output.result).toBeNull();
 const points = payload.output.sweep.points;
 const panel = page.getByTestId('sweep-study');
 await expect(panel.locator('tbody tr')).toHaveCount(3);
 const first = panel.locator('tr[data-point-index="0"] td');
 expect(numeric(await first.nth(1).innerText())).toBeCloseTo(points[0].ampacity_a, 1);
 expect(numeric(await first.nth(3).innerText())).toBeCloseTo(points[0].ampacity_a - baseline.operating_current_a, 1);
 await expect(panel.locator('tr[data-point-index="1"] td').nth(2)).toHaveText('0.00');
 const downloaded = page.waitForEvent('download');
 await panel.getByRole('button', {name: '导出扫描 CSV', exact: true}).click();
 const artifact = await downloaded;
 const csv = await readFile((await artifact.path())!, 'utf8');
 expect(csv).toContain('ampacity_headroom_a');
 expect(csv).toContain('"ambient_temperature_c","°C"');
 expect(csv).toContain(String(points[0].ampacity_a));
 expect(csv).toContain(payload.output.run_id);
 await panel.getByRole('button', {name: '特性曲线', exact: true}).click();
 await expect(panel.getByRole('img', {name: '参数扫描曲线', exact: true})).toBeVisible();
 await expect(panel.locator('.scientific-chart')).toHaveAttribute('data-x-label', '环境温度 / °C');
 await page.screenshot({path: info.outputPath('sweep-temperature-study.png'), fullPage: true});
 await page.getByRole('navigation', {name: '工作模式'}).getByRole('button', {name: '专业工作台', exact: true}).click();
 const field = page.getByTestId('professional-mode').getByLabel('导体截面积', {exact: true});
 await field.fill('300'); await field.press('Tab');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.3');
 await page.getByRole('navigation', {name: '工作模式'}).getByRole('button', {name: '智能工程流', exact: true}).click();
 await expect(page.getByTestId('sweep-study')).toHaveCount(0);
 await expect(page.getByRole('button', {name: '导出扫描 CSV', exact: true})).toHaveCount(0);
 await expect(page.getByTestId('agent-mode').locator('.inline-stale')).toBeVisible();
});

test('sweep study: absent original case stays blank until a solved reference is explicitly selected', async ({page}, info) => {
 await enter(page);
 await propose(page, '比较平均中心埋深 0.4、1.2 m 下的载流量');
 await expect(page.getByRole('region', {name: '扫描计划明细', exact: true})).toContainText('原工况未列入');
 const payload = await approve(page), panel = page.getByTestId('sweep-study');
 await expect(panel.getByTestId('sweep-reference-note')).toContainText('不自动补算');
 await expect(panel.locator('tr[data-point-index="0"] td').nth(2)).toHaveText('—');
 await expect(panel.locator('tr[data-point-index="1"] td').nth(2)).toHaveText('—');
 let writes = 0; page.on('request', r => {if (r.method() === 'POST') writes++;});
 await panel.getByLabel('扫描比较基准').selectOption('0');
 await expect(panel.getByTestId('sweep-reference-note')).toContainText('不是原工况');
 const points = payload.output.sweep.points;
 expect(numeric(await panel.locator('tr[data-point-index="1"] td').nth(2).innerText()))
  .toBeCloseTo((points[1].ampacity_a - points[0].ampacity_a) / points[0].ampacity_a * 100, 2);
 const downloaded = page.waitForEvent('download');
 await panel.getByRole('button', {name: '导出扫描证据', exact: true}).click();
 const artifact = await downloaded;
 const exported = JSON.parse(await readFile((await artifact.path())!, 'utf8'));
 expect(exported.evidence.runId).toBe(payload.output.run_id);
 expect(exported.scenario).toEqual(payload.workspace.scenario);
 expect(exported.comparison.referenceIsInput).toBe(false);
 expect(exported.sweep.points).toEqual(points);
 await panel.getByRole('button', {name: '特性曲线', exact: true}).click();
 await expect(panel.getByRole('img', {name: '参数扫描曲线', exact: true})).toBeVisible();
 await page.screenshot({path: info.outputPath('sweep-depth-reference.png'), fullPage: true});
 expect(writes).toBe(0);
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
});
