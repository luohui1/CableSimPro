import {Box, LockKeyhole, LockKeyholeOpen, TriangleAlert} from 'lucide-react';
import {useStudio, valueAt} from '../StudioState';
import {positions} from '../geometry';
import {DisclosureGroup} from '../design-system/DisclosureGroup';
/** Reference-layout adapter. Inputs use the existing shared drafts, edit/lock queue,
 * expected revisions and server schema; no second scenario or solver state. */
const fields:Record<string,{path:string;name:string;unit?:string;min?:number;max?:number;options?:[string|number,string][];nullable?:boolean}[]>={
 installation:[{path:'installation.arrangement',name:'排列方式',options:[['flat','水平排列'],['trefoil','等边三角']]},{path:'installation.depth_m',name:'平均中心埋深',unit:'m',min:.2,max:3},{path:'installation.spacing_m',name:'相邻中心间距',unit:'m',min:.02,max:2},{path:'installation.ambient_temperature_c',name:'环境温度',unit:'°C',min:-20,max:60},{path:'installation.soil_rho_k_m_w',name:'土壤热阻率',unit:'K·m/W',min:.3,max:5}],
 cable:[{path:'cable.conductor',name:'导体材料',options:[['copper','铜 Cu'],['aluminium','铝 Al']]},{path:'cable.area_mm2',name:'导体截面积',unit:'mm²',min:50,max:1000},{path:'cable.u0_kv',name:'相对地电压 U₀',unit:'kV',min:1,max:26},{path:'cable.insulation_mm',name:'绝缘厚度',unit:'mm',min:2,max:15},{path:'cable.jacket_mm',name:'外护套厚度',unit:'mm',min:1,max:8},{path:'cable.r20_ohm_km',name:'厂家 R20',unit:'Ω/km',min:.000001,max:10,nullable:true},{path:'cable.fill_factor',name:'导体填充系数',min:.7,max:1}],
 materials:[{path:'cable.conductor_screen_mm',name:'导体屏蔽厚度',unit:'mm',min:.1,max:2},{path:'cable.insulation_screen_mm',name:'绝缘屏蔽厚度',unit:'mm',min:.1,max:2},{path:'cable.metallic_screen_mm',name:'等效金属屏蔽厚度',unit:'mm',min:.05,max:3},{path:'cable.insulation_rho_k_m_w',name:'绝缘热阻率',unit:'K·m/W',min:.1,max:10},{path:'cable.jacket_rho_k_m_w',name:'护套热阻率',unit:'K·m/W',min:.1,max:10},{path:'cable.semicon_rho_k_m_w',name:'半导电层热阻率',unit:'K·m/W',min:.1,max:10},{path:'cable.ac_extra_factor',name:'交流附加系数',min:0,max:1},{path:'cable.screen_loss_factor',name:'屏蔽损耗系数',min:0,max:2},{path:'cable.relative_permittivity',name:'相对介电常数',min:1,max:10},{path:'cable.tan_delta',name:'介质损耗角正切',min:0,max:.02},{path:'cable.frequency_hz',name:'频率',unit:'Hz',options:[[50,'50'],[60,'60']]}],
 study:[{path:'operating_current_a',name:'运行电流',unit:'A',min:0,max:3000},{path:'cable.max_temperature_c',name:'导体温度上限',unit:'°C',min:50,max:110},{path:'circuit_length_m',name:'线路长度',unit:'m',min:1,max:100000}]
};
function Property({field}:{field:typeof fields[string][number]}){
 const {w,busy,edit,lock,inputDrafts,setInputDraft}=useStudio();
 const value=valueAt(w!.scenario,field.path),locked=w!.locks.includes(field.path);
 const text=inputDrafts[field.path]??(value===null?'':String(value));
 const invalid=!field.options&&((text===''&&!field.nullable)||(text!==''&&(!Number.isFinite(Number(text))||(field.min!==undefined&&Number(text)<field.min)||(field.max!==undefined&&Number(text)>field.max))));
 function commit(){if(invalid)return;const n=text===''?null:Number(text);if(n!==value)void edit([{path:field.path,value:n}],field.name);else setInputDraft(field.path,null)}
 return <div className={`property ${invalid?'invalid':''}`}><div className="property-title"><label htmlFor={'f-'+field.path}>{field.name}</label><button title={locked?'解锁参数':'锁定参数'} aria-label={`${locked?'解锁':'锁定'}${field.name}`} disabled={busy} onClick={()=>void lock(field.path,!locked)}>{locked?<LockKeyhole size={12}/>:<LockKeyholeOpen size={12}/>}</button></div><div className="property-value">{field.options?<select id={'f-'+field.path} aria-label={field.name} value={String(value)} disabled={busy||locked} onChange={e=>void edit([{path:field.path,value:field.path==='cable.frequency_hz'?Number(e.target.value):e.target.value}],field.name)}>{field.options.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>:<input id={'f-'+field.path} aria-label={field.name} aria-invalid={invalid} type="number" required={!field.nullable} value={text} placeholder={field.nullable?'按材料估算':''} step="any" min={field.min} max={field.max} disabled={busy||locked} onChange={e=>setInputDraft(field.path,e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')setInputDraft(field.path,null)}}/>}<span>{field.unit}</span></div>{invalid&&<small role="alert">请输入 {field.min}～{field.max} 范围内的数值</small>}</div>;
}
export default function ReferenceInspector() {
 const grouped=true,allGroups=false;
 const {w,selected,phase,inputDrafts}=useStudio();
 if(!w)return null;
 const group=fields[selected]??fields.installation;
 const p=positions(w.scenario.installation)[phase];
 const groups=group.reduce<Record<string,typeof group>>((groups,field)=>{
  const title=selected==='installation'?(field.path.includes('temperature')||field.path.includes('rho')?'环境参数':'敷设参数'):
   selected==='materials'?(field.path.includes('rho')?'热物性参数':'电气与屏蔽'):
   selected==='study'?'运行与限制':field.path.includes('insulation')||field.path.includes('jacket')?'绝缘与护套':'导体与电压';
  (groups[title]??=[]).push(field);return groups;
 },{});
 return <div className="inspector">
  <div className="inspector-title"><Box size={17}/><div><b>{selected==='installation'?`CKT-01 / ${'ABC'[phase]} 相`:selected==='study'?'稳态载流研究':selected==='materials'?'材料定义':'单芯电缆定义'}</b><small>{selected==='installation'?`x ${p[0].toFixed(3)} m  /  h ${p[1].toFixed(3)} m`:'编辑后校验并自动保存'}</small></div></div>
  {grouped?Object.entries(groups).map(([title,items])=><DisclosureGroup
   key={`${w.id}:${allGroups?"all":selected}:${title}`} title={title} count={items.length}
   draftCount={items.filter(field=>Object.hasOwn(inputDrafts,field.path)).length}
   lockedCount={items.filter(field=>w.locks.includes(field.path)).length}>
   {items.map(field=><Property key={field.path} field={field}/>)}
  </DisclosureGroup>):group.map(field=><Property key={field.path} field={field}/>)}
  <div className="inspector-note"><TriangleAlert size={13}/><span>{selected==='cable'?'厂家 R20 一旦指定，不随截面积自动更新。':'锁定参数同时约束人工编辑、Agent 与参数扫描。'}</span></div>
 </div>;
}
