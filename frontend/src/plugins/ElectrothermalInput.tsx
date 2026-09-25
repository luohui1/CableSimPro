import {useEffect,useState} from 'react';
export interface ElectricalArguments {
 mode:'operating-point'|'ampacity';alpha20_per_k:number;conductor_k_w_m_k:number;metal_screen_k_w_m_k:number;
 coefficient_basis:string;acknowledged_coefficient_model:true;domain_scale:number;resolution:16;compare_domain_scale:number|null;
}
export interface SavedElectricalInput {revision:number;scenario:{operating_current_a:number;cable:{r20_ohm_km:number|null;max_temperature_c:number;ac_extra_factor:number;screen_loss_factor:number;tan_delta:number;u0_kv:number;frequency_hz:number}}}
export default function ElectrothermalInput({snapshot,busy,onChange}:{snapshot:SavedElectricalInput|null;busy:boolean;onChange:(args:ElectricalArguments|null)=>void}){
 const [mode,setMode]=useState<'operating-point'|'ampacity'>('ampacity'),[alpha,setAlpha]=useState(''),[kc,setKc]=useState(''),[ks,setKs]=useState(''),[basis,setBasis]=useState(''),[ack,setAck]=useState(false),[scale,setScale]=useState('8'),[compare,setCompare]=useState('16');
 const r20=snapshot?.scenario.cable.r20_ohm_km;
 useEffect(()=>{setAck(false)},[snapshot?.revision]);
 useEffect(()=>{
  const numeric=[alpha,kc,ks].every(s=>s.trim()!==''&&Number.isFinite(Number(s)));
  const valid=numeric&&Number(alpha)>=0&&Number(alpha)<=.01&&Number(kc)>1&&Number(kc)<=500&&Number(ks)>1&&Number(ks)<=500&&basis.trim().length>=5&&ack&&typeof r20==='number'&&r20>0;
  onChange(valid?{mode,alpha20_per_k:Number(alpha),conductor_k_w_m_k:Number(kc),metal_screen_k_w_m_k:Number(ks),coefficient_basis:basis.trim(),acknowledged_coefficient_model:true,domain_scale:Number(scale),resolution:16,compare_domain_scale:mode==='ampacity'&&compare!==''?Number(compare):null}:null);
 },[mode,alpha,kc,ks,basis,ack,scale,compare,r20,onChange]);
 function setDomain(v:string){setScale(v);if(compare!==''&&Number(compare)<=Number(v))setCompare('')}
 return <section aria-label="电热反馈研究输入">
  <p>从已保存工程读取 R20、交流附加系数、屏蔽损耗系数、电压和介质损耗参数。该研究不自动推算集肤、邻近或接地方式损耗。</p>
  {!snapshot?<p role="status">正在读取工程电气输入…</p>:<><p>R20：{r20??'未提供'} Ω/km · 交流附加系数：{snapshot.scenario.cable.ac_extra_factor} · 屏蔽损耗系数：{snapshot.scenario.cable.screen_loss_factor}</p><p>U0：{snapshot.scenario.cable.u0_kv} kV（导体对屏蔽 RMS） · {snapshot.scenario.cable.frequency_hz} Hz · tanδ：{snapshot.scenario.cable.tan_delta}</p></>}
  {snapshot&&r20==null&&<p className="plugin-error" role="status">缺少明确的 R20。请返回参数检查器保存20°C导体电阻，再执行；不会按截面积估算。</p>}
  <label>研究任务<select aria-label="电热研究任务" disabled={busy} value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="ampacity">反求温度限值电流</option><option value="operating-point">计算当前运行电流温度</option></select></label>
  <p>{mode==='ampacity'?`导体温度限值：${snapshot?.scenario.cable.max_temperature_c??'—'} °C；寻找低于限值与超过限值的电流区间。`:`读取工程运行电流：${snapshot?.scenario.operating_current_a??'—'} A，不另外复制一份电流输入。`}</p>
  <div className="plugin-form">{[['20°C电阻温度系数 K⁻¹',alpha,setAlpha],['电热研究导体热导率 W/(m·K)',kc,setKc],['电热研究屏蔽热导率 W/(m·K)',ks,setKs]].map(([label,value,setter])=><label key={label as string}>{label as string}<input disabled={busy} type="number" step="any" value={value as string} onChange={e=>(setter as (v:string)=>void)(e.target.value)} required/></label>)}</div>
  <label>电阻与损耗系数依据<textarea className="electrothermal-basis" aria-label="电阻与损耗系数依据" disabled={busy} maxLength={500} value={basis} onChange={e=>setBasis(e.target.value)} placeholder="注明数据或假设来源；演示值请明确说明"/></label>
  <label>主计算土壤域<select aria-label="电热主计算土壤域" disabled={busy} value={scale} onChange={e=>setDomain(e.target.value)}>{['4','8','16'].map(v=><option key={v} value={v}>S={v}</option>)}</select></label>
  {mode==='ampacity'&&<label>扩大计算域比较<select aria-label="电热扩大计算域比较" disabled={busy} value={compare} onChange={e=>setCompare(e.target.value)}><option value="">不比较</option>{['8','16'].filter(v=>Number(v)>Number(scale)).map(v=><option key={v} value={v}>比较 S={v} 下的允许电流</option>)}</select></label>}
  <label className="electrothermal-consent"><input type="checkbox" disabled={busy} checked={ack} onChange={e=>setAck(e.target.checked)}/>我已核对电阻和损耗系数，理解这是有限域参考模型，不是完整标准或电磁场计算</label>
 </section>;
}
