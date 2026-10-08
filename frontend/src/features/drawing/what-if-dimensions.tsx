import { useEffect, useState } from 'react';
import { moveSelection, selectionPosition } from './section-geometry';
import type { Section, SectionEdit, SectionSelection } from './types';

function LengthInput({ label, value, apply }: { label: string; value: number; apply: (value: number) => void }) {
  const [text, setText] = useState(String(Number(value.toFixed(6)))), [error, setError] = useState('');
  useEffect(() => { setText(String(Number(value.toFixed(6)))); setError(''); }, [value]);
  function commit() {
    if (Number(text) === value) return;
    try { if (!text.trim() || !Number.isFinite(Number(text)) || Number(text) <= 0) throw Error(`${label}：请输入正尺寸，单位 m。`);
      apply(Number(text)); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <label className="what-if-length">{label}<input aria-label={`${label} m`} type="number" step="0.01" min="0"
    value={text} aria-invalid={!!error} title={error || '单位 m；Enter 确认，Esc 取消'} onChange={e => { setText(e.target.value); setError(''); }}
    onBlur={commit} onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(String(Number(value.toFixed(6)))); setError(''); }
    }} /><span>m</span>{error && <span className="what-if-field-error" role="alert">{error}</span>}</label>;
}

/** Same horizontal neighbour and SI positions as the drawing dimension chain. */
export function WhatIfDimensions({ section, selected, commit }: { section: Section; selected: SectionSelection; commit: (section: Section, edit: SectionEdit) => void }) {
  if (!selected || !['cable', 'enclosure'].includes(selected.kind)) return null;
  const position = selectionPosition(section, selected);
  if (!position) return null;
  const items = selected.kind === 'cable' ? section.placements.map(p => ({ id: p.cable, x: p.x, z: p.z })) : section.enclosures || [];
  const ordered = [...items].sort((a, b) => a.x - b.x), index = ordered.findIndex(p => p.id === selected.id);
  const neighbor = ordered[index - 1] || ordered[index + 1];
  function move(x: number, z: number) {
    const change = moveSelection(section, selected, { x, z }, true);
    commit(change.section, { gestureId: crypto.randomUUID(), kind: 'dimension', selection: selected, fields: change.fields });
  }
  return <div className="what-if-dimensions" aria-label="试算尺寸">
    {section.kind === 'ground' && <LengthInput key={`${selected.id}/depth`} label="中心埋深" value={-position.z} apply={value => move(0, -value - position.z)} />}
    {neighbor && <LengthInput key={`${selected.id}/spacing`} label="水平中心距" value={Math.abs(position.x - neighbor.x)}
      apply={value => move(neighbor.x + (position.x < neighbor.x ? -1 : 1) * value - position.x, 0)} />}
  </div>;
}
