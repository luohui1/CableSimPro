'use strict';
// Type pages reuse immutable host runs; publication belongs to TypeVersions.
window.TypeWorkflow=(()=>{
  let H;
  const cache=new Map();
  const E=v=>H.esc(v),N=(v,n=1)=>Number.isFinite(v)?H.groupNumber(v.toFixed(n)):'未输出';
  const B=(label,icon,action,attrs='')=>H.button(label,icon,'type-'+action,attrs);
  const moduleId=()=>H.state.route.split('?')[0].split('/')[3]||'structure';
  const F=()=>{if(!cache.has(H.state.wid))cache.set(H.state.wid,{run:null,study:null,preflight:null,pending:false});return cache.get(H.state.wid);};
  const entry=()=>H.state.methods.find(m=>m.capabilities.some(c=>c.analysis==='geometry'&&c.input_schema==='cablesim.domain/1'));
  const model=r=>r?.output?.cases.find(c=>c.status==='succeeded')?.artifacts?.['x-cablesim.cad-model'];
  const current=()=>{const f=F(),r=f.run,m=entry();return !!model(r)&&r.integrity==='verified'&&r.freshness==='current'&&!H.state.dirty&&r.snapshot.workspace_revision===H.state.record.revision&&r.snapshot.definition.method.release_digest===m?.method.release_digest;};
  function bindRuns(){
    TypeStandards.bindRuns();
    TypeElectrical.bindRuns();
    TypeRating.bindRuns();
    const f=F(),runs=H.state.runs.filter(r=>r.snapshot.definition.method.plugin_id===entry()?.method.plugin_id&&model(r));
    runs.sort((a,b)=>new Date(b.created)-new Date(a.created));f.run=runs[0]||null;
  }
  function rail(){
    const id=moduleId(),root='#/types/'+H.state.wid;
    return `<div class="rail-caption">型号模块</div><a class="module-row ${id==='structure'?'active':''}" href="${root}/structure" ${id==='structure'?'aria-current="page"':''}>${H.icon('module/structure')}结构设计</a>${id==='structure'?'<div id="objects"></div>':''}<a class="module-row ${id==='requirements'?'active':''}" href="${root}/requirements">${H.icon('source/from-standard')}要求与标准</a><a class="module-row ${id==='standard-check'?'active':''}" href="${root}/standard-check">${H.icon('module/standard-check')}标准核对</a><a class="module-row ${id==='electrical'?'active':''}" href="${root}/electrical">${H.icon('module/electrical')}电气参数</a><a class="module-row ${id==='short-circuit'?'active':''}" href="${root}/short-circuit">${H.icon('module/short-circuit')}短路容量</a><a class="module-row ${id==='rating-table'?'active':''}" href="${root}/rating-table">${H.icon('module/rating-table')}载流量表</a><a class="module-row ${id==='specification'?'active':''}" href="${root}/specification/content">${H.icon('module/datasheet')}规格书</a><a class="module-row ${id==='comparison'?'active':''}" href="${root}/comparison/matrix">${H.icon('module/method-compare')}方案对比</a>${H.button('添加模块','module/add-module','modules','class="module-row"')}`;
  }
  function tabs(){return `<div class="study-tabs type-structure-tabs" role="tablist" aria-label="结构设计页签">${[['section','截面'],['three','三维'],['table','分层表'],['quantities','用料']].map(([key,label])=>`<a role="tab" aria-selected="${H.state.view===key}" href="#/types/${H.state.wid}/structure/${key}" tabindex="${H.state.view===key?0:-1}">${label}</a>`).join('')}</div>`;}
  function invalidate(){
    TypeVersions.invalidate();
    TypeStandards.invalidate();
    TypeElectrical.invalidate();
    TypeRating.invalidate();
    if(!H.state.wid)return;
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
      ['产品标准核对','GB/T 12706 / 11017 / 3956',TypeStandards.summary(),'查看标准核对模块']
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
  function renderModule(){
    if(TypeVersions.handles()){TypeVersions.render(rail());return;}
    if(TypeRating.handles()){TypeRating.render(rail());return;}
    if(TypeElectrical.handles()){TypeElectrical.render(rail());return;}
    if(['requirements','standard-check'].includes(moduleId())){TypeStandards.render(rail());return;}
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
  async function newType(){
    const [catalog,published]=await Promise.all([H.api('/design/cable-models'),H.api('/types/library')]);
    const models=[...catalog,...published.items.map(m=>({...m,published:true}))];
    H.openDialog('新建型号草稿',`<label class="amp-task-change">基于型号版本<select id="type-new-version">${models.slice().reverse().map(m=>`<option value="${m.id}">${E(TypeVersions.clean(m.name))} · ${m.version}${m.published?' · 已发布':''}</option>`).join('')}</select></label>`,B('建立型号草稿','','create','class="primary"'));F().newModels=models;
  }
  async function action(name){
    if(name.startsWith('type-version-'))return TypeVersions.action(name.slice(13));
    if(name.startsWith('type-rating-'))return TypeRating.action(name.slice(12));
    if(name.startsWith('type-measurement-'))return TypeMeasurements.action(name.slice(17));
    if(name.startsWith('type-electrical-'))return TypeElectrical.action(name.slice(16));
    if(name.startsWith('type-requirement-'))return TypeRequirements.action(name.slice(17));
    if(name.startsWith('type-standard-'))return TypeStandards.action(name.slice(14));
    const key=name.slice(5);if(key==='new'){await newType();return;}if(key==='derive'){await derive();return;}if(key==='execute'){await execute();return;}
    if(key==='create'){
      const m=F().newModels.find(m=>m.id===H.$('#type-new-version').value);if(H.state.busy)return;H.state.busy=true;
      try{let wid;if(m.published){const base=await H.api('/workspaces/'+m.workspace_id),created=await H.api(`/types/${m.workspace_id}/plans`,{method:'POST',body:JSON.stringify({expected_revision:base.revision,request_id:crypto.randomUUID(),name:'新版本方案'})});wid=created.workspace_id;}else{const created=await H.api('/design/type-workspaces',{method:'POST',body:JSON.stringify({model_id:m.id,content_sha256:m.content_sha256})});wid=created.id;}H.$('#modal').close();location.hash=`/types/${wid}/structure/table`;}
      finally{H.state.busy=false;}
    }
  }
  document.addEventListener('change',event=>{if(event.target.id==='type-scope-ack')document.querySelector('[data-action="type-execute"]').disabled=!event.target.checked;});
  return {init:h=>{H=h;TypeVersions.init(h);TypeStandards.init(h);TypeMeasurements.init(h);TypeElectrical.init(h);TypeRating.init(h);},rail,tabs,bindRuns,invalidate,renderDerived,renderModule,action,checks,resultStatus,handles:()=>['requirements','standard-check','specification','comparison','electrical','short-circuit','rating-table'].includes(moduleId())};
})();
