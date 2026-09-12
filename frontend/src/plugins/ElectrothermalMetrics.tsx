/** A model-specific current is not automatically a production cable rating. */
export default function ElectrothermalMetrics({summary:s}:{summary:Record<string,unknown>}){
 const num=(key:string,digits=3)=>typeof s[key]==='number'&&Number.isFinite(s[key])?(s[key] as number).toFixed(digits):'—';
 const vector=(key:string,index:number,digits=3)=>{const v=s[key];return Array.isArray(v)&&typeof v[index]==='number'?v[index].toFixed(digits):'—'};
 const rating=s.mode==='ampacity';
 const bracket=s.bracket as {lower_a:number;upper_a:number;upper_max_temperature_c:number}|null;
 const compare=s.domain_comparison as {domain_scale:number;ampacity_a:number;current_change_percent:number;primary_current_max_temperature_c:number;within_pairwise_tolerance:boolean;pairwise_tolerance_percent:number}|null;
 return <section className="electrothermal-metrics" aria-label="电热反馈与电流反求">
  <div className="electrothermal-value"><span>{rating?'本模型的温度限值电流':'当前工程运行电流'}</span><strong>{num(rating?'ampacity_a':'evaluated_current_a',2)} <small>A</small></strong><p>{rating?'按最热导体节点反求；未提升为宿主载流量结果。':'仅计算此运行点，不把它标为允许电流。'}</p></div>
  <dl><dt>导体温度限值</dt><dd>{num('temperature_limit_c',1)} °C</dd><dt>20 °C 电阻 / 温度系数</dt><dd>{num('r20_ohm_km',5)} Ω/km / {num('alpha20_per_k',5)} K⁻¹</dd><dt>反馈交叉检查</dt><dd>{num('feedback_iterations',0)} 次迭代 · 谱半径 {num('feedback_spectral_radius',4)}</dd></dl>
  {rating&&bracket&&<p className="electrothermal-bracket">数值区间：{bracket.lower_a.toFixed(4)}–{bracket.upper_a.toFixed(4)} A；上界导体峰值 {bracket.upper_max_temperature_c.toFixed(4)} °C。区间宽度不是工程精度。</p>}
  {compare?<section className="electrothermal-domain" aria-label="扩大土壤域比较"><h4>扩大土壤域后的允许电流</h4><b>S={String(s.domain_scale)}：{num('ampacity_a',2)} A → S={compare.domain_scale}：{compare.ampacity_a.toFixed(2)} A</b><p>电流变化 {compare.current_change_percent.toFixed(3)}%；在较大域中继续施加原电流，导体峰值为 {compare.primary_current_max_temperature_c.toFixed(3)} °C。</p><p>{compare.within_pairwise_tolerance?'两次计算的差异在设定阈值内':'两次计算的差异超过设定阈值'}（{compare.pairwise_tolerance_percent}%）；仍不证明无限土壤精度或网格无关。</p></section>:<p>未进行较大土壤域比较；当前数值只对应本次有限计算域。</p>}
  <details><summary>各相损耗、电阻与输入依据</summary><div className="electrothermal-table"><table><thead><tr><th>相</th><th>导体平均 / 峰值 °C</th><th>Rac Ω/km</th><th>导体 W/m</th><th>屏蔽 W/m</th><th>介质 W/m</th></tr></thead><tbody>{['A','B','C'].map((phase,i)=><tr key={phase}><th>{phase}</th><td>{vector('conductor_mean_temperatures_c',i)} / {vector('conductor_max_temperatures_c',i)}</td><td>{vector('conductor_ac_resistances_ohm_km',i,6)}</td><td>{vector('conductor_losses_w_m',i)}</td><td>{vector('screen_losses_w_m',i)}</td><td>{vector('dielectric_losses_w_m',i,6)}</td></tr>)}</tbody></table></div><p>交流附加系数 {num('ac_extra_factor')} · 屏蔽损耗系数 {num('screen_loss_factor')}。系数来自工程输入，并非电磁有限元或接地方式计算。</p><p>依据说明：{String(s.coefficient_basis??'未提供')}</p></details>
 </section>;
}
