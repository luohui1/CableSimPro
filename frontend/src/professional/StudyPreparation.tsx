import {useEffect, useState} from 'react';
import {Download, RefreshCw} from 'lucide-react';
import {Modal} from '../EngineeringPanels';
import {useStudio} from '../StudioState';
import {download} from '../utils';
import './study-preparation.css';

type Target = 'schema' | 'comsol' | 'aedt';
interface StudyReport {
  package: {
    project_id: string;
    scenario_revision: number;
    target: Target;
    mode: 'build_only';
    source_kind: 'project_input_snapshot';
    asset_lock: unknown[];
    geometry_recipe: {length_m: number; layers: {uid: string; role: string; inner_radius_m: number; outer_radius_m: number}[]};
  };
  package_sha256: string;
  status: 'package_ready' | 'blocked';
  native_model_built: false;
  solver_executed: false;
  issues: {code: string; severity: 'error' | 'warning' | 'info'; object_path: string; message: string; remediation: string}[];
}
interface RequestState {key: string; status: 'loading' | 'ready' | 'error'; report?: StudyReport; error?: string}
const roleNames: Record<string, string> = {
  conductor: '导体', conductor_screen: '导体屏蔽', insulation: '绝缘',
  insulation_screen: '绝缘屏蔽', metallic_screen: '金属屏蔽', jacket: '外护套',
};

/** An on-demand read-only projection, never a substitute for a native build job. */
export default function StudyPreparation({open, onClose}: {open: boolean; onClose: () => void}) {
  const s = useStudio();
  const [target, setTarget] = useState<Target>('schema');
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<RequestState | null>(null);
  const id = s.w?.id ?? '';
  const revision = s.w?.revision ?? 0;
  const blocked = s.busy || Object.keys(s.inputDrafts).length > 0;
  const key = `${id}:${revision}:${target}:${refresh}`;
  useEffect(() => {
    if (!open || !id || blocked) return;
    const controller = new AbortController();
    setState({key, status: 'loading'});
    const timer = window.setTimeout(() => controller.abort(), 15000);
    let active = true;
    async function inspect() {
      try {
        const response = await fetch(`/api/foundation/workspaces/${encodeURIComponent(id)}/preflight?expected_revision=${revision}&target=${target}`,
          {signal: controller.signal, cache: 'no-store'});
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(typeof body.detail === 'string' ? body.detail : `研究预检未完成（HTTP ${response.status}）`);
        }
        const report = await response.json() as StudyReport;
        if (report.package.project_id !== id || report.package.scenario_revision !== revision || report.package.target !== target) {
          throw new Error('返回的预检不属于当前工程版本，请重新检查。');
        }
        if (active) setState({key, status: 'ready', report});
      } catch (error) {
        if (active) setState({key, status: 'error', error: controller.signal.aborted ? '研究预检超时，请重试。' : error instanceof Error ? error.message : '研究预检未完成。'});
      } finally {
        window.clearTimeout(timer);
      }
    }
    void inspect();
    return () => {active = false; window.clearTimeout(timer); controller.abort();};
  }, [open, id, revision, target, key, blocked]);
  const current = open && !blocked && state?.key === key ? state : null;
  const report = current?.status === 'ready' ? current.report : undefined;
  return <Modal open={open} onOpenChange={v => {if (!v) onClose();}} title="研究准备" description="读取当前已提交输入，检查数据契约和后端缺项。不改参数，不创建任务，不运行仿真。">
    <section className="study-preparation" aria-label="研究准备内容">
      <div className="study-preparation-tools">
        <label>检查目标<select aria-label="研究准备目标" value={target} onChange={e => setTarget(e.target.value as Target)}>
          <option value="schema">声明式研究包</option><option value="comsol">COMSOL 接入预检</option><option value="aedt">Ansys AEDT 接入预检</option>
        </select></label>
        <button onClick={() => setRefresh(v => v + 1)} disabled={blocked || current?.status === 'loading'}><RefreshCw size={15}/>重新检查</button>
      </div>
      {blocked ? <p role="status">请先完成工程操作，提交或撤销未提交输入。旧版本预检不可导出。</p>
        : current?.status === 'error' ? <p role="alert" className="study-preparation-error">{current.error}</p>
        : !report ? <p role="status">正在读取 rev.{revision} 的工程输入…</p>
        : <>
          <div className="study-preparation-status" role="status">
            <strong>{report.status === 'blocked' ? '原生执行器未接入' : '输入契约可打包'}</strong>
            <span>rev.{report.package.scenario_revision} · 仅构建模式 · 未构建原生模型 · 未求解</span>
          </div>
          <h3>结构配方</h3>
          <p className="study-preparation-note">1 m 截面构建片段，不是线路总长。以下尺寸直接来自当前工程；没有生成 B-Rep、MPH 或 AEDT 文件。</p>
          <div className="study-preparation-table"><table><thead><tr><th>部件角色</th><th>内半径 / mm</th><th>外半径 / mm</th></tr></thead><tbody>
            {report.package.geometry_recipe.layers.map(layer => <tr key={layer.uid}><th scope="row">{roleNames[layer.role] ?? layer.role}</th><td>{(layer.inner_radius_m * 1000).toFixed(3)}</td><td>{(layer.outer_radius_m * 1000).toFixed(3)}</td></tr>)}
          </tbody></table></div>
          <h3>缺项与范围</h3>
          <div className="study-preparation-issues">{report.issues.map(issue => <div key={issue.code + issue.object_path} data-severity={issue.severity}>
            <strong>{issue.severity === 'error' ? '阻止执行' : issue.severity === 'warning' ? '待核对' : '范围说明'} · {issue.message}</strong>
            <p>{issue.remediation}</p><code>{issue.object_path}</code>
          </div>)}</div>
          <footer><span>已发布资产锁 {report.package.asset_lock.length} 项；目前只引用项目输入快照。</span>
            <button onClick={() => {if (report && current?.key === key && !blocked) download(`study-preflight-rev-${revision}.json`, JSON.stringify(report, null, 2), 'application/json');}}><Download size={15}/>导出预检记录</button>
          </footer>
          <details><summary>查看研究包摘要</summary><code className="study-preparation-hash">{report.package_sha256}</code></details>
        </>}
    </section>
  </Modal>;
}
