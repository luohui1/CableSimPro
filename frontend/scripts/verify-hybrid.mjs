import { expect as playwrightExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, repositoryRoot, settle } from './browser.mjs';

if (process.env.E2E_ISOLATED !== '1') throw Error('混合模型写入验收只允许独立测试数据库');
const base = process.env.FRONTEND_URL || 'http://127.0.0.1:5177';
const output = path.join(repositoryRoot, '.data/hybrid/browser');
await fs.mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 20000 });
const session = await openHeadlessBrowser(); const { page } = session;
const errors = []; const checks = []; const layouts = [];
const responses=[];
const requests=[];
page.on('request', request => { if(request.url().includes('/runs') || request.url().includes('/preflight')) requests.push({url:request.url(),method:request.method(),time:new Date().toISOString()}); });
page.on('pageerror', error => errors.push(error.message));
page.on('response',async response=>{
  if(response.url().includes('/runs')||response.url().includes('/preflight')){
    try{const value=await response.json();responses.push({url:response.url(),status:response.status(),method:response.request().method(),time:new Date().toISOString(),ready:value.ready,run:value.status,items:value.items?.map(item=>({id:item.id,status:item.status}))});}catch{}
  }
});
async function json(endpoint, options) {
  const response = await fetch(base + endpoint, options);
  if (!response.ok) throw Error(`${endpoint}: ${response.status} ${await response.text()}`);
  return response.json();
}
async function choose(label, value) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function layout(name, width, height) {
  await page.setViewportSize({ width, height }); await settle(page);
  const result = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('.hybrid-study button,.hybrid-study label,.hybrid-study td,.hybrid-study th,.hybrid-study p,.hybrid-study span')]
      .filter(element => element.getBoundingClientRect().width && element.getBoundingClientRect().height);
    return { width: innerWidth, height: innerHeight, documentOverflow: document.documentElement.scrollWidth > innerWidth,
      fontMinimum: Math.min(...visible.map(element => parseFloat(getComputedStyle(element).fontSize))),
      tableOverflows: [...document.querySelectorAll('.hybrid-study .table-scroll')].map(element => element.getBoundingClientRect().right > innerWidth),
      inputOverlaps: [...document.querySelectorAll('.hybrid-inputs .number-field')].some((element, index, elements) => elements.slice(index + 1).some(other => {
        const a = element.getBoundingClientRect(), b = other.getBoundingClientRect(); return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      })) };
  });
  if (result.documentOverflow || result.fontMinimum < 13 || result.tableOverflows.some(Boolean) || result.inputOverlaps) throw Error('布局门禁失败：' + JSON.stringify(result));
  layouts.push({ name, ...result }); await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
}
try {
  await page.goto(base + '/studies'); await settle(page);
  await page.getByRole('button', { name: '新建研究', exact: true }).click();
  await choose('研究任务', '混合载流量参考研究');
  await page.getByRole('textbox', { name: '研究名称', exact: true }).fill('浏览器混合参考研究');
  const models = (await json('/api/model-artifacts')).filter(model => model.availability === 'available' && model.family === (process.env.HYBRID_FAMILY || 'direct_single'));
  if (!models.length) throw Error('缺少真实训练模型，不生成替代模型');
  const model = models.sort((a,b)=>b.model_version.localeCompare(a.model_version,undefined,{numeric:true}))[0]; await choose('引用训练模型', `${model.name} · ${model.model_version}`);
  await page.getByRole('button', { name: '建立研究', exact: true }).click();
  await expect(page).toHaveURL(/\/hybrid\/results/);
  await expect(page.getByText('尚无混合预测', { exact: true })).toBeVisible(); checks.push('empty');
  const studyId = /\/studies\/([^/]+)/.exec(page.url())[1];
  const workspaceId = new URL(page.url()).searchParams.get('workspace');
  const endpoint = `/api/workspaces/${workspaceId}/studies/${studyId}/runs`;
  const original = await json(endpoint);
  const predict = page.getByRole('button', { name: '预测', exact: true });
  const predictionStarted=performance.now();
  await predict.dblclick();
  await expect(page.getByText('正在预测', { exact: true })).toBeVisible(); checks.push('loading');
  await expect(page.getByRole('table', { name: '混合预测结果' })).toBeVisible({timeout:60000}); checks.push('success');
  const predictionWallSeconds=(performance.now()-predictionStarted)/1000;
  let after = await json(endpoint);
  const executionProfiling = after.items.at(-1)?.output?.environment;
  if (after.items.length !== original.items.length + 1) throw Error('重复点击创建了多次计算'); checks.push('double-click-deduplicated');
  const warmPredictions=[];
  for(let index=0;index<3;index++) {
    const started=performance.now();
    await predict.click();
    await expect(predict).toHaveAttribute('aria-busy','true');
    await expect(predict).toBeEnabled({timeout:60000});
    await expect(page.getByRole('table',{name:'混合预测结果'})).toBeVisible();
    warmPredictions.push((performance.now()-started)/1000);
    const next=await json(endpoint);
    if(next.items.length!==after.items.length+1)throw Error('已加载模型预测没有产生唯一保存运行');
    after=next;
  }
  await layout('prediction-1366', 1366, 768); await layout('prediction-1920', 1920, 1080);
  // Abort transport before the server receives a second calculation. The saved
  // result must remain visible and the same request can then be retried.
  await page.route('**' + endpoint, route => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue());
  await page.getByRole('button', { name: '预测', exact: true }).click();
  await expect(page.getByText('连接中断，请重试；已保存工况保留。', {exact:true})).toBeVisible({timeout:60000});
  await expect(page.getByRole('table', {name:'混合预测结果'})).toBeVisible();
  if ((await json(endpoint)).items.length !== after.items.length) throw Error('断网验收意外提交了新计算');
  await page.unroute('**' + endpoint); checks.push('network-error-preserves-saved-result');
  const depth = page.getByRole('textbox', { name: '中心埋深', exact: true });
  const originalDepth = await depth.inputValue();
  await depth.fill('5'); await page.getByRole('button', { name: '保存并预测', exact: true }).click();
  await expect(page.getByText(/^中心埋深超出训练范围/)).toBeVisible();
  await expect(depth).toBeFocused(); checks.push('error-field-focus');
  if ((await json(endpoint)).items.length !== after.items.length) throw Error('无效输入触发了计算');
  await depth.press('Escape'); await expect(depth).toHaveValue(originalDepth); checks.push('escape');
  const amended = Number(originalDepth) < 1.8 ? Number(originalDepth) + .02 : Number(originalDepth) - .02;
  await depth.fill(amended.toFixed(3)); await depth.press('Enter');
  await page.getByRole('button', { name: '保存并预测', exact: true }).focus(); await page.keyboard.press('Control+z');
  await expect(depth).toHaveValue(originalDepth); checks.push('undo');
  await depth.fill(amended.toFixed(3)); await depth.press('Enter'); await page.keyboard.press('Control+s');
  await expect(page.getByRole('button', { name: '预测', exact: true })).toBeEnabled();
  const saved = await json('/api/workspaces/' + workspaceId + '/domain');
  if (Math.abs(-saved.document.sections[0].placements[0].z - amended) > .001) throw Error('Ctrl+S未保存实际工况'); checks.push('save');
  await expect(page.locator('.topbar .status-mark')).toContainText('已过期'); checks.push('historical');
  await layout('history-1366', 1366, 768);
  await page.getByRole('tab', { name: '模型验证', exact: true }).click();
  await expect(page.getByRole('table', { name: '混合模型验证' })).toBeVisible();
  await choose('数据集', '外推诊断集'); await expect(page.getByText('外推只用于诊断，预测入口仍拒绝域外输入。', { exact: true })).toBeVisible();
  await layout('validation-1366', 1366, 768); await layout('validation-1920', 1920, 1080);
  // The server must enforce OOD as well, even if a client ignores the field guard.
  const actual = await json('/api/workspaces/' + workspaceId + '/domain');
  const outside = structuredClone(actual.document);
  for (const point of outside.sections[0].placements) point.z = -3.;
  const changed = await json('/api/workspaces/' + workspaceId + '/domain', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_revision: actual.revision, document: outside }) });
  const study = (await json('/api/workspaces/' + workspaceId + '/studies')).find(item => item.id === studyId);
  const preflight = await json(`/api/workspaces/${workspaceId}/studies/${studyId}/preflight?expected_revision=${changed.revision}&expected_study_revision=${study.revision}`);
  if (preflight.ready || !JSON.stringify(preflight).includes('HYBRID_OUT_OF_DOMAIN')) throw Error('服务器未拒绝外推输入'); checks.push('server-ood-rejection');
  if (errors.length) throw Error('浏览器脚本错误：' + errors.join('; '));
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ checks, layouts, errors, workspaceId, studyId, modelSha256: model.model_sha256,predictionWallSeconds,warmPredictions,executionProfiling,requests,responses }, null, 2));
  console.log(JSON.stringify({ checks, layouts, errors, output }));
} catch(error) {
  await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,requests,responses,visibility:await page.evaluate(()=>document.visibilityState),pageText:await page.locator('body').innerText()},null,2));
  throw error;
} finally { await session.close(); }
