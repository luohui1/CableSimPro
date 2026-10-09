/**
 * 验证算例的状态与量名（FRONTEND_REQUIREMENTS §5.5：同一状态全站一种说法）。
 * 复现目标状态与统一索引的 validation 名片一致；比较行状态与复现库记录一致。
 */
export const VALIDATION_STATES: Record<string, string> = {
  reproduced: "已复现",
  partial: "部分复现",
  missing_data: "缺资料",
  capability_gap: "能力未覆盖",
};
export const METRIC_STATES: Record<string, string> = {
  matched: "在声明容差内",
  outside_tolerance: "超出声明容差",
  not_comparable: "口径不可比",
  missing_reference: "原文缺项",
  not_assessed: "未评估",
};
export const VALIDATION_QUANTITIES: Record<string, string> = {
  conductor_max_temperature_k: "导体最高温度",
  interface_nodal_mean_k: "界面节点平均温度",
  maximum_temperature_k: "最高温度",
  probe_temperature_k: "测点温度",
  ampacity_a: "允许电流",
  ac_resistance_ohm_m: "交流电阻",
  series_resistance_ohm_m: "线对交流电阻",
  lambda1: "护套损耗系数",
  conductor_loss_w_m: "导体损耗",
  sheath_loss_w_m: "护套损耗",
  total_loss_w_m: "总损耗",
};

/** 相对偏差百分数：保留三位有效数字，负号用“−”。 */
export function percentText(value: number) {
  const fixed = Number(value.toPrecision(3));
  return `${fixed > 0 ? "+" : fixed < 0 ? "−" : ""}${Math.abs(fixed)} %`;
}
