import type {Result} from '../types';

export type LossKey='conductor'|'screen'|'dielectric';
export interface LossSlice {key:LossKey;label:string;wPerM:number;sharePercent:number}
export interface AmpacityDiagnostics {
 stateMode:'operating'|'rating';stateLabel:string;overloaded:boolean;
 currentMarginA:number;temperatureMarginC:number|null;utilizationPercent:number;
 limitingPhase:string;phaseIndex:number;circuitLossKw:number;
 losses:LossSlice[];dominantLoss:LossSlice;
 conductorTemperatureC:number;surfaceTemperatureC:number;ambientTemperatureC:number;
 internalRiseC:number;externalRiseC:number;internalRiseShare:number;externalRiseShare:number;thermalDriver:string;
 r20Basis:string;inputHashShort:string;
}

export function buildAmpacityDiagnostics(result:Result):AmpacityDiagnostics{
 const state=result.operating??result.rating;
 const stateMode=result.operating?'operating':'rating';
 const phaseIndex=Math.max(0,['A','B','C'].indexOf(result.summary.limiting_phase));
 const conductor=state.conductor_losses_w_m.reduce((sum,value)=>sum+value,0);
 const screen=state.screen_losses_w_m.reduce((sum,value)=>sum+value,0);
 const dielectric=state.dielectric_loss_w_m*3;
 const total=state.total_losses_w_m.reduce((sum,value)=>sum+value,0);
 const raw=[{key:'conductor' as const,label:'导体 I²R',wPerM:conductor},{key:'screen' as const,label:'金属屏蔽',wPerM:screen},{key:'dielectric' as const,label:'介质损耗',wPerM:dielectric}];
 const losses=raw.map(item=>({...item,sharePercent:total>0?item.wPerM/total*100:0}));
 const dominantLoss=losses.reduce((best,item)=>item.wPerM>best.wPerM?item:best,losses[0]);
 const ambient=result.input.installation.ambient_temperature_c;
 const conductorTemperature=state.temperatures_c[phaseIndex]??ambient;
 const surfaceTemperature=state.surface_temperatures_c[phaseIndex]??ambient;
 const internalRise=Math.max(0,conductorTemperature-surfaceTemperature);
 const externalRise=Math.max(0,surfaceTemperature-ambient);
 const totalRise=internalRise+externalRise;
 const currentMargin=result.summary.ampacity_a-result.input.operating_current_a;
 const temperatureMargin=result.summary.thermal_margin_c;
 const overloaded=currentMargin<0||result.summary.utilization_percent>100||(temperatureMargin!==null&&temperatureMargin<0);
 return {
  stateMode,stateLabel:stateMode==='operating'?'运行工况':'允许载流量点',overloaded,
  currentMarginA:currentMargin,temperatureMarginC:temperatureMargin,utilizationPercent:result.summary.utilization_percent,
  limitingPhase:result.summary.limiting_phase,phaseIndex,circuitLossKw:state.circuit_loss_kw,
  losses,dominantLoss,
  conductorTemperatureC:conductorTemperature,surfaceTemperatureC:surfaceTemperature,ambientTemperatureC:ambient,
  internalRiseC:internalRise,externalRiseC:externalRise,
  internalRiseShare:totalRise>0?internalRise/totalRise*100:0,externalRiseShare:totalRise>0?externalRise/totalRise*100:0,
  thermalDriver:externalRise>=internalRise?'外部土壤温升':'缆体径向温升',
  r20Basis:result.input.cable.r20_ohm_km===null?'R20 按理想电阻率/截面积估算':'R20 来自工程输入',
  inputHashShort:result.input_sha256.slice(0,12),
 };
}
