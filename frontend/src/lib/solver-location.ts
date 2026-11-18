/** 能力求解位置与进程隔离策略无关。仅在配置读取成功后调用。 */
export type SolverCapability = { id: string; solver?: 'local' | 'slurm' | 'either' };
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Lists must read the saved method's capability, not an installed replacement
 * or its process isolation policy. Missing declarations remain unknown. */
export function pinnedSolverCapability(method: unknown, catalog: readonly Record<string, unknown>[]): (SolverCapability & { analysis?: string }) | undefined {
  const pin = asRecord(method);
  const identity = ['plugin_id', 'version', 'release_digest'] as const;
  if (!identity.every(key => typeof pin[key] === 'string' && pin[key]) || typeof pin.capability !== 'string') return undefined;
  const plugin = catalog.find(row => identity.every(key => asRecord(row.method)[key] === pin[key]));
  const capability = (Array.isArray(plugin?.capabilities) ? plugin.capabilities : []).map(asRecord).find(row => row.id === pin.capability);
  if (!capability) return undefined;
  const solver = capability.solver;
  if (solver !== undefined && solver !== 'local' && solver !== 'slurm' && solver !== 'either') return undefined;
  return { id: pin.capability, solver, analysis: typeof capability.analysis === 'string' ? capability.analysis : undefined };
}
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
  const result = asRecord(run.output ?? run.result);
  const environment = asRecord(result.environment ?? run.environment);
  if (asRecord(environment.remote_execution).backend === 'slurm') return 'slurm';
  if (Object.keys(environment).length) return 'local';
  return 'unknown';
}
