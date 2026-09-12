import './plugin-workspace-layout.css';
import BuriedResult from './BuriedResult';
import {useEffect,useRef,useState} from 'react';

export interface PluginExecution {
 job_id:string;command:string;project_revision:number;source_sha256:string;lock_sha256:string;
 status:'succeeded'|'stale';promoted_to_current_ampacity:false;
 plugin:{plugin_id:string;version:string;release_sha256:string};
 artifacts:{path:string;sha256:string;size_bytes:number}[];
 result:{summary?:Record<string,unknown>;warnings?:string[];runtime_versions?:Record<string,string>};
}
interface Field {schema_version:'cablesim.thermal-field/1';unit:'K';coordinate_unit:'m';association:'node';points:[number,number,number][];triangles:[number,number,number][];domain_ids:number[];values:number[]}
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
function checkedField(raw:unknown):Field {
 const f=raw as Field;
 if(!f||f.schema_version!=='cablesim.thermal-field/1'||f.unit!=='K'||f.coordinate_unit!=='m'||f.association!=='node'||
  !Array.isArray(f.points)||f.points.length<3||f.points.length>50000||!Array.isArray(f.values)||f.values.length!==f.points.length||
  !f.values.every(v=>finite(v)&&v>=0)||!f.points.every(p=>Array.isArray(p)&&p.length===3&&p.every(finite))||
  !Array.isArray(f.triangles)||f.triangles.length>100000||!Array.isArray(f.domain_ids)||f.domain_ids.length!==f.triangles.length||
  !f.triangles.every(t=>Array.isArray(t)&&t.length===3&&new Set(t).size===3&&t.every(i=>Number.isInteger(i)&&i>=0&&i<f.points.length)))throw new Error('场工件的单位、网格或节点数量不符合契约。');
 return f;
}
function FieldCanvas({field}:{field:Field}){
 const ref=useRef<HTMLCanvasElement>(null);const [mesh,setMesh]=useState(false);
 const low=Math.min(...field.values),high=Math.max(...field.values);
 useEffect(()=>{
  const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return;
  const points=field.points;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1])}
  const scale=(canvas.width-40)/Math.max(maxX-minX,maxY-minY),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const tri of field.triangles){const avg=tri.reduce((s,i)=>s+field.values[i],0)/3,t=high>low?(avg-low)/(high-low):0;
   ctx.fillStyle=`hsl(${225-215*t} 65% 46%)`;ctx.beginPath();tri.forEach((i,j)=>{const p=points[i],x=canvas.width/2+(p[0]-cx)*scale,y=canvas.height/2-(p[1]-cy)*scale;j?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.fill();ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.6;ctx.stroke();
   if(mesh){ctx.strokeStyle='#19314b66';ctx.lineWidth=.45;ctx.stroke()}
  }
 },[field,mesh,low,high]);
 return <figure className="plugin-field-figure"><canvas ref={ref} width={500} height={500} role="img" aria-label="已求解的有限元截面温度场"/><div className="plugin-field-scale"><span>{(low-273.15).toFixed(2)} °C</span><i aria-hidden="true"/><span>{(high-273.15).toFixed(2)} °C</span></div><figcaption>同一网格上的节点温度 · 单元按节点平均温度着色 · 坐标等比例</figcaption><button type="button" aria-pressed={mesh} onClick={()=>setMesh(v=>!v)}>{mesh?'隐藏网格':'显示网格'}</button></figure>;
}
function SectionResult({project,result}:{project:string;result:PluginExecution}){
 const [field,setField]=useState<Field|null>(null),[error,setError]=useState('');
 const item=result.artifacts.find(a=>a.path==='field.json');
 useEffect(()=>{setField(null);setError('');if(!item)return;const controller=new AbortController();
  void (async()=>{const response=await fetch(`/api/plugins/workspaces/${project}/jobs/${result.job_id}/artifacts/field.json`,{signal:controller.signal});
   if(!response.ok)throw new Error('场工件读取失败或完整性检查未通过。');
   const bytes=await response.arrayBuffer();if(bytes.byteLength!==item.size_bytes||bytes.byteLength>32*1024*1024)throw new Error('场工件大小不一致。');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==item.sha256)throw new Error('场工件摘要不一致。');
   const f=checkedField(JSON.parse(new TextDecoder().decode(bytes)));
   const peak=result.result.summary?.maximum_temperature_c;
   if(!finite(peak)||Math.abs(Math.max(...f.values)-273.15-peak)>1e-7)throw new Error('场工件与运行摘要不一致。');
   if(!controller.signal.aborted)setField(f);
  })().catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort();
 },[project,result.job_id,item?.sha256]);
 const s=result.result.summary??{},numeric=(key:string,digits=4)=>finite(s[key])?(s[key] as number).toFixed(digits):'—';
 return <section className="plugin-result-panel" aria-label="插件研究结果"><header><h3>研究结果</h3><span>rev.{result.project_revision} · {result.status==='stale'?'历史快照，不能作为当前结果':'独立插件工件'}</span></header>
  {result.command==='skfem.radial-thermal'?<><p>单根电缆截面 · 指定缆表温度与导体发热。不是埋地载流量。</p><div className="plugin-field-layout"><div>{error?<p role="alert">{error}</p>:field?<FieldCanvas field={field}/>:<p role="status">正在校验并读取场工件…</p>}</div><dl><dt>最高温度</dt><dd>{numeric('maximum_temperature_c')} °C</dd><dt>解析基准峰值</dt><dd>{numeric('analytic_maximum_temperature_c')} °C</dd><dt>输入导体发热</dt><dd>{numeric('source_heat_w_m',2)} W/m</dd><dt>离散能量相对残差</dt><dd>{finite(s.energy_relative_residual)?s.energy_relative_residual.toExponential(3):'—'}</dd><dt>节点 / 单元</dt><dd>{numeric('nodes',0)} / {numeric('elements',0)}</dd></dl></div></>:
  <dl>{Object.entries(s).filter(([,v])=>typeof v==='number'||typeof v==='string').map(([key,v])=><div key={key}><dt>{({solid_count:'CAD 实体数',nodes:'节点数',elements:'单元数',domains:'物理域数量',length_unit:'长度单位',temperature_max_c:'最高温度 / °C',temperature_min_c:'最低温度 / °C'} as Record<string,string>)[key]??key}</dt><dd>{String(v)}</dd></div>)}</dl>}
  <div className="plugin-result-files" aria-label="运行工件">{result.artifacts.map(a=><a key={a.path} href={`/api/plugins/workspaces/${project}/jobs/${result.job_id}/artifacts/${encodeURIComponent(a.path)}`} download>{a.path}</a>)}</div>
  <details><summary>版本、原始数据与适用边界</summary><p>{result.plugin.plugin_id} @ {result.plugin.version}</p><code>{result.plugin.release_sha256}</code>{result.result.warnings?.map(w=><p key={w}>{w}</p>)}<pre>{JSON.stringify(result,null,2)}</pre></details>
 </section>;
}

export default function PluginResult(props:{project:string;result:PluginExecution}){
 return props.result.command==='skfem.buried-reference'?<BuriedResult {...props}/>:<SectionResult {...props}/>;
}
