import type { SurfaceGeometry, SurfaceModel, Vec3 } from './surface-model';

/** Presentation proposals are deliberately distinct from the frozen engineering domain. */
export type ConstructionKind = 'buried' | 'backfill' | 'duct-bank' | 'trench' | 'tunnel' | 'tray';
export type ConstructionSpec = {
  kind: ConstructionKind; width: number; height: number; wall: number; clearance: number; pitch: number;
};
export type ConstructionResult = { model: SurfaceModel; addedIds: string[]; requirements: readonly string[]; sourceIdentity: string };
export const constructionKinds: { id: ConstructionKind; label: string; requirements: readonly string[] }[] = [
  { id: 'buried', label: '直埋剖面', requirements: ['真实埋深与土壤分层', '土壤热阻率及远场边界'] },
  { id: 'backfill', label: '回填区', requirements: ['回填实际尺寸与热阻率', '回填与原状土的界面'] },
  { id: 'duct-bank', label: '排管组', requirements: ['内外径与占管关系', '管壁导热、空气隙对流与辐射'] },
  { id: 'trench', label: '电缆沟', requirements: ['沟道壁厚与材料', '沟内空气及盖板换热边界'] },
  { id: 'tunnel', label: '电缆隧道', requirements: ['隧道断面、支架与壁面', '通风、空气温度及辐射边界'] },
  { id: 'tray', label: '梯式桥架', requirements: ['桥架与电缆实际接触', '环境温度、对流与辐射边界'] },
];
const rigid = (x = 0, y = 0, z = 0) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];

/** Each face has distinct vertices; analytic flat faces do not acquire rounded normals. */
export function boxMesh(w: number, length: number, h: number): SurfaceGeometry {
  if (![w, length, h].every(n => Number.isFinite(n) && n > 0)) throw new Error('构件尺寸必须为有限正米数。');
  const corners = [[-w/2,0,-h/2],[w/2,0,-h/2],[w/2,length,-h/2],[-w/2,length,-h/2],[-w/2,0,h/2],[w/2,0,h/2],[w/2,length,h/2],[-w/2,length,h/2]];
  const positions: number[] = [], triangles: number[] = [];
  for (const face of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]) {
    const offset = positions.length / 3;
    face.forEach(i => positions.push(...corners[i]));
    triangles.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  return { positions, triangles };
}

/** Closed annular sector extruded along +Y. The open sector is an explicit display cutaway. */
export function sectorMesh(inner: number, outer: number, length: number, angle = Math.PI * 2, steps = 96): SurfaceGeometry {
  if (![inner, outer, length, angle].every(Number.isFinite) || inner <= 0 || outer <= inner || length <= 0 || angle <= 0 || angle > Math.PI * 2 || !Number.isInteger(steps) || steps < 12 || steps > 256) throw new Error('管壁或隧道截面尺寸无效。');
  const positions: number[] = [], triangles: number[] = [];
  const start = -Math.PI / 2;
  const p = (r: number, theta: number, y: number) => [r * Math.cos(theta), y, r * Math.sin(theta)];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const n = positions.length / 3; positions.push(...a,...b,...c,...d); triangles.push(n,n+1,n+2,n,n+2,n+3);
  };
  for (let i = 0; i < steps; i++) {
    const a = start + angle * i / steps, b = start + angle * (i+1) / steps;
    quad(p(outer,a,0),p(outer,a,length),p(outer,b,length),p(outer,b,0));
    quad(p(inner,b,0),p(inner,b,length),p(inner,a,length),p(inner,a,0));
    quad(p(inner,a,0),p(outer,a,0),p(outer,b,0),p(inner,b,0));
    quad(p(inner,b,length),p(outer,b,length),p(outer,a,length),p(inner,a,length));
  }
  if (angle < 2 * Math.PI - 1e-10) {
    quad(p(inner,start,length),p(outer,start,length),p(outer,start,0),p(inner,start,0));
    const end = start + angle;
    quad(p(inner,end,0),p(outer,end,0),p(outer,end,length),p(inner,end,length));
  }
  return { positions, triangles };
}

/** Proposed dimensions are shown for confirmation, never described as manufacturer data. */
export function suggestedConstruction(base: SurfaceModel, kind: ConstructionKind): ConstructionSpec {
  const cables = base.objects.filter(o => o.kind === 'cable');
  if (!cables.length) throw new Error('场景没有可绑定的电缆。');
  const width = Math.max(...cables.map(o => o.bounds[3])) - Math.min(...cables.map(o => o.bounds[0]));
  const height = Math.max(...cables.map(o => o.bounds[5])) - Math.min(...cables.map(o => o.bounds[2]));
  let w=Math.max(.4,width+.3), h=Math.max(.35,height+.3), wall=.03, clearance=.06;
  if(kind==='tunnel') w=h=Math.max(w,h);
  if(kind==='duct-bank') {
    let gap=Infinity;
    for(let i=0;i<cables.length;i++)for(let j=i+1;j<cables.length;j++) {
      const a=cables[i].bounds,b=cables[j].bounds;
      const ra=Math.max(a[3]-a[0],a[5]-a[2])/2,rb=Math.max(b[3]-b[0],b[5]-b[2])/2;
      gap=Math.min(gap,Math.hypot((a[0]+a[3]-b[0]-b[3])/2,(a[2]+a[5]-b[2]-b[5])/2)-ra-rb);
    }
    if(gap<=0)throw new Error('当前电缆间无排管净空，不能自动改变电缆位置。');
    wall=Math.min(.012,gap/6);clearance=Math.min(.025,gap/6);
  }
  return { kind, width:w, height:h, wall, clearance, pitch:.25 };
}

/** Adds geometry only. Caller must keep this proposal out of solver inputs and engineering exports. */
export function constructScene(base: SurfaceModel, spec: ConstructionSpec): ConstructionResult {
  const definition = constructionKinds.find(k => k.id === spec.kind);
  if (!definition || ![spec.width,spec.height,spec.wall,spec.clearance,spec.pitch].every(n => Number.isFinite(n) && n > 0)) throw new Error('构件参数缺失或不是有限正数。');
  if (spec.width > 30 || spec.height > 30 || spec.wall > Math.min(spec.width,spec.height)/4 || spec.pitch < .03 || spec.clearance > 10) throw new Error('构件参数超过展示预算或壁厚不合理。');
  const cables = base.objects.filter(o => o.kind === 'cable');
  if (!cables.length) throw new Error('构件预览需要原场景电缆。');
  const lo = [0,1,2].map(i => Math.min(...cables.map(o => o.bounds[i])));
  const hi = [3,4,5].map(i => Math.max(...cables.map(o => o.bounds[i])));
  const length = hi[1]-lo[1], cx = (lo[0]+hi[0])/2, cz = (lo[2]+hi[2])/2;
  if (!Number.isFinite(length) || length <= 0 || length > 30 || spec.width < hi[0]-lo[0]+2*spec.clearance || spec.height < hi[2]-lo[2]+2*spec.clearance) throw new Error('构件净尺寸容纳不了当前电缆与所填间隙。');
  const count = Math.max(2, Math.ceil(length/spec.pitch)+1);
  if (count > 100) throw new Error('支撑重复数超过100，请增大支撑间距或缩短展示长度。');
  const model: SurfaceModel = { ...base, identity: `${base.identity}:construction:${JSON.stringify(spec)}`, objects: [...base.objects], geometries: { ...base.geometries }, draws: [...base.draws] };
  const addedIds: string[] = [], W=spec.width,H=spec.height,t=spec.wall, floor=cz-H/2;
  function add(label: string, mesh: SurfaceGeometry, placements: number[][], bounds: number[], category: string, motion: Vec3) {
    const id = `presentation:${base.identity}:${spec.kind}:${addedIds.length}`;
    if (model.objects.some(o => o.id === id) || model.geometries[id]) throw new Error('展示构件标识冲突。');
    model.objects.push({ id, label: `${label}（展示构件）`, kind: 'presentation', bounds });
    model.geometries[id] = mesh;
    model.draws.push({ geometry: id, objectId: id, category, transforms: placements, presentationOffset: motion });
    addedIds.push(id);
  }
  function block(label: string,w: number,l: number,h: number,x: number,y: number,z: number,category='metal', motion:Vec3=[0,0,0]) {
    add(label,boxMesh(w,l,h),[rigid(x,y,z)],[x-w/2,y,z-h/2,x+w/2,y+l,z+h/2],category,motion);
  }
  function channel(category: string, covers: boolean) {
    block('底板',W+2*t,length,t,cx,lo[1],floor-t/2,category,[0,0,-H*.4]);
    block('左侧壁',t,length,H,cx-W/2-t/2,lo[1],cz,category,[-W*.45,0,0]);
    block('右侧壁',t,length,H,cx+W/2+t/2,lo[1],cz,category,[W*.45,0,0]);
    if (covers) {
      const segment=length/count,gap=Math.min(.008,segment*.12);
      const placements=Array.from({length:count},(_,i)=>rigid(cx,lo[1]+i*segment+gap/2,cz+H/2+t/2));
      add('分段盖板',boxMesh(W+2*t,segment-gap,t),placements,[cx-W/2-t,lo[1],cz+H/2,cx+W/2+t,hi[1],cz+H/2+t],category,[0,0,H*.75]);
    }
  }
  function supports() {
    const ys=Array.from({length:count},(_,i)=>lo[1]+(length-t)*i/(count-1));
    const placements=ys.map(y=>rigid(cx,y,lo[2]-spec.clearance/2));
    add('重复横档',boxMesh(W,t,t),placements,[cx-W/2,lo[1],lo[2]-spec.clearance/2-t/2,cx+W/2,hi[1],lo[2]-spec.clearance/2+t/2],'metal',[0,0,-H*.25]);
    for(const side of [-1,1]) {
      block(side<0?'左纵梁':'右纵梁',t,length,2*t,cx+side*(W/2-t/2),lo[1],lo[2]-spec.clearance/2,'metal',[side*W*.35,0,0]);
      const postH=Math.max(t,H/2-spec.clearance);
      const posts=ys.map(y=>rigid(cx+side*(W/2-t/2),y,floor+postH/2));
      add(side<0?'左支座':'右支座',boxMesh(t,t,postH),posts,[cx+side*(W/2-t/2)-t/2,lo[1],floor,cx+side*(W/2-t/2)+t/2,hi[1],floor+postH],'metal',[side*W*.35,0,0]);
    }
  }
  if (spec.kind==='trench') { channel('insulation',true); supports(); }
  else if (spec.kind==='tray') supports();
  else if (spec.kind==='tunnel') {
    if(Math.abs(W-H)>1e-8)throw new Error('圆形隧道的净宽与净高须相同；不静默改成另一断面。');
    const r=W/2;
    if (cables.some(o=>Math.hypot(Math.max(Math.abs(o.bounds[0]-cx),Math.abs(o.bounds[3]-cx)),Math.max(Math.abs(o.bounds[2]-cz),Math.abs(o.bounds[5]-cz)))+spec.clearance>r)) throw new Error('当前电缆与间隙超出隧道净空。');
    add('隧道衬砌·四分之三剖视',sectorMesh(r,r+t,length,Math.PI*1.5),[rigid(cx,lo[1],cz)],[cx-r-t,lo[1],cz-r-t,cx+r+t,hi[1],cz+r+t],'insulation',[W*.35,0,H*.25]);
    block('检修走道',W*.6,length,t,cx,lo[1],cz-r*.75,'insulation',[0,0,-H*.3]); supports();
  } else if (spec.kind==='duct-bank') {
    const outerR=cables.map(o=>Math.max(o.bounds[3]-o.bounds[0],o.bounds[5]-o.bounds[2])/2+spec.clearance+t);
    for(let i=0;i<cables.length;i++) for(let j=i+1;j<cables.length;j++) {
      const a=cables[i].bounds,b=cables[j].bounds;
      if(Math.hypot((a[0]+a[3]-b[0]-b[3])/2,(a[2]+a[5]-b[2]-b[5])/2)<outerR[i]+outerR[j]-1e-8) throw new Error('管壁相互穿透：需要真实调整管间距或减小间隙，而不是改变电缆位置。');
    }
    cables.forEach((o,i)=>{const b=o.bounds,x=(b[0]+b[3])/2,z=(b[2]+b[5])/2,r=outerR[i];add(`${o.label}保护管·开窗`,sectorMesh(r-t,r,length,Math.PI*1.5),[rigid(x,lo[1],z)],[x-r,lo[1],z-r,x+r,hi[1],z+r],'polymer',[0,0,H*.45]);});
    block('排管托板',W,length,t,cx,lo[1],floor-t/2,'insulation',[0,0,-H*.3]);
  } else {
    channel('soil',false);
    if(spec.kind==='backfill') {
      const depth=Math.min(spec.clearance/2,H/8);
      block('回填底部剖视条',W,length,depth,cx,lo[1],floor+depth/2,'filler',[0,0,-H*.15]);
      block('回填侧向剖视条',depth,length,H,cx-W/2+depth/2,lo[1],cz,'filler',[-W*.25,0,0]);
    }
  }
  // Bounds include proposal geometry for camera fit; original model remains unchanged.
  const shown=model.objects.filter(o=>o.kind==='cable'||addedIds.includes(o.id));
  model.bounds=[...Array.from({length:3},(_,i)=>Math.min(...shown.map(o=>o.bounds[i]))),...Array.from({length:3},(_,i)=>Math.max(...shown.map(o=>o.bounds[i+3])))];
  return { model, addedIds, requirements: definition.requirements, sourceIdentity: base.identity };
}
