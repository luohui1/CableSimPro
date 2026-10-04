'use strict';
window.BatchStudy=(()=>{
  let C,S={id:null,meta:null,saved:null,draft:null,history:[],current:null,error:'',loading:false,busy:false,undo:[],selected:null,filter:'all',offset:0,request:null},timer=null;
  const E=v=>C.H.esc(v),B=(text,action,attrs='')=>`<button data-batch-action="${action}" ${attrs}>${E(text)}</button>`;
  const root=()=>`/workspaces/${C.A.study.workspace}/studies/${C.A.study.id}`;
  const active=()=>C?.A.module==='batch'&&C.A.study?.id===S.id;
  const name=s=>({prepared:'待运行',preparing:'准备中',queued:'排队中',running:'运行中',pending:'待运行',submitted:'已提交',completed:'已完成',succeeded:'有效',nonconverged:'未收敛',failed:'失败',crashed:'进程退出',timed_out:'超时',environment_missing:'环境缺失',interrupted:'已中断',disconnected:'连接中断',rejected:'提交被拒绝',submission_unknown:'待核对提交',cancelled:'已取消'})[s]||s;
  const n=(v,d=3)=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  const unit=a=>a.unit==='K'?'°C':({'K*m/W':'K·m/W','W/(m*K)':'W/(m·K)'})[a.unit]||a.unit;
  const shown=(v,a)=>a.unit==='K'?v-273.15:v;
  const pending=()=>active()&&[...document.querySelectorAll('[data-batch-field]')].some(e=>e.value!==e.defaultValue);
  const dirty=()=>C?.A.study?.id===S.id&&!!S.draft&&!S.savingParent&&(JSON.stringify(S.draft)!==JSON.stringify(S.saved?.definition)||pending());
  function remember(){S.undo.push(structuredClone(S.draft));if(S.undo.length>40)S.undo.shift();S.request=null;}
  function defaults(){return {source_module:null,parameter_space:{schema_version:'cablesim.parameter-space/1',sampling:'latin_hypercube',sample_count:100,seed:42,source:'工程师定义的参数空间',axes:[]},execution:{backend:'slurm',workers:8,sample_timeout_s:300,slurm_parallelism:8,slurm_wall_seconds:360,slurm_memory_mb:2048}};}
  async function load(context,force=false){
    C=context;if(S.id===C.A.study.id&&!force)return;
    clearTimeout(timer);S={id:C.A.study.id,meta:null,saved:null,draft:null,history:[],current:null,error:'',loading:true,busy:false,undo:[],selected:null,filter:'all',offset:0,request:null};
    if(C.H.$('#study-stage'))render();
    try{const [meta,history]=await Promise.allSettled([C.H.api(root()+'/batch-configuration'),C.H.api(root()+'/datasets')]);
      if(meta.status==='fulfilled'){S.meta=meta.value;S.saved=S.meta.configuration;S.draft=structuredClone(S.saved?.definition||defaults());if(!S.saved&&S.meta.method.plugin_id==='cablesim.comsol-bridge'){S.draft.execution.slurm_memory_mb=4096;S.draft.execution.slurm_parallelism=1;}}else S.error=meta.reason.message;
      if(history.status==='fulfilled'){S.history=history.value;if(S.history.length)S.current=await C.H.api(root()+'/datasets/'+S.history[0].id);}else throw history.reason;}
    catch(error){S.error=error.message;}
    finally{S.loading=false;}
  }
  const baseDirty=()=>C.H.state.dirty||JSON.stringify(C.A.draft)!==JSON.stringify(C.A.study.definition);
  async function save(){
    if(!S.draft||S.busy)return;document.activeElement?.blur();
    const invalid=C.H.$('.batch-content [aria-invalid="true"]');if(invalid){invalid.focus();throw new Error('请先修正标记的数值，单位见列标题。');}
    for(const [index,axis] of S.draft.parameter_space.axes.entries()){
      if(!axis.choices?.length&&(!Number.isFinite(axis.minimum)||!Number.isFinite(axis.maximum)||axis.minimum>=axis.maximum)){
        const field=C.H.$(`[data-batch-field="axis:${index}:minimum"]`);field?.setAttribute('aria-invalid','true');field?.focus();
        throw new Error(axis.label+'：下限须小于上限，请按 '+unit(axis)+' 修正范围。');
      }
    }
    if(baseDirty()){S.savingParent=true;try{await C.save();}finally{S.savingParent=false;}}
    if(!S.draft.parameter_space.axes.length)throw new Error('请先添加至少一个参数，并填写单位与范围。');
    S.busy=true;render();
    try{S.saved=await C.H.api(root()+'/batch-configuration',{method:'PUT',body:JSON.stringify({...S.draft,
      expected_revision:C.H.state.record.revision,expected_study_revision:C.A.study.revision,expected_configuration_revision:S.saved?.revision||0})});
      S.draft=structuredClone(S.saved.definition);S.request=null;S.error='';C.H.notify('批量配置已保存');}
    finally{S.busy=false;C.render();}
  }
  function primary(){if(S.draft&&!S.draft.parameter_space.axes.length)return {label:'添加采样参数',action:'batch-add',disabled:S.busy};return {label:S.busy?'处理中…':C.A.tab==='results'&&S.current?'导出数据集':'生成并运行',action:C.A.tab==='results'&&S.current?'batch-export':'batch-run',disabled:S.busy||S.loading||(!S.draft&&!(C.A.tab==='results'&&S.current))};}
  function status(){return S.loading?'正在读取批量配置':S.error?'需处理':dirty()?'批量配置未保存':S.current?`${name(S.current.status)} · ${S.current.valid_count||0} / ${S.current.sample_count} 个有效样本`:'尚未生成样本';}
  function fail(error){S.error=error.message||String(error);S.busy=false;C.render();}
  function draw(){if(active()){StudyShell.header();render();StudyShell.checks();}}
  function schedule(){clearTimeout(timer);if(!active()||!S.current||!['preparing','queued','running','submitted'].includes(S.current.status))return;timer=setTimeout(async()=>{if(!active())return;try{S.current=await C.H.api(root()+'/datasets/'+S.current.id+`?offset=${S.offset}&limit=50&status=${S.filter}`);if(C.A.tab!=='space')draw();}catch(error){S.error=error.message;draw();}schedule();},4000);}
  function settings(){
    const p=S.draft.parameter_space,x=S.draft.execution;
    return `<div class="batch-settings"><label>基准研究<select data-batch-select="source">${S.meta.source_modules.map(m=>`<option value="${E(m.id||'')}" ${S.draft.source_module===m.id?'selected':''}>${E(m.title)}</option>`).join('')}</select></label><label>采样方式<select data-batch-select="sampling">${[['latin_hypercube','拉丁超立方'],['grid','网格'],['random','随机']].map(([k,t])=>`<option value="${k}" ${p.sampling===k?'selected':''}>${t}</option>`).join('')}</select></label><label>样本数<input data-batch-field="sample_count" type="number" min="1" max="100000" step="1" value="${p.sample_count}" ${p.sampling==='grid'?'readonly':''}></label><label>随机种子<input data-batch-field="seed" type="number" min="0" step="1" value="${p.seed}" ${p.sampling==='grid'?'disabled':''}></label></div>
      <div class="batch-toolbar">${B('添加参数','add')}${B('添加排列','arrangement',S.meta.base_case.input.cables?.length?'':'disabled title="此基准未提供可排列的显式电缆中心"')}<span class="spacer"></span><span>${E(C.methodName(S.meta.method))} · ${E(S.meta.method.version)}</span></div>
      ${p.axes.length?`<div class="batch-table-scroll"><table class="study-table batch-parameters"><thead><tr><th>参数</th><th>单位</th><th>下限</th><th>上限</th><th>${p.sampling==='grid'?'点数':'绑定对象'}</th><th>操作</th></tr></thead><tbody>${p.axes.map((a,i)=>`<tr data-batch-row="axis-${i}" tabindex="0" ${S.selected==='axis-'+i?'aria-selected="true"':''}><td>${E(a.label)}</td><td>${E(unit(a))}</td>${a.choices?.length?`<td colspan="2">${a.choices.map(c=>E(c.label)).join(' / ')}</td><td>${a.choices.length} 种排列</td>`:`<td><input aria-label="${E(a.label)}下限" data-batch-field="axis:${i}:minimum" type="number" step="any" value="${shown(a.minimum,a)}"></td><td><input aria-label="${E(a.label)}上限" data-batch-field="axis:${i}:maximum" type="number" step="any" value="${shown(a.maximum,a)}"></td><td>${p.sampling==='grid'?`<input aria-label="${E(a.label)}点数" data-batch-field="axis:${i}:levels" type="number" min="1" step="1" value="${a.levels||2}">`:E(a.bindings.length+' 个字段')}</td>`}<td>${B('移除','remove-'+i,'class="quiet"')}</td></tr>`).join('')}</tbody></table></div>`:`<div class="batch-empty"><h3>定义这次研究的变化范围</h3><p>选择基准研究中的参数，保存范围后生成样本。</p></div>`}
      <div class="batch-execution-settings"><label>计算资源<select data-batch-select="backend"><option value="local" ${x.backend==='local'?'selected':''} ${S.meta.local_fallback_available?'':'disabled'}>本机离线兜底</option><option value="slurm" ${x.backend==='slurm'?'selected':''} ${S.meta.remote_available?'':'disabled'}>超算 Slurm${S.meta.remote_available?'':' · 环境缺失'}</option></select></label><label>${x.backend==='local'?'进程数':'并行任务上限'}<input data-batch-field="execution:${x.backend==='local'?'workers':'slurm_parallelism'}" type="number" min="1" max="${x.backend==='local'?S.meta.limits.local_workers:8}" value="${x.backend==='local'?x.workers:x.slurm_parallelism}"></label><label>单样本超时 / s<input data-batch-field="execution:sample_timeout_s" type="number" min="1" max="3600" value="${x.sample_timeout_s}"></label>${x.backend==='slurm'?`<label>每样本核时预算 / s<input data-batch-field="execution:slurm_wall_seconds" type="number" min="30" max="3600" value="${x.slurm_wall_seconds}"></label><span class="batch-budget" title="按单核样本时间预算预留；实际核时从 sacct 结算。">预留上限 ${n(p.sample_count*x.slurm_wall_seconds/3600,2)} 核时 / 2000</span>`:''}</div>`;
  }
  function recordToolbar(){return `<div class="batch-toolbar"><label>数据集<select data-batch-select="history">${S.history.map(r=>`<option value="${E(r.id)}" ${S.current?.id===r.id?'selected':''}>${E(new Date(r.created).toLocaleString('zh-CN'))} · 配置 r${r.configuration_revision}</option>`).join('')}</select></label><span class="spacer"></span>${S.current?B('刷新','refresh'):''}${S.current&&['interrupted','disconnected','failed','submission_unknown'].includes(S.current.status)?B('恢复连接与执行','resume'):''}</div>`;}
  function results(){
    if(!S.current)return `<div class="batch-empty"><h3>还没有数据集</h3><p>在参数空间中选择范围，生成并运行样本。</p></div>`;
    const r=S.current,axes=r.parameter_space.axes,failed=s=>!['succeeded','pending','running','nonconverged'].includes(s);
    const displayed=r.samples;
    const temperature=row=>Math.max(...row.results.filter(q=>q.key==='conductor_temperature'&&q.status==='available'&&q.case==='operating').map(q=>q.value));
    const current=row=>row.results.find(q=>q.key==='ampacity'&&q.status==='available')?.value;
    return `${recordToolbar()}<div class="batch-conclusion"><strong>${r.valid_count} / ${r.sample_count} 个有效样本</strong><span>${E(name(r.status))}</span>${r.historical||dirty()||r.configuration_revision!==S.saved?.revision?'<span class="batch-history-mark">历史输入</span>':''}<span class="spacer"></span><span>配置 r${r.configuration_revision}</span></div>
      <div class="batch-filter" role="group" aria-label="样本状态">${[['all','全部'],['succeeded','有效'],['nonconverged','未收敛'],['failed','失败'],['pending','待运行']].map(([key,text])=>B(text,'filter-'+key,`aria-pressed="${S.filter===key}"`)).join('')}</div>
      <div class="batch-table-scroll"><table class="study-table batch-results"><thead><tr><th>样本</th>${axes.map(a=>`<th>${E(a.label)}<span>${E(unit(a))}</span></th>`).join('')}<th>运行最热点<span>°C</span></th><th>允许电流<span>A</span></th><th>状态</th></tr></thead><tbody>${displayed.map(row=>`<tr tabindex="0" data-batch-row="${E(row.sample_id)}" ${S.selected===row.sample_id?'aria-selected="true"':''}><td>${row.index+1}</td>${axes.map(a=>`<td title="${E(row.parameters[a.name]?.value)} ${E(a.unit)}">${typeof row.parameters[a.name]?.value==='number'?n(shown(row.parameters[a.name].value,a)):E(row.parameters[a.name]?.value??'—')}</td>`).join('')}<td>${row.valid?n(temperature(row)-273.15):'—'}</td><td>${row.valid?n(current(row)):'—'}</td><td><span class="batch-status ${row.valid?'is-valid':failed(row.status)||row.status==='nonconverged'?'needs-review':''}" title="${E(row.error?.message||'')}">${E(name(row.status))}</span></td></tr>`).join('')||'<tr><td colspan="20">当前页没有该状态的样本。</td></tr>'}</tbody></table></div>
      <div class="batch-pagination"><span>${r.filtered_count?r.offset+1:0}–${Math.min(r.offset+50,r.filtered_count??r.sample_count)} / ${r.filtered_count??r.sample_count}</span><span class="spacer"></span>${B('上一页','previous',r.offset?'':'disabled')}${B('下一页','next',r.next_offset!=null?'':'disabled')}</div>`;
  }
  function execution(){const r=S.current;if(!r)return '<div class="batch-empty"><h3>还没有执行记录</h3></div>';return `${recordToolbar()}<table class="study-table batch-evidence"><tbody>${[['状态',name(r.status)],['样本数',r.sample_count],['有效样本',r.valid_count],['运行方式',r.execution?.backend==='slurm'?'Slurm 作业数组':'本机进程池'],['作业号',r.execution?.job_id||'—'],['输入修订','r'+r.source.workspace_revision],['基准研究修订','r'+r.source.study_revision],['插件',r.method.plugin_id+' '+r.method.version],['方法',r.method.capability],['配置修订','r'+r.configuration_revision],['计划 SHA256',r.plan_sha256]].map(([k,v])=>`<tr><th>${E(k)}</th><td>${E(v)}</td></tr>`).join('')}</tbody></table>${r.error?`<div class="batch-error" role="alert">${E(r.error.message||r.error)}</div>`:''}`;}
  function render(context){if(context)C=context;const el=C.H.$('#study-stage');if(!el)return;el.classList.add('batch-stage');
    el.innerHTML=`<div class="batch-content" aria-busy="${S.loading||S.busy}">${S.error?`<div class="batch-error" role="alert">${E(S.error)} ${B('重试读取','reload')}</div>`:''}${S.loading?'<div class="batch-empty" role="status"><h3>正在读取批量研究…</h3><div class="study-skeleton"></div></div>':C.A.tab==='results'?results():C.A.tab==='execution'?execution():S.draft?settings():''}</div>`;
    if(S.busy)el.querySelectorAll('input,select,[data-batch-action]').forEach(e=>e.disabled=true);schedule();}
  function inspector(){
    if(S.selected?.startsWith('axis-')){const a=S.draft.parameter_space.axes[Number(S.selected.slice(5))];return a?`<h3>${E(a.label)}</h3><p>${E(a.source)}</p><dl class="batch-properties"><dt>单位</dt><dd>${E(unit(a))}</dd><dt>字段绑定</dt><dd>${(a.bindings||[]).map(b=>`<div title="${E(b.pointer)}">${E(S.meta.fields.find(f=>f.pointer===b.pointer)?.label||b.pointer)}${b.reciprocal?' · 倒数换算':''}</div>`).join('')||a.choices.map(c=>E(c.label)).join(' / ')}</dd></dl>`:'';}
    const row=S.current?.samples.find(r=>r.sample_id===S.selected);if(!row)return '';
    return `<h3>样本 ${row.index+1}</h3><p class="batch-status">${E(name(row.status))}</p>${row.error?`<p role="alert">${E(row.error.message)}</p>`:''}<dl class="batch-properties">${[['运行环境',row.backend==='slurm'?'超算':'本机'],['节点',row.mesh?.nodes??'—'],['网格收敛',row.convergence?.mesh_status==='converged'?'通过':({not_assessed:'未评估',not_assessed_single_mesh:'单档网格'})[row.convergence?.mesh_status]||row.convergence?.mesh_status||'—'],['耗时',n(row.wall_seconds,2)+' s'],['输入摘要',row.input_sha256||'—']].map(([k,v])=>`<dt>${E(k)}</dt><dd>${E(v)}</dd>`).join('')}</dl>`;
  }
  function presets(){
    const input=S.meta.base_case.input,cables=input.cables;if(!Array.isArray(cables)||!cables.length)return [];
    const source='工程师指定范围；保持基准研究的其余事实',list=[];
    if(input.environment?.kind==='ground'&&cables.every(c=>Number.isFinite(c.z_m))){const depth=-cables.reduce((s,c)=>s+c.z_m,0)/cables.length;if(depth>.05)list.push({name:'depth',label:'整体埋深',unit:'m',minimum:Math.max(.05,depth*.8),maximum:depth*1.2,source,bindings:cables.map((c,i)=>({pointer:`/input/cables/${i}/z_m`,target_unit:'m',scale:-1,offset:c.z_m+depth}))});}
    const groups=Object.values(cables.reduce((o,c)=>((o[c.circuit]??=[]).push(c),o),{})).map(g=>({cables:g,x:g.reduce((s,c)=>s+c.x_m,0)/g.length,z:g.reduce((s,c)=>s+c.z_m,0)/g.length})).sort((a,b)=>a.x-b.x);
    if(groups.length>1&&groups.every(g=>Math.abs(g.z-groups[0].z)<1e-8)){
      const pitch=Math.min(...groups.slice(1).map((g,i)=>g.x-groups[i].x)),center=groups.reduce((s,g)=>s+g.x,0)/groups.length;
      if(pitch>0)list.push({name:'spacing',label:'水平回路间距',unit:'m',minimum:pitch*.8,maximum:pitch*1.2,source,bindings:groups.flatMap(g=>g.cables.map(c=>({pointer:`/input/cables/${cables.indexOf(c)}/x_m`,target_unit:'m',scale:(g.x-center)/pitch,offset:center+c.x_m-g.x})))});
    }
    const env=input.environment;if(env?.background?.k_w_m_k>0)list.push({name:'soil_resistivity',label:'土壤热阻率',unit:'K*m/W',minimum:.6,maximum:2.5,source,bindings:[{pointer:'/input/environment/background/k_w_m_k',target_unit:'W/(m*K)',reciprocal:true}]});
    if(env?.boundaries){const keys=Object.keys(env.boundaries).filter(k=>Number.isFinite(env.boundaries[k].temperature_k));if(keys.length)list.push({name:'ambient',label:'统一边界地温',unit:'K',minimum:283.15,maximum:313.15,source,bindings:keys.map(k=>({pointer:`/input/environment/boundaries/${k}/temperature_k`,target_unit:'K'}))});}
    list.push({name:'load_factor',label:'负荷倍率',unit:'1',minimum:.5,maximum:1.2,source,bindings:cables.map((c,i)=>({pointer:`/input/cables/${i}/current_a`,target_unit:'A',mode:'multiply'}))});
    for(const [i,b]of (env?.backfills||[]).entries())list.push({name:'backfill_'+i,label:'回填热阻率 '+(i+1),unit:'K*m/W',minimum:.5,maximum:2.,source,bindings:[{pointer:`/input/environment/backfills/${i}/k_w_m_k`,target_unit:'W/(m*K)',reciprocal:true}]});
    return list;
  }
  function addDialog(){const choices=presets();C.H.openDialog('添加采样参数',`<label>参数<select id="batch-new-axis"><optgroup label="整体参数">${choices.map((a,i)=>`<option value="preset:${i}">${E(a.label)}</option>`).join('')}</optgroup><optgroup label="基准研究字段">${S.meta.fields.map((f,i)=>`<option value="field:${i}">${E(f.label)} · ${E(f.pointer.replace('/input/',''))} · ${E(unit(f))}</option>`).join('')}</optgroup></select></label>`,B('添加','confirm-add','class="primary"'));}
  function arrange(){const cables=S.meta.base_case.input.cables,groups=cables.reduce((o,c)=>((o[c.circuit]??=[]).push(c),o),{});
    if(S.draft.parameter_space.axes.some(a=>a.choices?.length))throw new Error('排列参数已添加；请先移除已有排列后再设置。');
    if(Object.values(groups).some(g=>g.length!==3))throw new Error('排列预设仅适用于每回路三根显式电缆；其他排列请绑定具体坐标字段。');
    remember();const choices=[];
    for(const shape of ['水平','垂直','三角']){
      const changes={};
      for(const group of Object.values(groups)){
        const x=group.reduce((s,c)=>s+c.x_m,0)/3,z=group.reduce((s,c)=>s+c.z_m,0)/3;
        const pitch=Math.min(...group.flatMap((c,i)=>group.slice(i+1).map(d=>Math.hypot(c.x_m-d.x_m,c.z_m-d.z_m))));
        if(!(pitch>0))throw new Error('基准电缆中心重合，请先修正敷设。');
        const points=shape==='水平'?[[-pitch,0],[0,0],[pitch,0]]:shape==='垂直'?[[0,-pitch],[0,0],[0,pitch]]:[[-pitch/2,-pitch/Math.sqrt(12)],[pitch/2,-pitch/Math.sqrt(12)],[0,pitch/Math.sqrt(3)]];
        group.forEach((c,j)=>{const i=cables.indexOf(c);changes[`/input/cables/${i}/x_m`]=x+points[j][0]-c.x_m;changes[`/input/cables/${i}/z_m`]=z+points[j][1]-c.z_m;});
      }
      choices.push({label:shape,changes,mode:'add'});
    }
    S.draft.parameter_space.axes.push({name:'arrangement_'+S.draft.parameter_space.axes.length,label:'三相排列',unit:'1',source:'保持基准回路中心与最小相间距；在连续坐标变化后叠加排列位移，重叠由求解器拒绝。',choices});gridCount();C.render();}
  function gridCount(){const p=S.draft.parameter_space;if(p.sampling==='grid')p.sample_count=p.axes.reduce((v,a)=>v*(a.choices?.length||a.levels||2),1);}
  async function selectRun(id){S.current=await C.H.api(root()+'/datasets/'+id+`?offset=${S.offset}&limit=50&status=${S.filter}`);S.selected=null;draw();}
  async function action(key){
    if(S.busy)return;
    try{S.error='';
      if(key==='save'){await save();return;}if(key==='reload'){await load(C,true);C.render();return;}
      if(key==='add'){addDialog();return;}if(key==='arrangement'){arrange();return;}
      if(key==='confirm-add'){const [kind,id]=C.H.$('#batch-new-axis').value.split(':');remember();let axis;if(kind==='preset')axis=structuredClone(presets()[Number(id)]);else{const f=S.meta.fields[Number(id)],span=Math.abs(f.value)*.2||1;axis={name:'parameter_'+S.draft.parameter_space.axes.length,label:f.label,unit:f.unit,minimum:f.value-span,maximum:f.value+span,source:'工程师指定范围',bindings:[{pointer:f.pointer,target_unit:f.unit}]};}if(S.draft.parameter_space.axes.some(a=>a.name===axis.name))throw new Error('此参数已添加，请直接修改已有范围。');const at=S.draft.parameter_space.axes.findIndex(a=>a.choices?.some(c=>c.mode==='add'));S.draft.parameter_space.axes.splice(at<0?S.draft.parameter_space.axes.length:at,0,axis);gridCount();C.H.$('#modal').close();C.render();return;}
      if(key.startsWith('remove-')){remember();S.draft.parameter_space.axes.splice(Number(key.slice(7)),1);S.selected=null;gridCount();C.render();return;}
      if(key.startsWith('filter-')){S.filter=key.slice(7);S.offset=0;await selectRun(S.current.id);return;}
      if(key==='previous'||key==='next'){S.offset=key==='previous'?Math.max(0,S.offset-50):S.current.next_offset;await selectRun(S.current.id);return;}
      if(key==='history'){C.A.tab='execution';location.hash=C.href('batch','execution',null).slice(1);return;}
      if(key==='refresh'){if(S.current)await selectRun(S.current.id);return;}
      if(key==='resume'){S.busy=true;draw();S.current=await C.H.api(root()+'/datasets/'+S.current.id+'/resume',{method:'POST',body:JSON.stringify({request_id:crypto.randomUUID(),retry_failed:false})});S.busy=false;draw();schedule();return;}
      if(key==='export'){S.busy=true;draw();const response=await fetch('/api'+root()+'/datasets/'+S.current.id+'/export',{method:'POST'});if(!response.ok)throw new Error('导出失败，请核对数据集完整性后重试。');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='CableSimPro-dataset.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);S.busy=false;draw();return;}
      if(key==='run'){if(dirty()||baseDirty()||!S.saved)await save();S.busy=true;draw();if(!S.request){const pre=await C.H.api(root()+'/batch-configuration'+(S.draft.source_module?'?module='+encodeURIComponent(S.draft.source_module):''));S.request={request_id:crypto.randomUUID(),expected_revision:C.H.state.record.revision,expected_study_revision:C.A.study.revision,configuration_revision:S.saved.revision,module:S.draft.source_module,lock_digest:pre.lock_digest,scope_acknowledged:true};}
        await C.H.api(root()+'/batch-preflight',{method:'POST',body:JSON.stringify(S.request)});S.current=await C.H.api(root()+'/datasets',{method:'POST',body:JSON.stringify(S.request)});S.history=await C.H.api(root()+'/datasets');S.offset=0;S.busy=false;C.go('batch','results');draw();schedule();}
    }catch(error){fail(error);}
  }
  function change(event){if(!active())return false;const el=event.target,path=el.dataset.batchField,select=el.dataset.batchSelect;if(!path&&!select)return false;
    if(path){const value=Number(el.value);if(el.value===''||!Number.isFinite(value)){el.setAttribute('aria-invalid','true');S.error='请输入有效数值，单位见列标题。';return true;}remember();if(path.startsWith('axis:')){const [,index,key]=path.split(':'),axis=S.draft.parameter_space.axes[Number(index)];axis[key]=key!=='levels'&&axis.unit==='K'?value+273.15:value;}else if(path.startsWith('execution:'))S.draft.execution[path.slice(10)]=value;else S.draft.parameter_space[path]=value;el.defaultValue=el.value;el.removeAttribute('aria-invalid');gridCount();S.error='';StudyShell.updateState();return true;}
    if(select==='history'){S.offset=0;selectRun(el.value).catch(fail);return true;}remember();if(select==='sampling')S.draft.parameter_space.sampling=el.value;else if(select==='backend')S.draft.execution.backend=el.value;else if(select==='source'){S.draft.source_module=el.value||null;C.H.api(root()+'/batch-configuration'+(el.value?'?module='+encodeURIComponent(el.value):'?module=')).then(meta=>{S.meta=meta;C.render();}).catch(fail);return true;}gridCount();C.render();return true;
  }
  function keydown(event){if(!active())return false;const mod=event.ctrlKey||event.metaKey;
    if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();event.target.blur?.();action('save');return true;}
    if(mod&&event.key.toLowerCase()==='z'){event.preventDefault();if(S.undo.length){S.draft=S.undo.pop();S.request=null;S.error='';C.render();}return true;}
    if(event.key==='Escape'&&!C.H.$('#modal').open){event.preventDefault();S.selected=null;C.A.rows.batch=null;C.A.inspectorClosed['batch/'+C.A.tab]=true;C.render();return true;}
    if(event.key==='Enter'&&event.target.dataset.batchField){event.preventDefault();change(event);return true;}return false;
  }
  document.addEventListener('click',event=>{if(!active())return;const button=event.target.closest('[data-batch-action]');if(button){event.preventDefault();action(button.dataset.batchAction);return;}const row=event.target.closest('[data-batch-row]');if(row){S.selected=row.dataset.batchRow;C.A.rows['batch/'+C.A.tab]=S.selected;C.A.inspectorClosed['batch/'+C.A.tab]=false;C.H.$('#study-stage').querySelectorAll('[data-batch-row]').forEach(r=>r.setAttribute('aria-selected',String(r===row)));StudyShell.inspector();}});
  document.addEventListener('keydown',event=>{if(active()&&event.target.dataset.batchRow&&['Enter',' '].includes(event.key)){event.preventDefault();event.target.click();}});
  document.addEventListener('input',event=>{if(active()&&event.target.dataset.batchField)StudyShell.updateState();});
  return {load,render,action,change,keydown,dirty,save,primary,status,inspector,current:()=>S.current,
    isBusy:()=>active()&&S.busy,hasSelection:()=>!!S.selected,dispose:()=>clearTimeout(timer),discard:()=>{S.draft=structuredClone(S.saved?.definition||defaults());S.undo=[];S.request=null;}};
})();
