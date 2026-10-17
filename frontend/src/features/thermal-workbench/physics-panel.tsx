import { useMemo } from 'react';
import type { Network, NetworkState } from './data';
import { auditNetwork } from './physics-audit';

export function PhysicsPanel({network,state}:{network:Network;state:NetworkState|null}) {
  const audit=useMemo(()=>auditNetwork(network,state),[network,state]);
  const number=(n:number)=>n.toLocaleString('zh-CN',{maximumFractionDigits:6});
  return <details className="tw-mutual" open={audit.status==='inconsistent'}>
    <summary>物理一致性核对 · {audit.status==='consistent'?'保存量相互一致':audit.status==='missing'?'缺少运行点':'存在不一致'}</summary>
    <p className="tw-note">这是对保存热阻、损耗和温度的算术核对，不重新求解，也不替代标准验证或工程审批。</p>
    <p className={audit.status==='inconsistent'?'tw-warning':'tw-note'}>土壤互热矩阵：{audit.reciprocal?'互易性满足':'互易性不满足'}；{audit.passive?'正定性满足':'正定性不满足'}。</p>
    {audit.rows.length>0&&<table><caption>温升 / K；残差 = 保存表面温升 − Σ GᵢⱼQ′ⱼ。算术容差为 10⁻⁵ K + 10⁻⁶ × 温升幅值，不是工程允许误差。</caption><thead><tr><th scope="col">相别</th><th scope="col">保存温升</th><th scope="col">GQ 温升</th><th scope="col">残差</th></tr></thead><tbody>{audit.rows.map(row=><tr key={row.phase}><th scope="row">{row.phase}</th><td>{number(row.storedRise)}</td><td>{number(row.reconstructedRise)}</td><td>{number(row.residual)}{row.withinTolerance?'':' · 不一致'}</td></tr>)}</tbody></table>}
    <p className="tw-note">该热网络仍是均匀土壤、恒温地表的稳态参考模型。沟道、排管、隧道和桥架的场景外观不能使它自动适用；未提供热容时不会生成暂态节点响应。</p>
  </details>;
}
