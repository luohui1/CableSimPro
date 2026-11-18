import { cableSeriesException, engineeringReferenceException, internalTokens, resourceSourceReferenceException } from './visible-names.mjs';
import { STATUS_WORDS, TASK_NAMES } from '../src/lib/status-vocabulary.ts';

export const categories = { uuid: 'UUID', hash: '长十六进制摘要', pointer: 'JSON 路径', snake: '内部键名', enum: '英文枚举码', edition: '标准版次', internal: '内部标识' };
const enums = [...new Set([...Object.keys(STATUS_WORDS), ...Object.keys(TASK_NAMES), 'verified', 'unverified', 'not_covered', 'slurm', 'available', 'unavailable', 'not_satisfied', 'reference_only', 'three_core', 'both_ends', 'single_point', 'unspecified', 'frequency_domain', 'standard_check'])];
const enumPattern = new RegExp('\\b(?:' + enums.sort((a, b) => b.length - a.length).join('|') + ')\\b', 'g');

/** Narrow, documented exceptions; every match is reported rather than silently dropped. */
export const whitelist = [
  { id: 'hover', reason: '悬停详情不占普通界面，保留定位与核对所需原始标识。' },
  { id: 'folded', reason: '默认折叠内容单独计数；需用户主动展开才可见，不算首层露出。' },
  { id: 'technical', reason: '用户主动进入“技术信息”或“追溯”页签，原始发行身份用于核对。' },
  { id: 'resource-source-reference', reason: '仅允许材料、模板或标准资源属性中主动展开的结构化出处原文。页面、属性面板、展开容器、原文节点及有效 JSON 对象或数组均须匹配；保留全部匹配作技术追溯记录，周围摘要和其他位置仍检查。' },
  { id: 'original-filename', reason: '原件文件名保留以便工程师辨认和下载同一原件；仅允许文件名内部键名，UUID、摘要仍需追溯层。' },
  { id: 'cable-series-label', reason: '仅允许电缆型号版本目录的厂家系列分组标题 CU/XLPE/LC/PVC；按页面、表格和分组标题 DOM 限定，普通文本、其他页面、扩展路径与内部枚举仍检查。' },
  { id: 'engineering-notation', reason: 'GB/T 标准号、电缆型号与额定电压、SI 单位、量符号属于工程信息；沿用 visible-names.mjs 的窄工程记号规则，不作内部标识。' },
  { id: 'plugin-version', reason: '真实插件发行版本（例如 1.2.3）用于复现结果，保留原版本；年度标准的四位年份加三段版本形式仍列为问题。' },
  { id: 'mathematical-notation', reason: '坐标 x/z、物理符号比值 Y/C、sigma/epsilon、sigma/mu、k/mu、I2/I1，角度序列 Angles0/90/180，以及边界名 Dirichlet/Robin 和积分方法 BDF1/2，均为工程数学记号，不能当成 JSON 路径。只允许这些完整记号。' },
  { id: 'source-terminology', reason: '仅允许已核对的 TB 880 书目标题中的 rating 和公开算例“Unit RMS current normalization”中的 current；它们是原文工程术语，不是任务或状态枚举。其他位置仍检查。' },
  { id: 'connection-directory', reason: '仅允许设置 → 计算位置的远程工作目录、环境目录输入值；工程师必须查看、编辑完整绝对路径。按页面和两个字段定位限制，不能豁免其他界面的内部标识、错误或结果。' },
  { id: 'standard-annex', reason: '仅允许明确写作“附录 A/B”的附录编号；标准号可能在相邻表格单元格。A/B 单独出现、路径和其他标识仍检查，来源原文不改写。' },
  { id: 'tb880-examples', reason: '仅允许已核对教学来源中带 TB 880 书号的 Case2/10 算例引用。未带书号的 Case2/10、其他路径和内部标识仍检查，来源原文不改写。' },
];
export function identifyText(text) {
  const matches = [], occupied = [];
  const add = (category, expression) => {
    for (const match of text.matchAll(expression)) {
      const start = match.index, end = start + match[0].length;
      if (category === 'hash' && /^\d+$/.test(match[0]) && (text[start - 1] === '.' || text[end] === '.')) continue; // Decimal precision is not a digest.
      if (occupied.some(([a, b]) => start >= a && end <= b)) continue;
      matches.push({ category, token: match[0], offset: start }); occupied.push([start, end]);
    }
  };
  add('uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi);
  add('hash', /\b[0-9a-f]{16,}\b/gi);
  add('pointer', /\/(?:parameters|values|input|input_schema|cable_types|materials|sections|circuits|loads|requirements|driver|modules|specification|definition)(?:\/[A-Za-z0-9_~.\/-]+)*/g);
  add('enum', enumPattern);
  add('snake', /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g);
  add('edition', /\b(?:19|20)\d{2}\.\d+\.\d+\b/g);
  // Reuse the existing engineering-unit exceptions and registered-label vocabulary.
  for (const token of internalTokens(text)) {
    const offset = text.indexOf(token);
    if (offset >= 0 && !occupied.some(([a, b]) => offset >= a && offset + token.length <= b)) matches.push({ category: 'internal', token, offset });
  }
  return matches.sort((a, b) => a.offset - b.offset);
}
export function exceptionFor(hit) {
  const sourceReference = resourceSourceReferenceException(hit);
  if (sourceReference) return whitelist.find(item => item.id === sourceReference);
  if (['hover', 'folded', 'technical'].includes(hit.layer)) return whitelist.find(item => item.id === hit.layer);
  if (/^\/settings\/compute(?:\?|$)/.test(hit.page || '') && ['#hpc-directory', '#hpc-environment'].includes(hit.selector) && /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\/?$/.test(hit.text)) return whitelist.find(item => item.id === 'connection-directory');
  if (hit.category === 'internal' && /^(?:A|W)\/km$/.test(hit.token)) return whitelist.find(item => item.id === 'engineering-notation');
  if (hit.category === 'internal' && ['x/z', 'Y/C', 'sigma/epsilon', 'sigma/mu', 'k/mu', 'I2/I1', 'Angles0/90/180', 'Dirichlet/Robin', 'BDF1/2'].includes(hit.token)) return whitelist.find(item => item.id === 'mathematical-notation');
  if (hit.category === 'internal') {
    const series = cableSeriesException(hit);
    if (series) return whitelist.find(item => item.id === series);
    const reference = engineeringReferenceException(hit.text, hit.token);
    if (reference) return whitelist.find(item => item.id === reference);
  }
  if (hit.category === 'enum' && ((hit.token === 'rating' && hit.text === 'CIGRE WG B1.56 (2022). TB 880: Power cable rating examples for calculation tool verification. 官方目录') || (hit.token === 'current' && hit.text === 'R1=R2=1mm,d=2.5mm,sigma=55MS/m,f=40kHz. Unit RMS current normalization.'))) return whitelist.find(item => item.id === 'source-terminology');
  if (hit.category === 'snake' && /^[^\n<>]+\.(?:pdf|docx?|xlsx?|csv|step|stp|json)$/i.test(hit.text.trim())) return whitelist.find(item => item.id === 'original-filename');
  return null;
}

/** Backend-authored Agent prose is assigned separately from the public Agent shell. */
export function findingOwner(surface, node) {
  if (node.agentAnswer) return 'Agent';
  if (node.field) return '仿真';
  if (node.standard) return '标准';
  if (node.cad) return '三维';
  return surface.owner;
}

/** POST is also used by two read-only host contracts. Do not allow solver previews or saves. */
export function readOnlyPost(path) {
  if (path === '/api/plugin-queries/cablesim.standards-basis/lookup') return '标准库只读查询；宿主核验 read_only 声明与发行摘要，不保存工程。';
  if (/^\/api\/workspaces\/[0-9a-f-]{36}\/geometry-preview$/i.test(path)) return '几何显示预览；宿主仅接受 geometry 能力，不保存输入；缓存与工作进程限本任务隔离目录。';
  return null;
}
