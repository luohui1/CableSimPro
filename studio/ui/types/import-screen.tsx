// Importing a structure table: the file, the sheet, which column is which field, the declaration of what the table leaves out,
// and a preview of every row before anything enters the library. Each sheet becomes one series, every size a first draft.
// The declaration comes before the preview, since the host builds each row's dimensions from it: without it there is nothing
// to preview. The work in progress is kept, so a closed tab does not lose it.
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { fixed } from '@shared/format';
import type { ImportPreview, SeriesDeclaration, TableColumn, TableInspection } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Icon, Spinner } from '@/kit/icon';
import { Metric, MetricGroup } from '@/kit/metric';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { FlowLayout, Stepper, type FlowStep } from '@/kit/workbench/flow';
import { ChoiceCards, DropZone, FormNote, FormRow, FormSection, TABLE_FILES, UnitInput } from '@/kit/workbench/form';
import { PageHeader } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { queryClient, useVocabulary } from '@/state/queries';
import { CommonSizes, EMPTY_DECLARATION, lacking, Pick, SeriesFields } from './forms';
import { TypeFrame } from './frame';
import { PLACED, readable } from './model';

const STEPS = ['上传文件', '选工作表', '列对应', '系列声明', '预览与导入'];
const KEPT = 'studio.import-draft';

interface Draft {
  step: number; upload: string; file: string; inspection: TableInspection | null; sheet: string; first: number;
  mapping: Record<string, number>; declaration: SeriesDeclaration; samples: { sheet: string; series: SeriesDeclaration }[]; mappingName: string;
}
const initial = (): Draft => ({ step: 0, upload: '', file: '', inspection: null, sheet: '', first: 1, mapping: {}, declaration: EMPTY_DECLARATION, samples: [], mappingName: '' });
function kept(): Draft {
  try { return JSON.parse(localStorage.getItem(KEPT) ?? 'null') ?? initial(); } catch { return initial(); }
}

/** A confirmation the person has to give: the box checked means given. */
function Confirm({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return <label className="flex items-start gap-3 text-sm text-ink"><Checkbox className="mt-1" checked={checked} onCheckedChange={onChange} />{children}</label>;
}

type PreviewRow = ImportPreview['rows'][number];
const PREVIEW_COLUMNS: Column<PreviewRow>[] = [
  { key: 'row', header: '表中行', numeric: true, width: 'w-20', cell: row => row.source_row },
  { key: 'key', header: '规格', width: 'w-28', cell: row => <span className="font-medium">{row.key ?? '无法生成'}</span> },
  { key: 'od', header: '表列外径', unit: 'mm', numeric: true, width: 'w-28', cell: row => fixed(row.outer_diameter_mm, 1) },
  { key: 'listed', header: '各层合计', unit: 'mm', numeric: true, width: 'w-28', cell: row => fixed(row.closure?.listed_mm, 2) },
  { key: 'residual', header: '余量（单边）', unit: 'mm', numeric: true, width: 'w-32', cell: row => fixed(row.closure?.residual_mm, 2) },
  { key: 'state', header: '状态', width: 'w-32', cell: row => !row.ok ? <Badge variant="error"><Icon name="status/error" data-icon="inline-start" />不能导入</Badge>
    : row.warnings.length ? <Badge variant="attention"><Icon name="status/warning" data-icon="inline-start" />可导入</Badge>
      : <Badge variant="success"><Icon name="action/check" data-icon="inline-start" />可导入</Badge> },
  { key: 'note', header: '说明', cell: row => row.error ? <span className="whitespace-normal text-error">{row.error.message}</span>
    : row.warnings.length ? <span className="flex flex-col whitespace-normal">{row.warnings.map(item => <span key={item.code} className="text-ink">{item.message}</span>)}</span> : <span className="text-ink-2">—</span> },
];

export function ImportScreen() {
  const navigate = useNavigate();
  const vocabulary = useVocabulary();
  const [draft, setDraft] = useState<Draft>(kept);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [skipFailed, setSkipFailed] = useState(false);
  const [committed, setCommitted] = useState<{ series: string; imported: number; left_out: number } | null>(null);
  const sheet = draft.inspection?.sheets.find(item => item.name === draft.sheet);
  const fields = vocabulary.data?.fields ?? [];
  useEffect(() => { try { localStorage.setItem(KEPT, JSON.stringify({ ...draft, step: Math.min(draft.step, 3) })); } catch { /* private browsing */ } }, [draft]);
  const update = (values: Partial<Draft>) => { setDraft(current => ({ ...current, ...values })); setError(''); };
  const declare = (declaration: SeriesDeclaration) => { update({ declaration }); setConfirmed(false); };
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }
  async function inspect(upload: string, file: string, samples: Draft['samples']) {
    const declaration = samples[0]?.series ?? { ...EMPTY_DECLARATION, name: file.replace(/\.[^.]+$/, '') };
    const result = await api.op<TableInspection>('library.import.inspect', { upload, ...(declaration.designation ? { designation: declaration.designation } : {}) });
    const selected = result.sheets.find(item => item.table) ?? result.sheets[0];
    setDraft({ ...initial(), upload, file, samples, inspection: result, declaration, sheet: selected?.name ?? '', first: selected?.first_data_row ?? 1, step: 1 });
    setCommitted(null); setConfirmed(false); setPreview(null);
  }
  async function chooseSheet() {
    const declaration = draft.samples.find(item => item.sheet === draft.sheet)?.series ?? draft.declaration;
    const result = await api.op<TableInspection>('library.import.inspect', { upload: draft.upload, ...(declaration.designation ? { designation: declaration.designation } : {}) });
    const selected = result.sheets.find(item => item.name === draft.sheet);
    update({ inspection: result, declaration, first: selected?.first_data_row ?? draft.first,
      mapping: Object.fromEntries(selected?.columns?.filter(item => item.suggested).map(item => [item.suggested!, item.index]) ?? []), step: 2 });
    setConfirmed(false);
  }
  function upload(file: File) {
    if (busy) return;
    update({ file: file.name });
    void run(async () => {
      const reply = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
      const result = await reply.json();
      if (!reply.ok) throw new Error(result.error?.message ?? '上传失败。');
      await inspect(result.upload, result.file, []);
    });
  }
  const tableParams = () => ({ upload: draft.upload, sheet: draft.sheet, first_data_row: draft.first, mapping: draft.mapping, series: draft.declaration });
  const missingBasis = lacking(draft.declaration, vocabulary.data);
  const restart = () => { update(initial()); setPreview(null); setCommitted(null); setConfirmed(false); };
  const declared = draft.declaration;
  // What the host cannot do without, in the words of the form, so a button that waits says what it waits for.
  const undeclared = [!declared.name.trim() && '系列名称', !declared.designation.trim() && '型号', !(declared.u0_v > 0) && '额定相电压', !(declared.u_v > 0) && '额定线电压',
    declared.standards.length === 0 && '执行标准（写好后点“添加”）'].filter(Boolean) as string[];
  const declarable = undeclared.length === 0;

  const mappingColumns: Column<TableColumn>[] = [
    { key: 'letter', header: '列', width: 'w-12', cell: column => <span className="font-medium">{column.letter}</span> },
    { key: 'header', header: '表头', cell: column => <span className={Object.values(draft.mapping).includes(column.index) ? 'text-ink' : 'text-ink-2'}>{column.header}</span> },
    { key: 'sample', header: '前三行', width: 'w-40', cell: column => <span className="block truncate text-ink-2 tabular-nums">{column.sample.slice(0, 3).join('，') || '—'}</span> },
    { key: 'field', header: '对应到', width: 'w-60', cell: column => <Pick size="sm" label={`${column.letter} 列对应到`} value={Object.entries(draft.mapping).find(([, index]) => index === column.index)?.[0] ?? ''}
      options={[...fields.map(field => ({ value: field.key, label: `${field.label}（${field.unit}）` })), { value: '', label: '不导入' }]}
      onValueChange={value => {
        const mapping = Object.fromEntries(Object.entries(draft.mapping).filter(([key, index]) => index !== column.index && key !== value));
        if (value) mapping[value] = column.index;
        update({ mapping });
      }} /> },
  ];

  let body: ReactNode;
  if (committed) {
    body = <EmptyState icon="action/check" title={`已导入 ${committed.imported} 个规格`}
      description={`每个规格保存为第 1 版草稿，原始文件、系列声明和逐项来源已保留。${committed.left_out ? `跳过 ${committed.left_out} 行。` : ''}`} />;
  } else if (draft.step === 0) {
    body = <div className="flex max-w-3xl flex-col gap-10">
      <FormSection title="上传结构表" description="读取每张工作表的表头、数据起始行和各列建议对应的字段。">
        <DropZone title="把结构表拖到这里" formats={busy ? '正在读取文件…' : draft.file || '支持 .xlsx、.xls、.csv 和 .tsv 的结构表'} accept={{ ...TABLE_FILES, 'text/tab-separated-values': ['.tsv'] }}
          onFiles={files => upload(files[0])} onRejected={names => setError(`不能读“${names.join('、')}”：结构表是 .xlsx、.xls、.csv 或 .tsv 文件。`)} />
      </FormSection>
      <FormSection title="手边没有结构表" description="用一份公开厂家手册（人民电缆 8.7/15 kV 结构表）试导入，它附带每张表所需的系列声明。">
        <div><Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const sample = await api.op<{ upload: string; file: string; declarations: Draft['samples'] }>('library.import.sample', {});
          await inspect(sample.upload, sample.file, sample.declarations);
        })}>{busy ? <Spinner /> : <Icon name="object/file" data-icon="inline-start" />}用公开样例</Button></div>
      </FormSection>
    </div>;
  } else if (draft.step === 1) {
    body = <div className="flex max-w-3xl flex-col gap-6">
      <FormSection title="选一张工作表" description="一张工作表导入为一个新系列。">
        <ChoiceCards label="工作表" columns="grid-cols-2" value={draft.sheet} onValueChange={value => update({ sheet: value })}
          options={(draft.inspection?.sheets ?? []).map(item => ({ value: item.name, title: item.name, icon: 'result/table',
            detail: item.table ? `表头第 ${(item.header_rows ?? []).join('–')} 行，第 ${item.first_data_row} 行起 ${item.data_rows} 行数据` : `${item.rows} 行，没有认出表头` }))} />
        {sheet?.title && <FormNote title="表名">{sheet.title}</FormNote>}
      </FormSection>
    </div>;
  } else if (draft.step === 2) {
    body = <div className="flex max-w-4xl flex-col gap-6">
      <FormSection title="把列对上字段" description={`${draft.sheet}：${sheet?.table ? `表头第 ${(sheet.header_rows ?? []).join('–')} 行，第 ${sheet.first_data_row} 行起 ${sheet.data_rows} 行数据。` : ''}下拉里是建议的对应，不对就改。`}>
        {draft.mapping.area === undefined && <FormNote tone="attention" title="请先对应标称截面列">每个规格由它的标称截面认出，没有这一列就不能导入。</FormNote>}
        {sheet?.columns && <DataTable framed rows={sheet.columns} rowKey={column => String(column.index)} columns={mappingColumns} />}
        <FormRow label="数据起始行" htmlFor="first-row" wide><UnitInput id="first-row" aria-label="数据起始行" unit="行" step={1} min={1} className="w-48" value={draft.first} onValueChange={next => update({ first: next ?? 0 })} /></FormRow>
        <FormRow label="复用已存的对应" wide><Pick label="复用列对应" value="" onValueChange={value => { const saved = vocabulary.data?.mappings.find(item => item.name === value); if (saved) update({ mapping: saved.mapping, mappingName: saved.name }); }}
          options={[{ value: '', label: '选择已保存的对应关系' }, ...(vocabulary.data?.mappings.map(item => ({ value: item.name, label: item.name })) ?? [])]} /></FormRow>
        <FormRow label="存为常用对应" htmlFor="mapping-name" wide hint="可选；导入时保存，以后同样的表可以直接复用。">
          <Input id="mapping-name" aria-label="列对应名称" maxLength={60} value={draft.mappingName} onChange={event => update({ mappingName: event.target.value })} />
        </FormRow>
      </FormSection>
    </div>;
  } else if (draft.step === 3) {
    body = <div className="flex max-w-3xl flex-col gap-10">
      <FormSection title="系列" description={`导入为一个新系列，每行成为一个规格的第 1 版草稿。来源：${draft.file}${draft.sheet ? ` · 工作表“${draft.sheet}”` : ''}。`}>
        <SeriesFields value={declared} onChange={declare} idPrefix="declare" />
      </FormSection>
      <CommonSizes value={declared} onChange={declare} vocabulary={vocabulary.data} taken={new Set(Object.keys(draft.mapping))} />
      <div className="flex flex-col gap-3">
        <Confirm checked={confirmed} onChange={setConfirmed}>我已核对系列声明、缺失尺寸及计算参数的来源。</Confirm>
        {undeclared.length > 0 && <FormNote tone="attention" title="系列声明还缺">{undeclared.join('、')}</FormNote>}
        {missingBasis.length > 0 && <FormNote tone="attention" title="请补充取值依据">{missingBasis.join('、')}</FormNote>}
      </div>
    </div>;
  } else if (preview) {
    const placed = [...new Set(preview.rows.map(row => row.closure?.placed_in).filter(Boolean))].map(key => PLACED[key!] ?? key).join('、');
    const note = readable(preview.rows.find(row => row.ok && row.derivation)?.derivation?.note ?? '');
    body = <div className="flex max-w-4xl flex-col gap-6">
      <FormSection title="每一行生成的规格" description="按系列声明和列对应生成，还没有保存。">
        <MetricGroup>
          <Metric size="md" label="可导入" value={preview.ready} unit="行" />
          <Metric size="md" label="不能导入" value={preview.failed} unit="行" tone={preview.failed > 0 ? 'error' : undefined} />
          <Metric size="md" label="不是数据，跳过" value={preview.skipped.length} unit="行" />
        </MetricGroup>
        <DataTable framed rows={preview.rows} rowKey={row => String(row.source_row)} columns={PREVIEW_COLUMNS} />
        {preview.skipped.map(item => <FormNote key={item.row} title={`第 ${item.row} 行不导入`}>{item.text}</FormNote>)}
        {(note || placed) && <FormNote title="尺寸怎么来的">{note}{placed && ` 表列外径比各层合计多出的部分计入${placed}。`}</FormNote>}
        {preview.designation.description && <FormNote title={`型号 ${preview.designation.model || draft.declaration.designation} 的意思`}>{preview.designation.description}</FormNote>}
        {preview.failed > 0 && <Confirm checked={skipFailed} onChange={setSkipFailed}>明确跳过失败行，仅导入 {preview.ready} 个可用规格；失败行须回原表更正。</Confirm>}
      </FormSection>
    </div>;
  }

  const current = committed ? STEPS.length : draft.step;
  const steps: FlowStep[] = STEPS.map((title, index) => ({ title, status: index < current ? 'done' : index === current ? 'current' : 'upcoming',
    detail: index < current ? [draft.file, draft.sheet, `${Object.keys(draft.mapping).length} 列对上字段`, declared.name, ''][index] : undefined }));
  const back = (to: number) => <Button variant="outline" disabled={busy} onClick={() => { update({ step: to }); if (to === 3) setConfirmed(false); }}><Icon name="action/arrow-left" data-icon="inline-start" />上一步</Button>;
  const footer = committed ? <>
    <Button variant="outline" onClick={() => { setCommitted(null); update({ step: 1 }); setPreview(null); setSkipFailed(false); }}>继续导入此文件的其他工作表</Button>
    <Button onClick={() => void navigate({ to: '/library/$seriesId', params: { seriesId: committed.series }, search: {} })}>打开系列，计算与核对<Icon name="action/arrow-right" data-icon="inline-end" /></Button>
  </> : <>
    <Button variant="ghost" className="mr-auto" onClick={() => void navigate({ to: '/library' })}>取消</Button>
    {draft.step === 1 && <>{back(0)}<Button disabled={!draft.sheet || busy} onClick={() => void run(chooseSheet)}>{busy ? <Spinner /> : null}下一步：列对应<Icon name="action/arrow-right" data-icon="inline-end" /></Button></>}
    {draft.step === 2 && <>{back(1)}<Button disabled={draft.mapping.area === undefined || !(draft.first >= 1)} onClick={() => { update({ step: 3 }); setConfirmed(false); }}>下一步：系列声明<Icon name="action/arrow-right" data-icon="inline-end" /></Button></>}
    {draft.step === 3 && <>{back(2)}<Button disabled={!declarable || !confirmed || missingBasis.length > 0 || busy}
      onClick={() => void run(async () => { setPreview(await api.op<ImportPreview>('library.import.preview', tableParams())); setSkipFailed(false); update({ step: 4 }); })}>
      {busy ? <Spinner /> : null}下一步：预览与导入<Icon name="action/arrow-right" data-icon="inline-end" /></Button></>}
    {draft.step === 4 && preview && <>{back(3)}<Button disabled={!preview.ready || (preview.failed > 0 && !skipFailed) || busy} onClick={() => void run(async () => {
      const result = await api.op<{ series: string; imported: number; left_out: number }>('library.import.commit', { ...tableParams(), skip_failed: skipFailed,
        ...(draft.mappingName.trim() ? { mapping_name: draft.mappingName.trim(), headers: Object.fromEntries(Object.entries(draft.mapping).map(([key, index]) => [key, sheet?.columns?.find(item => item.index === index)?.header ?? ''])) } : {}) });
      setCommitted(result);
      try { localStorage.removeItem(KEPT); } catch { /* private browsing */ }
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    })}>{busy ? <Spinner /> : <Icon name="action/import" data-icon="inline-start" />}导入 {preview.ready} 个规格</Button></>}
  </>;

  return <TypeFrame at={{ kind: 'library' }}>
    <PageHeader trail={[{ label: '电缆型号' }, { label: '型号库', onClick: () => void navigate({ to: '/library' }) }]} title="导入结构表"
      marks={draft.file && draft.step > 0 ? <Badge variant="outline"><Icon name="object/file" data-icon="inline-start" />{draft.file}</Badge> : undefined}
      actions={draft.upload && !committed ? <Button variant="ghost" disabled={busy} onClick={restart}>重新开始</Button> : undefined} />
    <FlowLayout steps={<Stepper label="导入步骤" steps={steps} />} footer={footer}>
      <div className="flex flex-col gap-6">
        {error && <FormNote tone="attention" title="没能继续"><span role="alert">{error}</span></FormNote>}
        {vocabulary.error && <FormNote tone="attention" title="读不到结构表字段"><span role="alert">{vocabulary.error.message}</span>
          <div><Button variant="outline" size="sm" onClick={() => void vocabulary.refetch()}>重新读取字段</Button></div></FormNote>}
        {body}
      </div>
    </FlowLayout>
  </TypeFrame>;
}
