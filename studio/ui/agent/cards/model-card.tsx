// The solid the CAD plugin built, shown with the workbench's own viewer. The host keeps what it built, so opening the card costs nothing.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ProductCad } from '@shared/cad';
import type { CardRef } from '@shared/types';
import { compact } from '@shared/format';
import { CadViewport, download } from '@/components/product-cad';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/state/api';
import { useTheme } from '@/state/theme';
import { CardFrame } from './frame';

export function ModelCard({ card, subject }: { card: Extract<CardRef, { kind: 'model3d' }>; subject?: string }) {
  const { theme } = useTheme();
  const [cutaway, setCutaway] = useState(true);
  const solid = useQuery({ queryKey: ['library', 'cad', card.spec, card.version], staleTime: Infinity, retry: false,
    queryFn: () => api.op<ProductCad>('library.geometry', { spec: card.spec, version: card.version }) });
  const title = `三维结构${subject ? ` · ${subject}` : ''}`;
  if (solid.isPending) return <CardFrame title={title} href={card.href}><Skeleton className="h-72 w-full" /></CardFrame>;
  if (solid.error) return <CardFrame title={title} href={card.href}><p role="alert" className="text-destructive m-0 text-sm">三维模型没有生成：{solid.error.message}</p></CardFrame>;
  const data = solid.data;
  return <CardFrame title={title} href={card.href}>
    <div className="flex flex-col gap-3">
      <div className="relative h-72 overflow-hidden rounded-lg border [&_.cad-viewport]:h-full [&_.cad-viewport]:w-full">
        <CadViewport data={data} cutaway={cutaway} selected="" background={theme === 'dark' ? '#1b1e22' : '#eef0f3'} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={cutaway ? 'secondary' : 'outline'} size="sm" onClick={() => setCutaway(true)}>分层剖开</Button>
        <Button variant={cutaway ? 'outline' : 'secondary'} size="sm" onClick={() => setCutaway(false)}>完整实体</Button>
        <Button variant="outline" size="sm" onClick={() => download(data.model.step_text, `${card.spec}-第${card.version}版.step`, 'application/step')}>下载 STEP</Button>
        <span className="text-muted-foreground ms-auto text-sm">外径 {compact(data.model.outer_diameter_m * 1000)} mm，{data.model.layers.length} 层</span>
      </div>
    </div>
  </CardFrame>;
}
