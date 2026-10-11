/** One-page Edge/CDP acceptance; use a private demo copy, never 8100/8200.
 * FRONTEND_URL=http://127.0.0.1:5194 BACKEND_URL=http://127.0.0.1:8134
 * node src/features/field/verify-preflight.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser, settle, repositoryRoot} from '../../../scripts/browser.mjs';
const origin=process.env.FRONTEND_URL || 'http://127.0.0.1:5194', backend=process.env.BACKEND_URL || 'http://127.0.0.1:8134';
for(const url of [origin,backend])assert(!['8100','8200'].includes(new URL(url).port));
const output=process.env.FIELD_ACCEPTANCE_OUTPUT || path.join(repositoryRoot,'.data/fix-round/simulation-preflight');await fs.mkdir(output,{recursive:true});
const session=await openHeadlessBrowser(), page=session.page, errors=[], checks=[];
page.setDefaultTimeout(20000);
page.on('pageerror',error=>errors.push(error.message));
let nativeChecks=0, submits=0;
page.on('request',request=>{if(/\/preflight\?/.test(request.url()))nativeChecks++;if(request.method()==='POST'&&request.url().endsWith('/runs'))submits++;});
try {
  // Optional verified single-plugin contract isolates an unrelated package seal
  // being edited by another thread. Numerical/input-preflight APIs remain real.
  if(process.env.FIELD_INPUT_CONTRACT){const contract=JSON.parse(await fs.readFile(process.env.FIELD_INPUT_CONTRACT,'utf8'));await page.route('**/api/input-contracts',route=>route.fulfill({json:contract}));}
  await page.route('**/field-layout-acceptance*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>场图布局验收</title><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const fixture=await import('/src/features/field/layout-fixture.tsx');if(location.search.includes('units'))await fixture.renderNumberFields();else fixture.renderDirectField();window.ready=true;
</script><style>body{margin:0;background:var(--panel)}#test{height:100vh;max-width:100%;font-family:var(--font-ui)}#test.small{height:320px;width:480px}</style></head><body><main id="test"></main></body></html>`}));
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const small of [false,true]){
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(origin+'/field-layout-acceptance');await page.waitForFunction(()=>window.ready);await settle(page);
    await page.evaluate(({theme,small})=>{document.documentElement.dataset.theme=theme;document.getElementById('test').className=small?'small':'';},{theme,small});await page.waitForTimeout(200);
    await page.locator('[aria-label="温度色标"]').waitFor();
    const field=page.locator('.field-view');
    const assertField=async()=>{
      const result=await field.evaluate(element=>{
        const texts=[...element.querySelectorAll('svg text')];
        const boxes=texts.map(node=>({text:node.textContent,rect:node.getBoundingClientRect()}));
        const collisions=[];for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){
          const x=boxes[a].rect,y=boxes[b].rect;if(x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top)collisions.push([boxes[a].text,boxes[b].text]);
        }
        const rgb=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
        const luminance=value=>rgb(value).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        const style=getComputedStyle(element),panel=luminance(style.getPropertyValue('--panel').trim().startsWith('#')?getComputedStyle(document.body).backgroundColor:style.backgroundColor);
        const contrast=texts.map(node=>{const l=luminance(getComputedStyle(node).fill);return (Math.max(l,panel)+.05)/(Math.min(l,panel)+.05);});
        const canvas=element.querySelector('canvas').getBoundingClientRect(),bar=element.querySelector('.field-colorbar').getBoundingClientRect();
        const overlap=canvas.left<bar.right&&canvas.right>bar.left&&canvas.top<bar.bottom&&canvas.bottom>bar.top;
        const tokenStyle=getComputedStyle(element),stops=Array.from({length:6},(_,i)=>tokenStyle.getPropertyValue('--temperature-'+(i+1)).trim());
        const annotation=element.querySelector('[data-field-label="hotspot"]');
        return {collisions,contrast,overlap,canvas:canvas.toJSON(),bar:bar.toJSON(),stops,position:element.dataset.colorbarPosition,hotspot:!!annotation,
          barCount:element.querySelectorAll('[aria-label="温度色标"]').length,minimumFont:Math.min(...texts.map(n=>parseFloat(getComputedStyle(n).fontSize)))};
      });
      assert.equal(result.barCount,1);assert.deepEqual(result.collisions,[]);assert(result.contrast.every(value=>value>=4.5),JSON.stringify(result));assert(!result.overlap,JSON.stringify(result));
      assert(result.minimumFont>=13);assert(result.hotspot);if(small)assert.equal(result.position,'bottom');return result;
    };
    let result=await assertField();
    const box=await field.boundingBox();await page.mouse.move(box.x+box.width*.35,box.y+100);await page.waitForTimeout(100);await assertField();
    await page.mouse.wheel(0,-220);await page.waitForTimeout(100);await assertField();
    await field.dblclick({position:{x:30,y:30}});await page.mouse.move(width-1,0);await page.waitForTimeout(100);result=await assertField();
    checks.push({surface:'field',width,theme,small,...result});
    if(width===1366&&theme==='light'&&small)await page.screenshot({path:path.join(output,'field.png')});
  }
  console.log('Field layout: 8 combinations passed');
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(origin+'/field-layout-acceptance?units');await page.waitForFunction(()=>window.ready);await settle(page);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.getByLabel('埋深下限',{exact:true}).waitFor();
    const units=await page.locator('.number-input').evaluateAll(nodes=>nodes.map(container=>{
      const a=container.querySelector('input').getBoundingClientRect(),label=container.querySelector('.unit');
      const b=label.getBoundingClientRect(),c=container.getBoundingClientRect();
      return {inside:b.left>=a.right&&b.right<=c.right&&b.top>=c.top&&b.bottom<=c.bottom,unit:label.textContent.replace(/\s/g,'')};
    }));
    assert.deepEqual(units.map(row=>row.unit),['m','K·m/W']);assert(units.every(row=>row.inside),JSON.stringify(units));
    checks.push({surface:'batch-number-field-units',width,theme,passed:true});
  }
  const workspaces=await(await fetch(backend+'/api/workspaces')).json();let study,workspace;
  for(const w of workspaces){const studies=await(await fetch(`${backend}/api/workspaces/${w.id}/studies`)).json();study=studies.find(s=>s.definition.method.plugin_id==='cablesim.simulation');if(study){workspace=w;break;}}
  assert(study,'Private demo needs an FEM study');
  const url=`${origin}/studies/${study.id}/thermal-field/field?workspace=${workspace.id}`;
  let mode='valid';
  const availability=await(await fetch(`${backend}/api/hpc/workspaces/${workspace.id}/studies/${study.id}/availability`)).json();
  assert.equal(availability.configured,false,'Acceptance backend must have an unconfigured HPC profile');
  await page.route('**/api/hpc/**/input-preflight?*',async route=>{
    if(mode==='valid')return route.continue();
    if(mode==='loading')await new Promise(resolve=>setTimeout(resolve,900));
    if(mode==='error')return route.fulfill({status:503,json:{detail:'输入检查连接中断，保存数据保留，请重新检查。'}});
    return route.fulfill({json:{ready:false,local_only:true,input_ready:mode!=='missing',cases:[{case_id:'case-0',status:mode==='missing'?'failed':'succeeded',...(mode==='missing'?{error:{code:'INPUT_INVALID',issues:[
      {path:'/parameters/mesh/size_m',message:'required'},{path:'/parameters/initial_temperature_k',message:'required'}]}}:{})}]}});
  });
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});mode='valid';
    await page.goto(url+'&theme='+theme);await settle(page);
    const button=page.getByRole('button',{name:'预检并运行',exact:true});await button.waitFor();assert(await button.isEnabled());await button.click();
    const dialog=page.getByRole('dialog');await dialog.getByText('已通过输入检查',{exact:false}).waitFor({timeout:30000});
    const placement=dialog.locator('.solver-location');assert.equal(await placement.count(),1);
    assert((await placement.innerText()).includes('求解位置：超算'));assert((await placement.innerText()).includes('未配置'));
    assert(await dialog.getByRole('button',{name:'确认并运行'}).isDisabled());
    assert((await dialog.getByRole('link',{name:'去设置'}).getAttribute('href')).startsWith('/settings/compute'));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push({surface:'offline-preflight',width,theme,passed:true});
    if(width===1366&&theme==='light')await page.screenshot({path:path.join(output,'preflight.png')});
    await page.keyboard.press('Escape');mode='missing';await button.click();await dialog.getByText('初始绝对温度未填写',{exact:false}).waitFor();
    const body=await dialog.innerText();assert(!body.includes('required'));assert(!body.includes('/parameters'));assert(!body.includes('具体缺项位置未提供'));
    await dialog.getByRole('button',{name:/修正.*(?:近场|局部)网格尺寸/}).click();
    await page.waitForFunction(()=>document.activeElement?.closest('[data-field-path]')?.getAttribute('data-field-path')==='/mesh/size_m',{timeout:12000});
    checks.push({surface:'missing-fields-focus',width,theme,passed:true});
  }
  mode='error';await page.goto(url);await settle(page);await page.getByRole('button',{name:'预检并运行',exact:true}).click();await page.getByRole('dialog').getByText('输入检查连接中断',{exact:false}).waitFor();
  assert(await page.getByRole('dialog').getByRole('button',{name:'确认并运行'}).isDisabled());
  mode='loading';await page.getByRole('button',{name:'重新检查'}).click();await page.getByText('正在本机检查',{exact:false}).waitFor();await page.getByText('已通过输入检查',{exact:false}).waitFor();
  assert.equal(nativeChecks,0,'Unconfigured preflight must not invoke native checks');assert.equal(submits,0);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'browser-checks.json'),JSON.stringify({checks,nativeChecks,submits,errors},null,2));console.log(JSON.stringify({passed:checks.length,nativeChecks,submits}));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});console.error(errors);console.error((await page.locator('body').innerText()).slice(-3000));throw error;}
finally{await session.close();}
