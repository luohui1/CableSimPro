// Two parts wired to the host the gallery is served from, the way the real pages wire them: the model section of the
// settings reads /api/status, and the 3D card asks the host for the solid with library.geometry (the host builds it once
// with the sealed CAD plugin and keeps it). Neither the configured endpoint nor the mesh is copied into the repository.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ProductCad } from '@shared/cad';
import type { AgentStatus } from '@shared/types';
import { compact } from '@shared/format';
import { Badge } from '@/components/ui/badge';
import { CadViewport, download } from '@/components/product-cad';
import { CardAction, ModelCard, OpenInWorkbench } from '@/kit/chat/cards';
import { useThemeColor } from '@/kit/theme-color';
import { ConnectionCheck, FormNote, FormRow, FormSection, ReadonlyValue } from '@/kit/workbench/form';
import { PageHeader } from '@/kit/workbench/page';
import { api } from '@/state/api';
import { useLibrary, useProjects, useRun, useStatus } from '@/state/queries';
import { SectionThumb, thumbOf } from '@/kit/section-thumb';
import { Skeleton } from '@/components/ui/skeleton';

/** The solid of one version, from the host: building, built, or refused with the plugin's own words. */
/**
 * The section thumbnail drawn from a run record the host holds, as a result card would: the first project's latest rating
 * run that succeeded, read through the same request the workbench makes, the field checked against its published nodes.
 */
export function LiveSectionThumb() {
  const projects = useProjects();
  const project = projects.data?.[0]?.id;
  const view = useQuery({ queryKey: ['project', project], queryFn: () => api.project(project as string), enabled: Boolean(project) });
  // Runs come newest first: the first rating run that succeeded is the latest.
  const header = view.data?.runs.find(run => run.kind === 'rating' && run.status === 'succeeded');
  const run = useRun(project ?? '', header?.id);
  const thumb = useMemo(() => run.data && thumbOf(run.data), [run.data]);
  if (projects.isError || view.isError || run.isError) return <FormNote tone="attention">宿主没有回话，这张缩略图没有画。</FormNote>;
  if (projects.data && !project) return <FormNote>宿主上还没有载流量工程。</FormNote>;
  if (view.data && !header) return <FormNote>宿主上还没有算成的载流量运行。</FormNote>;
  if (!run.data) return <Skeleton className="aspect-4/3 w-full" />;
  if (!thumb) return <FormNote>这条运行没有断面文档，画不出缩略图。</FormNote>;
  return <SectionThumb {...thumb} label={`敷设断面：${run.data.title}`} />;
}

export function ModelCardLive({ spec, version, title }: { spec: string; version: number; title: string }) {
  const solid = useQuery({ queryKey: ['library', 'cad', spec, version], staleTime: Infinity, retry: false,
    queryFn: () => api.op<ProductCad>('library.geometry', { spec, version }) });
  const [view, setView] = useState<'cutaway' | 'solid'>('cutaway');
  const ground = useThemeColor('--fill');
  if (solid.isPending) return <ModelCard title={title} state="loading" />;
  if (solid.error) return <ModelCard title={title} state="failed" error={solid.error.message} />;
  const model = solid.data.model;
  return <ModelCard title={title} state="ready" view={view} onViewChange={setView}
    facts={[{ label: '外径', value: `${compact(model.outer_diameter_m * 1000)} mm` }, { label: '层数', value: String(model.layers.length) }]}
    viewport={<CadViewport data={solid.data} cutaway={view === 'cutaway'} selected="" background={ground} />}
    actions={<>
      <CardAction icon="action/export" onClick={() => download(model.step_text, `${spec}-第${version}版.step`, 'application/step')}>下载 STEP</CardAction>
      <OpenInWorkbench />
    </>} />;
}

/**
 * The model section of the settings. The model is set in the environment, so the page shows it; how to set it is the host's
 * own hint, which it gives when nothing is configured. Until the host has answered, nothing is claimed either way. The host
 * has no operation yet that checks the connection, so the check stays unavailable.
 */
export function SettingsModelBody({ status, error }: { status?: AgentStatus; error?: string }) {
  const configured = status?.configured;
  return <>
    <PageHeader title="设置" />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-8 py-10">
        <FormSection split title="Agent 用的模型" description="Agent 模式用它听懂你的话、调用工作台的操作；结果里的数由方法插件算出，不经过模型。"
          aside={status ? <Badge variant={configured ? 'success' : 'attention'}>{configured ? '已配置' : '未配置'}</Badge> : !error && <Badge variant="secondary">读取中</Badge>}>
          {error && <FormNote tone="attention" title="读不到设置">{error}</FormNote>}
          <FormRow label="接口"><ReadonlyValue empty={!status?.provider}>{status?.provider}</ReadonlyValue></FormRow>
          <FormRow label="模型"><ReadonlyValue empty={!status?.model}>{status?.model}</ReadonlyValue></FormRow>
          <FormRow label="密钥" hint="只从环境变量读取，不写入磁盘；这里只说有没有">
            <ReadonlyValue empty={!status}>{configured ? '已配置' : '未配置'}</ReadonlyValue>
          </FormRow>
          <FormRow label="连通性" hint="宿主还没有检查连通的操作；接上之后这里给出结果"><ConnectionCheck state="idle" disabled /></FormRow>
          {status?.hint && <FormNote tone="attention" title="怎么配置">{status.hint}</FormNote>}
        </FormSection>
      </div>
    </div>
  </>;
}

/**
 * A three-core 3×240 the serving host holds: the public sample's as imported there, else the built-in catalogue's (华远),
 * which every host has. Its latest version is the one the card asks for.
 */
function useSampleSpec() {
  const library = useLibrary();
  const entries = library.data ?? [];
  const entry = entries.find(item => item.name === 'YJV22-8.7/15 kV 3×240' && item.family.startsWith('人民电缆集团'))
    ?? entries.find(item => item.id === 'huayuan.yjv22-15kv-240');
  return { entry, pending: library.isPending, error: library.error?.message };
}

/** The card of the conversation that asked for a solid, on whichever host serves the gallery. */
export function AgentModelCard() {
  const { entry, pending, error } = useSampleSpec();
  if (pending) return <ModelCard title="三维模型" state="loading" />;
  if (!entry) return <ModelCard title="三维模型" state="failed" error={error ?? '这台宿主的型号库里没有 3×240 的三芯规格。'} />;
  return <ModelCardLive spec={entry.id} version={Number(entry.version)} title={`三维模型 · ${entry.name}`} />;
}

/** What the serving host says about its model: for the top bar and the settings alike. */
export function useHostStatus() {
  const status = useStatus();
  return { agent: status.data?.agent, error: status.error?.message };
}
