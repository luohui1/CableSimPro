import type { BasisRecord } from './client';

export const conditionNames: Record<string, string> = {
  area_m2: '导体截面 / mm²', screen_area_m2: '屏蔽截面 / mm²', diameter_m: '标准规定直径 / mm',
  u0_v: '相对地电压 / kV', u_v: '额定电压 / kV', um_v: '最高电压 / kV',
  insulation: '绝缘类型', conductor_material: '导体材料', coating: '镀层', conductor_form: '导体结构',
  conductor_class: '导体类别', core_count: '芯数', screened: '屏蔽', sheath_material: '护套材料',
  layer: '层位置', armour_material: '铠装材料', armour_kind: '铠装形式', duration_s: '持续时间 / s',
  conductor_max_working_temperature_k: '导体最高温度 / K', ambient_temperature_k: '环境温度 / K',
  soil_thermal_resistivity_k_m_w: '土壤热阻率 / K·m/W', cable_count: '并列根数', layer_count: '叠置层数',
  horizontal_parallel_cable_count: '水平并列根数', spacing_m: '净间距 / mm', spacing_diameter_ratio: '中心间距 / 外径',
  installation_medium: '敷设介质', circuit_kind: '系统条件', tray_kind: '桥架类别', outdoor_unshaded: '户外无遮阳',
  reference_point: '距离基准', ground_condition: '地面条件', facility_relation: '相邻设施', relation: '位置关系',
  criterion: '规定性质', material: '材料', material_role: '材料用途', specific_construction: '具体构造',
  reference_temperature_k: '参考温度 / K', conductor_type: '导体结构', insulation_system: '绝缘系统',
  test_item: '试验项目', sheath_compound: '护套混合料', test_method: '试验方法', voltage_v: '额定电压 / kV', material_density_kg_m3: '材料密度 / kg/m³',
  laying_mode: '敷设方式', full_length: '全长覆盖', reference_position: '参照位置', cable_construction: '电缆构造', reference_quantity: '参照尺寸', typical_model: '典型型号',
  sampling_band: '抽样长度档', quality_control_agreement: '质量控制协议', current_system: '电流类型', temperature_basis: '温度依据',
  filler: '填充状态', polyethylene_density: '聚乙烯密度类别', surface_colour: '表面颜色', surface_material: '外表面材料',
  solar_exposure: '日照条件', laying_medium: '敷设介质', air_arrangement: '空气中排列', support_type: '支撑方式',
  wall_clearance_ratio: '距墙净距 / 外径', clear_gap_ratio: '芯间净距 / 外径', duct_construction: '导管构造',
  national_reference: '国家数据', elevation_basis: '海拔依据', climate: '气候区域', burial_depth_m: '埋深 / mm',
  soil_moisture: '土壤湿度', weather_pattern: '天气条件', country: '地区', reference_item: '参考项目',
  protection_partition: '防护隔板', pipeline: '管道种类', direction: '位置关系', cable_kind: '电缆用途',
  cable_arrangement: '电缆排列', support_arrangement: '支架布置', support_side: '支架布置', channel_depth_m: '电缆沟深度 / mm',
  cable_voltage_v: '电缆电压 / kV', cable_type: '电缆类型', voltage_class: '电压等级', installation: '安装方式',
  route_length: '线路长度类别', remaining_segment: '截取后剩余段',
};
const labels: Record<string, string> = { copper: '铜', aluminium: '铝', plain: '不镀金属', metal_coated: '镀金属', circular: '圆形', compacted: '紧压', shaped: '成型', yes: '有', no: '无', lead: '铅', corrugated_aluminium: '皱纹铝', plain_aluminium: '平滑铝', non_lead: '非铅', steel: '钢',
  air: '空气', soil: '土壤', ladder: '梯架', tray: '托盘', parallel: '平行', crossing: '交叉', insulation: '绝缘', protective_covering: '保护护层', conductor: '导体', semiconductor: '半导电层', duct: '导管', sheaths_and_armour: '护套与铠装',
  ground_surface: '地面', ground_surface_farmland: '耕地地面', underground_structure_foundation: '地下构筑物基础', non_frozen: '非冻土区', non_frozen_ground: '非冻土地面', other_than_three_phase_ac_single_core: '三相交流单芯电缆以外的电缆',
  All: '全部绝缘系统', 'Round, solid': '圆形实心', 'Round, stranded': '圆形绞合', 'Round, Milliken': '圆形分割', 'Round, Milliken, insulated wires': '绝缘单丝分割', 'Round, Milliken, bare uni-directional wires': '裸单向单丝分割', 'Round, Milliken, bare bi-directional wires': '裸双向单丝分割', 'Hollow, helical stranded': '空心螺旋绞合', 'Sector-shaped': '扇形', 'Fluid or paper or PPL': '流体、纸或 PPL', 'Extruded or Mineral': '挤包或矿物', Extruded: '挤包',
  direct_buried: '直埋', above_and_below_adjacent_sides: '上下紧邻侧', each_side_of_cable: '电缆两侧', self_contained_lead_sheathed_oil_filled: '自容式铅包充油', cable_outer_diameter: '电缆外径',
  hcl_content_max: '溴和氯含量（以HCl表示）', fluorine_content_max: '氟含量', ph_min: 'pH', conductivity_max: '电导率',
  absent: '无协议', maximum_permissible: '最大允许温度', filled: '填充型', unfilled: '未填充型', black: '黑色',
  protected: '遮蔽直射日光', bitumen_or_jute: '沥青或黄麻', polychloroprene: '氯丁橡胶', unavailable: '不可用', sea_level: '海平面',
  tropical: '热带', subtropical: '亚热带', temperate: '温带', very_moist: '很湿', moist: '湿润', dry: '干燥', very_dry: '很干',
  continuous_moisture: '持续湿润', regular_rain: '经常降雨', rare_rain: '少雨', little_or_no_rain: '极少或无雨', none: '无',
  single: '单根', two_touching_horizontal: '两根水平接触', three_touching_trefoil: '三根品字形接触',
  three_touching_horizontal: '三根水平接触', two_touching_vertical: '两根垂直接触', two_spaced_vertical: '两根垂直有间隔',
  three_touching_vertical: '三根垂直接触', three_spaced_vertical: '三根垂直有间隔', single_wall_clipped: '单根墙面夹装',
  three_trefoil_wall_clipped: '三根品字形墙面夹装', non_continuous_brackets: '非连续支架', vertical_wall_clipped: '竖墙直接夹装',
  non_long_distance: '非长距离', unusable: '不可利用',
};
export const localized = (value: unknown): string => labels[String(value)] || String(value);
export const conditionFactor = (key: string) => key.endsWith('_m2') ? 1e6 : key.endsWith('_m') ? 1000 : key.endsWith('_v') ? .001 : 1;
export function predicateLabel(key: string, value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value)
    .map(([op, v]) => `${({ eq: '', gt: '>', gte: '≥', lt: '<', lte: '≤', in: '可选 ' } as Record<string, string>)[op] ?? op}${predicateLabel(key, v)}`).join('，');
  if (Array.isArray(value)) return value.map(v => predicateLabel(key, v)).join(' / ');
  return typeof value === 'number' ? Number((value * conditionFactor(key)).toPrecision(12)).toLocaleString('zh-CN', { maximumSignificantDigits: 12, useGrouping: false }) : localized(value);
}
export function conditionsLabel(conditions: Record<string, unknown>) {
  const parts: string[] = [], voltage: string[] = [];
  const order = ['area_m2', 'u0_v', 'u_v', 'insulation'];
  const entries = Object.entries(conditions).sort(([a], [b]) => (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99));
  for (const [key, value] of entries) {
    if (key === 'u0_v' || key === 'u_v') { voltage[key === 'u0_v' ? 0 : 1] = predicateLabel(key, value); continue; }
    const rendered = predicateLabel(key, value);
    parts.push(key === 'area_m2' ? `${rendered} mm²` : key === 'insulation' ? rendered : `${conditionNames[key] || key}：${rendered}`);
  }
  if (voltage.length) parts.splice(1, 0, `${voltage.join('/')} kV`);
  return parts.join('、');
}
export function valueLabel(value: unknown): string {
  if (value === null) return '—（标准不适用）';
  if (value === '') return '（原表空白）';
  if (Array.isArray(value)) return value.map(valueLabel).join(' / ');
  if (typeof value === 'object' && value && 'value' in value && 'tolerance' in value) {
    const measured = value as { value: unknown; tolerance: unknown };
    return `${valueLabel(measured.value)} ± ${valueLabel(measured.tolerance)}`;
  }
  if (typeof value === 'object' && value && 'min' in value && 'max' in value) {
    const range = value as { min: unknown; max: unknown };
    return `${valueLabel(range.min)}～${valueLabel(range.max)}`;
  }
  if (typeof value === 'object') return '公式参数（查看引用）';
  if (typeof value === 'number') return value.toLocaleString('zh-CN', { maximumSignificantDigits: 12, useGrouping: false });
  return String(value);
}
export function copyCitation(r: BasisRecord) {
  const unit = r.value === null || r.quantity.dimension === 'text' || r.quantity.unit === '1' ? '' : ` ${r.quantity.unit}`;
  return `${r.standard}—${r.edition} ${r.table || `条款 ${r.clause}`}，第 ${r.printed_page} 页：${conditionsLabel(r.conditions)}，${valueLabel(r.value)}${unit}`;
}
export function methodLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const method = value as Record<string, unknown>;
    return String(method.description || method.method || '独立提取与原页核对');
  }
  return String(value);
}

export function formulaDetails(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${prefix}${localized(value)}`];
  const names: Record<string, string> = { min: '下限', max: '上限', kind: '公式类型', expression: '表达式', a: '系数 a', b: '常数 b', x: '变量', floor: '下限', parameter_units: '参数单位', rounding: '修约', increment: '步长', unit: '单位', rule: '规则', execution_status: '执行状态', diameter: '直径', result: '结果', affine: '一次式', not_implemented: '未实现，不自动计算', 'annex-B': '附录 B' };
  return Object.entries(value).flatMap(([key, item]) => item && typeof item === 'object' ? formulaDetails(item, `${prefix}${names[key] || key} · `) : [`${prefix}${names[key] || key}：${names[String(item)] || localized(item)}`]);
}
