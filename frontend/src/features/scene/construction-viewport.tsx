import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { useViewState } from '@/lib/use-view-state';
import { SurfaceViewport } from './surface-viewport';
import { constructScene, constructionKinds, suggestedConstruction, type ConstructionKind, type ConstructionSpec } from './construction';
import './construction.css';

type Fields = Record<'width'|'height'|'wall'|'clearance'|'pitch',string>;
const fields: { key:keyof Fields; label:string }[]=[{key:'width',label:'净宽'},{key:'height',label:'净高'},{key:'wall',label:'构件厚度'},{key:'clearance',label:'预留间隙'},{key:'pitch',label:'支撑间距'}];
const emptyFields:Fields={width:'',height:'',wall:'',clearance:'',pitch:''};

/** Lives inside the original scene workspace. Never changes the engineering document or export. */
export function ConstructionViewport(props: ComponentProps<typeof SurfaceViewport>) {
  const [active,setActive]=useViewState<ConstructionSpec|null>(`${props.viewKey}:${props.model.identity}:construction`,null);
  const [kind,setKind]=useState<ConstructionKind>('trench'),[draft,setDraft]=useState<Fields>(emptyFields),[error,setError]=useState('');
  const [selected,setSelected]=useState<string|null>(null),[expanded,setExpanded]=useState(false);
  useEffect(()=>{setSelected(null);},[props.selected,props.model.identity,active]);
  useEffect(()=>{setDraft(emptyFields);setError('');},[props.model.identity]);
  const result=useMemo(()=>{
    try{return {value:active?constructScene(props.model,active):null,error:''};}
    catch(problem){return {value:null,error:problem instanceof Error?problem.message:'构件生成失败'};}
  },[props.model,active]);
  const hidden=useMemo(()=>active&&result.value
    ? [...(props.hidden||[]),...props.model.objects.filter(o=>['soil','ground','backfill','enclosure'].includes(o.kind)).map(o=>o.id)]
    : props.hidden,[active,result.value,props.hidden,props.model]);
  function suggest(next:ConstructionKind) {
    setKind(next);setError('');
    try { const value=suggestedConstruction(props.model,next);setDraft(Object.fromEntries(fields.map(f=>[f.key,String(Number(value[f.key].toFixed(5)))])) as Fields); }
    catch(problem){setError(problem instanceof Error?problem.message:'无法生成建议尺寸');}
  }
  function apply() {
    try {
      if(fields.some(f=>!draft[f.key].trim()))throw new Error('请完整填写构件尺寸；留空不会被换成经验值。');
      const next={kind,...Object.fromEntries(fields.map(f=>[f.key,Number(draft[f.key])]))} as ConstructionSpec;
      constructScene(props.model,next);setActive(next);setSelected(null);setError('');
    }catch(problem){setActive(null);setSelected(null);setError(problem instanceof Error?problem.message:'构件参数无效');}
  }
  return <div className="construction-viewport">
    <details className="construction-controls" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
      <summary>场景构件设计{active?` · ${constructionKinds.find(k=>k.id===active.kind)?.label}预览中`: ' · 原工程场景'}</summary>
      <p>这里设计展示构件，不改变工程敷设与计算输入。建议尺寸需核对；切换场景类型不表示原方法适用范围扩大。</p>
      <div className="construction-fields"><label>构件类型<select aria-label="场景构件类型" value={kind} onChange={e=>suggest(e.target.value as ConstructionKind)}>{constructionKinds.map(k=><option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
        {fields.map(f=><label key={f.key}>{f.label} / m<input aria-label={`构件${f.label}`} type="number" step="any" min="0" value={draft[f.key]} onChange={e=>{const value=e.target.value;setDraft(previous=>({...previous,[f.key]:value}));}}/></label>)}
      </div>
      <div className="construction-actions"><button type="button" onClick={()=>suggest(kind)}>填入建议尺寸</button><button type="button" onClick={apply}>预览构件</button><button type="button" disabled={!active} onClick={()=>{setActive(null);setSelected(null);setError('');}}>恢复原工程场景</button></div>
      {active&&result.value&&<p className="construction-boundary" role="status">展示方案：原环境仅在本视口隐藏，电缆位置未变；导出与计算仍使用原工程。物理接入需要：{result.value.requirements.join('；')}。</p>}
      {(error||result.error)&&<p className="construction-error" role="alert">{error||result.error}</p>}
    </details>
    {result.error?<div className="construction-invalid">构件尺寸与当前模型不相容，未显示旧方案。请恢复原工程场景或重新填写。</div>:<SurfaceViewport {...props}
      model={result.value?.model||props.model} hidden={hidden} viewKey={`${props.viewKey}:${active?.kind||'engineering'}`}
      selected={selected&&result.value?.addedIds.includes(selected)?selected:props.selected}
      onSelect={id=>{if(id&&result.value?.addedIds.includes(id))setSelected(id);else{setSelected(null);props.onSelect(id);}}}
      caption={active?'展示构件方案 · 不参与当前物理计算 · 分解不改变尺寸':props.caption}/>}
  </div>;
}
