import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/states';
import { pointer } from '@/lib/domain-fields';
import { layerNames, targetId } from '@/features/drawing/cable-geometry';
import type { CableType, LayerTarget } from '@/features/drawing/types';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';

/** Keep the exact diagnostic for traceability; use engineering names on the work surface. */
export function structureIssue(cable: CableType, diagnostic: string) {
  const coreIndex = cable.cores.findIndex(core => diagnostic.includes('cores.' + core.id + '：')
    || diagnostic.includes('cores.' + core.id + '.') || diagnostic.includes('cores.' + core.id + ':'));
  const core = cable.cores[coreIndex];
  const role = core ? /\.layers\.([\w-]+)/.exec(diagnostic)?.[1] || 'conductor'
    : /common_layers\.([\w-]+)/.exec(diagnostic)?.[1];
  const target: LayerTarget | null = core ? { scope: 'core', coreId: core.id, role: role! }
    : role ? { scope: 'common', role } : null;
  const label = core ? `芯 ${coreIndex + 1}` + (diagnostic.includes('.layers.') || diagnostic.includes('.conductor.') ? ' · ' + (layerNames[role!] || '结构层') : '')
    : role ? layerNames[role] || '共同层' : '电缆结构';
  const detail = diagnostic.includes('：') ? diagnostic.slice(diagnostic.indexOf('：') + 1) : diagnostic;
  const readable = /[\u4e00-\u9fff]/.test(detail) && !/cores\.|common_layers\.|cable_type\/|material\//.test(detail)
    ? detail : '请核对导体尺寸、层厚和芯位置，再更新截面。';
  const coordinate = !!core && /芯坐标|芯位置|重叠/.test(diagnostic);
  const field = coordinate ? 'x' : /\.inner_diameter/.test(diagnostic) ? 'inner_diameter' : role === 'conductor' ? 'diameter' : 'thickness';
  const root = pointer('cable_types', cable.id);
  const path = core ? coordinate ? root + pointer('cores', core.id, field)
    : root + pointer('cores', core.id, ...(role === 'conductor' ? ['conductor'] : ['layers', role!]), field)
    : role ? root + pointer('common_layers', role, field) : '';
  return { message: label + '：' + readable, target, path, action: '定位' + label + (coordinate ? '位置' : '尺寸') };
}

export function StructureIssue({ cable, diagnostic }: { cable: CableType; diagnostic: string }) {
  const state = useTypeWorkspace(), { location, navigate } = useTypeNavigation();
  const issue = structureIssue(cable, diagnostic);
  return <div className="type-structure-issue" data-geometry-problem role="alert">
    <ErrorState title="截面暂不可绘制" description={issue.message} action={<>
      {issue.target && <Button size="compact" onClick={() => navigate(typePath(state.workspace!.id, 'structure', 'table', location.theme)
        + '&layer=' + encodeURIComponent(targetId(issue.target!)) + '&field=' + encodeURIComponent(issue.path))}>{issue.action}</Button>}
      {state.canUndo && <Button size="compact" onClick={() => void state.undo()}>撤销上一步修改</Button>}
    </>} />
    <details><summary>诊断详情</summary><p>{diagnostic}</p></details>
  </div>;
}
