import { PropertyPanel } from '@/components/property-panel';
import { StatusMark } from '@/components/status-mark';
import { formatNumber } from '@/lib/format';
import type { DomainDocument } from '@/lib/domain-fields';
import { designSummary, publicationLabels, publicationStatus } from './design-summary';

export function DesignCard({ document, raw, onClose }: { document: DomainDocument; raw: Record<string, unknown>; onClose?: () => void }) {
  const card = designSummary(document, raw), status = publicationStatus(raw);
  return <div className="type-design-card" data-type-card data-closable={!!onClose}><PropertyPanel title={card.name} collapsed={false} onToggle={onClose || (() => {})} groups={[
    { label: '型号名片', items: [
      { label: '类别', value: '型号设计' }, { label: '基准版本', value: card.version },
      { label: '状态', value: <StatusMark kind={status === 'published' ? 'locked' : status === 'review' ? 'proposal' : 'draft'} label={publicationLabels[status]} /> },
      { label: '来源', value: <span title={card.sourceDetail}>{card.source}</span> },
      { label: '绘图外径', value: formatNumber(card.diameter, 1), unit: 'mm', source: card.diameter === null ? undefined : 'derived', sourceDetail: '同一份参数截面的绘图包络；原始实体外径见外径与用料。' },
      { label: '层数', value: card.layers ?? '未提供' }, { label: '最近修订时间', value: card.updated }, { label: '所属', value: '独立型号设计' },
    ] },
    { label: '用到了', items: [{ label: '型号版本', value: card.originName ? <a className="object-link" href={`/resources/cables?selected=${encodeURIComponent(card.originId)}`} title={card.sourceDetail}>{card.originName} · {card.version}</a> : '未提供' }] },
  ]} /></div>;
}
