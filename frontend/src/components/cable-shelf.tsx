import { useQuery } from "@tanstack/react-query";
import { cableModels } from "@/api/documents";
import { numeric, optionalRecord, text } from "@/api/client";
import { illustration } from "@/lib/illustrations";

/** 型号外观图：按型号代号匹配仓库里的剥切渲染图；没有对应图时不显示图片。 */
function render(designation: string) {
  if (/^YJLW/i.test(designation)) return illustration("type-yjlw03-strip");
  if (/^YJV/i.test(designation)) return illustration("type-yjv22-strip");
  return undefined;
}

const STATE: Record<string, { label: string; tone: string }> = {
  incomplete: { label: "资料缺项", tone: "warn" },
  draft: { label: "待核对", tone: "warn" },
  confirmed: { label: "已确认", tone: "good" },
};

/** 库首屏：电缆型号架。数据来自领域电缆模型接口；状态如实显示（缺项、待核对）。 */
export function CableShelf() {
  const models = useQuery({ queryKey: ["domain-cable-models"], queryFn: ({ signal }) => cableModels(signal) });
  const rows = (models.data || []).map((row) => {
    const payload = optionalRecord(row.payload);
    const spec = optionalRecord(payload.specification);
    const area = numeric(spec.area_m2);
    const voltage = numeric(spec.voltage_v);
    const u0 = numeric(spec.u0_v);
    return {
      id: text(row.id), name: text(payload.name), version: text(payload.version), state: text(row.state),
      status: text(row.display_status), maker: text(spec.manufacturer), designation: text(spec.designation) || text(payload.name),
      detail: [numeric(spec.cores) ? `${numeric(spec.cores)} 芯` : "", area ? `${Math.round(area * 1e6)} mm²` : "", u0 && voltage ? `${u0 / 1000}/${voltage / 1000} kV` : ""].filter(Boolean).join(" · "),
    };
  });
  if (models.isError) return <p className="field-error">电缆型号读取失败</p>;
  if (!rows.length) return null;
  return <section className="cable-shelf" aria-label="电缆型号">
    <header><h2>电缆型号</h2><span className="muted">{rows.length} 条 · 计算按版本引用</span></header>
    <ul>
      {rows.map((row) => {
        const art = render(row.designation);
        const state = STATE[row.state];
        return <li key={row.id} className="cable-card">
          <div className="cable-card-art">{art && <img src={art} alt="" loading="lazy" />}</div>
          <div className="cable-card-body">
            <b>{row.name}</b>
            <span className="muted">{row.detail || row.version}</span>
            <span className="cable-card-meta"><span className={`tag ${state?.tone === "good" ? "tag-good" : "tag-warn"}`}>{row.status || state?.label || row.state}</span>{row.maker && <span className="muted">{row.maker}</span>}</span>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
