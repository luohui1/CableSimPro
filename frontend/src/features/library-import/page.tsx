import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { message } from '@/api/client';
import { CatalogShell } from '@/components/catalog-shell';
import { DataTable } from '@/components/data-table';
import { LoadingState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DeclarationForm, emptyDeclaration } from './declaration';
import { SeriesLibrary } from './series';
import { CatalogueComparison } from './comparison';
import { ValueTable } from './value-table';
import { ExchangeImport } from './exchange';
import { LibraryDialog } from './dialog';
import { displayUnit } from '@/lib/display-names';
import { issueText, libraryPost, libraryRequest, methodText, normalizeSeriesDeclaration, type CommitReceipt, type Mapping, type Preview, type PreviewRow, type SeriesDeclaration, type Upload, type Vocabulary } from './api';
import './library-import.css';

const STEPS = ['选择文件', '选择工作表', '列映射', '系列声明', '预览入库'];
const EMPTY_VOCABULARY: Vocabulary = { fields: [], modelling: [], mappings: [], reference_modelling: {}, supported_voltages: [] };

export function LibraryImportPage() {
  const search = useSearch({ strict: false }) as { item?: string; theme?: string };
  const navigate = useNavigate();
  const [tab, setTab] = useState(search.item ? 'series' : 'import');
  const openSeries = (id: string) => {
    setTab('series');
    void navigate({ to: '.', search: (previous: Record<string, unknown>) => ({ ...previous, item: id || undefined }), replace: true });
  };
  return <CatalogShell title="结构表导入与系列" path="电缆型号库" actions={<Button asChild><a href="/resources/cables">电缆型号版本</a></Button>}>
    <Tabs value={tab} onValueChange={setTab} className="library-import-page">
      <TabsList aria-label="型号库操作"><TabsTrigger value="import">导入结构表</TabsTrigger><TabsTrigger value="series">系列与规格</TabsTrigger><TabsTrigger value="comparison">公开样本对照</TabsTrigger><TabsTrigger value="exchange">数据交换</TabsTrigger></TabsList>
      <TabsContent value="import" forceMount><ImportWizard onOpenSeries={openSeries} /></TabsContent>
      <TabsContent value="series"><SeriesLibrary selected={search.item} onSelect={openSeries} onImport={() => setTab('import')} /></TabsContent>
      <TabsContent value="comparison"><CatalogueComparison /></TabsContent>
      <TabsContent value="exchange"><ExchangeImport onOpenSeries={openSeries} /></TabsContent>
    </Tabs>
  </CatalogShell>;
}

function ImportWizard({ onOpenSeries }: { onOpenSeries: (id: string) => void }) {
  const client = useQueryClient();
  const vocabularyQuery = useQuery({ queryKey: ['type-library', 'vocabulary'], queryFn: ({ signal }) => libraryRequest<Vocabulary>('/vocabulary', { signal }) });
  const vocabulary = vocabularyQuery.data || EMPTY_VOCABULARY;
  const [step, setStep] = useState(0);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [first, setFirst] = useState(1);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [mappingName, setMappingName] = useState('');
  const [activeMapping, setActiveMapping] = useState('');
  const [mappingNotice, setMappingNotice] = useState('');
  const [series, setSeries] = useState<SeriesDeclaration>(emptyDeclaration);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewRow, setPreviewRow] = useState<PreviewRow | null>(null);
  const [receipt, setReceipt] = useState<CommitReceipt | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [skipErrors, setSkipErrors] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [fileName, setFileName] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const requestId = useRef('');
  const selectedSheet = upload?.sheets.find(sheet => sheet.name === sheetName);
  const columns = selectedSheet?.columns || [];
  const fields = upload?.fields || vocabulary.fields;
  const missingBasis = Object.keys(series.common).filter(key => !series.common_basis[key]?.trim());
  const missingModelBasis = Object.keys(series.modelling).filter(key => !series.modelling[key].reference?.trim());
  const importable = preview?.rows.filter(row => row.status !== 'error').length || 0;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest('.main-content')?.scrollTo({ top: 0 });
  }, [step, receipt]);

  const invalidatePreview = () => { setPreview(null); setPreviewRow(null); setConfirmed(false); setSkipErrors(false); requestId.current = ''; };
  const updateSeries = (next: SeriesDeclaration) => { setSeries(next); invalidatePreview(); };
  const changeStep = (next: number) => { setError(''); setStep(next); };
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await action(); } catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }
  function reset() {
    setStep(0); setUpload(null); setSheetName(''); setFirst(1); setMapping({}); setMappingName(''); setMappingNotice(''); setActiveMapping('');
    setSeries(emptyDeclaration()); setReceipt(null); setFileName(''); setError(''); invalidatePreview();
  }
  function chooseFile(file: File) {
    void run('正在上传并检查结构表', async () => {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('请选择 .xlsx、.xls 或 .csv 结构表。');
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('请选择非空且不超过 10 MiB 的结构表，请拆分过大的文件后重新选择。');
      setFileName(file.name);
      const body = new FormData(); body.append('file', file);
      const result = await libraryRequest<Upload>('/imports/upload', { method: 'POST', body });
      setUpload(result);
      const sheet = result.sheets.find(item => item.table) || result.sheets[0];
      if (!sheet) throw new Error('文件中没有可以读取的工作表。');
      setSheetName(sheet.name); setFirst(sheet.first_data_row || 1);
      const declaration = result.declarations?.find(item => item.sheet === sheet.name)?.series;
      setSeries(declaration ? normalizeSeriesDeclaration(declaration) : { ...emptyDeclaration(), name: file.name.replace(/\.[^.]+$/, ''), source: { title: file.name } });
      setReceipt(null); setMapping({}); setMappingNotice(''); setActiveMapping(''); invalidatePreview(); setStep(1);
    });
  }
  function chooseSheet() {
    if (!selectedSheet) return;
    const declaration = upload?.declarations?.find(item => item.sheet === selectedSheet.name);
    if (declaration) setSeries(normalizeSeriesDeclaration(structuredClone(declaration.series)));
    setFirst(declaration?.first_data_row || selectedSheet.first_data_row || 1);
    setMapping(declaration?.mapping || Object.fromEntries(columns.filter(column => column.suggested).map(column => [column.suggested!, column.index])));
    setActiveMapping('');
    invalidatePreview(); changeStep(2);
  }
  function applyMapping(name: string) {
    const saved = vocabulary.mappings.find(item => item.name === name);
    if (!saved) return;
    const mismatch = Object.entries(saved.mapping).filter(([field, index]) => saved.headers[field] !== columns.find(column => column.index === index)?.header);
    if (mismatch.length) { setError('该映射与当前表头不一致，请逐列核对后保存新的映射。'); return; }
    setMapping({ ...saved.mapping }); setMappingName(saved.name); setActiveMapping(saved.name); setMappingNotice(`已复用“${saved.name}”，请核对各列。`); setError(''); invalidatePreview();
  }
  const headers = () => Object.fromEntries(Object.entries(mapping).map(([key, index]) => [key, columns.find(column => column.index === index)?.header || '']));

  let body: ReactNode;
  if (receipt) {
    body = <section className="library-import-stack" aria-label="入库结果">
      <h2 ref={heading} tabIndex={-1}>已保存 {receipt.created} 个规格草稿</h2>
      <p>系列、规格与来源已进入电缆型号库。保存草稿保留资料身份，计算与人工审核分别进行。</p>
      {preview && preview.incomplete_count > 0 && <p className="muted">其中 {preview.incomplete_count} 个规格仍有缺项；补齐必需数据后才能计算。</p>}
      <DataTable label="已入库规格" showGroups={false} groups={[{ id: 'created', label: '规格', rows: receipt.specs }]} rowLabel={row => row.name} columns={[
        { id: 'name', label: '规格', wrap: true, render: row => row.name },
        { id: 'version', label: '版本', render: row => `第 ${row.version} 版` },
        { id: 'state', label: '状态', render: () => '草稿 · 待人工核对' },
      ]} />
      <div className="library-import-actions"><Button onClick={() => { setReceipt(null); invalidatePreview(); changeStep(1); }}>继续导入其他工作表</Button><Button variant="primary" onClick={() => onOpenSeries(receipt.series_id)}>打开系列，核对与计算</Button></div>
    </section>;
  } else if (step === 0) {
    body = <div className="library-import-stack">
      <h2 ref={heading} tabIndex={-1}>选择厂家结构表</h2>
      <div className="library-import-drop" onDragOver={event => { event.preventDefault(); }} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !busy) chooseFile(file); }}>
        <p>拖入 Excel 或 CSV 文件，每行一个规格。</p>
        <p className="muted">支持 .xlsx、.xls、.csv，最大 10 MiB。上传后选择工作表、确认列映射与来源，再预览入库。</p>
        <Button variant="primary" loading={!!busy} disabled={vocabularyQuery.isPending || vocabularyQuery.isError} onClick={() => picker.current?.click()}>选择结构表文件</Button>
        {fileName && <p role="status">{fileName}</p>}
        <Input ref={picker} type="file" hidden tabIndex={-1} aria-label="结构表文件" accept=".xlsx,.xls,.csv" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) chooseFile(file); }} />
      </div>
      <section className="library-import-stack">
        <h2>公开样本</h2>
        <p className="muted">人民电缆结构表与 Bahra 结构性能表保留厂家目录原值、来源与列名；下载后可通过上面的文件入口导入。独立工程计算仍需完整结构和工况。</p>
        <div><Button asChild><a href="/api/type-library/samples/people-mv.xlsx" download>下载人民电缆示例结构表</a></Button></div>
        <div><Button asChild><a href="/api/type-library/samples/bahra-mv.xlsx" download>下载 Bahra 示例结构性能表</a></Button></div>
      </section>
    </div>;
  } else if (step === 1) {
    body = <div className="library-import-stack">
      <h2 ref={heading} tabIndex={-1}>选择工作表</h2>
      <Select label="工作表" value={sheetName} disabled={!!busy} onChange={name => { setSheetName(name); invalidatePreview(); }} options={(upload?.sheets || []).map(sheet => ({ value: sheet.name, label: `${sheet.name} · ${sheet.data_rows ?? sheet.rows} 行` }))} />
      {selectedSheet?.title && <p>{selectedSheet.title}</p>}
      {!columns.length ? <p role="status">没有识别到表头，请检查原文件是否以列名和数值行组织。</p> : <DataTable label="工作表原始列" showGroups={false} groups={[{ id: 'columns', label: '原始列', rows: columns.map(column => ({ ...column, id: String(column.index) })) }]} rowLabel={row => `${row.letter} 列 ${row.header}`} columns={[
        { id: 'letter', label: '原表列', render: row => row.letter },
        { id: 'header', label: '列名', wrap: true, render: row => row.header || '无列名' },
        { id: 'sample', label: '示例值（原表单位）', wrap: true, render: row => row.sample.filter(value => value !== null).join(' / ') || '空值' },
      ]} />}
      <div className="library-import-actions"><Button onClick={() => changeStep(0)}>上一步</Button><Button variant="primary" disabled={!columns.length || !!busy} onClick={chooseSheet}>确认工作表，设置列映射</Button></div>
    </div>;
  } else if (step === 2) {
    body = <div className="library-import-stack">
      <h2 ref={heading} tabIndex={-1}>确认列映射</h2>
      <p className="muted">{Object.keys(mapping).length} 列已对应。每个字段只使用一列；请按原表单位选择目标字段。</p>
      <div className="library-import-fields library-import-fields-pair">
        <label className="text-field">数据起始行<Input aria-label="数据起始行" type="number" min={1} step={1} value={first || ''} onChange={event => { setFirst(Number(event.target.value)); invalidatePreview(); }} /></label>
        <Select label="复用已保存映射" value={activeMapping} onChange={applyMapping} options={[{ value: '', label: '选择列映射模板' }, ...vocabulary.mappings.map(item => ({ value: item.name, label: item.name }))]} />
      </div>
      <DataTable label="列映射" showGroups={false} groups={[{ id: 'columns', label: '列映射', rows: columns.map(column => ({ ...column, id: String(column.index) })) }]} rowLabel={row => `${row.letter} 列映射`} columns={[
        { id: 'column', label: '原表列名', wrap: true, render: row => `${row.letter} · ${row.header || '无列名'}` },
        { id: 'sample', label: '示例值', wrap: true, render: row => row.sample.filter(value => value !== null).join(' / ') || '空值' },
        { id: 'field', label: '目标字段与单位', render: row => <Select label={`${row.letter} 列对应`} value={Object.entries(mapping).find(([, index]) => index === row.index)?.[0] || ''} options={[{ value: '', label: '不导入此列' }, ...fields.map(field => ({ value: field.key, label: `${field.label} / ${displayUnit(field.unit)}` }))]} onChange={field => {
          const next = Object.fromEntries(Object.entries(mapping).filter(([key, index]) => key !== field && index !== row.index));
          if (field) next[field] = row.index;
          setMapping(next); setMappingNotice(''); setActiveMapping(''); invalidatePreview();
        }} /> },
      ]} />
      <div className="library-import-mapping-save">
        <label className="text-field">映射模板名称<Input aria-label="映射模板名称" value={mappingName} maxLength={80} onChange={event => setMappingName(event.target.value)} /></label>
        <Button loading={busy === '正在保存映射'} disabled={!mappingName.trim() || mapping.area === undefined || !!busy} onClick={() => void run('正在保存映射', async () => {
          await libraryPost<Mapping>('/mappings', { name: mappingName.trim(), mapping, headers: headers() });
          await client.invalidateQueries({ queryKey: ['type-library', 'vocabulary'] });
          setMappingNotice(`已保存“${mappingName.trim()}”，可在后续导入中复用。`);
        })}>保存列映射</Button>
      </div>
      {mappingNotice && <p role="status">{mappingNotice}</p>}
      {mapping.area === undefined && <p className="field-error">请先对应标称截面列。</p>}
      <div className="library-import-actions"><Button onClick={() => changeStep(1)}>上一步</Button><Button variant="primary" disabled={mapping.area === undefined || !Number.isInteger(first) || first < 1 || !!busy} onClick={() => changeStep(3)}>填写系列声明</Button></div>
    </div>;
  } else if (step === 3) {
    body = <form className="library-import-stack" aria-label="系列声明" onSubmit={event => { event.preventDefault(); void run('正在逐行核对结构表', async () => {
      const result = await libraryPost<Preview>('/imports/preview', { upload_id: upload!.upload_id, sheet: sheetName, first_data_row: first, mapping, series });
      setPreview(result); setConfirmed(false); setSkipErrors(false); requestId.current = crypto.randomUUID(); changeStep(4);
    }); }}>
      <h2 ref={heading} tabIndex={-1}>填写系列声明与来源</h2>
      <DeclarationForm value={series} onChange={updateSeries} vocabulary={{ ...vocabulary, fields }} mapped={new Set(Object.keys(mapping))} />
      {(missingBasis.length > 0 || missingModelBasis.length > 0) && <p className="field-error" role="status">请补充依据：{[...missingBasis, ...missingModelBasis].map(key => fields.find(field => field.key === key)?.label || vocabulary.modelling.find(field => field.key === key)?.label || '参数').join('、')}。</p>}
      <div className="library-import-actions"><Button type="button" onClick={() => changeStep(2)}>上一步</Button><Button type="submit" variant="primary" loading={!!busy} disabled={!series.name.trim() || !series.designation.trim() || !series.u0_v || !series.u_v || missingBasis.length > 0 || missingModelBasis.length > 0}>逐行校验并预览</Button></div>
    </form>;
  } else if (preview) {
    body = <div className="library-import-stack">
      <h2 ref={heading} tabIndex={-1}>核对入库预览</h2>
      <p>{series.name} · 可入库 {importable} 行 · 其中缺项 {preview.incomplete_count} 行 · 错误 {preview.error_count} 行</p>
      <p className="muted">缺项资料可以保存为草稿，缺少必需数据的规格不能计算。错误行须更正或明确排除。</p>
      {preview.series.resistance_basis === 'standard_limit' && <p className="library-import-source">缺少原表电阻的规格采用 GB/T 3956—2008 表 2 标准上限，不是厂家实测值；每个数保留标准出处。</p>}
      <DataTable label="逐行入库预览" showGroups={false} groups={[{ id: 'preview', label: '逐行预览', rows: preview.rows.map(row => ({ ...row, id: String(row.row_number) })) }]} rowLabel={row => `原表第 ${row.row_number} 行`} columns={[
        { id: 'row', label: '原表行', numeric: true, render: row => row.row_number },
        { id: 'name', label: '规格与数值', wrap: true, render: row => <Button variant="link" onClick={() => setPreviewRow(row)}>{row.name || row.key || '查看原始数值'}</Button> },
        { id: 'state', label: '状态', render: row => ({ ready: '可入库', incomplete: '资料缺项', error: '不可入库' })[row.status] },
        { id: 'issues', label: '问题列与原因', wrap: true, render: row => <div className="library-import-issues">{row.issues.map((issue, index) => <span key={index}>{issue.column ? `${issue.column} 列 · ` : ''}{issue.field ? `${fields.find(field => field.key === issue.field)?.label || issue.field}：` : ''}{issue.message}</span>)}{row.missing.map((missing, index) => <span key={`missing-${index}`}>{issueText(missing)}</span>)}{!row.issues.length && !row.missing.length ? '—' : null}</div> },
      ]} />
      <p className="library-import-source">来源：{preview.file} · {preview.sheet}。每个数保留原表行列、来源、方法版本与可信分档。</p>
      <section className="library-import-stack" aria-label="执行标准来源确认">
        <h2>执行标准版本与来源</h2>
        {preview.execution_standards ? <>
          {!!preview.execution_standards.items.length && <>
            <p className="muted">确认入库会登记以下执行标准版本与来源摘要，作为后续标准核对的依据。型号与数值仍保留草稿身份。</p>
            <DataTable label="执行标准来源" showGroups={false} groups={[{ id: 'standards', label: '标准', rows: preview.execution_standards.items.map((item, index) => ({ ...item, id: String(index) })) }]} rowLabel={row => row.declared} columns={[
              { id: 'name', label: '执行标准版本', wrap: true, render: row => row.standard.endsWith(row.edition) ? row.standard : `${row.standard}—${row.edition}` },
              { id: 'source', label: '完整来源摘要（SHA-256）', wrap: true, render: row => <code className="library-import-digest">{row.source_digest}</code> },
              { id: 'method', label: '来源核对方法版本', wrap: true, render: row => methodText(row.method) },
            ]} />
          </>}
          {preview.execution_standards.missing.map((item, index) => <p className="field-error" key={index}>{item.declared}：{item.reason}</p>)}
          {!preview.execution_standards.items.length && !preview.execution_standards.missing.length && <p className="muted">本次未声明执行标准，后续标准核对将保留缺项。</p>}
        </> : <p className="field-error">执行标准来源尚未返回，请重新预览后核对。</p>}
      </section>
      {preview.error_count > 0 && <label className="library-import-confirm"><Checkbox checked={skipErrors} onCheckedChange={value => setSkipErrors(value === true)} aria-label="明确跳过错误行" /><span>明确跳过 {preview.error_count} 个错误行，仅保存其余 {importable} 个规格；错误行需回原表更正。</span></label>}
      <label className="library-import-confirm"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} aria-label="确认来源与系列声明" /><span>我已核对原始资料、列映射、系列声明与执行标准来源，确认将本次预览保存为未发布草稿。</span></label>
      {!importable && <p className="field-error">没有可入库的规格，请返回修正列映射或原始结构表。</p>}
      <div className="library-import-actions"><Button disabled={!!busy} onClick={() => changeStep(3)}>返回修改声明</Button><Button variant="primary" loading={!!busy} disabled={!importable || !confirmed || !preview.execution_standards || (preview.error_count > 0 && !skipErrors)} onClick={() => void run('正在保存型号草稿', async () => {
        const result = await libraryPost<CommitReceipt>('/imports/commit', { preview_id: preview.preview_id, preview_digest: preview.preview_digest, request_id: requestId.current, human_confirmed: true, skip_errors: skipErrors });
        setReceipt(result); await client.invalidateQueries({ queryKey: ['type-library', 'series'] });
      })}>确认入库 {importable} 个规格</Button></div>
    </div>;
  }

  return <div className="library-import-wizard" aria-busy={!!busy}>
    <div className="library-import-progress">
      <ol aria-label="导入进度">{STEPS.map((label, index) => <li key={label} aria-current={!receipt && step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
      {upload && <Button size="compact" disabled={!!busy} onClick={reset}>重新开始</Button>}
    </div>
    {upload && !receipt && <p className="library-import-file">{upload.file}{sheetName && ` · ${sheetName}`}</p>}
    {vocabularyQuery.isPending ? <LoadingState title="正在读取导入字段" /> : vocabularyQuery.isError ? <ErrorState description={message(vocabularyQuery.error)} action={<Button onClick={() => void vocabularyQuery.refetch()}>重新读取字段</Button>} /> : null}
    {error && <p role="alert" className="field-error library-import-error">{error}</p>}
    {busy && <p role="status" className="muted">{busy}…</p>}
    {body}
    <LibraryDialog open={!!previewRow} onOpenChange={open => { if (!open) setPreviewRow(null); }} title={previewRow ? `原表第 ${previewRow.row_number} 行 · ${previewRow.name || '数值预览'}` : '数值预览'} description="确认入库前逐项核对数值、原表位置、方法版本与可信分档。" initialFocus="form">
      <div className="library-import-stack"><ValueTable values={previewRow?.values || []} />{previewRow?.missing.map((value, index) => <p className="muted" key={index}>缺项：{issueText(value)}</p>)}</div>
    </LibraryDialog>
  </div>;
}
