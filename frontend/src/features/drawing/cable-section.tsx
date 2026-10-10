import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { formatNumber } from '@/lib/format';
import { cableShape, dimensionValue, targetId } from './cable-geometry';
import { CableShapes, LayerNumbers } from './cable-shapes';
import { worldToScreen, zoomView } from './coordinates';
import { DimensionEditor, DimensionInput } from './dimension-editor';
import { Dialog } from '@/components/ui/dialog';
import { useCanvasSize } from './use-canvas-size';
import { drawingShortcut } from './use-drawing-shortcuts';
import { sectorSize } from './cross-section-profile';
import { fitPlot } from './section-composition';
import type { CableSectionProps, DrawingView } from './types';
import './drawing.css';

export function CableSection(props: CableSectionProps) {
  const { host, size } = useCanvasSize();
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<DrawingView | null>(null);
  const [edit, setEdit] = useState(false);
  const [showDimensions, setShowDimensions] = useState(props.showDimensions || false);
  const calculated = useMemo(() => {
    if (!props.cableType) return { shape: null, problem: '' };
    try { return { shape: cableShape(props.cableType, props.materials), problem: '' }; }
    catch (error) { return { shape: null, problem: error instanceof Error ? error.message : String(error) }; }
  }, [props.cableType, props.materials]);
  const shape = calculated.shape;
  const compact = size.height < 260;
  const state = props.state || (props.cableType ? 'success' : 'empty');
  const problem = props.error || calculated.problem || (state === 'error' ? '电缆结构读取失败，请重试。' : '');
  const displayedCoreId = props.selectedObject?.scope === 'core' ? props.selectedObject.coreId : props.cableType?.cores[0]?.id;
  const labelCount = shape?.rings.filter(r => r.target.scope === 'common' || r.target.scope === 'core' && r.target.coreId === displayedCoreId).length || 0;
  const twoColumns = labelCount > Math.max(1, Math.floor((size.height - 136) / 34) + 1);
  const fitted = shape ? { x: twoColumns ? 0 : shape.radiusM * .35, z: -shape.radiusM * .1,
    widthM: 2 * shape.radiusM * size.width / Math.max(40, Math.min(size.width - (twoColumns ? 400 : 256), size.height - 160)) }
    : { x: 0, z: 0, widthM: .1 };
  const camera = view || (shape && compact ? fitPlot({left:-shape.radiusM,right:shape.radiusM,top:shape.radiusM,bottom:-shape.radiusM},size,{x:0,y:0,width:Math.max(80,size.width-224),height:size.height},16) : fitted);
  const selectedId = props.selectedObject ? targetId(props.selectedObject) : undefined;
  useEffect(() => { setEdit(false); }, [selectedId, props.cableType?.id, state]);
  const selected = shape?.rings.find(ring => ring.id === selectedId);
  const value = props.cableType && props.selectedObject ? dimensionValue(props.cableType, props.selectedObject) : null;
  const sector = selected?.profile.kind === 'sector' ? sectorSize(selected.profile) : null;
  const sectorConductor = !!sector && value?.field === 'diameter';
  const dimensionScale = sectorConductor ? 500 : 1000;
  const dimensionLabel = value?.field === 'diameter' ? sectorConductor ? '扇形高度' : '直径' : '厚度';
  const selectedCoreId = selected?.target.scope === 'core' ? selected.target.coreId : null;
  const selectedCore = props.cableType?.cores.find(core => core.id === selectedCoreId);
  const displayedCore = selectedCore || props.cableType?.cores[0];
  const equivalentCores = displayedCore ? (props.cableType?.cores || []).filter(core => core.id !== displayedCore.id
    && JSON.stringify([core.conductor, core.layers]) === JSON.stringify([displayedCore.conductor, displayedCore.layers])).map(core => core.id) : [];
  const editable = props.editable !== false && !!props.onDimensionChange && state === 'success'
    && !!selected && !props.isLocked?.(selected.target);
  const center = selected ? worldToScreen({ x: selected.centerX, z: selected.centerZ }, camera, size) : null;
  const scale = size.width / camera.widthM;
  const shapeBottom = shape ? worldToScreen({ x: 0, z: -shape.radiusM }, camera, size).y : 0;
  const dimensionY = center && selected ? shapeBottom + 36 : 0;

  function dismiss() { setEdit(false); requestAnimationFrame(() => svg.current?.focus()); }
  async function commitDimension(number: number) {
    if (!Number.isFinite(number) || number <= 0) throw new Error('请输入正尺寸，单位 mm。');
    if (!editable || !selected || !value) throw new Error('所选尺寸已锁定或保持只读。');
    await props.onDimensionChange?.({ target: selected.target, field: value.field, valueM: number / dimensionScale, previousValueM: value.valueM });
  }
  function select(target: Parameters<NonNullable<CableSectionProps['onSelectionChange']>>[0]) {
    setEdit(false); props.onSelectionChange?.(target);
  }

  return <div className={`drawing-frame cable-section ${props.className || ''}`} data-cable-section-state={problem ? 'error' : state}
    aria-label={props.label || '电缆等比例截面'} aria-busy={state === 'loading'} onKeyDown={event => {
      if (drawingShortcut(event, state === 'historical' ? undefined : props.onCommand)) return;
      if ((event.target as HTMLElement).closest('input,textarea')) return;
      if (event.key === 'Escape' && !edit) { event.preventDefault(); select(null); }
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); setView(null); }
    }}>
    {state === 'historical' && <StaleBanner description="原截面对应历史输入；尺寸保持只读。" />}
    <div className="drawing-toolbar" role="toolbar" aria-label="电缆截面工具">
      <IconButton icon="tool/fit" label="适应电缆截面 F" onClick={() => setView(null)} disabled={!shape} />
      <IconButton icon="tool/zoom-out" label="缩小电缆截面" disabled={!shape} onClick={() => setView(zoomView(camera, 1.2, { x: size.width / 2, y: size.height / 2 }, size))} />
      <IconButton icon="tool/zoom-in" label="放大电缆截面" disabled={!shape} onClick={() => setView(zoomView(camera, 1 / 1.2, { x: size.width / 2, y: size.height / 2 }, size))} />
      <Button size="compact" aria-pressed={showDimensions} disabled={!shape} onClick={() => setShowDimensions(value => !value)}>图上尺寸</Button>
    </div>
    <div ref={host} className="drawing-stage">
      {state === 'loading' && !shape ? <LoadingState title="正在读取电缆结构" />
        : state === 'empty' || !props.cableType ? <EmptyState title="尚无电缆结构" description="选择型号或提供电缆结构后查看截面。" />
          : problem || !shape ? <ErrorState title="截面不可用" description={problem || '结构尚未提供。'}
            action={props.onRetry && <Button size="compact" onClick={props.onRetry}>重新读取</Button>} />
            : <svg ref={svg} className="drawing-svg" viewBox={`0 0 ${size.width} ${size.height}`} tabIndex={0}
              aria-label="电缆截面，单位 mm" data-drawing-canvas="cable" onDoubleClick={event=>{if(editable&&(event.target as Element).closest('[data-layer-id]'))setEdit(true);}} onWheel={event => {
                if (edit) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                setView(zoomView(camera, event.deltaY > 0 ? 1.12 : 1 / 1.12,
                  { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, size));
              }}>
              <CableShapes shape={shape} view={camera} size={size} selectedId={selectedId} onSelect={select} />
              {!compact && <LayerNumbers rings={shape.rings} view={camera} size={size} selectedId={selectedId} onSelect={select} equivalentCores={equivalentCores} />}
              {!compact && (showDimensions || !!selected) && <g className="drawing-dimensions" data-cable-dimensions>
                {selected && center ? <>
                  {selected.profile.kind === 'circle' && <path d={`M${center.x - selected.outerM * scale} ${center.y}V${dimensionY + 6}M${center.x + selected.outerM * scale} ${center.y}V${dimensionY + 6}M${center.x - selected.outerM * scale} ${dimensionY}H${center.x + selected.outerM * scale}M${center.x - selected.outerM * scale - 5} ${dimensionY + 5}l10 -10M${center.x + selected.outerM * scale - 5} ${dimensionY + 5}l10 -10`} />}
                  {sectorConductor && <text x={size.width / 2} y={dimensionY - 28} textAnchor="middle">标称截面 {formatNumber((selectedCore?.conductor.nominal_area || 0) * 1e6, 0)} mm²</text>}
                  <text x={sector ? size.width / 2 : center.x} y={dimensionY - 8} textAnchor="middle">{sector
                    ? `宽 ${formatNumber(sector.widthM * 1000, 1)} × 高 ${formatNumber(sector.heightM * 1000, 1)} mm`
                    : `本层外径 Ø ${formatNumber(selected.outerM * 2000, 1)} mm`}</text>
                  <g className={`drawing-dimension-chip ${editable ? 'is-editable' : ''}`} role={editable ? 'button' : undefined}
                    tabIndex={editable ? 0 : undefined} aria-label={`${editable ? '编辑' : '查看'}${selected.name}${dimensionLabel}，单位 mm`}
                    data-dimension-trigger="cable" onDoubleClick={() => { if (editable) setEdit(true); }}
                    onKeyDown={event => { if (editable && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); setEdit(true); } }}>
                    <rect x={center.x - 76} y={dimensionY + 8} width="152" height="32" />
                    <text x={center.x} y={dimensionY + 29} textAnchor="middle">
                      {dimensionLabel} {formatNumber((value?.valueM || 0) * dimensionScale, 1)} mm
                    </text>
                  </g>
                </> : <text x={size.width / 2} y={size.height - 32} textAnchor="middle">绘图外径 Ø {formatNumber(shape.radiusM * 2000, 1)} mm</text>}
              </g>}
              {edit && !compact && selected && value && center && <DimensionEditor label={`${selected.name}${dimensionLabel}`}
                x={Math.max(8, Math.min(size.width - 232, center.x - 112))} y={Math.max(8, Math.min(size.height - 156, dimensionY - 24))}
                value={value.valueM * dimensionScale} unit="mm" onCancel={dismiss} onCommit={commitDimension} />}
            </svg>}
      {compact&&shape&&<div className="drawing-compact-layers" aria-label="结构层标注">{shape.rings.filter(r=>r.target.scope==='common'||r.target.coreId===displayedCoreId).map(r=><Button key={r.id} size="compact" variant="ghost" aria-pressed={selectedId===r.id} data-layer-number={r.number} onClick={()=>select(r.target)}>{r.number} {r.name} · {props.materials.find(m=>m.id===r.materialId)?.label||r.materialRole}<span>{r.target.role==='conductor'?'直径':'厚度'} {formatNumber((r.target.role==='conductor'?r.outerM*2:r.outerM-r.innerM)*1000,1)} mm</span></Button>)}</div>}
    </div>
    {compact && edit && selected && value && <Dialog open onOpenChange={open=>{if(!open)dismiss();}} title={`编辑${selected.name}${dimensionLabel}`}><DimensionInput label={`${selected.name}${dimensionLabel}`} value={value.valueM*dimensionScale} unit="mm" onCancel={dismiss} onCommit={commitDimension} /></Dialog>}
    {selected&&value&&<div className="drawing-layer-detail" aria-label="所选层尺寸与材料"><span>{selected.name} · {props.materials.find(m=>m.id===selected.materialId)?.label||'材料未提供'}</span><span>本层外径 Ø {formatNumber(selected.outerM*2000,1)} mm</span><Button size="compact" variant="ghost" disabled={!editable} onDoubleClick={()=>{if(editable)setEdit(true);}} onClick={()=>{if(editable)setEdit(true);}}>{dimensionLabel} {formatNumber(value.valueM*dimensionScale,1)} mm</Button></div>}
    <div className="drawing-status"><span>参数截面 · mm</span><span>{state === 'loading' ? '正在更新' : selected ? `${selected.number} ${selected.name}` : '选择结构层'}</span>
      <span>{editable ? '双击尺寸编辑' : (props.cableType?.cores.length || 0) > 1 ? `${props.cableType!.cores.length} 芯按原始位置绘制` : '等比例绘制'}</span></div>
  </div>;
}
