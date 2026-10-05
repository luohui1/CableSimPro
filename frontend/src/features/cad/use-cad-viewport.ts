import { useEffect, useRef, useState } from 'react';
import { asError, mountController, type CadController } from './cad-controller';
import type { CadCamera, CadGeometry, CadMode, CadPick, CadViewportProps, MeasurementMode } from './types';

export function useCadViewport(props: CadViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const controller = useRef<CadController | null>(null);
  const [instance, setInstance] = useState<CadController | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [displayed, setDisplayed] = useState<CadGeometry | null>(null);
  const [camera, setCamera] = useState<CadCamera | null>(null);
  const [measurement, setMeasurement] = useState<MeasurementMode>('part');
  const [pick, setPick] = useState<CadPick | null>(null);
  const [points, setPoints] = useState<CadPick[]>([]);
  const measurementRef = useRef(measurement);
  measurementRef.current = measurement;
  const [mode, setMode] = useState<CadMode>(props.geometry?.schema === 'cablesim.cad-scene/1' ? 'scene' : 'peel');
  const [measurementBusy, setMeasurementBusy] = useState(false);
  const mountedAt = useRef(0);
  const shouldMount = !!props.geometry && props.state !== 'empty';

  useEffect(() => {
    if (!shouldMount || !host.current) return;
    let alive = true;
    let owned: CadController | null = null;
    const element = host.current;
    mountedAt.current = performance.now();
    setBusy(true);
    setProblem('');
    const reportError = (error: Error) => {
      if (!alive) return;
      setProblem(error.message);
      setBusy(false);
      latest.current.onError?.(error);
    };
    void mountController(element, {
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
    }, latest.current.initialCamera || {}, () => alive).then(value => {
      if (!alive || !value) { value?.dispose(); return; }
      owned = value;
      controller.current = value;
      setInstance(value);
    }).catch(error => reportError(asError(error)));
    return () => {
      alive = false;
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
      if (!current || !timing) return;
      setDisplayed(geometry);
      setBusy(false);
      const measured = timing.phase === 'first-display'
        ? { ...timing, elapsedMs: performance.now() - mountedAt.current } : timing;
      latest.current.onReady?.(measured);
    }).catch(error => {
      if (!current) return;
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
    measurementBusy, changeMode, changeMeasurement, retry, pick, points };
}
