import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { message, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { libraryRequest } from './api';

interface ExchangePreview {
  file_sha256: string; bundle_sha256: string; original_file_count: number; state: string; message: string;
  series: { origin_id: string; name: string; spec_count: number; conflict: boolean }[];
}
interface ExchangeReceipt { created: number; series: { series_id: string; name: string; specs: unknown[] }[] }

export async function downloadSeries(seriesId: string, format: 'json' | 'xlsx') {
  const response = await fetch('/api/type-library/exchange/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ series_ids: [seriesId], format }),
  });
  if (!response.ok) {
    const body = optionalRecord(await response.json().catch(() => null));
    throw new Error(typeof body.detail === 'string' ? body.detail : text(optionalRecord(body.detail).message) || '导出失败，请核对系列中的版本与来源。');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = `cable-types.${format}`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExchangeImport({ onOpenSeries }: { onOpenSeries: (id: string) => void }) {
  const client = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ExchangePreview | null>(null);
  const [receipt, setReceipt] = useState<ExchangeReceipt | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const request = useRef('');
  async function upload(next: File) {
    setBusy('正在校验交换文件与来源原件'); setError(''); setFile(next); setPreview(null); setReceipt(null); setConfirmed(false);
    try {
      if (!/\.(json|xlsx)$/i.test(next.name)) throw new Error('请选择型号库导出的 JSON 或 Excel 交换文件。');
      if (next.size > 8 * 1024 * 1024) throw new Error('交换文件超过 8 MiB，请在原库分批导出。');
      const body = new FormData(); body.append('file', next);
      setPreview(await libraryRequest<ExchangePreview>('/exchange/preview', { method: 'POST', body }));
      request.current = crypto.randomUUID();
    } catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }
  async function save() {
    if (!preview || !file || !confirmed || preview.series.some(item => item.conflict)) return;
    setBusy('正在保存型号版本与来源'); setError('');
    try {
      const body = new FormData(); body.append('file', file); body.append('reviewed_sha256', preview.file_sha256);
      body.append('confirmed', 'true'); body.append('request_id', request.current);
      setReceipt(await libraryRequest<ExchangeReceipt>('/exchange/import', { method: 'POST', body }));
      await client.invalidateQueries({ queryKey: ['type-library', 'series'] });
    } catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }
  return <section className="library-import-stack" aria-label="型号数据交换">
    <h2>导入型号交换文件</h2>
    <p>在“系列与规格”中选择系列即可导出 JSON 或 Excel。交换文件包含当前型号版本、逐项来源及原始结构表。</p>
    <p className="muted">导入后建立未发布草稿，保留来源版本的对应记录。审核与运行历史使用整库备份迁移。</p>
    <div><Button variant={preview ? 'secondary' : 'primary'} disabled={!!busy} onClick={() => picker.current?.click()}>选择型号交换文件</Button></div>
    <Input ref={picker} type="file" hidden tabIndex={-1} aria-label="型号交换文件" accept=".json,.xlsx" onChange={event => { const next = event.target.files?.[0]; event.target.value = ''; if (next) void upload(next); }} />
    {file && <p className="library-import-file">{file.name}</p>}
    {busy && <p role="status">{busy}…</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {receipt ? <div className="library-import-stack">
      <h2>已导入 {receipt.created} 个规格草稿</h2>
      {receipt.series.map(item => <div key={item.series_id}><Button onClick={() => onOpenSeries(item.series_id)}>打开系列：{item.name}</Button></div>)}
    </div> : preview && <div className="library-import-stack">
      <h2>核对交换预览</h2>
      <p>{preview.series.length} 个系列，{preview.series.reduce((sum, item) => sum + item.spec_count, 0)} 个规格，附带 {preview.original_file_count} 份原始结构表。</p>
      <DataTable label="型号交换预览" showGroups={false} groups={[{ id: 'exchange', label: '系列', rows: preview.series.map(item => ({ ...item, id: item.origin_id })) }]} rowLabel={row => row.name} columns={[
        { id: 'name', label: '系列', wrap: true, render: row => row.name },
        { id: 'specs', label: '规格数', numeric: true, render: row => row.spec_count },
        { id: 'status', label: '检查结果', wrap: true, render: row => row.conflict ? '目标库存在同名系列，整包不入库' : '可导入为新草稿' },
      ]} />
      {preview.series.some(item => item.conflict) ? <p className="field-error">同名系列尚未处理，整包不会导入。请在新的目标库恢复，或回原库核对后重新导出。</p> : <>
        <label className="library-import-confirm"><Checkbox aria-label="确认交换文件来源" checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} /><span>我已核对本次文件、来源原件和系列范围，确认将当前快照导入为未发布草稿。</span></label>
        <div><Button variant="primary" loading={!!busy} disabled={!confirmed} onClick={() => void save()}>确认导入型号交换文件</Button></div>
      </>}
    </div>}
  </section>;
}
