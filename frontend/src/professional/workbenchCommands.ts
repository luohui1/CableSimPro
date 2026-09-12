/** A catalog of implemented actions, not a catalog of aspirational solver features. */
export const WORKBENCH_COMMANDS = [
 {id:'plugins',title:'打开插件中心',group:'工程资源',keywords:'插件 扩展 市场 chajian plugin extension marketplace',hint:'本机随包插件、版本权限和接入路线；不自动联网安装'},
 {id:'assets',title:'打开工程资产库',group:'工程资源',keywords:'资产 库 zican zichan library asset material assembly',hint:'版本化结构、材料定义与本机发布；不改变当前工程'},
 {id:'study-preflight',title:'研究准备与求解器预检',group:'工程资源',keywords:'研究 准备 预检 yanjiu yujian study preflight comsol aedt',hint:'只读检查当前快照、结构配方与后端缺项；不运行仿真',guard:'snapshot'},
 {id:'run',title:'运行载流量计算',group:'计算分析',keywords:'计算 载流量 jisuan zailiuliang ampacity solve',hint:'当前输入 · 单回路直埋',shortcut:'F9',guard:'solve'},
 {id:'model',title:'显示三维结构',group:'建模与视图',keywords:'结构 三维 jiegou sanwei model 3d',hint:'返回同一电缆模型'},
 {id:'section',title:'显示二维截面',group:'建模与视图',keywords:'截面 jiemian section 2d',hint:'当前尺寸的等比例截面'},
 {id:'installation',title:'敷设与负荷',group:'建模与视图',keywords:'敷设 埋深 fushe installation depth',hint:'二维精确布置与三维空间检查'},
 {id:'temperature',title:'显示温度分布',group:'计算分析',keywords:'温度 wendu temperature heat',hint:'当前运行的解析温度场；无结果时留空'},
 {id:'curve',title:'显示载流量曲线',group:'计算分析',keywords:'曲线 quxian curve current',hint:'电流与导体温度关系'},
 {id:'analysis',title:'展开结果分析',group:'计算分析',keywords:'结果 分析 jieguo fenxi result analysis',hint:'曲线、结果表、扫描与运行证据'},
 {id:'parameters',title:'打开参数检查器',group:'建模与视图',keywords:'参数 canshu property inspector',hint:'真实输入、参数锁定与校验'},
 {id:'generator',title:'参数化建模',group:'建模与视图',keywords:'建模 jianmo generate',hint:'形成待审查的参数化方案',guard:'write'},
 {id:'projects',title:'打开工程中心',group:'工程资源',keywords:'工程 项目 gongcheng xiangmu project workspace',hint:'打开已保存工程与工程资源'},
 {id:'fork',title:'另存计算方案',group:'工程操作',keywords:'另存 保存 lingcun baocun save copy fork',hint:'创建独立方案，原工程不变',guard:'write'},
 {id:'undo',title:'撤销工程修改',group:'工程操作',keywords:'撤销 chexiao undo',hint:'使用工程版本历史，不丢弃未提交输入',guard:'undo'},
 {id:'json',title:'导出工程参数',group:'工程操作',keywords:'导出 daochu json export',hint:'仅导出 Scenario；不是完整工程备份',guard:'write'},
 {id:'report',title:'生成计算书',group:'工程操作',keywords:'报告 计算书 baogao jisuan shu report export',hint:'只允许导出当前版本的有效计算结果',guard:'report'},
 {id:'products',title:'打开产品型号',group:'工程资源',keywords:'产品 型号 chanpin xinghao library product',hint:'引用已核对的企业型号'},
 {id:'documents',title:'打开企业资料',group:'工程资源',keywords:'资料 文件 ziliao wenjian documents evidence',hint:'原件、识别与参数核对'},
 {id:'methods',title:'检查设计依据',group:'工程资源',keywords:'标准 依据 方法 biaozhun yiju method standard',hint:'适用范围、依据版本与未实现条款'},
 {id:'history',title:'查看计算记录',group:'工程资源',keywords:'历史 运行 记录 lishi jilu runs history',hint:'历史输入快照，不提升为当前结果'},
 {id:'journal',title:'查看任务与引用',group:'工程资源',keywords:'任务 引用 renwu yinyong task journal',hint:'工程任务与来源关系'},
 {id:'fields',title:'打开专项场计算',group:'计算分析',keywords:'电场 磁场 竖向 dianchang cichang field',hint:'每种方法保留独立适用范围'},
 {id:'selection',title:'候选电缆选型',group:'计算分析',keywords:'选型 xuanxing candidate selection',hint:'候选逐项复算，应用前需审批'},
 {id:'soil-sweep',title:'扫描土壤热阻率',group:'参数研究',keywords:'扫描 土壤 saomiao turang soil sweep',hint:'填写明确离散点 → Agent 审查；不直接求解',guard:'write'},
 {id:'temperature-sweep',title:'比较环境温度',group:'参数研究',keywords:'扫描 环境 温度 saomiao huanjing wendu temperature sweep',hint:'填写明确温度点 → Agent 审查',guard:'write'},
 {id:'depth-sweep',title:'比较平均中心埋深',group:'参数研究',keywords:'扫描 埋深 maishen depth sweep',hint:'填写明确埋深点 → Agent 审查',guard:'write'},
 {id:'spacing-sweep',title:'比较相邻中心间距',group:'参数研究',keywords:'扫描 间距 jianju spacing sweep',hint:'填写明确中心间距 → Agent 审查',guard:'write'},
 {id:'agent',title:'进入智能工程流',group:'工程资源',keywords:'智能 助手 智能体 zhushou zhineng ai agent',hint:'计划、人工审批和实际工具执行'},
 {id:'settings',title:'服务接入设置',group:'工程资源',keywords:'设置 接入 shezhi settings',hint:'本机服务配置与外发授权'},
] as const;
export type WorkbenchCommandId = typeof WORKBENCH_COMMANDS[number]['id'];
export type WorkbenchCommand = typeof WORKBENCH_COMMANDS[number];
export interface CommandState {busy:boolean;dirty:boolean;buried:boolean;current:boolean;canUndo:boolean}
export function commandBlockReason(command:WorkbenchCommand,state:CommandState):string|null {
 const guard='guard' in command?command.guard:undefined;
 if(!guard)return null;
 if(state.busy)return '工程操作进行中，请等待完成';
 if(state.dirty)return '请先提交或撤销未提交输入';
 if(guard==='solve'&&!state.buried)return '当前不是直埋计算域，请打开专项场计算';
 if(guard==='report'&&!state.current)return '没有当前版本的有效计算结果';
 if(guard==='undo'&&!state.canUndo)return '没有可以撤销的工程修改';
 return null;
}
export function searchCommands(query:string,group='全部'):WorkbenchCommand[] {
 const terms=query.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
 return WORKBENCH_COMMANDS.filter(c=>(group==='全部'||c.group===group)&&terms.every(term=>`${c.title} ${c.keywords} ${c.hint}`.toLowerCase().includes(term)));
}
export function cleanCommandIds(value:unknown):WorkbenchCommandId[] {
 return Array.isArray(value)?[...new Set(value.filter((id):id is WorkbenchCommandId=>typeof id==='string'&&WORKBENCH_COMMANDS.some(c=>c.id===id)))].slice(0,8):[];
}
