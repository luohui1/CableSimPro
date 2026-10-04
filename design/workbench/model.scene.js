// Read-only installation preview. The geometry plugin owns native construction.
const viewportModule=import('./cad-viewport.js?continuous');
const nativeReady=import('./occt-viewer-adapter.js?continuous').then(m=>m.preloadViewer());
nativeReady.catch(()=>{});
window.CableScene=(()=>{
  let C,studyId=null,viewer=null,container=null,mounting=null,lifetime=0,request=0,timer,shown=null,selectedId=null,mode='scene',camera={},section=.55,problem='',timings={},mountAt=0;
  const cache=new Map();let activeKey='',planned=null;
  const I=[1,0,0,0,0,1,0,0,0,0,1,0];
  const active=()=>C?.A.module==='section'&&C.A.tab==='three-dimensional';
  const documentInput=()=>C?.A.viewRunId?C.runInput():C?.H.state.draft;
  const source=()=>{const selection=StudySection.selection(),doc=documentInput(),sec=doc?.sections?.[selection.index||0],plugin=C?.H.state.methods.find(m=>m.capabilities.some(c=>c.artifacts?.some(a=>a.type==='x-cablesim.cad-scene'))),capability=plugin?.capabilities.find(c=>c.artifacts?.some(a=>a.type==='x-cablesim.cad-scene'));return {doc,sec,plugin,capability};};
  function scaffold(doc,sec,length=.4){
    const assets={},objects=[],types=new Map(doc.cable_types.map(t=>[t.id,t])),circuits=new Map();
    for(const c of doc.circuits)for(const p of c.cables)circuits.set(p.id,{c,p});
    const add=(id,kind,label,bounds,asset,more={})=>{const key='display:'+JSON.stringify(asset);assets[key]={...asset,geometry_key:key};objects.push({id,kind,label,bounds_m:bounds,parts:[{asset_id:key,transform_mm:I}],...more});};
    for(const placement of sec.placements){
      const ref=circuits.get(placement.cable),t=types.get(ref?.c.cable_type);if(!t||t.cores.length!==1)throw new Error('当前场景需要已接入的单芯型号几何。');
      const x=placement.x,z=placement.z;if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('敷设坐标无效。');let radius=t.cores[0].conductor.diameter/2;const rows=[{inner:0,outer:radius,material:t.cores[0].conductor.material,role:'conductor'}];
      for(const l of [...t.cores[0].layers,...t.common_layers]){const inner=radius;radius+=l.thickness;rows.push({inner,outer:radius,material:l.material,role:l.role});}
      const parts=[];for(const r of rows){if(!Number.isFinite(r.outer)||r.outer<=r.inner)throw new Error('电缆径向尺寸无效。');const a={primitive:'annulus',inner_radius_m:r.inner,outer_radius_m:r.outer,material:r.material,category:doc.materials.find(m=>m.id===r.material)?.category,role:r.role},key='display:'+JSON.stringify([length,a]);assets[key]={...a,geometry_key:key};parts.push({asset_id:key,transform_mm:[1,0,0,x*1000,0,0,1,0,0,-1,0,z*1000]});}
      const circuitLabel=ref.c.label&&!ref.c.label.startsWith('v0 ')?ref.c.label:'第'+(doc.circuits.indexOf(ref.c)+1)+'回路';
      objects.push({id:placement.cable,kind:'cable',label:circuitLabel+' · '+ref.p.phase+' 相',type_label:t.label,position_m:{x,z},outer_diameter_m:radius*2,bounds_m:[x-radius,0,z-radius,x+radius,length,z+radius],parts});
    }
    for(const e of sec.enclosures||[]){const r=e.outer_diameter/2,b=e.type==='duct'?[e.x-r,0,e.z-r,e.x+r,length,e.z+r]:[e.x-e.width/2,0,e.z-e.height/2,e.x+e.width/2,length,e.z+e.height/2];
      if(e.type==='duct')add(e.id,'enclosure','排管',b,{primitive:'annulus',inner_radius_m:e.inner_diameter/2,outer_radius_m:r,material:e.material,category:'duct'});
      else add(e.id,'enclosure','容纳结构',b,{primitive:'box',bounds_m:b,material:e.material});
      if(e.type==='duct')objects.at(-1).parts[0].transform_mm=[1,0,0,e.x*1000,0,0,1,0,0,-1,0,e.z*1000];
    }
    const bf=sec.backfill;if(bf){const b=[bf.x-bf.width/2,0,bf.z-bf.height/2,bf.x+bf.width/2,length,bf.z+bf.height/2];add(bf.id,'backfill',bf.label||'回填区',b,{primitive:'box',bounds_m:b,material:bf.material});}
    const bs=objects.map(o=>o.bounds_m);if(!bs.length)throw new Error('截面没有可显示的电缆。');const xmin=Math.min(...bs.map(b=>b[0])),xmax=Math.max(...bs.map(b=>b[3])),layers=sec.soil_layers||[],zmin=Math.min(...bs.map(b=>b[2]),...layers.map(l=>l.bottom_z)),margin=Math.max(.15,(xmax-xmin)*.15),crop=[xmin-margin,0,zmin-(layers.length&&zmin===layers.at(-1).bottom_z?0:.15),xmax+margin,length,sec.kind==='ground'?0:Math.max(...bs.map(b=>b[5]))];
    if(sec.kind==='ground'){
      const bands=[];let top=0;for(const l of layers){if(top>l.top_z)bands.push({id:sec.id+'/soil-upper',label:'基准土壤',material:sec.medium.material,top_z:top,bottom_z:l.top_z});bands.push(l);top=l.bottom_z;}if(top>crop[2])bands.push({id:sec.id+'/soil-base',label:'基准土壤',material:sec.medium.material,top_z:top,bottom_z:crop[2]});
      for(const [i,l]of bands.entries()){const b=[crop[0],0,l.bottom_z,crop[3],length,l.top_z];add(l.id,'soil',l.label,b,{primitive:'box',bounds_m:b,material:l.material},{tint_index:i});}
      const b=[crop[0],0,0,crop[3],length,0];add(sec.id+'/ground','ground','地表 z=0',b,{primitive:'plane',bounds_m:b});
    }
    if(!crop.every(Number.isFinite))throw new Error('场景显示窗口无效。');
    return {schema:'cablesim.cad-scene/1',envelope:true,section_id:sec.id,label:sec.label,length_m:length,geometry_unit:'m',brep_unit:'mm',coordinate_frame:'x/y/z',extrusion_axis:'+Y',crop_bounds_m:crop,objects,assets,material_sources:doc.materials};
  }
  function currentModel(){return cache.get(activeKey)?.model||planned?.envelope||null;}
  function selected(){return currentModel()?.objects.find(o=>o.id===selectedId)||null;}
  function sync(){if(active()){StudyShell.refreshSelection();const tools=container?.querySelector('.model-scene-tools');if(tools){tools.querySelector('[data-scene-export]').disabled=!cache.get(activeKey)?.model;tools.querySelector('span').textContent='展示段 '+Math.round((currentModel()?.length_m||.4)*1000)+' mm';}}}
  function select(id){const o=currentModel()?.objects.find(o=>o.id===id);if(!o||o.kind==='ground')return;selectedId=id;const sec=source().sec;
    StudySection.restoreSelection({selected:o.kind==='cable'?id:null,region:o.kind==='cable'?null:o.kind==='backfill'?'backfill':id,tableSelected:false});C.A.inspectorClosed['section/three-dimensional']=false;
    viewer?.select(currentModel().objects.findIndex(o=>o.id===id));sync();
  }
  function objectsNav(){const m=currentModel();if(!m)return '';const E=C.H.esc;return `<div class="section-tree">${m.objects.filter(o=>o.kind!=='ground').map(o=>`<button class="object-row ${o.id===selectedId?'selected':''}" data-scene-select="${E(o.id)}" aria-pressed="${o.id===selectedId}" title="${E(o.label)}">${E(o.label)}</button>`).join('')}</div>`;}
  function inspector(){const o=selected(),E=C.H.esc,m=currentModel();if(!o||!m)return '<div class="inspector-head"><h2>敷设三维</h2></div><div class="inspector-section"><p>选择一根电缆或区域查看属性。</p></div>';
    const property=(k,v)=>`<div class="study-prop"><span>${E(k)}</span><span class="study-value number">${E(v)}</span></div>`,n=v=>Number.isFinite(v)?v.toFixed(3):'未提供';
    const dims=o.kind==='cable'?property('横向位置 x',n(o.position_m.x)+' m')+property('竖向位置 z',n(o.position_m.z)+' m')+property('绘图外径',(o.outer_diameter_m*1000).toFixed(1)+' mm'):`${property('x 范围',n(o.bounds_m[0])+' 至 '+n(o.bounds_m[3])+' m')}${property('z 范围',n(o.bounds_m[2])+' 至 '+n(o.bounds_m[5])+' m')}`;
    const asset=m.assets[o.parts[0].asset_id],material=m.material_sources.find(a=>a.id===asset.material),method=planned?.plugin.method;
    return `<div class="inspector-head"><h2>${E(o.label)}</h2><small>${E(m.label)}</small></div><div class="inspector-section"><h3>场景位置</h3>${dims}${property('展示长度',(m.length_m*1000).toFixed(0)+' mm')}<a href="${C.href('section',o.kind==='cable'?'section':'media',null)}">${o.kind==='cable'?'在截面中编辑位置':'查看截面介质与容纳结构'}</a></div><div class="inspector-section"><h3>${o.kind==='cable'?'型号':'区域'}</h3><p>${E(o.type_label||material?.label||o.label)}</p><p class="subtle">${E(m.envelope?'尺寸显示包络 · 等待精细实体':asset.representation||'原生场景实体')}</p></div><div class="inspector-section"><h3>几何来源</h3><p class="subtle">${m.envelope?'精细几何更新中':`建模插件 ${E(method?.version||'')} · ${C.H.state.dirty?'当前草稿':'保存输入 r'+C.H.state.record.revision}`}</p>${problem?`<p class="warning">${E(problem)}</p>`:''}</div>`;
  }
  async function ensureViewer(el,m){
    if(viewer&&container){if(container.parentElement!==el)el.replaceChildren(container);return viewer;}
    if(mounting)return mounting;const life=lifetime;
    container=document.createElement('div');container.className='model-scene-host';el.replaceChildren(container);
    const viewportHost=document.createElement('div');viewportHost.className='model-scene-canvas';container.append(viewportHost);
    mounting=viewportModule.then(async({mountCadViewport})=>{
      const v=await mountCadViewport(viewportHost,m,{selected:Math.max(0,m.objects.findIndex(o=>o.id===selectedId)),mode,initialCamera:camera,section,isCurrent:()=>life===lifetime&&active(),
        onSelect:i=>select(currentModel()?.objects[i]?.id),onChange:value=>{camera=value;mode=value.mode;section=value.section;},loadExact:exactModel});
      if(life!==lifetime||!active()){v?.dispose();return null;}viewer=v;shown=m;
      container.insertAdjacentHTML('beforeend',`<div class="model-scene-tools"><span>展示段 ${Math.round(m.length_m*1000)} mm</span><button class="quiet" data-scene-fit aria-label="适应敷设场景">${C.H.icon('tool/fit')}适应</button><button class="quiet" data-scene-export disabled>${C.H.icon('action/export')}STEP</button></div>`);sync();return v;
    }).finally(()=>{mounting=null;});return mounting;
  }
  async function paint(m,key,envelope=false){
    if(!active()||key!==activeKey)return;const el=C.H.$('#study-stage');if(!el)return;const token=request,at=performance.now(),v=await ensureViewer(el,m);if(!v||!active()||token!==request||key!==activeKey)return;
    if(shown!==m){if(!await v.update(m,{envelope,isLatest:()=>token===request&&key===activeKey,onProgress:envelope?undefined:(n,total)=>v.updating(`场景实体 ${n}/${total}`)}))return;shown=m;}
    const index=m.objects.findIndex(o=>o.id===selectedId);if(index>=0)v.select(index);
    if(envelope){v.updating('尺寸包络 · 场景精细实体更新中');return;}
    v.updating('');timings.viewport_ms=performance.now()-at;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(token!==request||key!==activeKey)return;
    timings.total_ms=performance.now()-(cache.get(key)?.startedAt||at);timings.first_mount_ms=mountAt?performance.now()-mountAt:null;sync();
  }
  function prepare(ctx){
    if(studyId!==ctx.A.study.id){dispose();request++;clearTimeout(timer);camera={};selectedId=null;planned=null;activeKey='';studyId=ctx.A.study.id;}C=ctx;
    const {doc,sec,plugin,capability}=source();if(!doc||!sec||ctx.A.draft.input_source!=='domain'){problem='此研究尚未提供领域敷设截面。';planned=null;activeKey='';return;}
    if(!plugin||!capability){problem='未发现敷设场景几何能力，请刷新插件方法清单。';planned=null;activeKey='';return;}
    let envelope;try{envelope=scaffold(doc,sec);}catch(error){problem=error.message;return;}
    const key=JSON.stringify([ctx.A.study.workspace,doc,sec.id,envelope.length_m,envelope.crop_bounds_m,plugin.method,capability.id]);
    planned={doc:structuredClone(doc),sec,plugin,capability,envelope,key,revision:ctx.H.state.record.revision,wid:ctx.A.study.workspace};
    const selection=StudySection.selection();if(selection.selected&&envelope.objects.some(o=>o.id===selection.selected))selectedId=selection.selected;else if(selection.region==='backfill'&&sec.backfill)selectedId=sec.backfill.id;else if(selection.region&&envelope.objects.some(o=>o.id===selection.region))selectedId=selection.region;else if(!envelope.objects.some(o=>o.id===selectedId))selectedId=envelope.objects[0].id;
    if(activeKey===key){if(active())paint(cache.get(key)?.model||envelope,key,!cache.has(key)).catch(fail);return;}
    activeKey=key;problem='';clearTimeout(timer);const token=++request,startedAt=performance.now();timings={};
    if(cache.has(key)){if(active())paint(cache.get(key).model,key).catch(fail);return;}
    const plan=planned;
    if(active())paint(envelope,key,true).catch(fail);
    timer=setTimeout(async()=>{
      const sentAt=performance.now();try{
        const result=await ctx.H.api(`/design/workspaces/${plan.wid}/geometry-preview`,{method:'POST',body:JSON.stringify({expected_revision:plan.revision,document:plan.doc,method:{...plan.plugin.method,capability:plan.capability.id},parameters:{section_id:plan.sec.id,length_m:plan.envelope.length_m,crop_bounds_m:plan.envelope.crop_bounds_m,include_exact:false}})});
        if(token!==request||key!==activeKey)return;const m=result.artifacts?.['x-cablesim.cad-scene'];if(m?.schema!=='cablesim.cad-scene/1')throw new Error('插件没有返回有效敷设场景。');
        cache.set(key,{model:m,source:result,plan,startedAt});while(cache.size>6)cache.delete(cache.keys().next().value);
        timings={request_ms:performance.now()-sentAt,debounce_ms:sentAt-startedAt,build:m.build_stats,server:result.profiling,host:result.environment.host_profiling,runtime:result.environment.profiling};
        problem='';if(active())await paint(m,key);sync();
      }catch(error){if(token===request){problem=error.message;viewer?.updating('场景更新失败 · 当前为显示包络');sync();}}
    },Math.max(0,150-(performance.now()-startedAt)));
  }
  function fail(error){problem=error.message;C?.H.fail(error);}
  function mount(el,ctx){mountAt=performance.now();prepare(ctx);if(problem){if(container&&viewer&&planned){el.replaceChildren(container);viewer.updating('保留原有场景 · '+problem);}else{dispose();el.innerHTML=`<p class="empty">${ctx.H.esc(problem)}</p>`;}return;}if(container&&viewer)el.replaceChildren(container);const m=currentModel();if(m)paint(m,activeKey,!!m.envelope).catch(fail);else el.innerHTML=`<p class="empty">${ctx.H.esc(problem||'正在准备敷设场景…')}</p>`;}
  async function exactModel(){
    const key=activeKey,item=cache.get(key);if(!item)throw new Error('请等待当前场景预览完成。');if(item.exact)return item.exact;
    if(!item.exactPromise)item.exactPromise=(async()=>{const p=item.plan,result=await C.H.api(`/design/workspaces/${p.wid}/geometry-preview`,{method:'POST',body:JSON.stringify({expected_revision:C.H.state.record.revision,document:p.doc,method:{...p.plugin.method,capability:p.capability.id},parameters:{section_id:p.sec.id,length_m:p.envelope.length_m,crop_bounds_m:p.envelope.crop_bounds_m,include_exact:true}})}),m=result.artifacts?.['x-cablesim.cad-scene'];if(key!==activeKey||cache.get(key)!==item||!m?.step_text||m.input_sha256!==item.model.input_sha256||JSON.stringify(m.objects)!==JSON.stringify(item.model.objects))throw new Error('场景输入已变化，请重新导出。');item.exact=m;return m;})().finally(()=>{item.exactPromise=null;});return item.exactPromise;
  }
  async function download(){C.H.notify('正在准备场景 STEP…');const m=await exactModel(),source=cache.get(activeKey).source;
    const trace=`/* CableSimPro installation preview; plugin=${source.method.plugin_id}; version=${source.method.version}; release_digest=${source.method.release_digest}; document_sha256=${m.input_sha256}; section=${m.section_id}; length_m=${m.length_m}; soil_crop=display_only; units=mm */`;
    const url=URL.createObjectURL(new Blob([m.step_text.replace('ISO-10303-21;','ISO-10303-21;\n'+trace)],{type:'application/step'})),a=document.createElement('a');a.href=url;a.download='installation-scene.step';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);C.H.notify('场景 STEP 已导出');
  }
  function dispose(){lifetime++;viewer?.dispose();viewer=null;container=null;mounting=null;shown=null;mountAt=0;}
  document.addEventListener('click',e=>{if(!active())return;const node=e.target.closest('[data-scene-select]');if(node){select(node.dataset.sceneSelect);return;}if(e.target.closest('[data-scene-fit]'))viewer?.fit();if(e.target.closest('[data-scene-export]'))download().catch(fail);});
  return {prepare,mount,dispose,objectsNav,inspector,hasSelection:()=>!!selected(),select,model:()=>cache.get(activeKey)?.model||null,performance:()=>({timings,viewport:viewer?.info(),camera,updating:!cache.has(activeKey)||!!cache.get(activeKey)?.model&&shown!==cache.get(activeKey).model,error:problem}),project:(...a)=>viewer?.project(...a),exactModel};
})();
export const CableScene=window.CableScene;
