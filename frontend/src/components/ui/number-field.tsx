import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import { SourceBadge, type SourceKind } from '@/components/source-badge';
import { composing } from '@/lib/ui-interactions';

export function NumberField({ label, value, onCommit, unit, precision = 0, min, max, required = false, disabled, locked, error, source, dirty: externalDirty, draftText, onDraftChange, minExclusive, integer, sourceDetail, path, fullPrecision, inputRef, submitOnEnter = false }: {
  label: string; value: number | null; onCommit?: (value: number | null) => void; unit: string; precision?: number; min?: number; max?: number; required?: boolean; disabled?: boolean; locked?: boolean; error?: string; source?: SourceKind; dirty?: boolean; draftText?: string; onDraftChange?: (value: string | undefined) => void; minExclusive?: boolean; integer?: boolean; sourceDetail?: string; path?: string; fullPrecision?: string; inputRef?: RefObject<HTMLInputElement | null>; submitOnEnter?: boolean;
}) {
  const id = useId();
  const fixed = value == null || !Number.isFinite(value) ? '' : value.toFixed(precision);
  const text = value !== null && value !== 0 && fixed && Number(fixed) === 0 ? value.toString() : fixed;
  const touched = useRef(false);
  const [draft, setDraft] = useState(text), [localError, setLocalError] = useState('');
  useEffect(() => { setDraft(text); setLocalError(''); touched.current = false; }, [text]);
  useEffect(() => { if (onDraftChange) setDraft(draftText ?? text); }, [draftText, text]);
  const problem = localError || error, dirty = externalDirty || draft !== text;
  function commit(raw: string): boolean {
    const blank = !raw.trim();
    const number = !touched.current && draftText === undefined && raw === text && value !== null ? value : Number(raw);
    const message = blank && required ? `请填写${label}`
      : !blank && !Number.isFinite(number) ? '请输入有效数值'
      : !blank && integer && !Number.isInteger(number) ? '请输入整数'
      : !blank && min !== undefined && minExclusive && number === min ? `须大于 ${min} ${unit}`
      : !blank && min !== undefined && number < min ? `不得小于 ${min} ${unit}`
      : !blank && max !== undefined && number > max ? `不得大于 ${max} ${unit}` : '';
    setLocalError(message);
    if (message) return false;
    onCommit?.(blank ? null : number); onDraftChange?.(undefined); return true;
  }
  return <div className="number-field" data-field-path={path}>
    <label htmlFor={id}>{label}</label>
    <div className="field-value-line"><div className={cn('number-input', problem && 'has-error', dirty && 'is-dirty', locked && 'is-locked', disabled && 'is-disabled')}>
      <input ref={inputRef} id={id} type="text" inputMode="decimal" value={draft} disabled={disabled} readOnly={locked} aria-required={required} aria-invalid={!!problem}
        aria-describedby={`${id}-unit${problem ? ` ${id}-error` : ''}`} title={fullPrecision || (value === null ? '未提供' : `完整精度：${value.toString()} ${unit}`)}
        onInput={event => { touched.current = true; setDraft(event.currentTarget.value); onDraftChange?.(event.currentTarget.value); setLocalError(''); }}
        onChange={() => { /* Native input and autofill are handled by onInput. */ }}
        onBlur={event => { if (!locked && !disabled && (dirty || event.currentTarget.value !== text)) commit(event.currentTarget.value); }}
        onKeyDown={event => {
          if (composing(event.nativeEvent)) return;
          if (event.key === 'Enter' && !locked && !disabled) {
            const valid = commit(event.currentTarget.value);
            if (!submitOnEnter || !valid || !!error) { event.preventDefault(); event.stopPropagation(); }
          }
          if (event.key === 'Escape' && !locked && !disabled && (dirty || problem || draftText !== undefined)) {
            event.preventDefault(); event.stopPropagation();
            setDraft(text); onDraftChange?.(undefined); setLocalError(''); touched.current = false;
          }
        }} />
      <span id={`${id}-unit`} className="unit">{unit}</span>
    </div>{source && <SourceBadge kind={source} detail={sourceDetail} />}</div>
    {problem && <p id={`${id}-error`} className="field-error" role="alert">{problem}</p>}
  </div>;
}
