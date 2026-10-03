import {createViewer} from './occt-viewer-adapter.js?continuous';

const fmt=n=>Number(n.toFixed(1)).toString();
const cube=`<svg class="model-cube" viewBox="0 0 128 132" aria-label="标准视角，点角切换等轴">
  <g data-cad-view="top" role="button" tabindex="0" aria-label="俯视"><path d="M14 39L64 10L114 39L64 68Z"/><text x="64" y="42">俯视</text></g>
  <g data-cad-view="front" role="button" tabindex="0" aria-label="侧视"><path d="M14 39L64 68V124L14 95Z"/><text x="39" y="88">侧视</text></g>
  <g data-cad-view="end" role="button" tabindex="0" aria-label="端面"><path d="M64 68L114 39V95L64 124Z"/><text x="89" y="88">端面</text></g>
  <g class="model-cube-corner" data-cad-view="iso" role="button" tabindex="0" aria-label="等轴视角"><title>点角切换等轴</title><circle class="corner-hit" cx="64" cy="68" r="12"/><circle class="corner-mark" cx="64" cy="68" r="3"/></g>
</svg>`;

// Read-only geometry component. Data loading, quantities and exports belong to its caller.
export async function mountCadViewport(host,model,{selected=0,mode='peel',measurement='part',section=.55,initialCamera={},loadExact,onSelect,onPick,onChange,onReady,isCurrent=()=>true}={}){
  let alive=true,base=null,camera={view:'等轴',yaw:0,...initialCamera},hit=null,points=[];
  const requestedSection=section;
  const events=new AbortController();
  host.innerHTML=`<div class="model-viewport" aria-label="三维 CAD 视口"><div class="model-canvas"></div>${cube}
    <div class="model-modes" role="group" aria-label="模型展示方式">${[['peel','剥切'],['section','剖面'],['transparent','透明']].map(([id,label])=>`<button data-cad-mode="${id}" aria-pressed="${mode===id}">${label}</button>`).join('')}</div>
    <svg class="model-dimensions" aria-label="选中层端面尺寸"></svg><button class="model-section-handle" aria-label="拖动轴向剖切面" title="沿电缆轴线拖动剖切面" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4m8-8 4 4-4 4"/></svg></button>
    <div class="model-measure-prompt" role="status" hidden></div><div class="model-update" role="status" hidden></div><div class="model-loading" role="status">正在加载 OCCT 视口…</div></div>`;
  const root=host.firstElementChild,canvasHost=root.querySelector('.model-canvas'),svg=root.querySelector('.model-dimensions'),handle=root.querySelector('.model-section-handle');
  root.dataset.cadModelKind=model.envelope?'envelope':'precise';
  root.querySelectorAll('[data-cad-mode]').forEach(button=>button.disabled=true);
  root.querySelectorAll('[data-cad-view]').forEach(button=>{button.setAttribute('aria-disabled','true');button.setAttribute('tabindex','-1');});
  const current=()=>alive&&root.isConnected&&isCurrent();
  function prompt(){const p=root.querySelector('.model-measure-prompt');p.hidden=measurement==='part'||model.envelope;p.textContent=measurement==='diameter'?'选择选中层的圆柱面或圆边，捕捉原始直径':hit?.measure_pending?'已捕捉第一点；请选择第二个边或顶点':'依次选择两个边或顶点，捕捉两点距离';}
  function overlays(){
    if(!base||!current())return;
    const project=(x,y,z)=>base.project(x,y,z),length=model.length_m*1000,a=project(0,0,0),b=project(0,0,length),p=project(0,0,length*section),rect=canvasHost.getBoundingClientRect(),row=model.layers[selected];
    handle.hidden=mode!=='section'||Math.hypot(b.x-a.x,b.y-a.y)<15;handle.style.left=p.x+'px';handle.style.top=p.y+'px';
    svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);let drawing='';
    if(mode==='section'&&camera.view!=='端面'){const r=model.outer_diameter_m*600,z=length*section,corners=[[-r,-r],[r,-r],[r,r],[-r,r]].map(([x,y])=>project(x,y,z));drawing+=`<path class="model-plane-outline" d="M${corners.map(c=>c.x+' '+c.y).join('L')}Z"/>`;}
    if(measurement==='point'&&points.length){const marks=points.map(q=>project(q.x_mm,q.y_mm,q.z_mm));drawing+=(marks.length===2?`<path class="model-point-line" d="M${marks[0].x} ${marks[0].y}L${marks[1].x} ${marks[1].y}"/>`:'')+marks.map(q=>`<circle class="model-point-mark" cx="${q.x}" cy="${q.y}" r="4"/>`).join('');}
    if(camera.view==='端面'&&row){const r=row.outer_radius_m*1000,inner=row.inner_radius_m*1000,c=project(0,0,0),left=project(-r*Math.cos(camera.yaw),r*Math.sin(camera.yaw),0),right=project(r*Math.cos(camera.yaw),-r*Math.sin(camera.yaw),0),y=Math.min(rect.height-82,c.y+Math.abs(left.x-c.x)+35);
      drawing+=`<path d="M${left.x} ${c.y}V${y+5}M${right.x} ${c.y}V${y+5}M${left.x} ${y}H${right.x}"/><text x="${c.x}" y="${y+20}" text-anchor="middle">本层外径 Ø ${fmt(r*2)} mm</text><text x="${c.x}" y="${Math.max(24,c.y-Math.abs(left.x-c.x)-28)}" text-anchor="middle">内径 Ø ${fmt(inner*2)} mm · 厚度 ${fmt(r-inner)} mm</text>`;
    }
    svg.innerHTML=drawing;
  }
  function view(name){if(['peel','section','transparent'].includes(name)){mode=name;root.querySelectorAll('[data-cad-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cadMode===mode)));}base?.view(name);overlays();}
  const activate=e=>{const target=e.target.closest('[data-cad-view],[data-cad-mode]');if(!target||!base)return;if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;e.preventDefault();e.stopPropagation();view(target.dataset.cadView||target.dataset.cadMode);};
  root.addEventListener('click',activate,{signal:events.signal});root.addEventListener('keydown',activate,{signal:events.signal});
  let drag;
  handle.addEventListener('pointerdown',e=>{e.preventDefault();handle.setPointerCapture(e.pointerId);const a=base.project(0,0,0),b=base.project(0,0,model.length_m*1000);drag={x:e.clientX,y:e.clientY,f:section,dx:b.x-a.x,dy:b.y-a.y};},{signal:events.signal});
  handle.addEventListener('pointermove',e=>{if(!drag)return;section=Math.max(.05,Math.min(.95,drag.f+2*((e.clientX-drag.x)*drag.dx+(e.clientY-drag.y)*drag.dy)/(drag.dx*drag.dx+drag.dy*drag.dy)));base.section(section);},{signal:events.signal});
  for(const event of ['pointerup','pointercancel'])handle.addEventListener(event,()=>{drag=null;},{signal:events.signal});
  base=await createViewer(canvasHost,model,{selected,mode,initialCamera,loadExact,isCurrent:current,
    onSelect:index=>{selected=index;onSelect?.(index);},
    onPick:value=>{hit=value;if(measurement==='point'&&Number.isFinite(value?.x_mm)){points=value.measure_pending?[value]:Number.isFinite(value.distance_mm)?[points[0],value].filter(Boolean):points;}prompt();overlays();onPick?.(value);},
    onChange:value=>{camera=value;section=value.section;root.dataset.cadViewState=value.view;root.dataset.cadModeState=mode;overlays();onChange?.({...value,mode,measurement});}
  });
  if(!current()||!base){base?.dispose();events.abort();return null;}
  await base.selection(measurement);base.measure(measurement==='point');base.section(requestedSection);root.querySelector('.model-loading')?.remove();prompt();overlays();
  root.querySelectorAll('[data-cad-mode]').forEach(button=>button.disabled=false);
  root.querySelectorAll('[data-cad-view]').forEach(button=>{button.removeAttribute('aria-disabled');button.setAttribute('tabindex','0');});
  await new Promise(requestAnimationFrame);if(!current()){base.dispose();return null;}onReady?.();
  return {
    async update(next,options={}){hit=null;points=[];const done=await base.update(next,options);if(done){model=next;root.dataset.cadModelKind=model.envelope?'envelope':'precise';base.measure(measurement==='point');prompt();overlays();}return done;},
    updating(text){const status=root.querySelector('.model-update');status.hidden=!text;status.textContent=text||'';root.setAttribute('aria-busy',String(!!text));},
    select(index){selected=index;base.select(index);overlays();},
    async selection(kind){const status=root.querySelector('.model-update');if(kind!=='part'&&!model.envelope){status.hidden=false;status.textContent='正在加载精确测量拓扑…';}try{if(!await base.selection(kind))return;measurement=kind;hit=null;points=[];base.measure(kind==='point');prompt();overlays();}finally{if(current()){status.hidden=true;status.textContent='';}}},
    measure:enabled=>base.measure(enabled),view,fit:()=>base.fit(),zoom:factor=>base.zoom(factor),
    section(value){base.section(value);},project:(...args)=>base.project(...args),info:()=>base.info(),profile:options=>base.profile(options),
    dispose(){alive=false;events.abort();base.dispose();if(host.firstElementChild===root)host.replaceChildren();}
  };
}
