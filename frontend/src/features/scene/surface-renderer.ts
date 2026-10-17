import { add, sub, scale, dot, cross, normalize, inverseDirection, intersectTriangle, validateSurface,
  type Vec3, type SurfaceCamera, type SurfaceModel, type SurfacePalette, type SurfaceSettings, type SurfaceProjection } from './surface-model';
import { assemblyOffset } from './assembly';

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in mat4 instance;
layout(location=6) in float scalar;
out float scalarValue;
out float sliceY;
uniform vec3 displayOffset;
uniform mat4 projection;
uniform mat4 view;
out vec3 worldPosition;
out vec3 worldNormal;
void main(){scalarValue=scalar;vec4 p=instance*vec4(position,1.0);sliceY=p.y;p.xyz+=displayOffset;worldPosition=p.xyz;worldNormal=mat3(instance)*normal;gl_Position=projection*view*p;}`;
// Cook-Torrance GGX under a fixed analytic studio rig. Appearance is not a physical material property.
const fragmentSource = `#version 300 es
precision highp float;
in vec3 worldPosition;
in vec3 worldNormal;
in float scalarValue;
in float sliceY;
uniform vec3 ramp[6];
uniform bool scientific;
uniform vec3 eye;
uniform vec3 base;
uniform vec3 accent;
uniform float metal;
uniform float roughness;
uniform float alpha;
uniform float selected;
uniform float cut;
uniform bool unlit;
out vec4 result;
const float PI=3.14159265359;
vec3 light(vec3 n,vec3 v,vec3 l,vec3 albedo,float intensity){
 vec3 h=normalize(v+l);float nl=max(dot(n,l),0.0),nv=max(dot(n,v),0.001),nh=max(dot(n,h),0.0),vh=max(dot(v,h),0.0);
 float a=roughness*roughness,a2=a*a,d=a2/(PI*pow(nh*nh*(a2-1.0)+1.0,2.0));
 float k=pow(roughness+1.0,2.0)/8.0,g=(nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));
 vec3 f0=mix(vec3(0.04),albedo,metal),f=f0+(1.0-f0)*pow(1.0-vh,5.0);
 return ((1.0-f)*(1.0-metal)*albedo/PI+d*g*f/max(4.0*nv*nl,0.001))*nl*intensity;
}
void main(){
 if(sliceY>cut) discard;
 if(scientific){float t=clamp(scalarValue,0.0,1.0)*5.0;int i=min(4,int(floor(t)));result=vec4(mix(ramp[i],ramp[i+1],t-float(i)),alpha);return;}
 if(unlit){result=vec4(base,alpha);return;}
 vec3 n=normalize(worldNormal)*(gl_FrontFacing?1.0:-1.0),v=normalize(eye-worldPosition),albedo=pow(base,vec3(2.2));
 vec3 lit=albedo*(0.16+0.16*max(n.z,0.0));
 lit+=light(n,v,normalize(vec3(0.5,0.7,1.0)),albedo,3.2);
 lit+=light(n,v,normalize(vec3(-0.8,-0.3,0.6)),albedo,1.5);
 lit+=light(n,v,normalize(vec3(0.1,-0.9,0.2)),albedo,0.7);
 float rim=pow(1.0-max(dot(n,v),0.0),3.0);
 lit=mix(lit,lit+pow(accent,vec3(2.2))*(0.18+rim*1.4),selected);
 lit=lit/(vec3(1.0)+lit);result=vec4(pow(lit,vec3(1.0/2.2)),alpha);
}`;
export type SurfaceFrame = { width: number; height: number; projections: SurfaceProjection[]; gridStep: number; drawCalls: number; camera: SurfaceCamera };
export type SurfaceHandle = { update(settings: SurfaceSettings): void; palette(value: SurfacePalette): void; fit(): void; view(direction: 'iso' | 'end' | 'top'): void; zoom(factor: number): void; destroy(): void };
export type SurfaceEvents = { pick(id: string | null): void; frame(value: SurfaceFrame): void; camera?(value: SurfaceCamera): void; error(message: string): void };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
function normals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]*3, b = indices[i+1]*3, c = indices[i+2]*3;
    const n = cross([positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]], [positions[c]-positions[a],positions[c+1]-positions[a+1],positions[c+2]-positions[a+2]]);
    for (const offset of [a,b,c]) for (let axis=0;axis<3;axis++) out[offset+axis]+=n[axis];
  }
  for(let i=0;i<out.length;i+=3){const n=normalize([out[i],out[i+1],out[i+2]]);out.set(n,i);}
  return out;
}
function perspective(aspect: number, near: number, far: number): Float32Array<ArrayBuffer> {
  const f=1/Math.tan(Math.PI/8),nf=1/(near-far);
  return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);
}
function matrixPoint(m: Float32Array, p: number[]): number[] { return [0,1,2,3].map(r => m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]*p[3]); }
function rayBox(origin: Vec3, direction: Vec3, bounds: readonly number[]): boolean {
  let near=0,far=Infinity;
  for(let i=0;i<3;i++){
    if(Math.abs(direction[i])<1e-12){if(origin[i]<bounds[i]||origin[i]>bounds[i+3])return false;continue;}
    const a=(bounds[i]-origin[i])/direction[i],b=(bounds[i+3]-origin[i])/direction[i];
    near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return false;
  }
  return true;
}
export function createSurfaceRenderer(canvas: HTMLCanvasElement, model: SurfaceModel, initialPalette: SurfacePalette, events: SurfaceEvents, initial?: SurfaceCamera): SurfaceHandle {
  validateSurface(model);
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('当前浏览器无法建立 WebGL 2 视口；工程数据与二维分析不受影响。');
  const buffers: WebGLBuffer[]=[], vaos: WebGLVertexArrayObject[]=[], shaders: WebGLShader[]=[];
  let program: WebGLProgram | null=null, disposed=false, lost=false, animation=0;
  const bounds=model.bounds, center:Vec3=[(bounds[0]+bounds[3])/2,(bounds[1]+bounds[4])/2,(bounds[2]+bounds[5])/2];
  const span=Math.max(1e-4,Math.hypot(bounds[3]-bounds[0],bounds[4]-bounds[1],bounds[5]-bounds[2]));
  let camera:SurfaceCamera={yaw:.95,elevation:.5,distance:span*1.8,target:[0,0,0]};
  if(initial && [initial.yaw,initial.elevation,initial.distance,...initial.target].every(Number.isFinite) && initial.distance>0)camera={...initial,target:[...initial.target]};
  let palette=initialPalette, settings:SurfaceSettings={selected:null,hidden:[],slice:1,ghost:true,explosion:0};
  let eye:Vec3=[0,0,1],right:Vec3=[1,0,0],up:Vec3=[0,0,1],forward:Vec3=[0,1,0];
  let view=new Float32Array(16),projection=new Float32Array(16);
  const listeners: (()=>void)[]=[];
  const offsets=model.draws.map(draw=>assemblyOffset(model,draw));
  function release(){for(const vao of vaos)gl!.deleteVertexArray(vao);for(const b of buffers)gl!.deleteBuffer(b);for(const s of shaders)gl!.deleteShader(s);if(program)gl!.deleteProgram(program);}
  function compile(type:number,source:string){const shader=gl!.createShader(type);if(!shader)throw new Error('无法分配着色器。');shaders.push(shader);gl!.shaderSource(shader,source);gl!.compileShader(shader);if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS))throw new Error('场景着色器编译失败。');return shader;}
  function buffer(target:number,data:Float32Array|Uint32Array){const value=gl!.createBuffer();if(!value)throw new Error('无法分配显示缓冲区。');buffers.push(value);gl!.bindBuffer(target,value);gl!.bufferData(target,data,gl!.STATIC_DRAW);return value;}
  type GeometryBuffer={positions:WebGLBuffer;normals:WebGLBuffer;indices:WebGLBuffer;scalars:WebGLBuffer;count:number};
  const geometryBuffers=new Map<string,GeometryBuffer>();
  const localBounds=new Map<string,number[]>();
  const draws:{vao:WebGLVertexArrayObject;count:number;instances:number;id:string;category:string;kind:string;offset:Vec3}[]=[];
  let grid:{vao:WebGLVertexArrayObject;count:number}|undefined;
  const gridStep=Math.pow(10,Math.floor(Math.log10(span/8)))*2;
  function makeVao(g:GeometryBuffer,matrices:readonly(readonly number[])[]){
    const vao=gl!.createVertexArray();if(!vao)throw new Error('无法分配场景实例。');vaos.push(vao);gl!.bindVertexArray(vao);
    for(const [location,b] of [[0,g.positions],[1,g.normals]] as const){gl!.bindBuffer(gl!.ARRAY_BUFFER,b);gl!.enableVertexAttribArray(location);gl!.vertexAttribPointer(location,3,gl!.FLOAT,false,0,0);}
    gl!.bindBuffer(gl!.ARRAY_BUFFER,g.scalars);gl!.enableVertexAttribArray(6);gl!.vertexAttribPointer(6,1,gl!.FLOAT,false,0,0);
    const values=new Float32Array(matrices.length*16);
    matrices.forEach((m,i)=>values.set([m[0],m[4],m[8],0,m[1],m[5],m[9],0,m[2],m[6],m[10],0,m[3]-center[0],m[7]-center[1],m[11]-center[2],1],i*16));
    buffer(gl!.ARRAY_BUFFER,values);
    for(let i=0;i<4;i++){gl!.enableVertexAttribArray(2+i);gl!.vertexAttribPointer(2+i,4,gl!.FLOAT,false,64,i*16);gl!.vertexAttribDivisor(2+i,1);}
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER,g.indices);gl!.bindVertexArray(null);return vao;
  }
  try{
    program=gl.createProgram();if(!program)throw new Error('无法建立场景绘制程序。');
    gl.attachShader(program,compile(gl.VERTEX_SHADER,vertexSource));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragmentSource));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('场景绘制程序链接失败。');
    for(const [id,g] of Object.entries(model.geometries)){
      const positions=Float32Array.from(g.positions),indices=Uint32Array.from(g.triangles);
      const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(let i=0;i<positions.length;i+=3)for(let j=0;j<3;j++){b[j]=Math.min(b[j],positions[i+j]);b[j+3]=Math.max(b[j+3],positions[i+j]);}localBounds.set(id,b);
      geometryBuffers.set(id,{positions:buffer(gl.ARRAY_BUFFER,positions),normals:buffer(gl.ARRAY_BUFFER,normals(positions,indices)),indices:buffer(gl.ELEMENT_ARRAY_BUFFER,indices),scalars:buffer(gl.ARRAY_BUFFER,g.scalars?Float32Array.from(g.scalars):new Float32Array(positions.length/3)),count:indices.length});
    }
    const objects=new Map(model.objects.map(o=>[o.id,o]));
    model.draws.forEach((draw,index)=>{const g=geometryBuffers.get(draw.geometry)!;draws.push({vao:makeVao(g,draw.transforms),count:g.count,instances:draw.transforms.length,id:draw.objectId,category:draw.category,kind:objects.get(draw.objectId)!.kind,offset:offsets[index]});});
    const p:number[]=[],minX=Math.floor(bounds[0]/gridStep)*gridStep,maxX=Math.ceil(bounds[3]/gridStep)*gridStep,minY=Math.floor(bounds[1]/gridStep)*gridStep,maxY=Math.ceil(bounds[4]/gridStep)*gridStep,z=bounds[2]-span*.025;
    for(let x=minX;x<=maxX+gridStep*.1;x+=gridStep)p.push(x,minY,z,x,maxY,z);
    for(let y=minY;y<=maxY+gridStep*.1;y+=gridStep)p.push(minX,y,z,maxX,y,z);
    const g={positions:buffer(gl.ARRAY_BUFFER,new Float32Array(p)),normals:buffer(gl.ARRAY_BUFFER,new Float32Array(p.length)),indices:buffer(gl.ELEMENT_ARRAY_BUFFER,Uint32Array.from({length:p.length/3},(_,i)=>i)),scalars:buffer(gl.ARRAY_BUFFER,new Float32Array(p.length/3)),count:p.length/3};
    grid={vao:makeVao(g,[[1,0,0,0,0,1,0,0,0,0,1,0]]),count:g.count};
  }catch(error){release();gl.getExtension('WEBGL_lose_context')?.loseContext();throw error;}
  const uniform=(name:string)=>gl.getUniformLocation(program!,name);
  const u=Object.fromEntries(['projection','view','eye','base','accent','metal','roughness','alpha','selected','cut','unlit','scientific','ramp[0]','displayOffset'].map(name=>[name,uniform(name)]));
  function updateCamera(){
    camera.elevation=clamp(camera.elevation,-1.48,1.48);camera.distance=clamp(camera.distance,span*.03,span*30);
    const c=Math.cos(camera.elevation);eye=add(camera.target,scale([Math.cos(camera.yaw)*c,Math.sin(camera.yaw)*c,Math.sin(camera.elevation)],camera.distance));
    forward=normalize(sub(camera.target,eye));right=normalize(cross(forward,[0,0,1]));up=cross(right,forward);
    view=new Float32Array([right[0],up[0],-forward[0],0,right[1],up[1],-forward[1],0,right[2],up[2],-forward[2],0,-dot(right,eye),-dot(up,eye),dot(forward,eye),1]);
    projection=perspective(canvas.width/canvas.height,Math.max(span*.0001,1e-7),span*80);
  }
  function snapshot():SurfaceCamera{return {...camera,target:[...camera.target]};}
  function render(){
    animation=0;if(disposed||lost||document.hidden)return;
    const rect=canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)return;
    const ratio=Math.min(devicePixelRatio||1,2,4096/Math.max(rect.width,rect.height)),width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    updateCamera();gl!.viewport(0,0,width,height);gl!.clearColor(...palette.background,1);gl!.clear(gl!.COLOR_BUFFER_BIT|gl!.DEPTH_BUFFER_BIT);
    gl!.enable(gl!.DEPTH_TEST);gl!.disable(gl!.CULL_FACE);gl!.enable(gl!.BLEND);gl!.blendFunc(gl!.SRC_ALPHA,gl!.ONE_MINUS_SRC_ALPHA);gl!.useProgram(program);
    gl!.uniformMatrix4fv(u.projection,false,projection);gl!.uniformMatrix4fv(u.view,false,view);gl!.uniform3fv(u.eye,eye);gl!.uniform3fv(u.accent,palette.selected);gl!.uniform3fv(u['ramp[0]'],palette.temperatures.flat());gl!.uniform1i(u.scientific,0);
    const hidden=new Set(settings.hidden),cut=bounds[1]+(bounds[4]-bounds[1])*settings.slice-center[1];
    let calls=0;
    gl!.uniform3fv(u.displayOffset,[0,0,0]);
    gl!.uniform1f(u.cut,span*100);gl!.uniform1i(u.unlit,1);gl!.uniform1f(u.alpha,.65);gl!.uniform3fv(u.base,palette.line);gl!.depthMask(false);
    if(grid){gl!.bindVertexArray(grid.vao);gl!.drawElementsInstanced(gl!.LINES,grid.count,gl!.UNSIGNED_INT,0,1);calls++;}
    gl!.uniform1i(u.unlit,0);gl!.uniform1f(u.cut,cut+span*1e-6);
    const environment=(kind:string)=>['soil','backfill','ground'].includes(kind);
    const ordered=draws.filter(draw=>!hidden.has(draw.id)).sort((a,b)=>Number(settings.ghost&&environment(a.kind))-Number(settings.ghost&&environment(b.kind)));
    for(const draw of ordered){
      const ghost=settings.ghost&&environment(draw.kind),metal=draw.category==='conductor'?.75:draw.category==='metal'?.7:0;
      gl!.uniform3fv(u.displayOffset,scale(draw.offset,settings.explosion||0));
      gl!.uniform1i(u.scientific,draw.category==='temperature-field'?1:0);gl!.depthMask(!ghost);gl!.uniform3fv(u.base,palette.materials[draw.category]||palette.materials.unknown);gl!.uniform1f(u.metal,metal);gl!.uniform1f(u.roughness,metal?.38:.68);gl!.uniform1f(u.alpha,ghost?.1:1);gl!.uniform1f(u.selected,settings.selected===draw.id?1:0);
      gl!.bindVertexArray(draw.vao);gl!.drawElementsInstanced(gl!.TRIANGLES,draw.count,gl!.UNSIGNED_INT,0,draw.instances);calls++;
    }
    gl!.depthMask(true);gl!.bindVertexArray(null);
    const projections:SurfaceProjection[]=[];
    for(const o of model.objects){
      if(hidden.has(o.id)||o.kind!=='cable')continue;
      const parts=draws.filter(d=>d.id===o.id),displacement=parts.reduce((sum,d)=>add(sum,scale(d.offset,(settings.explosion||0)/parts.length)),[0,0,0] as Vec3);
      const p=add(sub([(o.bounds[0]+o.bounds[3])/2,(o.bounds[1]+o.bounds[4])/2,o.bounds[5]+span*.025],center),displacement);
      const clip=matrixPoint(projection,matrixPoint(view,[...p,1]));if(clip[3]<=0)continue;
      const x=(clip[0]/clip[3]*.5+.5)*rect.width,y=(-clip[1]/clip[3]*.5+.5)*rect.height;
      if(x>=0&&x<=rect.width&&y>=0&&y<=rect.height)projections.push({id:o.id,label:o.label,x,y});
    }
    events.frame({width:rect.width,height:rect.height,projections,gridStep,drawCalls:calls,camera:snapshot()});
  }
  function invalidate(){if(!disposed&&!lost&&!animation&&!document.hidden)animation=requestAnimationFrame(render);}
  function changed(){invalidate();events.camera?.(snapshot());}
  function pick(x:number,y:number){
    updateCamera();const rect=canvas.getBoundingClientRect(),t=Math.tan(Math.PI/8),nx=((x-rect.left)/rect.width*2-1)*t*rect.width/rect.height,ny=(1-(y-rect.top)/rect.height*2)*t;
    const origin=add(eye,center),direction=normalize(add(forward,add(scale(right,nx),scale(up,ny)))),hidden=new Set(settings.hidden);
    let nearest=Infinity,id:string|null=null;
    for(let index=0;index<model.draws.length;index++){
      const draw=model.draws[index],object=model.objects.find(o=>o.id===draw.objectId)!;
      if(hidden.has(draw.objectId)||object.kind==='ground'||(settings.ghost&&['soil','backfill'].includes(object.kind)))continue;
      const displacement=scale(offsets[index],settings.explosion||0),movedOrigin=sub(origin,displacement);
      if(!rayBox(movedOrigin,direction,object.bounds))continue;
      const g=model.geometries[draw.geometry];
      for(const m of draw.transforms){const o=inverseDirection(m,sub(movedOrigin,[m[3],m[7],m[11]])),d=inverseDirection(m,direction);
        if(!rayBox(o,d,localBounds.get(draw.geometry)!))continue;
        for(let i=0;i<g.triangles.length;i+=3){const p=(at:number):Vec3=>{const j=g.triangles[at]*3;return[g.positions[j],g.positions[j+1],g.positions[j+2]];};
          const hit=intersectTriangle(o,d,p(i),p(i+1),p(i+2));if(hit!==null&&hit<nearest&&movedOrigin[1]+hit*direction[1]<=bounds[1]+(bounds[4]-bounds[1])*settings.slice+span*1e-6){nearest=hit;id=draw.objectId;}
        }
      }
    }
    events.pick(id);
  }
  const pointers=new Map<number,{x:number;y:number}>();let down:{x:number;y:number;button:number}|null=null,moved=false,multiple=false;
  function onDown(event:PointerEvent){canvas.focus({preventScroll:true});pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);if(pointers.size===1){down={x:event.clientX,y:event.clientY,button:event.button};moved=false;multiple=false;}else multiple=true;}
  function onMove(event:PointerEvent){const previous=pointers.get(event.pointerId);if(!previous)return;
    const dx=event.clientX-previous.x,dy=event.clientY-previous.y;if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)>4)moved=true;
    if(pointers.size===2){const other=[...pointers.entries()].find(([id])=>id!==event.pointerId)![1];const before=Math.hypot(previous.x-other.x,previous.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);if(before>0&&after>0)camera.distance*=before/after;}
    else if(event.shiftKey||event.ctrlKey||down?.button===2||down?.button===1){updateCamera();camera.target=add(camera.target,add(scale(right,-dx*camera.distance/canvas.clientHeight),scale(up,dy*camera.distance/canvas.clientHeight)));}
    else{camera.yaw-=dx*.008;camera.elevation+=dy*.008;}
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});invalidate();
  }
  function onUp(event:PointerEvent){if(!pointers.has(event.pointerId))return;pointers.delete(event.pointerId);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(!pointers.size){if(event.type==='pointerup'&&!multiple&&!moved&&down?.button===0)pick(event.clientX,event.clientY);down=null;changed();}}
  function onWheel(event:WheelEvent){event.preventDefault();camera.distance*=Math.exp(clamp(event.deltaY,-160,160)*.002);changed();}
  function fit(){camera={yaw:.95,elevation:.5,distance:span*1.8,target:[0,0,0]};changed();}
  function direction(value:'iso'|'end'|'top'){if(value==='iso'){camera.yaw=.95;camera.elevation=.5;}else if(value==='end'){camera.yaw=Math.PI/2;camera.elevation=0;}else camera.elevation=1.48;changed();}
  function zoom(factor:number){if(Number.isFinite(factor)&&factor>0){camera.distance/=factor;changed();}}
  function onKey(event:KeyboardEvent){let handled=true;switch(event.key.toLowerCase()){case'f':fit();break;case'1':direction('iso');break;case'2':direction('end');break;case'3':direction('top');break;case'arrowleft':camera.yaw-=.1;break;case'arrowright':camera.yaw+=.1;break;case'arrowup':camera.elevation+=.1;break;case'arrowdown':camera.elevation-=.1;break;case'+':case'=':zoom(1.15);break;case'-':zoom(1/1.15);break;default:handled=false;}if(handled){event.preventDefault();changed();}}
  function listen<K extends keyof HTMLElementEventMap>(name:K,fn:(event:HTMLElementEventMap[K])=>void,options?:AddEventListenerOptions){canvas.addEventListener(name,fn,options);listeners.push(()=>canvas.removeEventListener(name,fn));}
  listen('pointerdown',onDown);listen('pointermove',onMove);listen('pointerup',onUp);listen('pointercancel',onUp);listen('wheel',onWheel,{passive:false});listen('keydown',onKey);listen('contextmenu',event=>event.preventDefault());
  const listenContext=(name:string,fn:EventListener)=>{canvas.addEventListener(name,fn);listeners.push(()=>canvas.removeEventListener(name,fn));};
  listenContext('webglcontextlost',event=>{event.preventDefault();lost=true;cancelAnimationFrame(animation);animation=0;events.error('显卡上下文已丢失，请重载场景；保存结果未改变。');});
  listenContext('webglcontextrestored',()=>events.error('显卡上下文已恢复，请重载场景。'));
  const resize=new ResizeObserver(invalidate);resize.observe(canvas);
  const visibility=()=>{if(document.hidden){cancelAnimationFrame(animation);animation=0;}else invalidate();};document.addEventListener('visibilitychange',visibility);
  invalidate();
  return {update(value){settings={...value,slice:clamp(Number.isFinite(value.slice)?value.slice:1,.02,1),explosion:clamp(Number.isFinite(value.explosion)?value.explosion!:0,0,1)};invalidate();},palette(value){palette=value;invalidate();},fit,view:direction,zoom,
    destroy(){if(disposed)return;disposed=true;cancelAnimationFrame(animation);resize.disconnect();document.removeEventListener('visibilitychange',visibility);for(const off of listeners)off();pointers.clear();release();}};
}
