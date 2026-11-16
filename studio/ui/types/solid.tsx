// The second view of the same version: the solid the CAD plugin builds from the saved dimensions (CadQuery / OpenCASCADE),
// its STEP file, and what the model leaves out. Built on request; a missing input is a refusal, never a guessed shape.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ProductCad } from '@shared/cad';
import { compact } from '@shared/format';
import type { SpecView } from '@shared/types';
import { CadViewport, download } from '@/components/product-cad';
import { Button } from '@/components/ui/button';
import { Icon } from '@/kit/icon';
import { CanvasFrame, CanvasLayer, CanvasTool, CanvasToolbar, CanvasToolbarSeparator } from '@/kit/workbench/canvas';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';

export function SolidView({ view, role }: { view: SpecView; role: string | null }) {
  const [cutaway, setCutaway] = useState(true);
  const query = useQuery({
    queryKey: ['library', 'cad', view.spec.id, view.version.number, view.version.content_sha256], enabled: false, staleTime: Infinity, retry: false,
    queryFn: () => api.op<ProductCad>('library.geometry', { spec: view.spec.id, version: view.version.number }),
  });
  const data = query.data;
  if (!data) {
    return <EmptyState className="bg-canvas" icon="tool/view-3d" title={query.isFetching ? '正在构造实体并校验…' : '这一版还没有三维实体'}
      description={query.error ? `未生成：${query.error.message}` : '用这一版保存的尺寸、材料和构造参数建模，同时导出 STEP。缺少必要参数时明确拒绝，不推测单丝、节距或制造细节。'}
      action={<Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? '正在建模…' : '生成三维实体'}</Button>} />;
  }
  const name = `${view.series.designation}-${view.spec.key}-第${view.version.number}版`;
  return <CanvasFrame
    tools={<CanvasToolbar label="三维视图">
      <CanvasLayer icon="tool/section-cut" label="分层剖开" pressed={cutaway} onPressedChange={setCutaway} />
      <CanvasToolbarSeparator />
      <CanvasTool icon="action/export" label="下载 STEP 实体" onClick={() => download(data.model.step_text, `${name}.step`, 'application/step')} />
      <CanvasTool icon="result/evidence" label="建模来源（JSON）" onClick={() => download(JSON.stringify(data, null, 2), `${view.spec.key}-CAD来源.json`, 'application/json')} />
    </CanvasToolbar>}
    status={<>
      <span>外径 {compact(data.model.outer_diameter_m * 1000)} mm</span>
      <span>显示长度 {compact(data.model.length_m * 1000)} mm</span>
      <span title="线芯按截面直线拉伸，不含成缆扭转、接触形变和制造公差。">拖动旋转，滚轮缩放</span>
      {data.warnings.length > 0 && <span title={data.warnings.map(item => item.message).join('；')}><Icon name="status/warning" className="mr-1 inline" />建模提示 {data.warnings.length} 项</span>}
    </>}>
    <CadViewport className="absolute inset-0" data={data} cutaway={cutaway} selected={role ?? ''} />
  </CanvasFrame>;
}
