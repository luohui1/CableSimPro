import {useState} from 'react';
import {ChevronDown,FileText,LockKeyhole,Ruler,Save,Settings2,Thermometer,Zap} from 'lucide-react';
import {useStudio,valueAt,type Workspace} from '../StudioState';
import {fmt} from '../utils';
import {objects,layerKeys,parseDraft,type FieldSpec,type ObjectKey} from './fields';
import type {GeometryLayer} from './EngineeringGraphics';

/** Display swatches from our existing design-system assets. Never material properties. */
const swatches:Partial<Record<ObjectKey,string>>={conductor:'copper',conductor_screen:'semicon',insulation:'xlpe',insulation_screen:'screen',metallic_screen:'metal',jacket:'jacket'};
export function LayerSwatch({object,conductor,large=false}:{object:ObjectKey;conductor:string;large?:boolean}){
 const name=object==='conductor'&&conductor==='aluminium'?'metal':swatches[object];
 return name?<img className={large?'wf-material-preview':'wf-object-icon'} src={`/workbench-assets/material-${name}.svg`} alt="" aria-hidden="true"/>:null;
}
function category(f:FieldSpec):'geometry'|'thermal'|'electrical'{
 if(/rho_k_m_w|ambient_temperature/.test(f.path))return 'thermal';
 if(/mm|fill_factor|arrangement|depth_m|spacing_m/.test(f.path)&&!f.path.includes('ohm'))return 'geometry';
 return 'electrical';
}
const categories={geometry:{label:'几何与结构',Icon:Ruler},thermal:{label:'材料与热参数',Icon:Thermometer},electrical:{label:'电气与运行',Icon:Zap}};
export default function ObjectInspector({selection,layers,result,baseRevision,conflict,invalid,onEdit,onSave,onPick}:{
 selection:ObjectKey;layers?:GeometryLayer[];result:Workspace['runs'][number]|null|undefined;
 baseRevision:number|null;conflict:boolean;invalid:boolean;
 onEdit:(path:string,text:string)=>void;onSave:()=>void;onPick:(key:ObjectKey)=>void;
}){
 const s=useStudio(),w=s.w!,dirty=Object.keys(s.inputDrafts).length>0,object=objects[selection];
 const [collapsed,setCollapsed]=useState<Record<string,boolean>>({});
 const index=layerKeys.indexOf(selection),geometry=layers?.[index];
 function field(spec:FieldSpec){
  const text=s.inputDrafts[spec.path]??String(valueAt(w.scenario,spec.path)??'');
  const err=spec.path in s.inputDrafts?parseDraft(spec.path,text).error:null,locked=w.locks.includes(spec.path);
  return <div className="wf-property" key={spec.path} data-draft={spec.path in s.inputDrafts}>
   <label htmlFor={`wf-${spec.path}`}>{spec.label}{locked&&<LockKeyhole size={12} aria-label="已锁定"/>}</label>
   <div className="wf-input-unit">{spec.options?<select id={`wf-${spec.path}`} value={text} disabled={s.busy||locked} onChange={e=>onEdit(spec.path,e.target.value)}>{spec.options.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select>:<input id={`wf-${spec.path}`} inputMode="decimal" value={text} disabled={s.busy||locked} aria-invalid={!!err} aria-describedby={err?`wf-error-${spec.path}`:undefined} onChange={e=>onEdit(spec.path,e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){s.setInputDraft(spec.path,null);e.stopPropagation()}}}/>}<span>{spec.unit}</span></div>
   {err&&<p id={`wf-error-${spec.path}`} className="wf-inline-error">{err}</p>}
   {spec.path in s.inputDrafts&&<small>已保存：{String(valueAt(w.scenario,spec.path)??'未提供')}</small>}
  </div>;
 }
 return <aside className="wf-inspector" aria-label="上下文属性检查器">
  <div className="wf-pane-heading"><h2><Settings2 size={15}/>属性检查器</h2><span>{dirty?'草稿':'已同步'}</span></div>
  <header className="wf-object-heading"><div><small>{result?'SAVED RUN':`C-001${index>=0?` / ${String(index+1).padStart(2,'0')}`:''}`}</small><h2>{result?`运行 rev.${result.revision}`:object.name}</h2><p>{result?'只读运行快照':object.caption}</p></div>{!result&&<LayerSwatch object={selection} conductor={w.scenario.cable.conductor} large/>}</header>
  {geometry&&!result&&<div className="wf-object-measures"><div><span>外径</span><b>{fmt(geometry.outer_radius_m*2000,3)}<small> mm</small></b></div><div><span>{index===0?'截面积':'层厚'}</span><b>{fmt(index===0?w.scenario.cable.area_mm2:(geometry.outer_radius_m-geometry.inner_radius_m)*1000,index===0?0:2)}<small>{index===0?' mm²':' mm'}</small></b></div><span className="wf-measure-origin">已保存几何</span></div>}
  <div className="wf-properties">{result?<section className="wf-readonly-result"><FileText size={22}/><h3>运行来源</h3><p>工程版本 rev.{result.revision}</p><p>当前工程 rev.{w.revision}</p><code>{result.input_hash}</code><button onClick={()=>onPick('cable')}>返回电缆参数</button></section>:Object.entries(categories).map(([id,{label,Icon}])=>{
   const specs=object.fields.filter(f=>category(f)===id);if(!specs.length)return null;
   const key=selection+':'+id;
   return <details className="wf-property-group" key={key} open={!collapsed[key]} onToggle={e=>{const closed=!e.currentTarget.open;setCollapsed(old=>old[key]===closed?old:{...old,[key]:closed})}}><summary><Icon size={15}/><span>{label}</span><ChevronDown size={14}/></summary><div>{specs.map(field)}</div></details>;
  })}
   <details className="wf-source"><summary><FileText size={14}/><span>来源与编辑约束</span><ChevronDown size={14}/></summary><p>修改经后端整组校验后保存。上方几何使用已保存输入；材质缩略图仅作视觉区分，不提供物性。</p>{w.sources.map(src=><p key={src.id}>{src.title} · 第 {src.page} 页</p>)}{!w.sources.length&&<p>尚无关联资料，参数来源仍需核对。</p>}</details>
  </div>
  <footer className="wf-save"><p><i data-dirty={dirty}/>{dirty?`${Object.keys(s.inputDrafts).length} 项草稿 · rev.${baseRevision??w.revision}`:`已保存 · rev.${w.revision}`}<kbd>Ctrl S</kbd></p><button className="wf-primary" disabled={!dirty||s.busy||invalid||conflict} onClick={onSave}><Save size={15}/>保存全部修改</button>{dirty&&<button disabled={s.busy} onClick={()=>{s.discardInputs();s.dismiss()}}>撤销未保存输入</button>}</footer>
 </aside>;
}
