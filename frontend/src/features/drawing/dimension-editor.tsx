import { useEffect, useRef, useState } from 'react';
import { NumberField } from '@/components/ui/number-field';

export function DimensionEditor({ x, y, label, value, unit, onCommit, onCancel }: {
  x: number; y: number; label: string; value: number; unit: string;
  onCommit: (value: number) => void | Promise<void>; onCancel: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => { const input = host.current?.querySelector('input'); input?.focus(); input?.select(); }, []);
  return <foreignObject x={x} y={y} width="224" height="148" className="drawing-dimension-editor">
    <div ref={host} className="drawing-editor-panel" onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) onCancel(); }
      }}><NumberField label={label} value={value} unit={unit} precision={6} required disabled={busy} error={problem}
      onCommit={async next => {
        if (next === null || pending.current) return;
        pending.current = true; setBusy(true); setProblem('');
        try { await onCommit(next); onCancel(); }
        catch (error) {
          setProblem(error instanceof Error ? error.message : String(error));
          requestAnimationFrame(() => host.current?.querySelector('input')?.focus());
        } finally { pending.current = false; setBusy(false); }
      }} /></div>
  </foreignObject>;
}
