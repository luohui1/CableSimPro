/** Host-owned workflow vocabulary: PRD J3/J4 and the five-zone workbench.
 * Plugins own capability titles, parameters, result titles, units and bases.
 * These entries describe navigation/presentation, never calculation formulas.
 */
export const runStates: Record<string, { label: string; phase: "queued" | "running" | "complete" | "failed" }> = {
  accepted: { label: "排队", phase: "queued" }, queued: { label: "排队", phase: "queued" },
  validating: { label: "校验中", phase: "running" }, running: { label: "运行中", phase: "running" },
  succeeded: { label: "成功", phase: "complete" }, partial: { label: "部分成功", phase: "complete" },
  failed: { label: "失败", phase: "failed" }, rejected: { label: "已拒绝", phase: "failed" },
  interrupted: { label: "已中断", phase: "failed" }, cancelled: { label: "已停止", phase: "failed" }, canceled: { label: "已停止", phase: "failed" },
};
export const hostTasks = [
  { task: "rating" as const, label: "额定载流量", icon: "calc/ampacity", output: "ampacity" },
  { task: "operating" as const, label: "运行温度", icon: "calc/thermal-field", output: "conductor_temperature" },
];
/** Legacy catalogue labels remain immutable identities; translate only their display. */
export function readableCableVersion(version: string) {
  return version.replace(/^public-sample/, '公开样本').replace(/\+engineering$/, '（工程版）') || '版本未提供';
}
export const driverViews: Record<string, { label: string; icon: string }> = {
  selection: { label: "客户问询选型", icon: "calc/selection" }, sweep: { label: "参数扫描", icon: "calc/sweep" },
  batch: { label: "批量仿真", icon: "nav/simulation" }, crosscheck: { label: "方法对比", icon: "module/method-compare" },
};
export const modelViews = [
  { id: "section" as const, icon: "object/section", label: "敷设截面" },
  { id: "cable" as const, icon: "object/cable", label: "电缆截面" },
];
export const inspectorViews = [
  { id: "input" as const, label: "输入", icon: "object/conditions" },
  { id: "method" as const, label: "方法", icon: "nav/plugin" },
  { id: "agent" as const, label: "Agent", icon: "agent/agent" },
];
export const projectSuggestions = ["这个工程里哪些研究还没有结果？", "汇总各研究的结论和限制因素", "检查工程模型还缺哪些输入"];

/** Legacy domain snapshots predate field-level units. This SI vocabulary comes
 * from cablesim.domain/1; it labels stored values and never fills missing ones.
 * Method parameters prefer their frozen parameter schema / explicit unit.
 */
export const domainFieldUnits: Record<string, string> = {
  thermal_resistivity: "K·m/W", dry_thermal_resistivity: "K·m/W", volumetric_heat_capacity: "J/(m³·K)",
  electrical_resistivity_20: "Ω·m", density: "kg/m³", longitudinal_r20: "Ω/m", r20: "Ω/m",
  diameter: "m", inner_diameter: "m", outer_diameter: "m", thickness: "m", nominal_area: "m²", effective_area: "m²",
  x: "m", y: "m", z: "m", depth: "m", width: "m", height: "m", radius: "m", length: "m",
  ambient_temperature: "K", conductor_temperature: "K", normal: "K", emergency: "K", frequency: "Hz",
  current: "A", voltage: "V", u0: "V", u: "V", um: "V", phase_angle: "rad", loss_tangent: "1",
};

/** Display-only labels for historical cablesim.domain/1 snapshots, which did
 * not carry schema titles. New method fields use their frozen schema titles. */
export const snapshotFieldLabels: Record<string, string> = {
  method: '方法', version: '版本', plugin_id: '计算方法', capability: '能力', task: '任务',
  parameters: '方法参数', driver: '研究配置', cases: '工况', input: '输入', kind: '类型',
  cable_types: '电缆型号', common_layers: '公共层', cores: '线芯', conductor: '导体', layers: '结构层',
  circuits: '回路', cables: '电缆', cable: '电缆', cable_type: '型号', sections: '敷设截面',
  materials: '材料', material: '材料', load_cases: '负荷', currents: '电流', criteria: '温限',
  normal: '正常运行', emergency: '应急运行', name: '名称', label: '名称', role: '层用途',
  construction: '结构形式', diameter: '直径', thickness: '厚度', nominal_area: '标称截面',
  conductor_class: '导体类别', form: '形式', r20_basis: '电阻口径', core_lay_length: '成缆节距',
  temperature_limits: '温度限值', thermal_resistivity: '热阻率', loss_tangent: '介质损耗角正切',
  relative_permittivity: '相对介电常数', relative_permeability: '相对磁导率', alpha20: '电阻温度系数',
  electrical_resistivity_20: '20 ℃电阻率', longitudinal_r20: '屏蔽纵向电阻',
  longitudinal_resistance_basis: '纵向电阻口径', nominal_tape_thickness: '钢带标称厚度',
  tape_application: '钢带形式', tape_count: '钢带层数', tape_gap: '钢带间隙', tape_width: '钢带宽度',
  overlap: '搭盖率', voltage: '电压', u0: '相对地电压', u: '额定电压', um: '最高电压',
  minimum: '目标值', candidate_ids: '候选型号', candidate_filters: '候选范围',
  minimum_area_m2: '最小截面', maximum_area_m2: '最大截面', voltage_v: '额定电压',
  target_key: '结论量', target_unit: '结论单位', target_condition: '目标工况',
  target_entity: '目标对象', target_entities: '目标对象', rating_basis: '载流量口径',
  allow_demo_candidates: '允许演示候选', measurements: '测量输入',
};
