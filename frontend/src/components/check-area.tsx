import { useId, useState, type ReactNode } from 'react';
import { MotionReveal } from './motion';
import { Icon } from './icon';

export function CheckArea({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className="check-area"><button type="button" className="check-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><span>{summary}</span><span className="check-expand">{open ? '收起' : '展开'}<Icon name="action/chevron-down" className={open ? 'rotated' : undefined} /></span></button><MotionReveal open={open} id={id} className="check-details">{children}</MotionReveal></section>;
}
