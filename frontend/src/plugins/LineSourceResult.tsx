import type {PluginExecution} from './PluginResult';

type Phase={phase:'A'|'B'|'C';source_power_w_m:number;fem_peak_temperature_c:number;half_space_center_temperature_c:number;difference_fem_minus_half_space_k:number;relative_rise_difference_percent:number|null};
type Summary={schema_version:'cablesim.line-source-crosscheck/1';method:string;phases:Phase[];maximum_absolute_difference_k:number;rms_difference_k:number;conductor_to_jacket_surface_k_m_w:number;soil_resistance_matrix_k_m_w:number[][];domain_scale:number;resolution:number;finite_domain_half_width_m:number;finite_domain_bottom_depth_m:number;source_job_id:string;experimental_validation:false;engineering_acceptance:false};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export default function LineSourceResult({project,result}:{project:string;result:PluginExecution}){
 const s=result.result.summary as unknown as Summary;
 const valid=s?.schema_version==='cablesim.line-source-crosscheck/1'&&Array.isArray(s.phases)&&s.phases.length===3&&s.phases.every(p=>finite(p.fem_peak_temperature_c)&&finite(p.half_space_center_temperature_c)&&finite(p.difference_fem_minus_half_space_k));
 if(!valid)return <section className="plugin-result-panel" role="alert">解析对照摘要不完整，已停止展示。</section>;
 return <section className="plugin-result-panel line-source-result" aria-label="半空间线热源交叉核对结果"><header><h3>FEM 与半空间线热源对照</h3><span>来源任务 {s.source_job_id.slice(0,8)} · rev.{result.project_revision}</span></header>
  <p>解析参考使用恒温地表、半无限均匀土壤与线热源；FEM 使用有限侧面和底部恒温边界。差异不是自动合格判据。</p>
  <div className="line-source-metrics"><div><span>最大绝对差异</span><strong>{s.maximum_absolute_difference_k.toFixed(4)} <small>K</small></strong></div><div><span>三相 RMS 差异</span><strong>{s.rms_difference_k.toFixed(4)} <small>K</small></strong></div></div>
  <div className="electrothermal-table"><table><thead><tr><th>相</th><th>发热 W/m</th><th>FEM 导体峰值 °C</th><th>半空间导体中心 °C</th><th>FEM − 解析 K</th><th>相对解析温升 %</th></tr></thead><tbody>{s.phases.map(p=><tr key={p.phase}><th>{p.phase}</th><td>{p.source_power_w_m.toFixed(3)}</td><td>{p.fem_peak_temperature_c.toFixed(4)}</td><td>{p.half_space_center_temperature_c.toFixed(4)}</td><td>{p.difference_fem_minus_half_space_k.toFixed(4)}</td><td>{p.relative_rise_difference_percent==null?'—':p.relative_rise_difference_percent.toFixed(3)}</td></tr>)}</tbody></table></div>
  <dl className="line-source-details"><dt>电缆内部热阻</dt><dd>{s.conductor_to_jacket_surface_k_m_w.toFixed(6)} K·m/W</dd><dt>FEM 计算域</dt><dd>S={s.domain_scale} · 网格档 {s.resolution} · 半宽 {s.finite_domain_half_width_m.toFixed(2)} m · 深度 {s.finite_domain_bottom_depth_m.toFixed(2)} m</dd><dt>解析外部热阻矩阵</dt><dd><code>{s.soil_resistance_matrix_k_m_w.map(row=>row.map(v=>v.toFixed(6)).join('  ')).join('\n')}</code></dd></dl>
  <p>扩大 FEM 土壤域后，若有限边界截断是主要误差，差异通常应缩小；仍需独立网格、材料与试验证据。</p>
  <div className="plugin-result-files">{result.artifacts.map(a=><a key={a.path} href={`/api/plugins/workspaces/${project}/jobs/${result.job_id}/artifacts/${encodeURIComponent(a.path)}`} download>{a.path}</a>)}</div>
  <details><summary>方法、版本与原始数据</summary><p>{s.method}</p>{result.result.warnings?.map(w=><p key={w}>{w}</p>)}<pre>{JSON.stringify(result,null,2)}</pre></details>
 </section>;
}
