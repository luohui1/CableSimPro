import { MotionValue } from "./motion";
import { EngineeringValue } from "./engineering-value";
import type { ReactNode } from "react";
export function Conclusion({
  title = "推荐型号",
  model,
  description,
  metrics,
  historical,
  conditions,
}: {
  title?: ReactNode;
  model: string;
  description: string;
  metrics: {
    label: string;
    value: number | null;
    unit: string;
    precision?: number;
    from?: number;
    secondary?: string;
    quantity?: string;
  }[];
  historical?: boolean;
  conditions?: ReactNode;
}) {
  return (
    <section
      aria-label={historical ? "历史结论" : "选型结论"}
      className={`conclusion ${historical ? "is-historical" : ""}`}
    >
      <div className="conclusion-copy">
        <span className="muted">{title}</span>
        <h2>{model}</h2>
        <p className="muted">{description}</p>
        {conditions}
      </div>
      <dl className="conclusion-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dd>
              {metric.quantity ? (
                <EngineeringValue
                  quantity={metric.quantity}
                  value={metric.value}
                  unit={metric.unit}
                  withUnit
                />
              ) : (
                <>
                  <MotionValue
                    value={metric.value}
                    from={metric.from}
                    precision={metric.precision}
                    historical={historical}
                  />
                  <span className="unit">{metric.unit}</span>
                </>
              )}
              {metric.secondary && (
                <span className="unit">（{metric.secondary}）</span>
              )}
            </dd>
            <dt>{metric.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
