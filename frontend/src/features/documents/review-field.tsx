import { useEffect, useRef, useState } from "react";
import { printedValue } from './evidence';
import type { Candidate, Decision } from "@/api/documents";
import { displayName, displayUnit, displayText } from "@/lib/display-names";
import { Button } from "@/components/ui/button";

export function ReviewField({
  candidate,
  busy,
  readOnly,
  saved,
  operator,
  onOperator,
  onSave,
  command,
}: {
  candidate: Candidate;
  busy: boolean;
  readOnly: boolean;
  saved?: Record<string, unknown>;
  operator: string;
  onOperator: (value: string) => void;
  onSave: (decision: Decision) => void;
  command?: { action: 'accept' | 'reject'; id: number };
}) {
  const [action, setAction] = useState<Decision["action"]>("accept"),
    [value, setValue] = useState(printedValue(candidate)),
    [unit, setUnit] = useState(candidate.raw_unit),
    [reason, setReason] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!command || busy || readOnly) return;
    setAction(command.action);
    const reviewer = form.current?.elements.namedItem('reviewer') as HTMLInputElement | null;
    const note = form.current?.elements.namedItem('reason') as HTMLTextAreaElement | null;
    if (!operator.trim() || !reviewer?.reportValidity()) { reviewer?.focus(); return; }
    if (!reason.trim() || !note?.reportValidity()) { note?.focus(); return; }
    // The command carries the decision explicitly; it must not read radio state
    // from an earlier render while React is processing the shortcut.
    onSave({candidate_id:candidate.id,action:command.action,reason:reason.trim()});
  }, [command?.id]);
  function reset() {
    setAction("accept");
    setValue(printedValue(candidate));
    setUnit(candidate.raw_unit);
    setReason("");
  }
  return (
    <form
      ref={form}
      className="document-review-field"
      aria-label="逐项核对"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          candidate_id: candidate.id,
          action,
          reason: reason.trim(),
          ...(action === "modify"
            ? { value: Number(value), unit: unit as Decision["unit"] }
            : {}),
        });
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" ||
          ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z")
        ) {
          event.preventDefault();
          reset();
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          if (!busy && !readOnly) event.currentTarget.requestSubmit();
        }
      }}
    >
      <h2>{displayName(candidate.field)}</h2>
      <dl className="document-evidence">
        <dt>原始值</dt>
        <dd>
          {printedValue(candidate)} {displayUnit(candidate.raw_unit)}
        </dd>
        <dt>国际单位值</dt>
        <dd>
          <span title={String(candidate.value_si)}>{Number(candidate.value_si.toPrecision(10)).toString()}</span> {displayUnit(candidate.unit_si)}
        </dd>
        <dt>数值语义</dt>
        <dd>
          {candidate.basis === "manufacturer_limit"
            ? "厂家最大值"
            : "厂家公开值"}
        </dd>
        <dt>原文数值</dt>
        <dd>{candidate.quote}</dd>
        <dt>表头原文</dt>
        <dd>{candidate.header_quote || "未提供表头引用"}</dd>
        <dt>证据位置</dt>
        <dd>
          第 {candidate.page} 页 ·{" "}
          {candidate.evidence_source === "ocr"
            ? "识别证据范围"
            : "原件单元格／字形"}
          <details>
            <summary>坐标与摘要</summary>
            <p>PDF 点坐标：{candidate.bbox_pt.join("，")}</p>
            <p className="digest">
              {candidate.evidence_sha256 || "使用原件摘要"}
            </p>
          </details>
        </dd>
        <dt>提取方式</dt>
        <dd>
          {candidate.extraction_origin === "llm" ? "模型补充" : "规则提取"}
        </dd>
      </dl>
      {!!candidate.ambiguities.length && (
        <ul className="field-error">
          {candidate.ambiguities.map((item, index) => (
            <li key={index}>{displayText(item)}</li>
          ))}
        </ul>
      )}
      {saved && (
        <p className="muted">
          已保存核对：
          {saved.action === "accept"
            ? "接受"
            : saved.action === "modify"
              ? "修改"
              : "拒绝"}{" "}
          · {String(saved.reviewer || "")}
        </p>
      )}
      <fieldset disabled={busy || readOnly}>
        <legend>核对决定</legend>
        <div className="document-decisions" data-request-path="/decisions/0/action" tabIndex={-1}>
          {(
            [
              ["accept", "接受"],
              ["modify", "修改"],
              ["reject", "拒绝"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="radio"
                name="decision"
                value={key}
                checked={action === key}
                onChange={() => setAction(key)}
              />
              {label}
            </label>
          ))}
        </div>
        {action === "modify" && (
          <div className="document-form-grid">
            <label>
              修订值
              <input
                name="value"
                data-request-path="/decisions/0/value"
                type="number"
                min="0.000000000001"
                step="any"
                required
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <label>
              修订单位
              <select
                aria-label="修订单位"
                data-request-path="/decisions/0/unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              >
                {[
                  "mm",
                  "cm",
                  "m",
                  "ohm/km",
                  "ohm/m",
                  "kg/km",
                  "kg/m",
                  "kg/100m",
                ].map((item) => (
                  <option key={item} value={item}>
                    {displayUnit(item)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label>
          核对人
          <input
            name="reviewer"
            data-request-path="/reviewer"
            value={operator}
            onChange={(event) => onOperator(event.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label>
          核对理由
          <textarea
            name="reason"
            data-request-path="/decisions/0/reason"
            aria-label="核对理由"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength={500}
            rows={2}
          />
        </label>
        <Button type="submit" loading={busy}>
          保存此项核对
        </Button>
      </fieldset>
    </form>
  );
}
