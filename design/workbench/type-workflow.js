'use strict';
// Type deliverables reuse the host's immutable runs and current-only deliveries.
window.TypeWorkflow=(()=>{
  let H;
  const cache=new Map();
  const E=v=>H.esc(v),N=(v,n=1)=>Number.isFinite(v)?H.groupNumber(v.toFixed(n)):'未输出';
  const B=(label,icon,action,attrs='')=>H.button(label,icon,'type-'+action,attrs);
  const moduleId=()=>H.state.route.split('?')[0].split('/')[3]||'structure';
  const F=()=>{if(!cache.has(H.state.wid))cache.set(H.state.wid,{run:null,study:null,preflight:null,delivery:null,pending:false});return cache.get(H.state.wid);};
  const entry=()=>H.state.methods.find(m=>m.capabilities.some(c=>c.analysis==='geometry'&&c.input_schema==='cablesim.domain/1'));
  const model=r=>r?.output?.cases.find(c=>c.status==='succeeded')?.artifacts?.['x-cablesim.cad-model'];
  const current=()=>{const f=F(),r=f.run,m=entry();return !!model(r)&&r.integrity==='verified'&&r.freshness==='current'&&!H.state.dirty&&r.snapshot.workspace_revision===H.state.record.revision&&r.snapshot.definition.method.release_digest===m?.method.release_digest;};
  function bindRuns(){
    const f=F(),runs=H.state.runs.filter(r=>r.snapshot.definition.method.plugin_id===entry()?.method.plugin_id&&model(r));
    runs.sort((a,b)=>new Date(b.created)-new Date(a.created));f.run=runs[0]||null;
    if(f.delivery&&(!current()||f.delivery.sources?.[0]?.run_id!==f.run?.id))f.delivery=null;
  }
  async function restoreDelivery(){
    bindRuns();const f=F();if(!current()||f.delivery)return;let saved;try{saved=JSON.parse(localStorage.getItem('csp-type-delivery:'+H.state.wid)||'null');}catch{}if(saved?.run_id!==f.run.id)return;
    try{const d=await H.api(`/workspaces/${H.state.wid}/deliveries/${saved.id}`);if(d.sources?.length===1&&d.sources[0].run_id===f.run.id)f.delivery=d;}catch{localStorage.removeItem('csp-type-delivery:'+H.state.wid);}
  }
  function rail(){
    const id=moduleId(),root='#/types/'+H.state.wid;
    return `<div class="rail-caption">型号模块</div><a class="module-row ${id==='structure'?'active':''}" href="${root}/structure" ${id==='structure'?'aria-current="page"':''}>${H.icon('module/structure')}结构设计</a>${id==='structure'?'<div id="objects"></div>':''}<a class="module-row ${id==='standard-check'?'active':''}" href="${root}/standard-check">${H.icon('module/standard-check')}标准核对<span class="study-nav-state">未接入</span></a><a class="module-row ${id==='specification'?'active':''}" href="${root}/specification/content">${H.icon('module/datasheet')}规格书草稿</a>${H.button('添加模块','module/add-module','modules','class="module-row"')}<div class="rail-foot"><p>新版本草稿 · 未发布</p><p>保存与推导不代表产品通过标准审核。</p></div>`;
  }
  function tabs(){return `<div class="study-tabs type-structure-tabs" role="tablist" aria-label="结构设计页签">${[['section','截面'],['three','三维'],['table','分层表'],['quantities','用料']].map(([key,label])=>`<a role="tab" aria-selected="${H.state.view===key}" href="#/types/${H.state.wid}/structure/${key}" tabindex="${H.state.view===key?0:-1}">${label}</a>`).join('')}</div>`;}
  function invalidate(){
    if(!H.state.wid)return;F().delivery=null;
    if(H.state.view==='quantities')renderDerived();
    const status=H.$('#type-result-freshness');if(status)status.textContent='历史结果 · 参数已修改，请保存并更新推导';
  }
  function derivedTable(){
    const f=F(),m=model(f.run);if(!m)return '<div class="study-empty"><h3>还没有保存的结构推导</h3><p>保存型号后，用真实几何插件更新外径和单位长度用料。</p></div>';
    return `<div class="study-content"><p id="type-result-freshness" class="study-note ${current()?'':'warning'}">${current()?'当前保存输入的结构推导':'历史结果 · 输入或方法已变化，需要更新推导'}</p><p class="type-derived-summary">成品外径 <strong>${N(m.outer_diameter_m*1000)} mm</strong> · 理论单位长度用料 <strong>${N(m.mass_kg_per_km)} kg/km</strong></p><p class="subtle">电缆实体建模 · ${E(f.run.snapshot.definition.method.version)}；未知构造或密度保持缺项。</p><table class="study-table"><thead><tr><th>层次</th><th class="numeric">外径 / mm</th><th class="numeric">理论用料 / kg/km</th><th>依据 / 缺项</th><th>来源</th></tr></thead><tbody>${m.layers.map((r,i)=>`<tr><td>${E(H.roleNames[r.role]||r.label||'第 '+(i+1)+' 层')}</td><td class="number">${N(r.outer_radius_m*2000)}</td><td class="number">${N(r.mass_kg_per_km)}</td><td>${E(r.quantity_missing?.join('、')||r.quantity_basis||r.representation||'原始实体积分')}</td><td>${StudyShell.sourceBadge({kind:'derived',reference:'电缆实体建模 '+f.run.snapshot.definition.method.version+'；保存的运行结果',reviewed:false},false,H)}</td></tr>`).join('')}</tbody></table><details class="amp-scope"><summary>范围、近似与来源记录</summary><p>${E([m.geometry_approximation,m.display_approximation].filter(Boolean).join('；'))}</p><ul>${f.run.output.limitations.map(v=>'<li>'+E(v)+'</li>').join('')}</ul><p>本表来自保存的插件运行。参数改变后的显示预览不替代这份结果。</p></details><div class="study-actions"><a class="study-header-link" href="#/types/${H.state.wid}/standard-check">下一步：核对标准覆盖</a><a href="#/types/${H.state.wid}/specification/content">生成规格书草稿</a></div></div>`;
  }
  function resultStatus(){return current()?'结构推导 · 当前保存输入':model(F().run)?'结构推导 · 历史结果':'结构推导 · 尚未运行';}
  function checks(){
    const m=model(F().run),r=m?.layers[H.state.selected],fresh=current(),rows=[
      ['领域文档有效性','字段与几何一致',H.state.dirty?'未保存草稿':'已保存输入',H.state.dirty?'待保存校验':'服务端已校验'],
      ['成品外径 · 几何插件','未关联产品标准限值',m?N(m.outer_diameter_m*1000)+' mm':'尚未运行',fresh?'当前推导':m?'历史结果':'待更新推导'],
      ['当前层理论用料','保存的构造与材料密度',r?N(r.mass_kg_per_km)+' kg/km':'尚未运行',fresh?'当前推导':r?'历史结果':'待更新推导'],
      ['结构标准符合性','待关联原文与条款','未判定','未接入']
    ];return `<table class="checks"><thead><tr><th>校核项 / 来源</th><th>要求</th><th>当前</th><th>状态</th></tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(v=>'<td>'+E(v)+'</td>').join('')+'</tr>').join('')}</tbody></table>`;
  }
  function renderDerived(){
    const el=H.$('#stage');if(!el)return;const f=F();
    el.innerHTML=f.pending?'<div class="study-loading" role="status"><h3>正在更新结构推导</h3><p>几何插件正在处理已保存输入，外径与用料完成后显示。</p><div class="study-skeleton"></div><div class="study-skeleton"></div></div>':`<div class="type-derived-tools">${B(H.state.dirty?'保存并更新推导':'更新推导','action/refresh','derive',`class="run-button" ${H.state.busy?'disabled':''}`)}<span class="subtle">${H.state.dirty?'未保存参数不会直接用于运行。':'外径与用料来自真实几何插件。'}</span></div>${derivedTable()}`;
    el.classList.add('type-data-stage');
    const m=model(f.run),savedType=f.run?.snapshot.cases[0]?.input?.cable_types?.find(t=>t.id===f.run.snapshot.definition.parameters.cable_type_id)||H.state.draft.cable_types[0],c=savedType.cores[0].conductor,diameter=m?.layers[0]?.outer_radius_m*2000;
    if(!f.pending&&['stranded_round_compacted','segmental'].includes(c.form)&&Number.isFinite(diameter)&&Math.abs(diameter-c.diameter*1000)>.05){
      const envelope=(c.diameter+2*savedType.common_layers.reduce((n,l)=>n+l.thickness,0))*1000;
      el.querySelector('.type-derived-summary')?.nextElementSibling?.insertAdjacentHTML('afterend',`<p class="subtle type-geometry-note">设计导体包络 Ø ${N(c.diameter*1000)} mm；保存几何采用面积等效实体 Ø ${N(diameter)} mm。上表外径与用料属于该等效模型，结构尺寸包络外径 ${N(envelope)} mm；实际紧压导体外形尚需几何插件支持。</p>`);
    }
  }
  function standardPage(){
    const t=H.type(),ins=t.common_layers.find(l=>l.role==='insulation'),cond=t.cores[0].conductor;
    return `<div class="study-content"><h3>产品标准核对尚未接入</h3><p class="study-note">当前没有提供产品标准判定的插件，也没有批准的标准条款绑定。尺寸和电阻可查看，符合性保持未判定。</p><table class="study-table"><thead><tr><th>待核对项</th><th>保存输入</th><th>要求 / 来源</th><th>状态</th></tr></thead><tbody><tr><td>绝缘厚度</td><td class="number">${N(ins?.thickness*1000,2)} mm</td><td>尚未关联标准条款</td><td>未接入</td></tr><tr><td>导体 R₂₀</td><td class="number">${N(cond.r20==null?null:cond.r20*1000,4)} Ω/km</td><td>尚未关联标准条款</td><td>未接入</td></tr><tr><td>成品外径</td><td>${current()?N(model(F().run).outer_diameter_m*1000)+' mm':'待更新推导'}</td><td>尚未关联标准条款</td><td>未接入</td></tr></tbody></table><div class="study-actions"><a href="#/types/${H.state.wid}/structure/quantities">查看外径与用料</a><a class="study-header-link" href="#/types/${H.state.wid}/specification/content">下一步：规格书草稿</a></div></div>`;
  }
  function specificationPage(){
    const f=F(),preview=H.state.route.split('?')[0].split('/')[4]==='preview';
    if(preview)return f.delivery&&current()?`<div class="amp-preview-actions"><span>规格书草稿 · 未审核 / 未发布</span><a href="/api/design/workspaces/${H.state.wid}/deliveries/${f.delivery.id}/file" download="cable-specification.html">下载 HTML</a></div><iframe class="amp-report-preview" sandbox title="规格书草稿预览" srcdoc="${E(f.delivery.html)}"></iframe>`:`<div class="study-empty"><h3>尚无当前规格书草稿</h3><p>先确认当前结构推导，再生成。历史结果不能混入。</p><a href="#/types/${H.state.wid}/specification/content">选择内容</a></div>`;
    return `<div class="study-content"><h3>生成当前型号的规格书草稿</h3><p class="study-note">结构尺寸、材料来源和指定几何运行一并纳入；产品标准核对保留“未接入”，保存不发布。</p><table class="study-table"><thead><tr><th>章节</th><th>纳入内容</th><th>状态</th></tr></thead><tbody><tr><td>型号与额定参数</td><td>${E(H.type().label)}</td><td>新版本草稿</td></tr><tr><td>结构与材料</td><td>当前保存的分层与来源</td><td>${H.state.dirty?'有未保存编辑':'已保存'}</td></tr><tr><td>外径与理论用料</td><td>指定几何运行 · ${E(f.run?.snapshot.definition.method.version||'未运行')}</td><td>${current()?'当前结果':'需要更新推导'}</td></tr><tr><td>产品标准核对</td><td>未绑定条款及判定能力</td><td>未接入</td></tr></tbody></table><div class="study-actions">${B('生成并预览规格书草稿','result/report','report',`class="primary" ${!current()||H.state.busy?'disabled':''}`)}</div>${current()?'':`<p class="warning amp-inline-note">${H.state.dirty?'请先保存结构修改。':'缺少当前结构推导。'} <a href="#/types/${H.state.wid}/structure/quantities">去更新外径与用料</a></p>`}</div>`;
  }
  function renderModule(){
    const id=moduleId(),name=id==='standard-check'?'标准核对':'规格书草稿';
    H.$('#workspace').innerHTML=`<div class="work-area type-work-area type-document-workspace"><nav class="module-rail" aria-label="型号模块">${rail()}</nav><section class="center"><div class="study-tabbar"><h2>${name}</h2>${id==='specification'?`<div class="study-tabs" role="tablist">${[['content','内容'],['preview','预览']].map(([key,label])=>`<a role="tab" href="#/types/${H.state.wid}/specification/${key}" aria-selected="${(H.state.route.split('?')[0].split('/')[4]||'content')===key}">${label}</a>`).join('')}</div>`:''}</div><div id="stage" class="study-stage type-data-stage">${id==='standard-check'?standardPage():specificationPage()}</div><div class="study-checkbar"><strong>校核项</strong><span class="subtle">标准符合性未判定 · 型号尚未发布</span></div></section><aside class="study-inspector is-collapsed"><div class="study-inspector-rail">属性</div></aside></div>`;
  }
  async function derive(){
    if(H.state.busy)return;if(H.state.dirty)await H.save();if(H.state.dirty)throw new Error('型号修改尚未保存，未创建推导。');
    H.state.methods=await H.api('/methods');
    const m=entry();if(!m)throw new Error('没有支持当前领域结构的几何插件。');const cap=m.capabilities.find(c=>c.analysis==='geometry'&&c.input_schema==='cablesim.domain/1'),f=F();
    H.state.busy=true;H.renderHeader();try{
      const s=await H.api(`/workspaces/${H.state.wid}/studies`,{method:'POST',body:JSON.stringify({title:H.type().label+' · 外径与单位长度用料',input_source:'domain',method:{...m.method,capability:cap.id},parameters:{cable_type_id:H.type().id,length_m:.1},expected_revision:H.state.record.revision})});
      const root=`/workspaces/${H.state.wid}/studies/${s.id}`,p=await H.api(root+`/preflight?expected_revision=${H.state.record.revision}&expected_study_revision=${s.revision}`);f.study=s;f.preflight=p;
      H.openDialog('结构推导前预检',`<p>${p.ready?'当前保存结构可运行。':'当前结构不能运行。'}</p>${p.cases.map(c=>`<p>${E(c.status==='succeeded'?'输入检查通过':c.error?.message||c.status)}</p>`).join('')}<h3>几何插件适用范围</h3><ul>${p.limitations.map(v=>'<li>'+E(v)+'</li>').join('')}</ul><p class="subtle">只推导这根电缆；计算段长 100 mm。理论单位长度用料由插件输出，密度与构造缺项保持不可用。</p>${p.ready?'<label class="amp-ack"><input id="type-scope-ack" type="checkbox">已核对保存输入与适用范围</label>':''}`,p.ready?B('确认并更新推导','run/run','execute','class="run-button" disabled'):H.button('返回修正','','close'));
    }finally{H.state.busy=false;H.renderHeader();if(H.state.view==='quantities'&&!f.pending)renderDerived();}
  }
  async function execute(){
    const f=F();if(H.state.busy||!f.preflight?.ready||!H.$('#type-scope-ack')?.checked)return;H.$('#modal').close();H.state.busy=true;f.pending=true;H.renderWorkspace();
    try{const s=f.study,p=f.preflight;f.run=await H.api(`/workspaces/${H.state.wid}/studies/${s.id}/runs`,{method:'POST',body:JSON.stringify({request_id:crypto.randomUUID(),expected_revision:H.state.record.revision,expected_study_revision:s.revision,lock_digest:p.lock_digest,scope_acknowledged:true})});if(f.run.status!=='succeeded')throw new Error(f.run.error?.message||f.run.output?.cases[0]?.error?.message||'结构推导未取得有效结果');await H.loadWorkspace(H.state.wid);bindRuns();H.notify('已更新保存的外径与单位长度用料');}finally{f.pending=false;H.state.busy=false;H.renderWorkspace();}
  }
  async function report(){
    const f=F();if(!current())throw new Error('请更新当前保存输入的结构推导。');H.state.busy=true;H.renderHeader();
    try{const created=await H.api(`/design/workspaces/${H.state.wid}/deliveries`,{method:'POST',body:JSON.stringify({run_ids:[f.run.id]})});f.delivery=await H.api(`/workspaces/${H.state.wid}/deliveries/${created.id}`);localStorage.setItem('csp-type-delivery:'+H.state.wid,JSON.stringify({id:f.delivery.id,run_id:f.run.id}));location.hash=`/types/${H.state.wid}/specification/preview`;}finally{H.state.busy=false;H.renderHeader();}
  }
  async function newType(){
    const models=await H.api('/design/cable-models');
    H.openDialog('新建型号草稿',`<p>从明确型号版本复制独立草稿；原库版本不改变，保存不发布。</p><label class="amp-task-change">型号版本<select id="type-new-version">${models.slice().reverse().map(m=>`<option value="${m.id}">${E(m.name)} · ${m.version}</option>`).join('')}</select></label><p class="subtle amp-inline-note">尺寸、物性与制造参数仍按该版本标记的来源核对。</p>`,B('建立型号草稿','','create','class="primary"'));F().newModels=models;
  }
  async function action(name){
    const key=name.slice(5);if(key==='new'){await newType();return;}if(key==='derive'){await derive();return;}if(key==='execute'){await execute();return;}if(key==='report'){await report();return;}
    if(key==='create'){const models=F().newModels,m=models.find(m=>m.id===H.$('#type-new-version').value),created=await H.api('/design/type-workspaces',{method:'POST',body:JSON.stringify({model_id:m.id,content_sha256:m.content_sha256})});H.$('#modal').close();location.hash=`/types/${created.id}/structure/table`;}
  }
  document.addEventListener('change',event=>{if(event.target.id==='type-scope-ack')document.querySelector('[data-action="type-execute"]').disabled=!event.target.checked;});
  return {init:h=>H=h,rail,tabs,bindRuns,restoreDelivery,invalidate,renderDerived,renderModule,action,checks,resultStatus,handles:()=>['standard-check','specification'].includes(moduleId())};
})();
