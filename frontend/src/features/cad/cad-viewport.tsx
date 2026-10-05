import { forwardRef, useImperativeHandle } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { formatNumber } from '@/lib/format';
import { CadOverlay } from './cad-overlay';
import { ViewCube } from './view-cube';
import { useCadViewport } from './use-cad-viewport';
import type { CadMode, CadViewportHandle, CadViewportProps, MeasurementMode } from './types';
import './cad.css';

export const CadViewport = forwardRef<CadViewportHandle, CadViewportProps>(function CadViewport(props, ref) {
  const viewport = useCadViewport(props);
  const { instance, busy, camera, displayed } = viewport;
  const state = props.state || (props.geometry ? 'success' : 'empty');
  const scene = props.geometry?.schema === 'cablesim.cad-scene/1';
  const ready = !!instance && !!displayed;
  const disabled = !ready || busy || viewport.measurementBusy;
  const error = props.error || (props.geometry ? viewport.problem : '') || (state === 'error' ? '几何工件读取失败，请重试。' : '');
  const bounds = viewport.host.current?.getBoundingClientRect();
  useImperativeHandle(ref, () => ({
    fit: () => viewport.controller.current?.fit(), zoom: factor => viewport.controller.current?.zoom(factor),
    view: view => viewport.controller.current?.view(view), info: () => viewport.controller.current?.info() || null,
  }), [viewport.controller]);
  const modes: [CadMode, string][] = scene ? [['scene', '全景'], ['section', '剖面']]
    : [['peel', '剥切'], ['section', '剖面'], ['transparent', '透明']];

  return <div className={`cad-viewport ${props.className || ''}`} data-cad-state={error ? 'error' : state}
    data-cad-model-kind={displayed?.envelope ? 'envelope' : displayed ? 'precise' : undefined}
    data-cad-view={camera?.view} data-cad-mode={viewport.mode} aria-label={props.label || '三维 CAD 视口'}
    aria-busy={busy || state === 'loading' || viewport.measurementBusy}>
    {state === 'historical' && <StaleBanner description="输入已变化，保留原几何快照。" />}
    <div className="cad-stage">
      <div ref={viewport.host} className="cad-canvas-host" />
      {ready && camera && displayed && bounds && <CadOverlay geometry={displayed} selected={props.selectedObject || null}
        camera={camera} controller={instance!} width={bounds.width} height={bounds.height} points={viewport.points} />}
      {!error && (state === 'empty' || !props.geometry && state !== 'loading') ? <div className="cad-state-overlay"><EmptyState title="尚无几何工件"
        description="取得型号单根电缆或敷设场景的几何工件后查看。" /></div>
        : !ready && !error ? <div className="cad-state-overlay"><LoadingState title="正在打开三维视口" description="已有输入与结果保留。" /></div> : null}
      {error && <div className={ready ? 'cad-error-bar' : 'cad-state-overlay'}><ErrorState title={ready ? '预览未更新' : '视口不可用'}
        description={error} action={<Button size="compact" onClick={viewport.retry}>重载视口</Button>} /></div>}
      <ViewCube disabled={disabled} selected={camera?.view} onView={view => instance?.view(view)} />
      <div className="cad-tools" role="toolbar" aria-label="三维查看工具">
        {modes.map(([mode, label]) => <Button key={mode} size="compact" disabled={disabled}
          aria-pressed={viewport.mode === mode} onClick={() => viewport.changeMode(mode)}>{label}</Button>)}
        <IconButton icon="tool/fit" label="适应窗口 F" disabled={disabled} onClick={() => instance?.fit()} />
        <IconButton icon="tool/zoom-out" label="缩小三维" disabled={disabled} onClick={() => instance?.zoom(.85)} />
        <IconButton icon="tool/zoom-in" label="放大三维" disabled={disabled} onClick={() => instance?.zoom(1.15)} />
        {!scene && <Select label="选择方式" value={viewport.measurement}
          disabled={disabled || !!displayed?.envelope} options={[
            { value: 'part', label: '整层' }, { value: 'diameter', label: '原始直径', disabled: !props.selectedObject },
            { value: 'point', label: '两点距离', disabled: !props.selectedObject },
          ]} onChange={value => void viewport.changeMeasurement(value as MeasurementMode)} />}
      </div>
      {(busy && ready || viewport.measurementBusy) && <span className="cad-updating" role="status">
        {viewport.measurementBusy ? '读取精确拓扑' : '更新显示'}</span>}
    </div>
    <div className="cad-status"><span>mm</span><span>{displayed?.envelope ? '包络预览' : displayed ? '原始几何' : '三维查看'}</span>
      <span>{viewport.measurement === 'point' ? viewport.pick?.measure_pending ? '已捕捉第一点；选择第二点' : Number.isFinite(viewport.pick?.distance_mm)
        ? `两点距离 ${formatNumber(viewport.pick!.distance_mm, 3)} mm` : '依次捕捉两个点'
        : viewport.measurement === 'diameter' ? Number.isFinite(viewport.pick?.diameter_mm) ? `原始直径 Ø ${formatNumber(viewport.pick!.diameter_mm, 3)} mm`
          : '捕捉选中层圆面或圆边' : '选择整层轮廓'}</span></div>
  </div>;
});
