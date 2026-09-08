import {useState} from 'react';
import {Box,ChartNoAxesCombined,Layers3,Thermometer,TriangleAlert} from 'lucide-react';
import {useStudio} from '../StudioState';
import CableModelView from '../CableModelView';
import {CrossSection,HeatField,LineChart} from '../Visuals';

type View='model'|'section'|'temperature'|'curve';
/** Views of the same saved input/run; changing view never invokes a calculation. */
export default function EngineeringViewport(){
 const s=useStudio(),[view,setView]=useState<View>('model');
 if(!s.w)return null;
 return <section className="engineering-viewport" aria-label="工程模型与结果画布" data-view={view}>
  <nav className="viewport-tabs" aria-label="画布视图">
   {([{id:'model',label:'三维结构',Icon:Box},{id:'section',label:'二维截面',Icon:Layers3},{id:'temperature',label:'温度分布',Icon:Thermometer},{id:'curve',label:'载流量曲线',Icon:ChartNoAxesCombined}] as const).map(({id,label,Icon})=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}><Icon size={16}/>{label}</button>)}
   <span className="viewport-run-badge">{s.current?'当前输入 · 已计算':'工程输入 · 待计算'}</span>
  </nav>
  <div className="viewport-pane" hidden={view!=='model'}><CableModelView cable={s.w.scenario.cable}/></div>
  <div className="viewport-pane section-pane" hidden={view!=='section'}><div className="viewport-note">等比例截面 · 尺寸来自当前工程，不是厂家制造图</div><CrossSection cable={s.w.scenario.cable}/></div>
  <div className="viewport-pane field-pane" hidden={view!=='temperature'}>
   {s.current?<><div className="viewport-note">均匀土壤半空间解析温度 · 非有限元 · 不反向修正载流量</div><HeatField result={s.current}/></>:<MissingResult stale={!!s.output?.result}/>}
  </div>
  <div className="viewport-pane curve-pane" hidden={view!=='curve'}>
   {s.current?<><div className="viewport-note">当前输入的电流—温度关系 · 横轴电流，纵轴最高导体温度</div><LineChart data={s.current.curve.map(p=>({x:p.current_a,y:p.temperature_c}))} xLabel="电流 / A" yLabel="最高导体温度 / °C" threshold={s.current.input.cable.max_temperature_c} label="画布载流量曲线"/></>:<MissingResult stale={!!s.output?.result}/>}
  </div>
 </section>;
}
function MissingResult({stale}:{stale:boolean}){return <div className="viewport-empty" role="status"><TriangleAlert size={28}/><h2>{stale?'输入已变化，请重新计算':'尚无当前工况结果'}</h2><p>使用上方“计算载流量”建立有效结果。此处不会显示演示温度或旧工况的场图。</p></div>}
