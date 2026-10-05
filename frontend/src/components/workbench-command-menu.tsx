import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from './ui/dialog';
import { Icon } from './icon';
import { filterNavigation, nextNavigationIndex, type WorkbenchDestination } from '../lib/workbench-navigation';

export interface WorkbenchCommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (destination: WorkbenchDestination) => void;
}

/** Uses the existing Radix dialog and its focus/close behavior. */
export function WorkbenchCommandMenu({ open, onOpenChange, onNavigate }: WorkbenchCommandMenuProps) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const resultId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const items = filterNavigation(query);
  useEffect(() => { if (open) setQuery(''); }, [open]);

  function choose(item: WorkbenchDestination) {
    onOpenChange(false);
    onNavigate(item);
  }
  function keydown(event: KeyboardEvent<HTMLElement>, current = -1) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = nextNavigationIndex(current, event.key === 'ArrowDown' ? 1 : -1, items.length);
      if (index >= 0) buttons.current[index]?.focus();
    } else if (event.key === 'Enter' && current === -1 && items.length) {
      event.preventDefault();
      choose(items[0]);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="快速导航"
      description="查找页面入口。此处只切换页面，不保存参数、不启动计算。" initialFocus="form">
      <div className="wb-command">
        <label className="wb-command-label" htmlFor={inputId}>搜索工作区</label>
        <div className="wb-command-search">
          <Icon name="action/search" />
          <input id={inputId} type="search" autoComplete="off" spellCheck={false}
            placeholder="搜索型号、研究、资料…" value={query} aria-controls={resultId}
            onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => keydown(event)} />
          <kbd>Esc</kbd>
        </div>
        <p className="wb-command-count" role="status" aria-live="polite">{items.length ? `${items.length} 个页面入口` : '没有匹配入口'}</p>
        <ul id={resultId} className="wb-command-results" aria-label="页面入口">
          {items.map((item, index) => (
            <li key={item.id}>
              <button type="button" className="wb-command-result"
                ref={(node) => { buttons.current[index] = node; }}
                onClick={() => choose(item)} onKeyDown={(event) => keydown(event, index)}>
                <span className="wb-command-icon"><Icon name={item.icon} /></span>
                <span className="wb-command-copy"><strong>{item.label}</strong><span>{item.description}</span></span>
                <span className="wb-command-group">{item.group}</span>
                <Icon name="action/chevron-right" />
              </button>
            </li>
          ))}
        </ul>
        {!items.length && <div className="wb-command-empty"><Icon name="action/search" /><p>试试“型号”“研究”或英文关键词。</p></div>}
        <div className="wb-command-help"><span><kbd>↑</kbd><kbd>↓</kbd> 或 <kbd>Tab</kbd> 移动</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
      </div>
    </Dialog>
  );
}
