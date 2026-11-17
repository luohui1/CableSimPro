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

每个原始数值都有 SI 值和原表显示值、文件摘要、表名、行列、方法名/版本和可信分档。旧版 XLS 先检查原始 BIFF 记录，含公式时拒绝并指出原表单元格，不把缓存结果视为原始数字；无法保留原始记录的更早格式要求另存 XLSX。文本数字中的逗号可能表示小数点或千分位，没有明确地区格式声明时拒绝猜测。

1 至 16 芯缺项资料可保存为现有型号草稿，2 芯、5 芯等多芯记录不猜坐标、层厚、导体直径或温限；不完整型号不能计算。完整型号也只是工程草稿，来源确认与产品审核是不同的动作。已被系列、型号设计、资料提案或研究引用的原始型号不能删除，避免破坏来源和历史版本。

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

## 标准、材料与环境值

`GET /api/library/resources/catalogue?category=materials|environment|manufacturing` 和 `/table?category=...&table_id=...` 读取真实封签数据插件。`POST /api/library/resources/select` 要求固定 `release_digest/data_sha256/standard/edition/locator/quantity/record_id/conditions`，返回数值、适用条件、出处和可信分档。选择记录不直接修改工程，也不代表批准。

## 公开样本对照

`GET /api/type-library/samples` 提供人民电缆和 Bahra 的原始来源及随附表声明；`/samples/{name}.xlsx` 或 `.csv?table=...` 下载可直接导入的结构表。

结构表导入方法 `1.1.0` 完整保留 Bahra 的 13 个规格、每规格 19 列。Rac90、电感、电容、1 s 导体/铅套短路电流、各敷设载流量、电压降和最小弯曲半径属于目录性能事实，标记 `usage: catalogue_result`；它们与原显示值、SI 值、文件 SHA-256、表行列、方法版本及 `reference` 可信档一起保存在型号版本的 `values`，可经规格详情和 JSON/XLSX 交换读取。性能事实的 `source.conditions` 保留系列原有条件，包括 60 Hz、90℃、1 s、敷设环境等；标签保留直埋/空气及品字/平排，电压降保留 V/(A km) 口径。不补猜未发表的接地、间距、金属套初终温或功率因数。

目录性能事实通过明确白名单排除出不完整结构的 `specification.values` 和完整结构构造器，原始来源仍保留在 `sources`；不会用已发表性能倒填材料、构造或计算工况，也不会据此消除缺项或批准型号。原 JSON、下载结构表及摘要保持不变。既存导入事实保留其原方法版本；随附 Bahra 列映射的摘要变化会改变发布种子身份，沿既有先备份再重建流程刷新种子，无需改写旧事实。

规格逐项来源中可展开目录性能的适用条件，直接显示保存的 `source.conditions`、单位及原目录说明。界面不补齐未发表条件，也不把共用条件视为所有性能项目均已具备独立计算输入。

`POST /api/type-library/catalogue-comparison/{name}` 返回 `schema: cablesim.catalogue-comparison/2`，不传请求体或传 `{}` 时只读取真实厂家数据，不构造假定结构、不调用载流量求解器。根层 `rows` 逐规格保留原表外径、重量、R20、载流量和来源；厂家结构或工况缺失时，计算值及偏差为 `null`，`missing_fields` 列明缺项。外径或电阻的输入读回标记为 `declared_input`，偏差仍为 `null`，不能用零偏差冒充独立验证。当前两份手册共 59 个规格均缺少独立载流量复现所需的厂家输入，根层 `summary.ampacity_compared` 与 `four_metric_passed` 都为 0。

旧版 Studio 回归保留为独立研究参考情景。响应的 `reference_scenario` 在执行前列明全部假设、单位、依据、方法版本、来源摘要及可信分档；`manufacturer_data` 为 `false`，`reference_calculation` 为 `null`。界面或 Agent 必须先展示完整声明，经操作者明确选择后，才可发送 `{"reference_scenario_confirmed":true}`。该字段只接受布尔值，不接受字符串或数字。执行后的结果只进入独立 `reference_calculation`，保存每个规格实际使用的结构和方法输入；根层厂家 `rows`、缺项、拒绝及通过计数不变。参考计算的差异不计入四项真实厂家数据验收，也不能自动作为型号发布依据。

全新发布种子的电缆厂示例复用原有电气及短路通道。即使规格书生成被其他真实缺项阻断，也保存能够得到的电气结果与短路缺项诊断，并保留普通运行的输入、输出、工件摘要和方法版本。没有故障持续时间或初末温度时，不生成短路容量；有保存的诊断运行不代表规格书齐全或产品已批准。

## 两台机器之间的数据搬运

型号使用 `/api/type-library/exchange/export`（`{series_ids,format:json|xlsx}`）；材料与已保存工程输入使用 `/api/library/exchange/export`（`{asset_ids,workspace_ids,format}`）。每组接口都有 multipart `/preview` 和 `/import`：提交 `file`、预览的 `reviewed_sha256`、`confirmed:true`、`request_id` 及人工头。

Excel 含可读索引与完整传输内容，JSON 与 Excel 具有相同语义摘要。导入前验证原件、型号/资源/工程摘要和身份关系；任何同名系列或版本冲突整包拒绝。型号包携带当前版本与原始结构表；新机创建草稿并记录来源机的版本身份，不继承批准或运行历史。交换元数据采用固定字段白名单，不能指定本机对象、工作区、审核状态或运行身份；重新计算文件摘要也不能绕过此检查。尚未改版的设计修改须先建立新版本才能导出。完整历史、所有附件和运行备份继续使用 `scripts/workspace_db.py backup/restore`。

型号交换还逐项核对事实与原件：非空且不重复的字段、原显示值与 SI 换算、单位、方法版本、可信分档、文件摘要和原表单元格必须一致；系列共用值须对应原声明，逐值来源须与型号保留的来源集合一致。固定标准限值通过本机封签依据核验同一版次、条件和记录摘要；标准方法版本、数据摘要与发行摘要也须匹配本机已核验的发行。当前发布包不含历史方法发行归档，不同方法版本即使保留相同记录也明确拒绝，原资料保留，不改写成当前版本；恢复对应封签发行后才能重试。兼容历史结构表导入方法 `1.0.0` 与 `1.1.0`，改版后的工程结构可以保留不同于原表的设计值，原表事实继续作为历史证据保真保存。

工程输入交换中的候选型号同时保留完整原始 `CableModelVersion` 来源快照和研究实际使用的电缆/材料投影，并核验原始内容摘要。目标工程使用独立的 `exchange-model:` 快照身份，保存来源型号标识和来源状态作为证据，本机绑定状态为草稿；不会解析成目标机器上的同名或同标识候选，也不创建已批准型号。来源机器关闭后仍可导入、重启和再次导出，原有结构与材料锁保持生效。完整来源快照也计入每工程 120 KiB 的既有大小限制；超限需使用备份恢复。

系统参考型号须与本机真实目录的固定标识、名称、版本、来源、状态、完整内容和方法默认值一致，不能仅凭 `system.` 前缀及自行计算的摘要通过。旧版本无法核验或身份不一致时明确拒绝，不以当前版本替换原绑定；导入前也校验型号锁记录，损坏记录整包拒绝。候选来源库本身损坏时，导出返回可解释的校验错误。

已发布型号的引用还需要发行记录与冻结规格书的完整证明链，当前工程输入交换不覆盖，明确返回 `EXCHANGE_PUBLISHED_MODEL_PROOF`，不能以投影摘要代替发行摘要。此类工程以及需要完整运行、审批或附件历史的搬运应使用数据库备份恢复。
