// 按插件清单逐项列出计算能力：说明、验证等级、适用范围与限制、可调参数。内容全部取自 plugins/*/plugin.json
// （构建前由 scripts/prepare-content.mjs 汇总到 .generated/plugins.json）。
import data from '@/.generated/plugins.json';

// 清单字段因插件而异，这里按最宽松的形状读取
type Parameter = {
  key: string;
  title?: string | null;
  description?: string | null;
  unit?: { display?: string | null } | null;
  minimum?: number | null;
  maximum?: number | null;
  required?: boolean;
};

const levels: Record<string, string> = {
  'analytic-benchmark': '解析基准核对',
  'reference-benchmark': '参考算例核对',
  'interface-tested': '接口测试',
  unverified: '未经独立验证',
};
const solvers: Record<string, string> = { local: '本机', slurm: '超算（Slurm）', either: '本机或超算' };
const sourceUrl = (path: string) => `${data.repository}/blob/${data.ref}/${path}`;

function range(p: Parameter) {
  const lo = p.minimum ?? null;
  const hi = p.maximum ?? null;
  if (lo != null && hi != null) return `${lo} – ${hi}`;
  if (lo != null) return `≥ ${lo}`;
  if (hi != null) return `≤ ${hi}`;
  return '—';
}

export function PluginMethods({ id, only }: { id: string; only?: string[] }) {
  const plugin = data.plugins.find((item) => item.id === id);
  if (!plugin) throw new Error(`找不到插件清单 ${id}`);
  const capabilities = plugin.capabilities.filter((c) => !only || only.includes(c.id));
  return (
    <div className="not-prose my-6 flex flex-col gap-4">
      <p className="text-sm text-fd-muted-foreground">
        以下内容取自插件清单{' '}
        <a className="font-medium text-fd-foreground underline underline-offset-4" href={sourceUrl(plugin.manifest)}>
          {plugin.manifest}
        </a>
        （{plugin.name}，版本 {plugin.version}）。
      </p>
      {capabilities.map((c) => (
        <section key={c.id} className="rounded-xl border bg-fd-card p-5 text-sm shadow-xs">
          <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold">{c.title}</h3>
            <span className="text-fd-muted-foreground">
              {c.id} · 方法版本 {c.method_version}
            </span>
          </header>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-fd-secondary px-2.5 py-0.5 text-xs font-medium">
              {levels[c.validation.level] ?? c.validation.level}
            </span>
            <span className="rounded-full bg-fd-secondary px-2.5 py-0.5 text-xs font-medium">
              {solvers[c.solver] ?? c.solver}
            </span>
          </div>
          {c.description && <p className="mb-4 leading-7">{c.description}</p>}
          {c.limitations.length > 0 && (
            <>
              <h4 className="mb-2 font-medium">适用范围与限制</h4>
              <ul className="mb-4 list-disc space-y-1.5 pl-5 leading-7 text-fd-muted-foreground">
                {c.limitations.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </>
          )}
          {c.validation.cases.length > 0 && (
            <details className="group mb-3">
              <summary className="cursor-pointer font-medium">验证用例（{c.validation.cases.length}）</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 leading-7 text-fd-muted-foreground">
                {c.validation.cases.map((entry) => (
                  <li key={entry.text}>
                    {entry.path ? (
                      <a className="underline underline-offset-4" href={sourceUrl(entry.path)}>
                        {entry.text}
                      </a>
                    ) : (
                      entry.text
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {(c.parameters as Parameter[]).length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">方法参数（{c.parameters.length}）</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-fd-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-4 font-medium">参数</th>
                      <th className="py-2 pr-4 font-medium">单位</th>
                      <th className="py-2 pr-4 font-medium">范围</th>
                      <th className="py-2 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(c.parameters as Parameter[]).map((p) => (
                      <tr key={p.key} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-4">
                          {p.title ?? p.key}
                          {p.required && <span className="text-fd-muted-foreground">（必填）</span>}
                        </td>
                        <td className="py-2 pr-4">{p.unit?.display && p.unit.display !== '1' ? p.unit.display : '—'}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{range(p)}</td>
                        <td className="py-2 text-fd-muted-foreground">{p.description ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
