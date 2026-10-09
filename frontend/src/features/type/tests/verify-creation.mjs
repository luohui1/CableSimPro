import assert from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const expect = baseExpect.configure({ timeout: 30000 });
const fixture = await typeFixture({ main: true, build: path.join(root, 'frontend/dist'), setup: database => promisify(execFile)(process.env.PYTHON || path.join(root,'.venv/Scripts/python.exe'), ['-c', "import sys;from pathlib import Path;sys.path.insert(0,str(Path('tests').resolve()));from test_type_creation import seed_browser;seed_browser(Path(sys.argv[1]))", database], {cwd:root,windowsHide:true,maxBuffer:1024*1024}) }), { page } = fixture;
const output = path.join(root, '.data/type-creation'); await fs.mkdir(output, { recursive: true });
const result = { checks: [], workflows: [], screenshots: [], errors: fixture.errors, fixture: '隔离目录与资料契约样例；标准结构使用真实封签插件；不写8100' };
let unblock, mode = 'success';
async function select(label, option) { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); }
async function open(theme = 'light') { await page.goto(fixture.url + '/types?create=1&theme=' + theme); await expect(page.getByRole('dialog', { name: '新建型号设计' })).toBeVisible(); }
async function layout(label) { result.checks.push({ label, ...await checkLayout(page) }); }
async function created(origin, name) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/types' && r.request().method() === 'POST');
  await page.getByRole('button', { name: origin === 'standard' ? '确认并建立草稿' : '建立草稿', exact: true }).click();
  const reply = await response; assert.equal(reply.status(),201,await reply.text()); const workspace = await reply.json();
  await expect(page).toHaveURL(new RegExp('/types/'+workspace.id+'/structure/section'));
  await expect(page.locator('[data-type-card]')).toBeVisible(); await layout(origin + ' workbench');
  await page.evaluate(() => document.fonts.ready); const screenshot = path.join(output, origin + '.png'); await page.screenshot({ path: screenshot }); result.screenshots.push(screenshot);
  assert.equal(workspace.type_creation.kind,origin); assert.equal(workspace.domain.name,name); assert.equal(workspace.type_lifecycle.status,'draft');
  assert.deepEqual(await fixture.api('/api/workspaces/'+workspace.id+'/studies'),[]);
  result.workflows.push({ origin, workspace:workspace.id, source:workspace.type_creation.source }); return workspace;
}
try {
  const options=await fixture.api('/api/types/creation-options'); assert.ok(options.library.length && options.imports.length && options.generation.length);
  await page.route('**/api/types/creation-options', async route => {
    if(mode==='loading') await new Promise(resolve => {unblock=resolve;});
    if(mode==='error') return route.fulfill({status:503,json:{detail:'起点目录离线，请重新读取'}});
    if(mode==='empty') return route.fulfill({json:{library:[],imports:[],generation:[]}});
    return route.continue();
  });
  for(const width of [1366,1920]) for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    for(const state of ['loading','error','empty','success']) {
      mode=state;await open(theme);
      await expect(page.getByText(state==='loading'?'正在读取起点':state==='error'?'起点读取失败':state==='empty'?'尚无已发布的型号版本':'已发布型号版本',{exact:true}).first()).toBeVisible();
      await layout(`${width} ${theme} ${state}`);if(state==='loading'){mode='success';unblock?.();}
      await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
  mode='success';await page.setViewportSize({width:1366,height:768});
  await open();await page.getByRole('radio',{name:'空白',exact:true}).check();await select('结构类型','三芯');await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('空白设计验收');
  const blank=await created('blank','空白设计验收');await expect(page.getByRole('region',{name:'型号缺项'})).toBeVisible();
  await expect(page.getByText('空白 · 用户录入',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'芯 1 · 导体截面',exact:true}).click();await expect(page.getByRole('textbox',{name:'标称截面',exact:true})).toBeFocused();
  await page.getByRole('textbox',{name:'标称截面',exact:true}).fill('70');await page.keyboard.press('Tab');await page.keyboard.press('Control+s');await expect(page.getByText('未保存',{exact:true})).toHaveCount(0);
  assert.equal((await fixture.api('/api/workspaces/'+blank.id)).domain.cable_types[0].cores[0].conductor.nominal_area,70e-6);
  await open();await page.getByRole('radio',{name:'从型号库复制'}).check();await select('已发布型号版本',options.library[0].name+' · '+options.library[0].version);await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('库复制设计验收');
  const library=await created('library','库复制设计验收');await expect(page.getByText('库引用 · 版本 '+options.library[0].version,{exact:true})).toBeVisible();
  await open();await select('已发布型号版本',options.library[0].name+' · '+options.library[0].version);await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('库复制设计验收');
  const repeated=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/types'&&r.request().method()==='POST');await page.getByRole('button',{name:'建立草稿',exact:true}).click();const second=await (await repeated).json();assert.notEqual(second.id,library.id,'成功后的主动新建必须使用新请求身份');await expect(page).toHaveURL(new RegExp('/types/'+second.id+'/structure/section'));await layout('intentional repeated creation');
  await open();await page.getByRole('radio',{name:'按标准生成'}).check();await select('额定电压','0.6/1 kV');await select('导体几何','等截面积实心圆 · 理想化');await page.getByRole('textbox',{name:'导体截面',exact:true}).fill('70');await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('标准结构设计验收');
  await page.getByRole('button',{name:'生成结构提案'}).click();await expect(page.getByRole('region',{name:'结构提案'})).toBeVisible();await expect(page.getByRole('cell',{name:'1.1 mm',exact:true})).toBeVisible();await layout('standard proposal');
  await expect(page.getByRole('button',{name:'确认并建立草稿'})).toBeDisabled();await page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项'}).check();
  await created('standard','标准结构设计验收');await expect(page.getByText('标准生成 · 人工确认',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'额定电压 U₀',exact:true})).toHaveValue('0.6');await expect(page.getByRole('textbox',{name:'额定电压 U',exact:true})).toHaveValue('1.0');
  await open();await page.getByRole('radio',{name:'从资料导入'}).check();await select('已批准资料结果',options.imports[0].name+' · '+options.imports[0].version);await page.getByRole('textbox',{name:'型号名称',exact:true}).fill('资料导入设计验收');
  await created('import','资料导入设计验收');await expect(page.getByText('资料 · 第 1 页',{exact:true})).toBeVisible();
  for(const core of [1,2,3])for(const layer of ['导体','绝缘']){
    const label=await page.getByRole('cell',{name:`芯 ${core} · ${layer}`,exact:true}).evaluate(cell=>{const range=document.createRange();range.selectNodeContents(cell);const bounds=cell.getBoundingClientRect(),style=getComputedStyle(cell);return {lines:range.getClientRects().length,right:range.getBoundingClientRect().right,limit:bounds.right-parseFloat(style.paddingRight)};});
    assert.equal(label.lines,1,'芯层名称必须完整显示在一行');assert.ok(label.right<=label.limit+.5,'芯层名称不得越过单元格压住材料');
  }
  await open();await page.getByRole('radio',{name:'按标准生成'}).check();await select('结构类型','三芯');await select('额定电压','64/110 kV');await select('导体几何','等截面积实心圆 · 理想化');await page.getByRole('textbox',{name:'导体截面',exact:true}).fill('800');await page.getByRole('textbox',{name:'芯间净距',exact:true}).fill('0');
  await page.getByRole('button',{name:'生成结构提案'}).click();await expect(page.getByRole('alert')).toContainText('未覆盖');await expect(page.getByRole('combobox',{name:'结构类型',exact:true})).toBeFocused();await layout('unsupported standard stays in dialog');await page.keyboard.press('Escape');
  for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(fixture.url+'/types/'+blank.id+'/structure/section?theme='+theme);await expect(page.locator('[data-type-card]')).toBeVisible();await layout(`${width} ${theme} draft`);await page.goto(fixture.url+'/types/'+blank.id+'/structure/section?theme='+theme+'&revision=1');await expect(page.getByText('历史 · 只读',{exact:true})).toBeVisible();await layout(`${width} ${theme} historical`);}
  assert.deepEqual(fixture.errors,[]);
} catch(error){result.failure=String(error.stack||error);console.error(result.failure);console.error((await page.locator('body').innerText()).slice(-3000));process.exitCode=1;}
finally {mode='success';unblock?.();await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));await fixture.close();}
