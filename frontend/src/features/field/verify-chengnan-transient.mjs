/** Read the actual 817014 steady source. No solver submission or API stubs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,repositoryRoot} from '../../../scripts/browser.mjs';
const front=process.env.FRONTEND_URL, back=process.env.BACKEND_URL;
for(const url of [front,back])assert(url && new URL(url).hostname==='127.0.0.1' && !['8100','8200'].includes(new URL(url).port));
const out=path.join(repositoryRoot,'.data/fix-round/simulation-chengnan-transient');
await fs.mkdir(out,{recursive:true});
const sid='2625752f-12f1-4783-a507-d10e04851302', rid='1bffea37-37a2-4405-beed-9ff48e82ee7e';
const browser=await openHeadlessBrowser(),{page}=browser, errors=[],requests=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{const url=new URL(request.url());requests.push({method:request.method(),path:url.pathname,query:url.search});});
const started=performance.now();
try {
 for(const width of [1366,1920])for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:width===1366?768:1080});
  await page.goto(`${front}/studies/${sid}/thermal-field/field?theme=${theme}&run=${rid}`);
  const entry=page.getByRole('tab',{name:'阶跃热响应',exact:true});
  await entry.waitFor({timeout:120000});await entry.click();
  const response=page.locator('section[aria-label="阶跃热响应"]');
  await response.getByText('该工况的阶跃响应尚未覆盖',{exact:true}).waitFor({timeout:120000});
  await response.scrollIntoViewIfNeeded();
  const text=await response.innerText();
  assert(text.includes('多根单芯')&&text.includes('预载')&&text.includes('热容'),text);
  assert.equal(await response.getByRole('button',{name:'预检响应与预算',exact:true}).count(),0,'Unsupported source must not offer a misleading submit path');
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth}));
  assert(!layout.overflow,JSON.stringify(layout));checks.push({width,theme,...layout,text});
  if(width===1366&&theme==='light')await page.screenshot({path:path.join(out,'transient-admission.png')});
 }
 assert.deepEqual(errors,[]);
 assert.equal(requests.filter(r=>r.method==='POST'&&/step-responses|\/runs$|\/convergence$/.test(r.path)).length,0);
 assert.equal(requests.filter(r=>r.path==='/api/input-contracts'&&!r.query).length,0,'No complete contract catalogue on the result page');
 await fs.writeFile(path.join(out,'real-use.json'),JSON.stringify({source_job:'817014',source_run:rid,seconds:(performance.now()-started)/1000,checks,requests,errors,submitted:false,new_core_hours:0},null,2));
} catch(error) {
 await page.screenshot({path:path.join(out,'failure.png')});
 await fs.writeFile(path.join(out,'failure-visible.txt'),await page.locator('body').innerText());throw error;
} finally {
 await browser.close();console.log('本任务浏览器已关闭，剩余标签页 0。');
}
