'use strict';
// Engineering facts and revisions live in the host API, never in localStorage.
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => structuredClone(value);
const groupNumber = value => String(value).replace(/^(-?\d{5,})(?=\.|$)/,part=>part.replace(/\B(?=(\d{3})+(?!\d))/g,' '));
const fmt = (value, digits=2) => Number.isFinite(value) ? groupNumber(Number(value.toFixed(digits)).toString()) : '—';
const roleNames = {conductor:'导体',conductor_screen:'导体屏蔽',insulation:'绝缘',insulation_screen:'绝缘屏蔽',metallic_screen:'金属屏蔽',metallic_sheath:'金属护套',bedding:'垫层',separator:'隔离层',filler:'填充',binder:'包带',armour:'铠装',oversheath:'外护套'};
const forms = {unspecified:'未指定',solid_round:'圆实心',stranded_round:'圆绞合',stranded_round_compacted:'紧压圆绞合',segmental:'分割导体',hollow:'中空',sectoral:'扇形',wires:'金属丝',tape:'带材',smooth:'光滑',corrugated:'波纹'};
const materialColors={conductor:'conductor',semiconductor:'material-semi',insulation:'material-insulation',metal:'material-metal',polymer:'material-sheath',filler:'fill'};
const state={methods:[],presets:[],workspaces:[],studies:[],assets:[],icons:{},wid:null,snapshot:null,record:null,draft:null,selected:2,view:'section',dock:'checks',collapsed:false,overlay:false,zoom:1,pan:{x:0,y:0},tool:'select',snap:true,dirty:false,busy:false,messages:[],runs:[],route:'/',loadToken:0,controllers:[]};
const draftHistory={undo:[],redo:[],group:null};
function rememberDraft(group=null){if(group&&draftHistory.group===group)return;draftHistory.undo.push({document:clone(state.draft),selected:state.selected});if(draftHistory.undo.length>80)draftHistory.undo.shift();draftHistory.redo=[];draftHistory.group=group;}
function resetDraftHistory(){draftHistory.undo=[];draftHistory.redo=[];draftHistory.group=null;}
function refreshDraftView(){renderObjects();renderInspector();renderDock();if(state.view!=='three')renderStage();refreshDirty();}
const icon = key => `<span class="ic icon-glyph" aria-hidden="true">${state.icons[key]||''}</span>`;
const button=(label,key,action,extra='')=>`<button data-action="${action}" ${extra}>${key?icon(key):''}${label}</button>`;
async function api(path,options={}){
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json();
  if(!response.ok){const detail=data.detail;throw new Error(Array.isArray(detail)?detail.map(x=>`${x.loc?.join('.')}：${x.msg}`).join('；'):typeof detail==='object'?detail.message||JSON.stringify(detail):detail||`HTTP ${response.status}`);}
  return data;
}
function log(message){state.messages.unshift({at:new Date().toLocaleTimeString('zh-CN',{hour12:false}),message});state.messages=state.messages.slice(0,80);}
let noticeTimer;
function notify(message){$('#notice').textContent=message;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').hidden=true,4000);}
function fail(error){log(error.message);$('#error').innerHTML=`${esc(error.message)}${button('关闭','','dismiss-error')}`;$('#error').hidden=false;if(state.dock==='messages')renderDock();}
function type(){return state.draft?.cable_types[0];}
function entries(){
  const t=type();if(!t)return [];
  let r=t.cores[0].conductor.diameter/2;
  const rows=[{number:1,role:'conductor',value:t.cores[0].conductor,path:'cable_types.0.cores.0.conductor',inner:0,outer:r}];
  for(const [i,layer]of t.common_layers.entries()){const inner=r;r+=layer.thickness;rows.push({number:i+2,role:layer.role,value:layer,path:`cable_types.0.common_layers.${i}`,inner,outer:r});}
  return rows;
}
function selected(){return entries()[state.selected]||entries()[0];}
function material(row){return state.draft.materials.find(x=>x.id===row.value.material);}
function materialLabel(m){return ({copper:'铜',aluminium:'铝','v0 semiconductor':'半导电材料','v0 insulation':'绝缘材料','v0 screen, construction unspecified':'金属屏蔽（构造未指定）','v0 oversheath':'外护套材料','v0 soil':'土壤'})[m?.label]||m?.label||'未提供';}
function getPath(object,path){return path.split('.').reduce((o,k)=>o?.[k],object);}
function setPath(object,path,value){const parts=path.split('.');const last=parts.pop();parts.reduce((o,k)=>o[k],object)[last]=value;}
function changed(path){return JSON.stringify(getPath(state.draft,path))!==JSON.stringify(getPath(state.record.document,path));}
function stablePointer(path,document=state.draft){const parts=path.split('.');let value=document;return '/'+parts.map(part=>{const next=value[part];const name=Array.isArray(value)?next.id||next.cable||next.role||part:part;value=next;return String(name).replaceAll('~','~0').replaceAll('/','~1');}).join('/');}
function isLocked(path){const stable=stablePointer(path);return (state.record.locks||[]).some(lock=>(lock.targets||[]).some(target=>stable===target||stable.startsWith(target+'/')));}
function source(path){const pointer='/'+path.replaceAll('.','/');const stable=stablePointer(path);return state.draft.provenance[stable]||state.draft.provenance[pointer]||{kind:'demo',reference:'后端预置库 · 演示假设',reviewed:false};}
function sourceText(path){const s=source(path);const kind={demo:'演示输入',user:'用户录入',derived:'几何推导',manufacturer:'厂家资料',standard:'标准来源',measurement:'测量',asset:'库引用'}[s.kind]||s.kind,reference=s.reference?.replace(/\s*·?\s*sha256:[a-f0-9]+/g,'');return `${kind} · ${s.reviewed?'已核对':'未核对'}${reference?' · '+reference:''}`;}
function sourceIcon(path){const s=source(path),key=isLocked(path)?'locked':({user:'from-user',derived:'derived',standard:'from-standard',asset:'from-library'})[s.kind]||'from-document',label=sourceText(path)+(isLocked(path)?' · 锁定':'');return `<span class="cad-source" role="img" tabindex="0" aria-label="${esc(label)}" title="${esc(label)}">${icon('source/'+key)}</span>`;}
function refreshDirty(){state.dirty=JSON.stringify(state.draft)!==JSON.stringify(state.record.document);TypeWorkflow.invalidate();renderHeader();renderStatus();if(state.view!=='quantities')CableModel.schedule();}
function edit(path,value){if(isLocked(path))throw new Error('此字段已锁定。');if(JSON.stringify(getPath(state.draft,path))===JSON.stringify(value))return;rememberDraft(path);setPath(state.draft,path,value);state.draft.provenance[stablePointer(path)]={kind:'user',reference:'结构设计 · 参数录入',reviewed:false};refreshDirty();}
function field(label,path,{scale=1,unit='',readonly=false,nullable=false,options=null}={}){
  const raw=getPath(state.draft,path),locked=isLocked(path),val=raw==null?'':typeof raw==='number'?Number((raw*scale).toFixed(unit==='Ω/km'?6:3)).toString():raw;
  let control;
  if(options)control=`<select aria-label="${label}" data-field="${path}" ${locked||readonly?'disabled':''}>${options.map(([value,text])=>`<option value="${esc(value)}" ${value===(raw??'')?'selected':''}>${esc(text)}</option>`).join('')}</select>`;
  else control=`<span class="input-unit"><input aria-label="${label}" data-field="${path}" data-scale="${scale}" data-nullable="${nullable}" type="${typeof raw==='number'||unit?'number':'text'}" step="any" value="${esc(val)}" ${readonly||locked?'readonly':''} class="${changed(path)?'changed':''}"><span class="unit">${unit}</span></span>`;
  return `<label class="field"><span>${label} ${sourceIcon(path)}${locked?' · 锁':''}</span>${control}</label>`;
}
function readOnly(label,value,unit=''){const path=label==='介电常数'&&state.draft?'materials.'+state.draft.materials.findIndex(m=>m.id===selected().value.material)+'.relative_permittivity':null;return `<label class="field"><span>${label}${path?' '+sourceIcon(path):''}</span><span class="input-unit"><input aria-label="${label}" readonly value="${esc(value)}"><span class="unit">${unit}</span></span></label>`;}
async function hydrate(){
  const keys=['nav/home','nav/cable-type','nav/study','nav/library','nav/plugin','nav/settings','module/structure','module/standard-check','module/electrical','module/rating-table','module/short-circuit','module/sweep','module/method-compare','module/datasheet','module/add-module','object/cable','object/section','object/conditions','calc/ampacity','calc/thermal-field','calc/electric-field','calc/magnetic-field','action/add','action/save','action/undo','action/redo','action/close','action/refresh','action/copy','action/delete','action/duplicate','action/export','action/history','action/chevron-down','agent/agent','source/from-document','source/from-user','source/derived','source/locked','tool/select','tool/pan','tool/zoom-in','tool/zoom-out','tool/fit','tool/snap','result/table','result/snapshot'];
  keys.push('run/run','result/report','source/from-library','source/from-standard','tool/align');
  await Promise.all(keys.map(async key=>{const r=await fetch('../icons/'+key+'.svg');if(r.ok)state.icons[key]=await r.text();}));
}
function renderNav(){
  const section=state.route.split('/')[1]||'home';
  $('#global-nav').innerHTML=`<a class="brand" href="#/" title="CableSimPro"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="16" r="4" fill="var(--conductor)"/></svg></a><div class="nav-links" data-selection-mode="navigation">${[['home','首页','/'],['cable-type','型号','/types'],['study','研究','/studies'],['library','库','/library'],['plugin','插件','/plugins']].map(([key,title,path])=>`<a class="nav-link icon-choice ${section===(path.split('/')[1]||'home')?'current':''}" href="#${path}" data-icon-key="nav/${key}" aria-label="${title}" ${section===(path.split('/')[1]||'home')?'aria-current="page"':''}>${icon('nav/'+key)}<span>${title}</span></a>`).join('')}</div><a class="nav-link ${section==='settings'?'current':''}" href="#/settings">${icon('nav/settings')}<span>设置</span></a>`;
}
function renderHeader(){
  const open=!!state.draft&&state.route.startsWith('/types/');
  $('#header').innerHTML=open?`<span class="pill">型号</span><div class="title-wrap"><h1>${esc(type().label)}</h1></div><span class="subtle type-subtitle">新版本草稿</span><span class="spacer"></span><span class="save-state ${state.dirty?'dirty':''}">${state.dirty?'未保存':'已保存'} · r${state.record.revision}</span>${button('','action/undo','undo',`class="icon-button" aria-label="撤销" title="撤销 Ctrl+Z" ${(!draftHistory.undo.length&&(!state.snapshot.can_undo||state.dirty))||state.busy?'disabled':''}`)}${button('','action/redo','redo',`class="icon-button" aria-label="重做" title="重做 Ctrl+Shift+Z" ${(!draftHistory.redo.length&&(!state.snapshot.can_redo||state.dirty))||state.busy?'disabled':''}`)}${button('运行记录','action/history','run-history')}${button('Agent','agent/agent','agent','class="agent"')}${button('保存','action/save','save',`class="primary" ${!state.dirty||state.busy?'disabled':''}`)}`:`<h1>${({'/':'首页','/types':'型号','/studies':'研究','/library':'库','/plugins':'插件','/settings':'设置'})[state.route]||'工作区'}</h1><span class="spacer"></span><span class="subtle">本机 · 原型数据区</span>${button('快捷键','','shortcuts','class="quiet"')}`;
  if(open){$('.save-state').textContent=state.dirty?'未保存':'已保存';const origin=state.snapshot?.type_origin_reference;if(origin)$('.type-subtitle').textContent='基于 '+origin.version+' · 新版本草稿';$('#header').insertAdjacentHTML('beforeend',`<a class="study-header-link" href="#/types/${state.wid}/specification/content">${icon('result/report')}交付</a>`);}
}
function renderStatus(){
  const r=selected();
  $('#status').innerHTML=state.draft&&state.route.startsWith('/types/')?`<span class="coordinate" id="coordinates">${r?'选中 '+esc(roleNames[r.role]||r.role):'选择结构层'}</span><span>${state.view==='three'?CableModel.status():'缩放 '+Math.round(state.zoom*100)+'% · mm'}</span><span class="spacer"></span><span class="source-status">演示输入 · 未发布${state.view==='three'?' · CAD 显示预览':' · 无计算结果'}</span><span>领域 ${esc(state.draft.schema_version.split('/')[1])} · r${state.record.revision}</span>`:`<span>已连接本机 API</span><span>${state.methods.length} 个插件 · ${state.methods.reduce((n,m)=>n+m.capabilities.length,0)} 项能力</span><span class="spacer"></span><span>结构设计 · 首模块审阅</span>`;
  if(state.draft&&state.route.startsWith('/types/')){if(state.view==='quantities')$('.source-status').textContent='演示输入 · 未发布 · '+TypeWorkflow.resultStatus();$('#status').lastElementChild.textContent='产品标准 · 尚未核对';}
}
function renderWorkspace(){
  CableModel.dispose();
  state.controllers.forEach(c=>c.destroy());state.controllers=[];renderNav();renderHeader();
  if(Ampacity.handles(state.route))Ampacity.render();else {if(state.draft&&state.route.startsWith('/types/')){TypeWorkflow.bindRuns();if(TypeWorkflow.handles())TypeWorkflow.renderModule();else renderStructure();}else renderPage();renderStatus();}
  const current=$('.nav-links [aria-current=page]');current?.setAttribute('aria-pressed','true');
  if(window.CableIconSelection)state.controllers.push(CableIconSelection.mount($('.nav-links'),{reduced:()=>matchMedia('(prefers-reduced-motion: reduce)').matches||localStorage.getItem('csp-reduced')==='true',onChange:key=>{const link=$(`.nav-links [data-icon-key="${key}"]`);if(link)location.hash=link.hash;}}));
}
function renderStructure(){
  const t=type();
  if(t.construction!=='single_core'||t.cores.length!==1||t.cores[0].layers.length){$('#workspace').innerHTML='<p class="empty">此轮结构视图支持单芯电缆与公共结构层；此领域文档包含其他结构，暂不开放编辑。</p>';return;}
  $('#workspace').innerHTML=`<div class="work-area type-work-area ${state.view==='quantities'?'type-quantities-view':''}"><nav class="module-rail" aria-label="型号模块">${TypeWorkflow.rail()}</nav><section class="center ${state.collapsed?'collapsed':''}"><div class="viewbar"><h2>结构设计</h2>${TypeWorkflow.tabs()}<span class="spacer"></span>${state.view==='three'?CableModel.toolbar():state.view==='section'?`<label class="overlay-toggle"><input type="checkbox" id="overlay" ${state.overlay?'checked':''}>数值叠加</label>`:''}</div><div class="stage" id="stage"></div><section class="dock" aria-label="校核与消息"><div class="dock-tabs" role="group" aria-label="底部面板">${['checks','messages'].map((k,i)=>`<button data-action="dock-${k}" aria-pressed="${state.dock===k}">${['校核项','消息'][i]}${k==='messages'?' '+state.messages.length:''}</button>`).join('')}<span class="spacer"></span>${button('','action/chevron-down','collapse',`class="icon-button" aria-label="${state.collapsed?'展开':'收起'}底部面板" aria-expanded="${!state.collapsed}"`)}</div><div class="dock-body" id="dock-body"></div></section></section><aside class="inspector" id="inspector" aria-label="对象属性"></aside></div>`;
  renderObjects();renderStage();renderInspector();renderDock();if(state.view!=='quantities')CableModel.schedule();
}
function renderObjects(){$('#objects').innerHTML=entries().map((r,i)=>`<button class="object-row ${i===state.selected?'selected':''}" data-select="${i}" aria-pressed="${i===state.selected}"><span class="layer-index">${r.number}</span><span class="name">${esc(roleNames[r.role]||r.role)}</span></button>`).join('');}
function renderStage(){
  if(state.view==='quantities'){CableModel.dispose();TypeWorkflow.renderDerived();return;}
  if(state.view==='three'){CableModel.render();return;}CableModel.dispose();
  if(state.view==='table'){renderGrid();return;}
  const rows=entries(),outer=rows.at(-1).outer,scale=170/outer,cx=280,cy=245;
  const shapes=rows.slice().reverse().map(r=>`<circle class="layer ${r.number-1===state.selected?'selected':''}" data-select="${r.number-1}" cx="${cx}" cy="${cy}" r="${r.outer*scale}" fill="var(--${materialColors[material(r)?.category]||'fill'})"/>`).join('');
  const leaders=rows.map((r,i)=>{const a=(-75+i*30)*Math.PI/180,middle=(r.inner+r.outer)/2*scale,x=cx+Math.cos(a)*middle,y=cy+Math.sin(a)*middle,lx=cx+Math.cos(a)*(188+i%2*16),ly=cy+Math.sin(a)*(188+i%2*16);return `<g class="hit" data-select="${i}"><path class="leader" d="M${x} ${y}L${lx} ${ly}"/><circle class="number-disc ${i===state.selected?'chosen':''}" cx="${lx}" cy="${ly}" r="11"/><text x="${lx}" y="${ly+4}" text-anchor="middle">${r.number}</text></g>`;}).join('');
  const current=rows[state.selected],r=current?.outer*scale+6;
  $('#stage').innerHTML=`<div class="canvas-title"><strong>单芯电缆 · 径向截面</strong><small>真实比例 · 结构尺寸单位 mm</small></div><svg class="drawing" viewBox="0 0 750 520" aria-label="电缆结构截面" role="img"><g id="geometry" transform="translate(${state.pan.x} ${state.pan.y}) translate(${cx} ${cy}) scale(${state.zoom}) translate(${-cx} ${-cy})">${shapes}${r?`<rect class="selection-frame" x="${cx-r}" y="${cy-r}" width="${r*2}" height="${r*2}" rx="4"/>`:''}${leaders}<path class="dimension" d="M110 445v16m340-16v16M110 453h340m-340-3v6m340-6v6"/>${state.overlay?`<text x="280" y="478" text-anchor="middle">Ø ${fmt(outer*2000,3)}</text>`:''}<path id="snap-guide" class="guide" d="M280 32v425M70 245h420" hidden/></g></svg><div class="canvas-legend"><h3 style="margin:0 8px 12px">结构层</h3>${rows.map((r,i)=>`<button class="legend-row ${i===state.selected?'selected':''}" data-select="${i}" aria-pressed="${i===state.selected}"><span class="legend-badge">${r.number}</span>${esc(roleNames[r.role]||r.role)}</button>`).join('')}</div><div class="mini-map" aria-label="视图定位"><svg viewBox="0 0 90 66"><circle cx="45" cy="33" r="20"/><rect x="${45-32/state.zoom-state.pan.x/12}" y="${33-23/state.zoom-state.pan.y/12}" width="${64/state.zoom}" height="${46/state.zoom}" rx="2"/></svg></div><div class="tool-float" role="toolbar" aria-label="绘图工具">${button('','tool/select','tool-select',`aria-label="选择 V" aria-pressed="${state.tool==='select'}" title="选择 V"`)}${button('','tool/pan','tool-pan',`aria-label="平移 H" aria-pressed="${state.tool==='pan'}" title="平移 H"`)}<span class="divider"></span>${button('','tool/snap','snap',`aria-label="中心捕捉 S" aria-pressed="${state.snap}" title="中心捕捉 S"`)}${button('','tool/zoom-out','zoom-out','aria-label="缩小 -"')}<span class="zoom-label">${Math.round(state.zoom*100)}%</span>${button('','tool/zoom-in','zoom-in','aria-label="放大 +"')}${button('','tool/fit','fit','aria-label="适应窗口 F" title="适应窗口 F"')}</div>`;
  bindCanvas();syncDiagramFont();
}
function syncDiagramFont(){const svg=$('.drawing');if(svg?.getScreenCTM())svg.style.setProperty('--diagram-font',`${13/svg.getScreenCTM().a/state.zoom}px`);}
function renderGrid(){
  const rows=entries();
  $('#stage').innerHTML=`<div class="data-grid-wrap"><p class="grid-hint">点击单元格编辑；Enter 提交，Tab 下一格。可从 Excel 粘贴多行多列。所有长度单位为 mm。</p><table class="data-grid" aria-label="结构参数表"><thead><tr><th>编号 / 层</th><th>材料</th><th>径向尺寸¹</th><th>本层外径 / mm</th><th>用料 / kg/km</th><th>来源</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${i===state.selected?'selected':''}" data-select="${i}"><td>${r.number} · ${esc(roleNames[r.role]||r.role)}</td><td><select data-grid-row="${i}" data-grid-col="0" aria-label="${roleNames[r.role]}材料">${state.draft.materials.map(m=>`<option value="${esc(m.id)}" ${m.id===r.value.material?'selected':''}>${esc(materialLabel(m))}</option>`).join('')}</select></td><td><input type="number" step="any" data-grid-row="${i}" data-grid-col="1" aria-label="${roleNames[r.role]}${i?'厚度':'直径'}" value="${fmt((i?r.value.thickness:r.value.diameter)*1000,3)}"></td><td class="number" data-cad-od="${i}">${CableModel.derived(i)?fmt(CableModel.derived(i).outer_radius_m*2000,1):'未生成'}</td><td class="number" data-cad-mass="${i}">${CableModel.massText(CableModel.derived(i)?.mass_kg_per_km,false)}</td><td>${sourceIcon(r.path+(i?'.thickness':'.diameter'))}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="4">电缆用料合计 / kg/km</th><td class="number" data-cad-total>${CableModel.massText(CableModel.model()?.mass_kg_per_km,false)}</td><td></td></tr></tfoot></table><p class="grid-hint" style="margin-top:16px">¹ 导体行为直径，其他结构层为厚度。修改提交到草稿，保存时由领域接口整体校验。</p>${button('粘贴数据','result/table','paste-dialog')}${button('复制结构表','action/copy','copy-grid','style="margin-left:8px"')}</div>`;
  $('.data-grid-wrap').insertAdjacentHTML('beforeend',`<div class="row" style="margin-top:12px">${button('添加结构层','action/add','add-layer')}${button('删除选中层','action/delete','delete-layer',state.selected===0?'disabled':'')}</div>`);
}
function renderInspector(){
  const r=selected();if(!r)return;const m=material(r),conductor=r.role==='conductor';
  const extra=(conductor&&['stranded_round','stranded_round_compacted'].includes(r.value.form))||r.value.form==='wires'?field('根数',r.path+'.wire_count',{unit:'根',nullable:true})+field('单丝直径',r.path+'.wire_diameter',{scale:1000,unit:'mm',nullable:true})+field('绞合节距',r.path+'.lay_length',{scale:1000,unit:'mm',nullable:true})+field('绞向',r.path+'.lay_direction',{options:[['','未提供'],['right','右绞'],['left','左绞']]}):r.value.form==='tape'?field('带宽',r.path+'.tape_width',{scale:1000,unit:'mm',nullable:true})+field('绕包节距',r.path+'.lay_length',{scale:1000,unit:'mm',nullable:true})+field('绕向',r.path+'.lay_direction',{options:[['','未提供'],['right','右绕'],['left','左绕']]}):'';
  const editable=`${conductor?field('导体直径',r.path+'.diameter',{scale:1000,unit:'mm'})+field('标称截面积',r.path+'.nominal_area',{scale:1e6,unit:'mm²'}):field('标称厚度',r.path+'.thickness',{scale:1000,unit:'mm'})}${field('构造',r.path+'.form',{options:conductor?Object.entries(forms).slice(0,7):[['','未指定'],...Object.entries(forms).filter(([k])=>['wires','tape','smooth','corrugated'].includes(k))]})}${extra}${conductor&&['stranded_round_compacted','segmental'].includes(r.value.form)?field('绞入系数',r.path+'.lay_factor',{unit:'倍',nullable:true}):''}`;
  $('#inspector').innerHTML=`<div class="inspector-head"><h2>${esc(roleNames[r.role]||r.role)} · 第 ${r.number} 层</h2><small>${esc(materialLabel(m))}</small>${state.view==='three'?CableModel.measurementSummary():''}</div><div class="inspector-section"><h3>结构参数 ${sourceIcon(r.path+(conductor?'.diameter':'.thickness'))}</h3>${editable}${conductor?field('R₂₀',r.path+'.r20',{scale:1000,unit:'Ω/km',nullable:true}):readOnly('制造公差','未接入')}</div><div class="inspector-section"><h3>材料 ${m?sourceIcon('materials.'+state.draft.materials.findIndex(x=>x.id===m.id)+'.density'):''}</h3>${field('材料',r.path+'.material',{options:state.draft.materials.map(m=>[m.id,materialLabel(m)])})}${m?field('材料密度','materials.'+state.draft.materials.findIndex(x=>x.id===m.id)+'.density',{unit:'kg/m³',nullable:true}):''}${readOnly('热阻率',fmt(m?.thermal_resistivity,3),'K·m/W')}${readOnly('介电常数',fmt(m?.relative_permittivity,3))}</div><div class="inspector-section"><h3>结构推导</h3><div id="cad-properties">${CableModel.metrics()}</div></div><div class="inspector-section"><h3>标准依据</h3><p class="subtle">参数旁图标提供本字段出处；产品标准的自动判定尚未接入。</p></div><div class="inspector-section"><details><summary>查看其余领域字段</summary><dl>${Object.entries(r.value).filter(([k])=>!['material','thickness','diameter','nominal_area','form','r20'].includes(k)).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v==null?'未提供':esc(v)}</dd>`).join('')||'<dt>无其他字段</dt>'}</dl></details></div><div class="inspector-foot">输入修订 r${state.record.revision}<br>原型数据区 · 未发布</div>`;
}
function renderDock(){
  const el=$('#dock-body');if(!el)return;
  if(state.dock==='messages'){el.innerHTML=state.messages.length?state.messages.map(x=>`<div class="message-row"><time>${x.at}</time><span>${esc(x.message)}</span></div>`).join(''):'<p class="empty">暂无消息。</p>';return;}

  if(state.view==='quantities'){el.innerHTML=TypeWorkflow.checks();return;}
  const cad= CableModel.derived(state.selected);
  el.innerHTML=`<table class="checks"><thead><tr><th>校核项 / 来源</th><th>要求</th><th>当前</th><th>裕度</th><th>状态</th></tr></thead><tbody><tr><td>领域文档有效性<small> · 服务端校验</small></td><td>字段与几何一致</td><td>r${state.record.revision}${state.dirty?' + 草稿':''}</td><td>—</td><td class="state"><i class="check-mark ${state.dirty?'':'valid'}"></i>${state.dirty?'待保存校验':'已保存校验'}</td></tr><tr><td>成品外径 · CAD 推导</td><td>未关联限值要求</td><td>${CableModel.model()?fmt(CableModel.model().outer_diameter_m*1000,1)+' mm':'未生成'}</td><td>—</td><td class="state"><i class="check-mark"></i>未判定</td></tr><tr><td>当前层用料 · CAD 几何</td><td>参数化构造与材料密度</td><td>${CableModel.massText(cad?.mass_kg_per_km)}</td><td>—</td><td>显示预览</td></tr><tr><td>结构标准符合性</td><td>待核对原文与条款</td><td>—</td><td>—</td><td class="state"><i class="check-mark"></i>未接入</td></tr></tbody></table>`;
}
function listWorkspaces(){
  const list=(state.typeWorkspaces||state.workspaces).slice().sort((a,b)=>(Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0)),legacy=list.filter(w=>/合成演示|CAD 合成|^test|新研究\s*\d|^Cu\s+\d+(?:\.\d+)?\s*mm[²2]\s*·\s*直埋方案$/i.test(w.name)),groups=new Map();
  for(const w of list){if(legacy.includes(w))continue;const key=w.name.replace(/\s*·\s*型号草稿$/,'').replace(/（(?:典型结构|结构)演示）/g,'').normalize('NFKC').replace(/[\s·]/g,'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(w);}
  const rows=(values,older=false)=>values.map(w=>`<div class="list-row">${icon('nav/cable-type')}<div class="row-title"><strong>${esc(w.name)}</strong><small>${w.origin_version?'基于型号版本 '+esc(w.origin_version)+' · ':''}${older?'旧草稿':'新版本草稿'} · r${esc(w.revision)} · 未发布</small></div><a href="#/types/${w.id}/structure/table">${older?'打开旧草稿':'打开型号'} →</a></div>`).join('');
  const items=[...groups.values()].slice(0,6).map(([latest,...older])=>`<div class="type-list-group">${rows([latest])}${older.length?`<details class="type-draft-history"><summary>版本历史 · ${older.length} 个旧草稿</summary>${rows(older,true)}</details>`:''}</div>`).join('');
  return (items||'<p class="empty">还没有型号草稿。选择明确的型号版本，复制为独立草稿。</p>')+(legacy.length?`<details class="early-records"><summary>早期演示输入 · ${legacy.length} 项</summary>${rows(legacy)}</details>`:'');
}
function recentStudies(){
  const items=state.studies.filter(s=>!state.methods.find(m=>m.method.plugin_id===s.definition.method.plugin_id)?.capabilities.find(c=>c.id===s.definition.method.capability&&c.analysis==='geometry')).sort((a,b)=>new Date(b.created)-new Date(a.created)),legacy=items.filter(s=>/合成演示|^test|新研究\s*\d/i.test(s.definition.title)||/^Cu \/ XLPE \/ 光滑铝护套/.test(s.workspace_name));
  const demoModes=new Set();for(const s of items){if(legacy.includes(s)||!/^YJ.*（(?:典型结构|结构)演示）.*直埋研究（演示）$/.test(s.workspace_name))continue;const mode=s.definition.driver.kind==='sweep'?'sweep':s.definition.driver.kind==='crosscheck'?'compare':s.definition.task||'rating';if(demoModes.has(mode))legacy.push(s);else demoModes.add(mode);}
  const rows=values=>values.map(s=>{const mode=s.definition.driver.kind==='sweep'?'sweep':s.definition.driver.kind==='crosscheck'?'compare':s.definition.task||'rating',page=mode==='sweep'?'sweep/curve':mode==='compare'?'method-compare/inputs':'ampacity';return `<div class="list-row">${icon('nav/study')}<div class="row-title"><strong>${esc(s.definition.title)}</strong><small>${esc(StudyShell.workflowNames[mode])} · ${esc(StudyShell.formatTime(s))} · ${esc(s.workspace_name)}</small></div><a href="#/studies/${s.id}/${page}">打开研究 →</a></div>`;}).join('');
  return (rows(items.filter(s=>!legacy.includes(s)).slice(0,6))||'<p class="empty">还没有工程问题研究。从“新建研究”选择任务和型号版本开始。</p>')+(legacy.length?`<details class="early-records"><summary>早期演示研究 · ${legacy.length} 项</summary>${rows(legacy)}</details>`:'');
}
function renderPage(){
  const path=state.route;let html;
  if(path==='/'){html=`<h2>开始工作</h2><p class="subtle">型号定义产品；研究回答它在指定条件下的工程问题。</p><div class="choices"><div class="choice">${icon('nav/cable-type')}<div><h2>型号</h2><p>结构、材料与产品规格</p></div>${button('新建','action/add','new-type')}</div><div class="choice">${icon('nav/study')}<div><h2>研究</h2><p>温度、允许电流与参数敏感性</p></div>${button('新建研究','action/add','amp-new')}<a href="#/studies">研究列表 →</a></div></div><h2>最近的研究</h2>${recentStudies()}<h2>最近的型号</h2>${listWorkspaces()}`;}
  else if(path==='/types'){html=`<div class="list-head"><h2>型号草稿</h2>${button('从预置库新建','action/add','new-type','class="primary"')}</div><p class="subtle">当前使用领域文档保存结构；型号审核与发布尚未接入。</p>${listWorkspaces()}`;}
  else if(path==='/studies'){html=`<h2>研究</h2><p class="subtle">本轮先确认结构设计。研究模块的参数编辑与运行界面将在确认后制作。</p><a href="#/plugins">查看实际可用方法 →</a><div class="empty">此原型数据区尚未建立保存研究。</div>`;}
  else if(path==='/plugins'){html=`<div class="list-head"><h2>已安装插件</h2>${button('刷新','action/refresh','refresh-methods')}</div><p class="subtle">直接读取本机 /api/methods。平台可用不等于输入已齐备或工程适用。</p>${state.methods.map(m=>`<div class="capability">${icon('nav/plugin')}<div><h3>${esc(m.name)} <small>${esc(m.method.version)}</small></h3><p>${esc(m.description)}</p>${m.capabilities.map(c=>`<details style="margin-top:12px"><summary>${esc(c.title)}</summary><p>输入模式：<code>${esc(c.input_schema)}</code></p><p>${esc(c.limitations.join('；'))}</p><p>验证等级：${esc(c.validation.level)}</p></details>`).join('')}<p><code>${esc(m.method.plugin_id)}</code></p></div><span class="pill">${m.platform_supported?'本机平台支持':'平台不支持'}</span></div>`).join('')}`;}
  else if(path==='/library'){html=`<h2>本地工程资源</h2><p class="subtle">读取统一工程资源接口 /api/foundation/assets。</p>${state.assets.length?state.assets.map(a=>`<div class="list-row"><pre>${esc(JSON.stringify(a,null,2))}</pre></div>`).join(''):'<p class="empty">资源库为空，尚无已发布型号或材料可引用。</p>'}<h2>后端演示预置库</h2><p class="subtle">以下输入未获厂家认证；新建时显式选择，不作为标准限值。</p>${state.presets.map(p=>`<div class="list-row">${icon('object/cable')}<div class="row-title"><strong>${esc(p.label)}</strong><small>${esc(p.source)}</small></div>${button('用作初始输入','','preset-'+p.id)}</div>`).join('')}`;}
  else if(path==='/settings'){html=`<h2>界面设置</h2><div class="settings-row"><div><h3>主题</h3><p class="subtle">型号与研究使用同一套视觉规则</p></div>${button(document.documentElement.dataset.theme==='dark'?'切换浅色':'切换深色','','theme')}</div><div class="settings-row"><div><h3>减少动态效果</h3><p class="subtle">同时遵守系统的减少动态效果设置</p></div><input aria-label="减少动态效果" type="checkbox" id="reduce" ${localStorage.getItem('csp-reduced')==='true'?'checked':''}></div><div class="settings-row"><h3>编辑快捷键</h3>${button('查看','','shortcuts')}</div>`;}
  else html='<p class="empty">页面不存在。</p>';
  $('#workspace').innerHTML=`<div class="page">${html}</div>`;
}
function openDialog(title,body,actions=''){const d=$('#modal');d.className='';d.innerHTML=`<div class="dialog-head"><h2 id="modal-title">${title}</h2><span class="spacer"></span>${button('','action/close','close','class="icon-button" aria-label="关闭"')}</div><div class="dialog-body">${body}</div>${actions?`<div class="dialog-actions">${actions}</div>`:''}`;if(!d.open)d.showModal();}
function showRunHistory(){
  const labels={succeeded:'已完成',partial:'部分完成',failed:'失败',running:'运行中',queued:'排队中',cancelled:'已取消'};
  const rows=state.runs.map(r=>`<tr><td>${r.snapshot?.definition?.method?.plugin_id==='cablesim.cable-geometry'?button(esc(r.id.slice(0,8)),'','model-run:'+r.study_id+':'+r.id):`<a href="#/studies/${encodeURIComponent(r.study_id)}/ampacity/runs/${encodeURIComponent(r.id)}" data-action="close" class="run-link">${esc(r.id.slice(0,8))}</a>`}</td><td>${esc(labels[r.status]||r.status)}</td><td class="number">r${esc(r.snapshot?.workspace_revision??'—')}</td></tr>`).join('');
  openDialog('运行记录',`<p class="subtle">当前型号关联研究的已保存运行。输入变化后，历史结果仍保留原始快照。</p>${rows?`<div class="history-table"><table><thead><tr><th>运行</th><th>状态</th><th>输入修订</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty"><h3>尚无运行记录</h3><p>先在研究中保存输入并运行计算，记录将在这里显示。</p><a href="#/studies" data-action="close">查看研究</a></div>'}`);
  $('#modal').classList.add('history-drawer');
}
function moduleCatalog(){
  const definitions=[
    ['source/from-standard','要求与标准','来源、条款 / 页码、批准记录与校核绑定。','要求对象与批准接口待接入。',[]],
    ['module/standard-check','标准核对','按全部适用要求查看实际值、余量与判定。','产品标准核对插件待接入。',[]],
    ['module/electrical','电气参数','查看交流电阻、电容、电感与损耗。','页面按方法实际支持的参数接入。',['network-properties']],
    ['module/rating-table','载流量表','按敷设工况比较允许电流。','型号工况表与研究关联待接入。',['steady-rating']],
    ['module/short-circuit','短路容量','查看导体与屏蔽的短路允许电流。','短路计算插件待接入。',[]],
    ['module/method-compare','方案对比','比较修改项及全部要求，采纳为新版本草稿。','多方案持久化与要求关联待接入。',[]],
    ['module/datasheet','规格书 / 校核报告','交付指定方案或版本及其校核证据。','型号交付模板与版本引用待接入。',[]]
  ];
  openDialog('型号模块',`<p class="subtle">结构设计已启用。以下模块按统一模板接入；已安装计算方法不代表对应页面已可用。</p><div class="module-list">${definitions.map(([key,label,purpose,dependency,ids])=>{
    const matches=state.methods.flatMap(m=>m.capabilities.filter(c=>ids.includes(c.id)).map(c=>({m,c})));
    return `<div class="capability">${icon(key)}<div><h3>${label}</h3><p>${purpose}</p><p class="subtle">${dependency}</p>${matches.length?`<small>已发现方法：${matches.map(({c})=>esc(c.title)).join('、')}</small>`:''}</div><span class="pill">未接入</span></div>`;
  }).join('')}</div>`);
  const groups=[['稳态载流量','steady_state'],['电气与热网络参数','properties'],['截面场','field'],['方法校核','crosscheck']];
  $('.dialog-body').insertAdjacentHTML('beforeend',`<h3 style="margin-top:24px">宿主发现的全部方法能力</h3>${groups.map(([label,analysis])=>{const found=state.methods.flatMap(m=>m.capabilities.filter(c=>c.analysis===analysis).map(c=>({m,c})));return `<details style="margin-top:12px"><summary>${label} · ${found.length} 项</summary>${found.map(({m,c})=>`<div class="capability"><div><h3>${esc(c.title)}</h3><p>${esc(m.name)} ${esc(m.method.version)} · ${m.platform_supported?'本机平台支持':'平台不支持'}</p><p>输入模式 <code>${esc(c.input_schema)}</code></p><p>${esc(c.limitations.join('；'))}</p></div><span class="subtle">未接入</span></div>`).join('')}</details>`;}).join('')}`);
}
async function refreshLists(){const [list,assets,types]=await Promise.all([api('/workspaces'),api('/foundation/assets'),api('/design/type-workspaces')]);state.workspaces=list;state.typeWorkspaces=types;state.assets=assets.items;state.studies=(await Promise.all(list.map(async w=>(await api(`/workspaces/${w.id}/studies`)).map(s=>({...s,workspace_name:w.name}))))).flat();}
async function loadWorkspace(wid){
  const token=++state.loadToken;
  const [record,snapshot,studies]=await Promise.all([api(`/workspaces/${wid}/domain`),api(`/workspaces/${wid}`),api(`/workspaces/${wid}/studies`)]);
  if(token!==state.loadToken)return false;if(!record.document)throw new Error('此工作区尚未转换为领域文档。');
  state.wid=wid;state.record=record;state.snapshot=snapshot;state.draft=clone(record.document);state.dirty=false;resetDraftHistory();state.selected=Math.min(state.selected,entries().length-1);
  state.runs=(await Promise.all(studies.map(async s=>{const runs=[];let cursor=0;do{const page=await api(`/workspaces/${wid}/studies/${s.id}/runs?after=${cursor}`);runs.push(...page.items.map(r=>({...r,study_id:s.id})));cursor=page.next_cursor;}while(cursor!==null);return runs;}))).flat();return true;
}
async function route(){
  const navigation=state.navigation=(state.navigation||0)+1;
  const next=location.hash.slice(1)||'/';
  if((state.busy||Ampacity.isBusy())&&next!==state.route){history.replaceState(null,'','#'+state.route);notify('当前操作尚未完成，请稍后切换工作区。');return;}
  const typeId=path=>path.match(/^\/types\/([^/?]+)/)?.[1];
  if((state.dirty||Ampacity.dirty())&&next!==state.route&&!Ampacity.sameStudyRoute(next,state.route)&&!(typeId(next)&&typeId(next)===typeId(state.route))){history.replaceState(null,'','#'+state.route);notify('当前有未保存草稿；请先保存，或在 Esc 菜单中放弃草稿。');return;}
  state.route=next.startsWith('/p/')?'/':next;
  if(Ampacity.handles(state.route)){$('#workspace').inert=true;$('#header').inert=true;try{await Ampacity.route(state.route);if(navigation===state.navigation)renderWorkspace();}finally{if(navigation===state.navigation){$('#workspace').inert=false;$('#header').inert=false;}}return;}
  Ampacity.dispose();$('#workspace').inert=false;$('#header').inert=false;
  const match=state.route.split('?')[0].match(/^\/types\/([^/]+)\/(structure|standard-check|specification)(?:\/([^/]+))?$/);
  if(match&&match[1]!==state.wid){$('#workspace').innerHTML='<p class="empty">正在读取领域文档…</p>';if(!await loadWorkspace(match[1]))return;}
  if(match&&match[2]==='structure'){const view=match[3]||new URLSearchParams(state.route.split('?')[1]||'').get('view');if(['section','three','table','quantities'].includes(view))state.view=view;}
  if(match&&match[2]==='specification'){await TypeWorkflow.restoreDelivery();if(navigation!==state.navigation)return;}
  renderWorkspace();
}
async function createFromPreset(id){
  if(state.busy)return;const preset=state.presets.find(p=>p.id===id);if(!preset)return;state.busy=true;
  try{const created=await api('/workspaces',{method:'POST',body:JSON.stringify({scenario:preset.scenario})});await api(`/workspaces/${created.id}/domain/conversion`,{method:'POST',body:JSON.stringify({expected_revision:created.revision})});await refreshLists();$('#modal').close();log(`从预置库 ${preset.id} 创建新版本草稿。来源：${preset.source}。`);state.wid=null;location.hash=`/types/${created.id}/structure`;}finally{state.busy=false;}
}
async function save(){
  if(!state.dirty||state.busy)return;if($('[aria-invalid=true]'))throw new Error('请先修正标记为无效的输入。');state.busy=true;$('#workspace').inert=true;renderHeader();
  try{const r=await api(`/workspaces/${state.wid}/domain`,{method:'PUT',body:JSON.stringify({expected_revision:state.record.revision,document:state.draft})});state.record=r;state.draft=clone(r.document);state.dirty=false;state.snapshot=await api(`/workspaces/${state.wid}`);await refreshLists();log(`已保存领域修订 r${r.revision}，服务端整体校验通过。`);notify('已保存修订 r'+r.revision);resetDraftHistory();if($('#modal').open)$('#modal').close();if(state.route.includes('/structure'))refreshDraftView();else renderWorkspace();}finally{state.busy=false;$('#workspace').inert=false;renderHeader();}
}
async function applyWorkspaceHistory(direction){
  if(!state.wid||state.busy||!state.route.startsWith('/types/'))return;
  const from=draftHistory[direction],to=draftHistory[direction==='undo'?'redo':'undo'];if(from.length){to.push({document:clone(state.draft),selected:state.selected});const previous=from.pop();state.draft=previous.document;state.selected=Math.min(previous.selected,entries().length-1);draftHistory.group=null;refreshDraftView();CableModel.select(state.selected);return;}
  if(state.dirty)return;state.busy=true;$('#workspace').inert=true;
  try{await api(`/workspaces/${state.wid}/history/${direction}`,{method:'POST',body:JSON.stringify({expected_revision:state.record.revision})});await loadWorkspace(state.wid);log(`${direction==='undo'?'撤销':'重做'}已保存修订；当前为 r${state.record.revision}。`);if(state.route.includes('/structure'))refreshDraftView();else renderWorkspace();}finally{state.busy=false;$('#workspace').inert=false;renderHeader();}
}
function validateInput(value,number,nullable){if(number){if(value===''&&nullable)return null;if(value===''||!Number.isFinite(Number(value))||Number(value)<=0)throw new Error('尺寸和材料数值必须为正数。');return Number(value);}return value;}
function gridEdit(row,col,raw,target=state.draft){
  const r=entries()[row];if(!r)throw new Error('粘贴行数超过现有结构层。');const path=r.path+(col===0?'.material':row===0?'.diameter':'.thickness');if(isLocked(path))throw new Error('粘贴区域包含锁定字段。');
  let value;if(col===0){const mat=state.draft.materials.find(m=>m.id===raw||m.label===raw||materialLabel(m)===raw);if(!mat)throw new Error('未知材料：'+raw);value=mat.id;}else if(col===1)value=validateInput(raw,true,false)/1000;else throw new Error('只可批量粘贴材料与径向尺寸两列。');
  setPath(target,path,value);target.provenance[stablePointer(path)]={kind:'user',reference:'结构参数表 · 批量录入',reviewed:false};
}
function pasteGrid(text,startRow=state.selected,startCol=1){
  if(!text.trim())return;const lines=text.trim().split(/\r?\n/).map(line=>line.split('\t')),draft=clone(state.draft);
  for(let r=0;r<lines.length;r++)for(let c=0;c<lines[r].length;c++)gridEdit(startRow+r,startCol+c,lines[r][c].trim(),draft);
  rememberDraft();state.draft=draft;refreshDraftView();log(`粘贴 ${lines.length} 行到结构参数草稿；等待保存校验。`);notify(`已粘贴 ${lines.length} 行，尚未保存`);
}
async function copyGrid(){const text=['编号\t结构层\t材料\t径向尺寸(mm)\t本层外径(mm)\t用料(kg/km)',...entries().map((r,i)=>`${r.number}\t${roleNames[r.role]}\t${materialLabel(material(r))}\t${fmt((i?r.value.thickness:r.value.diameter)*1000,6)}\t${CableModel.derived(i)?fmt(CableModel.derived(i).outer_radius_m*2000,1):'未生成'}\t${CableModel.massText(CableModel.derived(i)?.mass_kg_per_km,false)}`),`合计\t\t\t\t\t${CableModel.massText(CableModel.model()?.mass_kg_per_km,false)}`].join('\n');await navigator.clipboard.writeText(text);notify('结构表已复制');}
function bindCanvas(){
  const svg=$('.drawing');if(!svg)return;let drag=null;
  svg.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY<0?1.1:1/1.1);},{passive:false});
  svg.addEventListener('pointerdown',event=>{if(state.tool!=='pan'&&event.button!==1)return;event.preventDefault();drag={x:event.clientX,y:event.clientY,pan:clone(state.pan)};svg.setPointerCapture(event.pointerId);});
  svg.addEventListener('pointermove',event=>{
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse()),outer=entries().at(-1).outer;
    $('#coordinates').textContent=`x ${fmt((p.x-state.pan.x-280)/state.zoom/170*outer*1000,2)} · z ${fmt(-(p.y-state.pan.y-245)/state.zoom/170*outer*1000,2)}`;
    if(!drag)return;const scale=svg.getScreenCTM().a;state.pan={x:drag.pan.x+(event.clientX-drag.x)/scale,y:drag.pan.y+(event.clientY-drag.y)/scale};
    if(state.snap){if(Math.abs(state.pan.x)<8)state.pan.x=0;if(Math.abs(state.pan.y)<8)state.pan.y=0;}
    $('#geometry').setAttribute('transform',`translate(${state.pan.x} ${state.pan.y}) translate(280 245) scale(${state.zoom}) translate(-280 -245)`);$('#snap-guide').toggleAttribute('hidden',!state.snap||(state.pan.x!==0&&state.pan.y!==0));
  });
  svg.addEventListener('pointerup',()=>{if(!drag)return;drag=null;renderStage();});
}
function zoom(factor){state.zoom=Math.max(.3,Math.min(4,state.zoom*factor));renderStage();renderStatus();}
function select(index){state.selected=Number(index);renderObjects();renderInspector();if(state.view==='section')renderStage();else if(state.view==='three')CableModel.select(state.selected);else document.querySelectorAll('.data-grid tbody tr').forEach((tr,i)=>tr.classList.toggle('selected',i===state.selected));renderDock();renderStatus();}
function mutateLayers(operation){
  if((state.record.locks||[]).some(lock=>(lock.targets||[]).some(p=>p.includes('/common_layers'))))throw new Error('存在结构层锁定，不能调整层堆叠。');
  rememberDraft();operation();refreshDirty();renderStructure();
}
async function action(name){
  if(name.startsWith('model-'))return CableModel.action(name);
  if(name.startsWith('amp-'))return Ampacity.action(name).catch(Ampacity.error);
  if(name==='dismiss-error'){$('#error').hidden=true;return;}if(name==='close'){$('#modal').close();return;}
  if(name==='run-history'){showRunHistory();return;}
  if(name==='modules'){moduleCatalog();return;}
  if(name.startsWith('type-')){await TypeWorkflow.action(name);return;}
  if(name==='new-type'){await TypeWorkflow.action('type-new');return;}
  if(name==='create-preset'){await createFromPreset($('#preset').value);return;}
  if(name.startsWith('preset-')){await createFromPreset(name.slice(7));return;}
  if(name==='save'){await save();return;}if(name==='undo'||name==='redo'){await applyWorkspaceHistory(name);return;}
  if(name.startsWith('view-')){state.view=['table','three'].includes(name.slice(5))?name.slice(5):'section';history.replaceState(null,'',location.hash.split('?')[0]+'?view='+state.view);state.route=location.hash.slice(1);renderStructure();return;}
  if(name.startsWith('dock-')){state.dock=name.slice(5);state.collapsed=false;renderStructure();return;}
  if(name==='collapse'){state.collapsed=!state.collapsed;renderStructure();return;}
  if(name.startsWith('tool-')){state.tool=name.slice(5);renderStage();return;}
  if(name==='snap'){state.snap=!state.snap;renderStage();return;}
  if(name==='zoom-in'){if(state.view==='three')return CableModel.action('model-zoom-in');zoom(1.2);return;}if(name==='zoom-out'){if(state.view==='three')return CableModel.action('model-zoom-out');zoom(1/1.2);return;}
  if(name==='fit'){if(state.view==='three')return CableModel.action('model-fit');state.zoom=1;state.pan={x:0,y:0};renderStage();renderStatus();return;}
  if(name==='copy-grid'){await copyGrid();return;}
  if(name==='add-layer'){
    const available=Object.entries(roleNames).filter(([role])=>role!=='conductor'&&!type().common_layers.some(l=>l.role===role));
    openDialog('添加结构层',`<div class="stack"><label>结构层<select id="layer-role">${available.map(([role,label])=>`<option value="${role}">${label}</option>`).join('')}</select></label><label>材料<select id="layer-material">${state.draft.materials.map(m=>`<option value="${esc(m.id)}">${esc(materialLabel(m))}</option>`).join('')}</select></label><label class="field"><span>厚度 · mm</span><input type="number" step="any" id="layer-thickness" aria-label="新层厚度"></label><small>插入在当前选中层之外；数值来源标记为用户录入，保存后整体校验。</small></div>`,button('加入草稿','','create-layer','class="primary"'));return;
  }
  if(name==='create-layer'){
    const thickness=validateInput($('#layer-thickness').value,true,false)/1000,role=$('#layer-role').value,material=$('#layer-material').value;
    mutateLayers(()=>{type().common_layers.splice(state.selected,0,{role,material,thickness});state.selected++;state.draft.provenance[stablePointer(entries()[state.selected].path+'.thickness')]={kind:'user',reference:'结构设计 · 新增结构层',reviewed:false};});$('#modal').close();log('新增结构层，待保存校验。');return;
  }
  if(name==='delete-layer'){
    if(state.selected===0)throw new Error('导体是必需对象，不能删除。');
    mutateLayers(()=>{type().common_layers.splice(state.selected-1,1);state.selected=Math.max(0,state.selected-1);});log('结构层已从草稿删除，尚未保存。');return;
  }
  if(name==='paste-dialog'){openDialog('从 Excel 粘贴',`<p class="subtle" style="margin-bottom:12px">从当前选中层开始，仅粘贴径向尺寸一列；导体行为直径，其余行为厚度，单位 mm。</p><textarea id="paste-text" aria-label="粘贴数据" placeholder="每行一个尺寸值"></textarea>`,button('写入草稿','','apply-paste','class="primary"'));return;}
  if(name==='apply-paste'){pasteGrid($('#paste-text').value);$('#modal').close();return;}
  if(name==='discard'){rememberDraft();state.draft=clone(state.record.document);state.dirty=false;$('#modal').close();refreshDraftView();return;}
  if(name==='agent'){openDialog('Agent · 当前结构',`<p>当前对象：${esc(roleNames[selected().role])}，输入修订 r${state.record.revision}。</p><p class="subtle" style="margin-top:12px">领域编辑提案尚未接入。本页不提交云端请求，也不自动修改参数。</p>`);return;}
  if(name==='theme'){const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('csp-theme',theme);renderPage();return;}
  if(name==='refresh-methods'){state.methods=await api('/methods');log('已重新读取 /api/methods。');renderWorkspace();return;}
  if(name==='shortcuts'){openDialog('编辑快捷键',`<div class="shortcut-list">${[['Ctrl+S','保存草稿为新修订'],['Ctrl+Z','撤销'],['Ctrl+Shift+Z','重做'],['Ctrl+C','复制当前结构表（焦点在画布时）'],['Enter / Tab','提交单元格 / 下一格'],['V / H','选择 / 平移'],['S','切换视图中心捕捉'],['F','适应窗口'],['+ / −','缩放画布'],['Esc','关闭浮层 / 草稿操作']].map(([k,v])=>`<span><kbd>${k}</kbd>　${v}</span>`).join('')}</div>`);}
}
document.addEventListener('click',event=>{const a=event.target.closest('[data-action]');if(a){action(a.dataset.action).catch(fail);return;}const choice=event.target.closest('[data-select]');if(choice&&(state.tool!=='pan'||state.view==='table'||state.view==='three'))select(choice.dataset.select);});
document.addEventListener('input',event=>{const el=event.target;if(!el.dataset.field||el.type!=='number'||el.value===''||!el.validity.valid||Number(el.value)<=0)return;try{edit(el.dataset.field,Number(el.value)/Number(el.dataset.scale||1));el.classList.toggle('changed',changed(el.dataset.field));renderObjects();renderDock();}catch(error){fail(error);}});
document.addEventListener('focusout',()=>{draftHistory.group=null;});
document.addEventListener('change',event=>{
  const el=event.target;
  try{
    if(Ampacity.change(event))return;
    if(el.id==='overlay'){state.overlay=el.checked;renderStage();return;}if(el.id==='reduce'){localStorage.setItem('csp-reduced',String(el.checked));return;}
    if(el.dataset.field){const raw=validateInput(el.value,el.type==='number',el.dataset.nullable==='true');edit(el.dataset.field,raw===null?null:el.type==='number'?raw/Number(el.dataset.scale||1):raw===''&&/\.(form|lay_direction)$/.test(el.dataset.field)?null:raw);el.removeAttribute('aria-invalid');renderObjects();renderStage();renderInspector();renderDock();}
    if(el.dataset.gridRow!==undefined){rememberDraft();gridEdit(Number(el.dataset.gridRow),Number(el.dataset.gridCol),el.value);el.removeAttribute('aria-invalid');refreshDirty();renderInspector();renderDock();}
  }catch(error){fail(error);el.setAttribute('aria-invalid','true');}
});
document.addEventListener('paste',event=>{if(Ampacity.paste(event))return;const el=event.target;if(el.dataset.gridRow===undefined)return;event.preventDefault();try{pasteGrid(event.clipboardData.getData('text/plain'),Number(el.dataset.gridRow),Number(el.dataset.gridCol));}catch(error){fail(error);}});
document.addEventListener('keydown',event=>{
  if(Ampacity.keydown(event))return;
  const editing=event.target.matches('input,textarea,select'),mod=event.ctrlKey||event.metaKey;
  if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();if(editing)event.target.blur();save().catch(fail);return;}
  if(mod&&event.key.toLowerCase()==='z'&&state.route.startsWith('/types/')&&!$('#modal').open){event.preventDefault();applyWorkspaceHistory(event.shiftKey?'redo':'undo').catch(fail);return;}
  if(editing){if(event.key==='Enter'&&event.target.tagName!=='TEXTAREA'){event.preventDefault();event.target.blur();}return;}
  if($('#modal').open)return;
  if(mod&&event.key.toLowerCase()==='z'){event.preventDefault();applyWorkspaceHistory(event.shiftKey?'redo':'undo').catch(fail);return;}
  if(mod&&event.key.toLowerCase()==='c'&&state.draft&&state.route.startsWith('/types/')){event.preventDefault();copyGrid().catch(fail);return;}
  if(event.key==='Escape'&&state.dirty){event.preventDefault();openDialog('未保存草稿','<p>选择保存到新修订，或放弃这次草稿。</p>',button('放弃草稿','','discard')+button('保存修订','','save','class="primary"'));return;}
  if(!state.draft||!state.route.startsWith('/types/'))return;
  if(event.key==='Delete'){event.preventDefault();action('delete-layer').catch(fail);return;}
  const map={v:'tool-select',h:'tool-pan',s:'snap',f:'fit','+':'zoom-in','=':'zoom-in','-':'zoom-out'};
  if(map[event.key.toLowerCase()]){event.preventDefault();action(map[event.key.toLowerCase()]).catch(fail);}
});
window.addEventListener('hashchange',()=>route().catch(fail));window.addEventListener('resize',syncDiagramFont);window.addEventListener('beforeunload',event=>{if(state.dirty||Ampacity.dirty()){event.preventDefault();event.returnValue='';}});
TypeWorkflow.init({$,esc,fmt,groupNumber,api,state,icon,button,log,notify,openDialog,type,roleNames,save,loadWorkspace,renderWorkspace,renderHeader,renderStatus});
CableModel.init({$,esc,fmt,api,state,icon,button,log,notify,openDialog,type,select,renderStructure,renderHeader,renderStatus,renderInspector,renderDock});
Ampacity.init({$,esc,clone,fmt,groupNumber,api,state,icon,button,log,notify,fail,openDialog,loadWorkspace,refreshLists,renderWorkspace,getPath,setPath,sourceText,isLocked,stablePointer});
async function boot(){document.documentElement.dataset.theme=localStorage.getItem('csp-theme')||'light';await hydrate();[state.methods,state.presets]=await Promise.all([api('/methods'),api('/presets')]);await refreshLists();log(`已连接真实 API：${state.methods.length} 个插件。尚无经过本页运行的结果。`);await route();}
boot().catch(error=>{$('#workspace').innerHTML=`<div class="empty"><h2>本机 API 未连接</h2><p>${esc(error.message)}</p><p>请从仓库运行 python design/workbench/serve.py，再刷新此页。</p></div>`;fail(error);});
