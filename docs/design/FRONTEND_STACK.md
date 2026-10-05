# 前端技术栈与开源组件准入

## 决策与适用范围

目标是具备专业工程软件交互质量的 CableSimPro，不是营销首页或通用后台模板。允许引入和二次开发成熟开源依赖，保留现有工程数据与真实功能，不以已有依赖清单限制选型。

目标主栈：**Next.js + Vercel AI SDK + AI Elements + shadcn/ui**。专业能力分层引入，不要求全部依赖同时安装。本文规定目标架构、组件责任、迁移和验收；不宣称目标栈已运行。可运行事实以 `frontend/package.json`、锁文件、代码、CI 和行为验收为准。

本文只负责技术选型与准入；页面需求仍由 [FRONTEND_REQUIREMENTS.md](./FRONTEND_REQUIREMENTS.md) 维护，视觉素材规则见 [VISUAL_ASSETS.md](./VISUAL_ASSETS.md)，工程写入与研究契约见 [MODULE_DESIGN.md](./MODULE_DESIGN.md)。不另建平行产品需求文档。

## 选型与责任

| 能力 | 目标选型 | 集成决定与边界 |
| --- | --- | --- |
| 应用框架 | Next.js App Router | 迁移目标；允许短期承接现有 SPA，再逐组迁移路由。完成后移除被替代入口，不长期维护两套路由和产品。 |
| 通用交互与设计系统 | shadcn/ui、Radix | 应用外壳、对话框、菜单、页签和基础控件的统一入口；引入源码后映射工程设计令牌。 |
| 工程助手 | Vercel AI SDK、AI Elements | 流式消息、工具事件、来源、确认交互。UI 状态不授予工程写入或批准权限。 |
| 型号库、资料列表、批量管理 | Ant Design ProComponents | 按需选用 ProTable、ProForm 等能力；通过领域包装组件及统一主题接入，不另建 ProLayout 外壳。 |
| 复杂工程参数 | Formily | 优先验证嵌套结构、数组字段、条件显示、来源与单位的适配；React 兼容和草稿保存行为通过后替换相应旧表单。一个表单只有一个状态所有者。 |
| 曲线与扫描看板 | Apache ECharts | 载流量曲线、暂态历史、多方法对比、区间展示；按需加载，只消费保存的运行输出。 |
| 工艺与研究流程 | React Flow | 可视化节点、连线、选择和布局。工程任务准入、执行、重试与 Slurm 调度仍由宿主负责。 |
| PDF 证据与规格书阅读 | react-pdf（wojtekmaj） | 基于 PDF.js 的阅读与页级呈现；双文档对照、同步滚动、坐标高亮由领域组件补齐，不声称库自带语义差异引擎。 |
| 标准资料检索 | RAGFlow | 候选检索基础设施，独立部署并经宿主适配；不是浏览器组件，也不替代现有资料原件、候选核对、提案和审批链。 |
| 多文档工作台 | Dockview 开源核心 | 优先验证模型、曲线、PDF 与属性视图的分屏和布局持久化；布局状态与工程状态隔离。商业扩展不自动采购或引入。 |

补充候选：TanStack Table + TanStack Virtual 用于需要完全定制视图的高密度结果表；AG Grid Community 用于需要现成网格能力的场景。每类表格先选一个实现，不同时安装三套覆盖相同用途。AG Grid Enterprise 的高级能力需要独立许可决策，不能将免费试用视为生产授权。vtk.js 作为真实网格、标量场和科学可视化的候选；ECharts 不承担有限元网格语义或 CAD 求解。

这些是工程选型，不是对整个组件组合的兼容性认证；安装时逐个核对精确版本、peerDependencies、当前安全公告与构建结果。第三方图标允许经统一图标入口引入并保留许可，不能出现多个语义冲突的图标入口。

## 目标系统边界

```text
Next.js 工作台
  ├─ 统一设计系统、文档布局、表格、表单
  ├─ 工程图表、流程图、PDF 证据、可选科学可视化
  └─ AI Elements 工程助手
           │
同源 API / 可选 Next.js BFF（仅传输、会话与 AI 接入适配）
           │
FastAPI 工程宿主（工程与研究版本、预检、提案、审批、运行与交付）
  ├─ 版本化计算插件 / Slurm
  └─ 资料服务 → 可选 RAGFlow 检索适配器
```

采用 Next.js 不意味着必须部署到 Vercel；采用 AI SDK 不意味着必须使用 Vercel AI Gateway。优先验证本机或内网自托管，模型提供方显式配置，不因错误静默外发到其他提供方。没有授权不发布预览、上传私有资料或启动收费服务。

若使用 Next.js 服务端 AI SDK 或 Route Handlers，部署必须包含相应 Node 服务；静态导出模式不能被当作仍具有这些服务端能力。静态客户端连接 FastAPI 流协议是另一条需明确验证的部署方式，不同时承诺两种未验证的安装包。

FastAPI 保留唯一工程写入与批准边界。Next.js Server Actions / Route Handlers 不直接写 SQLite，不复制求解公式，不伪造人工身份。历史结果继续绑定准确 workspace / study / run / delivery / method 版本及摘要；当前状态和审批状态不能被前端缓存混淆。

## 二次开发落点

**EngineeringChart。** 封装 ECharts 的数据适配、单位、精度、主题、缩放、提示和无障碍替代数据表。断点、失败样本、无效值不能被零值补齐或插值隐藏；后端未提供的置信区间、温限判据和计算结论不得由图表推断。图表抽样必须显式标注，原始数据另可读取，不能据抽样结果判定是否越限。

**EvidencePdfViewer。** 封装 react-pdf 的页码、缩放、文字层和证据框，坐标仍以宿主原件的 CropBox / 旋转规则为准。worker、字符映射和字体资源按已审查版本本地打包，不运行时取 CDN。PDF 阅读不替换后端已经封存的规格书生成和下载链。

**ParameterForm。** 由受信任插件或宿主发布参数契约，Formily 负责渲染。模型可以建议字段值和声明式布局提案，但不能生成并执行任意 JavaScript、事件处理器或表达式。采用字段白名单、严格类型/单位验证、差异预览、显式采用和宿主审批；锁定参数、来源、撤销重做与保存冲突继续生效。

**StudyWorkflow。** React Flow 的节点映射到真实方法发行、研究配置与运行身份；拖动布局不修改工程参数，不启动任务。尚未有后端工作流契约的能力明确只读或不可用，不把可连接节点宣称成可执行流程。

**AssistantPanel。** 使用 AI Elements 的消息、来源、工具与 reasoning 展示组件；只显示提供方实际返回且允许公开的摘要和执行事件，不虚构思考内容。批准类工具必须显式展示变更、范围与基准版本，最终由宿主验证。断流重连不得自动重放非幂等写入或重复计费调用；密钥、系统配置与敏感原文不能进入浏览器消息流。

**KnowledgeEvidence。** RAG 检索结果携带文档身份、版本、摘要、页码及可用的片段坐标，通过适配映射到已保存原件。相关性不是标准适用性，引用存在也不是结论正确性的证明。只索引有权使用的资料，权限和外发确认在服务端执行；RAG 服务缺失不得阻塞已有本地工程功能。

## 迁移与交付顺序

1. **基线与框架。** 先建立现有前端完整构建和关键业务测试基线，再将 Next.js 作为构建/路由迁移目标。审计 `import.meta.glob`、`import.meta.env`、Vite 虚拟 CSS、本地资源、OpenAPI 生成与现有测试启动器。可以暂时承接客户端 SPA，但只能有一个运行中的工程状态源；路由迁移后清理过渡实现。
2. **工作台与资料。** 验证统一设计系统和多面板布局；把型号结构、厂家 PDF 与候选核对做成能保存、能撤销、能追溯的真实操作链，不仅是首页卡片。
3. **研究结果与参数。** 接入 ECharts、专业表格和 Formily 适配，保留当前、历史、未验证、失败和缺项身份；真实数据接口不可用时显示缺项，不引用展示样稿。
4. **助手与流程。** 在明确的消息/工具事件契约上接入 AI SDK、AI Elements 和 React Flow；检索先通过可替换接口接入，不另建一套工程任务调度器。
5. **集成门禁。** 验证实际生产构建、Windows/目标浏览器、离线资源、键盘/焦点、125%/200% 缩放、长表格与长文档、异常恢复、历史身份及交付摘要。通过后才形成候选合并；不自动合并 main。

多代理实现按边界拆分：框架与部署、设计系统/参数表单、图表/PDF/流程、助手/检索适配、独立测试审查。共享的包清单和锁文件由一个集成人维护，避免并行覆盖。一次只让一个任务拥有同一组件文件的写入权；独立样稿不算正式集成证据，不向外部设计服务发送私有源码或工程数据。

## 依赖、设计和验收约束

应用自有控件统一设计令牌，ProComponents 的主题经 ConfigProvider 等官方接口映射，第三方库原生浮层和尺寸通过适配统一。不以删除样式检查来迁就依赖；库必要的动态尺寸与定位若触发现有门禁，先为隔离适配层补充狭窄规则和反例测试，禁止全局豁免。

图表、PDF、流程图与三维视图按路由/面板动态加载。先测量依赖加入前后的构建产物、冷启动、长任务、交互延迟及内存，再设回归预算；不将库的宣传性能视为本项目性能。大表虚拟化不能替代服务端分页，缺少相关 API 时要列为明确依赖。

必须同步 package 清单和锁文件，保存源码引入的上游版本/提交、修改说明和许可证；区分核心开源包与收费扩展、模型权重及字体的许可证。安装或二开通过不等于功能通过。测试必须覆盖真实业务行为；样稿截图、静态 HTML 布局测试或安装成功不能替代 React 应用端到端验证。

生图可用于品牌、欢迎页和明确标记的概念素材；工程结构、场图、曲线与证据高亮必须来自准确模型或保存结果。概念素材不进入客户工程结论，不用生成截图证明已完成软件实现。

## 官方选型依据

以下为核对入口；实施时仍需对所安装发行及其许可证再次核对，不从 README 默认分支推断稳定发行兼容性。

- [Next.js Vite 迁移](https://nextjs.org/docs/app/guides/migrating/from-vite)；[自托管](https://nextjs.org/docs/app/guides/self-hosting)
- [Vercel AI SDK](https://github.com/vercel/ai)；[UI 流协议与自定义后端](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [AI Elements 安装](https://elements.ai-sdk.dev/docs/setup)；[Reasoning](https://elements.ai-sdk.dev/components/reasoning)；[Sources](https://elements.ai-sdk.dev/components/sources)
- [shadcn/ui](https://ui.shadcn.com/)；[ProComponents](https://github.com/ant-design/pro-components)
- [Formily](https://github.com/alibaba/formily)
- [Apache ECharts](https://github.com/apache/echarts)
- [React Flow](https://reactflow.dev/)
- [react-pdf 与 PDF.js worker](https://github.com/wojtekmaj/react-pdf)
- [RAGFlow 架构与部署](https://github.com/infiniflow/ragflow)
- [Dockview 核心与商业扩展范围](https://dockview.dev/docs/overview/licence/)
- [TanStack Table / Virtual 职责](https://tanstack.com/table/latest/docs/framework/react/guide/virtualization)
- [AG Grid Community 与 Enterprise](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/)
- [vtk.js](https://github.com/Kitware/vtk-js)
