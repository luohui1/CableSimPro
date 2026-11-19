// 展示 docs/plugins/examples/ 中的声明式插件原件，构建时读取 .generated/examples.json。
import examples from '@/.generated/examples.json';

export function ExampleCode({ name }: { name: string; lang?: string }) {
  const found = examples.find((item) => item.path.endsWith(name));
  if (!found) throw new Error(`找不到示例文件 ${name}`);
  return (
    <figure className="not-prose my-5 overflow-hidden border border-fd-foreground/60 bg-fd-card">
      <figcaption className="border-b border-fd-foreground/40 bg-fd-background px-3.5 py-1.5 font-mono text-xs text-fd-muted-foreground">
        {found.path}
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-fd-foreground">
        <code>{found.content}</code>
      </pre>
    </figure>
  );
}
