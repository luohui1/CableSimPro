import { optionalRecord, numeric, text } from '@/api/client';
import { StudyDetailGroup } from './study-detail-group';
import { significantNumber } from '@/lib/format';
import { StatusMark } from './status-mark';
import { Fragment } from 'react';
import './study-material-basis.css';

/** Display only the fixed basis receipt beside the plugin's actual run value. */
export function StudyMaterialBasis({ caseRow }: { caseRow: Record<string, unknown> }) {
  const basis = optionalRecord(optionalRecord(caseRow.evidence).material_basis);
  const rows = (Array.isArray(basis.rows) ? basis.rows : []).map(optionalRecord);
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const parts = text(row.label).split(' · '), name = parts.pop() || '材料常数';
    const object = parts.join(' · ') || '工程材料';
    groups.set(object, [...(groups.get(object) || []), {...row, name}]);
  }
  return <StudyDetailGroup id="material-basis" title="材料常数与标准出处" count={rows.length}>
    {rows.length ? <div className="table-scroll"><table className="data-table study-material-basis" aria-label="材料常数与标准出处">
      <thead><tr><th>材料常数</th><th className="numeric">采用值</th><th>标准出处与核对</th></tr></thead>
      <tbody>{[...groups].map(([object, values]) => <Fragment key={object}>
        <tr className="material-basis-object"><th colSpan={3} scope="rowgroup">{object}</th></tr>
        {values.map((row, index) => {
          const record = optionalRecord((optionalRecord(optionalRecord(row.basis).answer).records as unknown[] | undefined)?.[0]);
          const citation = record.standard ? `${text(record.standard)}:${text(record.edition)} ${text(record.table || record.clause).replace(/Table\s*/,'表 ')} · 第 ${record.printed_page} 页` : text(row.citation).replace(/（PDF[^）]*）/,'').replace(/Table\s*/,'表 ');
          const detail = [record.pdf_page ? `PDF 第 ${record.pdf_page} 页` : '', text(row.note)].filter(Boolean).join('；');
          return <tr key={index}>
        <th scope="row">{text(row.name)}</th>
        <td className="numeric">{significantNumber(numeric(row.value), 5)} {row.unit === '1' ? '' : text(row.unit)}</td>
        <td title={detail}><span className="material-basis-citation">{citation}</span><StatusMark kind={row.status === 'verified' ? 'success' : row.status === 'different' ? 'conflict' : 'unknown'} label={text(row.status_label)} />
          {row.status === 'different' && <>（依据值 {significantNumber(numeric(row.reference_value),5)} {text(row.unit)}；差 {significantNumber(numeric(row.difference),4)} {text(row.unit)}）</>}
        </td>
      </tr>;})}</Fragment>)}</tbody>
    </table></div> : <p>该历史运行未保存材料依据核对记录；按当前版本重算后可逐项核对。</p>}
  </StudyDetailGroup>;
}
