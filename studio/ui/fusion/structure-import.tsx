// Saved import facts only. Disclosure folds presentation; it never removes fields, source rows, units or failure states.
import type { CardRef } from '@shared/types';
import type { StructurePreviewRow } from '@shared/fusion-types';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CardAction, CardFrame } from '@/kit/chat/cards';
import { Disclosure } from '@/kit/disclosure';
import { useOpen } from './open';

const PREVIEW_STATUS: Record<string, string> = { ready: '可保存 · 待核对', incomplete: '缺项草稿', error: '错误行' };
const CHECK_STATUS: Record<string, string> = { succeeded: '运行已完成', completed: '运行已完成', partial: '部分完成', failed: '失败', running: '仍在运行 · 未完成', interrupted: '已中断 · 未完成' };
const text = (value: unknown): string => value === null || value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
const typeHref = (workspace: string) => `cablesim:type/${encodeURIComponent(workspace)}`;

function SavedDetails({ value }: { value: unknown }) {
  return <pre className="m-0 whitespace-pre-wrap break-all p-3 text-xs text-ink-2">{JSON.stringify(value, null, 2)}</pre>;
}

function Source({ value }: { value: Record<string, unknown> }) {
  const location = [value.file, value.sheet, value.row === undefined ? undefined : `第 ${value.row} 行`, value.column === undefined || value.column === null ? undefined : `${value.column} 列`]
    .filter(item => item !== undefined && item !== null && item !== '').map(text).join(' · ');
  return <>
    <span className="block break-words text-xs text-ink-2">{location || '此字段未声明文件位置'}</span>
    <span className="block text-xs text-ink-2">{value.reviewed === true ? '来源已核对' : '来源待核对'}</span>
  </>;
}

function PreviewRow({ row }: { row: StructurePreviewRow }) {
  return <div data-structure-row={row.row_number}>
    <Disclosure title={`第 ${row.row_number} 行 · ${row.name}`} aside={<Badge variant="outline">{PREVIEW_STATUS[row.status] ?? row.status}</Badge>}>
      <div className="space-y-3 px-3 pb-3">
        <p className="m-0 text-sm text-ink-2">缺项：{row.missing.length ? row.missing.join('；') : '无保存缺项'}</p>
        {row.issues.length > 0 && <ul className="m-0 list-disc pl-4 text-sm text-attention-ink">{row.issues.map((issue, index) => <li key={index}>
          {issue.column !== undefined && issue.column !== '' ? `${issue.column} 列 · ` : ''}{issue.field ? `${issue.field}：` : ''}{issue.message}
        </li>)}</ul>}
        <Table>
          <TableHeader><TableRow><TableHead>原字段</TableHead><TableHead numeric>原表值与单位</TableHead><TableHead>来源</TableHead></TableRow></TableHeader>
          <TableBody>{row.values.map((fact, index) => <TableRow key={`${fact.key}/${index}`} data-structure-field={fact.key}>
            <TableCell className="whitespace-normal">{fact.label}</TableCell>
            <TableCell numeric className="whitespace-normal">
              <span>{text(fact.display_value === undefined ? fact.value : fact.display_value)} {fact.display_unit ?? fact.unit}</span>
              {fact.display_unit && fact.display_unit !== fact.unit && <span className="mt-1 block text-xs text-ink-2">保存值 {text(fact.value)} {fact.unit}</span>}
            </TableCell>
            <TableCell className="max-w-xs whitespace-normal"><Source value={fact.source} /></TableCell>
          </TableRow>)}</TableBody>
        </Table>
        <Disclosure title="完整字段来源与建模记录">
          <SavedDetails value={{ values: row.values, missing: row.missing, issues: row.issues, warnings: row.warnings ?? [], derivation: row.derivation, closure: row.closure }} />
        </Disclosure>
      </div>
    </Disclosure>
  </div>;
}

export function SavedStructurePreview({ card }: { card: Extract<CardRef, { kind: 'structure_preview' }> }) {
  const { view } = card;
  return <CardFrame icon="result/table" title="结构表保存预览" data-card="structure-preview">
    <p className="m-0 break-words text-sm text-ink">{view.file}</p>
    <dl className="my-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {([['规格行', view.row_count], ['可保存行', view.valid_count], ['错误行', view.error_count], ['缺项行', view.incomplete_count]] as const).map(([label, value]) => <div key={label}>
        <dt className="text-ink-2">{label}</dt><dd className="m-0 font-medium tabular-nums text-ink">{value}</dd>
      </div>)}
    </dl>
    <p className="mb-3 mt-0 text-sm text-ink-2">预览尚未创建型号。可保存行包含缺项草稿，不代表结构完整、标准符合或工程批准。</p>
    <div className="-mx-3">{view.rows.map(row => <PreviewRow key={row.row_number} row={row} />)}</div>
    {!view.complete && <p className="mb-0 mt-3 text-sm text-attention-ink">此卡只含已完整读取的 {view.rows.length} 行，保存预览共 {view.row_count} 行；其余行、来源与跳过记录须按保存摘要继续读取后再审阅。</p>}
    {view.skipped.length > 0 && <Disclosure title={`跳过记录 · ${view.skipped.length} 项`}><SavedDetails value={view.skipped} /></Disclosure>}
    <Disclosure title="来源与列映射">
      <SavedDetails value={{ file: view.file, sha256: view.sha256, preview_digest: view.preview_digest,
        sheet: view.sheet, first_data_row: view.first_data_row, series: view.series, mapping: view.mapping, method: view.method }} />
    </Disclosure>
  </CardFrame>;
}

export function SavedStructureImport({ card }: { card: Extract<CardRef, { kind: 'structure_import' }> }) {
  const open = useOpen();
  const { view } = card;
  return <CardFrame icon="resource/cable-type" title={`已保存 ${view.created} 个型号草稿`} data-card="structure-import">
    <p className="mb-3 mt-0 text-sm text-ink-2">来源与缺项随草稿保存；没有审核或发布型号，核对需要另行接受。</p>
    <ul className="m-0 list-none space-y-2 p-0">{view.specs.map(spec => <li key={spec.id} data-structure-spec={spec.id}>
      <CardAction icon="action/external" onClick={() => open(typeHref(spec.workspace_id))}>在工作台打开 · {spec.name}</CardAction>
      <p className="mb-0 mt-1 text-xs text-ink-2">第 {spec.version} 版 · {spec.state === 'draft' ? '草稿' : spec.state}</p>
    </li>)}</ul>
    <p className="mb-0 mt-3 text-sm text-ink-2">{view.skipped_rows.length ? `明确跳过原表第 ${view.skipped_rows.join('、')} 行。` : '未跳过错误行。'}</p>
    <Disclosure title="保存版本与来源摘要"><SavedDetails value={view} /></Disclosure>
  </CardFrame>;
}

export function SavedStructureCheck({ card }: { card: Extract<CardRef, { kind: 'structure_check' }> }) {
  const open = useOpen();
  const { view } = card;
  return <CardFrame icon="resource/cable-type" title={`批量核对 · ${CHECK_STATUS[view.status] ?? view.status}`} data-card="structure-check">
    {['running', 'interrupted'].includes(view.status) && <p className="mb-3 mt-0 text-sm text-attention-ink">这次批量核对尚未完成。下列项目是已经保存的记录，未列出的规格不能判定为成功；不会自动重新运行。</p>}
    <p className="mb-3 mt-0 text-sm text-ink-2">以下为平台保存的逐项运行状态。运行完成、标准符合与人工批准分别判断；没有自动审核或发布。</p>
    {view.items.map(item => <div key={item.spec_id} data-check-spec={item.spec_id} className="border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-ink">{item.name}</span><Badge variant="outline">{CHECK_STATUS[item.status] ?? item.status}</Badge></div>
      {item.message && <p className="mb-0 mt-2 break-words text-sm text-ink-2">{item.message}</p>}
      {item.method_name && <p className="mb-0 mt-1 text-xs text-ink-2">{item.method_name} {item.method_version}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {item.workspace_id && <CardAction icon="action/external" onClick={() => open(typeHref(item.workspace_id!))}>在工作台打开 · {item.name}</CardAction>}
        {item.workspace_id && item.study_id && item.run_id && <CardAction icon="action/external" onClick={() => open(`cablesim:study/${encodeURIComponent(item.study_id!)}?workspace=${encodeURIComponent(item.workspace_id!)}&run=${encodeURIComponent(item.run_id!)}`)}>查看保存核对 · {item.name}</CardAction>}
      </div>
      <Disclosure title={`完整核对记录 · ${item.name}`}><SavedDetails value={item} /></Disclosure>
    </div>)}
    {!view.complete && <p className="mb-0 mt-3 text-sm text-attention-ink">此卡只含已读取的 {view.items.length} 项，共 {view.total} 项；未读取项不能判定为成功。</p>}
  </CardFrame>;
}
