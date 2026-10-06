"use client";
// AI Elements CodeBlock adapter: project typography and neutral roles, without a second colour theme.
import { useState, type HTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & { code: string; language: string; showLineNumbers?: boolean };
export function CodeBlock({ code, language, showLineNumbers = false, className, children, ...props }: CodeBlockProps) {
  const [copied,setCopied] = useState(false), [error,setError] = useState('');
  return <div className={cn('code-block',className)} {...props}>
    <header><span className="muted">{language}</span><Button size="icon" variant="ghost" aria-label={copied?'已复制':'复制代码'} onClick={async()=>{try{await navigator.clipboard.writeText(code);setCopied(true);setError('');}catch{setError('复制失败，请手动选择文本。');}}}>{copied?<CheckIcon/>:<CopyIcon/>}</Button>{children}</header>
    <pre><code>{showLineNumbers ? code.split('\n').map((line,index)=><span className="code-line" key={index}><span aria-hidden="true" className="muted">{index+1} </span>{line}{'\n'}</span>) : code}</code></pre>
    {error&&<p role="alert" className="field-error">{error}</p>}
  </div>;
}
