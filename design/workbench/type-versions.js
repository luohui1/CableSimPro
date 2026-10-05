'use strict';
window.TypeVersions=(()=>{
  let H;const cache=new Map();
  const E=v=>H.esc(v),B=(label,key,attrs='')=>H.button(label,'','type-version-'+key,attrs);
  const mod=()=>H.state.route.split('/')[3],tab=()=>H.state.route.split('/')[4]||(mod()==='comparison'?'matrix':'content');
  const names={draft:'草稿',version_draft:'版本草稿',submitted:'待人工审核',approved:'已批准',published:'已发布'};
  const clean=v=>String(v||'').replace(/\s*[·（(]\s*(?:资料核对|合成验收数据|(?:典型)?结构演示|演示)[^·）)]*[）)]?/g,'').replace(/^[ ·]+|[ ·]+$/g,'');
  const frozen=()=>H?.state.snapshot?.type_lifecycle?.status==='published';
  const unsaved=()=>H?.state.dirty||TypeElectrical.dirty()||TypeRating.dirty();
  function F(){const wid=H.state.wid;if(!cache.has(wid))cache.set(wid,{comparison:null,spec:null,pending:false,error:null,selected:null,overlay:false,signature:null});return cache.get(wid);}
  function signature(){return H.state.record.revision+':'+H.state.runs.map(r=>r.id+':'+r.freshness).join(',');}
  async function load(force=false){
    if(!handles())return;const f=F(),wid=H.state.wid,key=mod();if(!force&&f.signature===signature()&&(key==='comparison'?f.comparison:f.spec))return;
    if(f.pending)return;f.pending=true;f.error=null;render(TypeWorkflow.rail());
    try{const data=await H.api(`/types/${wid}/${key==='comparison'?'comparison':'specification'}`);if(H.state.wid!==wid)return;if(key==='comparison'){f.comparison=data;f.selected=data.items.some(p=>p.workspace===f.selected)?f.selected:wid;}else f.spec=data;f.signature=signature();}
    catch(error){f.error=error.message;H.log(error.message);}finally{f.pending=false;if(H.state.wid===wid&&handles()){render(TypeWorkflow.rail());H.renderHeader();}}
  }
  function table(headings,rows,label){return `<div class="version-table-scroll"><table class="study-table" aria-label="${E(label)}"><thead><tr>${headings.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
  function display(value,unit){if(value==null)return '—';const scale=unit==='m'?1000:unit==='A'&&mod()==='comparison'&&value>10000?.001:1;return H.groupNumber(Number((value*scale).toPrecision(4)).toString());}
  function unitLabel(unit,value){return unit==='m'?'mm':unit==='A'&&value>10000?'kA':unit;}
  const metricText=(key,v)=>key==='standards'&&v?.total!=null?v.value+' / '+v.total:key.startsWith('short_circuit/')?Number.isFinite(v?.value)?H.groupNumber((v.value*.001).toPrecision(3)):'—':display(v?.value,v?.unit);
  const metricUnit=(key,v)=>key.startsWith('short_circuit/')?'kA':unitLabel(v?.unit,v?.value);
  function plans(){return F().comparison?.items||[];}
  function headings(){return ['项目',...plans().map(p=>`<label class="version-plan-choice"><input type="radio" name="compare-plan" value="${E(p.workspace)}" ${F().selected===p.workspace?'checked':''}><strong>${E(p.name)}</strong><span>${E(names[p.status])} · r${p.revision}</span></label><a href="#/types/${p.workspace}/structure/table">打开方案</a>`)];}
  function matrix(){
    const ps=plans(),keys=[...new Set(['outer_diameter','mass','copper_mass',...ps.flatMap(p=>Object.keys(p.values))])];
    const titles={outer_diameter:'成品外径',mass:'用料',copper_mass:'导体用铜量'};
    const rows=keys.map(k=>{const first=ps[0]?.values[k];return `<tr><th>${E(titles[k]||first?.title||k)} <span class="subtle">${E(metricUnit(k,first)||'')}</span></th>${ps.map(p=>{const v=p.values[k];const diff=!!v&&v.value!==first?.value;return `<td class="number ${diff?'version-difference':''}" data-metric="${E(k)}" data-plan="${E(p.workspace)}">${metricText(k,v)}${v?.state==='historical'?'<span class="version-history">历史结果</span>':''}${v?.source?`<button class="version-evidence" data-action="type-version-evidence:${p.workspace}:${encodeURIComponent(k)}" aria-label="${E((titles[k]||k)+'来源')}">${H.icon('result/snapshot')}</button>`:''}</td>`;}).join('')}</tr>`;});
    const differences=keys.filter(k=>ps.some(p=>p.values[k]?.value!==ps[0]?.values[k]?.value));
    const numbers=differences.filter(k=>Number.isFinite(ps[0]?.values[k]?.value)&&Number.isFinite(ps[1]?.values[k]?.value)).map(k=>{const a=ps[0].values[k],b=ps[1].values[k],delta=b.value-a.value;return `${titles[k]||a.title||k} ${delta>=0?'+':''}${metricText(k,{value:delta,unit:a.unit})} ${metricUnit(k,a)}`;});
    return `<p class="version-conclusion">${numbers.length?E(ps[1].name+' 相对 '+ps[0].name+'：'+numbers.join('；')):ps.length<2?'建立第二个方案后比较差异。':'已有 '+ps.length+' 个方案，差异已高亮。'}</p>${table(headings(),rows,'方案结果矩阵')}`;
  }
  function flatten(node,path='',out={}){
    if(node===null||typeof node!=='object'){out[path]=node;return out;}
    if(Array.isArray(node)){node.forEach((v,i)=>flatten(v,path+'/'+(v?.id||v?.role||i),out));return out;}
    for(const[k,v]of Object.entries(node)){if(['provenance','label','name','id','schema_version'].includes(k))continue;flatten(v,path+'/'+k,out);}return out;
  }
  const fieldNames={thickness:'厚度 / m',diameter:'直径 / m',area:'面积 / m²',nominal_area:'标称面积 / m²',density:'密度 / kg·m⁻³',material:'材料',form:'构造',thermal_resistivity:'热阻率 / K·m·W⁻¹',x:'横向位置 / m',z:'纵向位置 / m'};
  function parameters(){
    const ps=plans(),maps=ps.map(p=>flatten({cable_types:p.document.cable_types,materials:p.document.materials})),keys=[...new Set(maps.flatMap(Object.keys))].filter(k=>maps.some(m=>JSON.stringify(m[k])!==JSON.stringify(maps[0][k])));
    if(!keys.length)return '<div class="study-empty"><h3>结构参数相同</h3><p>复制方案后在结构设计中调整厚度、材料或构造。</p></div>';
    return table(headings(),keys.map(k=>`<tr><th><span>${E(fieldNames[k.split('/').at(-1)]||k.split('/').at(-1))}</span><small>${E(k)}</small></th>${maps.map(m=>`<td class="number ${JSON.stringify(m[k])!==JSON.stringify(maps[0][k])?'version-difference':''}">${E(m[k]??'—')}</td>`).join('')}</tr>`),'方案参数差异');
  }
  function geometry(){
    const ps=plans();let outer=0;
    const rows=p=>{const t=p.document.cable_types[0],r=[];let envelope=0;for(const c of t.cores){let radius=c.conductor.diameter/2;r.push({x:c.x,z:c.z,radius,role:'conductor'});for(const l of c.layers){radius+=l.thickness;r.push({x:c.x,z:c.z,radius,role:l.role});}envelope=Math.max(envelope,Math.hypot(c.x,c.z)+radius);}let radius=envelope;for(const l of t.common_layers){radius+=l.thickness;r.push({x:0,z:0,radius,role:l.role,common:true});}outer=Math.max(outer,radius);return r;};
    const sets=ps.map(rows),scale=120/Math.max(outer,.001),colors=['copper','agent','success','attention'];
    function svg(i,overlay=false){const list=sets[i],ordered=[...list.filter(r=>r.common).reverse(),...ps[i].document.cable_types[0].cores.flatMap(c=>list.filter(r=>!r.common&&r.x===c.x&&r.z===c.z).reverse())];return ordered.map(r=>`<circle cx="${160+r.x*scale}" cy="${160-r.z*scale}" r="${r.radius*scale}" fill="${overlay?'none':'var(--'+({conductor:'conductor',insulation:'material-insulation',oversheath:'material-sheath',metallic_sheath:'material-metal',metallic_screen:'material-metal'}[r.role]||'material-semi')+')'}" stroke="var(--${colors[i%colors.length]})" stroke-width="${overlay?2:1}"/>`).join('');}
    return `<div class="version-geometry-tools"><label><input id="version-overlay" type="checkbox" ${F().overlay?'checked':''}>叠加</label><span>共同尺度 · 参数截面</span></div>${F().overlay?`<svg class="version-overlay" viewBox="0 0 320 320" role="img" aria-label="方案截面叠加">${ps.map((p,i)=>svg(i,true)).join('')}</svg><div class="version-geometry-legend">${ps.map((p,i)=>`<span style="color:var(--${colors[i%colors.length]})">${E(p.name)}</span>`).join('')}</div>`:`<div class="version-sections">${ps.map((p,i)=>`<figure><svg viewBox="0 0 320 320" role="img" aria-label="${E(p.name)}截面">${svg(i)}</svg><figcaption>${E(p.name)} · 基于 ${E(p.base_reference.version)}</figcaption></figure>`).join('')}</div>`}`;
  }
  function comparison(){
    const f=F();if(!f.comparison)return '';
    const issues=plans().flatMap(p=>[...p.issues.map(i=>({message:p.name+'：'+i.message})),...Object.entries(p.values).filter(([k,v])=>v.value===null).map(([k,v])=>({message:p.name+'：'+(v.title||({outer_diameter:'成品外径',mass:'用料',copper_mass:'导体用铜量'}[k])||k)+'，'+(v.reason||'尚无可引用的保存结果')+'。'}))]);
    return `<div class="version-toolbar">${B('新建方案','new')}<span>${plans().length} 个方案</span><span class="spacer"></span>${B('采纳为新版本草稿','adopt',`class="primary" ${!f.selected||H.state.busy||plans().find(p=>p.workspace===f.selected)?.status!=='draft'?'disabled':''}`)}</div>${tab()==='parameters'?parameters():tab()==='geometry'?geometry():matrix()}${checks(issues)}`;
  }
  function checks(items){const unique=[...new Set(items.map(c=>c.message))];return `<details class="version-checks" ${tab()==='review'?'open':''}><summary>校核项 · ${unique.length} 项</summary>${unique.length?'<ul>'+unique.map(m=>'<li>'+E(m)+'</li>').join('')+'</ul>':'<p>当前内容与所引运行一致。</p>'}</details>`;}
  function specification(){
    const f=F(),s=f.spec;if(!s)return '';const l=s.lifecycle,p=s.payload,status=l.stale?'历史提交':names[l.status];
    if(tab()==='preview')return `<div class="version-toolbar"><span>${E(status)}</span><span class="spacer"></span>${B('下载 HTML','download')}</div><iframe class="version-spec-preview" sandbox="allow-same-origin" title="规格书预览" srcdoc="${E(s.html)}"></iframe>`;
    if(tab()==='revisions')return table(['修订','变更','时间'],p.revisions.map(r=>`<tr><td class="number">r${r.revision}</td><td>${E(r.event)}</td><td>${E(r.created)}</td></tr>`),'型号修订记录');
    if(tab()==='review'){
      const active=l.status==='draft'||l.stale?'submit':l.status==='submitted'?'approve':l.status==='approved'?'publish':'fork';
      const labels={submit:'提交审核',approve:'人工批准',publish:'发布到型号库',fork:'基于此版本建方案'};
      return `<ol class="version-flow">${[['draft','草稿'],['submitted','提交审核'],['approved','人工批准'],['published','发布到型号库']].map(([k,v])=>`<li class="${l.status===k?'current':''}">${v}</li>`).join('')}</ol><div class="version-review-header"><h3>${E(status)}</h3>${B(labels[active],active,`class="primary" ${H.state.busy||unsaved()||active==='approve'&&!s.ready?'disabled':''}`)}</div>${l.approval?`<dl class="version-receipt"><dt>批准人</dt><dd>${E(l.approval.reviewer)}</dd><dt>批准时间</dt><dd>${E(l.approval.approved_at)}</dd><dt>内容摘要</dt><dd>${E(l.approval.specification_digest)}</dd></dl>`:'<p>等待负责人在本页确认当前内容。</p>'}${checks(p.checks)}<details class="version-sources"><summary>运行引用 · ${p.sources.length} 份</summary>${table(['模块','运行','输入修订','方法版本','状态'],p.sources.map(r=>`<tr><td>${E(r.channel)}</td><td>${E(r.run_id)}</td><td>r${r.workspace_revision}</td><td>${E(r.method.plugin_id)} ${E(r.method.version)}</td><td>${r.freshness==='current'?'当前':'历史结果'}</td></tr>`),'规格书运行引用')}</details>`;
    }
    const byChapter=[null,null,'geometry','electrical','rating','short_circuit','standards',null];
    return `<p class="version-conclusion">${E(p.name)} · 8 个章节，引用 ${p.sources.length} 份保存运行。</p>${table(['章节','内容来源','状态'],p.chapters.map((name,i)=>{const key=byChapter[i],r=p.sources.find(s=>s.channel===key);return `<tr><th><a href="#/types/${H.state.wid}/specification/preview">${i+1}. ${E(name)}</a></th><td>${key?r?E(r.method.plugin_id+' '+r.method.version):'—':i===7?'修订审计记录':'保存的型号输入'}</td><td>${key?r?r.freshness==='current'?'当前':'历史结果':'缺项':'已保存'}</td></tr>`;}),'规格书章节')}${checks(p.checks)}<div class="version-toolbar"><a href="#/types/${H.state.wid}/specification/review">查看审核与发布 →</a></div>`;
  }
  function render(rail){
    if(!handles())return;const f=F(),comparisonMode=mod()==='comparison',data=comparisonMode?f.comparison:f.spec;
    const empty=!data||(comparisonMode?plans().every(p=>!p.sources.length):!f.spec.payload.sources.length);
    const state=f.pending?'loading':f.error?'error':empty?'empty':unsaved()||(!comparisonMode&&(f.spec.lifecycle.stale||f.spec.payload.sources.some(s=>s.freshness!=='current')))||comparisonMode&&plans().some(p=>Object.values(p.values).some(v=>v.state==='historical'))?'historical':'success';
    const tabs=comparisonMode?[['matrix','结果矩阵'],['parameters','参数差异'],['geometry','截面对比']]:[['content','内容'],['preview','预览'],['review','审核与发布'],['revisions','修订记录']];
    H.$('#workspace').innerHTML=`<div class="work-area type-work-area type-version-workspace" data-version-state="${state}"><nav class="module-rail" aria-label="型号模块">${rail}</nav><section class="center"><div class="study-tabbar"><h2>${comparisonMode?'方案对比':'规格书'}</h2><div class="study-tabs" role="tablist" aria-label="${comparisonMode?'方案对比':'规格书'}页签">${tabs.map(([k,v])=>`<a role="tab" aria-selected="${tab()===k}" href="#/types/${H.state.wid}/${mod()}/${k}">${v}</a>`).join('')}</div><span class="spacer"></span>${f.error?'':B('刷新','refresh')}</div><div class="version-content">${f.pending?'<div class="study-loading" role="status"><h3>正在读取保存记录</h3><div class="study-skeleton"></div></div>':f.error?`<div class="standard-error" role="alert">${E(f.error)}${B('重试','refresh','class="primary"')}</div>`:!data?'<div class="study-empty"><h3>尚无保存记录</h3></div>':comparisonMode?comparison():specification()}</div><div class="study-checkbar"><span>${state==='historical'?'历史结果 · 保存后刷新引用':comparisonMode?'结果来源见矩阵中的快照按钮':E(names[f.spec?.lifecycle.status]||'草稿')}</span><span class="spacer"></span><span>${comparisonMode?'同一型号 · 独立方案':'内容来自保存输入与运行'}</span></div></section></div>`;
  }
  async function operation(key,body,actor){const wid=H.state.wid,f=F();if(H.state.busy)return;H.state.busy=true;f.pending=true;render(TypeWorkflow.rail());H.renderHeader();try{return await H.api(`/types/${wid}/${key}`,{method:'POST',headers:actor?{'X-CableSim-Actor':actor}:{ },body:JSON.stringify(body)});}catch(error){f.error=error.message;throw error;}finally{H.state.busy=false;f.pending=false;H.renderHeader();}}
  function body(){return {expected_revision:H.state.record.revision,request_id:crypto.randomUUID()};}
  function newPlan(){if(unsaved())throw new Error('请先保存当前型号，再建立方案。');H.openDialog('新建方案',`<label class="field"><span>方案名称</span><input id="version-plan-name" value="方案 ${plans().length+1}" maxlength="80"></label><p>基于 ${E(H.state.snapshot.type_origin_reference.version)}，复制当前保存的输入。</p>`,B('建立方案','create','class="primary"'));H.$('#version-plan-name').focus();}
  async function action(k){
    const f=F(),s=f.spec;if(k==='new'||k==='fork'){newPlan();return;}
    if(k==='refresh'){await load(true);return;}
    if(k==='create'){const name=H.$('#version-plan-name').value.trim();if(!name){H.$('#version-plan-name').setAttribute('aria-invalid','true');H.$('#version-plan-name').focus();return;}H.$('#modal').close();const result=await operation('plans',{...body(),name});f.signature=null;location.hash=`/types/${result.workspace_id}/structure/table`;return;}
    if(k==='adopt'){const p=plans().find(p=>p.workspace===f.selected);H.openDialog('采纳方案',`<p>${E(p.name)} · r${p.revision}，采纳为新版本草稿。</p>`,B('确认采纳','confirm-adopt','class="primary"'));return;}
    if(k==='confirm-adopt'){const p=plans().find(p=>p.workspace===f.selected);H.$('#modal').close();H.state.busy=true;try{await H.api(`/types/${p.workspace}/adopt`,{method:'POST',body:JSON.stringify({expected_revision:p.revision,request_id:crypto.randomUUID()})});await H.loadWorkspace(p.workspace);F().signature=null;}finally{H.state.busy=false;}location.hash=`/types/${p.workspace}/specification/review`;return;}
    if(k==='submit'){H.openDialog('提交规格书审核',`${checks(s.payload.checks)}<label class="amp-ack"><input id="version-checks-ack" type="checkbox">已核对当前内容与校核清单</label>`,B('确认提交','confirm-submit','class="primary" disabled'));return;}
    if(k==='confirm-submit'){if(!H.$('#version-checks-ack').checked)return;H.$('#modal').close();await operation('submissions',{...body(),specification_digest:s.digest,acknowledge_checks:true});await load(true);return;}
    if(k==='approve'){H.openDialog('人工批准规格书',`<label class="field"><span>当前登录用户</span><input id="version-reviewer" value="${E(s.lifecycle.operator.username)}" readonly></label><label class="amp-ack"><input id="version-human-ack" type="checkbox">本人已审阅当前规格书并批准</label>`,B('确认批准','confirm-approve','class="primary" disabled'));return;}
    if(k==='confirm-approve'){if(!H.$('#version-human-ack').checked)return;H.$('#modal').close();await operation('approve',{request_id:crypto.randomUUID(),submission_id:s.lifecycle.submission_id,specification_digest:s.digest,human_confirmed:true},'human');await load(true);return;}
    if(k==='publish'){H.openDialog('发布到型号库',`<p>批准人 ${E(s.lifecycle.approval.reviewer)}；发布后冻结本版本。</p>`,B('确认发布','confirm-publish','class="primary"'));return;}
    if(k==='confirm-publish'){H.$('#modal').close();await operation('publish',{request_id:crypto.randomUUID(),submission_id:s.lifecycle.submission_id,specification_digest:s.digest},'human');await H.loadWorkspace(H.state.wid);await load(true);H.renderWorkspace();return;}
    if(k==='download'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([s.html],{type:'text/html;charset=utf-8'}));a.download='cable-specification.html';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return;}
    if(k.startsWith('evidence:')){const [,wid,encoded]=k.split(':'),v=plans().find(p=>p.workspace===wid)?.values[decodeURIComponent(encoded)];H.openDialog('运行来源',`<dl class="version-receipt">${Object.entries(v.source).map(([k,v])=>'<dt>'+E(k)+'</dt><dd>'+E(typeof v==='object'?JSON.stringify(v):v)+'</dd>').join('')}</dl>${v.reason?'<p>'+E(v.reason)+'</p>':''}`);}
  }
  function keydown(event){if(!handles()||!H.$('#modal').open||event.key!=='Enter'||event.target.tagName==='TEXTAREA')return false;const b=H.$('#modal .primary');if(!b||b.disabled)return false;event.preventDefault();action(b.dataset.action.slice(13)).catch(H.fail);return true;}
  document.addEventListener('change',event=>{if(!H)return;if(event.target.name==='compare-plan'){F().selected=event.target.value;render(TypeWorkflow.rail());}if(event.target.id==='version-overlay'){F().overlay=event.target.checked;render(TypeWorkflow.rail());}for(const[id,key]of [['version-checks-ack','confirm-submit'],['version-human-ack','confirm-approve']])if(event.target.id===id)H.$(`[data-action="type-version-${key}"]`).disabled=!event.target.checked;});
  function handles(){return ['comparison','specification'].includes(mod());}
  function reviewNoise(){
    const root=H.$('#workspace');if(!root||!H.state.route.startsWith('/types/'))return;
    root.querySelectorAll('.type-review-details').forEach(el=>el.remove());
    const messages=[],pattern=/演示|假设|未覆盖|不能|未接入|待补数据|资料核对|合成验收数据/;
    const add=text=>{const sentence=text.trim().replace(/[。！？]+/g,'；').replace(/；+$/,'')+'。';if(sentence!=='。')messages.push(sentence);};
    // Saved artifacts retain their exact source/reason text; this only relocates
    // visible presentation copy, with a tooltip and the complete bottom entry.
    for(const el of root.querySelectorAll('td,th,td>span,h2,h3,p,small,li,option,#cad-properties,.study-checkbar>span,.inspector-head>span,.standard-summary')){
      if(el.closest('.version-checks,.version-sources,[role="alert"],.standard-error,.dialog-body,details'))continue;
      const raw=(el.dataset.reviewOriginal||el.textContent).trim();
      if(el.querySelector('table,input,select,textarea,button,a,svg,p,li,small')||!pattern.test(raw))continue;
      if(!raw)continue;
      if(el.id==='analysis-conclusion')continue;
      el.dataset.reviewOriginal=raw;
      if(/资料核对|合成验收数据|(?:典型)?结构演示|演示/.test(raw)&&/^h[23]$/.test(el.tagName.toLowerCase())){el.textContent=clean(raw);continue;}
      const subject=el.closest('tr')?.querySelector('th,td:nth-child(2)')?.textContent.trim();
      add(subject&&subject!==raw?subject+'：'+raw:raw);el.title=raw;
      if(el.tagName==='OPTION')el.textContent=clean(raw).replace(/未覆盖/g,'范围外').replace(/待补数据/g,'缺项');
      else if(el.tagName==='TD'||el.tagName==='TH'||el.matches('td>span,.inspector-head>span'))el.textContent=raw==='待补数据'?'缺项':raw==='未覆盖'?'范围外':/演示|假设/.test(raw)?'预置':'查看校核';
      else if(el.matches('h2,h3'))el.textContent=raw.replace(/未覆盖|待补数据|未接入/g,'需补充').replace(/不能/g,'暂缓');
      else if(el.matches('.study-checkbar>span,.standard-summary'))el.textContent=raw.replace(/待补数据/g,'缺项').replace(/未覆盖/g,'范围外').replace(/演示|假设/g,'预置');
      else el.hidden=true;
    }
    if(mod()==='electrical'||mod()==='short-circuit'){
      const key='x-cablesim.type-'+mod(),run=H.state.runs.filter(r=>r.output?.cases.some(c=>c.artifacts?.[key])).sort((a,b)=>new Date(b.created)-new Date(a.created))[0];
      const artifact=run?.output?.cases.find(c=>c.artifacts?.[key])?.artifacts[key];
      for(const row of artifact?TypeAnalysisView.records(artifact,run):[])if(row.status!=='available')add(row.title+'：'+(row.reason||row.status));
    }
    const unique=[...new Set(messages)];if(!unique.length)return;
    const box=document.createElement('details');box.className='type-review-details';
    box.innerHTML=`<summary>校核项 · ${unique.length} 条</summary><ul>${unique.map(s=>'<li>'+E(s)+'</li>').join('')}</ul>`;
    const target=H.$('.study-checkbar')||H.$('#dock-body');target?.append(box);
  }
  return {init:h=>H=h,handles,load,render,action,keydown,clean,frozen,reviewNoise,invalidate:()=>{if(H?.state.wid)F().signature=null;},lifecycle:()=>H?.state.snapshot?.type_lifecycle};
})();
