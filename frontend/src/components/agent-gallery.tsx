import { PreviewCard, ProposalCard, TurnView } from '@/features/agent/conversation';
import type { AgentProposal } from '@/features/agent/agent-api';
import type { Turn } from '@/features/agent/transcript';

// 陈列用的是正式 Agent 组件本身；数据为演示，不连接工程。
const proposal: AgentProposal = { id: 'demo-proposal', title: '土壤热阻率 1.0 → 1.2 K·m/W', status: 'pending', changes: [{ path: '/materials/soil/thermal_resistivity', label: '热阻率', before: 1, after: 1.2, unit: 'K·m/W' }], checks: ['领域结构、引用、几何与锁校验通过。', '未运行算法，未批准工程结果。'] };
const preview = { id: 'demo-preview', proposalId: proposal.id, headlines: [{ title: '最高导体温度', entity: 'cable/2', value: 119.6, unit: '°C' }], ampacity: [1, 2, 3].flatMap((index) => [{ entity: `circuit/${index}`, basis: 'rating', value: null, reason: '其他回路负荷已使电缆超温' }, { entity: `circuit/${index}`, basis: 'rating-simultaneous', value: 341.6 }]) };
const turn: Turn = {
  id: 'demo', question: '把土壤热阻率改成 1.2 K·m/W，给出方案并试算最高导体温度怎么变。', running: false, started: '2026-01-01T00:00:00Z', finished: '2026-01-01T00:00:42Z', evidenceOnly: false, notices: [],
  steps: [{ id: 'a', tool: 'workspace_read', title: '读取工程输入', status: 'ok', summary: '已读取工程输入', ms: 120 }, { id: 'b', tool: 'propose_domain_changes', title: '提出领域输入修改方案', status: 'ok', summary: '方案已生成，等待人工批准', ms: 310 }, { id: 'c', tool: 'study_preview', title: '快速试算', status: 'ok', summary: '未保存运行', ms: 630 }, { id: 'answer-check', tool: 'answer-check', title: '核对回答里的数值', status: 'ok', summary: '数值都来自工具结果' }],
  answer: '试算中最高导体温度由 **107.0 °C** 升到 **119.6 °C**，三回同时额定由 362.2 A 降到 341.6 A。\n\n- 方案尚未批准，工程没有改动\n- 正式结论需在工作台运行后保存', proposals: [proposal.id], previews: [], runs: [],
};
const kinds = new Map([['workspace_read', 'read'], ['propose_domain_changes', 'propose'], ['study_preview', 'run']]);
const label = (entity: string) => entity.replace('circuit/', '回路 ').replace('cable/', '回路 ');

export default function AgentGallery() {
  return <div className="agent-gallery">
    <TurnView turn={turn} kinds={kinds} proposals={new Map([[proposal.id, proposal]])} label={label} review="aside" />
    <PreviewCard preview={preview} label={label} proposalTitle={proposal.title} />
    <ProposalCard proposal={proposal} onDecide={() => {}} />
  </div>;
}
