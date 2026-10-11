/** 能力求解位置与进程隔离策略无关。仅在配置读取成功后调用。 */
export type SolverCapability = { id: string; solver?: 'local' | 'slurm' | 'either' };
export type HpcProfile = {
  configured: boolean;
  status: 'configured' | 'not_configured' | 'invalid';
  connection_checked: boolean;
  remote_plugins: string[];
  remote_capabilities: Record<string, string[]>;
  configuration_file: string | null;
  configuration_note: string;
};
export function solverLocation(pluginId: string, capability: SolverCapability, profile: HpcProfile) {
  const solver = capability.solver ?? 'local';
  const selected = profile.remote_plugins.includes(pluginId)
    || (profile.remote_capabilities[pluginId] ?? []).includes(capability.id);
  const location = solver === 'slurm' || (solver === 'either' && selected) ? 'slurm' : 'local';
  return { location, selected, configured: location === 'local' || (profile.configured && selected), conflict: solver === 'local' && selected } as const;
}
/** 历史只读运行只能从封存环境判定；缺证据明确未知，不能借当前清单补造。 */
export function savedSolverLocation(run: Record<string, unknown>): 'local' | 'slurm' | 'unknown' {
  const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = asRecord(run.output ?? run.result);
  const environment = asRecord(result.environment ?? run.environment);
  if (asRecord(environment.remote_execution).backend === 'slurm') return 'slurm';
  if (Object.keys(environment).length) return 'local';
  return 'unknown';
}
