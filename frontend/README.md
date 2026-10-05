# 正式前端工程规范

当前阶段：首页、型号、研究、资源库、插件、设置、复现库均注册在公共路由。研究接入问询、载流量、温度场、原生任务、参数扫描、批量配置/数据集、已保存运行对比与计算书；仿真复现保留契约能力不足时的明确缺项。固定运行用 `run`，计算书用 `delivery`，数据集用 `dataset`，复现证据版本用 `snapshot`。型号模块由 `features/type` 维护，共用独立契约字段组件。电缆、敷设和三维画布同时陈列于 `/gallery`。当前迁移状态与责任统一见 [前端需求 §11.9](../docs/design/FRONTEND_REQUIREMENTS.md#119-正式页面迁移现状)。

## 开发与验收

```sh
cd frontend
npm ci
npm run dev                     # 127.0.0.1:5173
npm run prepare:backend         # 从指定真实数据库只读备份到独立验收库
npm run generate:api            # 从正式服务 /openapi.json 生成类型和端点目录
npm run build                   # 样式门禁、严格类型检查、构建
npm test                        # 样式门禁反例、数值与单位格式化
npm run test:browser             # 临时数据库与服务自动启动/清理
npm run test:migration           # 真实列表、选型、新建、保存、路由、离开提醒
npm run test:migration-states    # 五态、真实计算书/下载与 8027 并排截图
npm run test:research            # 输入保存/撤销、IEC运行、原生结果视图、五态/键盘/主题/尺寸
npm run test:research-preflight  # 读取三项原生任务真实预检响应，验证错误时禁止运行
npm run test:research-navigation # 取样键盘、后退/刷新、热点缩放与属性不溢出
npm run test:research-presentation # 复合SI单位、非零微小结果、两种尺寸与浅深色
npm run test:research-refinement # 工程单位/结论/场图、画布、问询10次操作与下载、五态
npm run test:research-finishing  # 实际缺项跳转、模板与编辑器Ctrl+S、分层场图/输入宽度
npm run test:expansion           # 公共导航、复现五页签、扫描保存/真实IEC运行/CSV、场图
npm run test:expansion-states    # 状态断言、资源导入、偏好保存、批量配置、真实运行对比
npm run test:catalog-controls    # 复现历史选择、批量根/模块基准、固定运行缺项
npm run seed:demo                # 独立中文工程演示库，已有完整库不会重复计算
npm run test:names               # 全局显示名、扫描结论/刻度、来源分组、PDF下载；隔离数据库
npm run capture:handoff          # 只读样板，不运行计算、不修改输入
npm run capture:references       # 官方页面与仓库样张的参考截图
npm run capture:comparison       # kimi-vercel 并排对比与缩放模拟
npm run capture:research-comparison # 八个研究模块：已验收截图与 8027 实际现场
```

浏览器使用隔离的 Edge/Chrome `--headless=new`，Playwright 仅通过 CDP 驱动。所有业务验收由 `isolated-e2e.mjs` 复制开发库到 `.tmp/frontend-e2e/<随机身份>/`，自动启动随机端口的后端与预览，结束时停止服务、删除临时数据库和目录。`E2E_DATABASE_SOURCE` 可指定只读备份来源，禁止把业务验收直接指向开发服务。截图在 `.data/frontend-handoff/`；浏览器配置在 `.tmp/frontend/`，退出时关闭全部任务标签页、核对数量并删除配置目录。只读截图脚本仍可用 `FRONTEND_URL`/`WORKBENCH_URL` 指定已有服务。

## 代码职责

| 位置 | 职责与边界 |
| --- | --- |
| `src/components/ui/` | shadcn/ui + Radix 基础控件，仅维护一份；按令牌改造，保留语义、焦点管理和键盘行为 |
| `src/components/` | 跨模块通用组合与本地图标入口；业务判断不进入控件 |
| `src/previews/` | 唯一布局演示数据；正式业务页面不引用该 fixture |
| `src/pages/` | 业务页面与组件陈列页，组合公共组件，不含工程公式 |
| `src/api/generated/` | 正式 OpenAPI 自动生成的请求类型与端点目录 |
| `src/api/` | openapi-fetch 客户端、响应结构校验和业务读取适配 |
| `src/styles/` | 令牌映射与公共样式；Vite 虚拟 CSS 直接读取 `design/tokens.css`，不复制色值 |
| `src/router.tsx` | 声明式 TanStack Router；页签进入 URL；后退可用 |
| `src/lib/` | 纯工具，不计算工程结果 |
| `scripts/` | 样式门禁、CDP 截图与交互验证；由 package scripts 引用 |

文件用 kebab-case，组件用 PascalCase，函数用 camelCase；一个模块只替换主区与属性，不新建外壳。页面组合公共组件，不复制控件、补丁擦改 DOM 或按中文标题查找图标。

## 实现约束

- **主题**：唯一值来源为 `design/tokens.css`。Tailwind 使用 `bg-panel`、`text-ui-body`、`rounded-ui-input` 等角色类；CSS 引用 `var(--…)`。尺寸、间距由空间令牌派生；边框线宽和几何布局不冒充视觉令牌。浅深色同步完成。界面本地 Noto Sans SC 400/600，数值 `tabular-nums`，原始记录才使用 IBM Plex Mono。图标只从 `design/icons/<group>/<name>.svg` 引入，不安装另一套通用图标替换领域图标。
- **状态归属**：服务器数据交给 TanStack Query；名称、方法配置、领域输入及未确认文本草稿保存在父路由 Provider，冻结首次编辑修订，换模块不丢失。离开研究和刷新均提醒；Ctrl+S 保存，失败保留草稿。画布手势与已确认领域编辑共用本地撤销/重做；没有草稿时调用正式工程历史。Ctrl+Shift+Z / Ctrl+Y 重做；输入框使用浏览器文本撤销。研究配置不借用工程历史。
- **接口与错误**：从正式宿主 OpenAPI 生成客户端与类型；未声明响应模型的接口使用 unknown 与运行时校验，不手写假 DTO。六条输入/预览/交付接口只用正式地址。缺端点在请求前拒绝；字段缺项保留表单，冲突拒绝覆盖，写入不自动重试。问询可引用原始厂家候选，经匹配发行的 model-completion 补齐值、来源、出处后保存；参考值只在显式采用时填入，来源保持未审核。方法参考参数只采用后端目录提供的值。运行数值、原因与型号均来自固定快照；历史结果只读，不能交付。
- **可访问性与动效**：正文最低 13 px，状态带文字；每个图标按钮有名称；原生表格、表头、标签和 Radix 页签/对话框语义保留。Enter 选择/确认、Esc 关闭、方向键切页签，对话框关闭恢复触发焦点。动效按 `design/motion/` 用 Motion/CSS，减少动态设置立即切换，不做页面转场或装饰加载动画。
- **验收**：空、加载、错误、成功、历史结果使用自动断言；1366×768、1920×1080、浅深色检查布局、对比度、字体和内部滚动。每个改动页面仅保存 1–2 张截图，以 1366 浅色为主；全套截图矩阵仅按明确要求生成。关键流程执行浏览器动作，截图不代替行为验证。只改前端时执行构建、样式门禁与相关浏览器场景；改后端或插件时才跑全量 pytest，开跑前确认没有其他线程运行。

## 禁止事项

禁止页面中的字面颜色、字号、圆角、内联 `style`；禁止使用 Tailwind 默认色阶/字号/圆角与非令牌任意值。`npm run check:styles` 检查整个 `src/`，`build` 必须先通过。禁止移植样板标记/样式、嵌套卡片、伪结果、宿主公式、前端阈值判定、从演示数据补缺项。禁止远程字体/图片/脚本、提交 `node_modules` / `dist` / 截图、改后端与插件或自行提交 Git。

基础控件依据 [shadcn/ui](https://ui.shadcn.com/docs/components/button) 的开放源码组合方式改造；shadcn/ui、Radix、Motion 为 MIT，Noto Sans SC 与 IBM Plex Mono 为 SIL OFL，字体和库由锁定 npm 依赖本地分发。正式安装包需保留对应许可。

## 公共组件与动效

基础控件为 Button / IconButton、NumberField、Select、Dialog、Tooltip、Tabs；组合为 SourceBadge、StatusMark、Toolbar、DataTable、Conclusion、PropertyPanel、CheckArea、EmptyState / LoadingState / ErrorState / StaleBanner、AppShell。每个组件只有一份实现，样式集中在 `src/styles/theme.css`，读取共享令牌。表格行高 40 / 44、6 px 判定圆点；选中行使用 fill 与左侧 2 px 文字色细条；分组/表头使用 fill。属性行高 32，分组间距 16；页签 2 px 下划线距文字 6。限制原因直接显示，满足显示“—”；演示只在页头标一次，来源显示真实类别。规则统一见需求 §5。

`src/components/motion.tsx` 是唯一 Motion 入口，仅三类基础封装：`MotionValue`（结果到达 420 ms 三次缓出、历史采用随主题即时更新的次要文字色）；`MotionReveal`（抽屉/对话框、底部校核 200 ms，关闭用退出曲线）；`MotionGlyph`（运行虚线环 1200 ms 匀速、画布选择框 120 ms 收紧）。120/200/320/1200 与位移从共享令牌读取；420 定义在主题动效令牌中，对应 `design/motion/result-arrive.md`。结果插值仅接收同物理量的两个已有值；静态选型不从零计数，不用动画产生或判断工程结果。减少动态时立即采用终值/显隐/静态环。

定稿覆盖两条旧动效表现：表格选择即刻变为整行灰底，收紧框仅保留给画布；历史结果使用次要文字，保留正常对比度，不使用旧素材的铜色及 60% 透明度。运行状态环为中性色，铜色仅用于主运行动作。其他动效素材按后续需要接入，不为未迁移能力新增动效组件。

`formatNumber` 处理缺项、精度、负号和五位以上空格分组；`engineeringQuantity` / `engineeringInputPrecision` 统一展示换算与精度：电阻 Ω/km、电容 μF/km、电感 mH/km；损耗与热阻三位有效数字、绝对温度 0.1 °C；无量纲单位为“—”，温差保留 K。EngineeringValue 与数值输入提示完整精度，存储保持 SI 与原始数值。方法参数优先采用契约单位，复合 SI 单位不截断。NumberField 编辑文本不分组，Enter 或失焦确认，Esc 恢复；未改输入不因显示舍入改写原值。

组件验收使用 `scripts/verify-components.mjs`，仅陈列/静态页面必须无 API 请求。业务验收使用 `verify-migration.mjs`、`verify-migration-states.mjs`、`verify-research.mjs`。当前 IEC 结果在临时库显式选择安装发行并实际运行，原生历史证据原样复制；空、延迟、网络错误仅在浏览器拦截层注入，不编造数值。截图与机器结果位于 `.data/frontend-handoff/components/`、`migration/`、`research/`；8027 并排截图保留服务实际失败。研究概念图采用 `concepts/conditions-input.png` 的分组表单组织，另存 `thermal-result.png` 供方向比较，场图按真实网格实现。

计算书通过正式 `/deliveries/current` 生成，`/deliveries/:did/file` 下载。要求单个源运行，身份与输入/输出摘要完全一致；生成和导出前重新核对 current/verified，历史和未保存输入拒绝交付，文件响应摘要须匹配交付摘要。现无交付列表接口，既存计算书可通过 `delivery` 深链接打开。

公共运行记录抽屉为 RunRecordsDrawer，预检对话框为 PreflightDialog；缺项按领域路径跳到敷设、工况、电缆或方法参数。研究模块共用 StudyRunControl 冻结预检身份。新建的“保存并预检”和结果页的“生成客户计算书”仅传递一次性的明确操作意图，确认范围与运行仍需用户点击。问询补录、结论/分组、场图全景和紧凑表单的概念图与截图在 `.data/frontend-handoff/concepts/`、`refinement/`；操作计数与耗时写入 `inquiry-flow.json`。

CAD 验收使用已锁定的本地 OCCT 资产；可执行 `node src/features/cad/prepare-runtime.mjs` 核验摘要并准备缓存。refinement 验收的 CAD 作业与常驻进程目录也位于独立 scratch 内，收尾关闭本任务预览进程后再删目录。当前三芯场景未被 CAD 插件支持；地下单芯示例可能因缺单丝参数或原生土壤实体失败，真实错误保留，不补造场景几何。空气单芯包络场景单独验证，不作为地下场景成功证据。

原生任务创建前须提供匹配契约的完整 SI 参数，复杂映射提供 JSON 编辑与契约查看；缺必填项时不分配工程。参数形状由正式宿主再次校验，物理适用性由预检确认。原生预检沿用真实宿主策略；配置超算时 `check` 也会进入 Slurm，不能把“没有求解 run 请求”写成“没有超算作业”。检查作业的计费与封存记录保留用于追溯。

ContractFields 不依赖研究 Provider；MethodParameterFields 根据精确发行读取契约，研究和型号各自持有草稿与修订。扫描与批量未确认文本保留在研究父路由，保存失败不会丢失；批量配置独立保存并只提供 Slurm，预检后再次人工确认核时预算。SeriesChart 仅连接已经保存的点，缺失和失败样本留空。QueryState 在断网时保留读取缓存并标为历史，资源导入只创建未审核草稿。研究配置的已保存撤销/重做和交付列表仍等待正式宿主契约。

显示名称统一经过 `src/lib/display-names.ts`，结果量、方法、参数、对象和单位与存储身份分开；未知键保持可检测，不用空白或通用名称掩盖。表格、下拉、属性、来源和错误状态共用该表。`visible-names.mjs` 检查各页面及文档 iframe 的实际可见文字，并接入公共布局断言；合法标准编号、型号额定电压和工程单位精确豁免。SeriesChart 使用整齐刻度，同轴精度一致；扫描结论只描述已保存点的端点变化，缺失点不计算趋势，转折不宣称单调变化。

`seed-engineering-demo.py` 仅创建 `.data/engineering-demo/engineering.sqlite`：复用有来源的厂家候选和显式工程补参数，经正式接口创建两个型号草稿和五项中文研究。选型、扫描及 IEC 外部热阻公式对照重新执行标准代数；不复制测试运行、批准资料或补造原生结果。110 kV 型号仅录入已知厂家尺寸，缺失结构/物性与标准 R20 上限保持缺项；温度场等待完整方法输入和超算运行。旧开发库保留，`test:names` 从演示库只读备份到临时库后才写入历史测试。

规格书 PDF 使用生成的 `/api/types/{wid}/specification/file` 客户端，核对修订、规格书摘要、PDF MIME 和文件摘要。厂家 PDF 资料导入工作流尚未迁移；资源库的 JSON 资产导入不等于 PDF 提取。最新生成类型已包含 hybrid/offline_ocr、OCR 外发地址/模型/内容类型、候选证据及表头坐标和 kg/100m；页面迁移要求见[厂家资料导入契约](../docs/architecture/datasheet-import.md)。
