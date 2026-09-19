import type {Change} from '../StudioState';
export type ObjectKey='cable'|'conductor'|'conductor_screen'|'insulation'|'insulation_screen'|'metallic_screen'|'jacket'|'installation'|'study';
export interface FieldSpec {path:string;label:string;unit?:string;min?:number;max?:number;exclusiveMin?:boolean;nullable?:boolean;options?:readonly (readonly [string,string])[]}
const f=(path:string,label:string,unit:string,min:number,max:number):FieldSpec=>({path,label,unit,min,max});
export const objects:Record<ObjectKey,{name:string;caption:string;fields:FieldSpec[]}>= {
 cable:{name:'C-001 · 电缆',caption:'单芯 · XLPE · 无铠装',fields:[f('cable.u0_kv','导体对屏蔽电压','kV',1,26),f('cable.max_temperature_c','导体温度限值','°C',50,110)]},
 conductor:{name:'导体',caption:'等效均匀导体；填充系数参与几何',fields:[{path:'cable.conductor',label:'导体材料',options:[['copper','铜'],['aluminium','铝']]},f('cable.area_mm2','导体截面积','mm²',50,1000),f('cable.fill_factor','填充系数','',.7,1),{...f('cable.r20_ohm_km','20°C 导体电阻','Ω/km',0,10),exclusiveMin:true,nullable:true}]},
 conductor_screen:{name:'导体屏蔽',caption:'半导电层',fields:[f('cable.conductor_screen_mm','导体屏蔽厚度','mm',.1,2),f('cable.semicon_rho_k_m_w','半导电层热阻率','K·m/W',.1,10)]},
 insulation:{name:'XLPE 绝缘',caption:'绝缘层尺寸与工程物性输入',fields:[f('cable.insulation_mm','绝缘厚度','mm',2,15),f('cable.insulation_rho_k_m_w','绝缘热阻率','K·m/W',.1,10),f('cable.relative_permittivity','相对介电常数','',1,10),f('cable.tan_delta','介质损耗角正切','',0,.02)]},
 insulation_screen:{name:'绝缘屏蔽',caption:'与导体屏蔽共用半导电层热阻率',fields:[f('cable.insulation_screen_mm','绝缘屏蔽厚度','mm',.1,2),f('cable.semicon_rho_k_m_w','半导电层热阻率','K·m/W',.1,10)]},
 metallic_screen:{name:'金属屏蔽',caption:'等效连续层；损耗系数需要依据',fields:[f('cable.metallic_screen_mm','金属屏蔽厚度','mm',.05,3),f('cable.screen_loss_factor','屏蔽损耗系数','',0,2)]},
 jacket:{name:'外护套',caption:'保护层尺寸与工程物性输入',fields:[f('cable.jacket_mm','护套厚度','mm',1,8),f('cable.jacket_rho_k_m_w','护套热阻率','K·m/W',.1,10)]},
 installation:{name:'敷设方案 A',caption:'三根相同单芯电缆 · 单回路直埋',fields:[{path:'installation.arrangement',label:'排列方式',options:[['flat','平行排列'],['trefoil','三角形排列']]},f('installation.depth_m','平均中心埋深','m',.2,3),f('installation.spacing_m','相邻中心间距','m',.02,2),f('installation.ambient_temperature_c','环境温度','°C',-20,60),f('installation.soil_rho_k_m_w','土壤热阻率','K·m/W',.3,5)]},
 study:{name:'R-001 · 稳态研究',caption:'现有热网络；不是完整 IEC 60287 实现',fields:[f('operating_current_a','运行电流','A',0,3000),f('circuit_length_m','线路长度','m',1,100000),f('cable.ac_extra_factor','交流附加系数','',0,1),{path:'cable.frequency_hz',label:'频率',unit:'Hz',options:[['50','50'],['60','60']]}]},
};
export const layerKeys:ObjectKey[]=['conductor','conductor_screen','insulation','insulation_screen','metallic_screen','jacket'];
export const specs=Object.fromEntries(Object.values(objects).flatMap(o=>o.fields.map(f=>[f.path,f])));
/** UI parsing only. The server still validates the complete Scenario and locks atomically. */
export function parseDraft(path:string,text:string):{change:Change|null;error:string|null}{
 const spec=specs[path];if(!spec)return {change:null,error:'此字段不属于当前编辑契约'};
 if(text.trim()===''&&spec.nullable)return {change:{path,value:null},error:null};
 if(spec.options){if(!spec.options.some(o=>o[0]===text))return {change:null,error:'请选择有效选项'};return {change:{path,value:path==='cable.frequency_hz'?Number(text):text},error:null}}
 const value=Number(text);
 if(text.trim()===''||!Number.isFinite(value))return {change:null,error:'请输入有限数值'};
 if(spec.min!==undefined&&(spec.exclusiveMin?value<=spec.min:value<spec.min)||spec.max!==undefined&&value>spec.max)return {change:null,error:`范围 ${spec.exclusiveMin?'> ':''}${spec.min}–${spec.max} ${spec.unit??''}`};
 return {change:{path,value},error:null};
}
