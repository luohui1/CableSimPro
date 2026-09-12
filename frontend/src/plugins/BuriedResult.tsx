import {useEffect,useRef,useState} from 'react';
import type {PluginExecution} from './PluginResult';

type Point=[number,number,number];
interface BuriedField {
 schema_version:'cablesim.buried-field/1';dimension:2;unit:'K';coordinate_unit:'m';association:'node';positive_y:'depth';
 points:Point[];triangles:[number,number,number][];domain_ids:number[];values:number[];
 cable_centers_m:[number,number][];cable_outer_radius_m:number;half_width_m:number;bottom_depth_m:number;
}
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
function range(values:number[]):[number,number]{let lo=Infinity,hi=-Infinity;for(const v of values){lo=Math.min(lo,v);hi=Math.max(hi,v)}return [lo,hi]}
function checked(raw:unknown,summary:Record<string,unknown>):BuriedField {
 const f=raw as BuriedField;
 if(!f||f.schema_version!=='cablesim.buried-field/1'||f.dimension!==2||f.unit!=='K'||f.coordinate_unit!=='m'||f.association!=='node'||f.positive_y!=='depth'||
  !Array.isArray(f.points)||f.points.length<3||f.points.length>100000||!f.points.every(p=>Array.isArray(p)&&p.length===3&&p.every(finite)&&Math.abs(p[2])<1e-12)||
  !Array.isArray(f.values)||f.values.length!==f.points.length||!f.values.every(v=>finite(v)&&v>=0)||
  !Array.isArray(f.triangles)||!f.triangles.length||f.triangles.length>200000||!f.triangles.every(t=>Array.isArray(t)&&t.length===3&&new Set(t).size===3&&t.every(i=>Number.isInteger(i)&&i>=0&&i<f.points.length))||
  !Array.isArray(f.domain_ids)||f.domain_ids.length!==f.triangles.length||new Set(f.domain_ids).size!==19||!f.domain_ids.every(i=>Number.isInteger(i)&&i>=1&&i<=19)||
  !Array.isArray(f.cable_centers_m)||f.cable_centers_m.length!==3||!f.cable_centers_m.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite))||
  ![f.cable_outer_radius_m,f.half_width_m,f.bottom_depth_m].every(v=>finite(v)&&v>0))throw new Error('直埋场工件的单位、网格、坐标方向或分域不符合契约。');
 if(summary.nodes!==f.points.length||summary.elements!==f.triangles.length||!finite(summary.maximum_temperature_c)||Math.abs(range(f.values)[1]-273.15-summary.maximum_temperature_c)>1e-7)throw new Error('直埋场工件与运行摘要不一致。');
 return f;
}
function Field({field}:{field:BuriedField}){
 const ref=useRef<HTMLCanvasElement>(null),[whole,setWhole]=useState(false),[mesh,setMesh]=useState(false);
 const [lo,hi]=range(field.values);
 useEffect(()=>{
  const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return;
  const xs=field.cable_centers_m.map(p=>p[0]),ys=field.cable_centers_m.map(p=>p[1]);
  const r=field.cable_outer_radius_m;
  let x0=-field.half_width_m,x1=field.half_width_m,y0=0,y1=field.bottom_depth_m;
  if(!whole){x0=Math.min(...xs)-4*r;x1=Math.max(...xs)+4*r;y0=Math.max(0,Math.min(...ys)-4*r);y1=Math.max(...ys)+4*r}
  const left=62,top=24,width=410,height=whole?205:410,scale=Math.min(width/(x1-x0),height/(y1-y0)),cx=(x0+x1)/2,cy=(y0+y1)/2;
  const px=(x:number)=>left+width/2+(x-cx)*scale,py=(y:number)=>top+height/2+(y-cy)*scale;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip();
  for(const tri of field.triangles){const v=tri.reduce((sum,i)=>sum+field.values[i],0)/3,t=hi>lo?(v-lo)/(hi-lo):0;
   ctx.fillStyle=`hsl(${225-215*t} 65% 46%)`;ctx.beginPath();tri.forEach((i,j)=>{const p=field.points[i];j?ctx.lineTo(px(p[0]),py(p[1])):ctx.moveTo(px(p[0]),py(p[1]))});ctx.closePath();ctx.fill();ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.6;ctx.stroke();
   if(mesh){ctx.strokeStyle='#19314b66';ctx.lineWidth=.45;ctx.stroke()}
  }
  if(!whole){ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
   field.cable_centers_m.forEach((p,i)=>{ctx.fillStyle='#fff';ctx.fillRect(px(p[0])-10,py(p[1])-11,20,22);ctx.fillStyle='#24313d';ctx.fillText('ABC'[i],px(p[0]),py(p[1]))})}
  ctx.restore();ctx.strokeStyle='#6f8191';ctx.lineWidth=1;ctx.strokeRect(left,top,width,height);ctx.fillStyle='#31475b';ctx.font='12px system-ui';ctx.textBaseline='middle';
  for(let i=0;i<=4;i++){ctx.textAlign='center';ctx.fillText((cx+(i/4-.5)*width/scale).toFixed(2),left+i*width/4,top+height+17);ctx.textAlign='right';ctx.fillText((cy+(i/4-.5)*height/scale).toFixed(2),left-8,top+i*height/4)}
  ctx.textAlign='center';ctx.fillText('x / m',left+width/2,top+height+39);ctx.save();ctx.translate(13,top+height/2);ctx.rotate(-Math.PI/2);ctx.fillText('深度 / m（向下）',0,0);ctx.restore();
 },[field,whole,mesh,lo,hi]);
 return <figure className="plugin-field-figure"><canvas ref={ref} width={500} height={whole?295:500} style={{aspectRatio:whole?'500 / 295':'1'}} role="img" aria-label="三相电缆与土壤有限元温度场"/><div className="plugin-field-scale"><span>{(lo-273.15).toFixed(2)} °C</span><i aria-hidden="true"/><span>{(hi-273.15).toFixed(2)} °C</span></div><figcaption>{whole?'完整土壤计算域；地表在深度 0 m':'电缆邻域局部视窗，图框不是计算边界'}<br/>节点温度按单元平均显示 · 两轴等比例</figcaption><div className="plugin-view-actions"><button aria-pressed={whole} onClick={()=>setWhole(v=>!v)}>{whole?'查看电缆邻域':'查看完整土壤域'}</button><button aria-pressed={mesh} onClick={()=>setMesh(v=>!v)}>{mesh?'隐藏网格':'显示网格'}</button></div></figure>;
}
export default function BuriedResult({project,result}:{project:string;result:PluginExecution}){
 const [field,setField]=useState<BuriedField|null>(null),[error,setError]=useState('');
 const item=result.artifacts.find(a=>a.path==='field.json'),summary=result.result.summary??{};
 useEffect(()=>{setField(null);setError('');const abort=new AbortController();
  void (async()=>{if(!item)throw new Error('运行没有可验证的场工件。');
   const response=await fetch(`/api/plugins/workspaces/${project}/jobs/${result.job_id}/artifacts/field.json`,{signal:abort.signal});if(!response.ok)throw new Error('直埋场工件不可读或完整性检查失败。');
   const bytes=await response.arrayBuffer();if(bytes.byteLength!==item.size_bytes||bytes.byteLength>32*1024*1024)throw new Error('场工件大小不一致。');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==item.sha256)throw new Error('场工件摘要不一致。');
   const value=checked(JSON.parse(new TextDecoder().decode(bytes)),summary);if(!abort.signal.aborted)setField(value);
  })().catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort();
 },[project,result.job_id,item?.sha256]);
 const number=(key:string,digits=3)=>finite(summary[key])?(summary[key] as number).toFixed(digits):'—';
 const phases=Array.isArray(summary.conductor_max_temperatures_c)?summary.conductor_max_temperatures_c:[];
 return <section className="plugin-result-panel" aria-label="直埋热研究结果"><header><h3>电缆与土壤温度场</h3><span>rev.{result.project_revision} · {result.status==='stale'?'历史快照':'独立定功率研究'}</span></header><p>19 个材料域 · 不是允许电流结果 · 地表、侧面和底部固定为环境温度。</p>
  {error?<p role="alert">{error}</p>:field?<Field field={field}/>:<p role="status">正在校验直埋温度场…</p>}
  <dl className="buried-summary"><dt>三相导体最高温度</dt><dd>{phases.map((v,i)=>`${'ABC'[i]}: ${finite(v)?v.toFixed(3):'—'} °C`).join(' / ')}</dd><dt>总发热 / 边界散热</dt><dd>{number('source_heat_w_m')} / {number('boundary_heat_w_m')} W/m</dd><dt>环境温度 / 土壤热导率</dt><dd>{number('ambient_temperature_c',1)} °C / {number('soil_k_w_m_k')} W/(m·K)</dd><dt>土壤域半宽 / 深度</dt><dd>{number('half_width_m',2)} / {number('bottom_depth_m',2)} m</dd><dt>节点 / 单元</dt><dd>{number('nodes',0)} / {number('elements',0)}</dd><dt>离散能量相对残差</dt><dd>{finite(summary.energy_relative_residual)?summary.energy_relative_residual.toExponential(3):'零发热时不定义'}</dd></dl>
  <p>单次计算不代表网格或远边界无关。改变土壤域尺度后需重新运行并比较；不据此给出载流量或合格结论。</p>
  <div className="plugin-result-files">{result.artifacts.map(a=><a key={a.path} href={`/api/plugins/workspaces/${project}/jobs/${result.job_id}/artifacts/${encodeURIComponent(a.path)}`} download>{a.path}</a>)}</div>
  <details><summary>原始结果与适用边界</summary>{result.result.warnings?.map(w=><p key={w}>{w}</p>)}<pre>{JSON.stringify(result,null,2)}</pre></details>
 </section>;
}
