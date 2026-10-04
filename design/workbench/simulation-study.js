'use strict';
window.SimulationStudy=(()=>{
  let H,loaded=null,draft=null,snapshot=null,runs=[],current=null,reference=null,busy=false,error='',tab='results',historyOpen=false,selected=-1,undo=[],request=null,preflight=null,invalid={};
  const isSimulation=s=>s?.definition?.method_input?.schema_version==='cablesim.simulation-problem/1';
  const handles=path=>path==='/simulation'||isSimulation(H?.state.studies.find(s=>s.id===path.split('/')[2]));
  const E=v=>H.esc(v),B=(label,id,attrs='')=>`<button data-simulation-action="${id}" ${attrs}>${E(label)}</button>`;
  const dirty=()=>!!draft&&(Object.keys(invalid).length>0||JSON.stringify(draft)!==JSON.stringify(loaded.definition));
  const root=()=>`/workspaces/${loaded.workspace}/studies/${loaded.id}`;
  const intact=r=>r?.integrity==='verified';
  const bundle=r=>intact(r)?r.output?.cases?.[0]?.artifacts?.['x-cablesim.simulation-bundle']:null;
  const report=r=>intact(r)?r.output?.cases?.[0]?.artifacts?.['x-cablesim.reproduction-report']:null;
  let referenceCheck=null,referenceSelection=0;
  const normalizedHashes=new Map();
  function stableJson(value){if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')+'}';return JSON.stringify(value);}
  async function normalizedHash(run){
    if(normalizedHashes.has(run.id))return normalizedHashes.get(run.id);
    const problem=bundle(run)?.problem;if(problem?.schema_version!=='cablesim.simulation-problem/1')throw new Error('运行缺少完整统一输入，不能建立参考比较。');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(problem)));
    const value=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');normalizedHashes.set(run.id,value);return value;
  }
  async function selectReference(id){
    const selection=++referenceSelection,next=runs.find(r=>r.id===id)||null,active=current;
    if(!next){reference=null;referenceCheck=null;render();return;}
    const hashes=await Promise.all([normalizedHash(active),normalizedHash(next)]);if(current!==active||selection!==referenceSelection)return;
    reference=next;referenceCheck={format:'sorted-json-browser/1',calculated_run_id:active.id,reference_run_id:next.id,calculated_problem_sha256:hashes[0],reference_problem_sha256:hashes[1],same_problem:hashes[0]===hashes[1]};render();
  }
  const status=s=>({succeeded:'已完成',failed:'失败',partial:'部分完成',queued:'排队中',running:'运行中',matched:'在容差内',outside_tolerance:'超出容差',not_comparable:'不可直接比较',missing_reference:'缺少参考值',incomplete:'待核对'})[s]||s||'未运行';
  const num=v=>Number.isFinite(v)?Number(v.toPrecision(7)).toLocaleString('en-US',{maximumSignificantDigits:7,useGrouping:false}):'—';
  const displayUnit=u=>({'ohm/m':['μΩ/m',1e6],T:['μT',1e6],'A/m^2':['kA/m²',.001]})[u]||[u,1];
  const quantityName=t=>({series_resistance_ohm_m:'回路交流电阻',current_rms_a:'电流有效值',magnetic_flux_density_rms:'磁通密度有效值',current_density_rms:'电流密度有效值',maximum_temperature_k:'最高温度',joule_loss_w_m:'焦耳损耗'})[t.quantity]||t.quantity;
  const at=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o);
  const put=(o,p,v)=>{const a=p.split('.'),k=a.pop();a.reduce((v,k)=>v[k],o)[k]=v;};
  const remember=()=>{undo.push(structuredClone(draft));if(undo.length>40)undo.shift();preflight=null;request=null;};
  async function records(){let cursor=0,all=[];do{const page=await H.api(root()+`/runs?after=${cursor}`);all.push(...page.items);cursor=page.next_cursor;}while(cursor!==null);runs=all.reverse();}
  async function route(path){
    if(path==='/simulation'){loaded=null;draft=null;current=null;return;}
    const id=path.split('/')[2];tab=['results','inputs','evidence'].includes(path.split('/')[4])?path.split('/')[4]:'results';
    if(loaded?.id===id)return;
    busy=true;error='';H.$('#workspace').innerHTML='<div class="empty" role="status">正在读取仿真研究…</div>';
    try{const item=H.state.studies.find(s=>s.id===id);loaded=structuredClone(item);draft=structuredClone(loaded.definition);snapshot=await H.api('/workspaces/'+loaded.workspace);undo=[];request=null;preflight=null;reference=null;selected=-1;await records();current=runs[0]||null;}
    catch(e){loaded=null;draft=null;snapshot=null;runs=[];current=null;error=e.message;}finally{busy=false;}
  }
  const href=t=>`#/studies/${loaded.id}/simulation/${t}`;
  function errorView(){return error?`<div class="simulation-error" role="alert">${E(error)} ${B('关闭','dismiss')}</div>`:'';}
  function render(){
    if(!loaded){
      H.$('#workspace').innerHTML=`<div class="page simulation-list"><div class="list-head"><h2>仿真复现</h2>${B('导入算例','import','class="primary"')}</div>${errorView()}${H.state.studies.filter(isSimulation).map(s=>`<div class="list-row"><div class="row-title"><strong>${E(s.definition.title)}</strong><small>${E(s.definition.method.plugin_id)} · ${E(s.definition.method.version)}</small></div><a href="#/studies/${s.id}/simulation/results">打开研究</a></div>`).join('')||'<div class="empty"><h3>还没有仿真研究</h3><p>导入包含 SI 输入、网格设置和来源的算例 JSON。</p></div>'}</div>`;return;
    }
    const historical=current&&(!intact(current)||current.freshness!=='current'||current.snapshot?.study_revision!==loaded.revision||dirty());
    H.$('#header').innerHTML=`<span class="pill">研究</span><div class="title-wrap"><h1>${E(draft.title)}</h1></div><span class="spacer"></span><span class="simulation-state" role="status">${busy?'计算中':dirty()?'草稿 · 未保存':historical?'历史结果':'已保存'}</span>${B('撤销','undo',`title="Ctrl+Z" ${!undo.length||busy?'disabled':''}`)}${B('保存','save',`title="Ctrl+S" ${!dirty()||busy?'disabled':''}`)}${B('运行记录','history')}${B(busy?'计算中…':'预检并运行','preflight',`class="primary" ${busy||request?'disabled':''}`)}`;
    H.$('#workspace').innerHTML=`<div class="simulation-workspace"><nav class="module-rail" aria-label="仿真研究"><a class="module-row" href="#/simulation">${H.icon('nav/study')}全部复现</a><a class="module-row active" href="${href('results')}">${H.icon('module/method-compare')}方法对比</a><div class="simulation-method">${E(draft.method.plugin_id==='cablesim.comsol-bridge'?'COMSOL 参考对照':'开源仿真')}<br>${E(draft.method.version)}</div></nav><section class="simulation-main"><div class="study-tabbar"><h2>方法对比</h2><nav class="simulation-tabs" aria-label="仿真页签">${[['results','结果差异'],['inputs','输入与网格'],['evidence','验证证据']].map(([id,label])=>`<a href="${href(id)}" ${tab===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav></div>${errorView()}<div class="simulation-content" aria-busy="${busy}">${busy?'<div class="empty" role="status"><h3>正在计算</h3><p>使用已保存输入；请保持页面打开。重复点击不会创建另一项运行。</p></div>':tab==='inputs'?inputs():tab==='evidence'?evidence():results(historical)}</div></section>${historyOpen?historyPanel():''}</div>`;
    H.$('#status').innerHTML=`<span>仿真复现 · ${E(status(current?.status))}</span><span>研究 r${loaded.revision}</span><span class="spacer"></span><span>数值对照 · 未作工程批准</span>`;
  }
  function inputs(){
    const rows=[];
    const walk=(value,path,unit)=>{if(typeof value==='number')rows.push(`<tr><td><label for="sim-${E(path)}" title="${E(path)}">${E(fieldLabel(path))}</label></td><td><input id="sim-${E(path)}" data-simulation-field="${E(path)}" type="number" step="any" value="${E(invalid[path]??value)}" ${Object.hasOwn(invalid,path)?'aria-invalid="true"':''} ${request?'disabled':''} aria-describedby="sim-unit-${rows.length}"></td><td id="sim-unit-${rows.length}">${E(unit)}</td></tr>`);else if(Array.isArray(value))value.forEach((v,i)=>walk(v,path+'.'+i,unit));};
    walk(draft.method_input.frequency_hz,'method_input.frequency_hz','Hz');
    draft.method_input.geometry.forEach((g,i)=>{walk(g.values,`method_input.geometry.${i}.values`,'m');for(const [k,v]of Object.entries(g.material))if(typeof v==='number')walk(v,`method_input.geometry.${i}.material.${k}`,({conductivity_s_m:'S/m',relative_permeability:'1',relative_permeability_loss:'1',k_w_m_k:'W/(m·K)',heat_capacity_j_m3_k:'J/(m³·K)'})[k]||'1');});
    draft.method_input.excitations.forEach((e,i)=>walk(e.value,`method_input.excitations.${i}.value`,({current_rms_a:'A RMS',heat_w_m:'W/m',voltage_gradient_v_m:'V/m RMS'})[e.kind]));
    for(const [k,v]of Object.entries(draft.parameters.mesh||{}))walk(v,'parameters.mesh.'+k,k.endsWith('_m')?'m':'1');
    const methods=H.state.methods.flatMap(m=>m.capabilities.filter(c=>c.input_schema==='cablesim.simulation-problem/1'&&((draft.method_input.physics==='magnetic_harmonic'&&['getdp-eddy','magnetic-reference'].includes(c.id))||(draft.method_input.physics==='steady_heat'&&['elmer-heat','thermal-reference'].includes(c.id))||(draft.method_input.physics==='transient_heat'&&c.id==='elmer-heat'))).map(c=>({method:{...m.method,capability:c.id},title:c.title})));
    const available=methods.find(m=>m.method.plugin_id===draft.method.plugin_id&&m.method.capability===draft.method.capability);
    return `<div class="simulation-settings"><label>研究名称<input data-simulation-title value="${E(draft.title)}" maxlength="120" ${request?'disabled':''}></label><label>求解方法<select data-simulation-method ${request?'disabled':''}>${methods.map((m,i)=>`<option value="${i}" data-method="${E(JSON.stringify(m.method))}" ${m.method.plugin_id===draft.method.plugin_id&&m.method.capability===draft.method.capability?'selected':''}>${E(m.title)}</option>`).join('')}</select></label>${available&&available.method.release_digest!==draft.method.release_digest?B('更新方法版本','refresh-method',request?'disabled':''):''}</div><div class="simulation-table-scroll"><table class="study-table"><thead><tr><th>输入字段</th><th>数值</th><th>单位</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><details><summary>完整输入与来源</summary><pre>${E(JSON.stringify(draft.method_input,null,2))}</pre></details>`;
  }
  function results(historical){
    if(!current)return '<div class="empty"><h3>尚无计算结果</h3><p>核对输入与网格后，预检并运行。</p></div>';
    if(!intact(current))return '<div class="empty" role="alert"><h3>运行记录完整性校验失败</h3><p>未显示该记录的输入或数值。请在运行记录中选择其他完整记录。</p></div>';
    const r=report(current),b=bundle(current),failure=current.output?.cases?.find(c=>c.status!=='succeeded');
    if(!r)return `<div class="empty"><h3>${E(status(current.status))}</h3><p>${E(failure?.error?.message||current.error?.message||'本次运行没有可显示的复现报告。')}</p></div>`;
    const ref=bundle(reference),compatible=ref&&referenceCheck?.calculated_run_id===current.id&&referenceCheck?.reference_run_id===reference.id&&referenceCheck.same_problem;
    const find=t=>compatible?ref.observations.find(o=>['quantity','entity','unit','probe_index','time_s'].every(k=>o[k]===t[k]))?.value:undefined;
    const rs=r.rows||[];
    return `<div class="simulation-resultbar"><span>${historical?'历史输入 · ':''}${E(status(r.status))}</span><span class="spacer"></span><label>参考求解器<select data-simulation-reference><option value="">选择已保存 COMSOL 运行</option>${runs.filter(v=>bundle(v)?.result.solver.name==='comsol'&&v.id!==current.id).map(v=>`<option value="${E(v.id)}" ${reference?.id===v.id?'selected':''}>${E(new Date(v.created).toLocaleString())} · ${E(bundle(v).result.solver.version)}</option>`).join('')}</select></label>${B('导出报告','export')}</div>${ref&&!compatible?'<p class="simulation-warning">参考运行的物理输入哈希不同；未计算跨输入偏差。</p>':''}${rs.length?`<div class="simulation-table-scroll"><table class="study-table simulation-results"><thead><tr><th>物理量 / 对象</th><th>文献参考</th><th>${E(b?.result.solver.name||'本次计算')}</th><th>参考求解器 · COMSOL</th><th>与文献偏差</th><th>单位</th><th>状态</th></tr></thead><tbody>${rs.map((t,i)=>`<tr><td>${B(quantityName(t),'row-'+i,`class="quiet" aria-expanded="${selected===i}"`) }<small>${E(t.entity)}${t.time_s!=null?' · '+E(t.time_s)+' s':''}${t.probe_index!=null?' · 测点 '+(t.probe_index+1):''}</small></td><td>${num(t.reference==null?null:t.reference*displayUnit(t.unit)[1])}</td><td>${num(t.calculated==null?null:t.calculated*displayUnit(t.unit)[1])}</td><td>${num(find(t)==null?null:find(t)*displayUnit(t.unit)[1])}</td><td>${num(t.difference==null?null:t.difference*displayUnit(t.unit)[1])}</td><td>${E(displayUnit(t.unit)[0])}</td><td class="simulation-${t.status==='matched'?'ok':'review'}">${E(status(t.status))}</td></tr>${selected===i?`<tr><td colspan="7"><div class="simulation-row-detail"><strong>来源与容差</strong><pre>${E(JSON.stringify({source:t.source,tolerance:t.tolerance,reason:t.reason,reference_solver:compatible?ref.result.solver:null,solver_difference:Number.isFinite(find(t))?t.calculated-find(t):null},null,2))}</pre></div></td></tr>`:''}`).join('')}</tbody></table></div>`:'<div class="empty"><h3>计算完成，尚无文献对照项</h3><p>结果与模型来源保存在验证证据中。</p></div>'}`;
  }
  function evidence(){const b=bundle(current);return b?`<h3>本次运行</h3><dl class="simulation-evidence">${[['求解器',b.result.solver.name+' '+b.result.solver.version],['插件',current.snapshot.definition.method.plugin_id+' '+current.snapshot.definition.method.version],['输入 SHA256',b.evidence.problem_sha256],['网格 SHA256',b.evidence.mesh_sha256],['模型 SHA256',b.result.solver.model_sha256||'开源结果未产生 MPH 模型'],['模块',Object.keys(b.result.solver.modules||{}).join('、')||'见求解器记录']].map(([k,v])=>`<dt>${E(k)}</dt><dd>${E(v)}</dd>`).join('')}</dl><details><summary>输入假设</summary><pre>${E(JSON.stringify(b.problem.assumptions,null,2))}</pre></details>`:'<div class="empty">保存并运行后显示版本、输入、网格与模型追溯记录。</div>';}
  function historyPanel(){return `<aside class="simulation-history" aria-label="运行记录"><div class="list-head"><h3>运行记录</h3>${B('关闭','history')}</div>${runs.length?runs.map(v=>`<button class="simulation-run" data-simulation-action="run-${E(v.id)}" ${busy?'disabled':''}><strong>${E(new Date(v.created).toLocaleString())}</strong><span>${E(intact(v)?status(v.status):"记录损坏")} · ${E(v.snapshot?.definition?.method?.plugin_id||"方法信息不可读取")}</span><small>研究 r${E(v.snapshot?.study_revision??"—")}</small></button>`).join(''):'<p>还没有保存的运行。</p>'}</aside>`;}
  async function save(){if(busy||request||!dirty())return;if(Object.keys(invalid).length){error=fieldLabel(Object.keys(invalid)[0])+'：请修正无效数值后保存。';tab='inputs';render();document.getElementById('sim-'+Object.keys(invalid)[0])?.focus();return;}busy=true;error='';render();try{loaded=await H.api(root(),{method:'PUT',body:JSON.stringify({...draft,expected_revision:snapshot.revision,expected_study_revision:loaded.revision})});draft=structuredClone(loaded.definition);await H.refreshLists();preflight=null;request=null;}catch(e){error=e.message;}finally{busy=false;render();}}
  async function action(id){
    if(id==='dismiss'){error='';render();return;}if(id==='history'){historyOpen=!historyOpen;render();return;}
    if(id.startsWith('row-')){selected=selected===+id.slice(4)?-1:+id.slice(4);render();return;}
    if(id==='export'){
      const r=structuredClone(report(current));if(!r)return;
      if(reference){
        const ref=bundle(reference),same=referenceCheck?.same_problem&&referenceCheck.calculated_run_id===current.id&&referenceCheck.reference_run_id===reference.id;
        r.reference_solver={name:'COMSOL',run_id:reference.id,solver:ref.result.solver,source_problem_sha256:ref.evidence.problem_sha256,normalized_comparison:referenceCheck,observations:ref.observations};
        r.rows=r.rows.map(t=>{const matches=ref.observations.filter(o=>['quantity','entity','unit','probe_index','time_s'].every(k=>o[k]===t[k])),value=same&&matches.length===1?matches[0].value:null;return {...t,reference_solver:'COMSOL',reference_solver_value:value,difference_from_reference_solver:value!=null&&t.calculated!=null?t.calculated-value:null,solver_comparison_status:value!=null?'same_problem':'not_comparable'};});
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='simulation-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    if(busy)return;
    if(id==='undo'){if(request)return;if(Object.keys(invalid).length){invalid={};error='';}else if(undo.length){draft=undo.pop();preflight=null;request=null;}render();return;}
    if(id==='save')return save();
    if(id==='refresh-method'){if(request)return;const method=H.state.methods.find(m=>m.method.plugin_id===draft.method.plugin_id);if(!method)throw new Error('方法当前不可用，请刷新插件列表。');remember();draft.method={...method.method,capability:draft.method.capability};render();return;}
    if(id.startsWith('run-')){current=runs.find(r=>r.id===id.slice(4));reference=null;referenceCheck=null;selected=-1;historyOpen=false;tab='results';location.hash=href('results').slice(1);render();return;}
    if(id==='import'){H.openDialog('导入仿真算例',`<label>保存到工作区<select id="simulation-workspace">${H.state.workspaces.map(w=>`<option value="${E(w.id)}">${E(w.name)}</option>`).join('')}</select></label><label>算例 JSON<input id="simulation-file" type="file" accept=".json,application/json"></label><p>包含 input、parameters、citation 和 targets；默认使用开源求解器。</p><p id="simulation-import-error" role="alert"></p>`);return;}
    if(id==='preflight'){
      if(request)return;if(dirty())await save();if(dirty())return;busy=true;error='';render();
      try{preflight=await H.api(root()+`/preflight?expected_revision=${snapshot.revision}&expected_study_revision=${loaded.revision}`);if(!preflight.ready)throw new Error(preflight.cases.find(c=>c.status!=='succeeded')?.error?.message||'预检未通过。');H.openDialog('确认仿真范围',`<ul>${preflight.limitations.map(v=>`<li>${E(v)}</li>`).join('')}</ul><label><input id="simulation-ack" type="checkbox">已核对输入和适用范围</label>`,B('确认并运行','execute','class="primary" disabled'));}
      catch(e){error=e.message;tab='inputs';}finally{busy=false;render();}return;
    }
    if(id==='execute'){
      if(!preflight?.ready||!H.$('#simulation-ack')?.checked||request)return;
      request={request_id:crypto.randomUUID(),expected_revision:snapshot.revision,expected_study_revision:loaded.revision,lock_digest:preflight.lock_digest,scope_acknowledged:true};H.$('#modal').close();return execute();
    }
    if(id==='retry')return execute();
  }
  async function execute(){
    if(busy||!request)return;busy=true;error='';render();
    try{current=await H.api(root()+'/runs',{method:'POST',body:JSON.stringify(request)});await records();request=null;preflight=null;tab='results';}
    catch(e){if(e.status>=400&&e.status<500&&e.status!==408){request=null;preflight=null;tab='inputs';error=e.message+'。请修正输入或版本后重新预检。';}else error=e.message+'。请求标识已保留，可重试获取同一次运行。';}
    finally{busy=false;if(!request)location.hash=href(tab).slice(1);render();if(request)H.$('.simulation-error').insertAdjacentHTML('beforeend',B('重试同一次运行','retry'));}
  }
  async function importFile(file){
    if(busy||!file)return;if(file.size>2*1024*1024)throw new Error('算例 JSON 应小于 2 MiB。');
    const f=JSON.parse(await file.text());if(f.input?.schema_version!=='cablesim.simulation-problem/1'||!f.parameters?.mesh||!f.citation?.title)throw new Error('算例缺少 input、parameters.mesh 或 citation.title。');
    const id=f.input.physics==='magnetic_harmonic'?'getdp-eddy':'elmer-heat',method=H.state.methods.find(m=>m.method.plugin_id==='cablesim.simulation');if(!method?.capabilities.some(c=>c.id===id))throw new Error('开源仿真方法不可用，请核对插件封签。');
    const workspace=H.state.workspaces.find(w=>w.id===H.$('#simulation-workspace')?.value);if(!workspace)throw new Error('请先建立一个工程工作区，再导入仿真研究。');
    busy=true;try{const w=await H.api('/workspaces/'+workspace.id),definition={title:f.citation.title.slice(0,120),method:{...method.method,capability:id},input_source:'study',method_input:f.input,parameters:{...f.parameters,reproduction:{citation:f.citation,targets:f.targets||[],scope:f.scope,frozen_inputs:f.frozen_inputs||[]}},input_sources:{},driver:{kind:'single'},crosschecks:[],expected_revision:w.revision};const s=await H.api(`/workspaces/${w.id}/studies`,{method:'POST',body:JSON.stringify(definition)});await H.refreshLists();H.$('#modal').close();location.hash=`/studies/${s.id}/simulation/inputs`;}finally{busy=false;}
  }
  function keydown(e){if(!handles(H.state.route))return false;const mod=e.ctrlKey||e.metaKey;if(e.key==='Escape'){if(H.$('#modal').open)H.$('#modal').close();else{historyOpen=false;selected=-1;render();}e.preventDefault();return true;}if(mod&&['s','z'].includes(e.key.toLowerCase())){e.preventDefault();document.activeElement?.blur();action(e.key.toLowerCase()==='s'?'save':'undo').catch(showError);return true;}if(e.key==='Enter'&&e.target.matches('input:not([type=checkbox])')){e.preventDefault();e.target.blur();return true;}return false;}
  function showError(e){const field=H.$('#simulation-import-error');if(H.$('#modal').open&&field){field.textContent=e.message;return;}error=e.message;render();}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-simulation-action]');if(b)action(b.dataset.simulationAction).catch(showError);});
  function fieldLabel(path){const a=path.split('.'),key=a.at(-1),names={frequency_hz:'频率',conductivity_s_m:'电导率',relative_permeability:'相对磁导率（实部）',relative_permeability_loss:'相对磁导率（损耗部）',k_w_m_k:'热导率',heat_capacity_j_m3_k:'体积热容',size_m:'近场网格尺寸',far_size_m:'远场网格尺寸',transition_m:'过渡距离',max_nodes:'节点上限',field_order:'场单元阶次'};if(a[1]==='geometry'){const g=draft.method_input.geometry[+a[2]];return g.uid+' · '+(names[key]||(['x','z',g.kind==='disk'?'半径':'x 上界','z 上界'][+key]));}if(a[1]==='excitations'){const ex=draft.method_input.excitations[+a[2]];return ex.regions.join('、')+' · '+(key==='0'?'激励实部':'激励虚部');}return names[key]||path.replace('parameters.mesh.','');}
  function invalidNumber(path,value){if(!Number.isFinite(value))return true;const key=path.split('.').at(-1);if(['conductivity_s_m','relative_permeability_loss'].includes(key))return value<0;if(['frequency_hz','relative_permeability','k_w_m_k','heat_capacity_j_m3_k','size_m','far_size_m','transition_m','probe_cell_size_m','exterior_growth_start_m'].includes(key))return value<=0;if(key==='max_nodes')return !Number.isInteger(value)||value<100||value>120000;if(key==='field_order')return ![1,2].includes(value);const m=path.match(/geometry\.(\d+)\.values\.2$/);return !!(m&&draft.method_input.geometry[+m[1]].kind==='disk'&&value<=0);}
  document.addEventListener('change',e=>{const el=e.target;if(el.id==='simulation-file'){importFile(el.files[0]).catch(showError);return;}if(el.id==='simulation-ack'){H.$('[data-simulation-action=execute]').disabled=!el.checked;return;}if(!loaded||busy||request)return;if(el.dataset.simulationField){const path=el.dataset.simulationField,v=Number(el.value);if(el.value===''||invalidNumber(path,v)){invalid[path]=el.value;error=fieldLabel(path)+'：请输入适用范围内的有限数值，核对本行单位。';render();document.getElementById('sim-'+path)?.focus();return;}remember();delete invalid[path];error='';put(draft,path,v);}else if(el.hasAttribute('data-simulation-title')){remember();draft.title=el.value;}else if(el.hasAttribute('data-simulation-method')){remember();draft.method=JSON.parse(el.selectedOptions[0].dataset.method);}else if(el.hasAttribute('data-simulation-reference')){selectReference(el.value).catch(showError);return;}else return;render();});
  return {init:h=>H=h,handles,route,render,dirty,isBusy:()=>busy||!!request,keydown,sameStudyRoute:(a,b)=>a.split('/')[2]===b.split('/')[2]&&handles(a)&&handles(b)};
})();
