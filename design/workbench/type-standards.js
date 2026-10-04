'use strict';
// Presentation only. Requirements, arithmetic and verdicts come from the sealed plugin artifact.
window.TypeStandards=(()=>{
  let H;const cache=new Map(),labels={passed:'满足',failed:'不满足',missing:'待补数据',uncovered:'未覆盖'},basis={design:'设计值',measurement:'实测值',manufacturer_limit:'厂家声明上限',unknown:'性质未明确'};
  const pendingKey=()=> 'csp-standard-pending:'+H.state.wid;
  const F=()=>{if(!cache.has(H.state.wid)){const f={run:null,pending:false,error:null,selected:0,filter:'all',study:null,preflight:null,request:null};try{const saved=JSON.parse(sessionStorage.getItem(pendingKey())||'null');if(saved?.accepted&&saved.request?.request_id&&saved.study?.id){f.request=saved.request;f.study=saved.study;f.error='前次运行的连接未完成，可查询或重试同一请求。';}}catch{}cache.set(H.state.wid,f);}return cache.get(H.state.wid);};
  function clearRequest(){F().request=null;try{sessionStorage.removeItem(pendingKey());}catch{}}
  const entry=()=>H.state.methods.find(m=>m.capabilities.some(c=>c.analysis==='standard_check'&&c.input_schema==='cablesim.domain/1'));
  const artifact=r=>r?.output?.cases.find(c=>c.status==='succeeded')?.artifacts?.['x-cablesim.standard-check'];
  const current=()=>{const f=F(),m=entry(),r=f.run;return !!artifact(r)&&r.integrity==='verified'&&r.freshness==='current'&&!H.state.dirty&&r.snapshot.workspace_revision===H.state.record.revision&&r.snapshot.definition.method.release_digest===m?.method.release_digest;};
  function bindRuns(){const f=F(),runs=H.state.runs.filter(r=>artifact(r));runs.sort((a,b)=>new Date(b.created)-new Date(a.created));f.run=runs[0]||null;}
  const E=v=>H.esc(v),B=(label,action,attrs='')=>H.button(label,'','type-standard-'+action,attrs);
  function value(v,r,signed=false){if(!Number.isFinite(v))return '—';const percent=r.unit==='1'&&/率|偏差/.test(r.title),n=percent?v*100:v,digits=r.unit==='Ω/km'?4:percent?1:r.unit==='mm²'?2:2;return (signed&&n>0?'+':'')+H.groupNumber(Number(n.toFixed(digits)).toString())+' '+(percent?'%':r.unit==='1'?'':r.unit);}
  const requirement=r=>r.limit==null?'未确定':({'>=':'≥','<=':'≤','=':'='})[r.comparison]+' '+value(r.limit,r);
  function summary(){const f=F(),a=artifact(f.run);if(!a)return '尚未核对';return (current()?'当前结果':'历史结果')+' · '+(a.counts.failed?`${a.counts.failed} 项不满足`:'未完整判定');}
  function sourceDetail(r){const s=r.input_source;if(!s)return '查看结构字段的来源图标';const label={manufacturer:'厂家公开资料',user:'用户录入 / 核对条件',derived:'推导值',measurement:'测量记录',standard:'标准来源',demo:'演示假设',asset:'库引用'}[s.kind]||s.kind;return `<details><summary>${E(label)} · ${s.reviewed?'已人工核对':'待人工核对'}</summary><p>${E(s.reference||'未提供出处')}</p></details>`;}
  function rowDetail(r,index=F().selected){
    if(!r)return '<p class="empty">选择“依据”查看条款与输入来源。</p>';
    return `<div class="inspector-head"><h2>${E(r.title)}</h2><span class="standard-verdict ${r.verdict}">${labels[r.verdict]}</span></div><div class="inspector-section"><h3>条款依据</h3><p>${E(r.standard)}</p><p>${E(r.clause)}</p><p class="subtle">${r.printed_page==null?'页码未核验':`正文第 ${r.printed_page} 页 · PDF 第 ${r.pdf_page} 页`}</p>${r.formula?`<p class="standard-formula">${E(r.formula)}</p>`:''}<dl class="standard-detail">${Object.entries(r.formula_inputs||{}).map(([k,v])=>`<dt>${E(k)}</dt><dd class="number">${v==null?'未提供':E(v)}</dd>`).join('')}</dl></div><div class="inspector-section"><h3>输入与判定</h3><dl class="standard-detail"><dt>要求</dt><dd>${E(requirement(r))}</dd><dt>实际值</dt><dd class="number">${E(value(r.actual,r))}</dd><dt>余量</dt><dd class="number">${E(value(r.margin,r,true))}</dd><dt>数据性质</dt><dd>${E(basis[r.basis]||r.basis)}</dd><dt>来源</dt><dd>${sourceDetail(r)}</dd></dl>${r.reason?`<p class="standard-reason">${E(r.reason)}</p>`:''}${B('定位结构层','locate:'+index,'class="standard-locate"')}</div><div class="inspector-section"><details><summary>快照追溯</summary><p>输入修订 r${E(F().run.snapshot.workspace_revision)}</p>${F().run.snapshot.definition.input_sources?.requirements?'<p>'+E(F().run.snapshot.definition.input_sources.requirements.reference)+'</p>':''}<p>插件 ${E(F().run.snapshot.definition.method.plugin_id)} ${E(F().run.snapshot.definition.method.version)}</p><p class="standard-digest">原文 SHA-256 ${E(r.source_digest||'未取得')}</p><p class="standard-digest">输入 SHA-256 ${E(artifact(F().run).input_sha256)}</p><p class="standard-digest">运行 ${E(F().run.id)}</p></details></div>`;
  }
  function table(requirements=false){
    const f=F(),a=artifact(f.run);if(!a)return `<div class="study-empty"><h3>尚无标准核对快照</h3><p>保存型号后生成适用要求，并核对结构与实测数据。</p></div>`;
    const rows=a.rows.map((r,i)=>({r,i})).filter(({r})=>f.filter==='all'||r.verdict===f.filter);
    const headers=requirements?['要求','条款 / 页码','标准值','覆盖情况','依据']:['要求','标准值','实际值','余量','判定','依据'];
    return `<div class="standard-table-scroll"><table class="standard-table" aria-label="${requirements?'要求与标准表':'标准核对表'}"><thead><tr>${headers.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${rows.map(({r,i})=>`<tr data-action="type-standard-locate:${i}" tabindex="0" aria-label="${E(r.title)}，定位结构层" class="${i===f.selected?'selected':''}"><td><span>${E(r.title)}</span>${requirements?'':`<small>${E(r.standard.replace('GB/T ','')+' · '+r.clause)}</small>`}</td>${requirements?`<td>${E(r.clause)}<small>${r.printed_page==null?'页码未核验':'正文 '+r.printed_page+' / PDF '+r.pdf_page}</small></td><td class="number">${E(requirement(r))}</td><td>${r.verdict==='uncovered'?'未覆盖':'原文已核验'}</td>`:`<td class="number">${E(requirement(r))}</td><td class="number">${E(value(r.actual,r))}${r.actual!=null?`<small>${E(basis[r.basis]||r.basis)}</small>`:''}</td><td class="number">${E(value(r.margin,r,true))}</td><td><span class="standard-verdict ${r.verdict}">${labels[r.verdict]}</span></td>`}<td>${B('依据','row:'+i,'class="quiet standard-proof" aria-label="'+E(r.title)+'的依据"')}</td></tr>`).join('')||`<tr><td colspan="${headers.length}">没有此状态的要求。</td></tr>`}</tbody></table></div>`;
  }
  function requirementsSources(a){return a?`<div class="standard-source-list">${a.sources.map(s=>`<span title="${E(s.file_name+'；SHA-256 '+s.sha256)}">${E(s.standard)} · 原文已核验</span>`).join('')}</div>`:'';}
  function render(rail){
    if(H.state.route.split('/')[3]==='requirements'){TypeRequirements.render(rail);return;}
    const f=F(),a=artifact(f.run),requirements=H.state.route.split('/')[3]==='requirements',m=entry();
    if(f.selected>= (a?.rows.length||0))f.selected=0;
    const state=f.pending?'loading':f.error?'error':!a?'empty':current()?'success':'historical';
    H.$('#workspace').innerHTML=`<div class="work-area type-work-area type-standard-workspace" data-standard-state="${state}"><nav class="module-rail" aria-label="型号模块">${rail}</nav><section class="center"><div class="study-tabbar"><h2>${requirements?'要求与标准':'标准核对'}</h2><span class="spacer"></span>${B(f.request&&f.error?'重试此运行':H.state.dirty?'保存并核对':a?'更新核对':'生成要求并核对','prepare',`class="primary" ${H.state.busy||f.pending||!m?'disabled':''}`)}</div><div class="standard-content">${f.error?`<div class="standard-error" role="alert"><strong>核对未完成</strong><p>${E(f.error)}</p><span>已保存输入和既有快照仍保留。</span></div>`:''}${f.pending?'<div class="study-loading" role="status"><h3>正在核对保存输入</h3><p>完成后生成独立快照。</p><div class="study-skeleton"></div><div class="study-skeleton"></div></div>':`${requirementsSources(a)}<div class="standard-tools"><span id="standard-freshness" class="${a&&!current()?'warning':''}">${E(summary())}</span>${a?`<label>显示 <select id="standard-filter" aria-label="筛选要求状态">${[['all','全部要求'],['failed','不满足'],['missing','待补数据'],['uncovered','未覆盖'],['passed','满足']].map(([k,v])=>`<option value="${k}" ${f.filter===k?'selected':''}>${v}</option>`).join('')}</select></label>`:''}</div>${table(requirements)}`}</div><div class="study-checkbar"><span>${a?E(`${a.rows.length} 项要求 · ${a.counts.missing||0} 项待补数据 · ${a.counts.uncovered||0} 项未覆盖`):m?'适用范围按插件原文覆盖确定':'产品标准插件不可用'}</span><span class="spacer"></span><span title="结果不批准要求、型号或完整产品认证">${f.run?.snapshot.definition.input_sources?.requirements?.reviewed?'此运行含人工批准要求':'此运行未绑定批准要求'} · 型号未发布</span></div></section><aside class="inspector standard-inspector" aria-label="条款依据">${!f.pending&&a?rowDetail(a.rows[f.selected]):`<div class="inspector-head"><h2>核对范围</h2></div><div class="inspector-section"><p>${E(m?.name||'尚未发现标准插件')}</p><p class="subtle">${E(m?.capabilities.find(c=>c.analysis==='standard_check')?.limitations.join('；')||'刷新插件清单后重试。')}</p></div>`}</aside></div>`;
    if(requirements&&!f.pending)H.$('.standard-content').insertAdjacentHTML('afterbegin',`<div class="standard-rating" aria-label="型号额定参数">${H.field('U₀','cable_types.0.rating.u0',{scale:.001,unit:'kV'})}${H.field('U','cable_types.0.rating.u',{scale:.001,unit:'kV',nullable:true})}</div>`);
  }
  function invalidate(){TypeRequirements.invalidate();const el=H.$('#standard-freshness');if(el)el.textContent=summary();}
  function locate(index){
    const r=artifact(F().run)?.rows[index];if(!r)return;F().selected=index;
    const target=r.target,rows=H.entries(),i=target?.role?rows.findIndex(e=>e.role===target.role&&e.scope===target.scope&&(target.scope!=='core'||e.coreId===target.core_id)):-1;
    if(i<0){F().error=target?.role?'当前结构没有此层；核对快照保留原要求，请补充构造。':'此要求涉及尚未定义的层，请在结构设计中补充构造。';render(window.TypeWorkflow.rail());return;}
    H.state.selected=i;location.hash=`/types/${H.state.wid}/structure/table`;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{H.$(`.data-grid tbody tr[data-select="${i}"]`)?.scrollIntoView({block:'nearest'});H.$('#inspector input:not([readonly]),#inspector select:not([disabled])')?.focus();}));
  }
  async function prepare(){
    const f=F();if(H.state.busy||f.pending)return;if(f.request&&f.error&&!H.state.dirty&&f.request.expected_revision===H.state.record.revision){await execute();return;}if(f.request&&f.error)clearRequest();
    f.error=null;
    try{
      if(H.state.dirty)await H.save();if(H.state.dirty)throw new Error('请修正具体字段并保存；未保存输入不会参与核对。');
      H.state.busy=true;H.renderWorkspace();H.state.methods=await H.api('/methods');
      const m=entry();if(!m)throw new Error('产品标准插件不可用，请刷新插件清单。');const cap=m.capabilities.find(c=>c.analysis==='standard_check'),revision=H.state.record.revision;
      const approved=await TypeRequirements.approvedSource();
      const s=await H.api(`/workspaces/${H.state.wid}/studies`,{method:'POST',body:JSON.stringify({title:H.type().label+' · 产品标准核对',input_source:'domain',method:{...m.method,capability:cap.id},parameters:{cable_type_id:H.type().id},input_sources:approved?{requirements:approved}:{},expected_revision:revision})});
      f.study=s;f.preflight=await H.api(`/workspaces/${H.state.wid}/studies/${s.id}/preflight?expected_revision=${revision}&expected_study_revision=${s.revision}`);
      if(!f.preflight.ready)throw new Error(f.preflight.cases.filter(c=>c.status!=='succeeded').map(c=>c.error?.message||c.status).join('；'));
      f.request={request_id:crypto.randomUUID(),expected_revision:revision,expected_study_revision:s.revision,lock_digest:f.preflight.lock_digest,scope_acknowledged:true};
      H.openDialog('确认标准核对范围',`<p>核对保存输入 r${revision}；插件 ${E(m.name)} ${E(m.method.version)}。</p><ul>${f.preflight.limitations.map(v=>'<li>'+E(v)+'</li>').join('')}</ul><label class="amp-ack"><input id="standard-scope-ack" type="checkbox">已核对保存输入与覆盖范围</label>`,B('确认并核对','execute','class="primary" disabled'));
    }catch(error){f.error=error.message;f.request=null;H.log(error.message);}finally{H.state.busy=false;H.renderWorkspace();}
  }
  async function execute(){
    const f=F();if(H.state.busy||f.pending||!f.request)return;if(H.$('#modal').open&&!H.$('#standard-scope-ack')?.checked)return;H.$('#modal').close();try{sessionStorage.setItem(pendingKey(),JSON.stringify({request:f.request,study:{id:f.study.id,revision:f.study.revision},accepted:true}));}catch{}f.error=null;f.pending=true;H.state.busy=true;H.renderWorkspace();
    try{
      const result=await H.api(`/workspaces/${H.state.wid}/studies/${f.study.id}/runs`,{method:'POST',body:JSON.stringify(f.request)});
      if(['queued','running'].includes(result.status))throw new Error('同一请求仍在运行，请稍后查询；不会另建计算。');
      if(result.status!=='succeeded'||!artifact(result)){clearRequest();throw new Error(result.error?.message||result.output?.cases[0]?.error?.message||'插件未取得有效核对工件。');}
      f.run=result;clearRequest();await H.loadWorkspace(H.state.wid);bindRuns();H.notify('已保存标准核对快照');
    }catch(error){if(error.status>=400&&error.status<500)clearRequest();f.error=error.message;H.log(error.message);}finally{f.pending=false;H.state.busy=false;H.renderWorkspace();}
  }
  async function action(key){if(key==='prepare')return prepare();if(key==='execute')return execute();if(key.startsWith('locate:'))return locate(Number(key.slice(7)));if(key.startsWith('row:')){F().selected=Number(key.slice(4));render(window.TypeWorkflow.rail());}}
  function keydown(event){if(TypeRequirements.keydown(event))return true;if(H.$('#modal').open&&H.$('#standard-scope-ack')&&event.key==='Enter'&&H.$('#standard-scope-ack').checked){event.preventDefault();execute();return true;}if(event.key==='Enter'&&event.target.matches('[data-action^="type-standard-locate:"]')){event.preventDefault();locate(Number(event.target.dataset.action.split(':')[1]));return true;}return false;}
  document.addEventListener('change',event=>{if(!H)return;if(event.target.id==='standard-scope-ack')H.$('[data-action="type-standard-execute"]').disabled=!event.target.checked;if(event.target.id==='standard-filter'){F().filter=event.target.value;render(window.TypeWorkflow.rail());}});
  return {init:h=>{H=h;TypeRequirements.init(h,{run:()=>F().run,artifact:()=>artifact(F().run),current,state:F,generate:prepare,rowDetail,requirement});},bindRuns,render,invalidate,action,keydown,summary,current,artifact:()=>artifact(F().run)};
})();
