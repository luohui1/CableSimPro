import { optionalRecord, text, numeric, api, responseData, message } from '@/api/client';
import { useMutation } from '@tanstack/react-query';
import { useStudy } from './study-provider';
import { DataTable, type Column } from './data-table';
import { EmptyState } from './states';
import { StudyErrorState as ErrorState } from './study-error-state';
import { savedDomain } from '@/lib/domain-fields';
import { StatusMark } from './status-mark';
import { StudyMethodForm } from './study-method-form';
import { downloadCsv } from '@/lib/download';
import { Button } from './ui/button';
import './study-hybrid.css';

function number(value: unknown, digits = 3) {
  const n = numeric(value);
  return n === null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}
function rows(value: unknown): (Record<string, unknown> & { id: string })[] { return (Array.isArray(value) ? value : []).map(optionalRecord).map((row, index) => ({ ...row, id: text(row.id) || String(index) })); }
const statusNames: Record<string, string> = { available: '可比较', counterfactual: '均匀对照', not_covered: '未覆盖', nonconverged: '未收敛' };

export function StudyPhysicsComparison({ run, tab, readOnly }: { run?: Record<string, unknown>; tab: string; readOnly: boolean }) {
  const context = useStudy();
  const resume = useMutation({ mutationFn: () => responseData(api.POST('/api/workspaces/{wid}/studies/{sid}/runs/{rid}/resume', { params: { path: { wid: context.study.workspace, sid: context.study.id, rid: text(run?.id) } } })), onSuccess: context.refresh, retry: false });
  const cases = rows(optionalRecord(run?.output).cases);
  const result = cases.find(row => optionalRecord(row.artifacts)['x-cablesim.physics-comparison']);
  const payload = optionalRecord(optionalRecord(result?.artifacts)['x-cablesim.physics-comparison']);
  const failed = cases.find(row => ['failed', 'not_applicable'].includes(text(row.status)));
  const failureMessage = text(optionalRecord(failed?.error).message) || text(optionalRecord(run?.error).message);
  const hasResult = Object.keys(payload).length > 0;
  if (run && run.integrity !== 'verified') return <ErrorState title="对比记录不可用" description="运行完整性校验未通过，请重新读取保存记录。" />;
  const methods = rows(payload.methods);
  const columns: Column<typeof methods[number]>[] = [
    { id: 'method', label: '方法', render: row => text(row.name) },
    { id: 'current', label: '允许电流', unit: 'A', numeric: true, render: row => number(row.ampacity_a) },
    { id: 'temperature', label: '导体温度', unit: '°C', numeric: true, render: row => numeric(row.conductor_temperature_k) === null ? '—' : number(Number(row.conductor_temperature_k) - 273.15) },
    { id: 'gap', label: '与IEC电流差', unit: '%', numeric: true, render: row => number(row.ampacity_difference_percent) },
    { id: 'delta-t', label: '温度差', unit: 'K', numeric: true, render: row => number(row.temperature_difference_k) },
    { id: 'status', label: '条件', render: row => <span title={text(row.reason)}>{statusNames[text(row.status)] || text(row.status)}</span> },
  ];
  const levels = rows(payload.mesh_history);
  const losses = rows(payload.losses);
  const convergence = optionalRecord(payload.convergence);
  const snapshot = optionalRecord(run?.snapshot);
  const definition = optionalRecord(snapshot.definition);
  const domain = optionalRecord(readOnly ? optionalRecord(rows(snapshot.cases)[0]).input ?? (run ? savedDomain(run) : undefined) : context.workspace.domain);
  const circuits = rows(domain.circuits);
  const empty = <EmptyState title="尚无标准与物理场对比" description="保存参数后，预检并提交超算求解。" />;
  return <div className="hybrid-study" data-module-state={failureMessage ? 'error' : !hasResult ? 'empty' : readOnly || run?.freshness === 'historical' ? 'historical' : 'success'}>
    <div className="hybrid-toolbar"><h2>标准与物理场对比</h2><StatusMark kind="proposal" label="仅参考" detail="差值不代表真实误差；需独立验证和人工批准。" /></div>
    {failureMessage && <ErrorState title="物理对比未完成" description={failureMessage} action={text(optionalRecord(run?.error).code).startsWith('REMOTE_') || run?.status === 'interrupted' ? <Button loading={resume.isPending} onClick={() => resume.mutate()}>恢复原超算运行</Button> : undefined} />}
    {resume.error && <ErrorState title="恢复未完成" description={message(resume.error)} />}
    {tab === 'inputs' ? <>
      <StudyMethodForm module="method-compare" historical={readOnly} definition={readOnly ? (snapshot.study_definition || snapshot.definition) as Parameters<typeof StudyMethodForm>[0]['definition'] : undefined} />
      <DataTable label="物理对比接地与相序" columns={[{ id: 'circuit', label: '回路', render: row => row.id }, { id: 'bonding', label: '接地方式', render: row => text(optionalRecord(row.bonding).kind) }, { id: 'phase', label: '相序', render: row => text(optionalRecord(row.electrical_topology).phase_sequence) || '未填写' }]} groups={[{ id: 'circuits', label: '回路', rows: circuits }]} rowLabel={row => row.id} showGroups={false} />
    </> : tab === 'evidence' ? hasResult ? <>
      <dl className="physics-evidence">{[['原输入摘要', payload.input_sha256], ['求解输入摘要', payload.prepared_input_sha256], ['参数摘要', payload.parameters_sha256], ['结果摘要', payload.raw_dataset_sha256], ['插件版本', JSON.stringify(definition.method)], ['求解器', JSON.stringify(payload.solver)], ['标准条款', JSON.stringify(optionalRecord(payload.iec).clauses)], ['远场收敛', text(optionalRecord(payload.domain_boundary).far_field_status) === 'not_assessed' ? '未评估' : text(optionalRecord(payload.domain_boundary).far_field_status)]].map(([label, value]) => <div key={String(label)}><dt>{text(label)}</dt><dd>{text(value) || '—'}</dd></div>)}</dl>
      <details><summary>物理范围、解析参照和固定来源</summary><pre>{JSON.stringify({ physics_scope: payload.physics_scope, source: payload.source, layered_reference: payload.layered_reference, domain_boundary: payload.domain_boundary, bonding: payload.bonding }, null, 2)}</pre></details>
    </> : empty : hasResult ? <>
      <DataTable label="标准与物理场结果" columns={columns} groups={[{ id: 'methods', label: '方法', rows: methods }]} rowLabel={row => text(row.name)} showGroups={false} />
      <div className="hybrid-toolbar"><span className="muted">{methods.some(row => row.status === 'counterfactual') ? 'IEC列为均匀土壤对照；实际分层解析参照单独列出。' : '相同保存工况；允许电流与运行温度分开比较。'}</span><span className="spacer" /><Button size="compact" onClick={() => downloadCsv([['方法', '允许电流 / A', '导体温度 / K', '电流差 / %', '温度差 / K', '输入SHA256'], ...methods.map(row => [row.name, row.ampacity_a, row.conductor_temperature_k, row.ampacity_difference_percent, row.temperature_difference_k, payload.input_sha256])], 'physics-comparison.csv')}>导出对比</Button></div>
      <details open><summary>三网格与能量门禁</summary><DataTable label="物理对比三网格" columns={[{ id: 'scale', label: '网格倍率', numeric: true, render: row => number(row.mesh_scale, 2) }, { id: 'nodes', label: '节点', numeric: true, render: row => number(row.nodes, 0) }, { id: 'ampacity', label: '允许电流', unit: 'A', numeric: true, render: row => number(row.ampacity_a) }, { id: 'temperature', label: '最高导体温度', unit: '°C', numeric: true, render: row => number(Number(row.maximum_temperature_k) - 273.15) }, { id: 'energy', label: '能量相对残差', numeric: true, render: row => numeric(row.energy_relative_residual)?.toExponential(2) || '—' }]} groups={[{ id: 'mesh', label: '网格', rows: levels }]} rowLabel={row => text(row.id)} showGroups={false} /><p className="muted">末两网格变化：{number(convergence.ampacity_change_a)} A · {number(convergence.maximum_temperature_change_k)} K</p></details>
      {!!losses.length && <details><summary>运行损耗对比</summary><DataTable label="物理对比运行损耗" columns={[{ id: 'entity', label: '电缆', render: row => text(row.entity) }, ...(['iec_conductor_w_m', 'fem_conductor_w_m', 'iec_sheath_w_m', 'fem_sheath_w_m'] as const).map((key, index) => ({ id: key, label: ['IEC导体', 'FEM导体', 'IEC护套', 'FEM护套'][index], unit: 'W/m', numeric: true, render: (row: typeof losses[number]) => number(row[key]) }))]} groups={[{ id: 'losses', label: '损耗', rows: losses }]} rowLabel={row => text(row.entity)} showGroups={false} /></details>}
    </> : empty}
  </div>;
}
