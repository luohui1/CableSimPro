import { useEffect, useRef, useState } from 'react';
import './formal-export.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  formalExport, formalFilename, formalPreview, type FormalDocument,
  type FormalKind, type FormalPreview, type FormalRequest, type FormalSource,
} from '@/api/formal-deliveries';

type Props = {
  kind: FormalKind;
  alternativeKinds?: FormalKind[];
  source: FormalSource | null;
  disabledReason?: string;
};

/** Read-only T4 official delivery, deliberately separate from the legacy PDF generator. */
export function FormalExport({ kind, alternativeKinds = [], source, disabledReason }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState(kind);
  const offeredKinds = [kind, ...alternativeKinds];
  useEffect(() => {
    if (!offeredKinds.includes(selectedKind)) {
      setSelectedKind(kind);
      setVerified(null);
      setAck(false);
    }
  }, [kind, selectedKind, alternativeKinds.join('|')]);
  const [organization, setOrganization] = useState('');
  const [number, setNumber] = useState('');
  const [revision, setRevision] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const [verified, setVerified] = useState<{ request: FormalRequest; model: FormalPreview } | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const sourceIdentity = JSON.stringify({ kind: selectedKind, source });
  const current = verified && JSON.stringify({ kind: verified.request.kind, source: verified.request.source }) === sourceIdentity
    && verified.request.document.organization === organization.trim()
    && verified.request.document.number === number.trim()
    && verified.request.document.revision === revision.trim()
    && verified.request.document.header === header.trim()
    && verified.request.document.footer === footer.trim()
    && (verified.request.document.issued_on || '') === issuedOn
      ? verified : null;

  function change(field: (next: string) => void, value: string) {
    field(value);
    setVerified(null);
    setAck(false);
    setError('');
  }
  function request(): FormalRequest {
    if (!source) throw new Error('请先选择已保存且可核验的来源。');
    const document: FormalDocument = {
      organization: organization.trim(), number: number.trim(), revision: revision.trim(),
      header: header.trim(), footer: footer.trim(),
      ...(issuedOn ? { issued_on: issuedOn } : {}),
    };
    return { kind: selectedKind, source: structuredClone(source), document };
  }
  async function preview() {
    if (pending.current || disabledReason) return;
    pending.current = true;
    setBusy('正在核验正式文件来源');
    setVerified(null);
    setAck(false);
    setError('');
    try {
      const selection = request();
      const model = await formalPreview(selection);
      setVerified({ request: selection, model });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '正式交付预览失败。');
    } finally {
      pending.current = false;
      setBusy('');
    }
  }
  async function download(format: 'pdf' | 'xlsx') {
    if (pending.current || !current || !ack || disabledReason) return;
    pending.current = true;
    setBusy(format === 'pdf' ? '正在生成正式 PDF' : '正在生成正式 Excel');
    setError('');
    try {
      const blob = await formalExport(current.request, current.model, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = formalFilename(current.request, format);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setVerified(null);
      setAck(false);
      setError(cause instanceof Error ? cause.message : '正式交付失败，请重新预览。');
    } finally {
      pending.current = false;
      setBusy('');
    }
  }

  return <>
    <Button size="compact" variant="secondary" disabled={!source || !!disabledReason}
      onClick={() => { setError(''); setOpen(true); }}>
      正式交付（PDF / Excel）
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!value && pending.current) return; setOpen(value); }}
      title="正式交付文件" description="从已保存且可验证的来源生成正式文件，不重算、不自动签字。预览后固定摘要，导出前再次核验来源。"
      actions={<div className="report-toolbar">
        <Button variant="secondary" disabled={!!busy} onClick={() => setOpen(false)}>关闭</Button>
        <Button variant="primary" loading={!!busy && !current} disabled={!!busy || !source || !!disabledReason ||
          !organization.trim() || !number.trim() || !revision.trim()} onClick={() => void preview()}>
          核对来源并预览
        </Button>
      </div>}>
      <div className="formal-export-fields">
        {alternativeKinds.length > 0 && <Select label="正式交付类型" value={selectedKind} disabled={!!busy}
          onChange={value => { setSelectedKind(value as FormalKind); setVerified(null); setAck(false); setError(''); }}
          options={offeredKinds.map(item => ({value: item, label: ({specification:'规格书',calculation:'计算书',rating_table:'载流量表',research_report:'研究报告'} as Record<FormalKind,string>)[item]}))} />}
        <label className="formal-export-label">单位名称
          <Input aria-label="正式文件单位名称" value={organization} maxLength={120} disabled={!!busy}
            onChange={event => change(setOrganization, event.target.value)} placeholder="请输入实际交付单位" />
        </label>
        <label className="formal-export-label">文件编号
          <Input aria-label="正式文件编号" value={number} maxLength={80} disabled={!!busy}
            onChange={event => change(setNumber, event.target.value)} placeholder="请输入本次正式交付编号" />
        </label>
        <label className="formal-export-label">版次
          <Input aria-label="正式文件版次" value={revision} maxLength={32} disabled={!!busy}
            onChange={event => change(setRevision, event.target.value)} placeholder="例如 A 或 1.0" />
        </label>
        <label className="formal-export-label">签发日期（可留空）
          <Input aria-label="签发日期" type="date" value={issuedOn} disabled={!!busy}
            onChange={event => change(setIssuedOn, event.target.value)} />
        </label>
        <label className="formal-export-label">页眉（可留空）
          <Input aria-label="正式文件页眉" value={header} maxLength={160} disabled={!!busy}
            onChange={event => change(setHeader, event.target.value)} />
        </label>
        <label className="formal-export-label">页脚（可留空）
          <Input aria-label="正式文件页脚" value={footer} maxLength={160} disabled={!!busy}
            onChange={event => change(setFooter, event.target.value)} />
        </label>
        <p className="muted formal-export-wide">不允许在此填写设计、校核、审核或批准人；签栏只读取真实的已保存审批记录，缺记录则留空。</p>
        {busy && <p role="status">{busy}…</p>}
        {disabledReason && <p role="alert" className="field-error">{disabledReason}</p>}
        {error && <p role="alert" className="field-error">{error}</p>}
        {current && <section className="formal-export-wide" aria-label="正式交付预览回执">
          <h3>{current.model.title} · 已固定来源预览</h3>
          <p>文件来源：{Object.keys(current.model.sources).length} 项 · 正文章节：{current.model.sections.filter(section => section.role === 'body').length} 项</p>
          <p className="muted">来源摘要：{current.model.source_digest.slice(0, 16)}…</p>
          <p className="muted">交付模型摘要：{current.model.model_digest.slice(0, 16)}…</p>
          <details>
            <summary>核对章节与签栏</summary>
            <ul>{current.model.sections.map((section, index) =>
              <li key={index}>{section.heading} · {section.table_ids.length} 张表</li>)}</ul>
            <ul>{current.model.signatures.map(signature =>
              <li key={signature.role}>{signature.label}：{signature.name || '空白（无真实签核）'}</li>)}</ul>
          </details>
          <label>
            <Checkbox aria-label="已核对正式交付来源和签栏" checked={ack} disabled={!!busy}
              onCheckedChange={value => setAck(value === true)} /> 已核对本次来源、版次和签核状态；空白签栏不代表批准
          </label>
          <div className="report-toolbar">
            <Button variant="primary" disabled={!!busy || !ack} loading={busy === '正在生成正式 PDF'}
              onClick={() => void download('pdf')}>下载正式 PDF</Button>
            <Button disabled={!!busy || !ack} loading={busy === '正在生成正式 Excel'}
              onClick={() => void download('xlsx')}>下载 Excel</Button>
          </div>
        </section>}
      </div>
    </Dialog>
  </>;
}
