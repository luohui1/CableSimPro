# 型号工作区接线

本目录引用公共 AppShell、Radix 控件、TanStack Query、正式 OpenAPI 客户端和 cad / drawing 组件。`createTypeRoutes` 已接入公共路由与型号入口。

## 接入公共前端

公共路由负责人从本目录 `index.ts` 引入 `createTypeRoutes`，在现有 `rootRoute.addChildren(...)` 中加入 `...createTypeRoutes(rootRoute)`。公共“型号”入口指向 `/types`。父路由保留结构、工况与方法条件、未完成输入文本和首次编辑修订；不可把 TypeProvider 移入会随模块卸载的子页面。

地址为 `/types`、`/types/:wid/:module/:tab`。`/types?create=1` 自动打开统一新建对话框，供公共侧栏“新建 → 新建型号”引用；`theme`、`revision`、`run`、`layer`、`field` 进入 URL；`field` 为领域字段指针，定位后展开对应属性组并聚焦数值框。历史修订和固定运行保持只读。`preview.tsx` 和 `preview.config.ts` 只供目录内隔离验收，不能作为第二个生产入口注册。

## 功能范围

- 型号目录 / 新建：每个设计工作区只列一行；已发布的多个版本仍引用同一设计对象。目录支持名称、发布状态筛选、状态分组与选中名片；型号名按钮 / Enter 打开工作台。资源版本的唯一管理入口为 `/resources/cables`。
- 结构设计：圆形 / 扇形多芯截面、原生剥切、中文层名与跨视图选择；新增层与线芯保留未提交输入并拒绝重叠，复制芯清除实测值。分层表、材料与构造、插件外径 / 用料均支持保存与撤销。
- 材料核对：结构设计的“材料核对”页签比较保存物性与绑定固定资源的参考记录。每项保留一致、不同、资源缺项、型号未给此项或条件不符；打开出处查看双方来源与参考条件。相同物性与 SI 单位且用途、电压、配方身份已核对时才计算差值与相对参考值百分比。“一致”指保存数值相等，不代表工程公差合格。参考物性读取来源中的 `cablesim.reference-data/1`，不借用资源参数的量纲。
- 标准核对：真实精确发行运行、逐项判定、条款与输入来源、结构定位、要求批准记录和明确人工门禁。
- 标准依据：`POST /api/design/type-workspaces/{wid}/requirements/basis` 接收 `request_id` 与 `expected_revision`，经 Executor 按已声明的标准版本和当前型号条件查询。返回 `parameters.basis_references`（逐行 `cablesim.standard-basis-ref/1` 快照）与 `basis_cable_sha256`，原样传给标准核对方法；同一请求可重试，输入变化返回版本冲突。引用保留逐格记录、原值、单位、行条件、正文 / PDF 页码、数据与发行摘要；依据已核验不等于人工批准。未收录或附录修约缺项保留未覆盖，不能静默改用其他版本。
  标准核对内的记录摘要白名单用 `python plugins/cablesim.standard-check/src/cablesim_standard_check/basis_catalog.py` 核验；审核依据插件新发行后加 `--write` 重建并重新封签标准核对。不包含标准全文或可篡改的阈值副本。
- 外径与用料：实体工件的建模长度、分层材料体积与单位长度用料；缺密度、绞入系数或绕包输入时保持缺项，选行定位具体输入。标准核对及实体推导均支持保存运行选择；保存成功后刷新规格书、方案对照与统一关联。内部审核稿读取同一保存工件生成核对表和用料表，缺项阻止正式发布。

材料参数可编辑设计材料名称；“填写密度与出处”把数值和来源一起写入草稿；Ctrl+S保存成新修订，旧运行保持历史。材料事实变化后，须人工重新核对固定资源版本绑定。标准参考、厂家、实测、教学、工程输入单独标明，资源草稿不会被此操作审核或发布。文献作为教学采用时选“教学值”，注明作者、版本、表/页、配方与温度条件的限制；不能把基体密度直接当成未知交联配方成品密度。

结构插件1.1.1在同一 `cablesim.cad-model/1` 保存工件中追加可选的 `density_kg_m3`、`density_source`、`material_volume_m3_per_km`、`mass_formula`；`material_usage`按设计材料身份汇总，不按相同名称合并。缺一层质量时成品总质量保持缺项，已知材料用量仍逐项显示。质量按 `材料体积 / 建模长度 × 1000 × 密度` 折算，精确值与来源快照保存在工件，界面和规格书共用它；旧工件不补编密度。

分层表选择一行的材料复选框，会同时选中引用该设计材料的所有层；未选择时批量操作列出全部设计材料。分层表和外径与用料页共用“批量绑定材料版本”“批量填写密度与出处”。密度写入未保存草稿，由统一保存建立新修订；数值与逐项出处一起保留，资源草稿不自动获批。出处输入显示可读的引用文字，结构化来源放在折叠追溯层；编辑引用文字保留数值、单位及资源版本等来源元数据；追溯中的“改用新出处”由工程师显式清除旧记录，再填写新引用与来源类别。“同上一项”是工程师明确复制版本选择，仍需逐项查看差异。

`POST /api/types/{wid}/resources/material-preview`：`expected_revision`、`items: [{target_id, resource_id}]`，只读返回 `revision`、`digest` 和每种设计材料的引用层数、旧/新资源、事实及出处差异。`POST .../material-confirm` 增加 `request_id`、`preview_digest`、`reviewed_targets`（完整目标集合）、`human_confirmed: true`。服务端重新计算预览，校验修订、摘要、完整目标集合和资源发布状态；全部写入一个修订，失败不部分保存，同一请求返回原回执。历史事实从上次绑定摘要匹配的保存修订读取，不能读到时拒绝批量确认。前端必须显示每项差异并让其滚入可见区域后才开放一次确认。

同名预选仅接受完全一致的材料名称、明确相同的材料类别及唯一已发布版本。资源类别通过来源记录 `{"schema":"cablesim.material-identity/1","category":"conductor|insulation|metal|polymer|filler|..."}` 声明，取领域材料类别的原值；缺声明或多版本保持人工选择，不从资产 ID、名称片段或物性猜类别。现有唯一身份迁移与已有绑定保持原约定。密度来源类别可按逐项 `cablesim.density-source/1` 的明确 `basis` 声明读取（`teaching`、`standard_reference`、`manufacturer`、`measurement`、`user`）；结构化来源的数值和 kg/m³ 单位必须与本次输入一致，人工确认仍必需。

真实重量流程：先构建正式前端到 `.data/type-weight-batch/frontend`，再在frontend运行 `node src/features/type/tests/verify-weight.mjs`。脚本从发布库的只读备份建立隔离副本，真实浏览器导入未批准的密度草稿、创建四芯草稿、批量绑定既有固定资源、补密度、查看全部过期差异后一次确认、重算用料并导出规格书；同时对拍导体/绝缘环面积、核验历史运行不被改写、两种视口深浅主题的表格边界与滚动。原件、截图、数值及人工审核边界只放 `.data/type-weight-batch/`，保留此前 `.data/type-weight/` 的比较基线。
- 要求与标准：要求清单、执行标准、待批准导入三个页签，复用保存的标准工件和独立批准账本；来源版本、条款、定义冲突与结构定位进入属性栏。历史来源不能批准；输入缺失和未覆盖不改成不适用。
- 电气参数 / 短路容量：正式 `cablesim.type-electrical` 0.3.0 参数契约、公共 MethodParameterFields 编辑、首次修订保存、错误保留、跨模块文本与方法草稿撤销。结果保留原始精度、性质、公式、条款和固定快照；短路曲线只读取插件保存点。R₂₀ 分别保留设计输入、实测和厂家上限；第 2 类导体显示 GB/T 3956-2008 表 2 的标准限值参照，不把标准上限当作实测值。
- 载流量表：单芯 / 三芯工况编译、方法参数、工况选择、保存冲突和固定快照。多回路明确区分全回路等负荷与逐回路允许电流；等负荷结果须包含所有回路，不用单回路结果替代。历史条件保留原计算口径。填写 ks、kp 或涡流分支时须保存系数来源。
- 方案对比：正式型号族、最多四个方案、保存指标矩阵、全部适用要求矩阵、参数差异、只读截面对照、逐项运行来源、独立方案分支。在对比页选择候选并人工确认“采纳为新版本草稿”；保留输入、运行与未覆盖项，直接打开该草稿规格书。已发布的当前版本可建立方案，历史快照不可分支。要求集合取各方案保存核对与批准要求的并集，未运行行保留，不用较短工件提高覆盖率。宿主只展示插件余量与判定。
- 规格书：默认客户版；“生成规格书”按当前修订预检并运行缺少结果的已保存模块，复用当前结果，失败停在对应模块并保留已完成运行。客户稿包含逐项标准要求、实际值、保存余量、判定与缺项原因；未覆盖不视为满足，仍阻止发布。首页为型号摘要与人工签字栏，第二页引用保存几何工件的圆形截面轮廓；未支持的轮廓明确缺图，不按外径猜形状。结构表显示绑定材料版本，用料表显示保存内外径链、折算体积与缺项，末章列方法、资源与来源版本。内部审核稿另保留不适用折叠清单和完整来源摘要。HTML 与 PDF 共用章节内容，PDF 嵌入中文字体、逐行分页并重复表头。文档版本、变更摘要、编制人与日期在提交评审时记录；普通保存不新增文档修订。
- 属性栏 Agent 页签复用公共 `AgentPanel`，传入型号工作区 ID、型号名称与型号相关建议。首次打开后保留挂载，切回输入不丢会话；切换型号按工作区身份隔离。会话绑定与工具范围由公共 Agent 服务控制。

## 验收

`node src/features/type/tests/verify-type-to-study.mjs` 使用发布库的只读备份、真实宿主与插件、一个浏览器页面，操作四芯草稿创建、导体类别补填、方法适用性、新建研究与名片返回链接。四芯完整热路未接入时保持明确拒绝；GB 50217 校正必须另有同型号、同条件且有出处的基准电流，不为新草稿编造基准。另用发布副本中完整的 YJV22 三芯设计实测直埋允许电流，不把它冒称为四芯或新生成三芯草稿的结果。输出 `.data/type-to-study/`；`--supported-only` 只复测完整三芯，并单独保存记录。

型号命令栏“用于载流量研究”建立同一设计工作区下的研究，统一索引的 `workspace` 关系让名片“被用于”可返回研究。单芯、三芯通过既有载流量工况编译接口生成直埋模板，工程师明确确认后将其保存为独立 `method_input`；不把结构查看的空气占位截面直接当成敷设工况，也不修改型号结构、材料或历史输入。运行固定设计修订与模板条件来源。四芯保留研究入口及方法范围说明，进入研究后须补敷设条件与适用基准。固定发布版本先建立设计草稿。

`node src/features/type/tests/verify-high-voltage-use.mjs` 从发布库只读备份复制起帆 110 kV 固定版本，经真实浏览器确认执行标准、核对依据、保存电气及短路运行、查看载流量工况并导出内部审核规格书；软件 WebGL、两种视口与主题串行验证。截图、逐步耗时及保存工件在 `.data/type-real-use-hv/`。波纹金属套缺实际载流截面时保持缺项，不使用显示用等效圆柱的面积。缺导体类别可在要求行就地填写，保存新修订后自动经 Executor 查询固定标准依据；旧判定和审批保持原样。

`node src/features/type/tests/verify-real-use.mjs` 从发布数据库的只读备份建立隔离库，在一个浏览器页面中真实操作四芯标准提案、人工确认、保存运行、方法条件和内部审核规格书。包含 4×95 与 3×95+1×50 的真实实体几何 / 手算体积核对，以及两种视口与主题下的研究试算工具栏收纳。输出 `.data/type-real-use/`；不修改演示服务数据库，不模拟计算结果。只修改工具栏布局后的复测可加 `--toolbar-only`，仍操作同一个真实研究入口，另存 `toolbar-record.json`，不覆盖四芯运行记录。

四芯设计使用 `cablesim_sdk/type_design.py` 的 `cablesim.cable-design-request/2` 和 `cablesim.type-draft/2`，旧第一版仍可读取。`four_core` 为四芯等截面；`three_plus_one` 必须给定较小的 `neutral_area_m2`，第四芯为中性线；非实心圆须另外给出 `neutral_diameter_m`。所有多芯须明确 `gap_m`，相切时填 0。可选 `filler_thickness_m`、`binder_thickness_m` 是工程师输入的等效径向厚度，不是标准或制造默认值。几何提案使用 `cablesim.core-layout-request/2`，中性线绝缘厚度由单独的固定标准查询给出。

实体仍保存为 `cablesim.domain/1` 的 `multi_core` 和四个独立的截面、外径及坐标；原始第二版设计请求固定在提案及创建来源中。四芯采用明确的正方形芯中心排列，3+1 多出的中性线间隙计入填充空间，不声称是紧压最优布局。标准核对逐芯取依据，护层附录分支缺项保留；电气及短路仅在各自适用范围内逐芯输出，四芯载流量尚未覆盖，不能套用三芯结果。默认 50 Hz 可在首次方法页直接确认保存，仍属于未经批准的工程条件。

`node src/features/type/tests/verify-audit.mjs` 使用隔离库副本、一个浏览器页面，核对两视口深浅主题下的命令栏、默认结构取景、载流结果列、分芯合并、审核原因分组、方法字段深链及真实库复制。加 `--states` 串行检查读取空 / 加载 / 失败，以及真实插件保存运行与修改输入后的当前 / 历史状态；故障注入不伪造工程结果。输出 `.data/type-audit/`，构建目录为该目录下的 `frontend`。

运行摘要由插件保存工件和工况的 `evidence.headline` 提供，不由页面重新算数。结构、标准核对、电气和短路均有中文结论；有缺项的标准核对不能显示“全部满足”。电气与短路另输出可校验的 `x-cablesim.headline-witness`，关联物理量和同一结果工件。三芯结果仅在未舍入值、条件、依据及缺项完全一致时合并，分芯工件始终保留。

`node src/features/type/tests/verify-basis-layout.mjs` 在单页浏览器和独立数据库副本中核对依据目录、名称降噪、规格书单滚动、两种视口与主题，以及研究截面工具栏和唯一温度色标。输出在 `.data/type-basis/`。
加 `--three` 使用 SwiftShader 软件 WebGL，检查两种视口与主题的三维首帧、颜色与控件避让；与默认流程串行执行。

在 `frontend` 下执行：

```sh
npx tsc -b
npm run check:styles
node node_modules/vite/bin/vite.js build --config src/features/type/preview.config.ts --logLevel error
node src/features/type/tests/verify-list.mjs
node src/features/type/tests/verify-structure.mjs
node src/features/type/tests/verify-standard.mjs
node src/features/type/tests/verify-calculations.mjs
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
node src/features/type/tests/verify-creation.mjs
node src/features/type/tests/verify-modification.mjs
node src/features/type/tests/verify-modules.mjs
node src/features/type/tests/verify-material-comparison.mjs
node src/features/type/tests/verify-fix-round.mjs --before
node src/features/type/tests/verify-fix-round.mjs
node src/features/type/tests/verify-fix-round.mjs --interactions
node src/features/type/tests/verify-fix-round.mjs --states
node src/features/type/tests/verify-fix-round.mjs --drawing
```

材料核对接口：`GET /api/types/{wid}/material-comparison` 返回保存输入修订、材料固定引用及逐项核对；`?revision=N` 核对只读历史输入。`POST /api/types/{wid}/material-comparison/adopt` 接收 `expected_revision`、`request_id`、`material_id`、`property`、`resource_id`、`content_sha256`。宿主重新核对条件、来源、固定版本、字段锁与输入修订后生成新修订；重复请求复用同一回执。显式采用在物性字段来源中保存 `cablesim.adopted-material-value/1`（资源身份、版本、摘要、完整参考值与原值 / 原来源），保持未审核；同时重新确认该材料的固定引用。旧运行保留为历史，Ctrl+Z 调用既有输入撤销接口恢复原值、出处与绑定；不改历史修订。未保存改动须先保存或撤销，历史或已发布型号不可采用。

所有业务脚本通过 `tests/fixture.mjs` 只读备份真实数据库到随机临时路径、启动独立服务和浏览器，结束核对零标签页、停止服务并删除临时数据库。当前轮次的五态、两尺寸和两主题采用自动断言，检查越界、控件重叠、13 px 字号和文字对比度；每个改动页面只留 1–2 张截图。验收只执行明确授权的 IEC 标准代数、轻量标准核对和 CAD；有限元、批量仿真、收敛研究及性能基准仍走超算。列表源无已发布型号，列表历史态没有伪造批准数据。产物在 `.data/frontend-type/`，不入库。

`verify-details.mjs` 使用独立构建 `.data/type-detail/frontend`，串行检查两个型号的模块与研究截面：两尺寸、两主题下工程精度、统一选择控件、单层纵向滚动、表格自然展开、曲线默认收起、上下标公式与完整出处、原值折叠追溯、全选/半选/取消选择。`--states` 复用同一断言核对五态，成功与历史来自真实保存运行和隔离库输入修改。短路容量保留 0.1 kA，载流量与余量保留 0.1 A；仅改变展示，保存的原值与判定不变。`detail-checks.mjs` 为共用浏览器断言。

`--focused` 复测短路、电气、载流量与材料物性视图；`--curve` 复测真实保存曲线的采样与展开态。曲线复用绘图模块的尺寸观察器，让 SVG 坐标与实际宽度一致，并断言经屏幕变换后的坐标字号仍至少为 13 px。公式只对识别的保存表达式用 HTML 下标排版，不在前端重新推导；未知表达式保持原文，材料温度常数 β 保留 K，不按绝对温度转成 °C。

`verify-standard-generation.mjs` 使用 `.data/type-full-generation/frontend` 构建与发布库只读副本，真实操作 YJV22 8.7/15 kV 3×240 完整护层提案、人工确认、保存结构推导、要求目录、标准核对及内部规格书；两尺寸、两主题自动检查边界，截图和耗时只存 `.data/type-full-generation/`。结构提案分阶段输出 `basis_queries`，宿主经 Executor 固定记录，再将 `parameters.basis_references` 传回方法；宿主不计算厚度。生成的 `/2` 请求可选 `screened`、两层半导电实际厚度、铜带单带厚度与带宽、`armour=none|steel_tape`。完整分支限定等截面圆形 XLPE、PVC 挤包内衬及外护套、单铜带重叠绕包及可选双钢带；附加包带、3+1 和高压完整生成明确拒绝，绝缘线芯旧请求仍可读。每个附录阶段按 B.1 修约，外护套按 B.2 与正文指定精度；参数均来自 0.4.0 保存引用。假设厚度、标称厚度与实体径向包络分别记录，制造尺寸不从假设直径反推。要求核对重新从当前结构计算，旧出处快照仅可在查询条件一致且摘要校验通过时复用，输入改变后重新查询受影响的表行。铜带制造厚度仍是工程师输入；第 2 部分已有下限时明确校验，第 3 部分未收录的铜带判据保留未覆盖。缺制造输入、实测值和物性仍阻止发布，不宣称客户规格书已获批准。

`verify-organization.mjs` 使用当前正式构建和指向 8100 的 GET-only 代理，一个页面串行检查目录及工作台：两尺寸、两主题、空 / 加载 / 错误 / 成功 / 真实保存修订的历史状态、名片、行式编辑、标签避让及内部标识。分层表材料名称与固定版本须完整显示，可换行；表头、绘图外径和来源不得越过单元格。空 / 加载 / 错误是浏览器故障注入；成功与历史来自保存输入。批准 / 冲突 / 要求离线另外使用只读接口契约注入，不声称来源库有新增批准。不写演示数据库、不运行插件。只保留一张工作台截图，产物在 `.data/type-organization/`；目录没有历史模式，历史状态在工作台检查。单元测试对拍 V→kV、m²→mm² 和逐层外径手算，并拒绝以完整性失败或失败工况作为当前结果。

`verify-organization-save.mjs` 复用隔离数据库和当前正式构建，在一个页面验证新建型号、Ctrl+S、顶栏保存及重复提交保护；经 API 对拍保存名称、修订和请求数量，不调用计算方法。两个浏览器脚本串行执行。

`verify-fix-round.mjs` 使用 `.data/fix-round/3d/frontend` 的独立正式构建，`E2E_DATABASE_SOURCE` 指定只读备份源；可指向本轮生成的隔离发布库。主流程覆盖两型号、研究截面 / 三维及创建 / 工况弹窗的两尺寸两主题，实际软件 WebGL 图像检查亮度和材料色，并验证真实参数试算不写输入。`--interactions` 单独复测试算、画布编辑与弹窗；`--states` 在隔离服务上注入加载、空、错误，成功与历史使用真实输入；`--drawing` 专门检查短画布最小电缆直径及保存温度切片，保存运行无场工件时断言明确缺项而不编造场。各流程串行运行，收据和截图放 `.data/fix-round/3d/`。

波纹护套只能在已知名义厚度的圆形单芯结构上显示等效圆柱；标明等效显示，不输出实体体积、质量或精确拓扑，原插件对波纹缺项的拒绝保持有效。电气频率 50 Hz 是表单的明示工程试算初值，保存时记录未批准来源；历史条件不补初值。方法试算复用现有 preview 接口，不保存、不批准；修改条件或切换页面取消过时请求。

要求依据查询将缺失的行条件返回为 `missing_fields`；要求目录行保留 `basis_missing_fields` 与 `basis_reason`，不改变批准定义摘要。导体类别和材料标准类别可在要求行就地填写；保存产生新修订，随后经 Executor 重新查询固定版本依据，旧判定保持历史。执行版本声明需要工程师确认，不代替要求批准。尚未声明的版本在 `undeclared_standards` 中返回，不能当成依据库未收录。载流量工况的 `frequency_hz` 为明确交流频率，模板初值 50 Hz；不能沿用结构查看回路的直流占位频率 0 Hz。缺方法参数时预检给出中文字段名和填写入口，原始契约路径留在追溯层。

## 对象名片与状态

名片复用 `DesignCard` 与 `designSummary`，基准版本来自 `type_origin_reference`，修订时间来自 `updated_at`，外径与层数取同一参数截面几何；绘图外径标为推导，不代替保存的原生实体外径。发布状态读取 `type_lifecycle`（草稿 / 审核中 / 已发布），编辑状态只在顶栏显示一次。

浏览器的 `StatusMark` 读取完整性通过的保存工件、当前性和输入修订；当前、过期、失败、运行中显示标记，未接入 / 未运行只显示淡空心点，悬停说明原因。命令栏显示一句短状态，保存运行时间转成本地月日时分，过期时保留方法版本；完整原因放入悬停。对照与规格书分别复用现有只读接口。摘要、运行身份、插件身份及内部修订只进入悬停信息。

目录的执行标准读取当前修订、完整性通过的标准判定保存运行，调用 `GET /api/design/type-workspaces/{wid}/requirements?run_id=...`，只收录 `source_current=true`、`state=approved`、可绑定且批准定义一致的标准号并去重。无批准则显示“未声明”，悬停提示“在要求与标准里添加”，读取失败也保留具体原因；要求批准完成后会使目录缓存失效。材料来源里的参考条款不推断成执行标准；该读取不会运行、批准或保存。资源关联只链接统一目录。

电压和标称截面按量纲换算后最多保留两位小数并去掉尾随零，保留 0.45 kV、0.75 mm² 等有效名义值。已保存时保留不可用线框保存按钮，维持固定入口和键盘习惯；有未保存改动才启用实心主按钮。分层表优先给材料列宽度，尺寸、绘图外径及来源列收窄；材料名称和固定版本保持完整，可在单元格内换行。

`verify-specification.mjs` 从独立“规格书演示”型号一键生成五项真实运行和双版本 PDF，调用 `tests/check-pdf.py` 检查中文字体、工程单位、空表、版本隔离、保存截面、缺项保留及客户稿无内部身份 / 哈希，并检查两页五态、两尺寸、两主题与文档修订。演示参数明示保存，未伪造工厂实测数据；未实现的完整阻抗、故障分流和标准规则仍阻止发布。版式参考受控样本 Nexans XKDT 第 1–2 页、Prysmian N2XS2Y 第 1 页、正泰电缆手册第 21 页；仅参考信息组织，不复制品牌、认证或产品数值。

`verify-modification.mjs` 在隔离数据库与正式入口执行改绝缘厚度、即时历史标记、Ctrl+S、实体与标准重算、客户规格书下载及 Agent 页签。用同心环手算对拍外径与各受影响层体积 / 用料；未批准和未覆盖保持原状态。耗时、实际点击与键盘次数、阻点及修复记录保存于 `.data/type-modification/verification.json`；两尺寸、两主题自动检查五种规格书状态与 Agent 布局，PDF 前两页及工作台仅保留本轮截图。自动“3 秒检查”只验证可见结论和可用下一步，人工可理解性仍由设计验收判断。

`verify-modules.mjs` 对隔离库的起帆 110 kV 和 YJV22 三芯型号逐个打开九个入口，记录真实运行、范围拒绝或未配置字段及恢复入口；基于同一基准建立两个加厚候选、分别保存及重查、完整矩阵、Esc 取消与人工确认采纳、规格书引用新草稿。产物在 `.data/type-modules/`，方案对比覆盖两尺寸、两主题与五态；不批准要求、计算结果或发布型号。本轮收尾型号回归必须包含 `python -m pytest -q tests/test_type_*.py tests/test_index_type_bindings.py tests/test_requirements*.py`（Windows 将 glob 展开成文件参数）。

`verify-multicore.mjs` 使用生产路由检查三芯圆形 / 扇形、层与芯编辑、地下敷设场景以及 YJV22 客户稿的五项真实运行。客户稿载流量取整至 1 A、短路电流保留 1 位小数，条件来源在表下注明；相同芯的行仅在未舍入值、条件和依据均一致时合并。

## 待协调

### 材料、执行标准与发布版本引用契约

`GET /api/types/{wid}/resources` 只读返回当前保存修订、可绑定的已发布材料 / 规则资源，以及每个目标的 `binding/state/reason/unique_match/match_reason`。`POST .../resources/bind` 接收 `expected_revision/request_id/role(material|standard)/target_id/resource_id`（null 解除绑定）；`POST .../resources/migrate` 接收 `expected_revision/request_id`，显式写入唯一身份匹配，保留已有绑定。修订冲突拒绝写入；请求重放返回第一次结果。绑定操作不修改领域物理参数、不运行、不批准、不发布。

引用保存在 `workspaces.state.type_resource_bindings`，schema 为 `cablesim.type-resource-bindings/1`：`material[领域材料 ID]` 与 `standard[SHA256({standard,source_digest})]` 各保存 `{resource_id,id,asset_id,version,content_sha256,name,kind,input_digest}`。`resource_id` 是 `engineering_assets.id`，`asset_id` 是资源逻辑身份。材料目标只包含结构层实际引用的材料，不把模板里未使用的土壤等材料列为缺项。每层仍通过领域材料 ID 查到同一固定资源版本，避免更改 SDK 物理契约。材料 `input_digest` 是保存材料事实的宿主 fingerprint；标准是上述键。编辑材料事实或替换已批准标准后绑定过期，历史修订保留原引用；已移除的目标可解除引用。

迁移不比较名称：材料采用领域材料稳定 ID 或 `/materials/{index}` 来源 reference 内结构化 `{asset_id,version?,content_sha256?}`；标准收录摘要通过的已批准要求，或明确核对的执行版本声明，匹配资源 sources.reference 内 JSON 的 `source_digest`。声明保存于领域 `provenance['/execution_standards']`，`kind=standard/reviewed=true/reference=JSON({schema:'cablesim.execution-standards/1',items:[{standard,source_digest}]})`；它只声明使用哪个标准版本，不批准条款、设计或计算结果。目标 `declaration=true` 时，“要求与标准”的执行标准页在尚无运行时也显示固定资源链接。多个资源版本或没有明确身份均不写入。按型号点击“核对唯一匹配”；此功能不会在启动或读取时自动迁移演示库。

### 离线材料与标准参考库

`frontend/scripts/engineering_resources.py` 是发布种子的受控摘录数据及导入入口，由 `build_release_seed` 调用。7 个标准版本、21 个材料用途条目均经过普通资源 API 创建草稿、确认核对来源、发布；内容冲突拒绝覆盖，重复导入不增加资源或审核事件。`release_identity.engineering_resources` 是定义内容摘要，变化时沿用已备份再重建流程；不依赖本地 PDF、联网服务或 8100 数据。两个随附源设计的明确材料 ID 映射写入来源身份，再调用唯一匹配；缓冲带、泛称纤维填料等缺明确资源身份的材料保留未绑定，不按名称猜。绑定不替换型号物性。

资源数值带 `standard_reference` 语义，采用 `release.sources[].reference` 中的 JSON `schema='cablesim.reference-data/1'`，数值行包含 `property/value/unit/standard/table/printed_page/pdf_page/source_digest/condition`；缺项行包含 `missing/reason`，标准条目包含 `edition/file/source_digest/pdf_page/scope/rights`。Quantity 当前不支持 Ω·m、K⁻¹和无量纲单位，故这些值完整保存在固定版本的来源记录中；热阻率同时保存在原生 parameters。没有改公共物理契约、捏造量纲或把来源摘要当作参数。资源页负责人可解析此 schema 为“参考物性 / 条件 / 出处 / 缺项”，不必显示原始 JSON。源文件全文不入库，授权凭据仍为 not_assessed/not_registered。

IEC 60287-1-1:2023 现行正文表1（印刷35 / CMV PDF83）、表3（印刷37 / PDF85）；IEC 60287-2-1:2023 表1（印刷33 / PDF89）逐页核对。铝导体与铝护套、EPR/XLPE电压和填充条件、PVC绝缘与保护护层分别保留，未赋统一默认值；表中没有密度，铜屏蔽组没有独立电阻率行，这些保留缺项。导体类别及最大R20引用独立GB/T3956与IEC60228版本，不把它们当成金属体电阻率表。

浏览器回归：`node frontend/src/features/type/tests/verify-reference-library.mjs`，使用单页、隔离数据库和已构建 `.data/material-library/frontend`，检查两类资源目录、两型号的引用、执行版本声明及双尺寸/双主题，不写演示服务。默认只读备份发布库，结果在 `.data/material-library/`。原有 `verify-resources.mjs` 的绑定、撤销、断线重试与五态验证保留。对应单元核验 `tests/test_type_resource_seed.py`，收尾还须跑型号相关范围及 `tests/test_release_demo.py`。

发布沿用 `engineering_type_releases` 的固定版本（资源目录已读取 `/api/types/library`），不再生成重复对象。规格书快照增加 `source_design:{id:workspace_id,revision}` 与 `resource_bindings`；发布的 assembly.dependencies 固定材料 / 标准资源 `asset_id/version/content_sha256`，sources.reference 保存 JSON `source_design`。library 和 publish 响应也返回 `source_design`，未发布设计没有 library 条目。旧发布记录由其已保存 payload.revision 投影来源修订，不回写或伪造审批。

统一索引使用 `$.type_resource_bindings.material/standard`，按 `resource_id` 产生 `material/standard` 角色、按 `version/content_sha256` 设置 pin；无法解析及部分绑定时剩余的未绑定目标应保留 unknown。需继续接入 `input_digest` 对应的材料事实 fingerprint，变化时标过期。发布记录的 `payload.revision`（兼容旧记录）或 `payload.source_design.revision` 用于 `source_design` 的 revision pin；`published_cable_version` 使用资产版本 / 摘要 pin。sources.reference 的结构化 source_design 应由此关系消费，不再列为无文档 ID 的 unknown source。本模块继续复用 `RelationPanel(kind="type")`，不拼装第二套关系。新接口需由公共 API 负责人运行客户端生成；目录内临时使用有响应检查、10 秒超时和同一请求重试的同源客户端。

执行版本声明还需索引负责人接入轻量投影：`backend/index/sources.py` 的工作区查询增加 `json_extract(state, '$.domain.provenance."/execution_standards"') AS execution_standards`；`relations.py` 在调用 `_resource_targets` 前将该字段还原为 `domain.provenance['/execution_standards']`。不用读取完整状态或运行工件。缺这项时绑定资源及版本链接正确，但已声明标准会被错误标成过期；隔离浏览器将此实际接入缺口单独记录为 `indexProjectionGaps`，不算作通过的当前性断言。

隔离浏览器验证：`node src/features/type/tests/verify-resources.mjs`，使用 `typeFixture` 的私有数据库副本、单页面并清理服务和数据库；`E2E_DATABASE_SOURCE` 可指定只读种子。截图与断言记录在 `.data/type-resources/`。温度标注回归复用 CAD `verify-composition.mjs`。

1. 公共路由与导航已注册；正式构建脚本仍由前端线程管理。目录内 preview 只作隔离验收。
2. 公共参数字段复用 MethodParameterFields；规格书与结构扩展契约已纳入生成客户端，操作引用仍核验当前服务响应。
3. 宿主尚无已保存方法配置的撤销接口；方法与工况页 Ctrl+Z 只撤销未保存条件，已保存时明确提示，不能误撤销型号结构。
4. 规格书固定修订读取、完整阻抗和未覆盖标准分支仍受宿主发布校核约束，前端不能通过省略问题解除门禁。
5. `organization.test.mjs` 已纳入 `npm test`。两个浏览器命令见上文，分别依赖 8100 只读来源与隔离数据库。

## 新建型号的四个起点

`GET /api/types/creation-options` 返回固定发布库版本、已批准资料提案和已安装标准提案能力的输入契约。`POST /api/types` 接收 `request_id/name/origin`，按起点增加：

- `library`：`resource_id`（发布资产 UUID）与 `content_sha256`；复制发布记录的固定领域文档和资源版本，不复制保存运行、审批、发布状态，不加入原型号族。
- `standard`：`proposal_id/content_sha256/human_confirmed:true`，请求头 `X-CableSim-Actor:human`；必须先调用 `POST /api/types/creation-proposals`，正文 `{request_id,input}`。输入 schema 为 `cablesim.cable-design-request/1`，包含 SI `area_m2`、电压表组合 `voltage`（如 `600/1000`）、`construction`、`conductor`、`form`；非实心圆须明确 `diameter_m`，三芯须明确 `gap_m`（相切显式填 0）。执行封签的标准 `structure-proposal` 与几何 `core-layout-proposal`，只作表值与轻量几何提案，不加载 OCCT 或运行原生求解。返回固定提案身份、摘要、逐行参数、标准版本 / 条款 / 页码、方法发行与输入输出摘要、缺项和适用范围。提案不建立设计，也不批准型号。UI 人工确认后建立草稿。
- `import`：`proposal_id/content_sha256`（资料提案的 `id/sha256`）。只有已批准提案可以转设计；校验原件、提案、批准记录及生成资料版本的摘要，完整结构直接复制，缺项规格只填已声明值，不由成品外径猜层厚或芯位置。其余已批准规格保存在来源的 `declared_specification`，保持原单位与性质。资料页负责人在 `/resources/cables/imports` 的批准结果旁加“新建型号设计”，调用本接口后导航 `/types/{response.id}/structure/section` 即可；资料提取和批准流程保持原接口。
- `blank`：`construction:single_core|three_core|four_core`，只建立芯、待选导体 / 绝缘材料及绝缘层骨架，未知的截面、尺寸、位置、电压保存 null。名片逐项列出缺项并定位输入。四芯用第二版草稿，不默认假设中性线截面。

前三种来源保存于 `state.type_creation:{id,kind,source,initial_document_sha256,created}`。库与资料同时保存 `type_origin_reference:{id,version,content_sha256,...}`，供现有关联读取；库 `id` 是发布资产 UUID，资料 `id` 是已批准生成的 domain_cable_models UUID。独立新型号族为 `type/{creation.id}`。来源显示为库引用及版本、标准生成及人工确认、资料及页码、空白及用户录入；完整标识只放悬停。统一索引负责人可把来源关系改为 `source`，并读取标准来源的 `type_creation.source.methods[].method` 及其固定发行、资料的 `document_id/proposal_id/references`。本模块只复用 RelationPanel，不私自生成关系。

未知几何使用独立 `cablesim.type-draft/1` 标签；求解输入的 `cablesim.domain/1` 校验不放宽。中性单位长度展示上下文明确标“非运行结构查看”，不提供运行负荷、介质物性或接地方案。`PUT /api/types/{wid}/document` 接收 `expected_revision/request_id/document`，范围校验、CAS、请求重放与历史保存；必需几何和电压补齐后经严格领域校验转为完整文档。画布不画空值几何，标准核对与用料入口明确显示缺项；旧型号仍用原领域保存接口。

`verify-creation.mjs` 采用正式构建、一个页面、随机端口和隔离库。先在服务启动前通过 `test_type_creation.seed_browser` 准备明确标为隔离目录契约的发布样例及生成 PDF 的批准资料，未伪称真实工程审批；标准提案经真实插件执行。检查四条创建 / 来源 / 进入结构工作台、空白字段定位与 Ctrl+S、人工确认门禁、两尺寸两主题空 / 加载 / 错误 / 成功 / 历史状态的布局与对比度。四张 1366 浅色截图和断言记录放 `.data/type-creation/`。后端 `tests/test_type_creation.py` 对拍 GB/T 12706.1—2020 6.2 表 7 的 70 mm²、1.1 mm 与 GB/T 11017.2—2024 6.2.2 表 2 的 800 mm²、16 mm；`plugin-tests/test_type_proposals.py` 仅检查同一标准表和等截面积 / 芯中心距手算，没有原生环境调用。
