// The solid the CAD plugin built, in the kit's model card with the workbench's own viewer. The host keeps what it built, so opening
// the card costs nothing.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ProductCad } from '@shared/cad';
import type { CardRef } from '@shared/types';
import { compact } from '@shared/format';
import { CadViewport, download } from '@/components/product-cad';
import { CardAction, ModelCard, OpenInWorkbench } from '@/kit/chat/cards';
import { api } from '@/state/api';
import { useTheme } from '@/state/theme';
import { useOpen } from './open';

/** The ground the viewer draws on is the card's own: the theme's fill, read when the theme changes. */
function useGround(theme: string): string | undefined {
  return useMemo(() => getComputedStyle(document.documentElement).getPropertyValue('--fill').trim() || undefined, [theme]);
}

export function ModelResult({ card, subject }: { card: Extract<CardRef, { kind: 'model3d' }>; subject?: string }) {
  const { theme } = useTheme();
  const ground = useGround(theme);
  const open = useOpen();
  const [view, setView] = useState<'cutaway' | 'solid'>('cutaway');
  const solid = useQuery({ queryKey: ['library', 'cad', card.spec, card.version], staleTime: Infinity, retry: false,
    queryFn: () => api.op<ProductCad>('library.geometry', { spec: card.spec, version: card.version }) });
  const title = `三维结构${subject ? ` · ${subject}` : ''}`;
  if (solid.isPending) return <ModelCard title={title} state="loading" />;
  if (solid.error) return <ModelCard title={title} state="failed" error={solid.error.message} />;
  const data = solid.data;
  return <ModelCard title={title} state="ready" view={view} onViewChange={setView}
    viewport={<div className="size-full"><CadViewport data={data} cutaway={view === 'cutaway'} selected="" background={ground} /></div>}
    facts={[{ label: '外径', value: `${compact(data.model.outer_diameter_m * 1000)} mm` }, { label: '层数', value: `${data.model.layers.length}` }]}
    actions={<>
      <CardAction icon="action/export" onClick={() => download(data.model.step_text, `${card.spec}-第${card.version}版.step`, 'application/step')}>下载 STEP</CardAction>
      <OpenInWorkbench onClick={() => open(card.href)} />
    </>} />;
}
