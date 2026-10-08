import { useEffect, useRef, useState } from 'react';
import { asError, mountController, type ViewportController } from './cad-controller';
import type { CadCamera, CadGeometry, CadMode, CadPick, CadViewportProps, MeasurementMode } from './types';

export function useCadViewport(props: CadViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const controller = useRef<ViewportController | null>(null);
  const [instance, setInstance] = useState<ViewportController | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [displayed, setDisplayed] = useState<CadGeometry | null>(null);
  const [firstDisplayMs, setFirstDisplayMs] = useState<number | null>(null);
  const [camera, setCamera] = useState<CadCamera | null>(null);
  const [measurement, setMeasurement] = useState<MeasurementMode>('part');
  const [pick, setPick] = useState<CadPick | null>(null);
  const [points, setPoints] = useState<CadPick[]>([]);
  const measurementRef = useRef(measurement);
  measurementRef.current = measurement;
  const [mode, setMode] = useState<CadMode>(props.geometry?.schema === 'cablesim.cad-scene/1' ? 'scene' : 'peel');
  const [measurementBusy, setMeasurementBusy] = useState(false);
  const mountedAt = useRef(0);
  const firstDisplayDeadline = useRef<number | undefined>(undefined);
  const shouldMount = !!props.geometry && props.state !== 'empty';

  useEffect(() => {
    if (!shouldMount || !host.current) return;
    let alive = true;
    let owned: ViewportController | null = null;
    const element = host.current;
    mountedAt.current = performance.now();
    setBusy(true);
    setProblem('');
    setDisplayed(null);
    setFirstDisplayMs(null);
    const reportError = (error: Error) => {
      if (!alive) return;
      setProblem(error.message);
      setBusy(false);
      latest.current.onError?.(error);
    };
    const deadline = window.setTimeout(() => {
      reportError(new Error('三维初始化超时，请重载视口或切回二维。'));
      alive = false;
      owned?.dispose();
      if (controller.current === owned) controller.current = null;
      setInstance(current => current === owned ? null : current);
    }, 3000);
    firstDisplayDeadline.current = deadline;
    const mount = props.geometry?.display_source === 'domain-input'
      ? import('./input-scene-controller').then(module => module.mountInputScene)
      : Promise.resolve(mountController);
    void mount.then(create => create(element, {
      onCameraChange: value => { if (alive) { setCamera(value); latest.current.onCameraChange?.(value); } },
      onSelectionChange: selection => latest.current.onSelectionChange?.(selection),
      onPick: value => {
        if (!alive) return;
        setPick(value);
        if (measurementRef.current === 'point' && Number.isFinite(value?.x_mm)) {
          setPoints(previous => value!.measure_pending ? [value!]
            : Number.isFinite(value!.distance_mm) ? [previous[0], value!].filter(Boolean) : previous);
        }
        latest.current.onPick?.(value);
      },
      onError: reportError,
      loadExact: (model, signal) => {
        if (!latest.current.loadExact) return Promise.reject(new Error('精确拓扑未接入。'));
        return latest.current.loadExact(model, signal);
      },
    }, latest.current.initialCamera || {}, () => alive)).then(value => {
      if (!alive || !value) { value?.dispose(); return; }
      owned = value;
      controller.current = value;
      setInstance(value);
    }).catch(error => { window.clearTimeout(deadline); reportError(asError(error)); });
    return () => {
      alive = false;
      window.clearTimeout(deadline);
      if (firstDisplayDeadline.current === deadline) firstDisplayDeadline.current = undefined;
      owned?.dispose();
      if (controller.current === owned) controller.current = null;
      setInstance(current => current === owned ? null : current);
    };
  }, [shouldMount, attempt]);

  useEffect(() => {
    if (!instance || !props.geometry) return;
    let current = true;
    const geometry = props.geometry;
    const targetMode = geometry.schema === 'cablesim.cad-scene/1' ? 'scene' : 'peel';
    if (displayed?.schema !== geometry.schema) { instance.mode(targetMode); setMode(targetMode); }
    instance.select(props.selectedObject || null);
    setBusy(true);
    setProblem('');
    setMeasurement('part');
    setPick(null); setPoints([]);
    void instance.update(geometry).then(timing => {
      if (!current || controller.current !== instance || !timing) return;
      window.clearTimeout(firstDisplayDeadline.current);
      firstDisplayDeadline.current = undefined;
      setDisplayed(geometry);
      setBusy(false);
      const measured = timing.phase === 'first-display'
        ? { ...timing, elapsedMs: performance.now() - mountedAt.current } : timing;
      if (timing.phase === 'first-display') setFirstDisplayMs(measured.elapsedMs);
      latest.current.onReady?.(measured);
    }).catch(error => {
      if (!current) return;
      window.clearTimeout(firstDisplayDeadline.current);
      firstDisplayDeadline.current = undefined;
      const value = asError(error);
      setProblem(value.message);
      setBusy(false);
      latest.current.onError?.(value);
    });
    return () => { current = false; };
    // Selection has its own effect; a click never triggers a geometry rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, props.geometry]);

  useEffect(() => { instance?.select(props.selectedObject || null); },
    [instance, props.selectedObject?.id, props.selectedObject?.kind]);

  function changeMode(next: CadMode) {
    setMode(next);
    instance?.mode(next);
  }

  async function changeMeasurement(next: MeasurementMode) {
    if (!instance) return;
    setMeasurementBusy(true);
    try {
      if (await instance.selection(next)) { setMeasurement(next); setPick(null); setPoints([]); setProblem(''); }
    } catch (error) {
      const value = asError(error);
      setProblem(value.message);
      latest.current.onError?.(value);
    } finally { setMeasurementBusy(false); }
  }

  function retry() { setAttempt(value => value + 1); props.onRetry?.(); }
  return { host, controller, instance, busy, problem, displayed, camera, mode, measurement,
    measurementBusy, changeMode, changeMeasurement, retry, pick, points, firstDisplayMs };
}
