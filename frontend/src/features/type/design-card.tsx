import { PropertyPanel } from '@/components/property-panel';
import { RelationPanel } from '@/components/relation-panel';
import { optionalRecord, text } from '@/api/client';
import { StatusMark } from '@/components/status-mark';
import { formatNumber } from '@/lib/format';
import type { DomainDocument } from '@/lib/domain-fields';
import { designSummary, publicationLabels, publicationStatus } from './design-summary';
import { MissingTypeInputs } from './missing';

export function DesignCard({ document, raw, onClose }: { document: DomainDocument; raw: Record<string, unknown>; onClose?: () => void }) {
  const card = designSummary(document, raw), status = publicationStatus(raw), creation = optionalRecord(raw.type_creation), source = optionalRecord(creation.source);
  return <div className="type-design-card" data-type-card data-closable={!!onClose}><PropertyPanel title={card.name} collapsed={false} onToggle={onClose || (() => {})} groups={[
    { label: '型号名片', items: [
      { label: '类别', value: '型号设计' }, { label: '基准版本', value: card.version },
      { label: '状态', value: <StatusMark kind={status === 'published' ? 'locked' : status === 'review' ? 'proposal' : 'draft'} label={publicationLabels[status]} /> },
      { label: '来源', value: <span title={card.sourceDetail}>{card.source}</span> },
      { label: '绘图外径', value: formatNumber(card.diameter, 1), unit: 'mm', source: card.diameter === null ? undefined : 'derived', sourceDetail: '同一份参数截面的绘图包络；原始实体外径见外径与用料。' },
      { label: '层数', value: card.layers ?? '未提供' }, { label: '最近修订时间', value: card.updated }, { label: '所属', value: '独立型号设计' },
    ] },
  ]} />{creation.kind === 'standard' && Array.isArray(source.limitations) && <details className="type-missing-inputs"><summary>提案范围与缺项</summary><ul>{source.limitations.map((item, index) => <li key={index}>{String(item)}</li>)}</ul></details>}{!!raw.type_creation && text(raw.id) && <MissingTypeInputs document={document} wid={text(raw.id)} />}{text(raw.id) && <RelationPanel kind="type" id={text(raw.id)} />}</div>;
}
