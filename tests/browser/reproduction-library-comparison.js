// BrowserOS neo run-body: verify actual comparison controls at the current viewport.
const page=browser.page((await browser.pages.list()).find(p=>p.ownership==='mine'&&p.url.includes(':8036/')).pageId);
async function value(fn,arg){return (await page.evaluate(fn,arg)).value;}
async function wait(s){if(!(await page.waitForSelector(s)).matched)throw Error('Missing '+s);}
async function click(s){
 await value(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);});
 const p=await value(s=>{const e=document.querySelector(s);e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},s);
 await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type:'mouseMoved',x:90,y:90}));
 await value(()=>{window.__repPointer=null;document.addEventListener('mousemove',event=>window.__repPointer={x:event.clientX,y:event.clientY},{once:true,capture:true});});
 await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type:'mouseMoved',x:100,y:100}));
 const q=await value(()=>{const p=window.__repPointer;delete window.__repPointer;return p;});
 if(!q||q.x<=0||q.y<=0)throw Error('Native pointer calibration failed');
 for(const type of ['mousePressed','mouseReleased'])await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type,x:p.x*100/q.x,y:p.y*100/q.y,button:'left',clickCount:1}));
}
const checks=[];
await page.goto('http://127.0.0.1:8036/design/workbench/#/library/reproductions');await page.reload();await wait('#rep-filter');
await click('[data-action="rep-reset"]');
const counts=await value(()=>[...document.querySelectorAll('[data-rep-status]')].map(e=>Number(e.querySelector('strong').textContent)));
if(counts[0]!==counts.slice(1).reduce((a,b)=>a+b,0))throw Error('Status totals do not reconcile');
await click('[data-rep-status="reproduced"]');
if(!await value(()=>document.querySelector('[data-rep-status="reproduced"]').getAttribute('aria-pressed')==='true'&&[...document.querySelectorAll('[data-rep-id]')].every(e=>e.cells[2].textContent==='已复现')))throw Error('Quick status filter incorrect');
checks.push('status-counts-and-filter');
await click('[data-rep-status="all"]');
if(!await value(()=>document.querySelector('[data-rep-id="E17"] td a').textContent.includes('双圆导体交流电阻')))throw Error('Chinese short title missing');
await click('[data-rep-id="E17"] td a');await wait('.rep-conclusion');
const conclusion=await value(()=>{const c=document.querySelector('.rep-conclusion').getBoundingClientRect(),t=document.querySelector('.rep-tabs').getBoundingClientRect();return {above:c.bottom<=t.top,text:document.querySelector('.rep-conclusion').innerText};});
if(!conclusion.above||!conclusion.text.includes('原文')||!conclusion.text.includes('COMSOL'))throw Error('Conclusion is missing comparison or not first');
const numbers=await value(()=>[...document.querySelectorAll('.rep-result-table .number')].map(e=>e.innerText));
if(!numbers.some(s=>s.includes('177.000'))||numbers.some(s=>/\d\.\d{4,}/.test(s)))throw Error('Display precision not uniform');
checks.push('short-title','conclusion-first','three-decimal-display');
await click('.rep-tabs a[href*="/overlay"]');await wait('.rep-chart');
const initial=await value(()=>[...document.querySelectorAll('.rep-chart [data-series]')].map(e=>e.dataset.series));
if(!['reference','open_source','comsol'].every(s=>initial.includes(s)))throw Error('Three-way overlay incomplete');
await click('[data-rep-series="comsol"]');
if(await value(()=>Boolean(document.querySelector('.rep-chart [data-series="comsol"]'))))throw Error('COMSOL toggle failed');
await click('[data-rep-series="comsol"]');
if(!await value(()=>Boolean(document.querySelector('.rep-chart [data-series="comsol"]'))))throw Error('COMSOL restore failed');
checks.push('three-series-overlay-toggle');
await page.goto('http://127.0.0.1:8036/design/workbench/#/library/reproductions/C06/convergence');await wait('.rep-chart');
const ticks=await value(()=>[...document.querySelectorAll('.rep-x-tick')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};}));
if(ticks.length<2||ticks.some((r,i)=>i>0&&r.left<ticks[i-1].right))throw Error('Nearby mesh labels overlap');
checks.push('close-mesh-label-spacing');
const layout=await value(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,invalid:[...document.querySelectorAll('svg [points],svg [cx],svg [cy]')].some(e=>/NaN|Infinity/.test(e.outerHTML))}));
if(layout.overflow||layout.invalid)throw Error('Overflow or invalid chart geometry');
return {checks,layout};
