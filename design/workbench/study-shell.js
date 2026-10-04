'use strict';
// One workspace shell for every study module. Modules supply content and selection only.
window.StudyShell=(()=>{
  let C,tabObserver,navigationFocus=null,contentChecks=[];
  const tabScroll=new Map();
  const compact=matchMedia('(max-width:800px)');
  const unavailableTabs=new Set();
  const tabAvailable=(module,id)=>!unavailableTabs.has(module+'/'+id);
  const modules=[
    {id:'cable',name:'电缆',icon:'object/cable',tabs:[['section','截面',true],['layers','分层表'],['references','引用']]},
    {id:'section',name:'敷设截面',icon:'object/section',tabs:[['section','截面',true],['three-dimensional','三维',true],['coordinates','坐标表'],['media','介质']]},
    {id:'conditions',name:'工况',icon:'object/conditions',tabs:[]},
    {id:'ampacity',name:'载流量',icon:'calc/ampacity',tabs:[['results','结果'],['parameters','任务与参数'],['losses','损耗与热阻'],['diagnostics','诊断']]},
    {id:'thermal-field',name:'温度场',icon:'calc/thermal-field',tabs:[['field','场图',true],['samples','取样表'],['parameters','方法参数'],['diagnostics','诊断']]},
    {id:'selection',name:'问询选型',icon:'calc/ampacity',tabs:[['results','候选结果'],['settings','问询条件']]},
    {id:'sweep',name:'参数扫描',icon:'module/sweep',tabs:[['curve','曲线'],['points','逐点表'],['settings','扫描设置']]},
    {id:'batch',name:'批量仿真',icon:'module/sweep',tabs:[['space','参数空间'],['results','样本结果'],['execution','执行记录']]},
    {id:'method-compare',name:'方法对比',icon:'module/method-compare',tabs:[['results','结果差异'],['inputs','输入差异'],['evidence','验证证据']]},
    {id:'report',name:'计算书',icon:'result/report',tabs:[['content','内容'],['sources','来源清单'],['preview','预览']]}
  ];
  const taskNames={rating:'求允许电流',operating:'给定电流求温度',target:'目标电流校核'};
  const workflowNames={target:'载流量校核',operating:'给定电流求温升',rating:'求允许载流量',selection:'客户问询选型',sweep:'参数扫描',compare:'方法对比'};
  const visibleModules=()=>modules.filter(m=>C.activeModules?.().includes(m.id)??true);
  const E=v=>C.H.esc(v), B=(label,icon,action,attrs='')=>C.H.button(label,icon,'amp-'+action,attrs);
  const displayName=v=>String(v||'').replace(/（[^）]*(?:演示|非厂家|不供客户)[^）]*）|\([^)]*(?:演示|非厂家|不供客户)[^)]*\)/g,'').replace(/\s*·\s*未核对候选演示/g,'').replace(/演示/g,'').trim();
  const module=()=>modules.find(m=>m.id===C.A.module);
  const formatTime=r=>new Date(r.created).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  function circuitName(label,index){const value=String(label||'').replace(/（(?:典型)?结构演示）|（演示）/g,'').trim();const match=value.match(/^(?:第\s*(\d+)\s*回路|回路\s*(\d+))$/);return match?'回路 '+(match[1]||match[2]):!value||value.startsWith('v0 ')?'回路 '+(index+1):value;}
  function sourceBadge(source,locked=false,host=C?.H){
    const kind=locked?'locked':source?.kind;
    const kinds={asset:['from-library','库'],standard:['from-standard','标准'],manufacturer:['from-document','资料'],measurement:['from-document','测量'],derived:['derived','推导'],locked:['locked','锁定'],user:['from-user','人工'],demo:['from-document','预置']};
    const reference=source?.reference?.replace(/\s*·?\s*sha256:[a-f0-9]+/g,'');
    const entry=kinds[kind]||['from-document','来源未提供'],label=entry[1]+(reference?' · '+reference:'')+(source?.reviewed?' · 已核对':' · 未核对');
    return `<span class="study-source" role="img" tabindex="0" aria-label="${host.esc(label)}" title="${host.esc(label)}">${host.icon('source/'+entry[0])}</span>`;
  }
  function sourceLegend(){return `<div class="study-source-legend">${[['from-library','库'],['from-standard','标准'],['from-document','资料'],['derived','推导'],['locked','锁定'],['from-user','人工']].map(([key,label])=>`<span>${C.H.icon('source/'+key)}${label}</span>`).join('')}</div>`;}
  function studyStateLabel(){
    const {A}=C,dirty=C.dirty(),readonly=!!A.viewRunId,thermal=A.module==='thermal-field',ref=readonly?A.run.snapshot.definition:thermal?A.draft.modules?.['thermal-field']:A.module==='selection'?A.draft.modules?.selection:A.draft;
    const demo=C.H.state.snapshot?.study_cable_reference?.state==='demo'||Object.values(C.H.state.draft?.provenance||{}).some(v=>v.kind==='demo')||Object.values(ref?.input_sources||{}).some(v=>v.kind==='demo');
    const state=readonly?'运行快照 · 只读':A.busy?'处理中':dirty?'未保存':A.module==='report'&&A.delivery?'已生成':C.runBlock?.()?'需核对':thermal?window.SimulationStudy?.moduleStatus().summary||'尚未计算':A.module==='selection'?(window.SelectionStudy?.current()?.freshness==='current'?'候选已核验':'尚未选型'):'已保存';
    const historical=!readonly&&(thermal?window.SimulationStudy?.thermalHistorical():A.run?.freshness==='historical');
    return [state,historical&&!state.includes('历史')?'历史结果':null,demo?'演示':null].filter(Boolean).join(' · ');
  }
  function header(){
    const {A}=C,dirty=C.dirty(),readonly=!!A.viewRunId,ref=readonly?A.run.snapshot.definition:A.draft,block=C.runBlock?.(),next=C.workflowNext?.(),binding=readonly?A.run.snapshot.workspace_state?.study_cable_reference:C.H.state.snapshot?.study_cable_reference;
    const conclusionAction=A.module==='selection'&&A.tab==='results'&&window.SelectionStudy?.current();
    const stateText=studyStateLabel();
    C.H.$('#header').innerHTML=`<span class="pill">研究</span><div class="title-wrap"><h1>${E(displayName(ref.title))}</h1><span class="study-subtitle">${E(C.subtitle?.()||'')}</span></div>${['thermal-field','selection','batch'].includes(A.module)?'':`<button class="study-task quiet" data-action="amp-change-task" ${readonly||A.busy?'disabled':''} title="更换研究任务">${E(workflowNames[C.workflow?.(ref)]||taskNames[ref.task||A.task])}${C.H.icon('action/chevron-down')}</button>`}<span class="spacer"></span><button class="study-state-marker quiet" data-action="amp-status-details" aria-expanded="${A.checksOpen}" aria-controls="study-check-table">${E(stateText)}${C.H.icon('action/chevron-down')}</button>${readonly?`<a class="study-return" href="${C.href(A.module,A.tab,null)}">返回研究</a>`:B('保存','action/save','save',dirty&&!A.busy?'':'disabled')}${B('运行记录','action/history','records',A.busy?'disabled':'')}<a class="study-header-link" href="${C.href('report','content',null)}">${C.H.icon('result/report')}交付</a>${!readonly&&next&&!conclusionAction?B(next.label,next.action==='preflight'||next.action==='thermal-preflight'?'run/run':'action/chevron-down','workflow-next',`class="run-button study-primary-next" ${A.busy||next.disabled?'disabled':''}`):''}`;
  }
  function navigation(){
    const {A}=C;
    const items=visibleModules();
    return `<div class="study-mobile-navigation"><label for="study-module-select">模块</label><select id="study-module-select" aria-label="研究模块">${items.map(m=>`<option value="${m.id}" ${A.module===m.id?'selected':''}>${m.name}</option>`).join('')}</select>${B('属性','','mobile-inspector',`class="quiet" aria-expanded="${(isCanvas()||C.hasSelection())&&!A.inspectorClosed[A.module+'/'+A.tab]}"`)}</div><div class="study-module-links"><div class="rail-caption">${E(workflowNames[C.workflow?.()]||'研究模块')}</div>${items.map(m=>`<a class="module-row ${A.module===m.id?'active':''}" href="${C.href(m.id,null,null)}" ${A.module===m.id?'aria-current="page"':''}>${C.H.icon(m.icon)}<span>${m.name}</span></a>${A.module===m.id?(C.objects()||'').replace(/第\s*(\d+)\s*回路/g,'回路 $1'):''}`).join('')}${B('添加模块','module/add-module','modules','class="module-row study-more-modules"')}</div>`;
  }
  function updateState(){
    if(!C)return;const {A}=C,dirty=C.dirty(),save=C.H.$('[data-action="amp-save"]'),run=C.H.$('[data-action="amp-workflow-next"]'),state=C.H.$('.study-state-marker');
    if(save)save.disabled=!dirty||A.busy;if(run){run.disabled=A.busy||!!C.workflowNext?.().disabled;run.lastChild.textContent=C.workflowNext?.().label||'预检并运行';}
    const hint=C.H.$('.study-run-hint'),block=C.runBlock?.();if(hint){hint.hidden=!block||!!A.viewRunId;hint.textContent=block?.text||'';}
    if(state){state.innerHTML=E(studyStateLabel())+C.H.icon('action/chevron-down');state.setAttribute('aria-expanded',String(A.checksOpen));}
  }
  function tabs(){
    const m=module();if(!m)return '';
    return `<h2>${m.name}</h2>${m.tabs.length>1?`<div class="study-tabstrip">${B('','action/chevron-down','tabs-left','class="study-tab-scroll previous" aria-label="向前滚动页签" hidden')}<div class="study-tabs" data-scroll-key="${C.A.study.id+'/'+m.id}" role="tablist" aria-orientation="horizontal" aria-label="${m.name}页签">${m.tabs.map(([id,label])=>{const available=tabAvailable(m.id,id);return `<a role="tab" id="study-tab-${id}" aria-controls="study-stage" aria-selected="${C.A.tab===id}" ${available?'':'aria-disabled="true" title="'+label+'尚未接入"'} tabindex="${C.A.tab===id?0:-1}" href="${C.href(m.id,id)}"><span>${label}</span>${available?'':'<small>待接入</small>'}</a>`;}).join('')}</div>${B('','action/chevron-down','tabs-right','class="study-tab-scroll next" aria-label="向后滚动页签" hidden')}</div>`:''}${C.A.module==='ampacity'?`<div class="study-view-controls">${C.methodPicker()}</div>`:''}`;
  }
  function syncTabs(reveal=false){
    const workspace=C.H.$('.study-workspace'),bar=C.H.$('.study-tabbar');if(workspace&&bar)workspace.style.setProperty('--study-tab-height',bar.offsetHeight+'px');
    const list=C.H.$('.study-tabs'),strip=C.H.$('.study-tabstrip');if(!list||!strip)return;
    const left=strip.querySelector('.previous'),right=strip.querySelector('.next'),overflow=list.scrollWidth>strip.clientWidth+1;
    left.hidden=right.hidden=!overflow;
    if(reveal){const tab=list.querySelector('[aria-selected=true]');if(tab){const a=tab.getBoundingClientRect(),b=list.getBoundingClientRect();if(a.left<b.left)list.scrollLeft-=b.left-a.left;else if(a.right>b.right)list.scrollLeft+=a.right-b.right;}}
    left.disabled=list.scrollLeft<=1;right.disabled=list.scrollLeft+list.clientWidth>=list.scrollWidth-1;
  }
  function isCanvas(){return !!module()?.tabs.find(t=>t[0]===C.A.tab)?.[2];}
  function inspectorOpen(){const key=C.A.module+'/'+C.A.tab;return ((C.A.module==='thermal-field'?false:isCanvas())||C.hasSelection())&&!(C.A.inspectorClosed[key]??(compact.matches&&isCanvas()));}
  function inspector(){
    const el=C.H.$('#study-inspector');if(!el)return;
    const open=inspectorOpen();
    const mobile=C.H.$('[data-action="amp-mobile-inspector"]');if(mobile){mobile.disabled=!isCanvas()&&!C.hasSelection();mobile.setAttribute('aria-expanded',String(open));}
    C.H.$('.study-workspace').classList.toggle('inspector-open',open);
    el.classList.toggle('is-collapsed',!open);
    el.setAttribute('aria-label',open?'选中对象属性':'属性（收起）');
    el.innerHTML=open?`<div class="study-inspector-tools">${B('收起属性','action/chevron-down','close-inspector','class="quiet"')}</div>${C.inspector()}${sourceLegend()}`:`<button class="study-inspector-rail" data-action="amp-open-inspector" aria-label="展开所选对象属性" title="选中一行后展开"><span>属性</span>${C.H.icon('action/chevron-down')}</button>`;
  }
  function checks(){
    const el=C.H.$('#study-checks');if(!el)return;
    const data=C.checks(),open=C.A.checksOpen;
    el.innerHTML=`<div class="study-checkbar"><strong>校核项</strong><span class="study-check-summary">${E(data.summary)}</span><span class="spacer"></span>${C.A.messages.length?B('消息 '+C.A.messages.length,'','messages','class="quiet"'):''}${B(open?'收起':'展开','action/chevron-down','toggle-checks',`class="quiet" aria-expanded="${open}" aria-controls="study-check-table"`)}</div>${open?`<div id="study-check-table" class="study-check-table">${statusDetails()}${data.table}</div>`:''}`;
  }
  function statusDetails(){
    const ref=C.A.viewRunId?C.A.run.snapshot.definition:C.A.module==='thermal-field'?C.A.draft.modules?.['thermal-field']:C.A.module==='selection'?C.A.draft.modules?.selection:C.A.draft;
    const method=ref?.method,entry=C.H.state.methods.find(m=>m.method.plugin_id===method?.plugin_id),cap=entry?.capabilities.find(c=>c.id===method?.capability),binding=C.H.state.snapshot?.study_cable_reference,block=C.runBlock?.(),limits=C.A.viewRunId?C.A.run.output?.preflight?.limitations||[]:cap?.limitations||[];
    const messages=[...limits,...contentChecks,...(C.A.module==='selection'?window.SelectionStudy?.checks?.()||[]:[]),...(block?[block.text]:[]),...(binding?.state==='demo'?['预置输入须按现场和产品资料核对。']:[]),...(ref?.parameters?.reference_basis==='tb880_reference'?['TB 880 参考复现采用原算例版本。']:[])];
    return `<div class="study-status-details"><strong>方法与来源</strong><p>${E(entry?.name||'方法未配置')}${method?' · '+E(method.version):''}</p><ul>${[...new Set(messages)].map(v=>`<li>${E(v)}</li>`).join('')}</ul></div>`;
  }
  function collectContentChecks(){
    contentChecks=[];const stage=C.H.$('#study-stage');if(!stage)return;
    // Explanatory limitations have one home. Forms, actual numeric results,
    // recovery controls and field errors stay with the operation they explain.
    for(const node of stage.querySelectorAll('.study-note,.amp-inline-note,.amp-limitations,.amp-scope')){
      if(!node.isConnected)continue;
      if(node.closest('[role="alert"]')||node.querySelector('input,button,select,table,a')||node.matches('[role="alert"]'))continue;
      const scope=node.matches('.amp-limitations')||node.matches('.amp-scope')&&/范围|验证声明/.test(node.querySelector('summary')?.textContent||'');
      if(scope||/演示|假设|未覆盖|不能|未接入|待补数据|不供客户|非厂家/.test(node.textContent)){
        const rows=node.querySelectorAll('li');if(rows.length)rows.forEach(row=>contentChecks.push(row.textContent.trim()));else contentChecks.push(node.textContent.trim());node.remove();
      }
    }
    for(const row of stage.querySelectorAll('tr'))for(const cell of row.cells)if(/^演示\s*·\s*未核对$/.test(cell.textContent.trim()))cell.textContent='草稿';
  }
  function render(ctx){
    const previous=document.querySelector('.study-tabs');if(previous)tabScroll.set(previous.dataset.scrollKey,previous.scrollLeft);tabObserver?.disconnect();C=ctx;header();
    C.H.$('#workspace').innerHTML=`<div class="study-workspace"><nav class="module-rail study-modules" aria-label="研究模块">${navigation()}</nav><section class="study-main"><div class="study-tabbar">${tabs()}</div><div id="study-stage" class="study-stage" role="tabpanel" ${module()?.tabs.length?`aria-labelledby="study-tab-${C.A.tab}"`:''} tabindex="-1"></div><section id="study-checks" class="study-checks" aria-label="校核项"></section></section><aside id="study-inspector" class="inspector study-inspector"></aside></div>`;
    C.H.$('#workspace').inert=C.A.busy;
    C.renderContent();collectContentChecks();inspector();checks();C.renderStatus();
    const list=C.H.$('.study-tabs');if(list){list.scrollLeft=tabScroll.get(list.dataset.scrollKey)||0;list.addEventListener('scroll',()=>syncTabs());tabObserver=new ResizeObserver(()=>syncTabs(true));tabObserver.observe(C.H.$('.study-tabstrip'));}
    queueMicrotask(()=>{syncTabs(true);if(navigationFocus&&navigationFocus.href===location.hash){const link=[...document.querySelectorAll(navigationFocus.selector)].find(el=>el.matches('select')||el.getAttribute('href')===navigationFocus.href);if(link&&!C.A.busy)link.focus({preventScroll:true});navigationFocus=null;}});
    list?.addEventListener('keydown',event=>{
      if(event.key===' '){event.preventDefault();event.target.click();return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const items=[...list.querySelectorAll('[role=tab]:not([aria-disabled=true])')],i=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;items[next]?.focus();items[next]?.click();
    });
  }
  function refreshSelection(){
    const nav=C.H.$('.study-modules');if(nav)nav.innerHTML=navigation();
    inspector();C.renderStatus();
  }
  function openRecords(mode='runs'){
    const dialog=C.H.$('#study-records');C.A.recordMode=mode;
    dialog.innerHTML=`<div class="study-drawer-head"><h2 id="study-records-title">${mode==='messages'?'消息':'运行记录'}</h2><span class="spacer"></span>${B('关闭','action/close','close-records','aria-label="关闭运行记录"')}</div><div class="study-drawer-body">${mode==='messages'?(C.A.messages.length?C.A.messages.map(m=>`<div class="message-row"><time>${m.at}</time><span>${E(m.text)}</span></div>`).join(''):'<p class="empty">暂无消息。</p>'):`<div class="study-drawer-filter"><label>模块<select id="study-record-filter"><option value="all">全部模块</option><option value="ampacity" ${C.A.recordFilter==='ampacity'?'selected':''}>载流量</option></select></label><a href="${C.href('method-compare','results',null)}" data-close-records>方法对比</a></div>${recordRows()}`}</div>`;
    if(!dialog.open)dialog.showModal();
    dialog.querySelector('[data-close-records]')?.addEventListener('click',()=>dialog.close());
  }
  function recordRows(){
    const runs=C.A.runs.filter(r=>C.A.recordFilter!=='ampacity'||C.runIsAmpacity(r));
    if(!runs.length)return '<div class="empty"><h3>还没有运行记录</h3><p>保存输入并运行后，可以在这里查看输入快照与计算状态。</p></div>';
    return `<table class="study-table"><thead><tr><th>计算时间 / 方法</th><th>状态</th><th>耗时</th><th></th></tr></thead><tbody>${runs.map(r=>`<tr><td>${E(formatTime(r))}<small>${E(C.methodName(r.snapshot.definition.method))} · ${E(r.snapshot.definition.method.version)}</small></td><td>${E(C.statusLabel(r.status))}<small>${r.freshness==='current'?'当前输入':'历史输入'}</small></td><td class="number">${r.finished?((new Date(r.finished)-new Date(r.created))/1000).toFixed(1)+' s':'—'}</td><td>${B('详情','','open-run-'+r.id,'class="quiet"')}</td></tr>`).join('')}</tbody></table>`;
  }
  function action(k){
    if(k==='status-details'){C.A.checksOpen=true;checks();C.H.$('#study-check-table')?.scrollIntoView({block:'nearest'});C.H.$('.study-state-marker')?.setAttribute('aria-expanded','true');return true;}
    if(k==='tabs-left'||k==='tabs-right'){const list=C.H.$('.study-tabs');if(list)list.scrollLeft+=(k==='tabs-left'?-1:1)*Math.max(120,list.clientWidth*.75);syncTabs();return true;}
    if(k==='mobile-inspector'){C.A.inspectorClosed[C.A.module+'/'+C.A.tab]=inspectorOpen();inspector();return true;}
    if(k==='records'||k==='messages'){openRecords(k==='records'?'runs':'messages');return true;}
    if(k==='close-records'){C.H.$('#study-records').close();return true;}
    if(k==='toggle-checks'){C.A.checksOpen=!C.A.checksOpen;checks();return true;}
    if(k==='close-inspector'||k==='open-inspector'){C.A.inspectorClosed[C.A.module+'/'+C.A.tab]=k==='close-inspector';inspector();return true;}
    return false;
  }
  document.addEventListener('click',event=>{const link=event.target.closest('.study-tabs [role=tab],.study-modules .module-row');if(!link)return;if(link.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button<=0)navigationFocus={href:link.getAttribute('href'),selector:link.matches('[role=tab]')?'.study-tabs a':'.study-modules .module-row'};},true);
  document.addEventListener('change',event=>{if(C&&event.target.id==='study-module-select')navigationFocus={href:C.href(event.target.value,null,null),selector:'#study-module-select'};},true);
  compact.addEventListener('change',()=>{if(C&&document.querySelector('.study-workspace'))inspector();});
  return {modules,taskNames,workflowNames,tabAvailable,render,header,updateState,inspector,checks,refreshSelection,openRecords,action,sourceBadge,sourceLegend,isCanvas,formatTime,circuitName};
})();
