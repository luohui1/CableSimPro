import {EngineeringChart} from './ScientificChart';
import {engineeringCall} from './runtimeClient';
import {useRef,useState} from 'react';
import {Activity,ArrowRight,Download,ShieldCheck,Thermometer} from 'lucide-react';
import {useStudio} from './StudioState';
import {api,canonical,download,errorText,fmt} from './utils';
import type {Cable} from './types';

export interface VerticalConfig {
 height_m:number;ambient_bottom_c:number;ambient_top_c:number;
 h_w_m2k:number;emissivity:number;cells:number;
}
export const defaultVertical:VerticalConfig={height_m:20,ambient_bottom_c:25,ambient_top_c:40,h_w_m2k:8,emissivity:.85,cells:40};
interface AxialState {
 current_a:number;z_m:number[];ambient_c:number[];conductor_c:number[];screen_c:number[];surface_c:number[];
 total_loss_w_m:number[];convection_w_m:number[];radiation_w_m:number[];
 max_temperature_c:number;hotspot_height_m:number;single_cable_loss_w:number;
 balance_error_w:number;max_node_residual_w_m:number;iterations:number;
}
interface VerticalResult {
 design_basis?:Record<string,unknown>;
 id:string;domain:'vertical_air';base_revision:number;model:string;ampacity_a:number;
 rating:AxialState;operating:AxialState|null;operating_error:string|null;
 configuration:VerticalConfig;input:{cable:Cable;configuration:VerticalConfig;current_a:number};
 input_sha256:string;warnings:string[];
 mesh_check?:{cells:number;coarse_cells:number;ampacity_difference_percent:number;coarse_ampacity_a:number};
}

export function VerticalSettings({value,onChange,disabled=false}:{value:VerticalConfig;onChange:(v:VerticalConfig)=>void;disabled?:boolean}) {
 const fields:{key:keyof VerticalConfig;name:string;min:number;max:number;unit:string}[]=[
  {key:'height_m',name:'竖向高度',min:1,max:300,unit:'m'},
  {key:'ambient_bottom_c',name:'底部空气温度',min:-20,max:60,unit:'°C'},
  {key:'ambient_top_c',name:'顶部空气温度',min:-20,max:80,unit:'°C'},
  {key:'h_w_m2k',name:'表面对流系数 h',min:1,max:50,unit:'W/(m²·K)'},
  {key:'emissivity',name:'表面辐射率',min:0,max:1,unit:'0–1'},
 ];
 return <div className="domain-form-grid vertical-settings">{fields.map(f=><label key={f.key}>{f.name} / {f.unit}<input aria-label={f.name} required disabled={disabled} type="number" min={f.min} max={f.max} step="any" value={Number.isFinite(value[f.key])?value[f.key]:''} onChange={e=>onChange({...value,[f.key]:e.target.value===''?NaN:Number(e.target.value)})}/></label>)}<label>轴向有限体积网格<select aria-label="竖向轴向网格" value={value.cells} disabled={disabled} onChange={e=>onChange({...value,cells:Number(e.target.value)})}>{[20,40,80].map(n=><option key={n} value={n}>{n} 个控制体</option>)}</select></label></div>;
}

function AxialProfile({state,height}:{state:AxialState;height:number}) {
 return <EngineeringChart label="竖向沿高温度曲线" xLabel="温度 / °C" yLabel="高度 / m" series={[
 {name:'导体',points:state.z_m.map((z,i)=>[state.conductor_c[i],z])},
 {name:'金属屏蔽',points:state.z_m.map((z,i)=>[state.screen_c[i],z])},
 {name:'外护套表面',points:state.z_m.map((z,i)=>[state.surface_c[i],z])},
 {name:'空气',points:state.z_m.map((z,i)=>[state.ambient_c[i],z])}]}/>;
}

export function VerticalPanel() {
 const s=useStudio(),w=s.w!;
 const source=[...w.sources].reverse().find(p=>(p as unknown as {research_domain?:string}).research_domain==='vertical_air') as unknown as {vertical?:VerticalConfig}|undefined;
 const [configuration,setConfiguration]=useState<VerticalConfig>(source?.vertical??defaultVertical);
 const [compare,setCompare]=useState(true),[out,setOut]=useState<VerticalResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[rating,setRating]=useState(false);
 const form=useRef<HTMLFormElement>(null);
 const input={cable:w.scenario.cable,configuration,current_a:w.scenario.operating_current_a};
 const stale=!!out&&(canonical(out.input)!==canonical(input)||canonical(out.design_basis??null)!==canonical(w.design_basis??null)||out.base_revision!==w.revision);
 const shown=out?(rating?out.rating:out.operating):null;
 async function run(){
  if(!form.current?.reportValidity())return;
  setBusy(true);setError('');
  try {if(Object.keys(s.inputDrafts).length)throw new Error('存在未提交输入，请先修正或撤销输入。');setOut(await engineeringCall<VerticalResult>(w.id,w.revision,'analysis.vertical',{configuration,compare_mesh:compare}));await s.reload()}
  catch(e){setError(errorText(e))}finally{setBusy(false)}
 }
 return <div className="vertical-panel">
 <div className="domain-notice"><ShieldCheck size={20}/><div><b>竖向电热：独立的空气边界，不套用直埋热阻</b><p>单根隔离电缆，沿高度有限体积 + 四节点径向热网络，包含电阻温度反馈、对流及表面辐射。h 与沿高空气温度是输入，不是井道通风或烟囱效应计算。</p></div></div>
 {error&&<div className="domain-alert" role="alert">{error}</div>}
 <form ref={form} onSubmit={e=>{e.preventDefault();void run()}}>
 <VerticalSettings value={configuration} onChange={setConfiguration} disabled={busy}/>
 <div className="vertical-actions"><label className="checkline"><input aria-label="竖向网格对照" type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)} disabled={busy}/>附加半数网格对照</label><span>当前工程运行电流 <b>{fmt(w.scenario.operating_current_a,0)} A</b></span><button className="primary" type="submit" disabled={busy||s.busy}><Activity size={16}/>{busy?'求解轴向电热…':'运行竖向电热'}</button></div>
 </form>
 <p className="domain-footnote">运行电流在“运行条件”属性中设置。本页只使用竖向空气求解按钮，不使用直埋快捷计算。</p>
 {out&&<>{stale&&<div className="domain-alert" role="alert">边界或电缆参数已变化：下面为历史竖向研究，需重新求解。</div>}
 <div className="vertical-summary" data-testid="vertical-summary"><div><small>允许载流量 · 单根</small><b>{fmt(out.ampacity_a)} <em>A</em></b></div><div><small>运行最高导体温度</small><b>{fmt(out.operating?.max_temperature_c)} <em>°C</em></b></div><div><small>运行热点控制体高度</small><b>{fmt(out.operating?.hotspot_height_m,2)} <em>m</em></b></div><div><small>运行损耗 · 单根全高</small><b>{fmt(out.operating?.single_cable_loss_w)} <em>W</em></b></div></div>
 <div className="vertical-actions"><button className={!rating?'chosen':''} onClick={()=>setRating(false)}>运行曲线</button><button className={rating?'chosen':''} onClick={()=>setRating(true)}>极限曲线</button><span className="tool-spacer"/><button disabled={stale} onClick={()=>download('CableSimPro-竖向电热.json',JSON.stringify(out,null,2),'application/json')}><Download size={14}/>导出研究快照</button></div>
 {shown?<AxialProfile state={shown} height={out.configuration.height_m}/>:<div className="domain-alert">{out.operating_error} 未显示伪造的运行温度；可单独查看已求得的极限工况。</div>}
 <div className="field-diagnostics"><div><span>额定工况热平衡误差 / W</span><b>{out.rating.balance_error_w.toExponential(3)}</b></div><div><span>额定节点最大残差 / W·m⁻¹</span><b>{out.rating.max_node_residual_w_m.toExponential(3)}</b></div>{out.mesh_check&&<><div><span>轴向网格对照</span><b>{out.mesh_check.coarse_cells} → {out.mesh_check.cells}</b></div><div><span>粗细网格载流量差异 / %</span><b>{fmt(out.mesh_check.ampacity_difference_percent,4)}</b></div></>}</div>
 <section className="domain-method"><h3>模型假设与设计限制</h3>{out.warnings.map(n=><p key={n}>{n}</p>)}<code>{out.model} / rev.{out.base_revision} / SHA-256 {out.input_sha256}</code></section>
 </>}
 <div className="domain-notice compact"><Thermometer size={16}/><span>竖向选型已在“反向选型”中提供独立研究域。所需候选必须同时满足载流预留、尺寸、材料、声明电压与锁条件。</span><button onClick={()=>s.setTab('selection')}>进入选型<ArrowRight size={14}/></button></div>
 </div>;
}
