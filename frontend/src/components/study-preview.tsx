import { useCallback, useEffect, useRef, useState } from "react";
import { message, numeric, optionalRecord, text } from "@/api/client";
import { commitFields } from "@/lib/domain-fields";
import { formatNumber } from "@/lib/format";
import { moduleConfiguration } from "@/lib/study-config";
import { Icon } from "./icon";
import { useStudy } from "./study-provider";
import { Button } from "./ui/button";

/** 宿主从插件声明的关键结论里投影出的答案（值来自已校验工件，带显示单位）。 */
export type Headline = { key: string; title: string; value: number; unit: string; display_unit?: string | null; display_value: number; entity?: string; condition?: string | null; case_id?: string };
type PreviewResult = { status: string; elapsed_ms: number; headlines: Headline[]; input_digest: string; cases: Record<string, unknown>[] };

const headlinesOf = (value: unknown): Headline[] => (Array.isArray(value) ? value : []).map(optionalRecord)
  .filter((row) => numeric(row.display_value) !== null && !!text(row.key))
  .map((row) => row as unknown as Headline);

/**
 * 快速试算（Explore）：用当前未保存的模型草稿和方法参数调用同一插件执行器，结果只显示、不入库、
 * 不生成运行记录与交付。只有插件声明了 preview 且在本机运行的能力才开放；“实时”在草稿变化后自动重算。
 */
export function useStudyPreview({ module, available }: { module: string; available: boolean }) {
  const context = useStudy();
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const { study, workspace, domainDraft, draft } = context;

  const run = useCallback(async () => {
    if (!available) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true); setError("");
    try {
      let domain: unknown;
      try { domain = domainDraft ? commitFields(domainDraft) : undefined; }
      catch (problem) { throw new Error("模型草稿有未完成的输入：" + message(problem)); }
      const configuration = draft?.definition ? moduleConfiguration(draft.definition, module) : undefined;
      const response = await fetch(`/api/workspaces/${encodeURIComponent(study.workspace)}/studies/${encodeURIComponent(study.id)}/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({
          expected_revision: domainDraft?.revision ?? numeric(workspace.revision),
          expected_study_revision: study.revision,
          module,
          ...(domain ? { domain } : {}),
          ...(configuration?.parameters ? { parameters: configuration.parameters } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(text(optionalRecord(optionalRecord(body).detail).message) || text(optionalRecord(body).detail) || `试算失败（${response.status}）`);
      const value = optionalRecord(body);
      if (value.persisted !== false || value.preview !== true) throw new Error("宿主返回的不是预览结果");
      setResult({ status: text(value.status), elapsed_ms: numeric(value.elapsed_ms) ?? 0, headlines: headlinesOf(value.headlines), input_digest: text(value.input_digest), cases: (Array.isArray(value.cases) ? value.cases : []).map(optionalRecord) });
    } catch (problem) {
      if (!abort.signal.aborted) setError(message(problem));
    } finally {
      if (controller.current === abort) setRunning(false);
    }
  }, [available, domainDraft, draft?.definition, module, study.id, study.revision, study.workspace, workspace.revision]);

  // 实时：草稿变化后 600 ms 自动试算；关闭时不再请求
  useEffect(() => {
    if (!live || !available) return;
    const timer = window.setTimeout(() => void run(), 600);
    return () => window.clearTimeout(timer);
  }, [live, available, run]);
  useEffect(() => () => controller.current?.abort(), []);

  return { available, result, error, running, live, setLive, run, clear: () => { setResult(null); setError(""); } };
}

/** 命令栏里的试算按钮与实时开关。 */
export function PreviewControls({ preview }: { preview: ReturnType<typeof useStudyPreview> }) {
  if (!preview.available) return null;
  return <>
    <Button size="compact" variant="ghost" loading={preview.running} onClick={() => void preview.run()}><Icon name="result/scalar" />试算</Button>
    <label className="command-toggle"><input type="checkbox" checked={preview.live} onChange={(event) => preview.setLive(event.target.checked)} />实时</label>
  </>;
}

/** 结论栏下的试算结果：关键结论、与已保存结果的差值、耗时；明确标注未保存。 */
export function PreviewStrip({ preview, saved }: { preview: ReturnType<typeof useStudyPreview>; saved?: unknown }) {
  if (!preview.result && !preview.error) return null;
  const savedRows = headlinesOf(saved);
  return <div className={`preview-strip ${preview.error ? "is-error" : ""}`} role="status" aria-label="试算结果">
    <span className="preview-tag">试算 · 未保存</span>
    {preview.error ? <span className="preview-error">{preview.error}</span>
      : preview.result!.headlines.length ? preview.result!.headlines.map((row) => {
        const before = savedRows.find((item) => item.key === row.key && item.condition === row.condition);
        const delta = before ? row.display_value - before.display_value : null;
        return <span key={row.key + (row.condition || "")} className="preview-value">
          <small>{row.title}</small><b>{formatNumber(row.display_value, 4)}</b>{row.display_unit && <span className="unit">{row.display_unit}</span>}
          {delta !== null && Math.abs(delta) > 1e-9 && <span className="preview-delta" title="相对已保存结果">{delta > 0 ? "+" : ""}{formatNumber(delta, 3)}</span>}
        </span>;
      }) : <span className="muted">{preview.result!.status === "failed" ? "插件未得出结果，见运行明细。" : "插件没有声明关键结论。"}</span>}
    {preview.result && <span className="muted">{formatNumber(preview.result.elapsed_ms, 3)} ms</span>}
    <span className="spacer" />
    <Button size="compact" variant="ghost" onClick={preview.clear}>清除</Button>
  </div>;
}
