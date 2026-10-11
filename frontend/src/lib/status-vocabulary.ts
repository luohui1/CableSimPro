/** 统一索引状态的展示词；不改变保存状态与时效判定。 */
export const STATUS_WORDS: Readonly<Record<string, string>> = {
  current: '当前', outdated: '已过期', historical: '历史', not_run: '未运行',
  accepted: '排队', queued: '排队', running: '运行中', validating: '校验中',
  succeeded: '成功', partial: '部分成功', failed: '失败', cancelled: '中断',
  draft: '草稿', published: '已发布', reviewed: '已核对', incomplete: '资料缺项',
};
export const statusLabel = (code: string, fallback: string) => STATUS_WORDS[code] || fallback;
export const TASK_NAMES: Readonly<Record<string, string>> = {
  rating: '载流量', 'steady-rating': '载流量', operating: '运行温度', single: '单次计算',
  selection: '客户问询', target: '客户问询', sweep: '参数扫描', crosscheck: '方法比较', batch: '批量仿真',
  hybrid: '混合载流量', 'transient-temperature': '暂态温升', 'sheath-losses': '护套损耗',
  'electrothermal-steady': '电热耦合', 'thermal-field': '温度场',
  electrical: '电气参数', 'short-circuit': '短路容量', dimensions: '标准核对',
  'concentric-model': '结构推导', 'iec60853-emergency': '应急载流量',
};
export function taskName(definition: { task?: string | null; driver?: { kind?: string; cases?: unknown[] }; method?: { capability?: string } }, fallback = '计算') {
  const driver = definition.driver?.kind || '';
  // 型号载流量表复用 batch 执行器；按封存工况身份区分，不能把所有 batch 改名。
  const cases = definition.driver?.cases;
  if (driver === 'batch' && Array.isArray(cases) && cases.length > 0 && cases.every(value => value && typeof value === 'object' && (value as { metadata?: { kind?: string } }).metadata?.kind === 'type-rating-table')) return '载流量表';
  if (driver !== 'single' && TASK_NAMES[driver]) return TASK_NAMES[driver];
  const capability = definition.method?.capability || '';
  if (capability !== 'steady-rating' && TASK_NAMES[capability]) return TASK_NAMES[capability];
  const task = definition.task || '';
  return TASK_NAMES[task] || TASK_NAMES[definition.method?.capability || ''] || fallback;
}
export function readableRunName(name: string, parentName?: string) {
  const match = name.match(/^(?:保存研究|研究)\s*·\s*运行\s*(\d+)$/);
  return match ? `${parentName ? parentName + ' · ' : ''}第 ${match[1]} 次运行` : name;
}
