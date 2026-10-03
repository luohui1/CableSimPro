const specifications = [
  ['icon-select','图标选中','当前位置随选择移动，图标按自身结构描出。鼠标与方向键均可切换。','200–320 ms','切换工程目录'],
  ['run-conduct','运行传导','从运行按钮传入截面，导体向外传导两圈。','800 ms','重播传导'],
  ['running','执行中','虚线状态环匀速转动，操作保持可用。','1200 ms 循环','开始'],
  ['result-arrive','结果到达','数值三次缓出到终值，状态变为当前。','420 ms','接收结果'],
  ['result-stale','结果变为历史','保存输入变更后，原结论退为历史。','320 ms','保存变更'],
  ['run-failed','运行失败','斜线与具体原因出现。','200 ms','触发失败'],
  ['draft-mark','草稿标记','修改数值，字段显示需注意色虚线。','120 ms','修改字段'],
  ['revision-saved','保存修订','草稿变为已保存，修订号更新。','200 ms','保存修订'],
  ['proposal-arrive','提案出现','青色虚线沿提案边界描出。','320 ms','收到提案'],
  ['select-frame','选中对象','墨线框从对象外 4 px 收紧。','120 ms','选中'],
  ['snap-guide','捕捉参考线','拖动圆形对象；命中轴线即显示参考线。','即时','命中 / 离开'],
  ['drawer','抽屉','打开与关闭时透明度变化，位移 4 px。','200 ms','打开'],
  ['anchor-scroll','目录定位','定位到指定节，标题短暂显示悬停底。','320 ms','定位计算'],
  ['agent-stream','Agent 流式输出','内容随段落到达而显示，无闪烁光标。','每段 120 ms','接收回复'],
  ['agent-step','工具调用','读取、预检、提案依次调用，对应图标同步描线。','200 ms 切换','演示工具调用']
];
const status = (kind,label) => `<span class="state-line"><span class="status ${kind}" aria-hidden="true"></span><span class="state-label">${label}</span></span>`;
const icons = {};
let selectionControllers=[];
const selectionExamples=[
  ['全局导航',[['home','nav/home','首页'],['type','nav/cable-type','型号'],['research','nav/study','研究'],['library','nav/library','库'],['plugin','nav/plugin','插件'],['settings','nav/settings','设置']]],
  ['工程目录',[['cable','object/cable','电缆结构'],['section','object/section','敷设截面'],['route','object/route','线路'],['study','object/study','计算']]],
  ['编辑工具',[['select','tool/select','选择'],['pan','tool/pan','平移'],['snap','tool/snap','捕捉'],['measure','tool/measure','测量']]]
];
const selectionStage=()=>'<div class="selection-examples">'+selectionExamples.map(([label,entries])=>'<div class="selection-example"><span class="note">'+label+'</span><div class="icon-choices" data-selection-mode="navigation" role="group" aria-label="'+label+'">'+entries.map(([name,key,title],i)=>'<button class="icon-choice" data-icon-key="'+key+'" aria-pressed="'+(i===0)+'"><span class="icon-glyph" data-icon="'+name+'" aria-hidden="true"></span>'+title+'</button>').join('')+'</div></div>').join('')+'</div>';
const toolSteps = [
  {icon:'read',name:'敷设截面',waiting:'待读取',working:'读取中',done:'已读取'},
  {icon:'preflight',name:'输入预检',waiting:'待预检',working:'预检中',done:'预检通过'},
  {icon:'proposal',name:'变更提案',waiting:'待生成',working:'生成中',done:'待审核'}
];
const toolRows = () => toolSteps.map(step=>`<div class="tool-row" data-tool="${step.icon}" data-state="waiting"><span class="tool-icon" aria-hidden="true"><span class="tool-glyph" data-icon="${step.icon}"></span><span class="tool-trace" data-icon="${step.icon}"></span></span><span class="tool-name">${step.name}</span><span class="tool-label">${step.waiting}</span></div>`).join('');
const section = `<svg class="cross-section" viewBox="0 0 160 96" fill="none" aria-label="演示电缆截面"><path class="conduct-track" d="M0 48H62"/><path class="conduct-lead" d="M0 48H62" pathLength="1"/><circle cx="104" cy="48" r="36" stroke="currentColor" stroke-width="1.5"/><circle class="insulation" cx="104" cy="48" r="25" stroke-width="1.5"/><circle class="conductor" cx="104" cy="48" r="12"/><circle class="wave wave-one" cx="104" cy="48" r="12" stroke-width="1.5"/><circle class="wave wave-two" cx="104" cy="48" r="12" stroke-width="1.5"/></svg>`;
const stages = {
  'icon-select': selectionStage(),
  'run-conduct': '<div class="conduct-flow"><button class="copper run-button" data-trigger><span class="run-glyph" data-icon="run" aria-hidden="true"></span>运行计算</button>'+section+'</div>',
  running: status('queued','排队')+'<span class="note">演示任务 · 可随时停止</span>',
  'result-arrive': '<div><div class="metric"><span class="number">632</span> <small>A</small></div><span class="note">模型允许电流 · 演示</span></div>'+status('historical','等待新结果'),
  'result-stale': '<div><div class="metric">648 <small>A</small></div><span class="note">运行 R12 · 演示</span></div>'+status('current','当前'),
  'run-failed': '<div><span class="state-line"><svg class="failure-mark" viewBox="0 0 10 10" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="4.5" stroke="currentColor"/><path class="failure-line" d="M2 8 8 2" stroke="currentColor" stroke-width="1" style="opacity:0"/></svg><span class="failure-label">待预检</span></span><p class="error-reason">缺少导体 R₂₀，请补充后重试。</p></div>',
  'draft-mark': '<label for="depth">埋深 <input class="draft-input" id="depth" type="number" min="0" step="0.1" value="0.8"> <span class="note">m</span></label>'+status('current','已保存'),
  'revision-saved': '<span class="note">演示工程</span><span class="revision">修订 <span class="number">12</span></span>'+status('draft','未保存'),
  'proposal-arrive': '<div class="proposal-box"><svg class="proposal-border" aria-hidden="true"><defs><mask id="proposal-reveal" class="proposal-mask"><rect class="proposal-reveal" x=".5" y=".5" width="99%" height="98%" rx="12" fill="none" stroke="currentColor" stroke-width="3"/></mask></defs><rect class="proposal-line" x=".5" y=".5" width="99%" height="98%" rx="12" stroke-dasharray="4 4" mask="url(#proposal-reveal)"/></svg><strong>调整敷设埋深</strong><p class="mono">0.8 m → 1.0 m</p><p class="note">提案待审核 · 工程尚未改变</p></div>',
  'select-frame': '<div class="selection-object">电缆 A · 结构对象<span class="selection-frame"></span></div><span class="note">单选</span>',
  'snap-guide': '<span class="snap-target"></span><span class="snap-reference"></span><div class="snap-object" tabindex="0" role="slider" aria-label="电缆横向位置" aria-valuemin="-80" aria-valuemax="80" aria-valuenow="-80"></div><span class="snap-hint">拖动或使用左右方向键</span>',
  drawer: '<span class="note">工程文档</span><div class="drawer-content"><strong>工程助手</strong><p class="note">读取当前工程，修改以提案呈现。</p></div>',
  'anchor-scroll': '<nav class="anchor-list" aria-label="演示目录"><button data-anchor="0">对象</button><button data-anchor="1">计算</button><button data-anchor="2">交付</button></nav><div class="scroll-document" tabindex="0" aria-label="演示工程文档"><section><h3>对象</h3><p>电缆结构与敷设截面</p></section><section><h3>计算</h3><p>研究参数、预检与运行</p></section><section><h3>交付</h3><p>引用已保存的运行</p></section></div>',
  'agent-stream': '<p class="stream-paragraph">已读取当前敷设截面。</p><p class="stream-paragraph">修改建议会生成提案，待你审核后应用。</p>',
  'agent-step': '<div class="tool-flow">'+toolRows()+'</div>'
};
const media = matchMedia('(prefers-reduced-motion: reduce)');
const active = new Map();
const reduced = () => media.matches || document.querySelector('#reduce').checked;
function cancel(id) {
  const record=active.get(id);
  if (record) { record.cancelled=true; record.animations.forEach(a=>a.stop()); record.timers.forEach(clearTimeout); }
  active.delete(id);
}
function context(id) {
  cancel(id);
  const record={animations:[],timers:[],cancelled:false};
  active.set(id,record);
  return {
    animate(subject,keyframes,options={}) {
      const animation=Motion.animate(subject,keyframes,{ease:[.2,0,0,1],...options});
      record.animations.push(animation); return animation;
    },
    later(fn,ms) { record.timers.push(setTimeout(()=>{if(!record.cancelled)fn();},ms)); },
    valid:()=>!record.cancelled
  };
}
function state(card,kind,label) {
  const dot=card.querySelector('.state-line .status');
  if(dot)dot.className='status '+kind;
  const text=card.querySelector('.state-label');
  if(text)text.textContent=label;
}
function feedback(card,text) { card.querySelector('.feedback').textContent=text; }
function reflow(element) { void element.offsetWidth; }
function hydrateIcons(root) {
  root.querySelectorAll('[data-icon]').forEach(element=>element.innerHTML=icons[element.dataset.icon]);
}
function play(id,options={}) {
  const card=document.getElementById(id), ctx=context(id), instant=reduced();
  const get=selector=>card.querySelector(selector);
  const button=get('.demo-play');
  card.dataset.played='true';
  if(id==='icon-select') {
    const choices=getAllChoices();
    const current=get('.selection-example:nth-child(2) .icon-choices').dataset.selected||'object/cable';
    selectionControllers[1].select(choices[(choices.indexOf(current)+1)%choices.length]);
  } else if(id==='run-conduct') {
    // Replace the SVG so a cancelled renderer cannot restore an old frame.
    get('.cross-section').outerHTML=section;
    card.dataset.phase=instant?'started':'conducting';
    feedback(card,instant?'已发起 · 演示':'传导中 · 演示');
    if(instant)return;
    ctx.animate(get('.conduct-lead'),{strokeDashoffset:[1,0,0],opacity:[1,1,0]},{duration:.32,times:[0,.65,1]});
    for(const [index,selector] of ['.wave-one','.wave-two'].entries()) {
      const ring=get(selector);
      // Animate the SVG radius directly: its center stays fixed at every scale.
      ctx.animate(12,36,{duration:.56,delay:.12+index*.12,ease:'linear',onUpdate:r=>ring.setAttribute('r',r)});
      ctx.animate(ring,{opacity:[0,.9,.75,0]},{duration:.56,delay:.12+index*.12,times:[0,.15,.75,1]});
    }
    ctx.later(()=>{card.dataset.phase='started';feedback(card,'已发起 · 演示');},800);
  } else if(id==='running') {
    const running=card.dataset.running!=='true'; card.dataset.running=String(running);
    state(card,running?'running':'historical',running?'执行中':'已停止');
    button.textContent=running?'停止':'开始'; feedback(card,running?(instant?'静态执行中':'1200 ms / 圈'):'演示已停止');
  } else if(id==='result-arrive') {
    get('.number').textContent=instant?'648':'632'; state(card,instant?'current':'running',instant?'当前':'执行中');
    if(!instant)ctx.animate(632,648,{duration:.42,ease:t=>1-Math.pow(1-t,3),onUpdate:v=>get('.number').textContent=Math.round(v),onComplete:()=>{if(ctx.valid())state(card,'current','当前');}});
    feedback(card,'632 → 648 A · 演示');
  } else if(id==='result-stale') {
    get('.metric').classList.remove('historical'); reflow(get('.metric')); get('.metric').classList.add('historical');
    state(card,'historical','历史'); feedback(card,'输入已保存为新修订');
  } else if(id==='run-failed') {
    const line=get('.failure-line'); line.style.opacity='1';
    if(instant){line.style.strokeDasharray='none';line.style.strokeDashoffset='0';}
    else ctx.animate(line,{pathLength:[0,1]},{duration:.2});
    get('.error-reason').classList.remove('visible'); reflow(get('.error-reason')); get('.error-reason').classList.add('visible');
    get('.failure-label').textContent='预检未通过'; feedback(card,'补充字段后可重试');
  } else if(id==='draft-mark') {
    const field=get('.draft-input'); if(!options.fromInput)field.value=field.value==='0.8'?'1.0':'0.8';
    const dirty=field.value!=='0.8'; field.classList.toggle('is-draft',dirty);
    state(card,dirty?'draft':'current',dirty?'草稿':'已保存'); feedback(card,dirty?'字段变更尚未保存':'与已保存值一致');
  } else if(id==='revision-saved') {
    state(card,'current','已保存');
    if(instant)get('.number').textContent='13';
    else ctx.animate(12,13,{duration:.2,onUpdate:v=>get('.number').textContent=Math.round(v)});
    feedback(card,'修订 12 → 13 · 演示');
  } else if(id==='proposal-arrive') {
    get('.proposal-box').classList.add('visible');
    const line=get('.proposal-reveal');
    line.removeAttribute('style');
    if(instant){line.style.strokeDasharray='none';line.style.strokeDashoffset='0';}
    else ctx.animate(line,{pathLength:[0,1]},{duration:.32});
    feedback(card,'提案待审核');
  } else if(id==='select-frame') {
    const frame=get('.selection-frame'); frame.style.opacity='1';
    if(instant)frame.style.inset='0px';
    else ctx.animate(frame,{inset:['-4px','0px']},{duration:.12});
    feedback(card,'已选中 电缆 A');
  } else if(id==='snap-guide') {
    const hit=card.dataset.snap!=='true'; setSnap(card,hit?0:-80); feedback(card,hit?'命中轴线':'已离开轴线');
  } else if(id==='drawer') {
    const open=card.dataset.open!=='true'; card.dataset.open=String(open);
    const drawer=get('.drawer-content'); drawer.setAttribute('aria-hidden',String(!open));
    if(instant){drawer.style.opacity=open?'1':'0';drawer.style.transform='none';}
    else ctx.animate(drawer,{opacity:open?[0,1]:[1,0],x:open?[4,0]:[0,4]},{duration:.2,ease:open?[.2,0,0,1]:[.4,0,1,1]});
    button.textContent=open?'关闭':'打开'; feedback(card,open?'抽屉已打开':'抽屉已关闭');
  } else if(id==='anchor-scroll') {
    const scroller=get('.scroll-document'), target=options.target??1, heading=scroller.children[target].querySelector('h3');
    const destination=scroller.children[target].offsetTop-scroller.firstElementChild.offsetTop;
    for(const h of card.querySelectorAll('h3.highlight'))h.classList.remove('highlight');
    const highlight=()=>{if(ctx.valid()){heading.classList.add('highlight');ctx.later(()=>heading.classList.remove('highlight'),800);}};
    if(instant){scroller.scrollTop=destination;highlight();}
    else ctx.animate(scroller.scrollTop,destination,{duration:.32,onUpdate:v=>scroller.scrollTop=v,onComplete:highlight});
    feedback(card,'已定位 '+heading.textContent);
  } else if(id==='agent-stream') {
    const paragraphs=[...card.querySelectorAll('.stream-paragraph')]; paragraphs.forEach(p=>p.classList.remove('visible')); reflow(card);
    paragraphs.forEach((p,i)=>{if(instant)p.classList.add('visible');else ctx.later(()=>p.classList.add('visible'),i*240);});
    feedback(card,'两段演示回复');
  } else if(id==='agent-step') {
    const flow=get('.tool-flow');flow.innerHTML=toolRows();hydrateIcons(flow);
    const rows=[...flow.children];
    const finish=index=>{rows[index].dataset.state='done';rows[index].querySelector('.tool-label').textContent=toolSteps[index].done;};
    if(instant){rows.forEach((_,i)=>finish(i));feedback(card,'提案待审核 · 演示');return;}
    const begin=index=>{
      const row=rows[index],step=toolSteps[index];
      row.dataset.state='active';row.querySelector('.tool-label').textContent=step.working;
      feedback(card,step.name+' · 演示');
      // Reuse the original glyph. The base stays visible as the active stroke draws.
      const strokes=row.querySelectorAll('.tool-trace path');
      const stroke=step.icon==='read'?strokes[0]:strokes[strokes.length-1];
      row.querySelectorAll('.tool-trace path, .tool-trace rect').forEach(shape=>shape.style.opacity=shape===stroke?'1':'0');
      ctx.animate(stroke,{pathLength:[0,1]},{duration:.8,ease:'linear'});
      ctx.later(()=>{
        finish(index);
        if(index<rows.length-1)begin(index+1);
        else feedback(card,'提案待审核 · 演示');
      },800);
    };
    begin(0);
  }
}
function getAllChoices(){return selectionExamples[1][1].map(([,key])=>key);}
function setSnap(card,x) {
  const value=Math.abs(x)<=6?0:Math.max(-80,Math.min(80,x));
  card.dataset.snap=String(value===0);
  const object=card.querySelector('.snap-object'); object.style.left=`calc(50% - 20px + ${value}px)`;object.setAttribute('aria-valuenow',String(Math.round(value)));
  card.querySelector('.snap-reference').style.visibility=value===0?'visible':'hidden';
}
function wireSnap(card) {
  const object=card.querySelector('.snap-object'),stage=card.querySelector('.stage');
  object.addEventListener('pointerdown',event=>{object.setPointerCapture(event.pointerId);card.dataset.dragging='true';});
  object.addEventListener('pointermove',event=>{if(card.dataset.dragging==='true'){const box=stage.getBoundingClientRect();setSnap(card,event.clientX-box.left-box.width/2);}});
  object.addEventListener('pointerup',()=>card.dataset.dragging='false');
  object.addEventListener('pointercancel',()=>card.dataset.dragging='false');
  object.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();setSnap(card,event.key==='Home'?0:Number(object.getAttribute('aria-valuenow'))+(event.key==='ArrowRight'?10:-10));}});
}
function reset() {
  selectionControllers.forEach(controller=>controller.destroy());selectionControllers=[];
  for(const id of active.keys())cancel(id);
  document.querySelector('#demos').innerHTML=specifications.map(([id,title,description,duration,action])=>
    `<article class="demo" id="${id}"><div class="demo-heading"><h2><a href="${id}.md">${title}</a></h2><span class="note mono">${duration}</span></div><p class="demo-description">${description}</p><div class="stage ${id==='agent-stream'?'column':''} ${id==='snap-guide'?'snap-stage':''} ${id==='drawer'?'drawer-stage':''} ${id==='anchor-scroll'?'anchor-stage':''}">${stages[id]}</div><div class="demo-controls"><button class="demo-play ${id==='proposal-arrive'?'agent':''}">${action}</button><span class="feedback">等待操作</span></div></article>`).join('');
  for(const [id] of specifications) {
    const card=document.getElementById(id);
    card.querySelector('.demo-play').addEventListener('click',()=>play(id));
    card.querySelector('[data-trigger]')?.addEventListener('click',()=>play(id));
  }
  document.querySelector('#draft-mark input').addEventListener('input',()=>play('draft-mark',{fromInput:true}));
  document.querySelectorAll('[data-anchor]').forEach(b=>b.addEventListener('click',()=>play('anchor-scroll',{target:Number(b.dataset.anchor)})));
  for(const event of ['wheel','touchstart','keydown'])document.querySelector('.scroll-document').addEventListener(event,()=>cancel('anchor-scroll'),{passive:true});
  wireSnap(document.querySelector('#snap-guide'));
  hydrateIcons(document.querySelector('#demos'));
  const selectionCard=document.getElementById('icon-select');
  selectionControllers=[...selectionCard.querySelectorAll('.icon-choices')].map(root=>CableIconSelection.mount(root,{reduced,onChange:(key,effect)=>{
    selectionCard.dataset.played='true';feedback(selectionCard,root.querySelector('[data-icon-key="'+key+'"]').lastChild.textContent+' · '+effect.label);
  }}));
  for(const id of ['icon-select','run-conduct','agent-step'])document.querySelector(`#${id} .feedback`).setAttribute('role','status');
}
function syncReduced() {
  document.documentElement.dataset.reduced=String(reduced());
  document.querySelector('#reduce-state').textContent=media.matches?'系统已开启，状态直接切换':reduced()?'已开启，状态直接切换':'跟随系统，可手动开启';
  if(reduced()) {
    selectionControllers.forEach(controller=>controller.settle());
    // Complete Motion's own values before clearing DOM styles. Stopping mid-frame
    // would let its queued renderer restore an intermediate ring/path later.
    for(const record of active.values())record.animations.forEach(animation=>animation.complete());
    for(const card of document.querySelectorAll('.demo[data-played="true"]')) {
      // Preserve the destination, without reversing toggle demos during a preference change.
      if(['running','drawer','snap-guide','icon-select'].includes(card.id)) {
        cancel(card.id);
        if(card.id==='drawer'){const d=card.querySelector('.drawer-content');d.style.transform='none';d.style.opacity=card.dataset.open==='true'?'1':'0';}
      } else play(card.id,card.id==='draft-mark'?{fromInput:true}:{});
    }
  }
}
async function start() {
  if(!window.Motion)throw new Error('Motion 未加载；请先在 design 目录运行 npm ci。');
  const fetchSvg=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(url);return r.text();};
  const [mark]=await Promise.all([
    fetchSvg('../brand/mark.svg'),
    ...Object.entries({run:'run/run',read:'agent/step-read',preflight:'run/preflight',proposal:'agent/proposal',...Object.fromEntries(selectionExamples.flatMap(([,entries])=>entries.map(([name,key])=>[name,key])))}).map(async([name,path])=>icons[name]=await fetchSvg('../icons/'+path+'.svg'))
  ]);
  document.querySelector('#identity-mark').innerHTML=mark;
  reset();syncReduced();
  document.querySelector('#reset').addEventListener('click',reset);
  document.querySelector('#reduce').addEventListener('change',syncReduced);media.addEventListener('change',syncReduced);
  document.querySelector('#theme').addEventListener('click',event=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';event.currentTarget.setAttribute('aria-pressed',String(dark));event.currentTarget.textContent=dark?'页面：深色':'页面：浅色';});
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)return;
    for(const id of active.keys())cancel(id);
    const running=document.getElementById('running');
    if(running.dataset.running==='true'){running.dataset.running='false';state(running,'historical','演示已暂停');running.querySelector('.demo-play').textContent='开始';}
    const conduct=document.getElementById('run-conduct');
    if(conduct.dataset.phase==='conducting'){
      conduct.querySelector('.cross-section').outerHTML=section;
      conduct.dataset.phase='paused';feedback(conduct,'演示已暂停 · 可重播');
    }
    const tool=document.getElementById('agent-step'),row=tool.querySelector('[data-state="active"]');
    if(row){row.dataset.state='paused';row.querySelector('.tool-label').textContent='已暂停';feedback(tool,'演示已暂停 · 可重播');}
  });
  await document.fonts.ready;document.documentElement.dataset.ready='true';
}
start().catch(error=>{document.querySelector('#demos').innerHTML='<p class="loading-error">动效依赖未能加载。请在 design 目录执行 npm ci，然后 npm run preview。</p>';console.error(error);});
