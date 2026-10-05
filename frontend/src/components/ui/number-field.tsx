import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { SourceBadge, type SourceKind } from "@/components/source-badge";

export function NumberField({
  label,
  value,
  onCommit,
  unit,
  precision = 0,
  min,
  max,
  required = false,
  disabled,
  locked,
  error,
  source,
  dirty: externalDirty,
  draftText,
  onDraftChange,
  minExclusive,
  integer,
  sourceDetail,
  path,
  fullPrecision,
}: {
  label: string;
  value: number | null;
  onCommit?: (value: number | null) => void;
  unit: string;
  precision?: number;
  min?: number;
  max?: number;
  required?: boolean;
  disabled?: boolean;
  locked?: boolean;
  error?: string;
  source?: SourceKind;
  dirty?: boolean;
  draftText?: string;
  onDraftChange?: (value: string | undefined) => void;
  minExclusive?: boolean;
  integer?: boolean;
  sourceDetail?: string;
  path?: string;
  fullPrecision?: string;
}) {
  const id = useId();
  const fixed =
    value == null || !Number.isFinite(value) ? "" : value.toFixed(precision);
  const text =
    value !== null && value !== 0 && fixed && Number(fixed) === 0
      ? value.toString()
      : fixed;
  const touched = useRef(false);
  const [draft, setDraft] = useState(text);
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    setDraft(text);
    setLocalError("");
    touched.current = false;
  }, [text]);
  useEffect(() => {
    if (onDraftChange) setDraft(draftText ?? text);
  }, [draftText, text]);
  const problem = localError || error;
  const dirty = externalDirty || draft !== text;
  function commit() {
    const blank = !draft.trim();
    const number =
      !touched.current &&
      draftText === undefined &&
      draft === text &&
      value !== null
        ? value
        : Number(draft);
    const message =
      blank && required
        ? `请填写${label}`
        : !blank && !Number.isFinite(number)
          ? "请输入有效数值"
          : !blank && integer && !Number.isInteger(number)
            ? "请输入整数"
            : !blank && min !== undefined && minExclusive && number === min
              ? `须大于 ${min} ${unit}`
              : !blank && min !== undefined && number < min
                ? `不得小于 ${min} ${unit}`
                : !blank && max !== undefined && number > max
                  ? `不得大于 ${max} ${unit}`
                  : "";
    setLocalError(message);
    if (!message) {
      onCommit?.(blank ? null : number);
      onDraftChange?.(undefined);
    }
  }
  return (
    <div className="number-field" data-field-path={path}>
      <label htmlFor={id}>{label}</label>
      <div className="field-value-line">
        <div
          className={cn(
            "number-input",
            problem && "has-error",
            dirty && "is-dirty",
            locked && "is-locked",
            disabled && "is-disabled",
          )}
        >
          <input
            id={id}
            type="text"
            inputMode="decimal"
            value={draft}
            disabled={disabled}
            readOnly={locked}
            aria-required={required}
            aria-invalid={!!problem}
            aria-describedby={problem ? `${id}-error` : undefined}
            title={
              fullPrecision ||
              (value === null
                ? "未提供"
                : `完整精度：${value.toString()} ${unit}`)
            }
            onChange={(event) => {
              touched.current = true;
              setDraft(event.target.value);
              onDraftChange?.(event.target.value);
              setLocalError("");
            }}
            onBlur={() => {
              if (!locked && !disabled && dirty) commit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !locked) {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                setDraft(text);
                onDraftChange?.(undefined);
                setLocalError("");
                touched.current = false;
              }
            }}
          />
          <span className="unit">{unit}</span>
        </div>
        {source && <SourceBadge kind={source} detail={sourceDetail} />}
      </div>
      {problem && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
