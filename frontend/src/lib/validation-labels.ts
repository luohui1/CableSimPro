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
  conductor_temperature_k: "导体温度",
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
  "maximum-temperature": "最高温度",
  conductor_mean_temperature: "导体平均温度",
  screen_mean_temperature: "屏蔽平均温度",
  armor_mean_temperature: "铠装平均温度",
  fiber_mean_temperature: "光纤平均温度",
  conductor_loss: "导体损耗",
  screen_loss: "屏蔽损耗",
  armor_loss: "铠装损耗",
  fiber_loss: "光纤损耗",
  surface_temperature_k: "表面温度",
  current_density: "电流密度",
  current_density_rms: "电流密度有效值",
  current_density_phase: "电流密度相位",
};

const PARTS: [RegExp, string][] = [
  [/^conductor/, "导体"], [/^screen|^sheath/, "屏蔽"], [/^armou?r/, "铠装"], [/^fiber|^fibre/, "光纤"], [/^jacket|^outer/, "外护套"],
  [/^insulation/, "绝缘"], [/^soil/, "土壤"], [/^surface/, "表面"], [/^interface/, "界面"], [/^probe/, "测点"],
];
const TAILS: [RegExp, string][] = [
  [/mean_temperature/, "平均温度"], [/max(imum)?[_-]temperature/, "最高温度"], [/temperature/, "温度"],
  [/loss/, "损耗"], [/resistance/, "电阻"], [/current/, "电流"], [/ampacity/, "允许电流"],
];
/** 验证量名：先查表，查不到按“部位 + 量”拼中文；仍不认识的原样返回，便于发现并补表。 */
export function quantityLabel(key: string) {
  const exact = VALIDATION_QUANTITIES[key] || VALIDATION_QUANTITIES[key.replace(/_(a|k|w_m|ohm_m)$/, "")];
  if (exact) return exact;
  const tail = TAILS.find(([pattern]) => pattern.test(key))?.[1];
  if (!tail) return key;
  const part = PARTS.find(([pattern]) => pattern.test(key))?.[1] || "";
  return part + tail;
}

/** 相对偏差百分数：保留三位有效数字，负号用“−”。 */
export function percentText(value: number) {
  const fixed = Number(value.toPrecision(3));
  return `${fixed > 0 ? "+" : fixed < 0 ? "−" : ""}${Math.abs(fixed)} %`;
}
