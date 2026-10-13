import { Icon } from './icon';
import { IconButton } from './ui/button';
import { displayText } from '@/lib/display-names';
import { useState } from 'react';

/** Non-modal information: no backdrop, focus capture or interruption of the form. */
export function InformationNotice({ title, description, onDismiss, floating = false }: {
  title: string; description: string; onDismiss?: () => void; floating?: boolean;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const identity = `${title}\u0000${description}`;
  const dismiss = () => { setDismissed(identity); onDismiss?.(); };
  if (dismissed === identity) return null;
  return <aside className="information-notice" data-floating={floating || undefined}
    role="status" aria-live="polite" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
    }}>
    <Icon name="status/info" />
    <div><h2>{displayText(title)}</h2><p>{displayText(description)}</p></div>
    <IconButton icon="action/close" variant="ghost" label="关闭信息提示" onClick={dismiss} />
  </aside>;
}
