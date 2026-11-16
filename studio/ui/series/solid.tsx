// The second view of the same version: the solid the CAD plugin builds from the saved dimensions (CadQuery /
// OpenCASCADE), its STEP file, and what the model leaves out. Built on request; a missing input is a refusal.
import { useQuery } from '@tanstack/react-query';
import { Box, Download } from 'lucide-react';
import { useState } from 'react';
import type { ProductCad } from '@shared/cad';
import { compact } from '@shared/format';
import type { SpecView } from '@shared/types';
import { CadViewport, download } from '@/components/product-cad';
import { api } from '@/state/api';
import { useTheme } from '@/state/theme';

export function Solid({ view, selected }: { view: SpecView; selected: string | null }) {
  const { theme } = useTheme();
  const [cutaway, setCutaway] = useState(true);
  const query = useQuery({ queryKey: ['library', 'cad', view.spec.id, view.version.number, view.version.content_sha256], enabled: false, staleTime: Infinity, retry: false,
    queryFn: () => api.op<ProductCad>('library.geometry', { spec: view.spec.id, version: view.version.number }) });
  const data = query.data;
  if (!data) {
    return <div className="ws-solid-empty">
      <Box size={28} strokeWidth={1.5} />
      <b>{query.isFetching ? '正在构造实体并校验…' : '这一版还没有三维实体'}</b>
      <p>用这一版保存的尺寸、材料和构造参数调用 CadQuery / OpenCASCADE 建模，同时导出 STEP。缺少必要参数时明确拒绝，不推测单丝、节距或制造细节。</p>
      {query.error && <p role="alert" className="ws-error-text">未生成：{query.error.message}</p>}
      <button type="button" className="ws-button" data-variant="primary" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? '正在建模…' : '生成三维实体'}</button>
    </div>;
  }
  return <div className="ws-solid">
    <CadViewport data={data} cutaway={cutaway} selected={selected ?? ''} background={theme === 'dark' ? '#1b1e22' : '#eef0f3'} />
    <div className="ws-solid-tools">
      <div className="ws-segmented" role="radiogroup" aria-label="实体显示">
        <button type="button" role="radio" aria-checked={cutaway} onClick={() => setCutaway(true)}>分层剖开</button>
        <button type="button" role="radio" aria-checked={!cutaway} onClick={() => setCutaway(false)}>完整实体</button>
      </div>
      <button type="button" className="ws-button" onClick={() => download(data.model.step_text, `${view.series.designation}-${view.spec.key}-第${view.version.number}版.step`, 'application/step')}>
        <Download size={15} />下载 STEP 实体</button>
      <button type="button" className="ws-button" data-variant="ghost" onClick={() => download(JSON.stringify(data, null, 2), `${view.spec.key}-CAD来源.json`, 'application/json')}>建模来源</button>
    </div>
    <p className="ws-solid-note">外径 {compact(data.model.outer_diameter_m * 1000)} mm · 显示长度 {compact(data.model.length_m * 1000)} mm · 拖动旋转、滚轮缩放。线芯按截面直线拉伸，不含成缆扭转、接触形变和制造公差。
      {data.warnings.length > 0 && ` 建模提示 ${data.warnings.length} 项：${data.warnings.map(item => item.message).join('；')}`}</p>
  </div>;
}
