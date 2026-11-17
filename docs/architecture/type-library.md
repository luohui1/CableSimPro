# 系列、结构表和数据交换接口

型号库复用 `domain_cable_models`、`Types` 工作空间、型号方案/审核/发布表及普通 `Study`/`Run`。系列表只保存成员关系、原始结构表、固定预览和版本引用，不另存计算结果。发布与批准仍通过原有型号门禁。界面入口为 `/resources/cables/structure-import`。

旧宿主与 Studio 共用的纯 Python 运行实现位于 `backend/kernel/catalogue_core/`，两份原始厂家目录 JSON 也只保存在其 `catalogues/` 内；系列播种入口位于 `backend/kernel/catalogue_seed.py`。这些文件随发行器现有的 `backend/` 源码范围进入离线包，无需依赖未打包的 Studio 目录。`studio.core.studio_core` 和 `studio_core` 保留同一模块对象及 `CoreError` 身份的兼容导入，Studio CLI 与专用入口继续使用这份实现；不复制算法或新增型号存储。

## 结构表导入

1. `POST /api/type-library/imports/upload`：multipart `file`，支持 XLSX、CSV 和旧 XLS；非空原件不超过 10 MiB，界面与接口使用相同限制。返回 `upload_id`、原件 SHA-256、工作表、表头与建议列映射。仅完全匹配随附样本内容摘要时提供样本声明。
2. `GET /api/type-library/vocabulary`：字段单位、建模参数及其参考出处；参考值必须由操作者明确选用。
3. `GET/POST /api/type-library/mappings`：保存和复用 `{name,mapping,headers}`。列索引从 0 开始，不允许两字段映射同一列。
4. `POST /api/type-library/imports/preview`：`{upload_id,sheet,first_data_row,mapping,series}`，起始行从 1 开始。返回固定的 `preview_id` / `preview_digest`、每行数值、错误单元格、缺项、来源与结构闭合说明。公式不求值，不使用缓存值；规范型号模型的范围错误也返回原表单元格，保留原数与其余正确行，不变成整表 500。
5. `POST /api/type-library/imports/commit`：`{preview_id,preview_digest,request_id,human_confirmed:true,skip_errors:false}`，要求 `X-CableSim-Actor: human`。预览、原件或请求摘要不一致会拒绝；预览固定的标准查询发行或封签改变时返回 `409 / IMPORT_STANDARDS_CHANGED`，必须重新预览和人工确认，不静默换版。存在错误行默认整批拒绝。只有明确选择 `skip_errors:true` 才跳过已显示的错误行。

`series` 声明包括名称、厂家、原样本型号、芯数、U0/U/Um（V）、执行标准的明确版本、系列共用值及逐项出处，以及显式建模参数。不能从型号名称唯一识别材料时须填写材料声明。GB/T 3956 标准电阻上限必须单独选择 `resistance_basis: standard_limit`，保留完整标准记录，不标作厂家实测。

随附声明省略 `common/common_basis/modelling` 时，界面仅将其视为未提供的空项；格式损坏会明确报错，不自动采用研究参考参数。预览请求期间修改声明、列映射、起始行或返回上一步，旧响应均失效，必须再次预览后才能确认；预览名称与提交对象来自同一固定快照。

普通上传表可在声明步骤“加载来源说明（JSON）”：读取不超过 1 MiB 的非空来源对象；文件包含 `source` 时只读取该对象。来源文件只替换 `series.source`，不代填结构、材料物性、执行标准或工况，加载后须重新预览。无效 JSON 或字段类型在界面明确拒绝。逐项来源展示已保存的 `column_meanings[field].quantity/unit`、原件定位、来源链接和限制说明；任意文本按原文显示，链接仅允许 HTTP(S)，不执行原文内容。

每个原始数值都有 SI 值和原表显示值、文件摘要、表名、行列、方法名/版本和可信分档。旧版 XLS 先检查原始 BIFF 记录，含公式时拒绝并指出原表单元格，不把缓存结果视为原始数字；无法保留原始记录的更早格式要求另存 XLSX。文本数字中的逗号可能表示小数点或千分位，没有明确地区格式声明时拒绝猜测。

1 至 16 芯缺项资料可保存为现有型号草稿，2 芯、5 芯等多芯记录不猜坐标、层厚、导体直径或温限；不完整型号不能计算。完整型号也只是工程草稿，来源确认与产品审核是不同的动作。已被系列、型号设计、资料提案或研究引用的原始型号不能删除，避免破坏来源和历史版本。

### 真实厂家表的跨电压导入回归

`tests/fixtures/` 中另有三组可通过同一接口上传的原表摘录；它们核验的是数据保真与缺项拒绝，不是完整产品认证。重量的通用字段名称为“电缆重量”，具体是近似值、最大值还是其他口径，仍读取原表表头及逐值来源。

| 文件 | 官方原件与范围 | 必须保留的边界 |
| --- | --- | --- |
| `chint_lv_yjv.csv` / `chint_lv_yjv_source.json` | [正泰选型手册](https://cabling.chint.com/upload/data/202510-31/正泰电线电缆选型手册.pdf)，PDF 21 / 印刷 14 页表 9，YJV 0.6/1 kV 的 1×10、1×16 mm² 两行。 | PDF 20 页说明外径、重量供储运安装参考，不作为验收参数；未给导体直径、层厚、R20 和载流量。原标准声明没有分册，不自动选择执行标准。 |
| `jiangnan_yjv22.csv` / `jiangnan_yjv22.json` | [江南官网 26/35 kV 表](https://www.jiangnancable.com/project/2635kv-yjv22-copper-conductor-xlpe-insulated-pvc-sheathed-steel-tape-armoured-power-cable/)，固定表 `tablepress-26yjv22` 中 9 个三芯规格，50–400 mm²。 | 重量原义为最大重量；3×95 mm² 的外径原刊 86.3 mm，保留异常并要求厂家复核。原网页全页可动态变化，原表表头、全部 20 行与选中的 CSV 单元格必须一致。 |
| `tai_i_220kv.csv` / `tai_i_220kv_catalogue.json` | [台一电力电缆型录](https://www.tai-i-int.com.tw/media/product/733/file/________.pdf)，PDF 6 / 印刷 9 页右上表，YJLW02(03) 127/220(252) kV 的 400–2500 mm² 共 12 个规格。 | 明确选择原型号说明支持的 YJLW02/PVC 变体，保留近似结构、近似重量和最大 R20 的原义。2500 mm² 的原刊 R20 为 0.0073 Ω/km，不替换成其他标准值；无年号标准不绑定新版。 |

三组数据分别以真实 CSV 和 XLSX 走上传、选表、映射、预览、人工确认、旧 Types 入库。原件摘要、行列、SI 换算和原始未映射列均保留；仍缺少材料、制造数据或工况的条目保持 `incomplete` / `draft`，不产生批准或伪造的计算结果。

明确声明的 `um_v` 同时保存在缺项候选规格和旧 Types 的 `rating.um`，完整三芯映射也保持该声明；未提供时保持未知。交换包中明确非空的 Um 必须与系列声明一致。旧候选没有此字段或保存为 `null` 时保留原有缺失，不从系列回填，不改写原候选摘要。历史 `1.0.0` / `1.1.0` 的“电缆近似重量”显示标签仍可随原事实原样搬运，不将旧事实改为新标签。发布种子修订为 19，通过既有身份检测、先备份再刷新流程采用上述保真语义。

`python scripts/verify_import_originals.py --output <新目录>` 在 CI 中下载固定官方原件、检查 PDF 字节身份或网页原表内容，再运行这些真实导入测试；任何原件审计跳过都令门禁失败。日志、原件页图、JUnit 和来源回执进入既有 `library-import-verification` 产物，完整 PDF 不入库。离线复现可显式传入 `--chint-pdf`、`--jiangnan-html`、`--tai-i-pdf`，回执区分本地原件和当次官方下载。

## 系列、版本与批量操作

| 接口 | 用途 |
| --- | --- |
| `GET /api/type-library/series` | 系列、规格数、审核状态统计 |
| `GET /api/type-library/series/{id}` | 当前规格、固定电缆型号版本和工作空间修订号 |
| `GET /api/type-library/specs/{id}?version=n` | 逐值来源、历史版本、普通运行引用与事件 |
| `POST /api/type-library/specs/{id}/revisions` | 从已保存设计建立同一型号族的新版本；保留旧版本 |
| `POST /api/type-library/series/{id}/batch` | 批量核对、载流量计算、提交审核/批准/发布 |

改版请求为 `{request_id,expected_version,expected_revision,note,human_confirmed:true}`。改版保留系列电压、芯数与规格截面；改变这些身份应建立另一规格或系列。原始表列值保留为证据，新版工程结构保存在普通型号工作空间和对应的不可变候选快照。

批量请求须提供 `request_id`、`operation`（`check/calculate/review`）、`spec_ids`、每项 `expected_versions` 和 `expected_revisions`、`human_confirmed:true`、`scope_acknowledged:true`。全部写操作要求人工头。版本过期整批不开始；同一请求可幂等重试。计算中失败逐项保留真实原因及成功项运行；审核采用单一事务，任何一项未通过原有门禁，整批不批准。

计算还需明确填写 `rows` 中每个工况的 `case_id/name/layout/depth_m/soil_rho_k_m_w/ambient_temperature_c/frequency_hz/bonding/source`；`parameters` 中至少有 `ks/kp/eddy/source`。这些单位依次为 m、K·m/W、°C、Hz。其他条件仍由已有载流量表输入契约校验。没有工况或方法系数来源就拒算。返回各规格的 `study_id/run_id/input_digest/output_digest`、方法名/版本及可信分档。`succeeded` 表示方法运行完成，不代表所有标准项目合格或产品已批准。

审核 `operation:review` 另需 `action:submit/approve/publish` 与 `note`。批准未提交的草稿、缺来源、过期结果或未满足发布范围都沿用原有明确拒绝。

## 复用的原有能力（Agent 接入）

结构提案使用 `POST /api/types/creation-proposals`，人工采纳使用 `POST /api/types`；不重复实现标准结构生成。单规格载流量表使用 `POST /api/design/workspaces/{wid}/rating-table-definition`，研究保存、预检和运行沿用 `/api/workspaces/{wid}/studies`。GB 50217 校正继续通过已安装方法的研究接口执行，必须提供有明确来源和适用工况的基准电流。规格书、计算书与三维模型保持原接口。

Agent 可以上传原件、提出映射、请求预览和展示结果；不能把人工头或确认字段作为自动批准手段。T2 的 Studio 宿主接入此组接口后应删除原先独立的 `library.sqlite` 型号存储；这组接口不访问 Studio 的用户数据目录。

短路依据仍使用 `POST /api/types/{id}/short-circuit-basis`。电气与短路方法 `1.2.4` 修复浏览器把整数值浮点数（例如 `3450000.0`）序列化为同值整数后被误拒绝的问题。标准库的原始 `record_sha256`、版次、来源 PDF 摘要和 30 条记录内容不改；消费方法另外封签 `cablesim.basis-json-content/1` 内容摘要，只正规化精确等值的整数浮点表示，不采用误差容限，不接受布尔值或字符串替代数值。标准数据、查询、发行、原工件摘要、内外层条款及页码也必须一致，客户端无需重新计算或改写来源摘要。

返回的 `request_sha256` 仍是原 Executor 整批请求的追溯标识，包含当次运行身份，不能由一条引用重新验证；消费方法核验的是封签内容及确定的发行回执，不将这个请求标识当成已重新认证的执行证明。既存运行快照不改写，只有新建或重新运行的研究选择当前方法。回归通过真实 JSON.parse/JSON.stringify、保存、回读、再次保存、预检和普通运行验证 30 条依据，并分别拒绝数值、单位、条件、来源和回执篡改。

## 标准、材料与环境值

`GET /api/library/resources/catalogue?category=materials|environment|manufacturing` 和 `/table?category=...&table_id=...` 读取真实封签数据插件。`POST /api/library/resources/select` 要求固定 `release_digest/data_sha256/standard/edition/locator/quantity/record_id/conditions`，返回数值、适用条件、出处和可信分档。选择记录不直接修改工程，也不代表批准。

基础资源的 `Quantity.dimension` 另支持标准数据已有的 `mass_density`、`resistivity`、`volumetric_heat_capacity`、`dimensionless`。相应 SI 单位为 `kg/m3`、`ohm.m`、`J/(m3.K)`、`1`，接受原文的 `kg/m³`、`Ω·m`、`J/(m³·K)` 等值写法，原显示值和原单位仍保留。不同量纲的单位、布尔值及数字字符串明确拒绝。真实的 Huang 密度、IEC 电阻率与介电常数、Nielsen 体积热容可经查询、选择、`POST /api/foundation/assets/import` 和资源回读保存为来源完整的草稿，不因此写入工程或批准材料。T1 的生成类型与量纲显示应同步这四个既有名字。

此次对 `backend/foundation/contracts.py` 只追加上述量纲与单位；实际依赖闭包中仅 `cablesim.native-reference` 引用该文件，因此该插件发行升为 `1.0.7` 并重封签。原有计算算法和能力方法版本 `1.0.0` 不变，不以静态封签检查代替原生仿真验证。

现有资源操作应按用途分别接入：

| 接口 | 保存的内容与边界 |
| --- | --- |
| `POST /api/library/resources/select` | 选择固定版本参考记录，`applied_to_workspace:false`。 |
| `POST /api/types/{wid}/resources/bind` 及 `/resources/material-preview`、`/resources/material-confirm` | 绑定及确认材料或标准出处，不替换材料物性。 |
| `GET /api/types/{wid}/material-comparison` 与 `POST /api/types/{wid}/material-comparison/adopt` | 比较并按现有门禁逐项采用适用材料值，写入新工程修订和来源。 |
| `POST /api/design/workspaces/{wid}/section-template` | 应用既有的受限敷设模板。 |

普通 `component`、`assembly`、`study_template` 尚无通用的“应用到工程”接口，继续列为未完成；参考选择、来源绑定和材料值采用不能相互冒充。

## 公开样本对照

`GET /api/type-library/samples` 提供人民电缆和 Bahra 的原始来源及随附表声明；`/samples/{name}.xlsx` 或 `.csv?table=...` 下载可直接导入的结构表。

结构表导入方法 `1.1.0` 完整保留 Bahra 的 13 个规格、每规格 19 列。Rac90、电感、电容、1 s 导体/铅套短路电流、各敷设载流量、电压降和最小弯曲半径属于目录性能事实，标记 `usage: catalogue_result`；它们与原显示值、SI 值、文件 SHA-256、表行列、方法版本及 `reference` 可信档一起保存在型号版本的 `values`，可经规格详情和 JSON/XLSX 交换读取。性能事实的 `source.conditions` 保留系列原有条件，包括 60 Hz、90℃、1 s、敷设环境等；标签保留直埋/空气及品字/平排，电压降保留 V/(A km) 口径。不补猜未发表的接地、间距、金属套初终温或功率因数。

目录性能事实通过明确白名单排除出不完整结构的 `specification.values` 和完整结构构造器，原始来源仍保留在 `sources`；不会用已发表性能倒填材料、构造或计算工况，也不会据此消除缺项或批准型号。既存导入事实保留其原方法版本；随附 Bahra 列映射或系列参考声明的变化会改变发布种子身份，沿既有先备份再重建流程刷新种子，无需改写旧事实。

规格逐项来源中可展开目录性能的适用条件，直接显示保存的 `source.conditions`、单位及原目录说明。界面不补齐未发表条件，也不把共用条件视为所有性能项目均已具备独立计算输入。

`POST /api/type-library/catalogue-comparison/{name}` 返回 `schema: cablesim.catalogue-comparison/2`，不传请求体或传 `{}` 时只读取真实厂家数据，不构造假定结构、不调用载流量求解器。根层 `rows` 逐规格保留原表外径、重量、R20、载流量和来源；厂家结构或工况缺失时，计算值及偏差为 `null`，`missing_fields` 列明缺项。外径或电阻的输入读回标记为 `declared_input`，偏差仍为 `null`，不能用零偏差冒充独立验证。当前两份手册共 59 个规格均缺少独立载流量复现所需的厂家输入，根层 `summary.ampacity_compared` 与 `four_metric_passed` 都为 0。

旧版 Studio 回归保留为独立研究参考情景。响应的 `reference_scenario` 在执行前列明全部假设、单位、依据、方法版本、来源摘要及可信分档；`manufacturer_data` 为 `false`，`reference_calculation` 为 `null`。界面或 Agent 必须先展示完整声明，经操作者明确选择后，才可发送 `{"reference_scenario_confirmed":true}`。该字段只接受布尔值，不接受字符串或数字。执行后的结果只进入独立 `reference_calculation`，保存每个规格实际使用的结构和方法输入；根层厂家 `rows`、缺项、拒绝及通过计数不变。参考计算的差异不计入四项真实厂家数据验收，也不能自动作为型号发布依据。

全新发布种子的电缆厂示例复用原有电气及短路通道。即使规格书生成被其他真实缺项阻断，也保存能够得到的电气结果与短路缺项诊断，并保留普通运行的输入、输出、工件摘要和方法版本。没有故障持续时间或初末温度时，不生成短路容量；有保存的诊断运行不代表规格书齐全或产品已批准。

### 厂家公开计算指南

Bahra 的系列声明在 `reference.published_guidance` 保留同一份只读参考数据，样本对照响应根层也返回 `published_guidance`。无指南的样本返回 `null`。结构表下载的 13 个规格、19 列原值及工作簿保持不变；指南附在系列级声明中，经原有上传、预览、确认入库、`GET /series/{id}` 和 JSON/XLSX 交换流转，不另建材料或型号存储。

该块的身份为 `schema: cablesim.catalogue-published-guidance/1`、`id: bahra.mv-lead-sheathed.guidance`。转录方法为 `cablesim.catalogue-guidance-transcription` / `1.0.0`，可信档为 `reference`，`reviewed:false`、`usage:published_reference_only`。`source` 固定官方 PDF URL 和 SHA-256；原手册未声明版次时 `edition:null`，不猜年份。`content_sha256` 对发行中原始转录对象除自身外的完整内容按 UTF-8、`ensure_ascii=False`、`sort_keys=True`、紧凑 JSON 分隔符计算；它标识这份原件转录，浏览器对等值数字表示的正常化不另造资料版本。

| 内容 | 数据和适用范围 |
| --- | --- |
| `material_facts` | PDF 第 7 页的铜/铝导体 20℃ 电阻温度系数 0.00393/0.00403 K⁻¹，以及电容量指南中 PVC/XLPE 的相对介电常数 4.8/2.3。每项保存单位、用途、条件、原文值、页码和坐标；系数单位由原公式温差解释，注明不是原文独立印刷的单位。 |
| `baseline` | PDF 第 12 页：空气 40℃、土壤 35℃、埋深 0.8 m、土壤热阻率 1.2 K·m/W、单回路热隔离、负载率 100%。保留原百分数和显式换算后的无量纲值 1，以及标准尺寸可能不同于实际制造尺寸的说明。 |
| `correction_tables` | PDF 第 13 页直埋表 3/4/5，共 9/27/48 项离散参考因子；各项按原表适用范围保存芯数、截面边界、温度/深度/热阻率条件及对应原表坐标。表 3 不限定芯数或截面，表 4 的三芯栏不限定截面；表 5 截面档为 ≤50、>50 且 ≤185、≥240 mm²，不覆盖 185–240 mm² 之间的截面。 |

这些资料不自动进入 `common`、`common_basis`、`modelling`、型号计算参数或已有研究情景。电容量指南未说明介电常数用于载流量介质损耗时的温频条件，第 8 页只有含 tanδ 的公式、没有 tanδ 数值；相应缺项与计算拒绝保留。旧研究情景中的 εr=2.5、tanδ=0.004 继续作为明确确认后才运行的独立参考。三张修正表仅供查阅，既不插值也不外推，不作为 GB 50217 标准数据或新校正接口。

Agent 应展示每项的 `source`、`method`、`confidence`、`usage`、`conditions` 以及整个指南和表的 `limitations`。`baseline` 只是厂家参考表的前提，不补齐产品的接地、屏蔽层厚度等缺项，也不批准产品。界面在公开样本对照和已入库系列中展示同一指南，查阅不发起计算。

`published_guidance` 是受保留身份约束的内置原件转录块。导入预览、确认入库、交换预览/导入以及系列列表/详情读取须逐字段比对本机 canonical 内容；篡改数值、条件、用途、来源或方法后重新计算内外摘要仍返回 `422 / PUBLISHED_GUIDANCE_INVALID`。本机原件转录块缺失或摘要失效返回 `409 / PUBLISHED_GUIDANCE_UNAVAILABLE`。浏览器正常 JSON 数字序列化的 `1.0 → 1` 等值变化允许，布尔值不能代替数字。没有该块的旧包及其他普通用户参考声明继续兼容，不被提升为已核实的内置资料。读取旧库发现损坏资料时明确拒绝，保留原记录，不静默升级或重写声明。

### 220 kV 制造数据与固定限值

标准核对方法 `1.8.3` 继续通过原有要求依据接口消费封签的 GB/T 18890.2—2015 记录。三项共用范围为 127/220 kV、裸铜导体、XLPE，截面仅为表列 400、500、630、800、1000、1200、1400、1600、1800、2000、2200、2500 mm²；不插值或套用其他电压。制造输入沿 `engineering_inputs` 给出的稳定来源路径保存，形如 `/cable_types/{escaped_id}/common_layers/{role}/engineering/{field}`；层在线芯内时使用对应 `cores/{escaped_core_id}/layers/{role}` 路径。

| 字段 | 层与数据性质 | 单位及适用条件 |
| --- | --- | --- |
| `aluminium_sheath_purity` | `metallic_sheath` 的铝纯度实测质量分数 | SI `1`，显示 `%`、比例乘 100；须明确 `standard_kind=aluminium/aluminium_alloy` 且 `form=corrugated`，与封签的 99.5% 下限比较。 |
| `aluminium_strip_elongation` | `metallic_sheath` 的焊接铝带伸长率实测 | SI `1`，显示 `%`、比例乘 100；同皱纹铝/铝合金套条件，与封签的 16% 下限比较。 |
| `oversheath_semiconductor_ratio` | `oversheath` 的挤包半导电层实测厚度 / 外护套实测总厚度 | SI `1`，显示 `%`、比例乘 100；须有该外护套层、明确 `sheath_compound=ST2/ST7`，且下述构造声明为真，才与封签的 0.20 上限比较。 |
| `bonded_extruded_oversheath_layer` | `oversheath` 的制造构造声明 | 布尔值，单位 `1`；明确半导电层为挤包、与外护套牢固粘结且计入总厚度，不能由普通层厚或材料名称推断。 |

每项使用已有来源格式：`provenance[path].reference` 中保存 JSON `{schema:"cablesim.manufacturing-input/1",unit:"1",value:...,reference:"制造/测量记录的实际出处"}`，来源与原值进入 `engineering_sources`。纯度与伸长率的标准记录仍保留原 `%` 值，比较时显式换算为 SI 比例；三项制造数值及新增构造声明明确拒绝 `kind=standard` 的来源，标准值不能当制造输入。缺条件、实测或出处不比较，已知其他材料/构造保留未覆盖。三项通过仍不等于完整 GB/T 3880.1 材料符合性或 GB/T 18890.1 的例行、抽样、型式与预鉴定认证，原有完整符合性缺口继续显示。

## 两台机器之间的数据搬运

型号使用 `/api/type-library/exchange/export`（`{series_ids,format:json|xlsx}`）；材料与已保存工程输入使用 `/api/library/exchange/export`（`{asset_ids,workspace_ids,format}`）。每组接口都有 multipart `/preview` 和 `/import`：提交 `file`、预览的 `reviewed_sha256`、`confirmed:true`、`request_id` 及人工头。

Excel 含可读索引与完整传输内容，JSON 与 Excel 具有相同语义摘要。导入前验证原件、型号/资源/工程摘要和身份关系；任何同名系列或版本冲突整包拒绝。型号包携带当前版本与原始结构表；新机创建草稿并记录来源机的版本身份，不继承批准或运行历史。交换元数据采用固定字段白名单，不能指定本机对象、工作区、审核状态或运行身份；重新计算文件摘要也不能绕过此检查。尚未改版的设计修改须先建立新版本才能导出。完整历史、所有附件和运行备份继续使用 `scripts/workspace_db.py backup/restore`。

型号交换还逐项核对事实与原件：非空且不重复的字段、原显示值与 SI 换算、单位、方法版本、可信分档、文件摘要和原表单元格必须一致；系列共用值须对应原声明，逐值来源须与型号保留的来源集合一致。固定标准限值通过本机封签依据核验同一版次、条件和记录摘要；标准方法版本、数据摘要与发行摘要也须匹配本机已核验的发行。当前发布包不含历史方法发行归档，不同方法版本即使保留相同记录也明确拒绝，原资料保留，不改写成当前版本；恢复对应封签发行后才能重试。兼容历史结构表导入方法 `1.0.0` 与 `1.1.0`，改版后的工程结构可以保留不同于原表的设计值，原表事实继续作为历史证据保真保存。

工程输入交换中的候选型号同时保留完整原始 `CableModelVersion` 来源快照和研究实际使用的电缆/材料投影，并核验原始内容摘要。目标工程使用独立的 `exchange-model:` 快照身份，保存来源型号标识和来源状态作为证据，本机绑定状态为草稿；不会解析成目标机器上的同名或同标识候选，也不创建已批准型号。来源机器关闭后仍可导入、重启和再次导出，原有结构与材料锁保持生效。完整来源快照也计入每工程 120 KiB 的既有大小限制；超限需使用备份恢复。

新导出的来源证明 `cablesim.exchange-cable-source/2` 用 `source_reference_order` 完整且不重复地记录用于重现来源正文的来源键顺序，绑定来源说明必须等于这些完整 `reference` 的原文串联；一条来源内部的分号不能拆开重配。既有 `/1` 证明按完整声明及其重复次数进行有界精确匹配，复杂度超限明确拒绝，不猜测或改写原文；再次导出仅在导出副本补充顺序证明，保存的工程、原始型号摘要与来源正文均不改变。

系统参考型号须与本机真实目录的固定标识、名称、版本、来源、状态、完整内容和方法默认值一致，不能仅凭 `system.` 前缀及自行计算的摘要通过。旧版本无法核验或身份不一致时明确拒绝，不以当前版本替换原绑定；导入前也校验型号锁记录，损坏记录整包拒绝。候选来源库本身损坏时，导出返回可解释的校验错误。

已发布型号的引用还需要发行记录与冻结规格书的完整证明链，当前工程输入交换不覆盖，明确返回 `EXCHANGE_PUBLISHED_MODEL_PROOF`，不能以投影摘要代替发行摘要。此类工程以及需要完整运行、审批或附件历史的搬运应使用数据库备份恢复。
