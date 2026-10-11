import { Link, useSearch } from '@tanstack/react-router';
import { useHpcProfile } from '@/lib/solver-location-query';
import { savedSolverLocation, solverLocation, type SolverCapability } from '@/lib/solver-location';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';

export function SolverLocation({ pluginId, capability, savedRun, prefix = true }: { pluginId: string; capability?: SolverCapability; savedRun?: Record<string, unknown>; prefix?: boolean }) {
  const profile = useHpcProfile(!savedRun);
  const search = useSearch({ strict: false }) as { theme?: string };
  const theme = search.theme === 'dark' ? 'dark' : 'light';
  if (savedRun) {
    const location = savedSolverLocation(savedRun);
    return <span className="solver-location">{prefix && '求解位置：'}{location === 'slurm' ? '超算' : location === 'local' ? '本机' : '执行来源未记录'}</span>;
  }
  if (profile.isError) return <span className="solver-location" role="status">配置读取失败 · <Button variant="ghost" size="compact" onClick={() => void profile.refetch()}>重试</Button></span>;
  if (profile.isPending) return <span className="solver-location muted" role="status">读取配置中</span>;
  if (!capability) return <span className="muted">能力声明未读取</span>;
  const value = solverLocation(pluginId, capability, profile.data);
  return <span className="solver-location" data-conflict={value.conflict || undefined}>
    {prefix && '求解位置：'}{value.location === 'slurm' ? '超算' : '本机'}
    {value.conflict ? <span className="field-error"> · 配置与能力声明冲突</span> : value.location === 'slurm' && <>
      {' · '}{value.configured ? <Tooltip content="连接参数完整且已选中此能力；尚未检查连接"><span tabIndex={0}>已配置</span></Tooltip> : <><span>{profile.data.status === 'invalid' ? '配置无效' : '未配置'}</span> · <Link className="object-link" to="/settings/compute" search={{ theme }}>去设置</Link></>}
    </>}
  </span>;
}
