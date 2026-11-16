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
 * Tasks to start from: the engineering cases the hosts have actually run (8210's conversations, this branch's 8212 project
 * and versions), each with what comes back. The prompts ask for work, not for numbers.
 */
export const STARTERS = {
  types: [
    { icon: 'action/import', title: '导入人民电缆结构表并核对', result: '4 张表成 4 个系列，列出不通过项', prompt: '导入公开结构表示例（人民电缆 8.7/15 kV），算参数并按 GB/T 12706.2—2020 核对，列出不通过项。' },
    { icon: 'action/edit', title: '3×240 绝缘减到 4 mm 再核对', result: '新草稿版本和不通过的条款', prompt: '把 YJV22-8.7/15 kV 3×240 的绝缘标称厚度改成 4 mm，出新版本再核对，说明哪些条款不通过。' },
    { icon: 'object/file', title: '导出 3×240 第 1 版规格书', result: 'PDF，带来源和核对结论', prompt: '导出 YJV22-8.7/15 kV 3×240 第 1 版的规格书。' },
  ],
  rating: [
    { icon: 'calc/ampacity', title: '3×240 直埋单回算允许电流', result: '埋深 1.2 m，说明先到温限的电缆', prompt: '选 YJV22-8.7/15 kV 3×240，三芯直埋单回，埋深 1.2 m，土壤热阻率 1 K·m/W，环境 25 °C，算允许电流，说明哪根先到温限。' },
    { icon: 'calc/selection', title: '负荷 400 A 选最小截面', result: '三芯直埋，每个规格够不够', prompt: '负荷 400 A，三芯直埋单回，从人民电缆 YJV22-8.7/15 kV 三芯里选够用的最小截面。' },
    { icon: 'calc/sweep', title: '土壤热阻率 0.8–3 扫一遍', result: '允许电流曲线和最紧的一点', prompt: '对 YJV22-8.7/15 3×240 直埋工程，把土壤热阻率从 0.8 扫到 3 K·m/W，看允许电流怎么变。' },
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
/** The same conversation once the solid was built; what was built is on the card, read from the host. */
export const MODEL_STEPS_DONE: Step[] = [
  ...MODEL_STEPS_RUNNING.slice(0, 3),
  { ...MODEL_STEPS_RUNNING[3], state: 'done' },
];
/** What the host says when no model is configured: NOT_CONFIGURED of studio/host/agent.ts, word for word. */
export const NOT_CONFIGURED = '设置环境变量 DEEPSEEK_API_KEY，或设置 CABLE_STUDIO_MODEL_BASE_URL、CABLE_STUDIO_MODEL_ID、CABLE_STUDIO_MODEL_API_KEY（OpenAI 兼容接口）后重启。密钥只从环境变量读取，不写入磁盘。';
/** From the step's notes: 外径 82 mm, 19 层，STEP 文件已生成. */
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

/** The 1 s short-circuit current of 3×240 version 1: short_circuit_ka 34.340041598762646 in library.series.get on
 *  8212 (the same table computed by tests/library.test.ts, which asserts 34.34 ± 0.05). */
export const SHORT_CIRCUIT = { value: 34.340041598762646, unit: 'kA' };

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
/** The agent asked to read the repository's own conventions and was refused: the message of studio/host/agent-tools.ts
 *  skillReader with this branch's five skills (tests/agent.test.ts, 'only skill files'). */
export const STEPS_RECOVERED: Step[] = [
  { id: 'r1', label: '读取技能', target: '技能「载流量校核与选型」', state: 'done', seconds: 0.001 },
  { id: 'r2', label: '读取技能', state: 'failed', reason: '只能读取技能文件：ampacity-rating、cable-3d-model、cable-import-check、cable-revision、spec-and-report。' },
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
/** The engineer's request the refusal of 3×50 answers (the same project conditions: three-core, buried, single circuit). */
export const REFUSED_ASK = 'YJV22-8.7/15 kV 3×50 直埋单回，算一下载流量。';
/** The structure table being attached to the next message, while it uploads. */
export const UPLOADING = { name: '人民电缆 8.7-15kV 结构表（公开手册）.xlsx', detail: '正在上传' };
/** The export of conversation 01a1e22e when the host stops answering before its last step: the steps that were done, the one
 *  that was under way, and the message of studio/ui/state/api.ts (HOST_DOWN). */
export const STEPS_CUT: Step[] = [
  ...EXPORT_STEPS.slice(0, 4),
  { ...EXPORT_STEPS[4], state: 'interrupted', seconds: undefined, notes: undefined },
];
/** Conversation 01a1e240's answer, as it was written (8210): the lead, then the points. */
export const RATING_ANSWER = {
  lead: '已选 YJV22-8.7/15 kV 3×240（人民电缆公开结构表，钢带铠装），按三芯直埋单回、埋深 1.2 m、土壤热阻率 1 K·m/W、环境 25 °C 算了一条运行记录。',
  points: [
    '允许电流 458.7 A；保存负荷 300 A 时导体 49.7 °C（限值 90 °C），离允许电流还差 158.7 A。',
    '只敷设了一个回路，先到温限的就是这根三芯电缆本身。',
    '可信分档为参考：三芯分支只有组件级手算对照，交付前请另行核对。',
  ],
};
/** Conversation 01a1e22e's answer to the export (8210, where version 1 was still a draft). */
export const EXPORT_ANSWER = '规格书已导出：YJV22-8.7/15 kV 3×240 第 1 版，含结构表、电气参数和标准核对结论（通过 13 项、不通过 0 项、缺项 21 项）。这一版还没审核，文件上标着“草稿”，能否对外由你决定。';
/** The text of conversation 01a1e240's answer up to the point it had reached while it was still being written. */
export const STREAMED = '已选 YJV22-8.7/15 kV 3×240（人民电缆公开结构表，钢带铠装），按三芯直埋单回、埋深 1.2 m、土壤热阻率 1 K·m/W、环境 25 °C 算了一条运行记录。';
export const STREAMING_LINE = '允许电流 458.7 A；保存负荷 300 A 时导体 49.7 °C（限值 90 °C），离允许电流还差';

/** What the CAD plugin answers for a stranding it does not build: the message of
 *  plugins/cablesim.cable-geometry/src/cablesim_cable_geometry/main.py, word for word. */
export const MODEL_REFUSAL = '圆绞合支持 1+6+12…完整同心绞层，请核对根数';

/**
 * The GB 50217 correction of the plugin's own hand check, as studio-build's branch (claude/cable-studio-two-modes-45a9bc)
 * runs it in studio/core/tests/test_gb50217.py: soil at 30 °C against a 25 °C baseline (D.0.1, page 72) and three cables
 * 100 mm apart (D.0.4, page 73) on the test's synthetic 400 A baseline, 400 × 0.96 × 0.85 = 326.4 A. The baseline's words are
 * that test's BASELINE source; the condition texts, the clauses and the scope are the method's strings
 * (plugins/cablesim.gb50217-correction correction.py), and "工程师" is its headline's "基准出处已由工程师核对". No host here
 * holds a correction record yet.
 */
export const CORRECTION_EXAMPLE = {
  corrected: '326.4',
  baseline: '400',
  total: '0.816',
  coefficients: [
    { label: '环境温度', condition: '正常温限 90 °C；实际环境 30 °C，基准 25 °C', factor: '0.96', place: 'GB 50217—2018 D.0.1 第 72 页' },
    { label: '并列根数与间距', condition: '并列 3 根；净距 100 mm', factor: '0.85', place: 'GB 50217—2018 D.0.4 第 73 页' },
  ],
  source: '手算核验用的合成基准：单根、同温限及埋深；不是厂家额定值',
  scope: '单根基准、相同正常导体温限、相同中心埋深；均匀土壤直埋或空气单层等间距，同型号电缆。D.0.3 仅用于 C.0.1-2；不覆盖排管、桥架、多层、日照、交叉热源。',
};
