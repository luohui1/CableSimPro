import type { ReactNode } from 'react';
export function Toolbar({ children, label = '结果工具栏' }: { children: ReactNode; label?: string }) {
  return <div className="toolbar" role="group" aria-label={label}>{children}</div>;
}
