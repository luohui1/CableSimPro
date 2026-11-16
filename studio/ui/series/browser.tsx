// The object browser: the parts the active size is made of, from the inside out, each with the size a structure
// table states and the worst verdict of its standard requirements. Selecting a part lights it everywhere.
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SpecView } from '@shared/types';
import { TONE_FILL } from '@/canvas/cable-glyph';
import { partSize, partVerdict, type Focus, type Part, type Verdict } from './model';

const VERDICT_ICON: Record<Verdict, ReactNode> = {
  failed: <CircleX size={15} className="ws-verdict" data-verdict="failed" aria-label="有不通过项" />,
  missing: <CircleAlert size={15} className="ws-verdict" data-verdict="missing" aria-label="缺输入或需实测" />,
  uncovered: <CircleDashed size={15} className="ws-verdict" data-verdict="uncovered" aria-label="标准库未覆盖" />,
  passed: <CircleCheck size={15} className="ws-verdict" data-verdict="passed" aria-label="已核对项均通过" />,
};

export function Browser({ view, parts, focus, onFocus }: { view: SpecView | undefined; parts: Part[]; focus: Focus; onFocus: (focus: Focus) => void }) {
  return <nav className="ws-browser" aria-label="结构浏览器">
    <button type="button" className="ws-tree-heading" aria-pressed={focus.kind === 'structure'} onClick={() => onFocus(focus.kind === 'structure' ? { kind: 'spec' } : { kind: 'structure' })}>
      <Layers size={15} /><span>结构</span>{view && <span className="ws-tree-heading-note">{view.spec.key} · mm</span>}</button>
    <div>
      {parts.map(part => {
        const verdict = partVerdict(view, part.role);
        const active = focus.kind === 'part' && focus.role === part.role;
        return <button key={part.role} type="button" className="ws-tree-item" aria-pressed={active}
          aria-label={`${part.number} ${part.name}`} onClick={() => onFocus(active ? { kind: 'spec' } : { kind: 'part', role: part.role })}>
          <span className="ws-tree-number">{part.number}</span>
          <span className="ws-swatch" style={{ background: TONE_FILL[part.tone] }} />
          <span className="ws-tree-name">{part.name}</span>
          <span className="ws-tree-value">{partSize(part)}</span>
          {verdict ? VERDICT_ICON[verdict] : <span />}
        </button>;
      })}
    </div>
  </nav>;
}
