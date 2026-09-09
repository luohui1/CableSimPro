import type {Scenario} from './types';
import {SWEEP_PARAMETERS, sweepParameter} from './sweepStudy';
import './sweep-study.css';

/** Display the exact proposed values before approval. Never creates a study on mount. */
export default function SweepPlanSummary({plan}: {plan: {action: string; scenario: Scenario; parameter?: string | null; values?: number[]}}) {
 if (plan.action !== 'sweep') return null;
 const parameter = sweepParameter(plan.parameter ?? '');
 if (!parameter || !Array.isArray(plan.values) || plan.values.length < 2 || plan.values.some(v => !Number.isFinite(v)))
  return <p className="sweep-warning" role="status">扫描计划缺少明确参数或有效工况，请重新规划，不应依据此摘要批准。</p>;
 const meta = SWEEP_PARAMETERS[parameter], input = plan.scenario.installation[parameter];
 return <section className="sweep-plan" aria-label="扫描计划明细"><h3>{meta.label}扫描 · {plan.values.length} 个工况</h3><p className="sweep-plan-values">{plan.values.join(' / ')} <b>{meta.unit}</b></p><p>拟用输入中的原值：{input} {meta.unit}。{plan.values.includes(input) ? '原工况已列入本次扫描。' : '原工况未列入本次扫描，不自动补算比较基准。'}</p><p>批准后逐点调用现有求解器；不把扫描点写回工程，不自动选择“最优”工况。摘要不代表已完成计算。</p></section>;
}
