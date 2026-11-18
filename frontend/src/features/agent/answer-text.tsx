import { memo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon';

/** CommonMark and GFM stay with the maintained parser; raw HTML is never enabled. */
export const AnswerText = memo(function AnswerText({ text }: { text: string }) {
  return <div className="agent-answer"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    table: ({ children }) => <div className="agent-answer-table" tabIndex={0} role="region" aria-label="回答中的数据表"><table>{children}</table></div>,
    h1: ({ children }) => <h3 className="agent-answer-heading">{children}</h3>,
    h2: ({ children }) => <h3 className="agent-answer-heading">{children}</h3>,
    h3: ({ children }) => <h3 className="agent-answer-heading">{children}</h3>,
    h4: ({ children }) => <h4 className="agent-answer-heading">{children}</h4>,
    a: ({ children, href }) => <a href={href} {...(/^https?:/i.test(href || '') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>,
    // A model's image URL is a link for the reader, never an automatic remote request.
    img: ({ alt, src }) => <a href={src} target="_blank" rel="noopener noreferrer">{alt || '查看引用图片'}</a>,
  }}>{text}</Markdown></div>;
});

export function CopyAnswer({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState('copied'); }
    catch { setState('error'); }
  };
  return <div className="agent-answer-actions">
    <Button variant="ghost" size="compact" onClick={() => void copy()} aria-label={state === 'copied' ? '已复制回答' : '复制回答'}>
      <Icon name={state === 'copied' ? 'agent/approve' : 'action/copy'} />{state === 'copied' ? '已复制' : '复制回答'}
    </Button>
    {state === 'error' && <span role="status">浏览器未允许复制，请选中回答文字后复制。</span>}
  </div>;
}
