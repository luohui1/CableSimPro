import { useQuery } from '@tanstack/react-query';
import { optionalRecord, text } from '@/api/client';
import { methodCatalog } from '@/api/research';
import { EmptyState } from './states';
import { validationLevel } from '@/lib/plugin-labels';
import { readableEvidence } from './study-workbench-config';
import { StudyDetailGroup } from './study-detail-group';

type Row = Record<string, unknown>;
const list = (value: unknown) => (Array.isArray(value) ? value : []);

/**
 * 验证与范围：这次运行所用插件的参考算例、声明的适用范围、发行封签校验，以及交叉校核的口径。
 * 全部来自运行记录（output.executions / limitations / crosscheck / environment），不另行判断。
 */
export function StudyValidation({ run }: { run?: Row }) {
  const catalog = useQuery({ queryKey: ['method-catalog'], queryFn: ({ signal }) => methodCatalog(signal) });
  // 插件与能力用清单里的名称显示；清单里找不到时保留运行记录中的原始身份
  const named = (pluginId: string, capabilityId: string) => {
    const plugin = (catalog.data || []).map(optionalRecord).find(row => text(optionalRecord(row.method).plugin_id) === pluginId);
    const capability = list(plugin?.capabilities).map(optionalRecord).find(cap => text(cap.id) === capabilityId);
    return { plugin: text(plugin?.name) || pluginId, capability: text(capability?.title) || capabilityId };
  };
  if (!run) return <EmptyState title="尚无运行" description="运行后在这里查看方法验证与适用范围。" />;
  const output = optionalRecord(run.output);
  const executions = list(output.executions).map(optionalRecord);
  const seal = optionalRecord(optionalRecord(output.environment).seal_verification);
  const crosscheck = optionalRecord(output.crosscheck);
  const quantities = list(crosscheck.quantities).map(optionalRecord);
  const maxDiff = quantities.reduce((max, q) => Math.max(max, Math.abs(Number(q.difference) || 0)), 0);
  return <div className="validation-page">
    <section className="validation-seal" aria-label="发行封签">
      <span className={`status-dot ${text(seal.status) === 'verified' ? 'is-ok' : 'is-off'}`} />
      <div>
        <b>{text(seal.status) === 'verified' ? '插件发行封签校验通过' : '封签状态未知'}</b>
        <span className="muted">{named(text(output.plugin_id), '').plugin} {text(output.plugin_version)}{text(seal.release_digest) ? ` · ${text(seal.release_digest).slice(0, 12)}…` : ''}{text(seal.verified_at) ? ` · ${new Date(text(seal.verified_at)).toLocaleString('zh-CN')}` : ''}</span>
      </div>
    </section>

    {quantities.length > 0 && <section className="validation-block" aria-label="交叉校核">
      <h2>交叉校核</h2>
      <p className="validation-lead">{quantities.length} 项同量纲结果参与比较，最大差值 {maxDiff === 0 ? '为 0' : maxDiff.toPrecision(3)}。</p>
      <p className="muted">{text(crosscheck.statement)}</p>
    </section>}

    {executions.map((execution, index) => {
      const method = optionalRecord(execution.method);
      const validation = optionalRecord(execution.validation);
      const cases = list(validation.cases).map(text).filter(Boolean).map(readableEvidence);
      const limits = list(execution.limitations).map(text).filter(Boolean).map(readableEvidence);
      return <StudyDetailGroup key={index} id={'validation:' + text(method.plugin_id) + ':' + text(method.capability)} title={named(text(method.plugin_id), text(method.capability)).plugin + ' · 验证与适用范围'} count={cases.length + limits.length}><section className="validation-block" aria-label="方法验证">
        <h2>{named(text(method.plugin_id), text(method.capability)).plugin} · {named(text(method.plugin_id), text(method.capability)).capability} <span className="muted">{text(method.version)}</span></h2>
        <div className="validation-columns">
          <div>
            <h3>参考算例 <span className="muted">{cases.length} · {validationLevel(text(validation.level))}</span></h3>
            {cases.length ? <ul className="validation-list is-ok">{cases.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="muted">插件未声明参考算例。</p>}
          </div>
          <div>
            <h3>适用范围 <span className="muted">{limits.length}</span></h3>
            {limits.length ? <ul className="validation-list">{limits.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="muted">插件未声明范围限制。</p>}
          </div>
        </div>
      </section></StudyDetailGroup>;
    })}
    {!executions.length && <EmptyState title="运行记录没有方法验证信息" description="早期运行未保存插件验证声明。" />}
  </div>;
}
