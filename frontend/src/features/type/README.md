# 型号工作区接线

本目录引用公共 AppShell、Radix 控件、TanStack Query、正式 OpenAPI 客户端和 cad / drawing 组件。`createTypeRoutes` 已接入公共路由与型号入口。

## 接入公共前端

公共路由负责人从本目录 `index.ts` 引入 `createTypeRoutes`，在现有 `rootRoute.addChildren(...)` 中加入 `...createTypeRoutes(rootRoute)`。公共“型号”入口指向 `/types`。父路由保留结构、工况与方法条件、未完成输入文本和首次编辑修订；不可把 TypeProvider 移入会随模块卸载的子页面。

地址为 `/types`、`/types/:wid/:module/:tab`。`theme`、`revision`、`run`、`layer` 进入 URL；历史修订和固定运行保持只读。`preview.tsx` 和 `preview.config.ts` 只供目录内隔离验收，不能作为第二个生产入口注册。

## 功能范围

- 型号目录 / 新建：每个设计工作区只列一行；已发布的多个版本仍引用同一设计对象。目录支持名称、发布状态筛选、状态分组与选中名片；型号名按钮 / Enter 打开工作台。资源版本的唯一管理入口为 `/resources/cables`。
- 结构设计：圆形 / 扇形多芯截面、原生剥切、中文层名与跨视图选择；新增层与线芯保留未提交输入并拒绝重叠，复制芯清除实测值。分层表、材料与构造、插件外径 / 用料均支持保存与撤销。
- 标准核对：真实精确发行运行、逐项判定、条款与输入来源、结构定位、要求批准记录和明确人工门禁。
- 要求与标准：要求清单、执行标准、待批准导入三个页签，复用保存的标准工件和独立批准账本；来源版本、条款、定义冲突与结构定位进入属性栏。历史来源不能批准；输入缺失和未覆盖不改成不适用。
- 电气参数 / 短路容量：正式 `cablesim.type-electrical` 0.3.0 参数契约、公共 MethodParameterFields 编辑、首次修订保存、错误保留、跨模块文本与方法草稿撤销。结果保留原始精度、性质、公式、条款和固定快照；短路曲线只读取插件保存点。R₂₀ 分别保留设计输入、实测和厂家上限；第 2 类导体显示 GB/T 3956-2008 表 2 的标准限值参照，不把标准上限当作实测值。
- 载流量表：单芯 / 三芯工况编译、方法参数、工况选择、保存冲突和固定快照。多回路明确区分全回路等负荷与逐回路允许电流；等负荷结果须包含所有回路，不用单回路结果替代。历史条件保留原计算口径。填写 ks、kp 或涡流分支时须保存系数来源。
- 方案对比：正式型号族、最多四个方案、保存指标矩阵、参数差异、只读截面对照、逐项运行来源、独立方案分支。演示场景分别真实运行结构 / 用料和标准核对，并对铜量做独立手算；设计假设保留演示来源。属性不展示空条件或原始 JSON。
- 规格书：默认客户版；“生成规格书”按当前修订预检并运行缺少结果的已保存模块，复用当前结果，失败停在对应模块并保留已完成运行。客户稿只列声明值和通过的条款，内部审核稿保留偏离、缺项、不适用折叠清单和来源摘要；缺项及未覆盖仍阻止发布。HTML 与 PDF 共用中文章节内容，PDF 嵌入中文字体、逐行分页并重复表头。文档版本、变更摘要、编制人与日期在提交评审时记录；普通保存不新增文档修订。编制单位和签字保留人工填写。

## 验收

在 `frontend` 下执行：

```sh
npx tsc -b
npm run check:styles
node node_modules/vite/bin/vite.js build --config src/features/type/preview.config.ts --logLevel error
node src/features/type/tests/verify-list.mjs
node src/features/type/tests/verify-structure.mjs
node src/features/type/tests/verify-standard.mjs
node src/features/type/tests/verify-analysis.mjs
node src/features/type/tests/verify-rating.mjs
node src/features/type/tests/verify-versions.mjs
node src/features/type/tests/verify-specification.mjs
node node_modules/vite/bin/vite.js build --outDir ../.data/frontend-type/main-build --logLevel error
node src/features/type/tests/verify-multicore.mjs
node src/features/type/tests/verify-section-delivery.mjs
node src/features/type/tests/verify-integration.mjs
node --test src/features/type/tests/organization.test.mjs
node src/features/type/tests/verify-organization.mjs
node src/features/type/tests/verify-organization-save.mjs
```

所有业务脚本通过 `tests/fixture.mjs` 只读备份真实数据库到随机临时路径、启动独立服务和浏览器，结束核对零标签页、停止服务并删除临时数据库。当前轮次的五态、两尺寸和两主题采用自动断言，检查越界、控件重叠、13 px 字号和文字对比度；每个改动页面只留 1–2 张截图。验收只执行明确授权的 IEC 标准代数、轻量标准核对和 CAD；有限元、批量仿真、收敛研究及性能基准仍走超算。列表源无已发布型号，列表历史态没有伪造批准数据。产物在 `.data/frontend-type/`，不入库。

`verify-organization.mjs` 使用当前正式构建和指向 8100 的 GET-only 代理，一个页面串行检查目录及工作台：两尺寸、两主题、空 / 加载 / 错误 / 成功 / 真实保存修订的历史状态、名片、行式编辑、标签避让及内部标识。空 / 加载 / 错误是浏览器故障注入；成功与历史来自保存输入。不写演示数据库、不运行插件。截图与断言结果在 `.data/type-organization/`；目录没有历史模式，历史状态在工作台检查。单元测试对拍 V→kV、m²→mm² 和逐层外径手算，并拒绝以完整性失败或失败工况作为当前结果。

`verify-organization-save.mjs` 复用隔离数据库和当前正式构建，在一个页面验证新建型号、Ctrl+S、顶栏保存及重复提交保护；经 API 对拍保存名称、修订和请求数量，不调用计算方法。两个浏览器脚本串行执行。

## 对象名片与状态

名片复用 `DesignCard` 与 `designSummary`，基准版本来自 `type_origin_reference`，修订时间来自 `updated_at`，外径与层数取同一参数截面几何；绘图外径标为推导，不代替保存的原生实体外径。发布状态读取 `type_lifecycle`（草稿 / 审核中 / 已发布），编辑状态只在顶栏显示一次。

浏览器的 `StatusMark` 读取完整性通过的保存工件、当前性和输入修订；方法目录说明未接入 / 未运行。对照与规格书分别复用现有只读接口。标记悬停显示原因；摘要、运行身份、插件身份及内部修订只进入悬停信息。

目录的执行标准仅显示工作区显式 `declared_standards`（字符串或带 `name` 的对象数组）；现有输入若未返回声明，则显示“未声明”。材料来源里的标准条款只作来源，不推断成型号执行标准。需宿主明确提供执行声明后才能补全该列；资源关联只链接其统一目录，不建立第二份资源对象。

`verify-specification.mjs` 从独立“规格书演示”型号一键生成五项真实运行和双版本 PDF，调用 `tests/check-pdf.py` 检查中文字体、工程单位、空表、版本隔离及客户稿无未计算 / 内部说明 / 哈希，并检查两页五态、两尺寸、两主题与文档修订。演示参数明示保存，未伪造工厂实测数据；未实现的完整阻抗、故障分流和标准规则仍阻止发布。版式参考受控样本 Nexans XKDT 第 1–2 页、Prysmian N2XS2Y 第 1 页、正泰电缆手册第 21 页；仅参考信息组织，不复制品牌、认证或产品数值。

`verify-multicore.mjs` 使用生产路由检查三芯圆形 / 扇形、层与芯编辑、地下敷设场景以及 YJV22 客户稿的五项真实运行。客户稿载流量取整至 1 A、短路电流保留 1 位小数，条件来源在表下注明；相同芯的行仅在未舍入值、条件和依据均一致时合并。

## 待协调

1. 公共路由与导航已注册；正式构建脚本仍由前端线程管理。目录内 preview 只作隔离验收。
2. 公共参数字段复用 MethodParameterFields；规格书与结构扩展契约已纳入生成客户端，操作引用仍核验当前服务响应。
3. 宿主尚无已保存方法配置的撤销接口；方法与工况页 Ctrl+Z 只撤销未保存条件，已保存时明确提示，不能误撤销型号结构。
4. 新建空白型号、文件导入、规格书固定修订读取等未提供的能力保持明确缺项。完整阻抗和未覆盖标准分支仍受宿主发布校核约束，前端不能通过省略问题解除门禁。
5. CI 的既有前端任务只执行 `npm test`；请 CI 负责人加入 `node --test src/features/type/tests/organization.test.mjs`。两个浏览器命令见上文，分别依赖 8100 只读来源与隔离数据库；本轮未跨边界修改 CI 或宿主执行标准声明接口。
