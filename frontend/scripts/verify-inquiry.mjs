import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as expectBase } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
import { assertLayout } from './layout-assertions.mjs';
if (process.env.E2E_ISOLATED !== '1') throw Error('Requires isolated database');
const base = process.env.FRONTEND_URL, expect = expectBase.configure({timeout:30000});
const output = path.join(outputRoot,'inquiry');
await fs.mkdir(output,{recursive:true});
const session = await openHeadlessBrowser(), {page,context} = session;
const report = {checks:[],variants:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
async function go(route) { await page.goto('about:blank'); await page.goto(base+route); await settle(page); }
async function variants(label) {
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]) {
    await page.setViewportSize(size);
    for(const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await assertLayout(page,label);report.variants.push({label,...size,theme});
    }
  }
}
async function shot(name) { await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(output,name+'.png')}); }
try {
  await go('/');
  await expect(page.getByRole('table',{name:'继续工作'})).toBeVisible({timeout:90000});
  await expect(page.getByRole('region',{name:'需要处理'})).toBeVisible();
  assert.doesNotMatch(await page.getByRole('table',{name:'继续工作'}).innerText(),/\d{4}-\d\d-\d\dT/);
  await variants('首页');await shot('home');report.checks.push('继续工作合并研究与型号；更新时间使用本地格式');
  for(const mode of process.env.INQUIRY_RESULTS_ONLY === '1' ? [] : ['paste','autofill','silent','enter','invalid']) {
    console.log('输入回归：'+mode);
    if(new URL(page.url()).pathname!=='/') await go('/');
    else {
      const completion=page.getByRole('dialog',{name:'补录工程师给定参数'});
      if(await completion.count()) await completion.getByRole('button',{name:'关闭',exact:true}).click();
      const initial=page.getByRole('dialog',{name:'新建问询'});
      if(await initial.count()) await initial.getByRole('button',{name:'关闭',exact:true}).click();
    }
    await page.getByRole('button',{name:'新建研究',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'新建问询'}), input=dialog.getByLabel('目标电流',{exact:true});
    await expect(input).toBeVisible({timeout:90000});
    await dialog.locator('input[type=radio]').first().check();
    await input.focus();
    if(mode==='paste') {
      await context.grantPermissions(['clipboard-read','clipboard-write']);
      await page.evaluate(()=>navigator.clipboard.writeText('401'));
      await page.keyboard.press('Control+V');
    } else if(mode==='enter') await input.fill('402');
    else await input.evaluate((el,mode)=>{
      el.value=mode==='invalid'?'bad':'400';
      if(mode==='autofill') el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText'}));
    },mode);
    if(mode==='autofill') await shot('numeric-input');
    if(mode==='enter') await input.press('Enter');
    else if(mode==='autofill') await dialog.locator('form').evaluate(form=>form.requestSubmit());
    else await dialog.getByRole('button',{name:'建立研究',exact:true}).evaluate(button=>button.click());
    if(mode==='invalid') {await expect(dialog.getByRole('alert')).toContainText('大于 0');await variants('问询输入错误');continue;}
    await expect(page.getByRole('dialog',{name:'补录工程师给定参数'})).toBeVisible();
    report.checks.push(mode+' 不失焦直接提交已进入补录');
    if(mode!=='silent') continue;
    await page.getByRole('button',{name:'采用参考输入',exact:true}).click();
    await page.getByRole('button',{name:'保存并预检',exact:true}).click();
    const check=page.getByRole('dialog',{name:'运行前预检'});
    await expect(check.getByText('你的工况在适用范围内 ✓',{exact:true})).toBeVisible({timeout:180000});
    await expect(check.getByRole('checkbox')).toHaveCount(0);
    await expect(check.getByRole('button',{name:'确认并运行'})).toBeEnabled();
    assert.doesNotMatch(await check.innerText(),/case-\d/);
    await expect(check.locator('details')).not.toHaveAttribute('open','');
    await variants('真实问询预检通过');await shot('preflight');
    const url=new URL(page.url()), sid=url.pathname.split('/')[2],wid=url.searchParams.get('workspace');
    const saved=(await request(base,`/api/workspaces/${wid}/studies`)).find(s=>s.id===sid);
    assert.equal(saved.definition.driver.minimum,400);
    report.checks.push('真实新建问询保存 400 A，预检可直接运行，型号名替代内部编号；未发起求解');
    let runRequest;
    await page.route('**/studies/*/runs',async route=>{
      if(route.request().method()!=='POST')return route.fallback();
      runRequest=route.request().postDataJSON();
      await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:'测试运行提交冲突，不执行求解'})});
    });
    await check.getByRole('button',{name:'确认并运行'}).click();
    await expect(check.getByText('测试运行提交冲突，不执行求解')).toBeVisible();
    assert.equal(runRequest.scope_acknowledged,true);assert.ok(runRequest.lock_digest);
    await page.unroute('**/studies/*/runs');
    await check.getByRole('button',{name:'关闭',exact:true}).click();
    for(const state of ['partial','blocked']) {
      await page.route('**/preflight?*',async route=>{
        const response=await route.fetch(), body=await response.json();
        body.partial=true;body.ready=state==='partial';
        body.cases=body.cases.map((c,i)=>state==='partial'&&i>0?c:{...c,status:'not_applicable',error:{code:'NOT_APPLICABLE',message:'埋深超出方法范围，请调整敷设坐标',path:'/sections/section~1s1/placements/cable~1c1-A/z'}});
        await route.fulfill({response,json:body});
      });
      await page.getByRole('button',{name:'预检并运行',exact:true}).click();
      await expect(check.getByText(/项超出范围/)).toBeVisible();
      const runButton=check.getByRole('button',{name:'确认并运行'});
      await expect(runButton).toBeDisabled();
      if(state==='partial') {await check.getByRole('checkbox').check();await expect(runButton).toBeEnabled();}
      else await expect(check.getByRole('checkbox')).toBeDisabled();
      await variants('预检负向注入 '+state);
      await check.getByRole('button',{name:'关闭',exact:true}).click();
      await page.unroute('**/preflight?*');
    }
    report.checks.push('运行提交携带预检锁；负向注入验证部分不适用需确认、全部不适用不可运行');
  }
  let selected;
  for(const w of await request(base,'/api/workspaces')) {
    for(const s of await request(base,`/api/workspaces/${w.id}/studies`)) {
      if(s.definition.driver.kind!=='selection')continue;
      const r=(await request(base,`/api/workspaces/${w.id}/studies/${s.id}/runs`)).items.find(r=>r.integrity==='verified'&&r.output?.assessment?.some(a=>a.status==='satisfied'));
      if(r){selected={w,s,r};break;}
    }
    if(selected)break;
  }
  assert.ok(selected,'真实保存的选型结果');
  const {w,s,r}=selected, route=`/studies/${s.id}/selection/results?workspace=${w.id}&run=${r.id}`;
  await go(route);
  const conditions=page.getByLabel('本次计算工况');
  await expect(conditions).toContainText('埋深');
  const original=await conditions.innerText();
  await variants('真实推荐结果');await shot('recommendation');
  for(const [label,tab] of [['埋深','coordinates'],['土壤','media'],['°C','inputs']]) {
    await conditions.getByRole('link',{name:new RegExp(label)}).click();
    await expect(page).toHaveURL(new RegExp('/'+tab+'\\?'));
    assert.equal(new URL(page.url()).searchParams.get('run'),r.id);
    await expect(page.getByText(/固定运行.*只读/).first()).toBeVisible();
    await go(route);
  }
  const ws=await request(base,`/api/workspaces/${w.id}`);
  ws.domain.sections[0].medium.surface_temperature=308.15;
  await request(base,`/api/workspaces/${w.id}/domain`,'PUT',{expected_revision:ws.revision,document:ws.domain});
  await go(route);await expect(conditions).toHaveText(original);
  await variants('历史结论保留快照工况');report.checks.push('真实推荐三个输入链接与冻结参数一致，修改当前温度后历史前提保持不变');
  for(const state of ['empty','loading','error']) {
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/studies/*/runs*',async route=>{
      if(state==='loading')await gate;
      await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'问询运行暂时不可用'}:{items:[]})}).catch(()=>{});
    });
    await go(`/studies/${s.id}/selection/results?workspace=${w.id}`);
    await expect(state==='loading'?page.locator('[aria-busy=true]').first():state==='empty'?page.getByText('尚无选型运行',{exact:true}):page.getByText('问询运行暂时不可用',{exact:false}).first()).toBeVisible();
    await variants('选型'+state);release();
    if(state==='loading')await expect(page.getByText('尚无选型运行',{exact:true})).toBeVisible();
    await page.unroute('**/studies/*/runs*');
  }
  assert.deepEqual(report.errors,[]);
} finally {
  await fs.writeFile(path.join(output,process.env.INQUIRY_RESULTS_ONLY === '1'?'results.json':'verification.json'),JSON.stringify(report,null,2));
  await session.close();
}
console.log(JSON.stringify(report,null,2));
