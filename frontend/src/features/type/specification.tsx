import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, array, message, numeric, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { StatusMark } from '@/components/status-mark';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import { exportSpecification, generateSpecification, lifecycleAction, typeSpecification, type Specification, type SpecificationAudience } from './version-api';
import { EvidenceDigest } from './evidence-digest';
import { useTypeCommand } from './command-slot';
import { ReviewIssues } from './review-issues';

const statuses = { draft: '草稿', submitted: '待人工审核', approved: '已批准', published: '已发布' };
const channelLabels: Record<string, string> = { geometry: '结构推导', electrical: '电气参数', rating: '载流量表', short_circuit: '短路容量', standards: '标准核对' };
const destinations: Record<string, [string, string]> = { geometry: ['structure', 'quantities'], electrical: ['electrical', 'parameters'], rating: ['rating-table', 'parameters'], short_circuit: ['short-circuit', 'parameters'], standards: ['standard-check', 'results'] };
export function TypeSpecification({ tab }: { tab: string }) {
  const state = useTypeWorkspace(), queries = useQueryClient(), navigation = useTypeNavigation();
  const [audience, setAudience] = useState<SpecificationAudience>('customer');
  const query = useQuery({ queryKey: ['type-specification', state.workspace!.id, audience], queryFn: ({ signal }) => typeSpecification(state.workspace!.id, signal, audience) });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [chapter, setChapter] = useState('cover'), [blockedChannel, setBlockedChannel] = useState('');
  const [action, setAction] = useState<'adopt' | 'submissions' | 'approve' | 'publish' | null>(null), [ack, setAck] = useState(false), [summary, setSummary] = useState(''), [author, setAuthor] = useState('');
  const pending = useRef(false), request = useRef(''), currentState = useRef(state), mounted = useRef(true);
  const preview = useRef<HTMLIFrameElement>(null), [previewHeight,setPreviewHeight]=useState(800);
  currentState.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const spec = query.data, status = text(spec?.lifecycle.status), checks = spec ? array(spec.payload.checks, '规格书校核').map(optionalRecord) : [], sources = spec ? array(spec.payload.sources, '规格书来源').map(optionalRecord) : [];
  const historical = state.dirty || !!spec?.lifecycle.stale || sources.some(source => source.freshness !== 'current');
  const differentRevision = !!spec && numeric(spec.payload.revision) !== state.workspace!.revision;
  const reason = differentRevision ? '此接口返回当前规格书，不能代替所选历史型号版本。' : state.dirty ? '请先保存型号与方法条件' : '';
  const bodyState = busy && !action || query.isPending ? 'loading' : query.error || differentRevision ? 'error' : !sources.length ? 'empty' : historical ? 'historical' : 'success';
  const nextAction = status === 'submitted' && !historical ? 'approve' : status === 'approved' && !historical ? 'publish' : 'submissions';
  const names = { adopt: '采纳为版本草稿', submissions: '提交评审', approve: '人工批准', publish: '发布型号版本' };
  async function refresh() {
    await Promise.all([['type-specification'], ['type-evidence'], ['type-studies'], ['type-workspace'], ['type-comparison']].map(key => queries.invalidateQueries({ queryKey: [...key, state.workspace!.id] })));
  }
  async function download(value: Specification) {
    const blob = await exportSpecification(state.workspace!.id, value);
    if (!mounted.current) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
    link.download = text(value.payload.name) + '-' + (value.audience === 'customer' ? '客户版' : '内部审核版') + '.pdf'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function generate(internalOnly = false) {
    if (!spec || pending.current || reason) return;
    pending.current = true; setBusy(true); setError(''); setBlockedChannel('');
    const revision = state.workspace!.revision, key = `cablesim:specification:${state.workspace!.id}:${revision}:${audience}`;
    try {
      if (!internalOnly && status !== 'published') {
        let requestId = sessionStorage.getItem(key); if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem(key, requestId); }
        const result = await generateSpecification(state.workspace!.id, spec, revision, requestId);
        sessionStorage.removeItem(key);
        await refresh();
        if (result.status === 'blocked') { setBlockedChannel(text(result.channel)); throw new ApiError(422, text(result.message)); }
      }
      if (currentState.current.dirty || currentState.current.workspace?.revision !== revision) throw new ApiError(409, '生成期间输入发生变化；已完成运行已保存，请保存后重新生成。');
      const fresh = await typeSpecification(state.workspace!.id, undefined, audience);
      if (numeric(fresh.payload.revision) !== revision) throw new ApiError(409, '型号修订已变化，请重新生成。');
      await download(fresh);
    } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function begin(value: NonNullable<typeof action>) { request.current = crypto.randomUUID(); setAction(value); setAck(false); setError(''); setSummary(text(spec?.revisionDraft.summary)); setAuthor(text(spec?.revisionDraft.author)); }
  async function commit() {
    if (!action || !ack || !spec || pending.current || state.dirty || state.readOnly || reason || action === 'submissions' && (!summary.trim() || !author.trim())) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const base = { request_id: request.current, expected_revision: state.workspace!.revision };
      const body = action === 'adopt' ? base : action === 'submissions' ? { ...base, specification_digest: spec.digest, acknowledge_checks: true, change_summary: summary.trim(), author: author.trim() } : { request_id: request.current, submission_id: text(spec.lifecycle.submission_id), specification_digest: spec.digest, ...(action === 'approve' ? { human_confirmed: true as const } : {}) };
      await lifecycleAction(state.workspace!.id, action, body); setAction(null); await refresh(); await queries.invalidateQueries({ queryKey: ['type-list'] });
    } catch (failure) { setError(message(failure)); } finally { pending.current = false; setBusy(false); }
  }
  const chapters = spec ? array(spec.payload.chapters, '规格书章节').map((value, index) => audience === 'customer' && index === 6 ? '标准核对表' : index === 7 ? '文档修订记录与来源' : text(value)) : [];
  const markers = ['cover', 'standards', 'structure', 'electrical', 'rating', 'short-circuit', 'checks', 'revisions'];
  const chapterLabels=['封面','标准','结构','电气','载流','短路','核对','修订'];
  let iframeHtml = spec?.html || '';
  if (spec && tab === 'content') {
    const document = new DOMParser().parseFromString(spec.html, 'text/html');
    const style=document.createElement('style');style.textContent='@media screen {html,body{width:auto;min-width:0;max-width:100%;margin:0}body{box-sizing:border-box;padding:var(--space-4)}table{max-width:100%;table-layout:fixed}th,td{overflow-wrap:anywhere}.page,.specification{width:auto;max-width:100%;min-width:0}}';document.head.append(style);
    iframeHtml = '<!doctype html>' + document.documentElement.outerHTML;
  }
  const revisionRows = spec ? array(spec.payload.revisions, '文档修订记录').map((value, index) => ({ ...optionalRecord(value), id: String(index) }) as Record<string, unknown> & { id: string }) : [];
  const blockedTarget = destinations[blockedChannel];
  const inCommand=useTypeCommand({id:'specification-generate',label:status==='published'?'导出 PDF':'生成规格书',role:'primary',loading:busy,disabledReason:!spec?'规格书尚未读取':reason||(state.readOnly&&status!=='published'?'此版本不可生成':undefined),onSelect:()=>void generate()});
  return <div className="type-page" data-type-page="specification-results" data-type-state={bodyState}>
    <div className="type-result-toolbar">{!inCommand&&<Button variant="primary" size="compact" loading={busy} disabled={!spec || !!reason || state.readOnly && status !== 'published'} onClick={() => void generate()}>{status === 'published' ? '导出 PDF' : '生成规格书'}</Button>}
      <Select label="文档版本" value={audience} disabled={busy} options={[{ value: 'customer', label: '客户版' }, { value: 'internal', label: '内部审核版' }]} onChange={value => setAudience(value as SpecificationAudience)} />
      {audience === 'internal' && <Button size="compact" disabled={!spec || !!reason || busy} onClick={() => void generate(true)}>导出内部审核稿</Button>}
      {spec && <StatusMark kind={historical ? 'historical' : status === 'published' || status === 'approved' ? 'success' : 'draft'} label={historical ? '已过期' : statuses[status as keyof typeof statuses]} detail={historical ? '输入或来源已变化；重新生成后才能交付当前客户版。' : undefined} />}{reason && <span className="muted">{reason}</span>}
    </div>
    {error && !action && <p role="alert" className="type-notice is-error">{error}{blockedTarget && <Button size="compact" onClick={() => navigation.navigate(typePath(state.workspace!.id, ...blockedTarget, navigation.location.theme))}>查看{channelLabels[blockedChannel]}条件</Button>}</p>}
    {bodyState === 'loading' ? <LoadingState title={busy ? '正在预检并生成规格书，已完成的计算会保留' : '正在读取规格书'} /> : query.error || differentRevision ? <ErrorState title="规格书不可用" description={differentRevision ? reason : message(query.error)} action={<Button onClick={() => void query.refetch()}>重新读取</Button>} /> : !spec ? <EmptyState title="尚无规格书" description="" /> : <>
      {tab === 'review' ? <>
        <div className="type-result-summary"><strong>{checks.filter(check => check.blocking === true).length} 项阻止发布</strong><Button size="compact" disabled={state.dirty || state.readOnly || busy || status !== 'draft' || checks.some(check=>check.blocking===true)} onClick={() => begin('adopt')}>采纳为版本草稿</Button><Button size="compact" disabled={state.dirty || state.readOnly || busy || status === 'published' || checks.some(check=>check.blocking===true) || !spec.ready} onClick={() => begin(nextAction)}>{names[nextAction]}</Button></div>
        <ReviewIssues checks={checks} approved={status==='published'} digest={spec.digest} onRefresh={async()=>{await queries.invalidateQueries({queryKey:['type-specification',state.workspace!.id]});}} />
      </> : tab === 'revisions' ? revisionRows.length ? <DataTable label="文档修订记录" showGroups={false} rowLabel={row => text(row.version)} groups={[{ id: 'revisions', label: '修订', rows: revisionRows }]} columns={[{ id: 'version', label: '文件版本', render: row => text(row.version) }, { id: 'summary', label: '变更摘要', wrap: true, render: row => text(row.summary) }, { id: 'author', label: '编制人', render: row => text(row.author) }, { id: 'created', label: '日期', render: row => text(row.created).slice(0, 10) }]} /> : <EmptyState title="尚未提交文档评审" description="提交时记录文件版本、变更摘要、编制人与日期。" /> : <div className="type-specification-layout">
        <div className="type-specification-navigation">{tab === 'content' && <nav aria-label="规格书章节">{chapters.map((name, index) => <button key={name} title={name} aria-label={name} aria-current={chapter === markers[index] ? 'page' : undefined} onClick={() => { setChapter(markers[index]); const section=preview.current?.contentDocument?.querySelector(`[data-specification-section="${markers[index]}"]`); const dock=preview.current?.closest('.workbench-dock-body'); if(section&&dock&&preview.current) dock.scrollTo({top:preview.current.offsetTop+(section as HTMLElement).offsetTop,behavior:'instant'}); }}>{index + 1} {chapterLabels[index] || name}</button>)}</nav>}
        {!!checks.filter(check=>check.blocking===true).length && <Button size="compact" onClick={() => { const first=checks.find(check=>check.blocking===true), destination=destinations[text(first?.channel)]; navigation.navigate(typePath(state.workspace!.id,...(destination || ['specification','review'] as [string,string]),navigation.location.theme)); }}>{checks.filter(check=>check.blocking===true).length} 项阻止发布 · 查看第一项</Button>}</div>
        <iframe ref={preview} title="正式规格书预览" sandbox="allow-same-origin" srcDoc={iframeHtml} height={previewHeight} onLoad={() => { const doc=preview.current?.contentDocument; if(doc) setPreviewHeight(Math.max(400,doc.documentElement.scrollHeight)); }} />
        {audience === 'internal' && <details className="type-specification-checks"><summary>来源与运行</summary>{sources.map((source, index) => <p key={index}>{channelLabels[text(source.channel)]} · <EvidenceDigest value={source.run_id} /></p>)}<p>规格书 <EvidenceDigest value={spec.digest} /></p></details>}
      </div>}
    </>}
    <Dialog open={!!action} onOpenChange={value => { if (!value && !busy) setAction(null); }} title={action ? names[action] : '规格书操作'} description={action === 'approve' || action === 'publish' ? '本人确认后再次核验内容与批准记录。' : '提交绑定当前输入与保存的计算结果。'} actions={<Button variant="primary" loading={busy} disabled={!ack || action === 'submissions' && (!summary.trim() || !author.trim())} onClick={() => void commit()}>{action ? names[action] : '确认'}</Button>}>
      <div className="type-create-fields">{action === 'submissions' && <><p>文件版本 {text(spec?.revisionDraft.version)}</p><label className="type-form-label">变更摘要<Input className="type-name-input" value={summary} maxLength={500} disabled={busy} onChange={event => setSummary(event.target.value)} /></label><label className="type-form-label">编制人<Input className="type-name-input" value={author} maxLength={120} disabled={busy} onChange={event => setAuthor(event.target.value)} /></label></>}
        <label><Checkbox checked={ack} disabled={busy} onCheckedChange={value => setAck(value===true)} aria-label="已核对当前版本与提交前校核清单" /> {action === 'approve' || action === 'publish' ? '我本人已核对来源、校核清单并确认此操作' : '已核对当前版本与提交前校核清单'}</label>{error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  </div>;
}
