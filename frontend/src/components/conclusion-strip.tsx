import { EngineeringValue } from './engineering-value';
import { StatusMark } from './status-mark';
import { engineeringQuantity, formatNumber } from '@/lib/format';
import '../styles/conclusion-strip.css';

export type ConclusionStripMetric = {
  id?: string;
  label: string;
  value: number | null | undefined;
  unit?: string;
  /** Use the same saved-value quantity and unit as EngineeringValue. */
  quantity?: string;
  precision?: number;
};

/** Compact, read-only presentation of a saved headline and its key values (§5). */
export function ConclusionStrip({ conclusion, metrics, label = '结论', historical = false }: {
  conclusion: string;
  metrics: readonly ConclusionStripMetric[];
  label?: string;
  historical?: boolean;
}) {
  return <section className="conclusion-strip" data-conclusion-strip data-historical={historical || undefined} aria-label={label}>
    <div className="conclusion-strip-copy">
      {historical && <span data-conclusion-part="label"><StatusMark kind="historical" label="历史结论" /></span>}
      <p data-conclusion-part="sentence">{conclusion}</p>
    </div>
    {!!metrics.length && <dl className="conclusion-strip-metrics">{metrics.map(metric => {
      const available = metric.value != null && Number.isFinite(metric.value);
      const unit = metric.quantity ? engineeringQuantity(metric.quantity, metric.value, metric.unit || '').unit : metric.unit;
      return <div key={metric.id || metric.label}>
        <dt data-conclusion-part="label">{metric.label}</dt>
        <dd><span data-conclusion-part="value" data-numeric="true">{metric.quantity
          ? <EngineeringValue quantity={metric.quantity} value={metric.value} unit={metric.unit || ''} />
          : formatNumber(metric.value, metric.precision)}</span>
          {available && unit && unit !== '—' && <span data-conclusion-part="unit">{unit}</span>}
        </dd>
      </div>;
    })}</dl>}
  </section>;
}
