/** Host-owned workflow vocabulary: PRD J3/J4 and the five-zone workbench.
 * Plugins own capability titles, parameters, result titles, units and bases.
 * These entries describe navigation/presentation, never calculation formulas.
 */
import { STATUS_WORDS, TASK_NAMES } from '@/lib/status-vocabulary';
export const runStates: Record<string, { label: string; phase: "queued" | "running" | "complete" | "failed" }> = {
  accepted: { label: STATUS_WORDS.accepted, phase: "queued" }, queued: { label: STATUS_WORDS.queued, phase: "queued" },
  validating: { label: STATUS_WORDS.validating, phase: "running" }, running: { label: STATUS_WORDS.running, phase: "running" },
  succeeded: { label: STATUS_WORDS.succeeded, phase: "complete" }, partial: { label: STATUS_WORDS.partial, phase: "complete" },
  failed: { label: STATUS_WORDS.failed, phase: "failed" }, rejected: { label: "已拒绝", phase: "failed" },
  interrupted: { label: STATUS_WORDS.cancelled, phase: "failed" }, cancelled: { label: STATUS_WORDS.cancelled, phase: "failed" }, canceled: { label: STATUS_WORDS.cancelled, phase: "failed" },
};
export const hostTasks = [
  { task: "rating" as const, label: TASK_NAMES.rating, icon: "calc/ampacity", output: "ampacity" },
  { task: "operating" as const, label: TASK_NAMES.operating, icon: "calc/thermal-field", output: "conductor_temperature" },
];
/** Legacy catalogue labels remain immutable identities; translate only their display. */
export function readableCableVersion(version: string) {
  return version.replace(/^public-sample/, '公开样本').replace(/\+engineering$/, '（工程版）') || '版本未提供';
}
export const driverViews: Record<string, { label: string; icon: string }> = {
  selection: { label: TASK_NAMES.selection, icon: "calc/selection" }, sweep: { label: TASK_NAMES.sweep, icon: "calc/sweep" },
  batch: { label: TASK_NAMES.batch, icon: "nav/simulation" }, crosscheck: { label: TASK_NAMES.crosscheck, icon: "module/method-compare" },
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

/** 旧发行保存的英文验证声明只转换显示；不修改来源快照或验证范围。 */
const evidenceLabels: [string,string][] = [["CIGRE TB 880 Case 0-1 exact radical T4","CIGRE TB 880 算例 0-1：外部热阻精确根式"],["CIGRE TB 880 Case 0-1 single-point bonding","CIGRE TB 880 算例 0-1：单端接地"],["CIGRE TB 880 Case 0-1 GP31 eddy","CIGRE TB 880 算例 0-1：GP31 涡流"],["CIGRE TB 880 Case 0-2 GP31 eddy","CIGRE TB 880 算例 0-2：GP31 涡流"],["CIGRE TB 880 Case 0-3 flat duct bank","CIGRE TB 880 算例 0-3：平排排管"],["CIGRE TB 880 Case 0-3 single-point bonding","CIGRE TB 880 算例 0-3：单端接地"],["CIGRE TB 880 Case 0-3 GP31 eddy","CIGRE TB 880 算例 0-3：GP31 涡流"],["IEC 2023 image-source analytic two-cable and unequal N-source checks","IEC 2023：双电缆及多热源不等负荷镜像解析核对"],["IEC 2023 Table 2 nodes, interpolation and unequal backfill correction","IEC 2023 表 2：节点、插值与非均匀回填修正核对"],["Nine single-core layout templates: independent logarithmic heat-balance and frozen-loss quadratic checks","九种单芯敷设模板：独立对数热平衡与冻结损耗二次方程核对"],["Three-core SL: six direct-burial/duct hand quadratics; TB880 Case2 thermal and wire-loss intermediates; Case10 steel-tape loss components","三芯逐芯屏蔽：六种直埋/排管手算；TB 880 算例 2 热阻与钢丝损耗、算例 10 钢带损耗组件核对"],["三芯仅等结构圆绞导体、芯相接触、独立铜带或光滑金属屏蔽、平衡三相和两端接地；需要成缆绞距、铜带纵向R20、填充材料与钢带实际间隙。","三芯仅等结构圆绞导体、芯相接触、独立铜带或光滑金属屏蔽、平衡三相和两端接地；需要成缆绞距、铜带20 ℃纵向电阻、填充材料与钢带实际间隙。"],["三芯磁性钢带厚度0.3–1.0 mm；钢丝圆导体至400 mm²且需工频AC铠装电阻；非磁性、混合填料、分离芯、单点接地三芯与分割/扇形领域结构拒算。单芯无铠装，支持光滑管套及显式波深/节距/缓冲/间隙有效热阻率的皱纹管套；局部接触与放电热点不在平均直径模型范围。","三芯磁性钢带厚度0.3–1.0 mm；钢丝圆导体至400 mm²且需工频交流铠装电阻；非磁性、混合填料、分离芯、单点接地三芯与分割/扇形领域结构拒算。单芯无铠装，支持光滑管套及显式波深/节距/缓冲/间隙有效热阻率的皱纹管套；局部接触与放电热点不在平均直径模型范围。"],["ks、kp 及管道常数 U、V、Y 须显式给定；工程计算使用 2023 表 2，范围外或无法核实的节点拒算。水平护套涡流按 1-1:2023 5.3.7.1(2)，已用 TB 880 单点接地与两端接地变体验证。","集肤、邻近效应系数及排管热阻常数须显式给定；工程计算使用 2023 表 2，范围外或无法核实的节点拒算。水平护套涡流按 1-1:2023 5.3.7.1(2)，已用 TB 880 单点接地与两端接地变体验证。"],["reference_basis=tb880_reference 仅复现 TB 880 所用旧版电容、等效回填半径和接触品字形热阻约定，结果标为参考复现，不能作为 IEC 2023 工程结论。","选择 TB 880 历史参考口径时，仅复现 TB 880 所用旧版电容、等效回填半径和接触品字形热阻约定，结果标为参考复现，不能作为 IEC 2023 工程结论。"],["IEC60853-2 AMD1:2008 Annex F.6.2: 1550 A reference, six-hour emergency 2131 A","IEC 60853-2 AMD1:2008 附录 F.6.2：1550 A 基准、六小时应急 2131 A"],["TB880:2022 Case1 pp131-163; touching trefoil and spaced flat, full primitive-input chains","TB 880:2022 算例 1，第 131–163 页：接触品字形与分离平排，完整原语输入链"],["TB880:2022 Case2 pp164-179; Case4 pp195-205; primitive SI geometry/material chains","TB 880:2022 算例 2，第 164–179 页；算例 4，第 195–205 页：SI 几何与材料原语链"],["CIGRE TB880 Case 2 §6.6/6.11/6.12, pages174/178/179","CIGRE TB 880 算例 2，§6.6/6.11/6.12，第 174/178/179 页"]];
export function readableEvidence(value:string){
  for(const [before,after] of evidenceLabels)value=value.replaceAll(before,after);
  return value.replace(/\bCases?\s*(\d+(?:-\d+)?)/g,'算例 $1').replaceAll('Kennelly','肯内利').replaceAll('double-flat only','仅双回平排').replaceAll('reference conventions only','仅历史参考口径').replaceAll('pp.','页码').replaceAll('集肤/邻近系数 ks、kp 及管道常数 U、V、Y','集肤、邻近效应系数及排管热阻常数');
}

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
