import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { Command } from 'cmdk';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

export type PromptReference = { key: string; name: string; description?: string; icon: string };
export type PromptCommand = { key: string; name: string; description: string; text: string };
type Row = { key: string; name: string; description?: string; icon?: string; insert: string };
type Mode = 'at' | 'slash';

const parseToken = (draft: string) => {
  const match = /(^|\s)([@/])([^\s@/]*)$/.exec(draft);
  return match ? { kind: (match[2] === '@' ? 'at' : 'slash') as Mode, query: match[3], start: match.index + match[1].length } : null;
};

/** Radix manages popup focus and dismissal; cmdk owns search, selection and keyboard navigation. */
export function PromptBar({ value, onChange, busy, canSend, placeholder, references = [], commands = [], model, disabledReason }: {
  value: string; onChange: (value: string) => void; busy?: boolean; canSend: boolean;
  placeholder: string; references?: PromptReference[]; commands?: PromptCommand[]; model?: ReactNode; disabledReason?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const aui = useAui();
  const composerText = useAuiState(state => state.composer.text);
  // The draft is cleared by the host's HTTP acceptance callback, not when a local send button is clicked.
  useEffect(() => { if (composerText !== value) aui.composer.setText(value); }, [aui, composerText, value]);
  const [manual, setManual] = useState<Mode | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [query, setQuery] = useState('');
  const helpId = useId();
  const token = dismissed ? null : parseToken(value);
  const mode = manual ?? token?.kind ?? null;
  const rows: Row[] = mode === 'at'
    ? references.map(row => ({ ...row, insert: `@${row.name} ` }))
    : commands.map(row => ({ ...row, insert: row.text }));
  const canSubmit = canSend && !!value.trim() && !busy;
  const close = () => { setManual(null); setDismissed(true); };
  const choose = (row: Row) => {
    const head = token && !manual ? value.slice(0, token.start) : value.replace(/\s*$/, value.trim() ? ' ' : '');
    onChange(head + row.insert);
    close();
    requestAnimationFrame(() => input.current?.focus());
  };
  const open = (next: Mode) => { setManual(next); setQuery(''); };
  const hint = busy ? '正在处理上一条任务。可以先写下一条；停止接收后请更新任务状态。'
    : !canSend ? disabledReason || '先连接模型并选择工作对象，才能发送任务。'
      : 'Enter 发送，Shift + Enter 换行。';

  return <ComposerPrimitive.Root className="prompt-bar">
    <Popover open={!!mode} onOpenChange={next => { if (!next) close(); }}>
      <PopoverAnchor asChild><div className="prompt-bar-box">
        <ComposerPrimitive.Input ref={input} value={value} minRows={1} maxRows={6} cancelOnEscape={false} addAttachmentOnPaste={false} aria-label="给 Agent 的任务" aria-describedby={helpId} placeholder={placeholder}
          onChange={event => { onChange(event.target.value); setDismissed(false); setManual(null); setQuery(parseToken(event.target.value)?.query || ''); }} />
        <div className="prompt-bar-tools">
          {references.length > 0 && <Button type="button" variant="ghost" size="compact" className="prompt-bar-icon" aria-label="引用研究或型号" aria-haspopup="dialog" aria-expanded={mode === 'at'} onClick={() => open('at')}><Icon name="action/add" /><span>引用</span></Button>}
          {commands.length > 0 && <Button type="button" variant="ghost" size="compact" className="prompt-bar-icon" aria-label="选择常用任务" aria-haspopup="dialog" aria-expanded={mode === 'slash'} onClick={() => open('slash')}><Icon name="agent/message" /><span>常用任务</span></Button>}
          <div className="prompt-bar-submit">
            {busy && <ComposerPrimitive.Cancel render={<Button type="button" variant="outline" size="compact" aria-label="停止接收" />}><Icon name="run/stop" />停止接收</ComposerPrimitive.Cancel>}
            <ComposerPrimitive.Send render={<Button type="button" variant="primary" size="compact" className="prompt-bar-send" aria-label="发送" data-armed={canSubmit || undefined} disabled={!canSubmit}
              title={!canSend ? disabledReason || '先连接模型并选择工作对象' : busy ? '上一条任务结束后可以发送' : !value.trim() ? '先填写任务内容' : '发送任务'} />}>
              <Icon name="action/arrow-up" /><span>发送</span>
            </ComposerPrimitive.Send>
          </div>
        </div>
        {model && <div className="prompt-bar-model">{model}</div>}
      </div></PopoverAnchor>
      <PopoverContent className="prompt-command-menu" side="top" align="start" onCloseAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
        <Command label={mode === 'at' ? '引用研究或型号' : '常用任务'} loop>
          <Command.Input value={query} onValueChange={setQuery} placeholder={mode === 'at' ? '搜索研究或型号' : '搜索常用任务'} aria-label={mode === 'at' ? '搜索引用对象' : '搜索常用任务'} className="prompt-command-search" />
          <Command.List className="prompt-command-list">
            <Command.Empty className="prompt-bar-empty">{mode === 'at' ? '没有匹配的研究或型号' : '没有匹配的任务'}</Command.Empty>
            <Command.Group heading={mode === 'at' ? '引用工作对象' : '选择任务后可继续补充要求'}>
              {rows.map(row => <Command.Item key={row.key} value={row.key} keywords={[row.name, row.description || '']} onSelect={() => choose(row)} className="prompt-bar-row">
                <Icon name={row.icon || 'agent/message'} /><span><b>{row.name}</b>{row.description && <span>{row.description}</span>}</span>
              </Command.Item>)}
            </Command.Group>
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
    <p className="prompt-bar-help" id={helpId}>{hint}</p>
  </ComposerPrimitive.Root>;
}
