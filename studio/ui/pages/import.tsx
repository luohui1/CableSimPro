import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { compact } from '@shared/format';
import type { ImportPreview, SeriesDeclaration, TableInspection } from '@shared/types';
import { Button } from '@/components/button';
import { LibraryHeader } from '@/components/library-header';
import { Icon } from '@/components/icon';
import { api } from '@/state/api';
import { queryClient, useVocabulary } from '@/state/queries';

const STEPS = ['选择文件', '选择工作表', '列对应', '系列声明', '预览导入'];
const EMPTY: SeriesDeclaration = { name: '', manufacturer: '', designation: '', cores: 3, u0_v: 0, u_v: 0, standards: [], common: {}, common_basis: {}, modelling: {}, origin: 'factory' };
interface Draft {
  step: number; upload: string; file: string; inspection: TableInspection | null; sheet: string; first: number;
  mapping: Record<string, number>; declaration: SeriesDeclaration; samples: { sheet: string; series: SeriesDeclaration }[]; mappingName: string;
}
const initial = (): Draft => ({ step: 0, upload: '', file: '', inspection: null, sheet: '', first: 1, mapping: {}, declaration: EMPTY, samples: [], mappingName: '' });
function saved(): Draft { try { return JSON.parse(localStorage.getItem('studio.import-draft') ?? 'null') ?? initial(); } catch { return initial(); } }

export function ImportLibrary() {
  const vocabulary = useVocabulary();
  const [draft, setDraft] = useState<Draft>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [skipFailed, setSkipFailed] = useState(false);
  const [committed, setCommitted] = useState<{ series: string; imported: number; left_out: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sheet = draft.inspection?.sheets.find(item => item.name === draft.sheet);
  const fields = vocabulary.data?.fields ?? [];
  useEffect(() => { localStorage.setItem('studio.import-draft', JSON.stringify({ ...draft, step: Math.min(draft.step, 3) })); }, [draft]);
  const update = (values: Partial<Draft>) => { setDraft(current => ({ ...current, ...values })); setError(''); };
  const declare = (values: Partial<SeriesDeclaration>) => update({ declaration: { ...draft.declaration, ...values } });
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function inspect(upload: string, file: string, samples: Draft['samples']) {
    const declaration = samples[0]?.series ?? { ...EMPTY, name: file.replace(/\.[^.]+$/, '') };
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
  const tableParams = () => ({ upload: draft.upload, sheet: draft.sheet, first_data_row: draft.first, mapping: draft.mapping, series: draft.declaration });
  const declaredFields = fields.filter(field => !['area', 'weight'].includes(field.key) && draft.mapping[field.key] === undefined);
  const declaredBasisMissing = Object.keys(draft.declaration.common).some(key => !draft.declaration.common_basis[key]?.trim());
  function uploadFile(file: File) {
    if (busy) return;
    update({ file: file.name });
    void run(async () => {
      const reply = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
      const result = await reply.json();
      if (!reply.ok) throw new Error(result.error?.message ?? '上传失败。');
      await inspect(result.upload, result.file, []);
    });
  }

  return <div className="flex h-full min-w-0 flex-col"><LibraryHeader />
    <div className="import-layout">
      <aside className="import-steps" aria-label="导入进度"><h2 className="m-0 px-3 text-16 font-strong">导入结构表</h2><ol aria-label="导入步骤">{STEPS.map((label, index) => <li key={label} aria-current={draft.step === index ? 'step' : undefined}><span className="import-step-number">{index < draft.step ? <Icon name="action/check" className="size-3" /> : index + 1}</span><span>{label}</span></li>)}</ol><p className="import-step-note">{draft.file ? <><strong className="break-all text-ink">{draft.file}</strong><br />{draft.sheet && `当前工作表：${draft.sheet}`}<br /></> : null}草稿自动保留，可在确认前逐项核对。原文件与取值依据随导入保存。</p></aside>
    <main className="import-main"><div className="import-content">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5"><div className="flex items-center gap-3"><Link to="/library" aria-label="返回产品库" className="text-ink-2"><Icon name="action/arrow-left" /></Link><h1 className="m-0 text-20 font-strong">导入结构表</h1></div><Button variant="ghost" size="compact" disabled={busy} onClick={() => { update(initial()); setPreview(null); setCommitted(null); setConfirmed(false); }}>重新开始</Button></div>
      {error && <div role="alert" className="border-b border-line pb-4 text-14 text-error">{error}</div>}
      {vocabulary.error && <p role="alert" className="text-error">{vocabulary.error.message}<Button onClick={() => void vocabulary.refetch()}>重新读取字段</Button></p>}
      {committed ? <section className="grid justify-items-start gap-4 py-5"><h2 className="m-0 text-20 font-strong">已导入 {committed.imported} 个规格</h2><p className="m-0 text-14">每个规格保存为第 1 版草稿，原始文件、系列声明和逐项来源已保留。{committed.left_out ? `跳过 ${committed.left_out} 行。` : ''}</p>
        <Link to="/library/$seriesId" params={{ seriesId: committed.series }} search={{}} className="text-copper">打开系列，计算与核对</Link>
        <Button onClick={() => { setCommitted(null); update({ step: 1 }); setPreview(null); setSkipFailed(false); }}>继续导入此文件的其他工作表</Button></section> : <>
      {draft.step === 0 && <section className="grid gap-4">
        <div className="import-file-area" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) uploadFile(file); }}>
        <Icon name="action/import" />
        <h2 className="m-0 text-16 font-strong">选择 Excel 或 CSV 结构表</h2>
        <p className="m-0 text-14 text-ink-2">将文件拖到这里，或点击选择。先确认工作表、列对应与缺项，再预览每个规格。</p>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-3"><Button variant="primary" disabled={busy} busy={busy} onClick={() => { if (fileInput.current) { fileInput.current.value = ''; fileInput.current.click(); } }}>选择结构表文件</Button><span id="import-file-name" className="min-w-0 break-all text-13 text-ink-2">{busy ? '正在读取文件…' : draft.file || '支持 .xlsx / .xls / .csv / .tsv · 最大 25 MB'}</span></div>
        <input ref={fileInput} type="file" aria-label="选择结构表文件" aria-describedby="import-file-name" tabIndex={-1} accept=".xlsx,.xls,.csv,.tsv" disabled={busy} className="sr-only" onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          uploadFile(file);
        }} />
        </div>
        <div className="import-sample"><div><h3 className="m-0 text-14 font-strong">用公开结构表熟悉流程</h3><p className="mb-0 mt-2 text-13 text-ink-2">人民电缆公开手册转录，前三张表共 35 个规格，保留来源与声明依据。</p></div><Button disabled={busy} busy={busy} icon="object/file" onClick={() => void run(async () => {
          const sample = await api.op<{ upload: string; file: string; declarations: Draft['samples'] }>('library.import.sample', {}); await inspect(sample.upload, sample.file, sample.declarations);
        })}>试用人民电缆公开结构表</Button></div>
      </section>}
      {draft.step === 1 && <section className="grid gap-4"><h2 className="m-0 text-16 font-strong">选择工作表</h2><p className="m-0 text-14">文件：{draft.file}</p>
        <label className="grid max-w-[600px] gap-2 text-14">工作表<select aria-label="工作表" className="studio-input" value={draft.sheet} onChange={event => update({ sheet: event.target.value })}>{draft.inspection?.sheets.map(item => <option key={item.name} value={item.name}>{item.name} · {item.data_rows ?? item.rows} 行{item.table ? '' : '（未识别表头）'}</option>)}</select></label>
        {sheet?.title && <p className="m-0 text-14">{sheet.title}</p>}<p className="m-0 text-13 text-ink-2">每张工作表导入为一个系列。多系列文件可以连续导入，规格按截面组织。</p>
        <Button variant="primary" className="justify-self-start" disabled={!draft.sheet} busy={busy} onClick={() => void run(chooseSheet)}>读取列对应</Button>
      </section>}
      {draft.step === 2 && <section className="grid gap-4"><h2 className="m-0 text-16 font-strong">确认列对应关系</h2>
        <div className="flex flex-wrap items-end gap-4"><label className="grid gap-1 text-13">数据起始行<input aria-label="数据起始行" type="number" min={1} step={1} className="studio-input w-32" value={draft.first} onChange={event => update({ first: Number(event.target.value) })} /></label>
          <label className="grid gap-1 text-13">复用列对应<select aria-label="复用列对应" className="studio-input" defaultValue="" onChange={event => {
            const mapping = vocabulary.data?.mappings.find(item => item.name === event.target.value); if (mapping) update({ mapping: mapping.mapping, mappingName: mapping.name });
          }}><option value="">选择已保存的对应关系</option>{vocabulary.data?.mappings.map(item => <option key={item.name}>{item.name}</option>)}</select></label></div>
        <div data-scroll-table className="import-table overflow-auto"><table className="w-full min-w-[620px] border-collapse text-14"><thead><tr className="bg-fill text-left"><th className="p-3">原表列</th><th className="p-3">样例数值</th><th className="p-3">对应字段与单位</th></tr></thead><tbody>
          {sheet?.columns?.map(column => <tr key={column.index} className="border-b border-line"><th className="p-3 text-left font-normal">{column.letter} · {column.header}</th><td className="p-3 text-13">{column.sample.slice(0, 3).join(' / ')}</td><td className="p-3"><select aria-label={`${column.letter}列对应`} className="studio-input w-full" value={Object.entries(draft.mapping).find(([, index]) => index === column.index)?.[0] ?? ''} onChange={event => {
            const mapping = Object.fromEntries(Object.entries(draft.mapping).filter(([key, index]) => index !== column.index && key !== event.target.value));
            if (event.target.value) mapping[event.target.value] = column.index; update({ mapping });
          }}><option value="">不导入此列</option>{fields.map(field => <option key={field.key} value={field.key}>{field.label} · {field.unit}</option>)}</select></td></tr>)}
        </tbody></table></div>
        <label className="grid max-w-[440px] gap-1 text-13">保存列对应的名称（可选）<input aria-label="列对应名称" className="studio-input" maxLength={60} value={draft.mappingName} onChange={event => update({ mappingName: event.target.value })} /></label>
        <div className="flex gap-2"><Button onClick={() => update({ step: 1 })}>上一步</Button><Button variant="primary" disabled={draft.mapping.area === undefined || !(draft.first >= 1)} onClick={() => { update({ step: 3 }); setConfirmed(false); }}>填写系列声明</Button></div>
      </section>}
      {draft.step === 3 && <form className="grid gap-5" onSubmit={event => { event.preventDefault(); void run(async () => { const result = await api.op<ImportPreview>('library.import.preview', tableParams()); setPreview(result); setSkipFailed(false); update({ step: 4 }); }); }}>
        <h2 className="m-0 text-16 font-strong">确认系列声明与依据</h2>
        <p className="m-0 text-13 text-ink-2">原表未列出的尺寸和计算参数在这里声明。每项保留依据，缺项会在预览中指出。草稿自动保存在本机。</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-13">系列名称<input aria-label="系列名称" required maxLength={80} className="studio-input" value={draft.declaration.name} onChange={event => declare({ name: event.target.value })} /></label>
          <label className="grid gap-1 text-13">制造商<input aria-label="制造商" maxLength={80} className="studio-input" value={draft.declaration.manufacturer} onChange={event => declare({ manufacturer: event.target.value })} /></label>
          <label className="grid gap-1 text-13">型号<input aria-label="型号" required maxLength={40} className="studio-input" value={draft.declaration.designation} onChange={event => declare({ designation: event.target.value })} /></label>
          <label className="grid gap-1 text-13">U0 / kV<input aria-label="额定相电压 kV" required type="number" min="0.001" step="any" className="studio-input" value={draft.declaration.u0_v / 1000 || ''} onChange={event => declare({ u0_v: Number(event.target.value) * 1000 })} /></label>
          <label className="grid gap-1 text-13">U / kV<input aria-label="额定线电压 kV" required type="number" min="0.001" step="any" className="studio-input" value={draft.declaration.u_v / 1000 || ''} onChange={event => declare({ u_v: Number(event.target.value) * 1000 })} /></label>
          <label className="grid gap-1 text-13">芯数<select aria-label="芯数" className="studio-input" value={draft.declaration.cores} onChange={event => declare({ cores: Number(event.target.value) as 1 | 3 })}><option value={1}>单芯</option><option value={3}>三芯</option></select></label>
          <label className="grid gap-1 text-13">数据身份<select aria-label="数据身份" className="studio-input" value={draft.declaration.origin} onChange={event => declare({ origin: event.target.value as 'factory' | 'public' })}><option value="factory">本厂结构表</option><option value="public">公开厂家资料</option></select></label>
          <label className="grid gap-1 text-13">铠装材料类别<select aria-label="铠装材料类别" className="studio-input" value={draft.declaration.armour_material ?? ''} onChange={event => { const next = { ...draft.declaration }; if (event.target.value) next.armour_material = event.target.value; else delete next.armour_material; update({ declaration: next }); }}><option value="">无铠装 / 未声明</option><option value="steel_galvanized">镀锌钢</option><option value="steel_stainless_nonmagnetic">非磁性不锈钢</option></select></label>
        </div>
        <label className="grid gap-1 text-13">执行标准（每行一项，含年号）<textarea aria-label="执行标准" required className="studio-input min-h-20" value={draft.declaration.standards.join('\n')} onChange={event => declare({ standards: event.target.value.split('\n') })} onBlur={() => declare({ standards: draft.declaration.standards.map(item => item.trim()).filter(Boolean) })} /></label>
        <details open><summary className="cursor-pointer text-14 font-strong">表中缺少的结构尺寸</summary><div className="mt-4 grid gap-3">{declaredFields.map(field => <div key={field.key} className="grid items-center gap-2 sm:grid-cols-[200px_140px_minmax(0,1fr)]">
          <label htmlFor={`common-${field.key}`} className="text-13">{field.label} · {field.unit}</label><input id={`common-${field.key}`} aria-label={`声明${field.label}`} type="number" min="0.000001" step="any" className="studio-input" value={draft.declaration.common[field.key] ?? ''} onChange={event => { const common = { ...draft.declaration.common }; if (event.target.value) common[field.key] = Number(event.target.value); else delete common[field.key]; declare({ common }); }} />
          <input aria-label={`${field.label}依据`} placeholder="资料、条款或工程师声明依据" className="studio-input" value={draft.declaration.common_basis[field.key] ?? ''} required={draft.declaration.common[field.key] !== undefined} onChange={event => declare({ common_basis: { ...draft.declaration.common_basis, [field.key]: event.target.value } })} />
        </div>)}</div></details>
        <details><summary className="cursor-pointer text-14 font-strong">计算参数与参考取值</summary><div className="mt-4 grid gap-3"><Button size="compact" className="justify-self-start" onClick={() => declare({ modelling: vocabulary.data?.reference_modelling ?? {} })}>填入标准参考值，供逐项核对</Button>
          {vocabulary.data?.modelling.map(field => <div key={field.key} className="grid items-start gap-2 sm:grid-cols-[200px_140px_minmax(0,1fr)]"><label htmlFor={`model-${field.key}`} className="text-13">{field.label} · {field.unit}</label>
            <input id={`model-${field.key}`} aria-label={`参数${field.label}`} className="studio-input" value={draft.declaration.modelling[field.key]?.value ?? ''} onChange={event => { const modelling = { ...draft.declaration.modelling }; if (event.target.value) modelling[field.key] = { value: /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(event.target.value) ? Number(event.target.value) : event.target.value, unit: field.unit, reference: modelling[field.key]?.reference ?? '' }; else delete modelling[field.key]; declare({ modelling }); }} />
            <textarea aria-label={`${field.label}参数依据`} className="studio-input min-h-16" value={draft.declaration.modelling[field.key]?.reference ?? ''} required={Boolean(draft.declaration.modelling[field.key])} onChange={event => { if (draft.declaration.modelling[field.key]) declare({ modelling: { ...draft.declaration.modelling, [field.key]: { ...draft.declaration.modelling[field.key], reference: event.target.value } } }); }} /></div>)}
        </div></details>
        {draft.declaration.source && <p className="m-0 break-words text-13 text-ink-2">来源：{draft.declaration.source.title}；{draft.declaration.source.location}</p>}
        <label className="flex items-start gap-2 text-14"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />我已核对系列声明、缺失尺寸及计算参数的来源。</label>
        <div className="flex gap-2"><Button onClick={() => update({ step: 2 })}>上一步</Button><Button type="submit" variant="primary" busy={busy} disabled={!confirmed || declaredBasisMissing}>预览导入</Button></div>
      </form>}
      {draft.step === 4 && preview && <section className="grid gap-4"><h2 className="m-0 text-16 font-strong">核对导入预览</h2><p className="m-0 text-14">{draft.declaration.name} · 可导入 {preview.ready} 行 · 失败 {preview.failed} 行 · 告警 {preview.rows.filter(row => row.warnings.length).length} 行</p>
        <div data-scroll-table className="max-h-[520px] overflow-auto"><table className="w-full min-w-[600px] border-collapse text-13"><thead className="sticky top-0 bg-fill text-left"><tr><th className="p-3">原表行</th><th className="p-3">规格</th><th className="p-3">外径 mm</th><th className="p-3">状态与说明</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.source_row} className="border-b border-line"><td className="p-3">{row.source_row}</td><td className="p-3">{row.key ?? '无法生成'}</td><td className="p-3 text-right">{compact(row.outer_diameter_mm)}</td><td className="p-3">{row.error ? <span className="text-error">{row.error.message}</span> : row.warnings.length ? row.warnings.map(item => <p key={item.code} className="m-0 text-attention">{item.message}</p>) : '可导入'}</td></tr>)}</tbody></table></div>
        {preview.skipped.length > 0 && <details className="text-13"><summary>跳过的非规格行（{preview.skipped.length}）</summary>{preview.skipped.map(item => <p key={item.row}>第 {item.row} 行：{item.text}</p>)}</details>}
        {preview.failed > 0 && <label className="flex items-start gap-2 text-14"><input type="checkbox" className="mt-1" checked={skipFailed} onChange={event => setSkipFailed(event.target.checked)} />明确跳过失败行，仅导入 {preview.ready} 个可用规格；失败行须回原表更正。</label>}
        <div className="flex flex-wrap gap-2"><Button onClick={() => update({ step: 3 })}>返回修改声明</Button><Button variant="primary" busy={busy} disabled={!preview.ready || (preview.failed > 0 && !skipFailed)} onClick={() => void run(async () => {
          const result = await api.op<{ series: string; imported: number; left_out: number }>('library.import.commit', { ...tableParams(), skip_failed: skipFailed,
            ...(draft.mappingName.trim() ? { mapping_name: draft.mappingName.trim(), headers: Object.fromEntries(Object.entries(draft.mapping).map(([key, index]) => [key, sheet?.columns?.find(item => item.index === index)?.header ?? ''])) } : {}) });
          setCommitted(result); localStorage.removeItem('studio.import-draft'); void queryClient.invalidateQueries({ queryKey: ['library'] });
        })}>确认导入 {preview.ready} 个规格</Button></div>
      </section>}
      </>}
    </div></main></div>
  </div>;
}
