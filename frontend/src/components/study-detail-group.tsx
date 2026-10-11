import { useState, type ReactNode } from 'react';

/** L3: group visibility is a viewing preference, never part of calculation input. */
export function StudyDetailGroup({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  const key = 'study-detail:' + id;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === 'open'; } catch { return false; } });
  return <details className="study-detail-group" open={open} onToggle={event => {
    const next = event.currentTarget.open;
    setOpen(next);
    try { localStorage.setItem(key, next ? 'open' : 'closed'); } catch { /* Storage disabled: keep this session's choice. */ }
  }}><summary>{title}{count !== undefined && <span className="muted">{count} 项</span>}</summary><div className="study-detail-content">{children}</div></details>;
}
