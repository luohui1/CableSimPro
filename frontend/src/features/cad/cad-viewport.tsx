import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { formatNumber } from '@/lib/format';
import { CadOverlay } from './cad-overlay';
import { ViewCube } from './view-cube';
import { TemperatureSlice } from './temperature-slice';
import { useCadViewport } from './use-cad-viewport';
import { exportCadImage } from './export-image';
import { colorScene } from './saved-thermal';
import { sceneMaterialColors, tokenColor } from './cad-renderer';
import { layerId } from './geometry-contract';
import { layerNames } from '../drawing/cable-geometry';
import type { CadMode, CadViewportHandle, CadViewportProps, MeasurementMode } from './types';
import './cad.css';

export const CadViewport = forwardRef<CadViewportHandle, CadViewportProps>(function CadViewport(props, ref) {
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => { const observer = new MutationObserver(() => setThemeVersion(v => v + 1)); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect(); }, []);
  const geometry = useMemo(() => props.geometry?.schema === 'cablesim.cad-scene/1'
    ? colorScene(sceneMaterialColors(props.geometry, document.documentElement), props.thermal, ['--brand-primary', '--error', '--fill'].map(name => tokenColor(document.documentElement, name))) : props.geometry, [props.geometry, props.thermal, themeVersion]);
  const viewport = useCadViewport({ ...props, geometry });
  const stage = useRef<HTMLDivElement>(null);
  const exportBusy = useRef(false);
  const downloadBusy = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [slice, setSlice] = useState(true);
  const { instance, busy, camera, displayed } = viewport;
  const state = props.state || (props.geometry ? 'success' : 'empty');
  const scene = props.geometry?.schema === 'cablesim.cad-scene/1';
  const ready = !!instance && !!displayed;
  const disabled = !ready || busy || viewport.measurementBusy || exporting;
  const error = props.error || (props.geometry ? viewport.problem : '') || (state === 'error' ? '几何工件读取失败，请重试。' : '');
  const bounds = viewport.host.current?.getBoundingClientRect();
  const sceneObject=props.geometry?.schema==='cablesim.cad-scene/1'?props.geometry.objects.find(o=>o.id===props.selectedObject?.id)||props.geometry.objects.find(o=>o.kind==='cable'):undefined;
  async function exportImage() {
    if (exportBusy.current) throw Error('三维图片正在导出，请等待。');
    if (!stage.current || !instance || !displayed || !camera || busy || error) throw Error('三维视口尚未完成，无法导出。');
    exportBusy.current = true; setExporting(true); setExportError('');
    try { return await exportCadImage(stage.current, instance, displayed, camera, slice ? props.thermal : props.thermal ? { ...props.thermal, triangles: [] } : undefined); }
    catch (reason) { setExportError(reason instanceof Error ? reason.message : String(reason)); throw reason; }
    finally { exportBusy.current = false; setExporting(false); }
  }
  async function downloadImage() {
    if (downloadBusy.current) return;
    downloadBusy.current = true;
    try {
      const image = await exportImage();
      exportBusy.current = true; setExporting(true);
      if (props.onExport) await props.onExport(image);
      else { const url = URL.createObjectURL(image.blob), link = document.createElement('a'); link.href = url; link.download = '三维视图.png'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (reason) { setExportError(reason instanceof Error ? reason.message : String(reason)); }
    finally { downloadBusy.current = false; exportBusy.current = false; setExporting(false); }
  }
  useImperativeHandle(ref, () => ({
    fit: () => viewport.controller.current?.fit(), zoom: factor => viewport.controller.current?.zoom(factor),
    view: view => viewport.controller.current?.view(view), info: () => viewport.controller.current?.info() || null, exportImage,
    project: (x, y, z) => viewport.controller.current?.project(x, y, z) || null,
  }));
  const modes: [CadMode, string][] = scene ? [['scene', '全景'], ['section', '剖面']]
    : [['peel', '剥切'], ['section', '剖面'], ['transparent', '透明']];

  return <div className={`cad-viewport ${props.className || ''}`} data-cad-state={error ? 'error' : state}
    data-cad-ready={ready} data-cad-selected={props.selectedObject?.id} data-cad-first-display-ms={viewport.firstDisplayMs}
    data-cad-result-state={props.resultState} data-cad-exporting={exporting} data-cad-distance-mm={viewport.pick?.distance_mm}
    data-cad-model-kind={displayed?.envelope ? 'envelope' : displayed ? 'precise' : undefined}
    data-cad-view={camera?.view} data-cad-mode={viewport.mode} aria-label={props.label || '三维 CAD 视口'}
    aria-busy={busy || state === 'loading' || viewport.measurementBusy}>
    {state === 'historical' && <StaleBanner description="输入已变化，保留原几何快照。" />}
    {props.controls && <div className="cad-field-tools" inert={exporting} role="toolbar" aria-label="保存温度场对照">{props.controls}</div>}
    <div ref={stage} className="cad-stage" data-layer-legend={!!ready && !scene && viewport.mode === 'peel'}>
      {ready && displayed?.schema === 'cablesim.cad-model/1' && viewport.mode === 'peel' && (props.layerLabels!=='selected'||props.selectedObject) && <aside className="cad-layer-list" aria-label="结构层材料与厚度">{displayed.layers.map((layer, index) => {
        if(props.layerLabels==='selected'&&layerId(layer)!==props.selectedObject?.id)return null;
        const id = layerId(layer), material = displayed.material_sources?.find(m => m.id === layer.material)?.label || '材料未命名';
        const thickness = typeof layer.construction?.thickness === 'number' ? layer.construction.thickness : layer.outer_radius_m - layer.inner_radius_m;
        return <Button variant="ghost" key={id} aria-pressed={props.selectedObject?.id === id} data-cad-layer-annotation={id} onClick={() => props.onSelectionChange?.({kind:'layer',id})}>
          <span>{index + 1} · {layer.label || layerNames[layer.role] || '结构层'}</span><span>{material}</span><span>{layer.role === 'conductor' ? 'Ø ' + formatNumber(layer.outer_radius_m * 2000, 1) : '厚 ' + formatNumber(thickness * 1000, 2)} mm</span>
        </Button>;
      })}</aside>}
      <div ref={viewport.host} className="cad-canvas-host" />
      {ready && camera && bounds && props.thermal && <TemperatureSlice thermal={props.thermal} controller={instance!}
        camera={camera} width={bounds.width} height={bounds.height} visible={slice} onSelect={id => props.onSelectionChange?.({ kind: 'object', id })} />}
      {ready && camera && displayed && bounds && <CadOverlay geometry={displayed} selected={props.selectedObject || null}
        camera={camera} controller={instance!} width={bounds.width} height={bounds.height} points={viewport.points} cursor={viewport.measurement === 'point' ? viewport.pick : undefined} onSelect={value => props.onSelectionChange?.(value)} />}
      {!error && (state === 'empty' || !props.geometry && state !== 'loading') ? <div className="cad-state-overlay"><EmptyState title="尚无几何工件"
        description="取得型号单根电缆或敷设场景的几何工件后查看。" /></div>
        : !ready && !error ? <div className="cad-state-overlay"><LoadingState title="正在打开三维视口" description={props.hasSavedInput?'已保存输入保留。':undefined} /></div> : null}
      {error && <div className={ready ? 'cad-error-bar' : 'cad-state-overlay'}><ErrorState title={ready ? '预览未更新' : '视口不可用'}
        description={error} action={<><Button size="compact" onClick={viewport.retry}>重载视口</Button>{props.onFallback && <Button size="compact" onClick={props.onFallback}>切回二维</Button>}</>} /></div>}
      {(bounds?.height||0)>=140 && <ViewCube disabled={disabled} selected={camera?.view} onView={view => instance?.view(view)} />}
      </div>
      <div className="cad-tools" role="toolbar" aria-label="三维查看工具">
        {modes.map(([mode, label]) => <Button key={mode} size="compact" disabled={disabled}
          aria-pressed={viewport.mode === mode} onClick={() => viewport.changeMode(mode)}>{label}</Button>)}
        {!!props.thermal?.triangles.length && <Button size="compact" disabled={disabled} aria-pressed={slice} onClick={() => setSlice(v => !v)}>
          {props.thermal.kind === 'iec' ? '土壤切片' : '温度切片'}</Button>}
        <IconButton icon="tool/fit" label="适应窗口 F" disabled={disabled} onClick={() => instance?.fit()} />
        <IconButton icon="tool/zoom-out" label="缩小三维" disabled={disabled} onClick={() => instance?.zoom(.85)} />
        <IconButton icon="tool/zoom-in" label="放大三维" disabled={disabled} onClick={() => instance?.zoom(1.15)} />
        <Select label="选择方式" value={viewport.measurement}
          disabled={disabled || !!props.onObjectMove || !scene && !!displayed?.envelope} options={[
            { value: 'part', label: scene ? '对象' : '整层' }, ...(!scene ? [{ value: 'diameter', label: '原始直径', disabled: !props.selectedObject }] : []),
            { value: 'point', label: '两点距离', disabled: !scene && !props.selectedObject },
          ]} onChange={value => void viewport.changeMeasurement(value as MeasurementMode)} />
        <Button size="compact" disabled={disabled || !!error} onClick={() => void downloadImage()}>{exporting ? '导出中' : '导出 PNG'}</Button>
      </div>
      {(busy && ready || viewport.measurementBusy) && <span className="cad-updating" role="status">
        {viewport.measurementBusy ? '读取精确拓扑' : '更新显示'}</span>}
      {props.resultStatus !== null && (props.resultStatus || props.thermal?.notice) && !(busy && ready) && <span className="cad-result-status" role="status" title={props.thermal ? `${props.thermal.runLabel || '保存运行'} · 工况 ${props.thermal.caseId}` : undefined}>{[props.resultStatus, props.thermal?.notice].filter(Boolean).join(' · ')}</span>}
      {exportError && <span className="cad-slice-error" role="alert">{exportError}</span>}
    <div className="cad-status"><span>mm</span><span>{displayed?.display_source === 'domain-input' ? '输入几何 · 展示段 0.4 m' : displayed?.envelope ? '包络预览' : displayed ? '原始几何' : '三维查看'}</span>
      {sceneObject?.dimensions&&<span>中心埋深 {formatNumber(sceneObject.dimensions.centerDepthM,3)} m · 外径 Ø {formatNumber((sceneObject.dimensions.outerDiameterM||0)*1000,1)} mm{sceneObject.dimensions.nearestCenterM!==undefined?` · 中心距 ${formatNumber(sceneObject.dimensions.nearestCenterM,3)} m`:''}</span>}
      <span>{viewport.measurement === 'point' ? viewport.pick?.measure_pending ? '已捕捉第一点；选择第二点' : Number.isFinite(viewport.pick?.distance_mm)
        ? `两点距离 ${formatNumber(viewport.pick!.distance_mm, 3)} mm` : '依次捕捉两个点'
        : viewport.measurement === 'diameter' ? Number.isFinite(viewport.pick?.diameter_mm) ? `原始直径 Ø ${formatNumber(viewport.pick!.diameter_mm, 3)} mm`
          : '捕捉选中层圆面或圆边' : scene ? '选择电缆或排管' : '选择整层轮廓'}</span>{scene && viewport.measurement === 'point' && <span title="量测来自显示网格，曲面弦差不大于 0.08 mm；不是原始 BREP 拓扑。">表面量测 · Esc 取消</span>}</div>
  </div>;
});
