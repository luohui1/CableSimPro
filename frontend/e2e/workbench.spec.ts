import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const errors = new WeakMap<Page,string[]>();
const number = (s:string|null) => Number((s??'').replace(/[^\d.\-]/g,''));
async function model(page:Page) { await page.getByRole('button',{name:'模型',exact:true}).click(); }
async function solve(page:Page) {
  await page.getByRole('button',{name:'计算参考方案',exact:true}).click();
  await page.getByRole('button',{name:'确认并求解',exact:true}).click();
  await expect(page.getByTestId('result-status')).toContainText('已计算');
}
async function recalc(page:Page) { await page.getByRole('button',{name:'执行计算',exact:true}).click(); await model(page); await expect(page.getByTestId('result-status')).toContainText('已计算'); }
async function send(page:Page,text:string) { await page.getByLabel('工程任务',{exact:true}).fill(text); await page.getByRole('button',{name:'提交任务',exact:true}).click(); }
function activeConfirm(page:Page,label='确认并求解') { return page.getByRole('button',{name:label,exact:true}).last(); }
test.beforeEach(async({page})=>{
  errors.set(page,[]);page.on('pageerror',e=>errors.get(page)?.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto('/'); await expect(page.getByRole('heading',{name:'这次要研究什么？'})).toBeVisible();
});
test.afterEach(async({page})=>{expect(errors.get(page)??[]).toEqual([]);});

test('agent-first landing, confirmation and real solver output',async({page,request},info)=>{
  await expect(page.getByText('本地命令使用有限语法，不是大模型。',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('agent-home.png'),fullPage:true});
  await page.getByRole('button',{name:'计算参考方案',exact:true}).click();
  await expect(activeConfirm(page)).toBeEnabled();
  await expect(page.getByTestId('ampacity')).toHaveText(/—/);
  await activeConfirm(page).click();
  await expect(page.getByTestId('result-status')).toContainText('已计算');
  const p=(await(await request.get('/api/presets')).json()).find((p:{id:string})=>p.id==='copper-240').scenario;
  const r=await(await request.post('/api/calculate',{data:p})).json();
  expect(Math.abs(number(await page.getByTestId('ampacity').textContent())-r.summary.ampacity_a)).toBeLessThan(.051);
  if(info.project.name==='chromium')await expect(page.locator('.scene')).toHaveAttribute('data-webgl','ready');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.screenshot({path:info.outputPath('agent-workspace.png'),fullPage:true});
});

test('agent changes are explicit, executed only once per confirmation and undo restores result',async({page})=>{
  await solve(page);const before=await page.getByTestId('ampacity').textContent();
  await send(page,'截面积改为 400 mm²，重新计算');
  await expect(page.getByTestId('proposal').last()).toContainText('240 → 400');
  expect(await page.getByTestId('ampacity').textContent()).toBe(before);
  await activeConfirm(page).click();
  await expect(page.getByTestId('ampacity')).not.toHaveText(before!);
  await expect(activeConfirm(page)).toBeDisabled();
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await expect(page.getByTestId('ampacity')).toHaveText(before!);
});

test('manual editing invalidates a pending proposal and result',async({page})=>{
  await solve(page);await send(page,'截面积改为 400 mm²，重新计算');await expect(activeConfirm(page)).toBeEnabled();
  await page.getByRole('button',{name:'导体与层结构',exact:true}).click();
  await page.getByLabel('导体截面积',{exact:true}).fill('300');
  await model(page);await expect(activeConfirm(page)).toBeDisabled();await expect(page.getByTestId('ampacity')).toHaveText(/—/);
  await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
  await recalc(page);await expect(page.getByTestId('ampacity')).not.toHaveText(/—/);
});

test('invalid or empty inputs and overlap are not clamped',async({page})=>{
  await solve(page);await page.getByRole('button',{name:'导体与层结构',exact:true}).click();
  await page.getByLabel('导体截面积',{exact:true}).fill('');
  await page.getByRole('button',{name:'敷设',exact:true}).click();
  await page.getByRole('button',{name:'执行计算',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('area_mm2');
  await page.getByRole('button',{name:'电缆',exact:true}).click();await page.getByLabel('导体截面积',{exact:true}).fill('240');
  await page.getByRole('button',{name:'敷设',exact:true}).click();await page.getByLabel('相邻中心间距',{exact:true}).fill('0.02');
  await page.getByRole('button',{name:'执行计算',exact:true}).click();await expect(page.getByRole('alert')).toContainText('重叠');
});

test('agent parameter sweep uses backend and preserves base model',async({page})=>{
  await page.getByRole('button',{name:'研究土壤热阻率的影响',exact:true}).click();
  await page.getByRole('button',{name:'确认并扫描',exact:true}).click();
  await expect(page.getByRole('img',{name:'Agent 参数扫描',exact:true})).toBeVisible();
  const values=await page.locator('.agent-sweep tbody tr td:last-child').allTextContents();
  expect(number(values[0])).toBeGreaterThan(number(values[3]));
  await page.getByRole('button',{name:'运行扫描',exact:true}).click();
  await expect(page.getByRole('img',{name:'敏感性分析曲线'})).toBeVisible();
  await page.getByRole('button',{name:'直埋敷设',exact:true}).click();await page.getByLabel('平均中心埋深',{exact:true}).fill('1.2');
  await page.getByRole('button',{name:'参数扫描',exact:true}).click();
  await expect(page.getByRole('img',{name:'Agent 参数扫描',exact:true})).toHaveCount(0);
});

test('unsupported commands and cloud status are honest',async({page})=>{
  await send(page,'计算三芯铠装排管电缆');
  await expect(page.getByText(/未解释的内容不会执行/)).toBeVisible();
  await expect(activeConfirm(page)).toHaveCount(0);
  await page.getByRole('button',{name:'打开 Agent 设置'}).click();
  await expect(page.getByRole('dialog')).toContainText('服务端尚未配置大模型');
  await page.getByRole('button',{name:'关闭窗口'}).click();
  await expect(page.getByLabel('Agent 模式').locator('option[value="openai"]')).toBeDisabled();
});

test('assumptions task inspects the model without fabricating a study',async({page})=>{
  await page.getByRole('button',{name:'检查模型假设',exact:true}).click();
  await page.getByRole('button',{name:'确认查看',exact:true}).click();
  await expect(page.getByRole('heading',{name:'验证等级',exact:true})).toBeVisible();
  await expect(page.locator('.chat-message').last()).toContainText('未自动按完整 IEC');
});

test('project save reopen downloads and delete',async({page},info)=>{
  await solve(page);const name=`Agent-${info.project.name}-${Date.now()}`;
  await page.getByLabel('工程名称',{exact:true}).fill(name);await page.getByRole('button',{name:'保存工程',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('工程已保存');await page.reload();
  await page.getByRole('button',{name:'工程库',exact:true}).click();
  await page.getByRole('dialog').locator('.project-item').filter({hasText:name}).getByRole('button',{name:'打开',exact:true}).click();
  await expect(page.getByLabel('工程名称',{exact:true})).toHaveValue(name);await recalc(page);
  for(const [label,contains] of [['导出工程',name],['导出计算书','SHA-256'],['导出运行 CSV','input_sha256']]){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();
    const d=await pending;expect(await readFile((await d.path())!,'utf8')).toContain(contains);
  }
  await page.getByRole('button',{name:'工程库',exact:true}).click();await page.getByRole('button',{name:`删除工程 ${name}`,exact:true}).click();
  await expect(page.getByRole('dialog').locator('.project-item').filter({hasText:name})).toHaveCount(0);
});

test('import validates input and preserves active project on failure',async({page,request})=>{
  const initial=await page.getByLabel('工程名称').inputValue();
  await page.getByLabel('导入工程文件').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schema_version":99}')});
  await expect(page.getByRole('alert')).toContainText('schema_version');await expect(page.getByLabel('工程名称')).toHaveValue(initial);
  const presets=await(await request.get('/api/presets')).json();const s={...presets[0].scenario,name:'导入工程测试'};
  await page.getByLabel('导入工程文件').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(s))});
  await expect(page.getByLabel('工程名称')).toHaveValue(s.name);await expect(page.getByTestId('ampacity')).toHaveText(/—/);await recalc(page);
});

test('views, trefoil, ledger and model errors',async({page},info)=>{
  await solve(page);await page.getByRole('button',{name:'分层展开',exact:true}).click();
  await expect(page.getByRole('button',{name:'分层展开',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'重置视角',exact:true}).click();
  await page.getByRole('button',{name:'二维截面',exact:true}).click();await expect(page.getByRole('img',{name:'电缆二维截面'})).toBeVisible();
  await send(page,'改为三角排列，计算');await activeConfirm(page).click();
  await page.getByRole('button',{name:'敷设截面',exact:true}).click();await expect(page.getByRole('img',{name:'直埋敷设截面'})).toBeVisible();
  await page.getByRole('button',{name:'土壤温度',exact:true}).click();await expect(page.getByLabel('土壤解析温度分布')).toBeVisible();
  await page.screenshot({path:info.outputPath('agent-soil.png'),fullPage:true});
  await page.getByRole('button',{name:'计算明细',exact:true}).click();await expect(page.getByText('输入 SHA-256',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'极限载流',exact:true}).click();await expect(page.getByText(/平衡残差/)).toBeVisible();
  await send(page,'运行电流改为 3000 A，计算');await activeConfirm(page).click();
  await expect(page.getByRole('alert')).toContainText('无稳定解');await expect(page.getByTestId('temperature')).toHaveText(/—/);
  await expect(page.getByRole('button',{name:'导出运行 CSV',exact:true})).toBeDisabled();
});

test('immutable scenario comparisons',async({page})=>{
  await solve(page);const before=await page.getByTestId('ampacity').textContent();await page.getByRole('button',{name:'加入方案对比',exact:true}).click();
  await send(page,'截面积改为 400 mm²，重新计算');await activeConfirm(page).click();
  await expect(page.getByTestId('ampacity')).not.toHaveText(before!);
  await page.getByRole('button',{name:'加入方案对比',exact:true}).click();await page.getByRole('button',{name:'方案对比',exact:true}).click();
  await expect(page.getByText(/快照 2 ·/)).toBeVisible();await page.getByRole('button',{name:'移除快照 1',exact:true}).click();
  await expect(page.getByText(/快照 2 ·/)).toHaveCount(0);
});
