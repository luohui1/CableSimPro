// OCCT owns B-Rep, snapping, clipping and drawing. DOM binds constrained camera gestures.
let runtime,canvas,owner=null,ownerCurrent=()=>false,ownerCleanup=()=>{};
let runtimeTimings={};
async function compiledModule(url){
  // Streaming on a stable, immutable URL lets the browser reuse its native code
  // cache. Chromium forbids storing WebAssembly.Module in IndexedDB.
  const start=performance.now(),response=await fetch(url);if(!response.ok)throw new Error('CAD 运行文件不可用，请刷新后重试。');runtimeTimings.fetch_headers_ms=performance.now()-start;
  const at=performance.now(),module=await WebAssembly.compileStreaming(response);runtimeTimings.compile_stream_ms=performance.now()-at;
  const transfer=performance.getEntriesByName(url).at(-1);if(transfer){runtimeTimings.download_response_ms=transfer.responseEnd-transfer.responseStart;runtimeTimings.encoded_bytes=transfer.encodedBodySize;runtimeTimings.decoded_bytes=transfer.decodedBodySize;runtimeTimings.resource_cache_hit=transfer.transferSize<transfer.encodedBodySize;runtimeTimings.compile_after_download_ms=Math.max(0,performance.now()-transfer.responseEnd);}
  runtimeTimings.module_ready_ms=performance.now()-start;return module;
}
const defaults={yaw:0,elevation:Math.atan(1/Math.sqrt(2)),heading:-Math.PI/4,zoom:1,panX:0,panY:0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function checked(value){if(value?.error)throw new Error(value.error);return value;}
function rgb(value){const hex=value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);if(hex){const n=hex[1].length===3?[...hex[1]].map(c=>c+c).join(''):hex[1];return [0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255);}const probe=document.createElement('span');probe.style.cssText='position:fixed;width:0;height:0;visibility:hidden;contain:strict';probe.style.color=value;document.body.append(probe);const parts=getComputedStyle(probe).color.match(/[\d.]+/g);probe.remove();return parts.slice(0,3).map(v=>Number(v)/255);}
async function nativeRuntime(){
  if(!runtime){canvas=document.createElement('canvas');canvas.id='cablesim-native-cad';canvas.tabIndex=0;canvas.setAttribute('aria-label','电缆 CAD 视口。左键绕轴旋转，中键或右键平移，滚轮以鼠标为中心缩放，双击空白或 F 适应窗口。');const started=performance.now();runtimeTimings={};runtime=(async()=>{
    const base=new URL('../node_modules/.cache/cablesim-occt/',import.meta.url),response=await fetch(new URL('build.json',base)),metadata=await response.json(),assets=metadata.assets;
    if(!assets?.['occt-viewer.js']||!assets?.['occt-viewer.wasm'])throw new Error('CAD 构建信息缺少运行文件摘要，请重新构建视口。');
    const url=name=>new URL(name+'?v='+assets[name],base).href;
    const [wrapper,module]=await Promise.all([import(url('occt-viewer.js')),compiledModule(url('occt-viewer.wasm'))]);
    const instantiated=performance.now();let rejectInstance;const failed=new Promise((_,reject)=>rejectInstance=reject);
    const initialized=wrapper.default({canvas,locateFile:url,instantiateWasm(imports,receive){WebAssembly.instantiate(module,imports).then(instance=>{try{receive(instance,module);}catch(error){rejectInstance(error);}},rejectInstance);return {};},printErr:message=>console.error('[OCCT]',message)});
    const result=await Promise.race([initialized,failed]);
    runtimeTimings.instantiate_ms=performance.now()-instantiated;runtimeTimings.ready_ms=performance.now()-started;return result;
  })().catch(error=>{runtime=null;throw error;});}
  return runtime;
}
export const preloadViewer=()=>nativeRuntime();
export const runtimeProfile=()=>({...runtimeTimings});
export async function createViewer(host,model,{selected=0,onSelect,onPick,onChange,loadExact,mode='peel',initialCamera={},isCurrent=()=>true}={}){
  const scene=model?.schema==='cablesim.cad-scene/1';
  function validate(m){if(scene){if(!m||m.schema!=='cablesim.cad-scene/1'||m.brep_unit!=='mm'||m.coordinate_frame!=='x/y/z'||m.extrusion_axis!=='+Y'||!Number.isFinite(m.length_m)||m.length_m<=0||!Array.isArray(m.crop_bounds_m)||m.crop_bounds_m.length!==6||!m.crop_bounds_m.every(Number.isFinite)||!Array.isArray(m.objects)||!m.objects.length||m.objects.length>128||new Set(m.objects.map(o=>o.id)).size!==m.objects.length)throw new Error('敷设场景坐标或对象契约无效。');let count=0;for(const o of m.objects){if(!Array.isArray(o.bounds_m)||o.bounds_m.length!==6||!o.bounds_m.every(Number.isFinite)||!Array.isArray(o.parts)||!o.parts.length)throw new Error('场景对象缺少有效边界或实体。');for(const p of o.parts){const a=m.assets?.[p.asset_id];if(!a?.geometry_key||!a.display_mesh&&!a.brep_text&&!(m.envelope&&a.primitive)||!Array.isArray(p.transform_mm)||p.transform_mm.length!==12||!p.transform_mm.every(Number.isFinite))throw new Error('场景实体或刚体位姿无效。');count++;}}if(count>512)throw new Error('场景实体超过 512 个。');return;}if(!m||m.schema!=='cablesim.cad-model/1'||m.brep_unit!=='mm'||m.axis!=='+Z'||!Number.isFinite(m.length_m)||m.length_m<=0||!Array.isArray(m.layers)||!m.layers.length||m.layers.length>32||m.layers.some(layer=>(!m.envelope&&!layer.brep_text&&!layer.display_mesh)||!Number.isFinite(layer.inner_radius_m)||!Number.isFinite(layer.outer_radius_m)||layer.inner_radius_m<0||layer.outer_radius_m<=layer.inner_radius_m))throw new Error('CAD 工件缺少有效的同轴实体，请重新预览。');}validate(model);
  const native=await nativeRuntime();if(!isCurrent()||!host.isConnected)return null;
  if(owner&&!ownerCurrent())ownerCleanup();
  if(owner)throw new Error('已有活动 CAD 视口；请先 dispose() 再挂载下一工作区。');
  const token=Symbol('viewport');owner=token;host.append(canvas);
  const pose={...defaults,...Object.fromEntries(Object.keys(defaults).filter(k=>Number.isFinite(initialCamera[k])).map(k=>[k,initialCamera[k]]))};
  let alive=true,drag=null,picking=false,animation=0,section=.55,observer=null;
  const events=new AbortController(),options={signal:events.signal},current=()=>alive&&owner===token&&isCurrent();
  function cleanup(){alive=false;cancelAnimationFrame(animation);animation=0;events.abort();observer?.disconnect();if(owner===token){native.clearModel();canvas.remove();owner=null;}}
  ownerCurrent=current;ownerCleanup=cleanup;
  const style=getComputedStyle(document.documentElement),color=key=>rgb(style.getPropertyValue(key).trim());
  function size(){const rect=host.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(rect.width*ratio));canvas.height=Math.max(1,Math.round(rect.height*ratio));}
  function stop(){cancelAnimationFrame(animation);animation=0;}
  function changed(){const flat=Math.abs(pose.elevation)<.001;onChange?.({...pose,section,view:scene?(Math.abs(pose.elevation-Math.PI/2)<.001?'俯视':flat&&Math.abs(pose.heading+Math.PI/2)<.001?'端面':flat?'侧视':Math.abs(pose.elevation-defaults.elevation)<.001&&Math.abs(pose.heading-defaults.heading)<.001?'等轴':'自由视角'):Math.abs(pose.elevation-Math.PI/2)<.001?'端面':flat?(pose.heading>0?'俯视':'侧视'):Math.abs(pose.elevation-defaults.elevation)<.001&&Math.abs(pose.heading-defaults.heading)<.001?'等轴':'自由视角'});}
  function draw(){if(!current())return;pose.elevation=clamp(pose.elevation,-.7,Math.PI/2);pose.zoom=clamp(pose.zoom,.65,3);pose.panX=clamp(pose.panX,-.28,.28);pose.panY=clamp(pose.panY,-.28,.28);native.camera(pose.yaw,pose.elevation,pose.zoom,pose.panX,pose.panY,pose.heading);changed();}
  function project(x,y,z){const p=native.project(x,y,z),rect=canvas.getBoundingClientRect();return {x:p.x*rect.width/canvas.width,y:p.y*rect.height/canvas.height};}
  size();checked(native.initialize(canvas.id,...color('--panel')));native.clearModel();native.outlineColors(...color('--text'),...color('--text-secondary'));
  const palette={conductor:'--conductor',semiconductor:'--material-semi',insulation:'--material-insulation',metal:'--material-metal',polymer:'--material-sheath',filler:'--fill'};
  let updating=0,selecting=0,rendered=[],selectionKind='part',lastUpdateStats={};const shapes=new Map();
  let sceneParts=[];
  const radialKey=(m,l)=>JSON.stringify([m.length_m,l.inner_radius_m,l.outer_radius_m,l.material,l.category]);
  function args(m,l){const material=m.material_sources?.find(a=>a.id===l.material),copper=l.category==='metal'&&/copper|铜/i.test(material?.label||'');return [...color(copper?'--conductor':palette[l.category]||'--material-sheath'),['conductor','metal'].includes(l.category),m.length_m*1000,l.inner_radius_m*1000,l.outer_radius_m*1000,l.construction?.wire_diameter*1000||0];}
  function shape(m,l){if(l.brep_text)return l.brep_text;const k=radialKey(m,l);if(!shapes.has(k)){if(shapes.size>=48)shapes.delete(shapes.keys().next().value);shapes.set(k,checked(native.envelopeBrep(l.inner_radius_m*1000,l.outer_radius_m*1000,m.length_m*1000)));}return shapes.get(k);}
  const envelopes=new Map();
  const decodedMeshes=new WeakMap();
  function decodeMesh(mesh){if(!mesh?.byte_order)return mesh;if(mesh.byte_order!=='little')throw new Error('显示网格字节序不受支持。');if(decodedMeshes.has(mesh))return decodedMeshes.get(mesh);const unpack=(s,Type)=>{const raw=atob(s),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new Type(bytes.buffer);};const decoded={...mesh,prototypes:mesh.prototypes.map(p=>({...p,positions:unpack(p.positions_f32,Float32Array),triangles:unpack(p.triangles_u32,Uint32Array)}))};decodedMeshes.set(mesh,decoded);return decoded;}
  function envelopeMesh(m,l){
    const key=radialKey(m,l);if(envelopes.has(key))return envelopes.get(key);
    const inner=l.inner_radius_m*1000,outer=l.outer_radius_m*1000,L=m.length_m*1000;
    const n=Math.max(32,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-.08/outer))/4)*4),positions=[],triangles=[];
    const ring=(radius,z)=>{const start=positions.length/3;for(let i=0;i<n;i++){const a=i*Math.PI*2/n;positions.push(radius*Math.cos(a),radius*Math.sin(a),z);}return start;};
    const wall=(r,inward)=>{const a=ring(r,0),b=ring(r,L);for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push(...(inward?[a+i,b+j,a+j,a+i,b+i,b+j]:[a+i,a+j,b+j,a+i,b+j,b+i]));}};
    wall(outer,false);if(inner)wall(inner,true);
    for(const z of [0,L]){const outerRing=ring(outer,z);if(inner){const innerRing=ring(inner,z);for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push(...(z?[innerRing+i,outerRing+i,outerRing+j,innerRing+i,outerRing+j,innerRing+j]:[innerRing+i,outerRing+j,outerRing+i,innerRing+i,innerRing+j,outerRing+j]));}}else{const c=positions.length/3;positions.push(0,0,z);for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push(...(z?[c,outerRing+i,outerRing+j]:[c,outerRing+j,outerRing+i]));}}}
    const mesh={schema:'cablesim.display-mesh/1',unit:'mm',deflection_mm:.08,prototypes:[{positions,triangles,instances:[[1,0,0,0,0,1,0,0,0,0,1,0]]}]};
    if(envelopes.size>=48)envelopes.delete(envelopes.keys().next().value);envelopes.set(key,mesh);return mesh;
  }
  async function topology(){if(model.envelope)return false;if(model.layers.every(l=>l.brep_text))return true;const previous=model,precise=await loadExact?.();if(!current()||model!==previous)return false;validate(precise);if(precise.input_sha256!==previous.input_sha256||precise.layers.some((l,i)=>!l.brep_text||l.geometry_key!==previous.layers[i]?.geometry_key))throw new Error('精确拓扑与当前模型不一致。');model=precise;return true;}
  function exact(indices){let replaced=false;for(const i of indices){if(rendered[i]?.mesh){const l=model.layers[i];if(!l.brep_text)throw new Error('精确拓扑尚未加载。');checked(native.replacePart(i,l.brep_text,...args(model,l)));rendered[i].mesh=false;replaced=true;}}if(replaced){native.finishUpdate(model.outer_diameter_m*1000,mode,selected,selectionKind,section);draw();}}
  async function update(next,{envelope=false,isLatest=()=>true,onProgress}={}){
    if(scene)return updateScene(next,{envelope,isLatest,onProgress});
    validate(next);const updateToken=++updating,count=next.layers.length;
    if(!envelope&&selectionKind!=='part'&&next.exact_pending){const previous=next;next=await loadExact?.();validate(next);if(!current()||updateToken!==updating||!isLatest())return false;if(next.input_sha256!==previous.input_sha256||next.layers.some((l,i)=>!l.brep_text||l.geometry_key!==previous.layers[i]?.geometry_key))throw new Error('精确拓扑与当前模型不一致。');}
    const began=performance.now(),stats={envelope,shape_ms:0,replace_ms:0,commit_ms:0,draw_ms:0,parse_ms:0,mesh_ms:0,display_ms:0,presentation_ms:0,selection_ms:0,layers:[]};let yieldedAt=began;
    native.measurePair(false);
    if(count!==rendered.length&&rendered.length){native.clearModel();rendered=[];}
    for(let i=0;i<count;i++){
      if(!current()||updateToken!==updating||!isLatest())return false;
      const layer=next.layers[i],old=rendered[i],radial=radialKey(next,layer);
      // An unchanged inner layer remains its precise original shape during a preview.
      if(!(envelope&&old?.radial===radial)&&!(old&&!envelope&&(layer.brep_text&&old.brep===layer.brep_text||layer.geometry_key&&old.geometryKey===layer.geometry_key))){
        const at=performance.now(),mesh=envelope?envelopeMesh(next,layer):selectionKind==='part'?decodeMesh(layer.display_mesh):null,text=mesh?null:shape(next,layer),values=args(next,layer);if(envelope)values[values.length-1]=0;stats.shape_ms+=performance.now()-at;
        const replaceAt=performance.now();checked(mesh?(old?native.replaceMeshPart(i,mesh,...values):native.addMeshPart(mesh,...values)):(old?native.replacePart(i,text,...values):native.addPart(text,...values)));stats.replace_ms+=performance.now()-replaceAt;
        const timing=native.partTimings();for(const k of ['parse_ms','mesh_ms','display_ms','presentation_ms','selection_ms'])stats[k]+=timing[k];stats.layers.push({index:i,role:layer.role,...timing});
        rendered[i]={radial,brep:envelope?null:layer.brep_text,geometryKey:envelope?null:layer.geometry_key,mesh:!!mesh};
      }
      if(!envelope){onProgress?.(i+1,count);if(i+1<count&&performance.now()-yieldedAt>=50){await new Promise(requestAnimationFrame);yieldedAt=performance.now();}}
    }
    model=next;if(!envelope&&selectionKind!=='part')exact(selectionKind==='point'?rendered.map((_,i)=>i):[selected]);const commitAt=performance.now();native.finishUpdate(next.outer_diameter_m*1000,mode,selected,envelope?'part':selectionKind,section);stats.commit_ms=performance.now()-commitAt;const drawAt=performance.now();draw();stats.draw_ms=performance.now()-drawAt;stats.elapsed_ms=performance.now()-began;lastUpdateStats=stats;return true;
  }
  function scenePart(index){return sceneParts[index]?.group??-1;}
  function primitiveMesh(m,a){
    if(a.primitive==='annulus')return envelopeMesh(m,a);
    const b=a.bounds_m;if(!Array.isArray(b)||b.length!==6||!b.every(Number.isFinite))throw new Error('显示包络边界无效。');
    const [x0,y0,z0,x1,y1,z1]=b.map(v=>v*1000),positions=[x0,y0,z0,x1,y0,z0,x1,y1,z0,x0,y1,z0,x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y1,z1];
    const triangles=a.primitive==='plane'?[0,1,2,0,2,3]:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5];
    return {schema:'cablesim.display-mesh/1',unit:'mm',deflection_mm:.08,prototypes:[{positions,triangles,instances:[[1,0,0,0,0,1,0,0,0,0,1,0]]}]};
  }
  function sceneRepresentative(group){let chosen=-1,radius=-1;for(let i=0;i<sceneParts.length;i++){const p=sceneParts[i];if(p.group===group&&(p.asset.outer_radius_m||0)>radius){chosen=i;radius=p.asset.outer_radius_m||0;}}return chosen;}
  async function updateScene(next,{envelope=false,isLatest=()=>true,onProgress}={}){
    validate(next);const updateToken=++updating,previousId=model.objects?.[selected]?.id;
    const flat=next.objects.flatMap((o,group)=>o.parts.map(p=>({...p,asset:next.assets[p.asset_id],object:o,group}))),count=flat.length;
    if(count!==rendered.length&&rendered.length){native.clearModel();rendered=[];}
    checked(native.configureScene(next.crop_bounds_m.map(v=>v*1000),next.objects.map(o=>({bounds:o.bounds_m.map(v=>v*1000),kind:o.kind,priority:{cable:3,enclosure:2,backfill:1,soil:0,ground:-1}[o.kind]??0}))));
    const began=performance.now(),stats={envelope,shape_ms:0,replace_ms:0,placement_ms:0,commit_ms:0,draw_ms:0,parse_ms:0,mesh_ms:0,display_ms:0,presentation_ms:0,selection_ms:0,layers:[]};let yieldedAt=began;
    for(let i=0;i<count;i++){
      if(!current()||updateToken!==updating||!isLatest())return false;
      const p=flat[i],old=rendered[i],a=p.asset,o=p.object;
      const key=[a.geometry_key,a.material,a.category,o.kind].join('|');
      if(old?.geometryKey!==key){
        const at=performance.now(),mesh=next.envelope&&a.primitive?primitiveMesh(next,a):decodeMesh(a.display_mesh),base=args(next,{...a,inner_radius_m:a.inner_radius_m||0,outer_radius_m:a.outer_radius_m||0});
        if(o.kind!=='cable'){const tint=color(o.kind==='ground'?'--panel':o.kind==='soil'&&o.tint_index%2?'--fill':'--section-soil');base.splice(0,3,...tint);base[3]=false;}
        stats.shape_ms+=performance.now()-at;const replaceAt=performance.now();
        checked(mesh?(old?native.replaceMeshPart(i,mesh,...base):native.addMeshPart(mesh,...base)):(old?native.replacePart(i,a.brep_text,...base):native.addPart(a.brep_text,...base)));
        stats.replace_ms+=performance.now()-replaceAt;const timing=native.partTimings();for(const k of ['parse_ms','mesh_ms','display_ms','presentation_ms','selection_ms'])stats[k]+=timing[k];stats.layers.push({index:i,object_id:o.id,...timing});rendered[i]={geometryKey:key,mesh:!!mesh};
      }
      const placeAt=performance.now();checked(native.setScenePart(i,p.group,p.transform_mm,{cable:1,enclosure:.45,backfill:.20,soil:.08,ground:.08}[o.kind]??.5,o.kind!=='ground'));stats.placement_ms+=performance.now()-placeAt;
      onProgress?.(i+1,count);if(i+1<count&&performance.now()-yieldedAt>=50){await new Promise(requestAnimationFrame);yieldedAt=performance.now();}
    }
    model=next;sceneParts=flat;const matched=next.objects.findIndex(o=>o.id===previousId);if(matched>=0)selected=matched;else selected=clamp(selected,0,next.objects.length-1);
    const commitAt=performance.now();native.finishUpdate(Math.max(next.crop_bounds_m[3]-next.crop_bounds_m[0],.001)*1000,mode,sceneRepresentative(selected),'part',section);stats.commit_ms=performance.now()-commitAt;
    const drawAt=performance.now();draw();stats.draw_ms=performance.now()-drawAt;stats.elapsed_ms=performance.now()-began;lastUpdateStats=stats;return true;
  }
  try{await update(model,{envelope:!!model.envelope});native.resize();draw();}catch(error){cleanup();throw error;}
  function point(e){const rect=canvas.getBoundingClientRect();return {x:Math.round((e.clientX-rect.left)*canvas.width/rect.width),y:Math.round((e.clientY-rect.top)*canvas.height/rect.height)};}
  canvas.addEventListener('contextmenu',e=>e.preventDefault(),options);
  canvas.addEventListener('pointerdown',e=>{if(!current()||![0,1,2].includes(e.button))return;e.preventDefault();stop();native.setInteracting(true);canvas.focus();canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,pan:e.button!==0};},options);
  canvas.addEventListener('pointermove',e=>{if(!current())return;const p=point(e);if(!drag){native.hover(p.x,p.y);return;}drag.moved ||= Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>3;if(drag.moved){const dx=e.clientX-drag.x,dy=e.clientY-drag.y,rect=canvas.getBoundingClientRect();if(drag.pan){pose.panX-=dx/rect.width;pose.panY+=dy/rect.height;}else{pose.yaw+=dx*.008;pose.elevation+=dy*.005;}draw();}drag.x=e.clientX;drag.y=e.clientY;},options);
  canvas.addEventListener('pointerup',e=>{if(!current()||!drag)return;const click=!drag.moved&&!drag.pan;drag=null;native.setInteracting(false);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(click){const p=point(e),hit=checked(native.pick(p.x,p.y));picking=true;try{if(hit){selected=scene?scenePart(hit.part):hit.part;if(scene){hit.object_id=model.objects[selected]?.id;hit.object_kind=model.objects[selected]?.kind;}onSelect?.(selected);}onPick?.(hit);}finally{picking=false;}changed();}},options);
  canvas.addEventListener('pointercancel',()=>{drag=null;if(current())native.setInteracting(false);},options);
  canvas.addEventListener('pointerleave',()=>{if(current()&&!drag)native.hover(-1,-1);},options);
  canvas.addEventListener('wheel',e=>{if(!current())return;e.preventDefault();stop();native.hover(-1,-1);const rect=canvas.getBoundingClientRect(),nx=(e.clientX-rect.left)/rect.width-.5,ny=.5-(e.clientY-rect.top)/rect.height,old=pose.zoom;pose.zoom=clamp(old*Math.exp(-clamp(e.deltaY,-200,200)*.002),.65,3);const ratio=pose.zoom/old;pose.panX=pose.panX*ratio+nx*(ratio-1);pose.panY=pose.panY*ratio+ny*(ratio-1);draw();},{...options,passive:false});
  function fit(){stop();native.hover(-1,-1);Object.assign(pose,{zoom:1,panX:0,panY:0});draw();}
  canvas.addEventListener('dblclick',e=>{const p=point(e);if(!native.hitTest(p.x,p.y))fit();},options);
  canvas.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();fit();}if(['+','-','='].includes(e.key)){e.preventDefault();e.stopPropagation();stop();pose.zoom*=e.key==='-'?.85:1.15;draw();}},options);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();host.dispatchEvent(new CustomEvent('model-context-lost'));},options);
  observer=new ResizeObserver(()=>{if(current()){size();native.resize();draw();}});observer.observe(host);
  async function profile({durationMs=3000}={}){
    if(!current()||document.visibilityState!=='visible')throw new Error('性能测量需要前台活动 CAD 视口。');
    stop();const start={...pose},intervals=[],costs=[],duration=clamp(durationMs,500,10000);let first,last;
    native.setInteracting(true);
    try{
      await new Promise((resolve,reject)=>{function frame(now){if(!current()){reject(new Error('性能测量已取消：视口销毁。'));return;}if(first===undefined)first=last=now;const dt=now-last;last=now;pose.yaw=start.yaw+(now-first)*.0005;const t=performance.now();draw();if(now-first>300){intervals.push(dt);costs.push(performance.now()-t);}if(now-first>=duration+300)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);});
      const sorted=[...intervals].sort((a,b)=>a-b),sum=intervals.reduce((a,b)=>a+b,0);
      return {fps:intervals.length*1000/sum,frames:intervals.length,duration_ms:sum,frame_ms_median:sorted[Math.floor(sorted.length*.5)],frame_ms_p95:sorted[Math.floor(sorted.length*.95)],frame_ms_max:sorted.at(-1),draw_ms_mean:costs.reduce((a,b)=>a+b,0)/costs.length,canvas_width:canvas.width,canvas_height:canvas.height,device_pixel_ratio:devicePixelRatio,...native.viewportInfo()};
    }finally{if(current()){Object.assign(pose,start);native.setInteracting(false);draw();}}
  }
  return {
    update,project,fit,profile,info:()=>current()?{...native.viewportInfo(),selected_object_id:scene?model.objects[selected]?.id:null,display_mesh_layers:rendered.filter(r=>r.mesh).length,update_stats:lastUpdateStats}:null,zoom(factor){if(current()){stop();pose.zoom*=factor;draw();}},select(index){selected=index;if(current()&&!picking){if(!scene&&!model.envelope&&selectionKind==='diameter')exact([selected]);native.selectPart(scene?sceneRepresentative(index):index);}changed();},async selection(kind){if(!current())return false;if(scene){if(kind!=='part')throw new Error('敷设场景当前按领域对象选择；精确工件由调用方取得。');native.setSelectionMode('part');return true;}const pendingModel=model,selectionToken=++selecting;native.setSelectionMode('part');if(current()&&!model.envelope&&kind!=='part'){if(!await topology()||!current()||selectionToken!==selecting||pendingModel.input_sha256!==model.input_sha256)return false;}selectionKind=kind;if(current()){if(!model.envelope&&kind!=='part')exact(kind==='point'?rendered.map((_,i)=>i):[selected]);native.setSelectionMode(model.envelope?'part':kind);}return true;},measure(enabled){if(current())native.measurePair(enabled&&!model.envelope&&!scene);},
    section(value){section=clamp(value,.05,.95);native.setSection(section);changed();},
    view(name){if(!current())return;if(['peel','section','transparent','scene'].includes(name)){mode=name;native.setMode(mode);changed();return;}if(!['iso','front','top','end'].includes(name))return;stop();native.hover(-1,-1);const start={...pose},end=scene?{...defaults,elevation:name==='top'?Math.PI/2:['front','end'].includes(name)?0:defaults.elevation,heading:name==='front'?0:name==='end'||name==='top'?-Math.PI/2:defaults.heading}:{...defaults,elevation:name==='end'?Math.PI/2:['front','top'].includes(name)?0:defaults.elevation,heading:name==='top'?Math.PI/4:defaults.heading},begin=performance.now();const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||localStorage.getItem('csp-reduced')==='true';function step(now){const t=reduced?1:clamp((now-begin)/300,0,1),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;for(const key of Object.keys(end))pose[key]=start[key]+(end[key]-start[key])*ease;draw();if(t<1&&current())animation=requestAnimationFrame(step);else animation=0;}animation=requestAnimationFrame(step);},
    dispose:cleanup
  };
}
