// 宿主 REST API 静态参考页：直接读取构建时导出的 .generated/openapi.json，按标签分组展示端点与参数。
import spec from '@/.generated/openapi.json';

type OpenApiDoc = {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, Operation>>;
};

type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: { type?: string } }[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: { $ref?: string; title?: string; type?: string } }> };
  responses?: Record<string, { description?: string }>;
};

const METHOD_COLORS: Record<string, string> = {
  get: 'border-emerald-700/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  post: 'border-amber-700/60 bg-amber-500/15 text-amber-900 dark:text-amber-300',
  put: 'border-sky-700/60 bg-sky-500/10 text-sky-900 dark:text-sky-300',
  patch: 'border-sky-700/60 bg-sky-500/10 text-sky-900 dark:text-sky-300',
  delete: 'border-rose-700/60 bg-rose-500/10 text-rose-900 dark:text-rose-300',
};

function schemaLabel(s?: { $ref?: string; title?: string; type?: string }) {
  if (!s) return '';
  if (s.$ref) return s.$ref.split('/').pop() ?? '';
  return s.title ?? s.type ?? '';
}

export function OpenApiReference() {
  const doc = spec as unknown as OpenApiDoc;
  const groups = new Map<string, { method: string; path: string; op: Operation }[]>();
  const methods = ['get', 'post', 'put', 'patch', 'delete'];

  for (const [pathStr, item] of Object.entries(doc.paths ?? {})) {
    for (const m of methods) {
      const op = item[m];
      if (!op) continue;
      const tag = op.tags?.[0] || '通用接口';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push({ method: m, path: pathStr, op });
    }
  }

  return (
    <div className="not-prose my-6 space-y-10">
      <p className="font-mono text-xs text-fd-muted-foreground">
        {doc.info?.title ?? 'CableSimPro Host API'} · 版本 {doc.info?.version ?? '—'} · 共{' '}
        {[...groups.values()].reduce((n, list) => n + list.length, 0)} 个端点
      </p>
      {[...groups.entries()].map(([tag, endpoints]) => (
        <section key={tag} className="space-y-3">
          <h2 className="border-b border-fd-foreground/30 pb-2 font-display text-2xl">{tag}</h2>
          <div className="divide-y divide-fd-foreground/20 border border-fd-foreground/60 bg-fd-card">
            {endpoints.map(({ method, path: p, op }) => {
              const bodySchema = op.requestBody?.content?.['application/json']?.schema;
              const bodyName = schemaLabel(bodySchema);
              return (
                <details key={`${method}-${p}`} className="group px-4 py-3 text-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 list-none">
                    <span
                      className={`inline-block w-16 border px-2 py-0.5 text-center font-mono text-xs font-semibold uppercase ${
                        METHOD_COLORS[method] ?? 'border-fd-foreground/50'
                      }`}
                    >
                      {method}
                    </span>
                    <code className="font-mono text-[13px] font-medium text-fd-foreground">{p}</code>
                    {op.summary && <span className="text-fd-muted-foreground">{op.summary}</span>}
                  </summary>
                  <div className="mt-3 space-y-2 border-t border-fd-foreground/15 pt-3 text-[13px] text-fd-muted-foreground">
                    {op.description && <p className="leading-relaxed text-fd-foreground/85">{op.description}</p>}
                    {op.parameters && op.parameters.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium text-fd-foreground">路径与查询参数</p>
                        <ul className="list-disc space-y-0.5 pl-5">
                          {op.parameters.map((param) => (
                            <li key={`${param.in}-${param.name}`}>
                              <code className="text-fd-foreground">{param.name}</code>（{param.in}
                              {param.schema?.type ? ` · ${param.schema.type}` : ''}
                              {param.required ? ' · 必填' : ''}）
                              {param.description ? `：${param.description}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {bodyName && (
                      <p>
                        <span className="font-medium text-fd-foreground">请求体（JSON）：</span>{' '}
                        <code className="text-fd-foreground">{bodyName}</code>
                      </p>
                    )}
                    {op.responses && (
                      <p>
                        <span className="font-medium text-fd-foreground">响应状态码：</span>{' '}
                        {Object.entries(op.responses)
                          .map(([code, r]) => `${code}${r.description ? `（${r.description}）` : ''}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
