// 读取构建前由 scripts/prepare-content.mjs 汇总的插件清单（来源：plugins/*/plugin.json）。
import data from '../../.generated/plugins.json';

export type Capability = (typeof data.plugins)[number]['capabilities'][number];
export type Plugin = (typeof data.plugins)[number];

export const plugins: Plugin[] = data.plugins;

export function plugin(id: string): Plugin {
  const found = plugins.find((item) => item.id === id);
  if (!found) throw new Error(`找不到插件清单 ${id}，请检查 plugins/${id}/plugin.json`);
  return found;
}

export function manifestUrl(item: Plugin): string {
  return `${data.repository}/blob/${data.ref}/${item.manifest}`;
}

export function sourceUrl(path: string): string {
  return `${data.repository}/blob/${data.ref}/${path}`;
}

const levels: Record<string, string> = {
  'analytic-benchmark': '解析基准核对',
  'reference-benchmark': '参考算例核对',
  'interface-tested': '接口测试',
  unverified: '未经独立验证',
};

export function validationLevel(capability: Capability): string {
  const level = capability.validation?.level ?? 'unverified';
  return levels[level] ?? level;
}

const solvers: Record<string, string> = { local: '本机', slurm: '超算（Slurm）', either: '本机或超算' };

export function solverLabel(capability: Capability): string {
  return solvers[capability.solver] ?? capability.solver;
}
