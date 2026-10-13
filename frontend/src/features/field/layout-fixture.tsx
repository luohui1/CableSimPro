/** Display-only browser fixture; never imported by the production entry. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/600.css';
import 'virtual:design-tokens.css';
import { FieldView } from './field-view';
import { PreflightDialog } from '@/components/preflight-dialog';

/** Read the host's saved rejection; never executes or fabricates a preflight. */
export function renderSavedPreflight(data: Record<string, unknown>) {
  function ReadSaved() {
    const [open, setOpen] = useState(true);
    return <PreflightDialog open={open} onOpenChange={setOpen} method="IEC 60287 · 已保存适用性检查"
      loading={false} data={data} ack={false} onAck={() => {}} running={false} disabled={false}
      onRun={() => { throw Error('不可运行不覆盖工况'); }}
      onMissing={() => { throw Error('不应要求修正分层'); }} missingLabel={() => '电缆分层参数'} />;
  }
  createRoot(document.getElementById('root')!).render(<ReadSaved />);
}

export function renderDirectField() {
  const points: [number, number][] = [], triangles: [number, number, number][] = [], values: number[] = [];
  for (let z = 0; z <= 30; z++) for (let x = 0; x <= 60; x++) {
    const px = (x - 30) / 10, pz = (z - 30) / 10;
    points.push([px,pz]); values.push(20 + 80 * Math.exp(-((px * px) + (pz + 1.5) ** 2)));
    if (z < 30 && x < 60) { const i = z * 61 + x; triangles.push([i,i+1,i+61],[i+1,i+62,i+61]); }
  }
  createRoot(document.getElementById('test')!).render(<FieldView points={points} triangles={triangles} values={values} groundZ={0}
    circles={[-.35,0,.35].map((x,i)=>({x,z:-1.5,r:.12,label:`回路 ${i+1} · 排管`} ))}
    hotspot={{point:[0,-1.5],value:100,label:'最热导体'}} limit={{value:90,label:'允许导体温度'}} label="场图布局测试（非工程结果）" />);
}

/** Batch forms reuse this control; test its units without mounting another page. */
export async function renderNumberFields() {
  const [{ NumberField }, { engineeringQuantity }] = await Promise.all([
    import('@/components/ui/number-field'), import('@/lib/format'), import('@/styles/theme.css'),
  ]);
  const soil = engineeringQuantity('thermal_resistivity', 1, 'K.m/W');
  createRoot(document.getElementById('test')!).render(<>
    <NumberField label="埋深下限" value={1} unit="m" required path="batch-axis-0-minimum" />
    <NumberField label="土壤热阻率下限" value={1} unit={soil.unit} required path="batch-axis-1-minimum" />
  </>);
}
