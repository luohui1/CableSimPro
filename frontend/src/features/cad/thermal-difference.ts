import type { CadThermal } from './types';
import { regularDifferenceMesh } from './regular-field';

export function differenceField(fem: CadThermal, iec: CadThermal, resolution = 192): CadThermal {
  if (fem.kind !== 'fem' || iec.kind !== 'iec') throw Error('差值需要有限元和 IEC 两侧保存温度场。');
  const { points, triangles, quads, values, nx, nz } = regularDifferenceMesh(fem, iec, resolution);
  const conductors = fem.conductors.flatMap(c => {
    const other = iec.conductors.find(v => v.id === c.id && v.coreId === c.coreId);
    return other ? [{ ...c, value: c.value - other.value, hottest: false }] : [];
  });
  const hottest = conductors.reduce<typeof conductors[number] | undefined>((a, b) => !a || Math.abs(b.value) > Math.abs(a.value) ? b : a, undefined);
  if (hottest) hottest.hottest = true;
  let maximum = Math.max(...conductors.map(c => Math.abs(c.value)), 1e-6);
  for (const t of triangles) for (const i of t) maximum = Math.max(maximum, Math.abs(values[i]));
  return { runId: fem.runId, runLabel: fem.runLabel, caseId: fem.caseId, kind: 'difference', notice: fem.notice,
    source: `有限元 − IEC；两侧保存节点线性插值到同一 ${nx}×${nz} 规则网格，格内双线性显示；边界交叉单元留空 · ${fem.source} · ${iec.source}`,
    references: [fem, iec].map(({ runId, caseId, source, runLabel }) => ({ runId, caseId, source, label: runLabel })), points, triangles, quads, values, conductors, minimum: -maximum, maximum };
}
