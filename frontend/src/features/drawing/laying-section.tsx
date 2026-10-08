import { useId, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { worldToScreen, zoomView } from './coordinates';
import { sectionComposition } from './section-composition';
import { SectionLabels } from './section-labels';
import { DimensionEditor } from './dimension-editor';
import { moveSelection, sectionGeometry, validateSectionEdit } from './section-geometry';
import { savedThermal } from '../cad/saved-thermal';
import { TemperatureSlice } from '../cad/temperature-slice';
import { turbo } from '../field/colormap';
import { useWhatIf } from './use-what-if';
import { WhatIfDimensions } from './what-if-dimensions';
import { editDimension, sectionDimensions, SectionDimensions, type SectionDimension } from './section-dimensions';
import { CableDetail, SectionObjects } from './section-objects';
import { SectionOverview } from './section-overview';
import { drawingShortcut } from './use-drawing-shortcuts';
import { formatNumber } from '@/lib/format';
import { useCanvasSize } from './use-canvas-size';
import { useSectionGesture } from './use-section-gesture';
import type { DrawingView, LayingSectionProps, Section, SectionEdit, TemplateOption } from './types';
import './drawing.css';

const defaultTemplates: readonly TemplateOption[] = [
  { id: 'single', label: '单回' }, { id: 'double', label: '双回' }, { id: 'duct', label: '排管' },
  { id: 'backfill', label: '回填' }, { id: 'three-core', label: '三芯' },
];
export function LayingSection(input: LayingSectionProps) {
  const baseline = useMemo(() => { try { return input.thermal || (input.run && input.document ? savedThermal(input.run, input.document, input.sectionId, input.fieldCase) : undefined); } catch { return undefined; } }, [input.thermal, input.run, input.document, input.sectionId, input.fieldCase]);
  const trial = useWhatIf(input.document, input.sectionId, input, baseline, input.editable === false || input.state === 'historical' || input.state === 'empty' || input.state === 'error');
  const props: LayingSectionProps = trial.enabled ? { ...input, document: trial.document, onChange: (s, edit) => trial.commit(s, edit, input.isLocked),
    onPreview: undefined, onTemplateRequest: undefined, onObjectCommand: undefined, objectCommands: [],
    onCommand: trial.command, canUndo: trial.canUndo, canRedo: trial.canRedo } : input;
  const { host, size } = useCanvasSize();
  const section = props.document?.sections.find(item => item.id === props.sectionId) || null;
  const [view, setView] = useState<DrawingView | null>(null);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [snap, setSnap] = useState(true);
  const [followEnclosure, setFollowEnclosure] = useState(true);
  const [showDimensions, setShowDimensions] = useState(props.showDimensions || false);
  const [showResults, setShowResults] = useState(true);
  const clipId = useId();
  const [template, setTemplate] = useState((props.templates || defaultTemplates)[0]?.id || 'single');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SectionDimension | null>(null);
  const pending = useRef(false);
  const state = props.state || (section ? 'success' : 'empty');
  const editable = props.editable !== false && !!props.onChange && state === 'success' && !busy;
  const calculated = useMemo(() => {
    if (!props.document || !section) return { geometry: null, error: '' };
    try { return { geometry: sectionGeometry(props.document, section), error: '' }; }
    catch (error) { return { geometry: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [props.document, section]);
  const plotTop = host.current?.closest('.workbench-canvas') ? 96 : 56;
  const composition = calculated.geometry && section ? sectionComposition(section, calculated.geometry, size, plotTop) : null;
  const detail = !view ? composition?.detail : undefined;
  const camera = view || composition?.main || { x: 0, z: -.5, widthM: 2 };
  const objectCamera = detail?.view || camera;
  const report = (error: unknown) => setProblem(error instanceof Error ? error.message : String(error));
  async function commit(next: Section, edit: SectionEdit) {
    if (pending.current) throw new Error('上一项改动正在提交，请稍后再试。');
    if (!editable || !props.document) throw new Error('敷设截面当前只读。');
    if (trial.enabled && followEnclosure && edit.kind === 'dimension' && edit.selection?.kind === 'cable' && section) {
      const before = section.placements.find(p => p.cable === edit.selection!.id), after = next.placements.find(p => p.cable === edit.selection!.id);
      if (before && after) { const moved = moveSelection(section, edit.selection, { x: after.x - before.x, z: after.z - before.z }, true); next = moved.section; edit = { ...edit, fields: moved.fields }; }
    }
    validateSectionEdit(props.document, next, edit.fields, props.isLocked);
    pending.current = true; setBusy(true); setProblem('');
    try { await props.onChange?.(next, edit); }
    finally { pending.current = false; setBusy(false); }
  }
  const gesture = useSectionGesture({ props, section, view: camera, objectView: objectCamera, size, snap, followEnclosure, tool, editable,
    setView, commit, report });
  const displayed = gesture.preview || section;
  const currentGeometry = useMemo(() => {
    if (!props.document || !displayed) return null;
    try { return sectionGeometry(props.document, displayed); } catch { return calculated.geometry; }
  }, [props.document, displayed, calculated.geometry]);
  const thermal = state === 'empty' || state === 'error' ? undefined : trial.enabled ? trial.thermal : input.thermal;
  const temperatureColors = thermal && currentGeometry ? Object.fromEntries(currentGeometry.cables.map(c => [c.id, Object.fromEntries(c.shape.rings.flatMap(r => {
    if (r.target.role !== 'conductor') return [];
    const core = r.target.scope === 'core' ? r.target.coreId : undefined;
    const value = thermal.conductors.find(t => t.id === c.id && (!t.coreId || t.coreId === core))?.value;
    return value === undefined ? [] : [[r.id, '#' + turbo((value - thermal.minimum) / Math.max(1e-6, thermal.maximum - thermal.minimum)).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')]];
  }))])) : undefined;
  const availableAnnotations = trial.enabled ? thermal ? Object.fromEntries(thermal.conductors.map(c => [c.id, { label: `${c.value.toFixed(1)} °C`, limiting: c.hottest }])) : undefined : props.annotations;
  const annotations = showResults ? availableAnnotations : undefined;
  const projector = useMemo(() => ({ project: (x: number, _y: number, z: number) => worldToScreen({ x: x / 1000, z: z / 1000 }, objectCamera, size) }), [objectCamera.x, objectCamera.z, objectCamera.widthM, size.width, size.height]);
  const selected = props.selectedObject || null;
  const dimensions = displayed && currentGeometry ? sectionDimensions(displayed, currentGeometry, selected, objectCamera, size, showDimensions)
    .filter(d => !detail || d.field !== 'depth').map(d => detail ? { ...d, outside: true } : d) : [];
  const error = props.error || calculated.error || (state === 'error' ? '敷设输入读取失败，请重试。' : '');
  const focusCanvas = () => requestAnimationFrame(() => gesture.svg.current?.focus());
  const dismiss = () => { setEditing(null); focusCanvas(); };

  async function applyTemplate() {
    if (!props.onTemplateRequest || !editable || pending.current) return;
    pending.current = true; setBusy(true); setProblem('');
    try { await props.onTemplateRequest(template); }
    catch (error) { report(error); }
    finally { pending.current = false; setBusy(false); }
  }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (drawingShortcut(event, state === 'historical' ? undefined : props.onCommand)) return;
    if ((event.target as HTMLElement).closest('input,textarea,[role=combobox]')) return;
    if (event.key === 'Escape') { event.preventDefault(); gesture.cancel(); if (editing) dismiss(); else props.onSelectionChange?.(null); }
    if (event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'f') { event.preventDefault(); setView(null); }
    if (key === 'v') setTool('select');
    if (key === 'h') setTool('pan');
    if (key === 's') setSnap(value => !value);
    if (['+', '=', '-'].includes(key)) { event.preventDefault(); setView(zoomView(camera, key === '-' ? 1.2 : 1 / 1.2, { x: size.width / 2, y: size.height / 2 }, size)); }
    if (key === 'delete' && editable && selected && (!props.objectCommands || props.objectCommands.includes('delete'))) props.onObjectCommand?.('delete', selected);
  }
  return <div className={`drawing-frame laying-section ${props.className || ''}`} aria-label={props.label || '敷设截面编辑器'}
    data-laying-section-state={error ? 'error' : state} aria-busy={busy || state === 'loading'} onKeyDown={keyDown}>
    {state === 'historical' && <StaleBanner description="历史敷设截面保持只读。" />}
    {trial.controls}
    {trial.enabled && section && <div className="what-if-dimension-slot"><WhatIfDimensions section={section} selected={selected} commit={(next, edit) => trial.commit(next, edit, input.isLocked)} /></div>}
    <div className="drawing-toolbar" role="toolbar" aria-label="敷设截面工具">
      <IconButton icon="tool/select" label="选择 V" aria-pressed={tool === 'select'} onClick={() => setTool('select')} />
      <IconButton icon="tool/pan" label="平移 H" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')} />
      <IconButton icon="tool/fit" label="适配敷设截面 F" onClick={() => setView(null)} disabled={!currentGeometry} />
      <IconButton icon="tool/snap" label="捕捉 S" aria-pressed={snap} onClick={() => setSnap(value => !value)} />
      <IconButton icon="tool/zoom-in" label="放大敷设截面" disabled={!currentGeometry} onClick={() => setView(zoomView(camera, 1 / 1.2, { x: size.width / 2, y: size.height / 2 }, size))} />
      <IconButton icon="tool/zoom-out" label="缩小敷设截面" disabled={!currentGeometry} onClick={() => setView(zoomView(camera, 1.2, { x: size.width / 2, y: size.height / 2 }, size))} />
      <Button size="compact" aria-pressed={showDimensions} onClick={() => setShowDimensions(value => !value)}>尺寸链</Button>
      <Button size="compact" aria-pressed={showResults} disabled={!availableAnnotations || !Object.keys(availableAnnotations).length} onClick={() => setShowResults(value => !value)}>图上显示</Button>
      <Button size="compact" aria-pressed={followEnclosure} onClick={() => setFollowEnclosure(value => !value)}>管缆联动</Button>
      {!trial.enabled && <><Select label="模板" value={template} options={(props.templates || defaultTemplates).map(option => ({ value: option.id, label: option.label, disabled: option.disabled }))}
        onChange={setTemplate} disabled={!editable || !props.onTemplateRequest} />
      <Button size="compact" onClick={() => void applyTemplate()} disabled={!editable || !props.onTemplateRequest} loading={busy}>应用模板</Button></>}
      <span className="spacer" />
      {/* 对象操作只在选中对象且宿主提供命令时出现，避免一排灰按钮占位 */}
      {selected && !!props.onObjectCommand && (!props.objectCommands || props.objectCommands.length > 0) && <div className="drawing-object-tools" role="toolbar" aria-label="所选敷设对象操作">
        <span className="drawing-selected-label">{selected.id}</span>
        {(['duplicate', 'delete', 'parallel', 'trefoil', 'align'] as const).map(command => <Button key={command} size="compact"
          disabled={!editable || !props.onObjectCommand || !!props.objectCommands && !props.objectCommands.includes(command)
            || ['parallel', 'trefoil'].includes(command) && selected.kind !== 'cable'}
          onClick={() => props.onObjectCommand?.(command, selected)}>{({ duplicate: '复制', delete: '删除', parallel: '平排', trefoil: '品字', align: '对齐' })[command]}</Button>)}
      </div>}
      <IconButton icon="action/undo" label="撤销 Ctrl+Z" disabled={!props.canUndo || !props.onCommand || state === 'historical'} onClick={() => props.onCommand?.('undo')} />
      <IconButton icon="action/redo" label="重做 Ctrl+Y" disabled={!props.canRedo || !props.onCommand || state === 'historical'} onClick={() => props.onCommand?.('redo')} />
    </div>
    {problem && <div className="drawing-error" role="alert">{problem}</div>}
    <div ref={host} className="drawing-stage" data-tool={tool} data-dragging={gesture.dragging}>
      {thermal && !detail && <TemperatureSlice thermal={thermal} controller={projector} projectionKey={objectCamera} width={size.width} height={size.height} visible={!gesture.dragging} showHotspot={false} legendSide="left" onSelect={id => props.onSelectionChange?.({ kind: 'cable', id })} />}
      {state === 'loading' && !currentGeometry ? <LoadingState title="正在读取敷设截面" />
        : state === 'empty' || !section ? <EmptyState title="尚无敷设截面" description="选择敷设区段后查看和编辑。" />
          : error || !currentGeometry || !displayed ? <ErrorState title="敷设截面不可用" description={error || '输入缺少可绘制结构。'}
            action={props.onRetry && <Button size="compact" onClick={props.onRetry}>重新读取</Button>} />
            : <>
              <svg ref={gesture.svg} className="drawing-svg" tabIndex={0} viewBox={`0 0 ${size.width} ${size.height}`}
                data-drawing-canvas="laying" aria-label="敷设截面，单位 m，V 选择，H 平移，S 捕捉，F 全览"
                onPointerDown={gesture.beginBackground} onPointerMove={gesture.move} onPointerUp={gesture.finish}
                onPointerCancel={gesture.cancel} onClick={gesture.backgroundClick} onWheel={event => {
                  if (editing || gesture.dragging) return; event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setView(zoomView(camera, event.deltaY > 0 ? 1.12 : 1 / 1.12, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, size));
                }}>
                <SectionGrid view={camera} size={size} />
                <SectionObjects section={displayed} geometry={currentGeometry} view={camera} size={size} selected={selected}
                  onSelect={detail ? undefined : props.onSelectionChange} onPointer={detail ? undefined : gesture.begin} editable={!detail && editable} miniature={!!detail} showLabels={false} colors={temperatureColors} />
                {detail && composition && <>
                  <rect className="drawing-detail-frame" x={detail.rect.x} y={detail.rect.y} width={detail.rect.width} height={detail.rect.height} />
                  <text className="drawing-text" x={detail.rect.x + 16} y={detail.rect.y + 24}>详图 A · 放大 {formatNumber(detail.factor, 1)} 倍</text>
                  <defs><clipPath id={clipId}><rect x={detail.plot.x} y={detail.plot.y} width={detail.plot.width} height={detail.plot.height} /></clipPath></defs>
                  <g data-section-detail="A" clipPath={`url(#${clipId})`}>
                    {thermal && <foreignObject x="0" y="0" width={size.width} height={size.height}><div className="drawing-detail-field">
                      <TemperatureSlice thermal={thermal} controller={projector} projectionKey={objectCamera} width={size.width} height={size.height} visible={!gesture.dragging} showHotspot={false} legendSide="right" onSelect={id => props.onSelectionChange?.({ kind: 'cable', id })} />
                    </div></foreignObject>}
                    <SectionObjects section={displayed} geometry={currentGeometry} view={objectCamera} size={size} selected={selected} showLabels={false}
                      onSelect={props.onSelectionChange} onPointer={gesture.begin} editable={editable} colors={temperatureColors} />
                    {props.document && <SectionLabels document={props.document} section={displayed} geometry={currentGeometry} view={objectCamera} size={size} rect={detail.plot} annotations={annotations} />}
                  </g>
                  {(() => { const b = composition.group, center = worldToScreen({ x: (b.left + b.right) / 2, z: (b.top + b.bottom) / 2 }, camera, size);
                    const rx = Math.max(12, (b.right - b.left) * size.width / camera.widthM / Math.SQRT2 + 4);
                    const ry = Math.max(12, (b.top - b.bottom) * size.width / camera.widthM / Math.SQRT2 + 4);
                    const cable = currentGeometry.cables.find(c => c.id === selected?.id) || currentGeometry.cables[0];
                    const groundY = worldToScreen({ x: 0, z: 0 }, camera, size).y, cableY = worldToScreen(cable, camera, size).y;
                    return <g className="drawing-detail-source">
                      <ellipse className="drawing-detail-leader" cx={center.x} cy={center.y} rx={rx} ry={ry} /><path className="drawing-detail-leader" d={`M${center.x + rx} ${center.y}L${detail.rect.x} ${detail.rect.y + detail.rect.height / 2}`} />
                      <text className="drawing-text" x={center.x} y={center.y - ry - 8} textAnchor="middle">A</text>
                      {section?.kind === 'ground' && <g className="drawing-dimensions" data-detail-depth>
                        <text x="24" y={groundY - 10}>地表 ±0.000 m</text>
                        <path d={`M24 ${groundY}V${cableY}M18 ${groundY + 5}l12 -10M18 ${cableY + 5}l12 -10M24 ${groundY}H${center.x}M24 ${cableY}H${center.x}`} />
                        <g data-section-dimension="depth" className={`drawing-dimension-chip ${editable ? 'is-editable' : ''}`} role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined}
                          aria-label={`${editable ? '编辑' : '查看'}中心埋深，单位 m`} onDoubleClick={() => { if (editable) setEditing({ selection: { kind: 'cable', id: cable.id }, field: 'depth', label: '中心埋深', valueM: -cable.z, x: 120, y: (groundY + cableY) / 2 }); }}
                          onKeyDown={event => { if (editable && event.key === 'Enter') { event.stopPropagation(); setEditing({ selection: { kind: 'cable', id: cable.id }, field: 'depth', label: '中心埋深', valueM: -cable.z, x: 120, y: (groundY + cableY) / 2 }); } }}>
                          <text x="36" y={(groundY + cableY) / 2}>中心埋深 {formatNumber(-cable.z, 3)} m</text>
                        </g>
                      </g>}
                    </g>; })()}
                </>}
                {!detail && props.document && <SectionLabels document={props.document} section={displayed} geometry={currentGeometry} view={camera} size={size}
                  rect={{ x: 0, y: plotTop, width: size.width, height: Math.max(1, size.height - plotTop - 8) }} annotations={annotations} />}
                {gesture.guides && <path className="drawing-snap-guide" d={`M0 ${worldToScreen(gesture.guides, objectCamera, size).y}H${size.width}M${worldToScreen(gesture.guides, objectCamera, size).x} 0V${size.height}`} />}
                <SectionDimensions dimensions={dimensions} geometry={currentGeometry} view={camera} size={size} editable={editable} onEdit={setEditing} />
                {!detail && !trial.enabled && selected?.kind === 'cable' && currentGeometry.cables.find(cable => cable.id === selected.id) && <CableDetail
                  cable={currentGeometry.cables.find(cable => cable.id === selected.id)!} view={camera} size={size} />}
                {editing && state === 'success' && props.editable !== false && <DimensionEditor x={Math.max(8, Math.min(size.width - 232, editing.x - 112))}
                  y={Math.max(8, Math.min(size.height - 156, editing.y + 14))} label={editing.label} value={editing.valueM} unit="m"
                  onCancel={dismiss} onCommit={async value => {
                    if (!section) throw new Error('敷设区段已不存在。');
                    const result = editDimension(section, editing, value);
                    await commit(result.section, { gestureId: crypto.randomUUID(), kind: 'dimension', selection: editing.selection, fields: result.fields });
                  }} />}
              </svg>
            </>}
    </div>
    {dimensions.some(dimension => dimension.outside) && <div className="drawing-overflow-dimensions" aria-label="图外尺寸标注">{dimensions.filter(dimension => dimension.outside).map(dimension => <Button key={`${dimension.selection.kind}/${dimension.selection.id}/${dimension.field}`} size="compact" variant="ghost" disabled={!editable}
      onClick={() => setEditing(dimension)}>{currentGeometry?.cables.find(cable => cable.id === dimension.selection.id)?.label || dimension.selection.id} · {dimension.label} {formatNumber(dimension.valueM, 3)} m</Button>)}</div>}
    {!detail && !error && state !== 'empty' && currentGeometry && displayed && <SectionOverview section={displayed}
      geometry={currentGeometry} view={camera} size={size} onView={setView} />}
    <div className="drawing-status"><span>{section?.label || '敷设截面'} · m</span><span>{state === 'loading' || busy ? '正在更新' : editable ? '可编辑' : '只读'}</span>
      <span>{snap ? `捕捉 ${(props.snapStepM ?? .001) * 1000} mm` : '捕捉关闭'}</span><span>{selected ? selected.id : '选择对象查看尺寸'}</span></div>
  </div>;
}

function SectionGrid({ view, size }: { view: DrawingView; size: { width: number; height: number } }) {
  const step = 10 ** Math.floor(Math.log10(view.widthM / 8));
  const left = view.x - view.widthM / 2, right = view.x + view.widthM / 2;
  const heightM = view.widthM * size.height / size.width;
  const bottom = view.z - heightM / 2, top = view.z + heightM / 2;
  const lines: string[] = [];
  for (let x = Math.ceil(left / step) * step; x <= right && lines.length < 100; x += step) {
    lines.push(`M${worldToScreen({ x, z: 0 }, view, size).x} 0V${size.height}`);
  }
  for (let z = Math.ceil(bottom / step) * step; z <= top && lines.length < 200; z += step) {
    lines.push(`M0 ${worldToScreen({ x: 0, z }, view, size).y}H${size.width}`);
  }
  return <path className="drawing-grid" d={lines.join('')} />;
}
