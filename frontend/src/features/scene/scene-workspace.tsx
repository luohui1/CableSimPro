import { useMemo, useRef, useState, type ComponentProps } from 'react';
import { CadViewport } from '../cad';
import type { CadScene, CadSelection, CameraPose } from '../cad/types';
import { decodeMesh, primitiveMesh } from '../cad/display-mesh';
import { validateGeometry } from '../cad/geometry-contract';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useViewState } from '@/lib/use-view-state';
import { changeVisibility, defaultVisibility, displayScene, objectMatches, sceneGroups, visibleObjects } from './scene-state';
import { serializeBlenderScene, toBlenderScene, type SceneSource } from './blender-bridge';
import { cadSurface } from './cad-surface';
import { ConstructionViewport as SurfaceViewport } from './construction-viewport';
import './scene.css';

const initialView = { visibility: defaultVisibility, query: '', camera: undefined as Partial<CameraPose> | undefined };

function StableCameraViewport(props: ComponentProps<typeof CadViewport>) {
  const [initialCamera] = useState(props.initialCamera);
  return <CadViewport {...props} initialCamera={initialCamera} />;
}

type Props = {
  scene: CadScene | null;
  source: SceneSource;
  viewKey: string;
  state: 'empty' | 'loading' | 'error' | 'success' | 'historical';
  error?: string;
  selected: CadSelection;
  onSelect: (selection: CadSelection) => void;
  onRetry: () => void;
};

/** One engineering scene; material viewing and native geometry tools share selection. */
export function SceneWorkspace({ scene, source, viewKey, state, error, selected, onSelect, onRetry }: Props) {
  const [view, setView] = useViewState(viewKey, initialView);
  const [renderer, setRenderer] = useViewState<'surface' | 'cad'>(viewKey + ':renderer', 'surface');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const model = useMemo(() => {
    if (!scene) return { scene: null, error: '' };
    try { validateGeometry(scene); return { scene, error: '' }; }
    catch (problem) { return { scene: null, error: problem instanceof Error ? problem.message : '场景校验失败' }; }
  }, [scene]);
  const surface = useMemo(() => {
    try { return { model: model.scene ? cadSurface(model.scene) : null, error: '' }; }
    catch (problem) { return { model: null, error: problem instanceof Error ? problem.message : '场景显示网格不可用' }; }
  }, [model.scene]);
  const filtered = useMemo(() => model.scene ? displayScene(model.scene, view.visibility) : null, [model.scene, view.visibility]);
  const visible = new Set(model.scene ? visibleObjects(model.scene, view.visibility).map(object => object.id) : []);
  const hidden = useMemo(() => {
    if (!model.scene) return [];
    const shown = new Set(visibleObjects(model.scene, view.visibility).map(object => object.id));
    return model.scene.objects.filter(object => !shown.has(object.id)).map(object => object.id);
  }, [model.scene, view.visibility]);
  const current = state === 'success' || state === 'historical';
  const available = current && !!model.scene && !error;
  const problem = error || model.error;
  const matches = model.scene?.objects.filter(object => objectMatches(object, view.query)) || [];

  async function exportScene() {
    if (!available || !model.scene || exportLock.current) return;
    exportLock.current = true; setExporting(true); setExportError('');
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const original = model.scene;
      const payload = toBlenderScene(original, source, asset => {
        if (asset.display_mesh) return decodeMesh(asset.display_mesh);
        if (original.envelope && asset.primitive) return primitiveMesh(original.length_m, asset);
        throw new Error('部分资产只有 B-Rep，尚无显示网格；不能用猜测的几何导出。');
      });
      const url = URL.createObjectURL(new Blob([serializeBlenderScene(payload)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'cablesim-scene.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) { setExportError(problem instanceof Error ? problem.message : '场景导出失败'); }
    finally { exportLock.current = false; setExporting(false); }
  }

  return <section className="scene-workspace" aria-label="敷设场景工作区" aria-busy={state === 'loading'}>
    <header className="scene-heading">
      <div><strong>敷设场景</strong><span>同源几何 · 不代表三维求解</span></div>
      <div className="scene-actions">
        <Button size="compact" aria-pressed={renderer === 'surface'} onClick={() => setRenderer('surface')}>场景视图</Button>
        <Button size="compact" aria-pressed={renderer === 'cad'} onClick={() => setRenderer('cad')}>几何工具</Button>
        <Button size="compact" disabled={!available} onClick={() => setView(previous => ({ ...previous, visibility: defaultVisibility }))}>显示全部</Button>
        <Button size="compact" disabled={!available || exporting} onClick={() => void exportScene()}>{exporting ? '准备交换文件' : '导出 Blender 交换文件'}</Button>
      </div>
    </header>
    <div className="scene-layout">
      <details className="scene-explorer" open>
        <summary>场景对象<span>{visible.size} / {model.scene?.objects.length || 0}</span></summary>
        <label className="scene-search">查找对象<input value={view.query} placeholder="名称或对象标识" onChange={event => { const query = event.target.value; setView(previous => ({ ...previous, query })); }} /></label>
        <div className="scene-object-groups" aria-label="场景对象列表">
          {sceneGroups.map(group => {
            const objects = matches.filter(object => object.kind === group.kind);
            return objects.length ? <details key={group.kind} open><summary>{group.label}<span>{objects.length}</span></summary>
              {objects.map(object => <div key={object.id} className="scene-object" data-selected={selected?.id === object.id || undefined}>
                <input type="checkbox" checked={visible.has(object.id)} disabled={!available} aria-label={`显示 ${object.label || object.id}`} onChange={event => { const checked = event.target.checked; setView(previous => ({ ...previous, visibility: changeVisibility(previous.visibility, { type: 'set-visible', id: object.id, visible: checked }) })); }} />
                <button type="button" disabled={!available || object.kind === 'ground'} aria-pressed={selected?.id === object.id} title={object.id} onClick={() => onSelect({ kind: 'object', id: object.id })}>{object.label || object.id}</button>
                <button type="button" disabled={!available} aria-pressed={view.visibility.isolated === object.id} aria-label={`只看 ${object.label || object.id}`} onClick={() => setView(previous => ({ ...previous, visibility: changeVisibility(previous.visibility, { type: 'isolate', id: object.id }) }))}>只看</button>
              </div>)}
            </details> : null;
          })}
          {available && !matches.length && <p>没有匹配的对象。</p>}
        </div>
        <p className="scene-note">隐藏和隔离只影响视图，不改变敷设、边界条件或导出的完整场景。</p>
      </details>
      <div className="scene-canvas">
        {problem ? <ErrorState title="场景尚未更新" description={problem} action={<Button onClick={onRetry}>重试预览</Button>} />
          : state === 'loading' ? <LoadingState title="正在准备当前输入的场景" description="不会用旧几何冒充当前预览。" />
          : !model.scene ? <EmptyState title="尚无场景" description="先选择敷设截面；场景读取真实的工程几何。" />
          : !filtered ? <EmptyState title="所有对象均已隐藏" description="工程数据没有变化。" action={<Button onClick={() => setView(previous => ({ ...previous, visibility: defaultVisibility }))}>恢复全部对象</Button>} />
          : renderer === 'surface' ? surface.model
            ? <SurfaceViewport key={viewKey} model={surface.model} viewKey={viewKey} hidden={hidden}
                selected={selected && visible.has(selected.id) ? selected.id : null}
                onSelect={id => onSelect(id ? { kind: 'object', id } : null)}
                caption={model.scene.envelope ? '包络显示 · 材质仅用于外观' : '同源显示网格 · 剖切不生成精确 CAD 截面'} />
            : <ErrorState title="显示网格不可用" description={surface.error || '该工件没有可显示网格。'} action={<Button onClick={() => setRenderer('cad')}>打开几何工具</Button>} />
          : <StableCameraViewport key={viewKey} geometry={filtered} state={state === 'historical' ? 'historical' : 'success'}
              selectedObject={selected && visible.has(selected.id) ? selected : null} onSelectionChange={onSelect}
              initialCamera={view.camera} onCameraChange={camera => setView(previous => ({ ...previous, camera }))}
              label="工程敷设场景" onRetry={onRetry} />}
      </div>
    </div>
    <footer className="scene-evidence"><span>{state === 'historical' ? '固定历史输入' : '当前工程预览'}</span><span>几何尺寸来自工程 · 场景沿 +Y 展示</span>{available && <code title={model.scene!.input_sha256}>输入 {model.scene!.input_sha256.slice(0, 12)}</code>}</footer>
    {exportError && <div role="alert" className="scene-export-error">{exportError}</div>}
    <details className="scene-blender-help"><summary>Blender 交换说明</summary><p>导出完整显示网格、米制位姿和对象标识，不包含工程数据库、求解结果或 B-Rep。使用仓库中的 export_scene.py 在独立 Blender 后台进程生成 GLB。材质仅用于外观，GLB 不能替代精确 CAD 或计算网格。</p></details>
  </section>;
}
