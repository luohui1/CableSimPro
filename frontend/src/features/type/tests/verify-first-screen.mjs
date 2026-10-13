import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect as baseExpect } from '@playwright/test';
import { root, typeFixture } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const output=path.join(root,'.data/type-first-screen');
await fs.mkdir(output,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/type-measurements/validation.sqlite');
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
const expect=baseExpect.configure({timeout:60000}),wid='4c637df1-bcb7-49c7-9570-e8e3ceae8494',demo='68f0082e-2773-4e7f-96bd-6f2c98eb9934';
const result={source:process.env.E2E_DATABASE_SOURCE,steps:[],geometry:[],checks:[],blocked:[],errors:fixture.errors,runtime:fixture.runtime};
const requests=[];let responses=[];
page.on('request',r=>requests.push({url:r.url().replace(fixture.url,''),at:performance.now()}));
page.on('response',response=>{
  if(response.url().includes('/geometry-preview')) responses.push((async()=>{
    const data=await response.json(),model=data.artifacts?.['x-cablesim.cad-model'];
    const request=response.request().postDataJSON();
    result.geometry.push({request:{expected_revision:request.expected_revision,method:request.method,parameters:request.parameters},status:response.status(),profiling:data.profiling,environment:data.environment,
      modelProfile:model?.profiling,buildStats:model?.build_stats,layers:model?.layers.map(l=>({entity:l.entity,construction:l.construction,profiling:l.profiling,build_stats:l.build_stats})),at:performance.now()});
  })().catch(error=>result.errors.push(String(error))));
});
async function step(name,work){const start=performance.now();process.stdout.write(name+' started\n');try{await work();result.steps.push({name,seconds:+((performance.now()-start)/1000).toFixed(3),status:result.blocked.some(item=>item.step===name)?'blocked':'passed'});process.stdout.write(name+' finished\n');}catch(error){result.steps.push({name,status:'failed',error:String(error)});await page.screenshot({path:path.join(output,name+'-failed.png')});throw error;}finally{await fs.writeFile(path.join(output,'real-use.json'),JSON.stringify(result,null,2));}}
async function navigate(id,route){await page.goto(`${fixture.url}/types/${id}/${route}?theme=light`);}
try{
  await page.setViewportSize({width:1366,height:768});
  await step('structure-and-relations',async()=>{
    await navigate(wid,'structure/table');await expect(page.getByRole('table',{name:'型号分层',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'查看关联',exact:true})).toBeVisible();
    assert.equal(requests.filter(r=>r.url.includes('/relations')).length,0,'关联不能进入型号首屏路径');
    await expect.poll(()=>requests.some(r=>r.url.includes('/studies?view=summary'))).toBe(true);
    assert.equal(requests.filter(r=>r.url==='/api/workspaces/'+wid).length,1,'路由预取与型号上下文共用一次真实输入读取');
    assert.equal(requests.filter(r=>/\/studies$/.test(r.url)).length,0,'结构页不得读取完整研究列表');
    await page.getByRole('button',{name:'查看关联',exact:true}).click();
    await expect(page.locator('.relation-panel')).toBeVisible();
    assert.ok(requests.some(r=>r.url.includes('/relations')),'点击关联应取得真实索引');
    await page.locator('.relation-panel>summary').click();
    await expect(page.locator('.relation-panel a').first()).toBeVisible();
  });
  await step('method-contract',async()=>{
    await navigate(demo,'electrical/results');await expect(page.locator('[data-type-page=electrical-results]')).toHaveAttribute('data-type-state',/success|historical|empty/);
    const before=requests.length;await navigate(demo,'electrical/parameters');
    await expect.poll(()=>requests.slice(before).filter(r=>r.url.includes('/api/input-contracts')).length).toBe(1);
    await expect(page.getByRole('spinbutton',{name:'频率',exact:true}).or(page.getByText('方法参数契约不可用',{exact:true}))).toBeVisible();
    if(await page.getByText('方法参数契约不可用',{exact:true}).isVisible()){
      const reason=await page.locator('[data-type-page=electrical-results] [role=alert]').innerText();
      assert.match(reason,/宿主依赖校验失败/,'只允许记录当前并行封签冲突，其他参数错误必须失败');
      result.blocked.push({step:'method-contract',reason});
    }else await expect(page.getByRole('spinbutton',{name:'频率',exact:true})).toHaveValue('50');
    const queries=requests.slice(before).filter(r=>r.url.includes('/api/input-contracts'));
    assert.equal(queries.length,1,'所选方法只读一份契约');const selector=new URL(queries[0].url,fixture.url).searchParams;
    assert.equal(selector.get('plugin_id'),'cablesim.type-electrical');assert.equal(selector.get('capability'),'electrical');
    assert.ok(selector.get('version')&&selector.get('release_digest'),'固定完整方法身份');
    assert.equal(requests.filter(r=>r.url==='/api/input-contracts').length,0);
  });
  await step('review-status',async()=>{
    await navigate(wid,'specification/review');await expect(page.locator('[aria-label="按责任处理发布阻塞"]')).toBeVisible();
    const field=await fixture.api(`/api/workspaces/${wid}`),insulation=field.domain.cable_types[0].cores[0].layers.find(l=>l.role==='insulation');
    // A real unsaved geometry change makes the specification historical.
    await page.getByRole('button',{name:/^结构 · 3 芯 · \d+ 层/}).click();
    const input=page.locator('.type-layer-input input').nth(2);await input.fill(String(insulation.thickness*1000+.1));await input.press('Tab');
    await page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:/^规格书/}).click();await page.getByRole('tab',{name:'审核与发布',exact:true}).click();
    await expect(page.locator('.type-result-toolbar').getByRole('button',{name:'已过期',exact:true})).toBeVisible();
    assert.equal(await page.getByText('输入或来源已变化；重新生成后才能交付当前客户版。',{exact:true}).count(),0,'说明在折叠追溯中');
    assert.equal(await page.getByRole('toolbar',{name:'型号命令'}).getByText('已过期',{exact:true}).count(),0);
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);result.checks.push({page:'review',width,theme,...await checkLayout(page,'.type-root')});}
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(output,'review-1366-light.png'),animations:'disabled'});
    await page.getByRole('button',{name:'撤销',exact:true}).click();
  });
  await step('plugin-refinement',async()=>{
    for(const id of [wid,demo])for(const kind of ['uncached-shape','cached']){
      const start=performance.now();await navigate(id,'structure/three');await expect(page.locator('.cad-viewport')).toHaveAttribute('data-cad-model-kind','precise',{timeout:120000});
      await expect(page.locator('.cad-viewport')).toHaveAttribute('aria-busy','false',{timeout:120000});
      result.checks.push({page:id,kind,refinedMeshMs:+(performance.now()-start).toFixed(1),attributes:await page.locator('.cad-viewport').evaluate(e=>Object.fromEntries([...e.attributes].filter(a=>a.name.startsWith('data-cad-')).map(a=>[a.name,a.value])))});
    }
    await Promise.all(responses);responses=[];
    assert.equal(result.geometry.length,4,'两种真实结构各完成一次细化与缓存读取');
    assert.ok(result.geometry.every(g=>g.status===200&&g.request.parameters.include_exact===false),'保留原有网格显示精度；拓扑测量另行按需读取');
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);result.checks.push({page:'peel',width,theme,...await checkLayout(page,'.type-canvas-frame')});}
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await page.screenshot({path:path.join(output,'peel-1366-light.png'),animations:'disabled'});
  });
  await step('compact-layer-controls',async()=>{
    const study='7e153e94-cbed-4fd6-9c4e-5c26e7e92562';
    for(const tab of ['section','layers','references']){
      await page.setViewportSize({width:1366,height:768});
      await page.goto(`${fixture.url}/studies/${study}/cable/${tab}?theme=light`);
      await expect(page.locator('.drawing-compact-layer')).toHaveCount(8);
      for(const width of [1366,1920])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:width===1366?768:1080});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        result.checks.push({page:'study-cable-layout/'+tab,width,theme,...await checkLayout(page,'.drawing-frame')});
        if(width===1920){await expect(page.locator('[data-layer-leader]')).toHaveCount(8);await expect(page.locator('.drawing-compact-layer')).toHaveCount(0);result.checks.push({page:'study-cable/'+tab,width,theme,mode:'inline-leaders',layers:8});continue;}
        await expect(page.locator('.drawing-compact-layer')).toHaveCount(8);
        const controls=await page.locator('.drawing-compact-layer').evaluateAll(items=>items.map(item=>{
          const button=item.querySelector('button'),spans=[...item.querySelectorAll(':scope>span')];
          return {name:button.textContent,height:button.getBoundingClientRect().height,overflow:button.scrollHeight>button.clientHeight+1,material:spans[0]?.textContent,dimension:spans[1]?.textContent};
        }));
        assert.equal(controls.length,8);
        assert.ok(controls.every(c=>c.name.trim()&&c.height>=32&&c.height<=33&&!c.overflow&&c.material&&/mm/.test(c.dimension)),'选择层与静态材料、尺寸分开，名称完整且控件保持统一高度');
        result.checks.push({page:'study-cable/'+tab,width,theme,controls});
      }
    }
    await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await expect(page.locator('.drawing-compact-layer')).toHaveCount(8);await page.screenshot({path:path.join(output,'drawing-controls-1366-light.png'),animations:'disabled'});
  });
  assert.deepEqual(fixture.errors,[]);result.complete=true;
}finally{await Promise.all(responses);await fs.writeFile(path.join(output,'real-use.json'),JSON.stringify(result,null,2));await fixture.close();}
