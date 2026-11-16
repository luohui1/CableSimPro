// The series workspace: one product family as an engineering object. The browser lists what the active size is
// made of, the view draws it to scale, the properties explain the selection, and the design table compares sizes.
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, CircleHelp, Library, Moon, Play, Square, Sun, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Modal, Popover } from '@mantine/core';
import { compact, REVIEW_NAMES, STATE_NAMES } from '@shared/format';
import { cableShape } from '@shared/geometry';
import { pending, problems, RESULT_NAMES } from '@shared/products';
import { RESULT_KINDS, type LibraryJob, type ResultKind, type SpecRow } from '@shared/types';
import { Mark } from '@/components/icon';
import { reportFailure } from '@/components/notice';
import { Browser } from '@/series/browser';
import { DesignTable } from '@/series/design-table';
import { columnsFor, partsOf, PART_FIELDS, type Focus } from '@/series/model';
import { Properties } from '@/series/properties';
import { Viewport, type ViewMode } from '@/series/viewport';
import { api } from '@/state/api';
import { prefetchSpec, queryClient, useActiveSpec, useLibraryJob, useProductLibrary, useProductSeries } from '@/state/queries';
import { useTheme } from '@/state/theme';
import '@fontsource-variable/inter';
import '@/styles/workspace.css';

const SPLIT_KEY = 'studio.series.split';
const ALLOWED: Record<string, string[]> = { submit: ['draft'], approve: ['submitted'], publish: ['reviewed'], return: ['submitted', 'reviewed'] };
const ACTIONS: Record<string, string> = { submit: '提交审核', approve: '审核通过', publish: '发布', return: '退回修改' };
const kv = (value: number) => compact(value / 1000);

function SeriesSwitcher({ id }: { id: string }) {
  const library = useProductLibrary();
  const current = library.data?.find(item => item.id === id);
  const groups = [['factory', '本厂结构表'], ['public', '公开厂家资料'], ['demo', '结构演示']] as const;
  return <Menu position="bottom-start" width={340} withinPortal classNames={{ dropdown: 'ws ws-menu' }}>
    <Menu.Target><button type="button" className="ws-crumb-button" aria-label="切换产品系列">{current?.name ?? '产品系列'}<ChevronDown size={14} /></button></Menu.Target>
    <Menu.Dropdown>
      {groups.map(([origin, label]) => { const items = library.data?.filter(item => (origin === 'demo' ? !['factory', 'public'].includes(item.origin) : item.origin === origin)) ?? [];
        return items.length ? <div key={origin}><Menu.Label>{label}</Menu.Label>{items.map(item =>
          <Menu.Item key={item.id} renderRoot={props => <Link {...props} to="/library/$seriesId" params={{ seriesId: item.id }} search={{}} />}
            rightSection={<span className="ws-menu-count">{item.specs}</span>} leftSection={item.id === id ? <Check size={14} /> : <span className="ws-menu-gap" />}>
            <span className="ws-menu-name">{item.name}</span></Menu.Item>)}</div> : null; })}
      <Menu.Divider />
      <Menu.Item renderRoot={props => <Link {...props} to="/library/import" />} leftSection={<Upload size={14} />}>导入结构表</Menu.Item>
    </Menu.Dropdown>
  </Menu>;
}

function AppBar({ id }: { id: string }) {
  const { theme, toggle } = useTheme();
  return <header className="ws-appbar">
    <Link to="/library" className="ws-brand" aria-label="Cable Studio 产品库"><Mark /><span>Cable Studio</span></Link>
    <nav className="ws-crumbs" aria-label="位置"><Link to="/library" className="ws-crumb"><Library size={15} />产品库</Link><span className="ws-crumb-sep">/</span><SeriesSwitcher id={id} /></nav>
    <div className="ws-appbar-end">
      <JobStatus seriesId={id} />
      <Link to="/workbench" className="ws-crumb">断面工作台</Link>
      <Popover position="bottom-end" width={340} withinPortal trapFocus returnFocus classNames={{ dropdown: 'ws ws-popover' }}>
        <Popover.Target><button type="button" className="ws-icon-button" aria-label="查看使用流程" title="使用流程"><CircleHelp size={16} /></button></Popover.Target>
        <Popover.Dropdown><b>从结构表到规格书</b><ol className="ws-steps">
          <li><b>导入资料</b>上传结构表，确认列对应、系列声明和数据来源。</li>
          <li><b>计算与核对</b>计算全系列或勾选的规格，在断面里逐个部位查看标准要求。</li>
          <li><b>修改与审核</b>改尺寸生成新版本；勾选规格提交审核并填写意见。</li>
          <li><b>导出规格书</b>在规格的“规格书”里生成和下载 PDF。</li>
        </ol></Popover.Dropdown>
      </Popover>
      <button type="button" className="ws-icon-button" aria-label={theme === 'light' ? '换成深色' : '换成浅色'} onClick={toggle}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
    </div>
  </header>;
}

function JobStatus({ seriesId }: { seriesId: string }) {
  const job = useLibraryJob().data;
  const stop = useMutation({ mutationFn: () => api.op('library.compute.cancel', { job: job!.id }), onError: reportFailure,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }) });
  if (!job || job.state !== 'running' && job.state !== 'failed') return null;
  return <div className="ws-job" role="status" data-state={job.state}>
    <span>{job.series_id === seriesId ? job.title : `其他系列：${job.title}`}</span>
    <progress aria-label="批量计算进度" value={job.done} max={Math.max(1, job.total)} /><span className="ws-job-count">{job.done} / {job.total}</span>
    {job.error && <span className="ws-error-text">{job.error.message}</span>}
    {job.state === 'running' && <button type="button" className="ws-button" data-variant="ghost" disabled={stop.isPending || job.cancel_requested} onClick={() => stop.mutate()}>
      <Square size={12} />{job.cancel_requested ? '本批结束后停止' : '停止'}</button>}
  </div>;
}

export function SeriesWorkspace({ id, spec, version, onInspect }: { id: string; spec?: string; version?: number; onInspect: (spec?: string, version?: number) => void }) {
  const query = useProductSeries(id);
  const job = useLibraryJob();
  const rows = useMemo(() => query.data?.specs ?? [], [query.data]);
  const activeId = spec && rows.some(row => row.id === spec) ? spec : rows[0]?.id;
  const view = useActiveSpec(activeId, spec === activeId ? version : undefined);
  const [focus, setFocus] = useState<Focus>({ kind: 'spec' });
  const [mode, setMode] = useState<ViewMode>('section');
  const [checked, setChecked] = useState<string[]>([]);
  const [kinds, setKinds] = useState<ResultKind[]>([...RESULT_KINDS]);
  const [force, setForce] = useState(false);
  const [reviewing, setReviewing] = useState<SpecRow[] | null>(null);
  const [action, setAction] = useState('submit');
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [split, setSplit] = useState<number | null>(() => { try { return Number(localStorage.getItem(SPLIT_KEY)) || null; } catch { return null; } });
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { try { if (split) localStorage.setItem(SPLIT_KEY, String(split)); } catch { /* private browsing */ } }, [split]);

  const current = query.data;
  const shown = view.data;
  const shape = useMemo(() => { try { return shown ? cableShape(shown.entry.payload.cable_type, shown.entry.payload.materials) : null; } catch { return null; } }, [shown]);
  const parts = useMemo(() => (shape && shown ? partsOf(shape, shown.entry.payload.cable_type) : []), [shape, shown]);
  const columns = useMemo(() => columnsFor(rows), [rows]);
  const lit = useMemo(() => new Set(focus.kind === 'part' ? [focus.role, ...(PART_FIELDS[focus.role] ?? [])] : focus.kind === 'analysis' ? [focus.id] : []), [focus]);
  const index = rows.findIndex(row => row.id === activeId);
  const selected = checked.length ? rows.filter(row => checked.includes(row.id)) : [];
  // The neighbours are read ahead, so stepping through sizes does not wait.
  useEffect(() => { for (const row of [rows[index - 1], rows[index + 1]]) if (row) prefetchSpec(row.id); }, [rows, index]);

  const compute = useMutation({ mutationFn: () => api.op<LibraryJob>('library.compute', { series: id, ...(selected.length ? { specs: selected.map(row => row.id) } : {}), kinds, force }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }), onError: reportFailure });
  const review = useMutation({ mutationFn: () => api.op<{ moved: number }>('library.review.batch', { items: reviewing!.map(row => ({ spec: row.id, version: row.version })), action, note }),
    onSuccess: () => { setReviewing(null); setChecked([]); setNote(''); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: cause => setReviewError(cause.message) });
  const reviewProblems = reviewing?.reduce((sum, row) => sum + problems(row).length + pending(row).length + (row.check?.missing ?? 0) + (row.check?.uncovered ?? 0), 0) ?? 0;
  const readyToReview = Boolean(reviewing?.length && reviewing.every(row => ALLOWED[action].includes(row.review)) && note.trim() && (!reviewProblems || acknowledged));
  const openReview = (items: SpecRow[]) => { setReviewing(items); setAcknowledged(false); setReviewError(''); };

  const activate = (next: string) => onInspect(next);
  const step = (direction: -1 | 1) => { const next = rows[index + direction]; if (next) activate(next.id); };
  const drag = (event: React.PointerEvent) => {
    const box = body.current?.getBoundingClientRect();
    if (!box) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => setSplit(Math.round(Math.min(box.height - 150, Math.max(220, moveEvent.clientY - box.top))));
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const reviewed = rows.filter(row => ['reviewed', 'published'].includes(row.review)).length;

  return <div className="ws ws-shell" data-mode={mode}>
    <AppBar id={id} />
    <div className="ws-objectbar">
      <div className="ws-object-title">
        <h1 title={current?.series.description}>{current ? `${current.series.designation || current.series.name} ${kv(current.series.u0_v)}/${current.series.u_v == null ? '—' : kv(current.series.u_v)} kV · ${current.series.cores} 芯` : '读取系列…'}</h1>
      </div>
      {current && <div className="ws-facts">
        <span className="ws-fact"><span>制造商</span><b>{current.series.manufacturer || '—'}</b></span>
        <span className="ws-fact"><span>来源</span><b>{STATE_NAMES[current.series.origin] ?? current.series.origin}</b></span>
        <span className="ws-fact"><span>执行标准</span><b>{current.declaration.standards.join(' · ') || '未声明'}</b></span>
        <span className="ws-fact"><span>已审核</span><b>{reviewed} / {rows.length} 个规格</b></span>
        <span className="ws-fact" data-wide=""><span>结构</span><b title={current.series.description}>{current.series.description}</b></span>
      </div>}
      <div className="ws-object-actions">
        <div className="ws-split-button">
          <button type="button" className="ws-button" data-variant="primary" disabled={!current || !kinds.length || compute.isPending || job.data?.state === 'running'} onClick={() => compute.mutate()}>
            <Play size={14} />{selected.length ? `计算选中 ${selected.length} 项` : '计算全系列'}</button>
          <Popover position="bottom-end" width={320} withinPortal trapFocus returnFocus classNames={{ dropdown: 'ws ws-popover' }}>
            <Popover.Target><button type="button" className="ws-button" data-variant="primary" aria-label="计算选项与基准条件" title="计算选项与基准条件"><ChevronDown size={14} /></button></Popover.Target>
            <Popover.Dropdown><b>计算哪些内容</b>
              <div className="ws-option-list">{RESULT_KINDS.map(kind => <label key={kind} className="ws-toggle"><input type="checkbox" checked={kinds.includes(kind)}
                onChange={event => setKinds(event.target.checked ? [...kinds, kind] : kinds.filter(item => item !== kind))} />{RESULT_NAMES[kind]}</label>)}
                <label className="ws-toggle"><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />重算已有结果</label></div>
              <b>基准条件</b><p className="ws-text">载流量按直埋 0.7 m、25 °C 计算，土壤热阻率 1.0–3.0 K·m/W 六档；三芯排管为三回水平模板。规格表的“载流量”列为 1.0 K·m/W 一档。</p>
            </Popover.Dropdown>
          </Popover>
        </div>
        <button type="button" className="ws-button" disabled={!rows.length} onClick={() => openReview(selected.length ? selected : rows.filter(row => row.id === activeId))}>
          {selected.length ? `审核选中 ${selected.length} 项` : '审核当前规格'}</button>
      </div>
    </div>

    {query.error ? <div className="ws-notice ws-pad" data-tone="fail"><p>{query.error.message}</p><button type="button" className="ws-button" onClick={() => void query.refetch()}>重新读取</button></div>
      : <div className="ws-body" ref={body} style={split ? { ['--ws-upper' as string]: `${split}px` } : undefined}>
        <Browser view={shown} parts={parts} focus={focus} onFocus={setFocus} />
        <Viewport view={shown} shape={shape} parts={parts} selected={focus.kind === 'part' ? focus.role : null} mode={mode} onMode={setMode}
          onSelect={role => setFocus(role ? { kind: 'part', role } : { kind: 'spec' })} previous={rows[index - 1]?.key} next={rows[index + 1]?.key} onStep={step} />
        <div className="ws-splitter" role="separator" aria-orientation="horizontal" aria-label="调整断面与规格表的高度" tabIndex={0} onPointerDown={drag}
          onDoubleClick={() => setSplit(null)} onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault();
            const box = body.current?.getBoundingClientRect(); const now = split ?? (box ? box.height * .56 : 400); setSplit(Math.round(now + (event.key === 'ArrowDown' ? 24 : -24))); } }} />
        <DesignTable rows={rows} columns={columns} reference={current?.reference ?? null} active={activeId} checked={checked} lit={lit}
          onActivate={activate} onChecked={setChecked} onCompute={() => compute.mutate()} onReview={() => openReview(selected)} computing={compute.isPending || job.data?.state === 'running'} />
        <Properties view={shown} parts={parts} focus={focus} onFocus={setFocus} onVersion={next => onInspect(activeId, next)} />
      </div>}

    <Modal opened={Boolean(reviewing)} onClose={() => setReviewing(null)} title="确认审核" size="lg" centered classNames={{ content: 'ws ws-dialog', header: 'ws-dialog-header', title: 'ws-dialog-title' }}
      closeButtonProps={{ 'aria-label': '关闭审核窗口' }}>{reviewing && <form aria-label="确认批量审核" className="ws-review" onSubmit={event => { event.preventDefault(); review.mutate(); }}>
        <p className="ws-text">{reviewing.map(row => `${row.key}（第 ${row.version} 版 · ${REVIEW_NAMES[row.review]}）`).join('、')}</p>
        <label className="ws-field"><span>审核操作</span><select className="ws-select" aria-label="审核操作" value={action} onChange={event => setAction(event.target.value)}>
          {Object.entries(ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="ws-field"><span>审核意见</span><input className="ws-input" aria-label="审核意见" placeholder="写明核对了什么、依据是什么" maxLength={400} required value={note} onChange={event => setNote(event.target.value)} /></label>
        {!reviewing.every(row => ALLOWED[action].includes(row.review)) && <p className="ws-error-text">所选规格的状态不能做这一步，请选择处在同一审核阶段的规格。</p>}
        {reviewProblems > 0 && <label className="ws-toggle ws-acknowledge"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
          我已查看这些版本的 {reviewProblems} 项计算缺项、核对问题或告警，确认本次审核意见；审核不表示所有标准项均通过。</label>}
        {reviewError && <p role="alert" className="ws-error-text">{reviewError}</p>}
        <div className="ws-dialog-actions"><button type="submit" className="ws-button" data-variant="primary" disabled={!readyToReview || review.isPending}>确认{ACTIONS[action]}</button>
          <button type="button" className="ws-button" onClick={() => setReviewing(null)}>取消</button></div>
      </form>}</Modal>
  </div>;
}
