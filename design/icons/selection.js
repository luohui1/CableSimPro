/* Shared selection behavior for the icon catalog and motion examples. */
window.CableIconSelection = (() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const instances = new Set();
  const shapes = 'path,circle,rect';
  function recipe(key) {
    if (/cable|material|thermal|magnetic|radial/.test(key)) return {kind:'layers',label:'从核心到外层，逐层描出'};
    if (/route|segment|crossing|profile|curve|voltage|bonding|derived|branch/.test(key)) return {kind:'path',label:'沿路径描出，再落定节点'};
    if (/study|table|scheme|condition|params|preflight|report|selection/.test(key)) return {kind:'fields',label:'外框保持稳定，内部字段依次显现'};
    if (/snap|locate|fit|align|dimension|measure|section-cut/.test(key)) return {kind:'precision',label:'基准线先定位，再描出操作标记'};
    return {kind:'outline',label:'轮廓短促描出，保持原图标形状'};
  }
  function mount(root,{reduced=()=>false,durationScale=()=>1,onChange=()=>{}}={}) {
    let selected=root.querySelector('.icon-choice[aria-pressed="true"]')?.dataset.iconKey;
    let focused=root.querySelector('.icon-choice[tabindex="0"]');
    let animations=[],traces=[],muted=[],markerAnimation;
    const marker=root.dataset.selectionMode==='navigation'?document.createElement('span'):null;
    if(marker){marker.className='selection-indicator';marker.setAttribute('aria-hidden','true');root.prepend(marker);}
    const buttons=()=>[...root.querySelectorAll('.icon-choice')];
    const available=()=>buttons().filter(button=>!button.disabled&&!button.closest('[hidden]'));
    const instant=()=>media.matches||reduced();
    const scale=()=>Math.min(3,Math.max(1,Number(durationScale())||1));
    function clear() {
      animations.forEach(animation=>animation.stop());animations=[];
      traces.forEach(trace=>trace.remove());traces=[];
      muted.forEach(shape=>shape.classList.remove('selection-source-muted'));muted=[];
    }
    function positionMarker(animate=false) {
      if(!marker)return;
      const button=buttons().find(item=>item.dataset.iconKey===selected);
      if(!button){marker.hidden=true;return;}
      marker.hidden=false;
      markerAnimation?.stop();
      const destination={left:button.offsetLeft,top:button.offsetTop,width:button.offsetWidth,height:button.offsetHeight};
      if(animate&&!instant())markerAnimation=Motion.animate(marker,destination,{duration:.2*scale(),ease:[.2,0,0,1]});
      else for(const[key,value]of Object.entries(destination))marker.style[key]=value+'px';
    }
    function draw(button,key) {
      const {kind}=recipe(key);
      button.querySelectorAll('.icon-glyph').forEach(glyph=>{
        const source=glyph.querySelector('svg');
        if(!source)return;
        const trace=source.cloneNode(true);
        trace.classList.add('selection-trace');trace.setAttribute('aria-hidden','true');
        trace.querySelector('title')?.remove();glyph.append(trace);traces.push(trace);
        let paths=[...trace.querySelectorAll(shapes)];
        const sources=[...source.querySelectorAll(shapes)];
        const original=new Map(paths.map((path,index)=>[path,sources[index]]));
        if(kind==='layers') {
          if(paths.some(path=>path.tagName==='circle'))paths.sort((a,b)=>{const aa=a.getBBox(),bb=b.getBBox();return aa.width*aa.height-bb.width*bb.height;});
          else paths.reverse();
        }
        if(kind==='path')paths.sort((a,b)=>(a.tagName==='circle')-(b.tagName==='circle'));
        if(kind==='precision')paths.sort((a,b)=>(a.tagName!=='path')-(b.tagName!=='path'));
        if(kind==='fields')paths=paths.filter(path=>path.tagName!=='rect');
        // Keep a faint guide only under moving strokes. Opaque source strokes
        // would mask the reveal and make the animation look like a color change.
        trace.querySelectorAll(shapes).forEach(path=>{if(!paths.includes(path))path.style.visibility='hidden';});
        const movingSources=paths.map(path=>original.get(path));
        movingSources.forEach(shape=>shape.classList.add('selection-source-muted'));muted.push(...movingSources);
        const finish=()=>{
          if(!traces.includes(trace))return;
          trace.remove();traces=traces.filter(item=>item!==trace);
          movingSources.forEach(shape=>shape.classList.remove('selection-source-muted'));
          muted=muted.filter(shape=>!movingSources.includes(shape));
        };
        if(!paths.length){finish();return;}
        paths.forEach((path,index)=>{
          path.style.opacity='0';
          const delay=paths.length>1?index*.12/(paths.length-1):0;
          const duration=paths.length>1?.2:.32;
          const opacity=path.getAttribute('fill')==='currentColor'?[0,1]:[1,1];
          animations.push(Motion.animate(path,{pathLength:[0,1],opacity},{duration:duration*scale(),delay:delay*scale(),ease:'linear',onComplete:index===paths.length-1?finish:undefined}));
        });
      });
    }
    function refresh() {
      const visible=available();
      if(!visible.includes(focused))focused=visible.find(button=>button.dataset.iconKey===selected)||visible[0];
      buttons().forEach(button=>button.tabIndex=button===focused?0:-1);
      positionMarker();
    }
    function select(key,{animate=true,focus=false}={}) {
      const button=available().find(item=>item.dataset.iconKey===key);
      if(!button)return;
      clear();selected=key;focused=button;
      buttons().forEach(item=>{item.setAttribute('aria-pressed',String(item===button));item.tabIndex=item===button?0:-1;});
      root.dataset.selected=key;
      positionMarker(animate);
      if(animate&&!instant())draw(button,key);
      if(focus)button.focus({preventScroll:root.dataset.selectionMode==='navigation'});
      onChange(key,recipe(key));
    }
    const click=event=>{
      const button=event.target.closest('.icon-choice');
      if(button&&root.contains(button)&&!button.disabled)select(button.dataset.iconKey);
    };
    const keydown=event=>{
      const button=event.target.closest('.icon-choice');
      if(!button||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();const list=available(),index=list.indexOf(button);
      const destination=event.key==='Home'?0:event.key==='End'?list.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+list.length)%list.length;
      select(list[destination].dataset.iconKey,{focus:true});
    };
    function settle(){clear();markerAnimation?.stop();positionMarker();}
    const observer=new ResizeObserver(()=>positionMarker());observer.observe(root);
    root.addEventListener('click',click);root.addEventListener('keydown',keydown);
    const api={select,refresh,settle,replay:()=>selected&&select(selected),destroy(){settle();observer.disconnect();marker?.remove();root.removeEventListener('click',click);root.removeEventListener('keydown',keydown);instances.delete(api);}};
    instances.add(api);refresh();
    document.fonts.ready.then(()=>{if(instances.has(api))positionMarker();});
    return api;
  }
  media.addEventListener('change',()=>{if(media.matches)instances.forEach(instance=>instance.settle());});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)instances.forEach(instance=>instance.settle());});
  return {mount,recipe};
})();
