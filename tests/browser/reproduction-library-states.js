// BrowserOS neo run-body. Network/empty fixtures affect only this owned page.
const page=browser.page((await browser.pages.list()).find(p=>p.ownership==='mine'&&p.url.includes(':8036/')).pageId);
async function value(fn,arg){return (await page.evaluate(fn,arg)).value;}
async function wait(selector){if(!(await page.waitForSelector(selector)).matched)throw Error('Missing '+selector);}
async function click(selector){
 await value(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);return true;});
 const p=await value(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);
 await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type:'mouseMoved',x:90,y:90}));
 await value(()=>{window.__repPointer=null;document.addEventListener('mousemove',event=>window.__repPointer={x:event.clientX,y:event.clientY},{once:true,capture:true});});
 await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type:'mouseMoved',x:100,y:100}));
 const q=await value(()=>{const p=window.__repPointer;delete window.__repPointer;return p;});
 if(!q||q.x<=0||q.y<=0)throw Error('Native pointer calibration failed');
 for(const type of ['mousePressed','mouseReleased'])await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type,x:p.x*100/q.x,y:p.y*100/q.y,button:'left',clickCount:1}));
}
await page.goto('http://127.0.0.1:8036/design/workbench/#/library/reproductions');await page.reload();await wait('#rep-filter');
await value(()=>{window.__repFetch=window.fetch;window.fetch=(url,options)=>String(url).endsWith('/foundation/reproductions')?new Promise((resolve,reject)=>{window.__repRelease=()=>window.__repFetch(url,options).then(resolve,reject);}):window.__repFetch(url,options);});
await click('[data-action="rep-refresh"]');await wait('.rep-empty[role="status"]');
const loading=await value(()=>document.querySelector('.rep-empty').innerText.includes('正在读取'));
await value(()=>{window.fetch=window.__repFetch;window.__repRelease();});await wait('#rep-filter');
await value(()=>{window.fetch=(url,options)=>String(url).endsWith('/foundation/reproductions')?Promise.reject(new TypeError('Simulated connection loss')):window.__repFetch(url,options);});
await click('[data-action="rep-refresh"]');await wait('.rep-empty[role="alert"]');
const error=await value(()=>document.querySelector('.rep-empty').innerText.includes('读取失败')&&document.querySelector('.rep-empty').innerText.includes('连接中断'));
await value(()=>window.fetch=window.__repFetch);await click('.rep-empty [data-action="rep-refresh"]');await wait('#rep-filter');
await value(()=>{window.fetch=(url,options)=>String(url).endsWith('/foundation/reproductions')?Promise.resolve(new Response(JSON.stringify({items:[],history:[],snapshot_id:null}),{headers:{'Content-Type':'application/json'}})):window.__repFetch(url,options);});
await click('[data-action="rep-refresh"]');await wait('.rep-empty:not([role]) [data-action="rep-refresh"]');
const empty=await value(()=>document.querySelector('.rep-empty').innerText.includes('尚无复现记录'));
await value(()=>{window.fetch=window.__repFetch;delete window.__repFetch;delete window.__repRelease;});
await click('.rep-empty [data-action="rep-refresh"]');await wait('#rep-filter');
if(!loading||!error||!empty)throw Error('State check failed');
return {loading,error,empty,recovery:true};
