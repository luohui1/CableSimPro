// What the agent writes, as Markdown (a line it ended stays ended): tables, formulas and highlighted code, set in the kit's Prose. Formulas are typeset by KaTeX; code
// by Shiki (the web bundle, loaded when the first block of code is shown).
import '@assistant-ui/react-markdown/styles/dot.css';
import 'katex/dist/katex.min.css';
import { MarkdownTextPrimitive, memoizeMarkdownComponents, type SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import { memo, useEffect, useState } from 'react';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Prose } from '@/kit/chat/messages';
import { useTheme } from '@/state/theme';

function CodeBlock({ language, code }: Pick<SyntaxHighlighterProps, 'language' | 'code'>) {
  const { theme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void import('shiki/bundle/web')
      .then(shiki => shiki.codeToHtml(code, {
        lang: language, theme: theme === 'dark' ? 'github-dark' : 'github-light',
        // The classes are the theme's own, added to the element Shiki writes: its colours stay, the shape is the page's.
        transformers: [{ pre(node) { this.addClassToHast(node, 'm-0 overflow-x-auto rounded-field p-3 text-sm'); } }],
      }))
      .catch(() => null) // a language the web bundle does not have
      .then(result => { if (current) setHtml(result); });
    return () => { current = false; };
  }, [code, language, theme]);
  return html
    ? <div dangerouslySetInnerHTML={{ __html: html }} />
    : <pre className="m-0 overflow-x-auto rounded-field bg-subtle p-3 font-mono text-sm"><code>{code}</code></pre>;
}

const components = memoizeMarkdownComponents({
  table: props => <Table {...props} />,
  thead: props => <TableHeader {...props} />,
  tbody: props => <TableBody {...props} />,
  tr: props => <TableRow {...props} />,
  th: props => <TableHead {...props} />,
  td: props => <TableCell {...props} />,
  SyntaxHighlighter: CodeBlock,
});

export const MarkdownText = memo(function MarkdownText() {
  return <Prose><MarkdownTextPrimitive remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={components} /></Prose>;
});
