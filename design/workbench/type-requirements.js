'use strict';
// A human reviews plugin proposals. Model values and run artifacts stay immutable.
window.TypeRequirements=(()=>{
  let H,S;const cache=new Map(),names={proposed:'待批准',approved:'已批准',conflict:'版本冲突',unbound:'未定义 / 未覆盖'};
  const E=v=>H.esc(v),B=(label,key,attrs='')=>H.button(label,'','type-requirement-'+key,attrs);
  const pendingKey=()=> 'csp-requirement-review:'+H.state.wid;
  const F=()=>{if(!cache.has(H.state.wid)){const f={ledger:null,loading:false,attempt:null,selected:new Set(),row:0,filter:'all',tab:'list',error:null,pending:null,submitting:false};try{const p=JSON.parse(sessionStorage.getItem(pendingKey())||'null');if(p?.human_confirmed===true){f.pending=p;f.error='前次人工批准的连接未完成，可重试同一请求。';}}catch{}cache.set(H.state.wid,f);}return cache.get(H.state.wid);};
  const url=()=>`/design/type-workspaces/${H.state.wid}/requirements`;
  const proposal=r=>F().ledger?.run_id===S.run()?.id?F().ledger.items.find(p=>p.row_id===r.id):null;
  const eligible=r=>!!proposal(r)?.bindable&&S.current()&&!H.state.busy&&!F().loading;
  const status=r=>r.verdict==='uncovered'?'未覆盖':proposal(r)?names[proposal(r).state]:'—';
  async function approvedSource(){const f=F();if(!S.current())return null;if(f.ledger?.run_id!==S.run()?.id)f.ledger=await H.api(url()+`?run_id=${S.run().id}`);return f.ledger.approved_count?{kind:'user',reviewed:true,reference:`人工批准要求集 ${f.ledger.approved_digest}；审批记录 ${f.ledger.review_references.join('；')}`} : null;}
  async function load(){
    const f=F(),run=S.run(),wid=H.state.wid;if(!run||f.loading||f.ledger?.run_id===run.id)return;
    f.loading=true;f.attempt=run.id;try{const ledger=await H.api(url()+`?run_id=${run.id}`);if(H.state.wid===wid&&S.run()?.id===run.id){f.ledger=ledger;if(!f.pending)f.error=null;}}catch(error){if(H.state.wid===wid&&S.run()?.id===run.id)f.error=error.message;}finally{f.loading=false;if(H.state.wid===wid&&H.state.route.split('/')[3]==='requirements')render(TypeWorkflow.rail());}
  }
  function detail(r){
    const p=proposal(r),approval=p?.approval;
    return S.rowDetail(r,F().row)+`<div class="inspector-section"><h3>要求批准</h3><p>${E(status(r))}</p>${p?`<p class="standard-digest">要求 ${E(p.id)}</p><p>判定绑定 · ${E(p.definition.method.plugin_id)} ${E(p.definition.method.version)}</p>`:''}${approval?`<p>审批人 ${E(approval.reviewer)}</p><p>${E(new Date(approval.created).toLocaleString())}</p>${p.state==='conflict'?`<p class="warning">原批准的来源版本或要求定义已变化，请重新核对。</p><p>原标准值：${E(S.requirement({...r,...approval.definition}))}</p>`:''}<details><summary>批准记录</summary><p>${E(approval.id)}</p><p class="standard-digest">${E(approval.digest)}</p></details>`:''}</div>`;
  }
  function table(){
    const f=F(),a=S.artifact();if(!a)return '<div class="study-empty"><h3>尚无要求目录</h3><p>保存型号后生成适用条款，检查来源并批准所选要求。</p></div>';
    const rows=a.rows.map((r,i)=>({r,i})).filter(({r})=>{const p=proposal(r);return f.tab==='pending'?(r.verdict==='uncovered'||!p||p.state!=='approved'):f.filter==='all'||p?.state===f.filter;});
    return `<div class="standard-table-scroll"><table class="standard-table" aria-label="要求与标准表"><thead><tr><th class="requirement-select"><input type="checkbox" data-action="type-requirement-all" aria-label="选择全部可批准要求" ${!S.current()||f.loading?'disabled':''}></th><th>要求</th><th>条款 / 页码</th><th>标准值</th><th>批准状态</th><th>依据</th></tr></thead><tbody>${rows.map(({r,i})=>`<tr data-action="type-requirement-row:${i}" tabindex="0" class="${i===f.row?'selected':''}"><td class="requirement-select"><input type="checkbox" data-action="type-requirement-select:${i}" aria-label="选择${E(r.title)}" ${f.selected.has(r.id)?'checked':''} ${eligible(r)?'':'disabled'} title="${eligible(r)?'选择后由人工批准':'需要当前、已定义且原文与判定能力完整的要求'}"></td><td>${E(r.title)}</td><td>${E(r.clause)}<small>${r.printed_page==null?'页码未核验':'正文 '+r.printed_page+' / PDF '+r.pdf_page}</small></td><td class="number">${E(S.requirement(r))}</td><td>${E(status(r))}</td><td>${B('依据','row:'+i,'class="quiet standard-proof"')}</td></tr>`).join('')||'<tr><td colspan="6">没有此状态的要求。</td></tr>'}</tbody></table></div>`;
  }
  function render(rail){
    const f=F(),a=S.artifact(),s=S.state(),busy=s.pending||f.submitting,error=f.error||s.error;
    if(a&&f.selectionRun!==S.run()?.id){f.selected.clear();f.selectionRun=S.run().id;}
    if(a&&f.ledger?.run_id!==S.run()?.id&&f.attempt!==S.run()?.id&&!f.loading)load();
    if(f.row>=(a?.rows.length||0))f.row=0;
    const tabs=[['list','要求清单'],['standards','执行标准'],['pending','待批准导入']];
    const tools=a?`${f.error&&!f.ledger?B('刷新记录','refresh','class="quiet"'):''}${B(S.current()?'更新要求':'保存并更新要求','generate','class="quiet" '+(busy?'disabled':''))}${B(f.pending?'重试批准':'批准所选要求','approve',`id="requirement-approve" class="primary" ${busy||f.loading||(!f.pending&&(!S.current()||!f.selected.size))?'disabled':''}`)}`:B('生成要求目录','generate',`class="primary" ${busy?'disabled':''}`);
    const state=busy?'loading':error?'error':!a?'empty':S.current()?'success':'historical';
    const content=f.tab==='standards'&&a?`<div class="standard-source-list">${a.sources.map(source=>`<div><strong>${E(source.standard)}</strong><p>${E(source.file_name)}</p><p>原文已核验 · 与插件 ${E(S.run().snapshot.definition.method.version)} 绑定</p><p class="standard-digest">SHA-256 ${E(source.sha256)}</p></div>`).join('')}</div>`:table();
    H.$('#workspace').innerHTML=`<div class="work-area type-work-area type-standard-workspace" data-standard-state="${state}"><nav class="module-rail" aria-label="型号模块">${rail}</nav><section class="center"><div class="study-tabbar"><div class="study-tabs" role="tablist" aria-label="要求与标准页签">${tabs.map(([id,label])=>B(label,'tab:'+id,`role="tab" aria-selected="${f.tab===id}"`)).join('')}</div><span class="spacer"></span>${tools}</div><div class="standard-content">${error?`<div class="standard-error" role="alert"><strong>要求处理未完成</strong><p>${E(error)}</p><span>已保存型号、核对快照和批准记录仍保留。</span></div>`:''}${busy?'<div class="study-loading" role="status"><h3>正在处理已确认请求</h3><div class="study-skeleton"></div></div>':`<div class="standard-rating">${H.field('U₀','cable_types.0.rating.u0',{scale:.001,unit:'kV'})}${H.field('U','cable_types.0.rating.u',{scale:.001,unit:'kV',nullable:true})}</div><div class="standard-tools"><span id="requirement-freshness" class="${a&&!S.current()?'warning':''}">${f.loading?'正在读取批准记录':!a?'尚未生成':S.current()?'当前来源':'历史来源 · 保存并更新要求'}</span>${a&&f.tab==='list'?`<label>显示 <select id="requirement-filter" aria-label="筛选要求批准状态">${[['all','全部要求'],['proposed','待批准'],['approved','已批准'],['conflict','版本冲突'],['unbound','未定义 / 未覆盖']].map(([k,v])=>`<option value="${k}" ${f.filter===k?'selected':''}>${v}</option>`).join('')}</select></label>`:''}</div>${content}`}</div><div class="study-checkbar"><span>${a?`${a.rows.length} 项要求 · ${f.ledger?.approved_count||0} 项已批准 · ${f.selected.size} 项已选`:'要求由插件原文覆盖确定'}</span><span class="spacer"></span><span>人工批准要求 · 型号未发布</span></div></section><aside class="inspector standard-inspector" aria-label="条款依据">${a&&!busy?detail(a.rows[f.row]):'<div class="inspector-head"><h2>要求来源</h2></div><div class="inspector-section"><p>生成目录后逐条核对来源与判定绑定。</p></div>'}</aside></div>`;
    TypeVersions.reviewNoise();
  }
  function invalidate(){const f=F(),el=H.$('#requirement-freshness');if(el)el.textContent=S.current()?'当前来源':'历史来源 · 保存并更新要求';const button=H.$('#requirement-approve');if(button)button.disabled=!S.current()||f.loading||(!f.pending&&!f.selected.size);for(const input of document.querySelectorAll('[data-action^="type-requirement-select:"]')){const index=Number(input.dataset.action.split(':')[1]);input.disabled=!eligible(S.artifact().rows[index]);}}
  async function approve(){
    const f=F();if(f.submitting||H.state.busy)return;if(f.pending){await execute();return;}
    const rows=S.artifact()?.rows.filter(r=>f.selected.has(r.id)&&eligible(r))||[];if(!rows.length)throw new Error('请选择当前且已完整定义的要求。');
    H.openDialog('批准所选要求',`<p>${rows.length} 项要求；来源为当前保存输入及已核验条款。</p><label class="field"><span>审批人</span><input id="requirement-reviewer" maxlength="120" autocomplete="name" required></label><label class="amp-ack"><input id="requirement-review-ack" type="checkbox">本人已核对来源、要求与判定绑定，批准所选要求</label><p class="subtle">此操作保留独立批准记录，不批准计算结果或发布型号。</p>`,B('批准所选要求','confirm','class="primary" disabled'));
  }
  function confirmEnabled(){const name=H.$('#requirement-reviewer')?.value.trim(),ack=H.$('#requirement-review-ack')?.checked;const button=H.$('[data-action="type-requirement-confirm"]');if(button)button.disabled=!(name&&ack);}
  async function execute(){
    const f=F();if(f.submitting||H.state.busy)return;
    if(!f.pending){if(!H.$('#requirement-review-ack')?.checked||!H.$('#requirement-reviewer')?.value.trim())return;f.pending={request_id:crypto.randomUUID(),run_id:S.run().id,row_ids:S.artifact().rows.filter(r=>f.selected.has(r.id)&&eligible(r)).map(r=>r.id),expected_workspace_revision:H.state.record.revision,expected_requirements_revision:f.ledger.revision,reviewer:H.$('#requirement-reviewer').value.trim(),human_confirmed:true};try{sessionStorage.setItem(pendingKey(),JSON.stringify(f.pending));}catch{}}
    H.$('#modal').close();f.submitting=true;H.state.busy=true;f.error=null;render(TypeWorkflow.rail());
    try{await H.api(url()+'/reviews',{method:'POST',body:JSON.stringify(f.pending)});f.ledger=await H.api(url()+`?run_id=${S.run().id}`);f.pending=null;f.selected.clear();sessionStorage.removeItem(pendingKey());H.notify('已保存人工批准记录');}
    catch(error){if(error.status>=400&&error.status<500){f.pending=null;sessionStorage.removeItem(pendingKey());f.ledger=null;}f.error=error.message;H.log(error.message);}
    finally{f.submitting=false;H.state.busy=false;render(TypeWorkflow.rail());}
  }
  async function action(key){const f=F(),a=S.artifact();if(key==='refresh'){f.error=null;f.attempt=null;f.ledger=null;return load();}if(key==='generate'){f.error=null;return S.generate();}if(key==='approve')return approve();if(key==='confirm')return execute();if(key==='all'){const all=a.rows.filter(eligible),checked=all.every(r=>f.selected.has(r.id));for(const r of all){if(checked)f.selected.delete(r.id);else f.selected.add(r.id);}render(TypeWorkflow.rail());return;}if(key.startsWith('select:')){const r=a.rows[Number(key.slice(7))];if(eligible(r)){if(f.selected.has(r.id))f.selected.delete(r.id);else f.selected.add(r.id);}render(TypeWorkflow.rail());return;}if(key.startsWith('row:')){f.row=Number(key.slice(4));render(TypeWorkflow.rail());return;}if(key.startsWith('tab:')){f.tab=key.slice(4);render(TypeWorkflow.rail());}}
  function keydown(event){if(H.$('#modal').open&&H.$('#requirement-review-ack')&&event.key==='Enter'){confirmEnabled();if(!H.$('[data-action="type-requirement-confirm"]').disabled){event.preventDefault();execute();return true;}}if(event.key==='Enter'&&event.target.matches('[data-action^="type-requirement-row:"],[data-action^="type-requirement-select:"]')){event.preventDefault();action(event.target.dataset.action.slice(17));return true;}return false;}
  document.addEventListener('input',event=>{if(H&&event.target.id==='requirement-reviewer')confirmEnabled();});
  document.addEventListener('change',event=>{if(!H)return;if(event.target.id==='requirement-review-ack')confirmEnabled();if(event.target.id==='requirement-filter'){F().filter=event.target.value;render(TypeWorkflow.rail());}});
  return {init:(h,s)=>{H=h;S=s;},render,invalidate,action,keydown,approvedSource};
})();
