import { numeric, optionalRecord, text } from '@/api/client';
import { ConclusionStrip } from './conclusion-strip';
import { StudyDetailGroup } from './study-detail-group';
import { formatNumber } from '@/lib/format';
import './study-correction.css';

/** Frozen plugin artifact only; never infer a coefficient from live inputs. */
export function StudyCorrection({ artifact, historical, part }: { artifact: Record<string, unknown>; historical: boolean; part: 'all'|'conclusion'|'details' }) {
  const baseline=optionalRecord(artifact.baseline), coefficients=(Array.isArray(artifact.coefficients)?artifact.coefficients:[]).map(optionalRecord);
  const conclusion=<ConclusionStrip label="GB 50217 校正结论" conclusion={text(artifact.headline)+' · GB 50217—2018 附录 D'} historical={historical}
    metrics={[{label:'基准载流量',value:numeric(baseline.baseline_current_a),unit:'A',quantity:'ampacity'},
      {label:'总校正系数',value:numeric(artifact.total_factor),unit:'1',quantity:'correction_factor'},
      {label:'校正后允许电流',value:numeric(artifact.corrected_current_a),unit:'A',quantity:'ampacity'}]} />;
  if (part==='conclusion') return conclusion;
  return <div className="input-module">{part==='all' && conclusion}
    <StudyDetailGroup id="gb-coefficients" title="校正系数与标准出处" count={coefficients.length}>
      <div className="table-scroll"><table className="data-table study-correction-table" aria-label="GB 50217 校正系数"><thead><tr><th>校正项目</th><th className="numeric">系数</th><th>取值条件</th><th>标准出处</th></tr></thead>
        <tbody>{coefficients.map((row,i)=>{const record=optionalRecord(row.record);return <tr key={i}><th scope="row">{text(row.label)}</th><td className="numeric">{formatNumber(numeric(row.factor),4)}</td>
          <td>{text(row.condition_text)}</td><td title={text(record.citation)}>{text(record.table)} · 第 {String(record.printed_page)} 页</td></tr>;})}</tbody></table></div>
    </StudyDetailGroup>
    <StudyDetailGroup id="gb-baseline" title="基准条件与来源"><p>{text(baseline.baseline_source)} · 第 {String(baseline.baseline_page)} 页</p>
      <p>单根基准由工程师核对；不代表厂家已保证本次校正结果。实际条件与原件摘要保存在本次运行中，表外条件拒绝。</p></StudyDetailGroup>
    <StudyDetailGroup id="gb-scope" title="适用范围"><p>{text(artifact.scope)}</p></StudyDetailGroup>
  </div>;
}
