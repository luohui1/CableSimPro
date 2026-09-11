import type {Result} from '../types';

export type LossKey = 'conductor' | 'screen' | 'dielectric';
export interface LossSlice {key:LossKey;label:string;wPerM:number;sharePercent:number}
export interface ThermalResistanceSlice {label:string;kMW:number;sharePercent:number}
export interface AmpacityDiagnostics {
 stateMode:'operating'|'rating';stateLabel:string;overloaded:boolean;
 operatingAvailable:boolean;operatingError:string|null;operatingMaxTemperatureC:number|null;
 currentMarginA:number;temperatureMarginC:number|null;utilizationPercent:number;
 limitingPhase:string;displayPhase:string;phaseIndex:number;circuitLossKw:number;residualK:number;
 losses:LossSlice[];dominantLoss:LossSlice;lossTotalWm:number;
 conductorTemperatureC:number;surfaceTemperatureC:number;ambientTemperatureC:number;
 internalRiseC:number;externalRiseC:number;internalRiseShare:number;externalRiseShare:number;thermalDriver:string;
 radialResistances:ThermalResistanceSlice[];radialResistanceTotal:number;soilSelfKMW:number;soilMutualKMW:number;
 r20Basis:string;inputHashShort:string;
}

/** Read-only projection of a solved snapshot. Never substitute a rating temperature
 * for an unavailable operating temperature, or imply a missing margin is zero. */
export function buildAmpacityDiagnostics(result:Result):AmpacityDiagnostics {
 const state=result.operating??result.rating;
 const operatingAvailable=result.operating!==null;
 const stateMode=operatingAvailable?'operating':'rating';
 // The hottest phase in the displayed state need not be the rating's limiting phase.
 const phaseIndex=state.temperatures_c.reduce((best,value,index,values)=>value>values[best]?index:best,0);
 const conductor=state.conductor_losses_w_m.reduce((sum,value)=>sum+value,0);
 const screen=state.screen_losses_w_m.reduce((sum,value)=>sum+value,0);
 const dielectric=state.dielectric_loss_w_m*state.temperatures_c.length;
 const total=state.total_losses_w_m.reduce((sum,value)=>sum+value,0);
 const raw=[{key:'conductor' as const,label:'导体 I²R',wPerM:conductor},{key:'screen' as const,label:'金属屏蔽',wPerM:screen},{key:'dielectric' as const,label:'介质损耗',wPerM:dielectric}];
 const losses=raw.map(item=>({...item,sharePercent:total>0?item.wPerM/total*100:0}));
 const dominantLoss=losses.reduce((best,item)=>item.wPerM>best.wPerM?item:best,losses[0]);
 const ambient=result.input.installation.ambient_temperature_c;
 const conductorTemperature=state.temperatures_c[phaseIndex];
 const surfaceTemperature=state.surface_temperatures_c[phaseIndex];
 const internalRise=Math.max(0,conductorTemperature-surfaceTemperature);
 const externalRise=Math.max(0,surfaceTemperature-ambient);
 const totalRise=internalRise+externalRise;
 const currentMargin=result.summary.ampacity_a-result.input.operating_current_a;
 const temperatureMargin=operatingAvailable?result.input.cable.max_temperature_c-conductorTemperature:null;
 const overloaded=currentMargin<0||result.summary.utilization_percent>100||(temperatureMargin!==null&&temperatureMargin<0);
 const radialLabels=['导体屏蔽','XLPE 绝缘','绝缘屏蔽','金属屏蔽','外护套'];
 const radialTotal=result.thermal.layer_resistances_k_m_w.reduce((sum,value)=>sum+value,0);
 const radialResistances=result.thermal.layer_resistances_k_m_w.map((value,index)=>({label:radialLabels[index]??`径向层 ${index+1}`,kMW:value,sharePercent:radialTotal>0?value/radialTotal*100:0}));
 const soilRow=result.thermal.soil_matrix_k_m_w[phaseIndex]??[];
 return {
  stateMode,stateLabel:operatingAvailable?'运行工况':'允许载流量点',overloaded,
  operatingAvailable,operatingError:result.operating_error,
  operatingMaxTemperatureC:operatingAvailable?conductorTemperature:null,
  currentMarginA:currentMargin,temperatureMarginC:temperatureMargin,utilizationPercent:result.summary.utilization_percent,
  limitingPhase:result.summary.limiting_phase,displayPhase:['A','B','C'][phaseIndex]??String(phaseIndex+1),phaseIndex,
  circuitLossKw:state.circuit_loss_kw,residualK:state.residual_k,lossTotalWm:total,losses,dominantLoss,
  conductorTemperatureC:conductorTemperature,surfaceTemperatureC:surfaceTemperature,ambientTemperatureC:ambient,
  internalRiseC:internalRise,externalRiseC:externalRise,
  internalRiseShare:totalRise>0?internalRise/totalRise*100:0,externalRiseShare:totalRise>0?externalRise/totalRise*100:0,
  thermalDriver:totalRise===0?'无温升':externalRise>=internalRise?'外部土壤温升':'缆体径向温升',
  radialResistances,radialResistanceTotal:radialTotal,
  soilSelfKMW:soilRow[phaseIndex]??0,soilMutualKMW:soilRow.reduce((sum,value,index)=>sum+(index===phaseIndex?0:value),0),
  r20Basis:result.input.cable.r20_ohm_km===null?'R20 按理想电阻率/截面积估算':'R20 来自工程输入',
  inputHashShort:result.input_sha256.slice(0,12),
 };
}
