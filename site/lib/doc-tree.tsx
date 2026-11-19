import type * as PageTree from 'fumadocs-core/page-tree';
import {
  Blocks,
  Bot,
  Calculator,
  Compass,
  FileCheck2,
  FileCode2,
  FileSpreadsheet,
  Flame,
  GitFork,
  HardDriveDownload,
  HelpCircle,
  Layers,
  Network,
  PlayCircle,
  PlugZap,
  Server,
  ShieldAlert,
  Sigma,
  Wrench,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface TreeLeafSpec {
  id: string;
  title: string;
  url: string;
  badge?: string;
  note?: string;
}

export interface TreeSubgroupSpec {
  id: string;
  title: string;
  iconKey: IconKey;
  defaultOpen?: boolean;
  items: TreeLeafSpec[];
}

export interface TreeBranchSpec {
  code: string;
  id: string;
  domain: string;
  title: string;
  sidebarTitle?: string;
  summary: string;
  iconKey: IconKey;
  defaultOpen?: boolean;
  directItems?: TreeLeafSpec[];
  subgroups?: TreeSubgroupSpec[];
}

export type IconKey =
  | 'network'
  | 'play'
  | 'download'
  | 'plug'
  | 'server'
  | 'filecode'
  | 'compass'
  | 'layers'
  | 'zap'
  | 'bot'
  | 'sigma'
  | 'calc'
  | 'flame'
  | 'sheet'
  | 'blocks'
  | 'fork'
  | 'shield'
  | 'help'
  | 'wrench'
  | 'check';

export function renderTreeIcon(key: IconKey, className = 'size-4 shrink-0 text-brand') {
  switch (key) {
    case 'network':
      return <Network className={className} />;
    case 'play':
      return <PlayCircle className={className} />;
    case 'download':
      return <HardDriveDownload className={className} />;
    case 'plug':
      return <PlugZap className={className} />;
    case 'server':
      return <Server className={className} />;
    case 'filecode':
      return <FileCode2 className={className} />;
    case 'compass':
      return <Compass className={className} />;
    case 'layers':
      return <Layers className={className} />;
    case 'zap':
      return <Zap className={className} />;
    case 'bot':
      return <Bot className={className} />;
    case 'sigma':
      return <Sigma className={className} />;
    case 'calc':
      return <Calculator className={className} />;
    case 'flame':
      return <Flame className={className} />;
    case 'sheet':
      return <FileSpreadsheet className={className} />;
    case 'blocks':
      return <Blocks className={className} />;
    case 'fork':
      return <GitFork className={className} />;
    case 'shield':
      return <ShieldAlert className={className} />;
    case 'help':
      return <HelpCircle className={className} />;
    case 'wrench':
      return <Wrench className={className} />;
    case 'check':
      return <FileCheck2 className={className} />;
  }
}

/**
 * 全站 51 页工程文档的四层 × 六分支 × 三级树状分类体系（侧边栏与体系树组件共用同一份定义）
 */
export const DOC_TAXONOMY: { domain: string; branches: TreeBranchSpec[] }[] = [
  {
    domain: '第一层 · 入门与部署运维',
    branches: [
      {
        code: '01',
        id: 'quickstart',
        domain: '第一层 · 入门与部署运维',
        title: '快速上手（双主线实操）',
        sidebarTitle: '快速上手（含视频）',
        summary: '面向电缆厂技术部与科研院所的两条端到端实操流程，配套完整实机视频与可复现示例库。',
        iconKey: 'play',
        defaultOpen: true,
        directItems: [
          {
            id: 'qs-factory',
            title: '制造企业：从结构表到正式规格书',
            url: '/docs/quickstart/factory/',
            badge: '视频 01:39',
            note: '五步导入 Excel 结构表 → 逐项来源核查 → 批量核对与载流量 → 产品规格书',
          },
          {
            id: 'qs-research',
            title: '科研院所：从新建工程到计算书',
            url: '/docs/quickstart/research/',
            badge: '视频 01:43',
            note: '110 kV 品字形直埋建模 → 944.8 A 基准求解 → 热阻率敏感性对比 → PDF 计算书',
          },
        ],
      },
      {
        code: '02',
        id: 'install',
        domain: '第一层 · 入门与部署运维',
        title: '安装、配置与运维',
        summary: 'Windows / Linux 离线包安装、release.toml 配置、模型与 Slurm 超算接入、内网部署及工程库备份恢复。',
        iconKey: 'download',
        defaultOpen: false,
        directItems: [
          { id: 'ins-index', title: '下载与离线安装（总览）', url: '/docs/install/', note: '离线 ZIP 包校验、无管理员安装与源码一键启动' },
          { id: 'ins-cfg', title: 'release.toml 参数配置', url: '/docs/install/configuration/', note: '端口、存储路径、超时与回退控制' },
          { id: 'ins-up', title: '升级、备份与恢复', url: '/docs/install/upgrade-restore/', note: '在线快照备份、SHA-256 核验恢复与版本回退' },
        ],
        subgroups: [
          {
            id: 'ins-ext',
            title: '外部模型与超算接入',
            iconKey: 'plug',
            defaultOpen: true,
            items: [
              { id: 'ins-model', title: '接入 AI 模型', url: '/docs/install/model/', note: 'OpenAI 兼容接口配置与环境变量凭据隔离' },
              { id: 'ins-agent', title: 'Agent 对话服务与排错', url: '/docs/install/agent/', note: '独立 Node 边车端口、状态核查与故障定位' },
              { id: 'ins-hpc', title: '超算集群（Slurm）接入', url: '/docs/install/hpc/', note: '专用账户、队列配置与核时上限保护' },
            ],
          },
          {
            id: 'ins-net',
            title: '内网与文档站点部署',
            iconKey: 'server',
            defaultOpen: false,
            items: [
              { id: 'ins-intra', title: '内网多人部署', url: '/docs/install/intranet/', note: '反向代理、独占锁边界与内网隔离规范' },
              { id: 'ins-docs', title: '部署本文档站点', url: '/docs/install/docs-site/', note: 'Nginx / 静态服务器离线托管 out/ 产物' },
            ],
          },
          {
            id: 'ins-ref',
            title: '发行与库维护底层说明',
            iconKey: 'filecode',
            defaultOpen: false,
            items: [
              { id: 'ins-ref-rel', title: '离线发行技术说明', url: '/docs/install/reference/release-installation/', badge: '仓库同步' },
              { id: 'ins-ref-db', title: '工程库维护技术说明', url: '/docs/install/reference/database-operations/', badge: '仓库同步' },
            ],
          },
        ],
      },
    ],
  },
  {
    domain: '第二层 · 工作台与智能体手册',
    branches: [
      {
        code: '03',
        id: 'guide',
        domain: '第二层 · 工作台与智能体手册',
        title: '用户指南（按业务模块）',
        sidebarTitle: '用户指南（业务模块）',
        summary: '覆盖电缆型号入库、分层结构设计、载流量研究与扫描、超算有限元仿真、正式交付文件与受控 Agent。',
        iconKey: 'compass',
        defaultOpen: true,
        directItems: [
          { id: 'gd-index', title: '用户指南与工作台总览', url: '/docs/guide/', note: '工程、型号、研究、运行快照与交付物的对应关系' },
        ],
        subgroups: [
          {
            id: 'gd-cable',
            title: '电缆型号与结构设计',
            iconKey: 'layers',
            defaultOpen: true,
            items: [
              { id: 'gd-lib', title: '型号库与结构表导入', url: '/docs/guide/type-library/', note: 'CSV/XLSX 五步导入向导、系列批量核对与批量载流量' },
              { id: 'gd-type', title: '型号设计与规格书审核', url: '/docs/guide/type-design/', note: '分层截面编辑、五项计算通道与版本批准发布' },
              { id: 'gd-res', title: '材料、部件与标准规则库', url: '/docs/guide/resources/', note: '固定版本引用、材料属性来源与标准依据检索' },
            ],
          },
          {
            id: 'gd-calc',
            title: '载流量校核与热场仿真',
            iconKey: 'zap',
            defaultOpen: true,
            items: [
              { id: 'gd-amp', title: '载流量研究、扫描与选型', url: '/docs/guide/ampacity-study/', note: '直埋/排管/回填建模、参数扫描、问询选型与运行对比' },
              { id: 'gd-sim', title: '有限元热场与电热仿真', url: '/docs/guide/simulation/', note: '稳态/暂态热场、电热耦合提交超算及网格收敛证据' },
            ],
          },
          {
            id: 'gd-deliv',
            title: '正式交付与工程智能体',
            iconKey: 'bot',
            defaultOpen: true,
            items: [
              { id: 'gd-doc', title: '正式交付文件与四级签栏', url: '/docs/guide/deliverables/', note: '计算书、规格书、载流量表（PDF/Excel）与逐值追溯页' },
              {
                id: 'gd-agent',
                title: 'Agent 的用法与权限边界',
                url: '/docs/guide/agent/',
                badge: '视频 01:14',
                note: '只读快照查询、“待你审阅”提案卡片、单步授权与九项内置技能',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    domain: '第三层 · 算法依据与插件扩展',
    branches: [
      {
        code: '04',
        id: 'methods',
        domain: '第三层 · 算法依据与插件扩展',
        title: '计算方法与标准依据',
        summary: '宿主不内置算法；所有公式、适用边界、参数范围与验证算例均由封签插件公开声明并逐项核验。',
        iconKey: 'sigma',
        defaultOpen: false,
        directItems: [
          { id: 'mt-index', title: '方法体系、验证等级与结果口径', url: '/docs/methods/', note: '预检拦截机制、四级验证划分与多回路电流口径' },
        ],
        subgroups: [
          {
            id: 'mt-std',
            title: '标准解析计算与尺寸核对',
            iconKey: 'calc',
            defaultOpen: true,
            items: [
              { id: 'mt-iec', title: 'IEC 60287 稳态载流量', url: '/docs/methods/iec-60287/', note: '损耗、热阻、镜像法多缆互热与适用范围' },
              { id: 'mt-gb', title: 'GB 50217 载流量校正', url: '/docs/methods/gb-50217/', note: '附录 D 温度、土壤热阻率与多回并列校正系数' },
              { id: 'mt-chk', title: '产品标准尺寸与电阻核对', url: '/docs/methods/standard-check/', note: 'GB/T 12706、GB/T 11017、GB/T 3956 逐条核验' },
            ],
          },
          {
            id: 'mt-fem',
            title: '交叉校核、有限元与能力总表',
            iconKey: 'flame',
            defaultOpen: true,
            items: [
              { id: 'mt-tn', title: '简化热网络交叉校核', url: '/docs/methods/thermal-network/', note: '同输入独立热网络对照求解' },
              { id: 'mt-fe', title: '有限元热场与电热对照', url: '/docs/methods/fem/', note: '多区域导热、时谐涡流损耗与双级收敛判据' },
              { id: 'mt-cat', title: '全部插件与计算能力清单', url: '/docs/methods/catalog/', badge: '12 插件', note: '由 plugins/*/plugin.json 自动汇总' },
            ],
          },
          {
            id: 'mt-notes',
            title: '逐项公式推导与对拍底稿（8 篇）',
            iconKey: 'sheet',
            defaultOpen: false,
            items: [
              { id: 'mn-1', title: '载流量口径与热网络参考', url: '/docs/methods/notes/rating-basis/', badge: '底稿' },
              { id: 'mn-2', title: 'IEC 60287 逐项依据与算例', url: '/docs/methods/notes/iec-60287/', badge: '底稿' },
              { id: 'mn-3', title: '型号电气参数与短路容量', url: '/docs/methods/notes/type-electrical/', badge: '底稿' },
              { id: 'mn-4', title: '型号载流量表推导说明', url: '/docs/methods/notes/type-rating-table/', badge: '底稿' },
              { id: 'mn-5', title: '产品标准尺寸核对依据', url: '/docs/methods/notes/standard-check/', badge: '底稿' },
              { id: 'mn-6', title: '均匀土壤三芯热参考（EN）', url: '/docs/methods/notes/buried-reference/', badge: 'EN' },
              { id: 'mn-7', title: '半空间线热源交叉校核（EN）', url: '/docs/methods/notes/line-source-crosscheck/', badge: 'EN' },
              { id: 'mn-8', title: '电热耦合参考算例（EN）', url: '/docs/methods/notes/electrothermal-reference/', badge: 'EN' },
            ],
          },
        ],
      },
      {
        code: '05',
        id: 'develop',
        domain: '第三层 · 算法依据与插件扩展',
        title: '插件规范与二次开发',
        summary: 'cablesim.plugin/2 清单协议、子进程执行契约、声明式模板/技能示例及 252 个宿主 REST 接口参考。',
        iconKey: 'blocks',
        defaultOpen: false,
        directItems: [
          { id: 'dv-index', title: '插件架构与开发总览', url: '/docs/develop/', note: '宿主与插件职责边界、cablesim.run/2 子进程协议' },
          { id: 'dv-man', title: '插件清单字段（plugin.json）', url: '/docs/develop/plugin-manifest/', note: '由 manifest.schema.json 自动生成的字段表与封签命令' },
          { id: 'dv-ex', title: '声明式插件示例（模板与技能）', url: '/docs/develop/examples/', note: 'report-template 与 agent-skill 原件代码展示' },
          { id: 'dv-api', title: '宿主 REST 接口参考（OpenAPI）', url: '/docs/develop/api/', badge: '252 端点', note: '按业务标签分组的完整请求与响应定义' },
        ],
        subgroups: [
          {
            id: 'dv-host',
            title: '宿主核心架构契约（3 篇）',
            iconKey: 'fork',
            defaultOpen: false,
            items: [
              { id: 'dh-1', title: '正式交付文件契约', url: '/docs/develop/host/formal-deliveries/', badge: '契约' },
              { id: 'dh-2', title: '资源与工程资产模型', url: '/docs/develop/host/asset-workspace/', badge: '契约' },
              { id: 'dh-3', title: '敷设场景领域契约', url: '/docs/develop/host/installation-scene/', badge: '契约' },
            ],
          },
        ],
      },
    ],
  },
  {
    domain: '第四层 · 附录参考与工程边界',
    branches: [
      {
        code: '06',
        id: 'reference',
        domain: '第四层 · 附录参考与工程边界',
        title: '常见问题、术语与工程边界',
        sidebarTitle: '常见问题与工程边界',
        summary: '排错速查表、国际单位制电热符号定义、历次版本说明及必须遵守的工程签审边界。',
        iconKey: 'shield',
        defaultOpen: false,
        directItems: [
          { id: 'rf-faq', title: '常见问题排查（FAQ）', url: '/docs/reference/faq/', note: '安装启动、缺项拒算、端口冲突与超算状态排查' },
          { id: 'rf-glo', title: '工程术语与符号对照', url: '/docs/reference/glossary/', note: 'SI 物理量符号、热阻分层与平台核心概念定义' },
          { id: 'rl-idx', title: '版本更新说明', url: '/docs/releases/', note: '已交付能力汇总与版本记录' },
          { id: 'rl-lim', title: '当前适用边界与已知限制', url: '/docs/releases/limitations/', note: '不支持的敷设场景、条款覆盖边界与人工复核要求' },
        ],
      },
    ],
  },
];

function leafToItem(leaf: TreeLeafSpec): PageTree.Item {
  return {
    $id: `item-${leaf.id}`,
    type: 'page',
    name: leaf.title,
    url: leaf.url,
  };
}

function subgroupToFolder(sg: TreeSubgroupSpec): PageTree.Folder {
  return {
    $id: `sg-${sg.id}`,
    type: 'folder',
    name: sg.title,
    icon: renderTreeIcon(sg.iconKey, 'size-3.5 shrink-0 text-fd-muted-foreground'),
    collapsible: true,
    defaultOpen: sg.defaultOpen ?? false,
    children: sg.items.map(leafToItem),
  };
}

function branchToFolder(branch: TreeBranchSpec): PageTree.Folder {
  const children: PageTree.Node[] = [];
  if (branch.directItems) {
    children.push(...branch.directItems.map(leafToItem));
  }
  if (branch.subgroups) {
    children.push(...branch.subgroups.map(subgroupToFolder));
  }
  const label: ReactNode = (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-medium">
      <span className="shrink-0 whitespace-nowrap font-pixel text-xs text-brand">{branch.code}</span>
      <span className="truncate">{branch.sidebarTitle ?? branch.title}</span>
    </span>
  );
  return {
    $id: `branch-${branch.id}`,
    type: 'folder',
    name: label,
    icon: renderTreeIcon(branch.iconKey, 'size-4 shrink-0 text-brand'),
    collapsible: true,
    defaultOpen: branch.defaultOpen ?? false,
    children,
  };
}

/** 生成供 Fumadocs <DocsLayout tree={...}> 使用的三级结构化页面树 */
export function buildStructuredPageTree(): PageTree.Root {
  const children: PageTree.Node[] = [
    {
      $id: 'root-overview',
      type: 'page',
      name: '文档总览与体系树',
      url: '/docs/',
      icon: renderTreeIcon('network', 'size-4 shrink-0 text-brand'),
    },
  ];

  for (const group of DOC_TAXONOMY) {
    children.push({
      $id: `sep-${group.domain}`,
      type: 'separator',
      name: group.domain,
    });
    for (const branch of group.branches) {
      children.push(branchToFolder(branch));
    }
  }

  return {
    $id: 'cablesimpro-docs-tree',
    name: 'CableSimPro 文档体系',
    children,
  };
}
