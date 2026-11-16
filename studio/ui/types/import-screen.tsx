// Importing a structure table: the file, the sheet, which column is which field, the declaration of what the table leaves out,
// and a preview of every row before anything enters the library. Each sheet becomes one series, every size a first draft.
// The work in progress is kept, so a closed tab does not lose it.
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { compact } from '@shared/format';
import type { ImportPreview, SeriesDeclaration, TableColumn, TableInspection } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Toggle } from '@/components/ui/toggle';
import { Disclosure } from '@/kit/disclosure';
import { Icon, Spinner } from '@/kit/icon';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { PageHeader, Toolbar } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { queryClient, useVocabulary } from '@/state/queries';
import { DeclarationForm, EMPTY_DECLARATION, Labelled, numberOf, Pick } from './forms';
import { TypeFrame } from './frame';

const STEPS = ['选择文件', '选择工作表', '列对应', '系列声明', '预览导入'];
const KEPT = 'studio.import-draft';

interface Draft {
  step: number; upload: string; file: string; inspection: TableInspection | null; sheet: string; first: number;
  mapping: Record<string, number>; declaration: SeriesDeclaration; samples: { sheet: string; series: SeriesDeclaration }[]; mappingName: string;
}
const initial = (): Draft => ({ step: 0, upload: '', file: '', inspection: null, sheet: '', first: 1, mapping: {}, declaration: EMPTY_DECLARATION, samples: [], mappingName: '' });
function kept(): Draft {
  try { return JSON.parse(localStorage.getItem(KEPT) ?? 'null') ?? initial(); } catch { return initial(); }
}

/** A confirmation the person has to give: pressed means given. */
function Confirm({ pressed, onPressedChange, children }: { pressed: boolean; onPressedChange: (pressed: boolean) => void; children: ReactNode }) {
  return <Toggle variant="outline" pressed={pressed} onPressedChange={onPressedChange} className="h-auto justify-start py-2 text-left whitespace-normal">
    <Icon name="action/check" className={pressed ? 'text-success' : 'text-ink-3'} />{children}
  </Toggle>;
}

const previewColumns: Column<ImportPreview['rows'][number]>[] = [
  { key: 'row', header: '原表行', width: 'w-24', cell: row => row.source_row },
  { key: 'key', header: '规格', width: 'w-32', cell: row => row.key ?? '无法生成' },
  { key: 'od', header: '外径', unit: 'mm', numeric: true, width: 'w-28', cell: row => compact(row.outer_diameter_mm) },
  { key: 'state', header: '状态与说明', cell: row => row.error ? <span className="text-error">{row.error.message}</span>
    : row.warnings.length ? <span className="flex flex-col">{row.warnings.map(item => <span key={item.code} className="text-attention">{item.message}</span>)}</span> : '可导入' },
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
  const picker = useRef<HTMLInputElement>(null);
  const sheet = draft.inspection?.sheets.find(item => item.name === draft.sheet);
  const fields = vocabulary.data?.fields ?? [];
  useEffect(() => { try { localStorage.setItem(KEPT, JSON.stringify({ ...draft, step: Math.min(draft.step, 3) })); } catch { /* private browsing */ } }, [draft]);
  const update = (values: Partial<Draft>) => { setDraft(current => ({ ...current, ...values })); setError(''); };
  const declare = (declaration: SeriesDeclaration) => update({ declaration });
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
  const missingBasis = Object.keys(draft.declaration.common).filter(key => !draft.declaration.common_basis[key]?.trim());
  const restart = () => { update(initial()); setPreview(null); setCommitted(null); setConfirmed(false); };

  const columnList: Column<TableColumn>[] = [
    { key: 'letter', header: '原表列', width: 'w-28', cell: column => column.letter },
    { key: 'header', header: '列名', cell: column => column.header },
    { key: 'sample', header: '示例值', cell: column => column.sample.slice(0, 3).join(' / ') || '—' },
  ];
  const mappingColumns: Column<TableColumn>[] = [
    { key: 'column', header: '原表列', cell: column => `${column.letter} · ${column.header}` },
    { key: 'sample', header: '样例数值', width: 'w-48', cell: column => <span className="block truncate">{column.sample.slice(0, 3).join(' / ')}</span> },
    { key: 'field', header: '对应字段与单位', width: 'w-72', cell: column => <Pick label={`${column.letter}列对应`} value={Object.entries(draft.mapping).find(([, index]) => index === column.index)?.[0] ?? ''}
      options={[{ value: '', label: '不导入此列' }, ...fields.map(field => ({ value: field.key, label: `${field.label} · ${field.unit}` }))]}
      onValueChange={value => {
        const mapping = Object.fromEntries(Object.entries(draft.mapping).filter(([key, index]) => index !== column.index && key !== value));
        if (value) mapping[value] = column.index;
        update({ mapping });
      }} /> },
  ];

  let body: ReactNode;
  if (committed) {
    body = <EmptyState icon="action/check" title={`已导入 ${committed.imported} 个规格`}
      description={`每个规格保存为第 1 版草稿，原始文件、系列声明和逐项来源已保留。${committed.left_out ? `跳过 ${committed.left_out} 行。` : ''}`}
      action={<div className="flex gap-2">
        <Button variant="outline" onClick={() => { setCommitted(null); update({ step: 1 }); setPreview(null); setSkipFailed(false); }}>继续导入此文件的其他工作表</Button>
        <Button onClick={() => void navigate({ to: '/library/$seriesId', params: { seriesId: committed.series }, search: {} })}>打开系列，计算与核对</Button>
      </div>} />;
  } else if (draft.step === 0) {
    body = <div className="flex flex-col gap-6">
      <div data-drop-zone className="rounded-card border border-dashed border-line-strong bg-subtle"
        onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) upload(file); }}>
        <EmptyState icon="object/file" title="拖入 Excel 或 CSV 结构表" description={busy ? '正在读取文件…' : draft.file || '每行一个规格。上传后确认列对应和缺项，再导入型号库。.xlsx / .xls / .csv / .tsv，最大 25 MB。'}
          action={<Button disabled={busy} onClick={() => picker.current?.click()}>{busy ? <Spinner /> : <Icon name="action/import" data-icon="inline-start" />}选择结构表文件</Button>} />
        <Input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-label="结构表文件" accept=".xlsx,.xls,.csv,.tsv"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file); }} />
      </div>
      <Item variant="outline">
        <ItemMedia variant="icon"><Icon name="object/file" /></ItemMedia>
        <ItemContent>
          <ItemTitle>人民电缆公开结构表 <Badge variant="outline">公开资料</Badge></ItemTitle>
          <ItemDescription>公开的产品结构表，附原始来源和声明依据，可以直接试用整个流程。</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
            const sample = await api.op<{ upload: string; file: string; declarations: Draft['samples'] }>('library.import.sample', {});
            await inspect(sample.upload, sample.file, sample.declarations);
          })}>试用人民电缆公开结构表</Button>
        </ItemActions>
      </Item>
      <Disclosure title="表格格式与导入说明" className="border-t">
        <ul className="m-0 flex list-none flex-col gap-2 px-4 pb-4 text-sm text-ink">
          <li>保留规格、导体外径、绝缘厚度等原始列，列名可在下一步手动对应。</li>
          <li>每张工作表建立一个系列，同一文件可以连续导入多个系列。</li>
          <li>原表缺少的参数须补充取值依据；无法建立结构的行会列出具体问题。</li>
        </ul>
      </Disclosure>
    </div>;
  } else if (draft.step === 1) {
    body = <div className="flex flex-col gap-4">
      <h2 className="m-0 text-h2 text-ink">选择工作表</h2>
      <Labelled label="每张工作表导入为一个型号系列"><Pick label="工作表" value={draft.sheet} onValueChange={value => update({ sheet: value })}
        options={draft.inspection?.sheets.map(item => ({ value: item.name, label: `${item.name} · ${item.data_rows ?? item.rows} 行${item.table ? '' : '（未识别表头）'}` })) ?? []} /></Labelled>
      {sheet?.title && <p className="m-0 text-sm text-ink">{sheet.title}</p>}
      {Boolean(sheet?.columns?.length) && <DataTable columns={columnList} rows={sheet!.columns!} rowKey={column => String(column.index)} />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => update({ step: 0 })}>上一步</Button>
        <Button disabled={!draft.sheet || busy} onClick={() => void run(chooseSheet)}>{busy ? <Spinner /> : null}读取列对应</Button>
      </div>
    </div>;
  } else if (draft.step === 2) {
    body = <div className="flex flex-col gap-4">
      <h2 className="m-0 text-h2 text-ink">确认列对应关系</h2>
      <div className="flex items-center gap-3 text-sm text-ink">
        <span>{Object.keys(draft.mapping).length} 列已对应</span>
        {draft.mapping.area === undefined ? <Badge variant="error">请先对应标称截面列</Badge> : <Badge variant="success">标称截面已对应</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Labelled label="数据起始行" htmlFor="first-row"><Input id="first-row" aria-label="数据起始行" type="number" min={1} step={1} className="w-32" value={draft.first} onChange={event => update({ first: numberOf(event.target.value) ?? 0 })} /></Labelled>
        <Labelled label="复用列对应"><Pick label="复用列对应" value="" onValueChange={value => { const saved = vocabulary.data?.mappings.find(item => item.name === value); if (saved) update({ mapping: saved.mapping, mappingName: saved.name }); }}
          options={[{ value: '', label: '选择已保存的对应关系' }, ...(vocabulary.data?.mappings.map(item => ({ value: item.name, label: item.name })) ?? [])]} /></Labelled>
      </div>
      {sheet?.columns && <DataTable columns={mappingColumns} rows={sheet.columns} rowKey={column => String(column.index)} />}
      <Labelled label="保存列对应的名称（可选）" htmlFor="mapping-name"><Input id="mapping-name" aria-label="列对应名称" maxLength={60} value={draft.mappingName} onChange={event => update({ mappingName: event.target.value })} /></Labelled>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => update({ step: 1 })}>上一步</Button>
        <Button disabled={draft.mapping.area === undefined || !(draft.first >= 1)} onClick={() => { update({ step: 3 }); setConfirmed(false); }}>填写系列声明</Button>
      </div>
    </div>;
  } else if (draft.step === 3) {
    body = <form className="flex flex-col gap-6" onSubmit={event => { event.preventDefault(); void run(async () => { setPreview(await api.op<ImportPreview>('library.import.preview', tableParams())); setSkipFailed(false); update({ step: 4 }); }); }}>
      <h2 className="m-0 text-h2 text-ink">确认系列声明与依据</h2>
      <DeclarationForm value={draft.declaration} onChange={declare} vocabulary={vocabulary.data} taken={new Set(Object.keys(draft.mapping))}
        lead={draft.declaration.source ? <p className="m-0 text-sm text-ink-2">来源：{draft.declaration.source.title}；{draft.declaration.source.location}</p> : undefined} />
      <Confirm pressed={confirmed} onPressedChange={setConfirmed}>我已核对系列声明、缺失尺寸及计算参数的来源。</Confirm>
      {missingBasis.length > 0 && <p role="status" className="m-0 text-sm text-attention">请补充取值依据：{missingBasis.map(key => fields.find(field => field.key === key)?.label ?? key).join('、')}。</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => update({ step: 2 })}>上一步</Button>
        <Button type="submit" disabled={!confirmed || missingBasis.length > 0 || busy}>{busy ? <Spinner /> : null}预览导入</Button>
      </div>
    </form>;
  } else if (preview) {
    body = <div className="flex flex-col gap-4">
      <h2 className="m-0 text-h2 text-ink">核对导入预览</h2>
      <p className="m-0 text-sm text-ink">{draft.declaration.name} · 可导入 {preview.ready} 行 · 失败 {preview.failed} 行 · 告警 {preview.rows.filter(row => row.warnings.length).length} 行</p>
      <DataTable columns={previewColumns} rows={preview.rows} rowKey={row => String(row.source_row)} />
      {preview.skipped.length > 0 && <Disclosure title={`跳过的非规格行（${preview.skipped.length}）`}>
        <ul className="m-0 flex list-none flex-col gap-1 px-4 pb-4 text-sm text-ink">{preview.skipped.map(item => <li key={item.row}>第 {item.row} 行：{item.text}</li>)}</ul>
      </Disclosure>}
      {preview.failed > 0 && <Confirm pressed={skipFailed} onPressedChange={setSkipFailed}>明确跳过失败行，仅导入 {preview.ready} 个可用规格；失败行须回原表更正。</Confirm>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => update({ step: 3 })}>返回修改声明</Button>
        <Button disabled={!preview.ready || (preview.failed > 0 && !skipFailed) || busy} onClick={() => void run(async () => {
          const result = await api.op<{ series: string; imported: number; left_out: number }>('library.import.commit', { ...tableParams(), skip_failed: skipFailed,
            ...(draft.mappingName.trim() ? { mapping_name: draft.mappingName.trim(), headers: Object.fromEntries(Object.entries(draft.mapping).map(([key, index]) => [key, sheet?.columns?.find(item => item.index === index)?.header ?? ''])) } : {}) });
          setCommitted(result);
          try { localStorage.removeItem(KEPT); } catch { /* private browsing */ }
          void queryClient.invalidateQueries({ queryKey: ['library'] });
        })}>{busy ? <Spinner /> : null}确认导入 {preview.ready} 个规格</Button>
      </div>
    </div>;
  }

  return <TypeFrame at={{ kind: 'library' }}>
    <PageHeader trail={[{ label: '型号库', onClick: () => void navigate({ to: '/library' }) }]} title="导入结构表"
      marks={draft.file && draft.step > 0 ? <Badge variant="secondary">{draft.file}{draft.sheet ? ` · ${draft.sheet}` : ''}</Badge> : undefined}
      actions={draft.upload ? <Button variant="outline" disabled={busy} onClick={restart}>重新开始</Button> : undefined} />
    <Toolbar>
      <ol aria-label="导入进度" className="m-0 flex list-none items-center gap-2 p-0">
        {STEPS.map((label, index) => <li key={label} className="flex items-center gap-2" aria-current={!committed && index === draft.step ? 'step' : undefined}>
          <Badge variant={committed || index < draft.step ? 'success' : index === draft.step ? 'selected' : 'outline'}>{index + 1}</Badge>
          <span className={committed || index <= draft.step ? 'text-sm font-medium text-ink' : 'text-sm text-ink-2'}>{label}</span>
          {index < STEPS.length - 1 && <Icon name="action/chevron-right" className="text-ink-3" />}
        </li>)}
      </ol>
    </Toolbar>
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
        {vocabulary.error && <p role="alert" className="m-0 text-sm text-error">{vocabulary.error.message}
          <Button variant="link" onClick={() => void vocabulary.refetch()}>重新读取字段</Button></p>}
        {body}
      </div>
    </div>
  </TypeFrame>;
}
