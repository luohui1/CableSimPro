// 全部插件及其计算能力一览，构建时直接读取 .generated/plugins.json（源自 plugins/*/plugin.json）。
import data from '@/.generated/plugins.json';

const levels: Record<string, string> = {
  'analytic-benchmark': '解析基准核对',
  'reference-benchmark': '参考算例核对',
  'interface-tested': '接口测试',
  unverified: '未经独立验证',
};

const solvers: Record<string, string> = {
  local: '本机',
  slurm: '超算（Slurm）',
  either: '本机或超算',
};

export function PluginCatalog() {
  const sourceUrl = (p: string) => `${data.repository}/blob/${data.ref}/${p}`;
  return (
    <div className="space-y-10">
      {data.plugins.map((item) => (
        <section key={item.id} className="scroll-mt-24">
          <h2 id={item.id}>{item.name}</h2>
          <p className="text-sm text-fd-muted-foreground">
            <code>{item.id}</code> · 版本 {item.version} · 清单{' '}
            <a href={sourceUrl(item.manifest)}>{item.manifest}</a>
          </p>
          {item.description && <p>{item.description}</p>}
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>能力</th>
                  <th>方法版本</th>
                  <th>验证等级</th>
                  <th>求解位置</th>
                </tr>
              </thead>
              <tbody>
                {item.capabilities.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="font-medium text-fd-foreground">{c.title}</span>
                      <br />
                      <code>{c.id}</code>
                    </td>
                    <td>{c.method_version ?? '—'}</td>
                    <td>{levels[c.validation.level] ?? c.validation.level}</td>
                    <td>{solvers[c.solver] ?? c.solver}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
