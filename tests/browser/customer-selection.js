// BrowserOS neo run body for a saved published-specification inquiry on the local service.
// The fixture must have 20 sourced three-core specs and no complete solver model.
const page=browser.page((await browser.pages.list()).find(p=>p.ownership==='mine'&&p.url.includes(':8031/')).pageId);
async function value(fn,arg){return (await page.evaluate(fn,arg)).value;}
async function ready(selector){if(!(await page.waitForSelector(selector,{timeout:20000})).matched)throw Error('Missing '+selector);}
async function click(selector){
 const point=await value(sel=>{const el=document.querySelector(sel);if(!el)throw Error('Missing '+sel);el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);
 for(const type of ['mousePressed','mouseReleased'])await page.cdp('Input.dispatchMouseEvent',JSON.stringify({type,...point,button:'left',clickCount:1}));
}
await page.goto('http://127.0.0.1:8031/design/workbench/');
await ready('.list-row a[href$="/selection/settings"]');
await value(()=>{window.__selectionJourney={started:performance.now(),operations:[]};});
await click('.list-row a[href$="/selection/settings"]');
await ready('[data-selection-field="driver.minimum"]');
await value(()=>window.__selectionJourney.operations.push('从首页打开已保存的问询条件'));
const input=await value(()=>({target:Number(document.querySelector('[data-selection-field="driver.minimum"]').value),candidates:document.querySelectorAll('[data-selection-candidate]').length,selected:document.querySelectorAll('[data-selection-candidate]:checked').length}));
if(input.target!==400||input.candidates!==20||input.selected!==20)throw Error('Real series range differs');
await click('[data-action="amp-workflow-next"]');
await ready('#selection-ack');
await value(()=>window.__selectionJourney.operations.push('预检20个候选'));
await click('#selection-ack');
await value(()=>window.__selectionJourney.operations.push('确认校核范围'));
await click('[data-selection-action="execute"]');
await ready('.selection-conclusion');
await value(()=>window.__selectionJourney.operations.push('保存逐候选拒绝记录'));
const groups=await value(()=>[...document.querySelectorAll('.selection-group')].map(el=>({label:el.querySelector('summary').innerText,open:el.open,rows:el.querySelectorAll('tbody tr').length})));
if(groups[2].open||groups[2].rows!==20)throw Error('Not-applicable group differs');
if(!await value(()=>document.querySelector('.selection-conclusion').innerText.includes('尚无选型结论')))throw Error('Unavailable candidates must not produce a recommendation');
await click('[data-selection-action="report"]');
await ready('iframe');
await value(()=>window.__selectionJourney.operations.push('导出校核记录'));
const receipt=await value(()=>({operations:window.__selectionJourney.operations,elapsed_seconds:(performance.now()-window.__selectionJourney.started)/1000,url:location.href,body:document.body.innerText}));
return {scope:'published candidate refusal record, not an engineering selection report',input,groups,...receipt};
