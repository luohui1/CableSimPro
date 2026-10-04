// BrowserOS neo run-body. Reuse an owned test tab on the isolated local service.
const page=browser.page((await browser.pages.list()).find(p=>p.ownership==='mine'&&p.url.includes(':8036/')).pageId);
const checks=[];
async function value(fn,arg){const result=await page.evaluate(fn,arg);return result.value;}
async function requireSelector(selector){if(!(await page.waitForSelector(selector)).matched)throw Error('Missing '+selector);}
async function click(selector){
 await value(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);return true;});
 const point=await value(sel=>{const el=document.querySelector(sel);if(!el)throw Error('Missing '+sel);el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);
 const scale=await pointerScale();
 for(const type of ['mousePressed','mouseReleased'])await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type,x:point.x*scale.x,y:point.y*scale.y,button:'left',clickCount:1}));
}
async function pointerScale(){
 await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type:'mouseMoved',x:90,y:90}));
 await value(()=>{window.__repPointer=null;document.addEventListener('mousemove',event=>window.__repPointer={x:event.clientX,y:event.clientY},{once:true,capture:true});});
 await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type:'mouseMoved',x:100,y:100}));
 const p=await value(()=>{const p=window.__repPointer;delete window.__repPointer;return p;});
 if(!p||p.x<=0||p.y<=0)throw Error('Native pointer calibration failed');
 return {x:100/p.x,y:100/p.y};
}
async function key(key,code,modifiers=0){for(const type of ['keyDown','keyUp'])await page.cdp('Input.dispatchKeyEvent',JSON.stringify({type,key,code,modifiers}));}
await page.goto('http://127.0.0.1:8036/design/workbench/#/library/reproductions');
await page.reload();
await requireSelector('#rep-filter');
await click('[data-action="rep-reset"]');
await value(()=>document.querySelector('#rep-query').focus());
await page.cdp('Input.insertText',JSON.stringify({text:'E17'}));
await key('Enter','Enter');
await requireSelector('[data-rep-id="E17"]:only-child');
if(await value(()=>document.querySelectorAll('[data-rep-id]').length)!==1)throw Error('Enter search did not filter');
checks.push('search-enter');
await value(()=>document.querySelector('[data-rep-id="E17"]').focus());
await key('Enter','Enter');
await requireSelector('.rep-result-table');
if(!await value(()=>document.querySelector('.rep-result-table').innerText.includes('177')))throw Error('Actual reference absent');
checks.push('open-row-enter-real-data');
await click('.rep-tabs a[href*="/convergence"]');
await requireSelector('.rep-chart');
if(await value(()=>document.querySelectorAll('.rep-point').length)<3)throw Error('Missing convergence points');
checks.push('native-click-convergence');
await click('.rep-tabs a[href*="/sources"]');
await requireSelector('.rep-sources');
if(!await value(()=>document.querySelector('.rep-sources').innerText.includes('Table 1')))throw Error('Input provenance absent');
checks.push('source-provenance');
await value(()=>{window.__repDownload=null;window.__repAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__repDownload={name:this.download,url:this.href};window.__repExportPromise=fetch(this.href).then(r=>r.json());return;}return window.__repAnchorClick.call(this);};});
await key('s','KeyS',2);
const exported=await value(async()=>{const d=window.__repDownload;if(!d)return null;const raw=await window.__repExportPromise;return {name:d.name,id:raw.id,rowCount:raw.rows?.length,evidenceCount:raw.evidence?.length};});
await value(()=>{HTMLAnchorElement.prototype.click=window.__repAnchorClick;delete window.__repAnchorClick;});
if(!exported?.name.includes('E17')||exported.id!=='E17'||!exported.rowCount||!exported.evidenceCount)throw Error('CtrlS did not export selected evidence');
checks.push('ctrl-s-export');
await key('Escape','Escape');
await requireSelector('#rep-filter');
await click('[data-action="rep-reset"]');
await value(()=>document.querySelector('#rep-query').focus());
await page.cdp('Input.insertText',JSON.stringify({text:'no-such-reproduction-xyz'}));
await key('Enter','Enter');
await requireSelector('.rep-empty');
if(!await value(()=>document.querySelector('.rep-empty').innerText.includes('没有符合')))throw Error('Filtered empty state missing');
await value(()=>document.activeElement.blur());
await key('z','KeyZ',2);
await requireSelector('[data-rep-id="E17"]');
checks.push('escape-empty-undo');
const history=await value(()=>{const s=document.querySelector('#rep-snapshot');return s.options.length>1?s.options[1].value:null;});
if(history){await value(id=>{const s=document.querySelector('#rep-snapshot');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}));},history);await requireSelector('.rep-historical');checks.push('immutable-history');}
await page.goto('http://127.0.0.1:8036/design/workbench/#/library/reproductions/E17/convergence');
await requireSelector('.rep-chart');
return {checks,route:await value(()=>location.hash)};
