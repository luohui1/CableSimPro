import { optionalRecord, text } from '@/api/client';
import { pointer } from '@/lib/domain-fields';
import { displayText } from '@/lib/display-names';

type Row = Record<string, unknown> & { id: string; title: string };
/** 同量、同条件、同依据才合并，保存工件及分芯数值不变。 */
export function identicalCoreRows(rows: Row[], coreIds: string[]): (Row & {members:Row[]})[] {
  if(coreIds.length<2)return rows.map(row=>({...row,members:[row]}));
  const used=new Set<string>(), output:(Row&{members:Row[]})[]=[];
  for(const row of rows){
    if(used.has(row.id))continue;
    const target=optionalRecord(row.target), suffix=row.id.slice(row.id.indexOf(':')+1);
    const signature=(item:Row)=>{const {id,title,target,...rest}=item;void id;void title;return JSON.stringify([optionalRecord(target).role,rest]);};
    const same=target.scope==='core'?rows.filter(item=>item.id.endsWith(':'+suffix)&&coreIds.includes(text(optionalRecord(item.target).core_id))&&signature(item)===signature(row)):[];
    const complete=coreIds.every(id=>same.filter(item=>optionalRecord(item.target).core_id===id).length===1);
    const members=complete?same:[row];members.forEach(item=>used.add(item.id));
    output.push({...row,title:complete?`${coreIds.length} 芯相同 · ${row.title.replace(/^芯\s*\d+\s*·\s*/,'')}`:row.title,members});
  }
  return output;
}

const parameterFields:Record<string,[string,string]>={temperature_k:['temperature_k','工作温度'],f_hz:['frequency_hz','频率'],U_phase_V:['phase_voltage_v','运行相电压'],ks:['ks','集肤系数'],kp:['kp','邻近系数'],s_m:['spacing_m','相间中心距'],C_LL:['core_lay_factor','成缆绞入系数'],length_basis:['r20_length_basis','电阻长度基准'],theta_i_K:['initial_temperature_k','短路初温'],theta_f_K:['final_temperature_k','短路终温'],t_s:['duration_s','短路时间'],contact_factor:['contact_factor','接触因数']};
function outdatedBasis(row:Record<string,unknown>){return /依据不属于此方法已封签的依据发行|请重新核对版本/.test(text(row.reason));}
export function issuePresentation(row:Record<string,unknown>, module:string, cableId:string) {
  const status=text(row.verdict)||text(row.status), target=optionalRecord(row.target), role=text(target.role), core=text(target.core_id);
  const layer=role?(target.scope==='core'?core:'common')+'/'+role:'';
  const standard=[text(row.standard),text(row.clause)].filter(Boolean).join(' · ');
  const basisFields=Array.isArray(row.basis_missing_fields)?row.basis_missing_fields.map(item=>optionalRecord(item)):[];
  if(outdatedBasis(row))return {kind:'history',label:'依据版本需重核',reason:'保存的结构依据与当前核对方法版本不一致；重新查询依据，复核结构尺寸后重算',module:'requirements',tab:'list',layer:'',field:'',action:'重新核对依据'};
  if(basisFields.length)return {kind:'field',label:'缺字段',reason:basisFields.map(item=>text(item.label)).join('、')+'；补齐后按固定标准版本查询依据',module:'requirements',tab:'list',layer:'',field:text(basisFields[0].field),action:'填写'+text(basisFields[0].label)};
  if(Array.isArray(row.missing_input_fields)&&row.missing_input_fields.length)return {kind:'field',label:'缺字段',reason:displayText(text(row.reason)).replace(/^缺字段[：:]\s*/,''),module:'structure',tab:'table',layer,field:'',action:'核对金属组件与来源'};
  if(status==='uncovered'||status==='not_applicable')return {kind:'coverage',label:'标准未覆盖',reason:[standard,displayText(text(row.reason))||'本方法尚未覆盖此判据'].filter(Boolean).join('：'),module:'requirements',tab:'list',layer:'',field:'',action:'查看依据与范围'};
  const names:Record<string,string>={metal_initial_temperature_k:'金属组件初温',metal_final_temperature_k:'金属组件终温',inner_thermal_resistivity:'内侧介质热阻率',outer_thermal_resistivity:'外侧介质热阻率',inner_volumetric_heat_capacity:'内侧体积热容',outer_volumetric_heat_capacity:'外侧体积热容',arrangement:'排列方式'};
  const declared=Array.isArray(row.missing_parameters)?row.missing_parameters.filter((name):name is string=>typeof name==='string'):[];
  const missing=declared.length?declared.map(name=>[name,names[name]||Object.values(parameterFields).find(([key])=>key===name)?.[1]||'方法条件']):Object.entries(optionalRecord(row.formula_inputs)).filter(([,value])=>value===null||value===undefined).map(([key])=>parameterFields[key]).filter(Boolean);
  if(missing.length)return {kind:'field',label:'字段缺失',reason:'待补 '+missing.map(([,label])=>label).join('、')+'及各项来源',module,tab:'parameters',layer:'',field:'/'+missing[0][0],action:'填写'+missing[0][1]};
  const resistance=row.id&&text(row.id).endsWith(':r20');
  const field=resistance&&core?pointer('cable_types',cableId,'cores',core,'conductor','r20'):'';
  return {kind:'field',label:status==='failed'?'不满足':'字段缺失',reason:displayText(text(row.reason))||'此项未提供有效输入或来源',module:layer?'structure':module,tab:layer?'table':'parameters',layer,field,action:field?'填写导体电阻':layer?'定位结构层':'填写方法条件'};
}

export function reviewGroups(checks: Record<string,unknown>[]) {
  const groups=new Map<string,{id:string;title:string;items:Record<string,unknown>[]}>();
  for(const check of checks){
    if(check.blocking!==true)continue;
    const row=optionalRecord(check.result), status=text(row.verdict)||text(row.status), message=text(check.message);
    const inputMissing=outdatedBasis(row)||Array.isArray(row.basis_missing_fields)&&row.basis_missing_fields.length>0||row.source_status==='input-missing';
    const reason=!inputMissing&&(status==='uncovered'||status==='not_applicable'||/未覆盖/.test(message))?'标准依据未覆盖':text(check.channel)==='resources'?'需要人工批准':!inputMissing&&row.basis==='measurement'&&!/historical/.test(text(check.id))?'需要出厂实测值':'需要工程师补输入';
    const group=groups.get(reason)||{id:reason,title:reason,items:[]};group.items.push(check);groups.set(reason,group);
  }
  return ['需要工程师补输入','需要出厂实测值','标准依据未覆盖','需要人工批准'].flatMap(id=>groups.has(id)?[groups.get(id)!]:[]);
}
