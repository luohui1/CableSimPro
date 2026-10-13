import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, message, numeric, optionalRecord, text } from '@/api/client';
import { basisPin, basisQuery, type BasisRecord } from '@/features/standards/client';
import { localized } from '@/features/standards/format';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { DataTable } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import { downloadJson } from '@/lib/download';
import { hpcJson } from './run-label';
import './field.css';

export type CapacityRegion = { id: string; label: string; category?: string };
const materialLabel=(region:CapacityRegion)=>{
  const translated=localized(region.label);
  return translated!==region.label||!/[A-Za-z]{3}/.test(translated)?translated:
    ({conductor:'导体',semiconductor:'半导电层',insulation:'绝缘层',metal:'金属层',polymer:'聚合物层',filler:'填充料',soil:'土壤',backfill:'回填料',duct:'管壁',fluid:'流体'} as Record<string,string>)[region.category||'']||'材料';
};
const soilFields = [
  ['dry_bulk_density_kg_m3','土壤干容重','kg/m³'],
  ['particle_density_kg_m3','颗粒密度','kg/m³'],
  ['solid_specific_heat_capacity_j_kg_k','固相质量比热','J/(kg·K)'],
  ['water_volumetric_heat_capacity_j_m3_k','水相体积热容','J/(m³·K)'],
  ['air_volumetric_heat_capacity_j_m3_k','气相体积热容','J/(m³·K)'],
  ['water_volume_fraction','体积含水率','m³/m³'],
] as const;


/** Preparation uses sealed basis queries; no soil formula or solver runs here. */
export function HeatCapacityForm({ regions, onChange, savedSource }: { regions: CapacityRegion[]; onChange?: (value: Record<string, unknown>) => void;
  savedSource?: {workspace:string;study:string;run:string} }) {
  const host=useRef<HTMLElement>(null);
  const [editing,setEditing]=useState(false);
  const [focusRegion,setFocusRegion]=useState('');
  const [regionId,setRegionId]=useState(''),[recordId,setRecordId]=useState('');
  const [inputs,setInputs]=useState<Record<string,string>>({}),[phase,setPhase]=useState(false),[siteSource,setSiteSource]=useState('');
  const [values,setValues]=useState<Record<string,Record<string,unknown>>>({}),[evidence,setEvidence]=useState<Record<string,unknown>>({});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[check,setCheck]=useState<Record<string,unknown>>();
  const admission=useQuery({queryKey:['step-response-source',savedSource?.workspace,savedSource?.study,savedSource?.run],enabled:!!savedSource?.run,retry:false,
    queryFn:({signal})=>hpcJson(`/workspaces/${savedSource!.workspace}/studies/${savedSource!.study}/step-responses/source-check?source_run_id=${encodeURIComponent(savedSource!.run)}`,{signal})});
  const pin=useQuery({queryKey:['standards-basis-pin'],enabled:editing,queryFn:({signal})=>basisPin(signal),retry:false,staleTime:60_000});
  const sources=useQuery({queryKey:['heat-capacity-basis',pin.data?.release_digest],enabled:editing&&!!pin.data,retry:false,staleTime:60_000,
    queryFn:async({signal})=>{
      const catalog=await basisQuery(pin.data!,{schema_version:'cablesim.standards-query/1',operation:'catalog'},signal);
      const tables=(catalog.tables||[]).filter(table=>table.quantities.some(q=>q.key.includes('heat_capacity')||q.key.includes('capacity_expression')||q.name.includes('热容')));
      const answers=await Promise.all(tables.map(table=>basisQuery(pin.data!,{schema_version:'cablesim.standards-query/1',operation:'list',standard:table.standard,edition:table.edition,locator:table.table||table.clause},signal)));
      return [...new Map(answers.flatMap(answer=>answer.records).filter(r=>r.quantity.key.includes('volumetric_heat_capacity')||r.quantity.key.includes('capacity_expression')).map(r=>[r.id,r])).values()];
    }});
  const region=regions.find(r=>r.id===regionId)||regions[0];
  const restricted=region?.category==='semiconductor'||region?.category==='backfill';
  const available=(sources.data||[]).filter(r=>!restricted && (region?.category!=='soil'||r.quantity.key.includes('capacity_expression')));
  const record=available.find(r=>r.id===recordId);
  const formula=!!record && typeof record.value==='string';
  const threePhase=optionalRecord(record?.conditions.soil_capacity_method).eq==='three_phase' || record?.conditions.soil_capacity_method==='three_phase';
  const fields=soilFields.filter(([key])=>threePhase||key!=='air_volumetric_heat_capacity_j_m3_k');
  const rows=useMemo(()=>regions.map(r=>({...r,label:materialLabel(r),capacity:values[r.id]})),[regions,values]);
  const changed=()=>{setCheck(undefined);setError('');};
  useEffect(()=>{
    if(focusRegion&&editing&&sources.data){host.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();setFocusRegion('');}
  },[focusRegion,editing,sources.data]);
  async function adopt() {
    if(!pin.data||!record||!region)return;
    setBusy(true);setError('');
    try {
      const request:Record<string,unknown>={schema_version:'cablesim.standards-query/1',operation:formula?'evaluate':'resolve',standard:record.standard,edition:record.edition,locator:record.table||record.clause,quantity:record.quantity.key,record_id:record.id,
        conditions:Object.fromEntries(Object.entries(record.conditions).map(([key,value])=>[key,optionalRecord(value).eq??value]))};
      if(formula) {
        if(!siteSource.trim()){document.getElementById('capacity-site-source')?.focus();throw Error('请填写现场参数来源；教学参数须明确标注“教学参数”。');}
        const parsed:Record<string,unknown>={phase_assumption:phase?'single_temperature_no_phase_change':''};
        for(const [key,label] of fields) {
          if(!inputs[key]?.trim()||!Number.isFinite(Number(inputs[key]))) {
            document.getElementById(`capacity-${key}`)?.focus();throw Error(`请填写${label}，核对框内单位。`);
          }
          parsed[key]=Number(inputs[key]);
        }
        request.formula_inputs=parsed;
      }
      const answer=await basisQuery(pin.data,request);
      const resolved=answer.records[0] as BasisRecord|undefined;
      const calculation=optionalRecord((answer as unknown as Record<string,unknown>).calculation);
      const value=numeric(formula?optionalRecord(calculation.output).value:resolved?.value);
      if(!resolved||value===null||value<=0)throw Error('该材料没有可采用的有出处热容值；半导电层、回填料缺依据时保持缺项。');
      const capacity={value_j_m3_k:value,material:localized(resolved.row_label)||region.label,
        reference:`${resolved.citation} · 热容页码字段使用 PDF 页码`,source_sha256:resolved.source_sha256,page:resolved.pdf_page,
        table:resolved.table||`条款 ${resolved.clause}`,limitations:[...resolved.limitations,
          ...(formula?[`现场参数来源：${siteSource}；公式输入摘要：${text(calculation.input_sha256)}；输入：${JSON.stringify(calculation.inputs)}`]:[])].join('；')};
      const next={...values,[region.id]:capacity};setValues(next);onChange?.(next);
      setEvidence({...evidence,[region.id]:{pin:pin.data,data_sha256:answer.data_sha256,record:resolved,...(formula?{calculation,site_source:siteSource}:{})}});setCheck(undefined);
    }catch(failure){
      if(failure instanceof ApiError){const path=text(optionalRecord(failure.detail).path).split('/').at(-1);document.getElementById(`capacity-${path}`)?.focus();}
      setError(message(failure));
    }finally{setBusy(false);}
  }
  async function preflight() {
    setBusy(true);setError('');
    try{setCheck(await hpcJson('/heat-capacity/preflight',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({regions:regions.map(r=>r.id),capacities:values})}));}
    catch(failure){setError(message(failure));}finally{setBusy(false);}
  }
  return <section ref={host} className="input-section heat-capacity-form" aria-label="暂态材料热容准备" onKeyDown={event=>{if(event.key==='Enter'&&event.target instanceof HTMLInputElement&&event.target.type!=='checkbox'){event.preventDefault();void adopt();}}}>
    <h3>材料热容与现场土壤</h3>
    {admission.data?.status==='unsupported'&&<p role="status">暂态尚不能提交 · {text(admission.data.reason)}{text(admission.data.next_step)}</p>}
    {admission.error&&<ErrorState description={message(admission.error)} action={<Button variant="ghost" onClick={()=>void admission.refetch()}>重读保存来源</Button>}/>}
    <p className="field-state-note">逐材料选择依据；半导电层、回填料缺依据时保持缺项。热容检查通过后仍需保存有限元稳态来源。</p>
    {!editing&&<Button onClick={()=>setEditing(true)}>选择热容依据</Button>}
    {editing&&(pin.error||sources.error?<ErrorState description={message(pin.error??sources.error)} action={<Button onClick={()=>{if(pin.error)void pin.refetch();else void sources.refetch();}}>重读依据</Button>}/>:pin.isPending||(!!pin.data&&sources.isPending)?<LoadingState title="读取热容依据"/>:<>
      <Select label="材料域" value={region?.id} onChange={value=>{setRegionId(value);setRecordId('');changed();}} options={regions.map(r=>({value:r.id,label:materialLabel(r)}))}/>
      {restricted?<p role="status">{materialLabel(region)}缺少与本工程材料配方对应的热容依据；保持缺项，不采用其他材料或地热回填模型的数值。</p>:<Select label="热容正文依据" value={recordId} onChange={value=>{setRecordId(value);setInputs({});changed();}} options={available.map(r=>({value:r.id,label:`${localized(r.row_label)} · ${r.citation}`,disabled:r.value===null}))}/>}
      {record&&<p className="field-state-note">{record.limitations.join('；')}</p>}
      {formula&&<fieldset className="capacity-site-inputs"><legend>现场土壤参数 · 不采用默认值</legend>
        {fields.map(([key,label,unit])=><label key={key} htmlFor={`capacity-${key}`}>{label}<InputGroup><InputGroupInput id={`capacity-${key}`} type="number" step="any" value={inputs[key]||''} onChange={e=>{setInputs({...inputs,[key]:e.target.value});changed();}}/><InputGroupAddon align="inline-end">{unit}</InputGroupAddon></InputGroup></label>)}
        <label htmlFor="capacity-site-source">现场参数来源<InputGroup><InputGroupInput id="capacity-site-source" value={siteSource} onChange={e=>{setSiteSource(e.target.value);changed();}}/></InputGroup></label>
        <label htmlFor="capacity-phase_assumption"><input id="capacity-phase_assumption" type="checkbox" checked={phase} onChange={e=>{setPhase(e.target.checked);changed();}}/>各相同温，无冻结或相变</label>
      </fieldset>}
      <Button disabled={busy||!record||!region} onClick={()=>void adopt()}>采用到所选材料</Button>
    </>)}
    {error&&<ErrorState description={error}/>}
    <DataTable label="暂态材料热容缺项" columns={[
      {id:'material',label:'材料',render:r=>r.label},
      {id:'capacity',label:'体积热容 J/(m³·K)',numeric:true,render:r=>numeric(r.capacity?.value_j_m3_k)?.toLocaleString('zh-CN')||'缺项'},
      {id:'source',label:'正文来源',render:r=>text(r.capacity?.reference)||'选择有依据的材料值；不套用其他材料'},
    ]} groups={[{id:'capacities',label:'所需材料',rows}]} rowLabel={r=>r.label} showGroups={false}/>
    <div className="hpc-actions"><Button disabled={busy||!regions.length} onClick={()=>void preflight()}>检查热容与来源</Button>
      <Button variant="ghost" disabled={!Object.keys(values).length} onClick={()=>downloadJson({schema:'cablesim.heat-capacity-preparation/1',capacities:values,evidence,missing:regions.filter(r=>!values[r.id]),input_ready:check?.input_ready===true,scope:'material_sources_only'},'heat-capacity-input.json')}>导出热容准备文件</Button></div>
    {check&&<p role="status">{text(check.message)}</p>}
    {Array.isArray(check?.issues)&&check.issues.map((raw,index)=>{const issue=optionalRecord(raw),missing=regions.find(r=>r.id===issue.region);return <div key={index}><Button variant="ghost" size="compact" onClick={()=>{setEditing(true);setRegionId(text(issue.region));setRecordId('');setFocusRegion(text(issue.region));}}>补齐{missing?materialLabel(missing):'材料'}</Button><p>{text(issue.message)}</p></div>;})}
  </section>;
}
