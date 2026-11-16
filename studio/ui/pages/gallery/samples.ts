// The gallery's example data. Every number is a real one, read once from the 8210 host on 2026-11-16 and copied here
// unchanged (formatted the way the screens format it). Where 8210 had no case of a state (a failed check, a change with a
// value before it, a refusal), the values come from this repository's own runs of the same cable, named at each entry.
import type { Step } from '@/kit/chat/steps';
import type { Change, CheckFailure } from '@/kit/chat/cards';

/** The conversation list (8210 /api/chat/sessions): all seven were started today. */
export const CHATS = [
  { id: '01a1e248', title: '挑一个三芯铠装规格，建三维结构模型，让我看各层。' },
  { id: '01a1e246', title: '挑一个三芯铠装规格，建三维结构模型，让我看各层。' },
  { id: '01a1e245', title: '挑一个三芯铠装规格，建三维结构模型，让我看各层。' },
  { id: '01a1e240', title: '选一款型号，直埋敷设，算载流量，说明哪根电缆先到温限。' },
  { id: '01a1e22e', title: '导入公开结构表示例，算参数并按国标核对，列出不通过项。' },
  { id: '01a1e230', title: '选一款型号，直埋敷设，算载流量，说明哪根电缆先到温限。' },
  { id: '01a1e22c', title: '选一款型号，直埋敷设，算载流量，说明哪根电缆先到温限。' },
];
export const ACTIVE_CHAT = '01a1e240';
export const MODEL = 'glm-5.3-flash';

/**
 * Tasks to start from: what the Agent's skills (studio/skills) do, grouped by the two things the product does. The first,
 * second and fourth are the round-1 tasks of ROADMAP.md; the prompts ask for work, not for numbers.
 */
export const STARTERS = {
  types: [
    { icon: 'action/import', title: '导入结构表示例并核对', result: '算参数，按国标列出不通过项', prompt: '导入公开结构表示例，算参数并按国标核对，列出不通过项。' },
    { icon: 'action/edit', title: '改一个尺寸，再核对一遍', result: '出新的草稿版本，说明哪些项变了', prompt: '把 YJV22-8.7/15 kV 3×240 的绝缘厚度改薄一些，出新版本再核对，说明哪些项变了。' },
    { icon: 'object/file', title: '导出一份规格书', result: '挑一个规格，生成 PDF', prompt: '挑一个规格，导出一份规格书。' },
  ],
  rating: [
    { icon: 'calc/ampacity', title: '算一款型号的直埋载流量', result: '说明哪根电缆先到温限', prompt: '选一款型号，直埋敷设，算载流量，说明哪根电缆先到温限。' },
    { icon: 'calc/selection', title: '按目标电流选截面', result: '从一个系列里选出够用的最小截面', prompt: '已知负荷电流，从 YJV22-8.7/15 kV 三芯里选直埋敷设够用的最小截面。' },
    { icon: 'result/report', title: '导出一份计算书', result: '把一条运行记录排成可打印的文件', prompt: '把最近一条载流量运行记录导出为计算书。' },
  ],
};

// ---- Conversation 01a1e240: the ampacity of YJV22-8.7/15 kV 3×240 buried direct ----

const PROJECT = '工程「YJV22-8.7/15 3×240 直埋载流量校核」';

export const RATING_ASK = '选一款型号，直埋敷设，算载流量，说明哪根电缆先到温限。';

export const RATING_STEPS: Step[] = [
  { id: 's1', label: '读取技能', target: '技能「载流量校核与选型」', state: 'done', seconds: 0.001 },
  { id: 's2', label: '型号库', state: 'done', seconds: 0.008 },
  { id: 's3', label: '工程列表', state: 'done', seconds: 0.002 },
  { id: 's4', label: '新建工程', target: PROJECT, state: 'done', seconds: 0.033 },
  { id: 's5', label: '运行校核', target: PROJECT, state: 'done', seconds: 1.896, notes: ['允许电流 458.7 A', '先到温限：三芯电缆', '可信分档：参考'] },
  { id: 's6', label: '在工作台打开', target: PROJECT, state: 'done', seconds: 0.008 },
];

/** The new project the Agent proposed and the engineer accepted (proposal pr-d32786d7). */
export const NEW_PROJECT: Change[] = [
  { label: '工程名称', after: 'YJV22-8.7/15 3×240 直埋载流量校核' },
  { label: '型号', after: 'YJV22-8.7/15 kV 3×240' },
  { label: '敷设方式', after: '三芯直埋 · 单回' },
  { label: '中心埋深', after: '1.2 m' },
  { label: '护套接地', after: '两端接地' },
  { label: '土壤热阻率', after: '1 K·m/W' },
  { label: '环境温度', after: '25 °C' },
  { label: '系统线电压', after: '15 kV' },
  { label: '频率', after: '50 Hz' },
  { label: '负荷电流', after: '300 A' },
];

/** Run record run-9dd64e85: IEC 60287 稳态载流量 (cablesim.iec60287 1.2.0), operating case at the saved load. */
export const RATING = {
  title: 'YJV22-8.7/15 kV 3×240 · 三芯直埋',
  tier: 'reference' as const,
  current: '458.7',
  basis: '单回路能力',
  limiting: { name: '三芯电缆 · 回路 1', conductor: 49.69344964107793, limit: 90, ambient: 25, load: '300 A', margin: '158.7 A' },
};

// ---- Conversation 01a1e22e, second request: the specification sheet of the same size ----

export const EXPORT_ASK = '挑一个规格，导出一份规格书。';

export const EXPORT_STEPS: Step[] = [
  { id: 'e1', label: '读取技能', target: '技能「规格书与计算书」', state: 'done', seconds: 0.001 },
  { id: 'e2', label: '读取系列', target: '人民电缆集团 YJV22-8.7/15 kV 三芯', state: 'done', seconds: 0.025 },
  { id: 'e3', label: '读取规格', target: 'YJV22-8.7/15 kV 3×240', state: 'done', seconds: 0.006 },
  { id: 'e4', label: '规格书记录', target: 'YJV22-8.7/15 kV 3×240', state: 'done', seconds: 0.005 },
  { id: 'e5', label: '导出规格书', target: 'YJV22-8.7/15 kV 3×240', state: 'done', seconds: 0.478, notes: ['YJV22-8.7/15 kV 3×240 · 第 1 版', '审核状态：草稿'] },
];

export const SHEET = { title: 'YJV22-8.7/15 kV 3×240 · 第 1 版', kind: '规格书', format: 'PDF' as const, review: 'draft' as const };

// ---- A conversation in progress (conversation 01a1e248, building the solid; the run took 35.9 s) ----

export const MODEL_STEPS_RUNNING: Step[] = [
  { id: 'm1', label: '读取技能', target: '技能「电缆三维结构建模」', state: 'done', seconds: 0.001 },
  { id: 'm2', label: '型号库', state: 'done', seconds: 0.006 },
  { id: 'm3', label: '读取规格', target: 'YJV22-8.7/15 kV 3×240', state: 'done', seconds: 0.005 },
  { id: 'm4', label: '生成 CAD 实体', target: 'YJV22-8.7/15 kV 3×240', state: 'running' },
];
export const MODEL_FACTS = [{ label: '外径', value: '82 mm' }, { label: '层数', value: '19' }];

// ---- States 8210 had no case of, produced on this branch's own host (8212) with the same cable and the same steps as
// tests/library.test.ts: the 表3 YJV22 sheet of the public sample imported, computed, then 3×240 revised. ----

/** Revision of YJV22-8.7/15 kV 3×240 to version 2 (draft), note 客户要求减薄绝缘，先看是否合规. */
export const THINNER: Change[] = [{ label: '绝缘标称厚度', before: '4.5 mm', after: '4 mm' }];
export const THINNER_NOTE = '客户要求减薄绝缘，先看是否合规';
/** Its check (library.spec.get, version 2): 3 项不满足. The three cores fail the same requirement; listed once. */
export const CHECK_V2 = { passed: 10, failed: 3, missing: 21, uncovered: 4 };
export const THINNER_FAILURES: CheckFailure[] = [
  { title: '绝缘标称厚度', scope: '芯 1、芯 2、芯 3', actual: '4 mm', required: '≥ 4.5 mm', clause: 'GB/T 12706.2—2020 表 7' },
];
/** Version 1 as it stands (8210 and 8212 alike): 13 passed, 21 missing, 4 not covered. */
export const CHECK_V1 = { passed: 13, failed: 0, missing: 21, uncovered: 4 };

/** A series whose sizes were never computed (8210 library.check.failures s-huayuan-yjv22-15kv: not_checked 10). */
export const UNCHECKED = { title: '标准核对 · YJV22-8.7/15 kV 三芯（华远公开表）', unchecked: 10 };
/** The host cannot be reached (studio/ui/state/api.ts, code HOST_UNREACHABLE). */
export const HOST_DOWN = '连不上本机服务，请确认 Cable Studio 仍在运行。';

/** The method refuses 3×50 (rating rows of library.spec.get, code SL_FILLER_GEOMETRY_RANGE). */
export const REFUSED_RATING = {
  title: '载流量 · YJV22-8.7/15 kV 3×50',
  reason: '填充与内衬厚度/芯外径须在(0,0.15]，图6范围外改用数值传热方法。',
  missing: [
    { label: '超出范围', detail: '填充与内衬厚度 / 芯外径，IEC 60287-2-1 图 6 的适用范围是 (0, 0.15]' },
    { label: '可以怎么做', detail: '换用数值传热方法复核（有限元，需超算）' },
  ],
};
/** The import refuses a declaration without the insulation screen thickness (code STRUCTURE_INCOMPLETE, all 11 rows). */
export const REFUSED_IMPORT = {
  title: '导入 · 表3 YJV22',
  reason: '缺绝缘屏蔽厚度：结构表和系列声明里都没有。11 行都没有导入。',
  missing: [{ label: '绝缘屏蔽厚度', detail: '在系列声明里补上，或在结构表里加一列' }],
};

// ---- Step states the conversations above did not reach ----

/** Conversation 01a1e240 while it waited for the engineer to accept the new project (its fourth step). */
export const STEPS_WAITING: Step[] = [
  ...RATING_STEPS.slice(0, 3),
  { id: 's4', label: '新建工程', target: PROJECT, state: 'waiting' },
];
/** The agent asked to read the repository's own conventions and was refused (tests/agent.test.ts, 'only skill files'). */
export const STEPS_RECOVERED: Step[] = [
  { id: 'r1', label: '读取技能', target: '技能「载流量校核与选型」', state: 'done', seconds: 0.001 },
  { id: 'r2', label: '读取技能', state: 'failed', reason: '只能读取技能文件。' },
  { id: 'r3', label: '读取技能', target: '技能「型号改版」', state: 'done', seconds: 0.001 },
];
/** A run the method refuses ends the task there: the refusal of 3×50 (see REFUSED_RATING) as the last step. */
export const STEPS_FAILED: Step[] = [
  { id: 'f1', label: '读取技能', target: '技能「载流量校核与选型」', state: 'done', seconds: 0.001 },
  { id: 'f2', label: '读取规格', target: 'YJV22-8.7/15 kV 3×50', state: 'done', seconds: 0.006 },
  { id: 'f3', label: '运行校核', target: 'YJV22-8.7/15 kV 3×50 · 三芯直埋', state: 'failed', reason: '填充与内衬厚度/芯外径须在(0,0.15]，图6范围外改用数值传热方法。' },
];
/** Conversation 01a1e248 stopped by the engineer while the solid was being built. */
export const STEPS_STOPPED: Step[] = [
  ...MODEL_STEPS_RUNNING.slice(0, 3),
  { id: 'm4', label: '生成 CAD 实体', target: 'YJV22-8.7/15 kV 3×240', state: 'interrupted' },
];
/** What the CAD plugin answers for a construction it does not cover (studio/skills/cable-3d-model/SKILL.md). */
export const MODEL_REFUSAL = '缺单丝参数：插件没有覆盖这种构造，补上构造参数后再建模。';
