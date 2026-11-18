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

明确声明的 `um_v` 同时保存在缺项候选规格和旧 Types 的 `rating.um`，完整三芯映射也保持该声明；未提供时保持未知。交换包中明确非空的 Um 必须与系列声明一致。旧候选没有此字段或保存为 `null` 时保留原有缺失，不从系列回填，不改写原候选摘要。历史 `1.0.0` / `1.1.0` 的“电缆近似重量”显示标签仍可随原事实原样搬运，不将旧事实改为新标签。发布种子修订为 20，通过既有身份检测、先备份再刷新流程采用上述保真语义。研究示例只移除未被保存对象引用的迁移材料，并逐项记录原生成器已有的教学设计声明；保留其余数值及原出处，声明保持未审核，不作为厂家或现场数据。

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

`tests/test_short_basis_browser_numbers.py` 使用 JavaScript `JSON.stringify` 生成实际请求正文，覆盖全部 30 条依据的保存、回读、再次保存、预检与运行；等值数字表示不改变原始标准记录身份，真实数值、单位、来源、版次及封签篡改仍须拒绝。

返回的 `request_sha256` 仍是原 Executor 整批请求的追溯标识，包含当次运行身份，不能由一条引用重新验证；消费方法核验的是封签内容及确定的发行回执，不将这个请求标识当成已重新认证的执行证明。既存运行快照不改写，只有新建或重新运行的研究选择当前方法。回归通过真实 JSON.parse/JSON.stringify、保存、回读、再次保存、预检和普通运行验证 30 条依据，并分别拒绝数值、单位、条件、来源和回执篡改。

## 标准、材料与环境值

### 封签查询与完整来源回执

`GET /api/library/resources/catalogue?category=materials|environment|manufacturing` 和 `/table?category=...&table_id=...` 读取真实封签数据插件。`POST /api/library/resources/select` 接受同一个 `Selection`：`{release_digest,data_sha256,standard,edition,locator,quantity,record_id,conditions}`。必须使用查询返回的固定身份，并明确填写原表要求的条件；区间谓词不能当作实际条件，范围值不能取中点。

选择响应保留完整 `record`、`conditions`、`trust`、`method`、`release_digest/data_sha256/request_sha256/artifact_sha256`，并另给显式 SI 换算后的 `quantity` 与 `quantity_status`。不支持的物理量或单位返回 `quantity:null`、`quantity_status:unsupported` 及原因，不能据此创建可采用的参考值。`record` 中原值、原单位、标准/文献及版次、表/条款、印刷页/PDF 页、原件和记录摘要、核验状态及限制保持原样。选择始终为 `approval:not_granted`、`applied_to_workspace:false`。

资料进入同一个 `AssetRepository`，材料使用 `AssetRelease.kind=material`，敷设环境使用 `kind=installation`。每个参数对应一项 `reference_evidence`：`{schema_version:"cablesim.resource-reference/1",parameter,quantity,selection,receipt,record_sha256}`。`receipt` 是上述完整选择响应，`quantity` 必须是 SI 且与资产参数一致，参数名不能重复；单项回执不超过 32 KiB，带回执的完整资源定义不超过 512 KiB。没有该字段的旧资源仍省略空字段序列化，保持原内容摘要。

新采用会向本机封签提供方重新查询，核对固定发行、数据、原记录、方法、SI 数值、可信分档和完整回执；自算一个一致的摘要不能证明资料可采用。`request_sha256` 是当次执行身份，不作为再次执行时应相等的数值证据。草稿预览与确认每次均实际查询，仅在其余回执内容完全相同时复用本服务此前发出的完整回执；进程重启或回执失效后须重新预览。历史来源读取保存的回执，不替换成当前数据发行。

基础 `Quantity` 支持 `mass_density/resistivity/volumetric_heat_capacity/dimensionless`，SI 单位分别为 `kg/m3`、`ohm.m`、`J/(m3.K)`、`1`；热阻率使用 `K.m/W`。原文 `kg/m³`、`Ω·m`、`J/(m³·K)`、`K·m/W` 等明确等值写法可以换算，原显示值与单位仍保留。绝对温度才允许 `°C/℃/degC → K`，不把温差当绝对温度。不同量纲、未知单位、布尔值或数字字符串均不能靠猜测转换。

`backend/foundation/contracts.py` 定义参考回执、冻结输入应用及其单位契约；依赖该文件的 `cablesim.native-reference` 已按依赖闭包重封签为发行 `1.0.9`，能力方法版本仍为 `1.0.0`。其计算算法未改变，封签校验不替代原生仿真验证。

### 资料草稿、人工确认与发布

以下接口均位于 `/api/library/resources` 下；两类草稿使用调用方预先确定的同一 `asset_id/version` 完成预览与确认，不接受客户端提供数值或自行拼接权威回执。

| 接口 | 请求与结果 |
| --- | --- |
| `POST /materials/draft-preview` | `{asset_id,version,name,selections:[{parameter,selection:Selection}]}`，1–5 个不重复物性。返回完整 `release/content_sha256/preview_digest`、`schema_version:cablesim.material-reference-draft/1`、`persisted:false`。 |
| `POST /environment/draft-preview` | `{asset_id,version,name,selections:[Selection]}`，1–3 个不重复目标字段。返回完整 `release/content_sha256/preview_digest` 和参考可信档。 |
| `POST /materials/draft`、`POST /environment/draft` | 原预览请求增加 `preview_digest` 和严格布尔值 `human_confirmed:true`，并要求 `X-CableSim-Actor: human`；服务端重新核对后返回 201 和普通资源草稿详情。 |

两种预览都不入库、不修改工程，Agent 可以请求。修改选择后必须重新预览；人工创建草稿须提交已核对预览的同一组输入，确认时内容不再匹配返回 409。来源可信档保持 `reference`，草稿不构成厂家实测、材料合格或工程批准。

T2 对含非空 `reference_evidence` 的资源只能查看和预览；以下四条既有 foundation 写接口均从实际请求头读取 `X-CableSim-Actor: human`，并要求请求体顶层的严格布尔值 `human_confirmed:true`。确认字段不属于 `AssetRelease`，不写入资源内容摘要；字符串 `"true"`、数字 `1` 均不能代替布尔值。

| 接口 | 请求体 | 人工门禁检查的资源 |
| --- | --- | --- |
| `POST /api/foundation/assets/import`（仓库层 `create`） | `{schema_version:"csp-asset/0.1",release,human_confirmed:true}`；`schema_version` 可省略，使用该默认值。 | 待创建的 `release`。 |
| `PUT /api/foundation/assets/{resource_id}` | `{expected_revision,release,human_confirmed:true}`。 | 同一修订锁内读取的原定义和提交的新定义，任一含回执即检查。 |
| `POST /api/foundation/assets/{resource_id}/transition` | `{expected_revision,content_sha256,action,note,acknowledge_sources,human_confirmed:true}`。 | 当前保存的定义；`review`、`publish`、`return_to_draft`、`deprecate` 均受检查。 |
| `POST /api/foundation/assets/{resource_id}/derive` | `{expected_revision,content_sha256,new_version,human_confirmed:true}`。 | 被派生的原定义；新版本保留原回执。 |

门禁同时位于 `AssetRepository.create/update/transition/derive`；材料与环境的 `/draft` 将实际请求头与确认值传入同一仓库层，不代填人工身份。含回执的请求缺少人工头、头值不是 `human`，或确认值缺失/为 `false`，在门禁处返回 403 `HUMAN_REFERENCE_ASSET_REQUIRED`；非布尔确认值由请求模型返回 422。编辑时删去或清空回执也不能绕过，因为原定义仍在检查范围。原、新定义均无回执的旧资产继续兼容原调用方式，可省略人工头和确认字段；不因此扩大为所有旧资产的新门禁。

这些确认不替代现有修订号比较、内容摘要和状态机约束。草稿仍依次 `review`、`publish`；`note` 须为 4–1000 字符，`review` 另须 `acknowledge_sources:true`，每一步使用返回的新修订号。资源发布仅允许后续引用，不自动绑定或采用任何参数。

### 材料逐属性采用与旧 Types 修订

材料目标仅支持 `density`、`volumetric_heat_capacity`、`electrical_resistivity_20`、`relative_permittivity`、`thermal_resistivity`。原记录的物理量必须与目标字段一致，不从热导率倒算热阻率，不从名称推断材料配方。

先通过 `GET /api/types/{wid}/resources` 获取目标与已发布资源，再使用原有 `POST /api/types/{wid}/resources/bind`，请求 `{request_id,expected_revision,role:"material",target_id:material_id,resource_id}`；也可走既有 `/resources/material-preview`、`/resources/material-confirm`。绑定只固定资源版本及输入身份。绑定发生变化会产生新修订；后续预览必须使用返回的当前工作空间修订号。

`POST /api/library/resources/materials/preview` 请求为 `{workspace_id,expected_revision,material_id,property,resource_id,content_sha256}`。响应给出 `schema_version:cablesim.material-reference-preview/1`、`revision/document_sha256`、固定 `resource`、完整 `evidence`、逐条件 `comparison`、`adoptable/reason`、限制及 `preview_digest`。用途、材料类别、电压、配方、交流条件和温度口径依据已保存的型号事实逐项核对；缺事实或条件不符时保留候选来源，`adoptable:false`。名称、勾选确认、来源绑定均不能补齐缺失事实。

`POST /api/library/resources/materials/adopt` 在同一预览请求上增加 `request_id`、`preview_digest`、`human_confirmed:true`、`acknowledge_reference_limits:true`；`operation` 固定为 `adopt_resource_material_value`，可使用服务端默认值。此写入要求人工头，并在原 `Types.adopt_material_value` 的事务内重新检查修订号、固定绑定、完整证据、预览和锁，再只改指定物性，返回旧 Types 的新工作空间快照。来源保存前值、前来源、固定资产身份及完整回执；既存修订和运行不改写。同一请求可幂等重试，过期输入或绑定返回 409。

`GET /api/types/{wid}/material-comparison?revision=n` 继续提供原有比较和历史读取。带 `reference_evidence` 的新资料必须经上述明确预览及采用接口，旧 `/material-comparison/adopt` 不能绕过这些门禁。

### 环境逐字段预览与已有批量计算

环境仅映射 `depth_m`、`soil_rho_k_m_w`、`ambient_temperature_c`。`POST /api/library/resources/environment/preview` 请求为 `{workspace_id,expected_revision,row,resources:[{resource_id,content_sha256,parameter}],conditions}`。`row` 使用前述完整 `RatingRow`，埋深、热阻率、温度、频率、接地和来源均须明确给出；排列、间距、排管等仍受旧契约约束。每个目标字段只能固定一个已发布资料版本。

预览返回 `workspace_id/expected_revision/workspace_sha256/case_id/before/proposed/conditions/changes/target_facts/preview_digest`、可信档及限制。每条 `changes` 包含前后值、SI 量、`resource_id/asset_ref/reference_evidence`；此时 `applied_to_workspace:false`。空气与地中资料不混用，地温资料的深度须与工况相符，温度须在 `conditions.temperature_basis` 中明确原表最高、最低或季节口径。

目标必须是独立型号，芯数与排列一致，且只有一个可明确定位的运行回路。预览核对型号已保存的交流频率及该字段来源；参考涉及电压时还核对实际系统电压及其来源，并另行检查型号额定电压范围。额定电压不代替实际系统电压，客户端填一个看似匹配的条件也不能覆盖已保存事实。多个匹配回路、所需系统事实或来源缺失、与当前域冲突均拒绝。

缺少真实运行条件时，使用既有 `PUT /api/types/{wid}/document` 保存 `{request_id,expected_revision,document}`，由旧 Types 执行修订号比较与写入（CAS）。研究假设须在完整文档及 `provenance` 中明确标为研究输入，系统频率/电压来源分别使用 `/circuits/{JSON Pointer 转义后的回路 id}/system/frequency`、`.../voltage` 路径；不能把结构查看的占位系统或额定值自动转换成工况。保存后重新读取规格与工作空间修订，再做环境预览。该步骤不由参考接口自动完成。

采用使用原 `POST /api/type-library/series/{id}/batch` 的 `operation:calculate`，在原批量请求上增加 `environment_references:[{...环境预览请求,preview_digest,human_confirmed:true}]`。每项 `(workspace_id,row.case_id)` 必须唯一且属于所选规格；批量 `rows` 必须与预览的 `proposed` 完全相同，仍需原有人工头、`expected_versions/expected_revisions`、完整方法参数和范围确认。服务端再次核对后，将完整采用回执存入普通 `BatchCase.metadata.environment_references`，并在相应计算输入字段保存资产来源；不修改厂家型号原始材料或结构。

运行行的可选 `environment_references` 仅从该历史 `BatchCase.metadata` 投影，保存 `human_confirmed:true`、`adopted_to:saved_rating_condition`、参考可信档及未批准状态。之后的资料派生、废止或发行变化不改写旧运行；没有采用记录的旧运行不新增空字段，旧批量请求身份也不因空引用列表变化。

真实正例采用 IEC 60287-3-1—2017 `Table 2` 的 `iec60287-3-1-table2/r2/thermal_resistivity`：原值 1.0 K·m/W，SI 为 1.0 `K.m/W`，印刷第 7 页/PDF 第 39 页，方法版本 `0.9.1`。原件摘要为 `618e8d8cd829a15cb0bdcf08af4d73afc0b8928a3ea0eeb42bdc75cc87b08f63`，记录摘要为 `bcb4c7549feaaaa00890740eb50af37d3fa15ec84f1c3986cd1d2a5b31f6afaa`。测试以人民三芯公开结构为基础，另经旧 Types 保存有出处的三相 50 Hz 研究工况，在明确 `national_reference:unavailable`、`soil_moisture:moist`、`weather_pattern:regular_rain` 的研究场景中，将热阻率 1.2 改为 1.0 后运行旧载流量方法。这些场景条件不是厂家属性，也不是现场勘测结果。

A.4 的 `laying_depth` 原始摘录可以浏览、创建参考草稿、发布和交换，但原文没有明确能映射到 `RatingRow.depth_m` 的中心测量基准。直埋和排管采用均返回 `ENVIRONMENT_DEPTH_REFERENCE_UNSUPPORTED`，用户补一个“中心”条件也不能替代来源证据。A.4 土壤热阻率 1–1.2 的区间不得取中点；1 m 深度的地温不能套到 0.7 m；110 kV 型号、缺系统电压或伪填低电压均不能绕过适用性检查。

实现与回归依据为 `backend/kernel/resource_data.py`、`material_references.py`、`environment_references.py`、旧 `type_versions.py` / `type_library_operations.py`，以及 `tests/test_material_references.py`、`tests/test_environment_references.py`。这些受限字段接口不表示完整材料库、标准全文或两套完整行业示例已验收。部件和研究输入另有下述严格限定的冻结输入应用合同；旧摘要及普通 `assembly` 不能推测成完整结构。既有受限敷设模板继续使用 `POST /api/design/workspaces/{wid}/section-template`。

### 冻结部件与研究输入：供界面及 Agent 共用的合同

一个资料版本仍是同一 `engineering_assets` 中的 `AssetRelease`。可选 `application` 使用 `cablesim.resource-application/1`，保存 `capture_version:1.0.0`、`kind:component|study_template`、完整固定 `method`、`source`、`payload` 与 `payload_sha256`。未携带此字段的旧资产不序列化空字段，原内容摘要不改变。不存在第二份部件库、研究库或算法实现。

冻结 `source` 保存 `workspace_id/revision/name/document_sha256`、完整当时保存状态 `snapshot` 及 `snapshot_sha256`。研究另外保存 `study_id/study_revision/run_id/input_digest/output_digest`。完整输入与逐项出处都在载荷中，不用来源名称替代结构，也不从当前源工程回读已改变的数值。完整应用载荷限 2 MiB，超限明确拒绝；不截断来源以通过限制。域输入采用原合同单位，长度 m、截面 m²、电阻 Ω/m 等；旧 `*_deg` 字段保留 °，不将角度数值当成弧度。空字段保留 `null`，不是零值或候选默认值。

下列 9 个接口共用 `/api/library/resources` 前缀。只读接口可以由 Agent 调用。所有写接口要求 `X-CableSim-Actor: human`、真正布尔值 `human_confirmed:true`；字符串或数字不能代替。采用还要求真正布尔值 `acknowledge_reference_limits:true`。`expected_revision` 与研究修订均是严格正整数。

| 方法及路径 | 请求与成功响应 |
| --- | --- |
| `POST /components/capture-preview` | `{asset_id,version,name,workspace_id,expected_revision,selection}`；返回冻结草稿 `release`、`content_sha256`、`preview_digest`、完整证据及 `persisted:false`，不入库。 |
| `POST /components/capture` | 上述请求加 `preview_digest,human_confirmed`；重新核对修订和预览后返回 `201 AssetDetail`，状态为草稿。 |
| `POST /study-templates/capture-preview` | `{asset_id,version,name,workspace_id,expected_revision,study_id,expected_study_revision,source_run_id}`；响应与部件预览一致。 |
| `POST /study-templates/capture` | 上述请求加 `preview_digest,human_confirmed`；返回 `201 AssetDetail` 草稿。 |
| `GET /applications/{resource_id}/evidence` | 返回完整冻结 `application`、`source/method/fields/missing/trust/limitations`、`resource/dependencies/issues`，`read_only:true`。不查询当前源文档来补证据。 |
| `POST /components/preview` | `{resource_id,content_sha256,workspace_id,expected_revision,target,target_material_id}`；返回指定目标槽位的 `before/proposed/changes/material_action/preview_digest` 与完整来源。 |
| `POST /components/adopt` | 上述请求加 `request_id,preview_digest,human_confirmed,acknowledge_reference_limits`，可显式声明 `operation:adopt_resource_component`；返回 `200 WorkspaceSnapshot`。只提交该部件及明确材料引用到原工作空间历史，可沿原撤销接口恢复。 |
| `POST /study-templates/preview` | `{resource_id,content_sha256,workspace_id,expected_revision,title,bindings}`；返回拟保存 `definition`、固定 `bindings`、真实方法 `preflight`、`source_run_status` 与 `preview_digest`。 |
| `POST /study-templates/adopt` | 上述请求加 `request_id,preview_digest,human_confirmed,acknowledge_reference_limits`，可显式声明 `operation:adopt_resource_study_template`；返回 `201 {study,workspace_id,revision,run_started:false,approval:not_granted}`。 |

`selection` 和 `target` 都是 `{cable_type_id,part,core_id,layer_index}`。`part` 为 `conductor/core_layer/common_layer`；导体须明确芯 ID，层号为空；芯层须明确芯 ID 和保存层号；公共层须明确层号，芯 ID 为空。相应 `selection` 同时出现在部件证据顶层及 `application.payload.selection`。层号只定位本次保存修订中的真实槽位，不按名称猜目标。类型来源与目标均须是独立单型号文档。目标部件类别必须相同；结构层还须具有相同用途、电压声明及完整内层几何，公共层包括完整线芯几何条件。

部件 `payload` 保存 `selection/component/material/context`。每个展示字段为 `{path,label,value,unit,source,source_path}`；额外 `group/field` 标记原域部件或材料字段。`source_path` 是原始显式出处匹配的稳定路径或旧索引路径。没有明确来源的非空工程字段拒绝捕获；材料物性缺项保持空。真实厂家 R20 上限可以原样作为输入参考携带，但必须保留 `r20_basis:manufacturer_limit` 和原出处，不能转成目标的实测或批准。实测 R20、口径不明的非空 R20、实测厚度/丝径/金属层纵向电阻、相应出厂数据或 `kind:measurement` 来源均拒绝作为部件复制。

部件采用预览逐字段返回 `{path,label,before,after,unit,source,previous_source,source_action}`；`source_action` 为 `replace|unchanged`。目标材料 ID 必须由操作者明确给出。不存在的 ID 创建完整冻结材料；已有 ID 仅在除标识与名称外的全部材料事实相同才返回 `material_action:reuse_identical`，共享材料数值和原来源保持不变。不同材料事实拒绝覆盖。采用写入完整所选部件，包括来源为空的可选字段，不能悄悄继承目标旧值；只更新所选槽位的来源，逐字段回执保留前值、原出处、目标出处、固定资源、捕获方法和未批准状态。原 `WorkspaceStore.commit`、锁、修订比较与撤销历史继续生效。

研究捕获当前只覆盖 `cablesim.iec60287:steady-rating` 的完整已保存 `domain` 输入、`single` 驱动、无模块/交叉核对/候选补全/验证配置的研究。必须选择同一工程、同一研究、当前文档修订和研究修订的真实成功运行，原输入/输出摘要须通过既有运行完整性核验；不能凭一个成功状态或外部运行 ID 建立本机捕获。完整研究定义的所有显式字段保留，缺 `driver/input_source` 等字段也拒绝，不通过模型默认值补全。

研究 `payload` 为 `{definition,bindings,parameter_schema}`。`method` 固定 `plugin_id/capability/version/release_digest/name/method_version`；参数数值与单位来自保存定义和该固定方法契约。完整来源和目标 Domain 中的每个保存数值也须有对应或明确父路径来源，测量记录可用其自身的明确来源；不能用参数的出处代替材料、几何、系统和敷设输入的出处。无来源数值返回 `RESOURCE_DOMAIN_SOURCE_MISSING` 及完整 `fields` 路径，须在原输入中明确声明并真实重算，捕获不自动补来源。`bindings` 是 `{cable_type_ids,circuit_ids,cable_ids}` 三个完整、有序且唯一的稳定 ID 数组。采用须逐项确认与来源及目标相同的 ID，目标完整型号、材料和回路事实也须一致；不根据名称或相似结构自动映射。环境仍使用目标当前保存输入并经同一 IEC 方法真实预检。缺项、方法/契约不匹配、锁冲突或目标不适用均返回可解释的 4xx；预检拒绝包含完整 `preflight`，不保存研究。

研究采用只调用原 `Research.save` 新建独立研究，保留来源的固定方法、参数和驱动，以及原 `input_sources`；新的 `/resource_application` 回执保留原链上的 `previous_application_source`。它不修改目标 Domain、工作空间修订、原研究或原结果，也不发起计算。需要计算时继续调用既有研究预检和运行接口，由操作者另行明确确认范围。本机有原运行时，采用核对其完整原身份及摘要并返回 `verified_local_run`；本机完全没有原运行记录时仅返回 `external_declared_run`。本机存在相同运行但身份/内容损坏时拒绝，不能降级成外部声明。

所有证据和预览统一声明 `trust.grade:reference`、`approval:not_granted`；发布资料、采用输入及真实求解都不能替代目标工程人工批准。两个采用接口复用旧 Types 请求回执：相同请求 ID 和相同正文可安全重试；复用 ID 改正文拒绝。CAS、完整资源摘要、依赖状态及预览摘要在写入事务中再次核对。研究摘要固定完整原/目标输入、方法、绑定和预检 readiness/case 状态，不含每次真实预检的执行 ID、耗时或缓存诊断；采用时仍重新执行全部真实预检。冻结 `type_resource_bindings` 的每个完整固定 pin 必须是外层 `release.dependencies` 的精确子集，允许额外显式依赖，剥离或换摘要在资产合同和读取边界拒绝。依赖图每条路径均比较 SHA，不能先经间接正确 pin 遍历、再借去重跳过直接错误 pin。普通资产导入、更新、审核、发布、废止与派生只要新旧定义任一含 `application`，同样要求人工确认，删除载荷不能绕过。

JSON/XLSX 继续用原 `/api/library/exchange/export|preview|import`，完整传输 `AssetRelease.application` 及原摘要。新机资料为草稿，不继承来源发布/审核；原运行只保留声明身份，不伪造本机运行或复制计算结果。需要同时带入目标工程时显式导出其保存输入，沿既有工程输入证明、锁和独立副本规则处理。受限捕获和采用的真实回归在 `tests/test_resource_applications.py`：全新发布 seed、华远公开结构及明确参考输入、城南固定 IEC 单次研究、三类部件原撤销、JSON/XLSX 跨库后真实重新计算、人工/CAS/摘要/依赖/来源拒绝。运行日志和浏览器截图作为 CI 产物保存，不写进仓库。

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

标准核对方法 `1.8.4`（插件发行 `1.8.5`）继续通过原有要求依据接口消费封签的 GB/T 18890.2—2015 记录。三项共用范围为 127/220 kV、裸铜导体、XLPE，截面仅为表列 400、500、630、800、1000、1200、1400、1600、1800、2000、2200、2500 mm²；不插值或套用其他电压。制造输入沿 `engineering_inputs` 给出的稳定来源路径保存，形如 `/cable_types/{escaped_id}/common_layers/{role}/engineering/{field}`；层在线芯内时使用对应 `cores/{escaped_core_id}/layers/{role}` 路径。

| 字段 | 层与数据性质 | 单位及适用条件 |
| --- | --- | --- |
| `aluminium_sheath_purity` | `metallic_sheath` 的铝纯度实测质量分数 | SI `1`，显示 `%`、比例乘 100；须明确 `standard_kind=aluminium/aluminium_alloy` 且 `form=corrugated`，与封签的 99.5% 下限比较。 |
| `aluminium_strip_elongation` | `metallic_sheath` 的焊接铝带伸长率实测 | SI `1`，显示 `%`、比例乘 100；同皱纹铝/铝合金套条件，与封签的 16% 下限比较。 |
| `oversheath_semiconductor_ratio` | `oversheath` 的挤包半导电层实测厚度 / 外护套实测总厚度 | SI `1`，显示 `%`、比例乘 100；须有该外护套层、明确 `sheath_compound=ST2/ST7`，且下述构造声明为真，才与封签的 0.20 上限比较。 |
| `bonded_extruded_oversheath_layer` | `oversheath` 的制造构造声明 | 布尔值，单位 `1`；明确半导电层为挤包、与外护套牢固粘结且计入总厚度，不能由普通层厚或材料名称推断。 |

每项使用已有来源格式：`provenance[path].reference` 中保存 JSON `{schema:"cablesim.manufacturing-input/1",unit:"1",value:...,reference:"制造/测量记录的实际出处"}`，来源与原值进入 `engineering_sources`。纯度与伸长率的标准记录仍保留原 `%` 值，比较时显式换算为 SI 比例；三项制造数值及新增构造声明明确拒绝 `kind=standard` 的来源，标准值不能当制造输入。缺条件、实测或出处不比较，已知其他材料/构造保留未覆盖。三项通过仍不等于完整 GB/T 3880.1 材料符合性或 GB/T 18890.1 的例行、抽样、型式与预鉴定认证，原有完整符合性缺口继续显示。

## 两台机器之间的数据搬运

型号使用 `/api/type-library/exchange/export`（`{series_ids,format:json|xlsx}`）；材料与已保存工程输入使用 `/api/library/exchange/export`（`{asset_ids,workspace_ids,format}`）。每组接口都有 multipart `/preview` 和 `/import`：提交 `file`、预览的 `reviewed_sha256`、`confirmed:true`、`request_id` 及人工头。

材料、`installation` 环境资料及带完整 `application` 的部件/研究输入都通过同一资源交换接口搬运。JSON/XLSX 保留完整 `AssetRelease.parameters/sources/reference_evidence/application`、固定身份及 `content_sha256`，不把回执缩成来源文字，也不替换原记录或条件。导入校验结构、摘要、参数和回执的一致性；新资源成为本机草稿，`approval_inherited:false`。同身份同内容的本机资源可复用并保留本机状态，同版本异内容整包拒绝。来源方发布状态只作为交换证据，不能批准本机资源或自动采用数值；新采用仍须在本机重新核对封签依据、固定版本及适用条件。环境运行的 `BatchCase.metadata` 和完整审批/运行历史不在此输入交换范围内，需要原样搬运时使用数据库备份恢复。

Excel 含可读索引与完整传输内容，JSON 与 Excel 具有相同语义摘要。导入前验证原件、型号/资源/工程摘要和身份关系；任何同名系列或版本冲突整包拒绝。型号包携带当前版本与原始结构表；新机创建草稿并记录来源机的版本身份，不继承批准或运行历史。交换元数据采用固定字段白名单，不能指定本机对象、工作区、审核状态或运行身份；重新计算文件摘要也不能绕过此检查。尚未改版的设计修改须先建立新版本才能导出。完整历史、所有附件和运行备份继续使用 `scripts/workspace_db.py backup/restore`。

型号交换还逐项核对事实与原件：非空且不重复的字段、原显示值与 SI 换算、单位、方法版本、可信分档、文件摘要和原表单元格必须一致；系列共用值须对应原声明，逐值来源须与型号保留的来源集合一致。固定标准限值通过本机封签依据核验同一版次、条件和记录摘要；标准方法版本、数据摘要与发行摘要也须匹配本机已核验的发行。当前发布包不含历史方法发行归档，不同方法版本即使保留相同记录也明确拒绝，原资料保留，不改写成当前版本；恢复对应封签发行后才能重试。兼容历史结构表导入方法 `1.0.0` 与 `1.1.0`，改版后的工程结构可以保留不同于原表的设计值，原表事实继续作为历史证据保真保存。

工程输入交换中的候选型号同时保留完整原始 `CableModelVersion` 来源快照和研究实际使用的电缆/材料投影，并核验原始内容摘要。目标工程使用独立的 `exchange-model:` 快照身份，保存来源型号标识和来源状态作为证据，本机绑定状态为草稿；不会解析成目标机器上的同名或同标识候选，也不创建已批准型号。来源机器关闭后仍可导入、重启和再次导出，原有结构与材料锁保持生效。`/api/library/exchange` 每工程输入限 1 MiB、4096 条锁，包含完整来源快照、逐项出处与锁记录；整包仍限 8 MiB、100 个资料版本及 20 个工程。发布示例保留完整来源快照与锁记录；城北示例的 644 条真实型号锁超过早期工程交换入口的 500 条上限。交换接口保留完整输入，不截断来源或锁以迁就旧限制。单工程超限或需要完整历史时使用备份恢复；其他旧单对象接口的大小合同不变。

新导出的来源证明 `cablesim.exchange-cable-source/2` 用 `source_reference_order` 完整且不重复地记录用于重现来源正文的来源键顺序，绑定来源说明必须等于这些完整 `reference` 的原文串联；一条来源内部的分号不能拆开重配。既有 `/1` 证明按完整声明及其重复次数进行有界精确匹配，复杂度超限明确拒绝，不猜测或改写原文；再次导出仅在导出副本补充顺序证明，保存的工程、原始型号摘要与来源正文均不改变。

系统参考型号须与本机真实目录的固定标识、名称、版本、来源、状态、完整内容和方法默认值一致，不能仅凭 `system.` 前缀及自行计算的摘要通过。旧版本无法核验或身份不一致时明确拒绝，不以当前版本替换原绑定；导入前也校验型号锁记录，损坏记录整包拒绝。候选来源库本身损坏时，导出返回可解释的校验错误。

已发布型号的引用还需要发行记录与冻结规格书的完整证明链，当前工程输入交换不覆盖，明确返回 `EXCHANGE_PUBLISHED_MODEL_PROOF`，不能以投影摘要代替发行摘要。此类工程以及需要完整运行、审批或附件历史的搬运应使用数据库备份恢复。

## 数据与交换能力边界

| 范围 | 能力与限制 |
| --- | --- |
| 公开样本偏差对照 | 随附人民电缆 46 个、Bahra 13 个规格保留原件数值、单位、出处、逐项偏差和缺项。原件不足以独立复现某项性能时，该项不比较，不以读回声明值的零偏差替代计算验证。明确确认后的研究参考计算与真实厂家数据比较分别保存，不计入真实厂家四项通过数。 |
| FEM 原始证据 | 主范围与城南附加范围依据各自封签索引校验原始证据包。缺少所需原包时只保存研究输入并等待真实超算结果；文件损坏或摘要不符时拒绝导入。摘要、截图及已有结果文字不能替代原包。 |
| 标准与制造条款 | 覆盖范围以封签插件规则清单中列明的标准版次、结构、条件及条款为准。已支持的制造声明和实测输入必须保留其真实来源，标准限值不能作为厂家实测值。未实现的条款、缺失条件以及完整型式或预鉴定认证仍不在覆盖范围内，单项通过不代表完整产品符合性。 |
| 工程输入交换 | `/api/library/exchange` 每工程最多 1 MiB、4096 条锁，整包最多 8 MiB、100 个资料版本及 20 个工程。完整来源快照、逐项出处与锁记录均计入限制，超限明确拒绝，不截断证明。含已发布 Types 型号引用的工程需要发行记录与冻结规格书完整证明链，当前输入交换返回 `EXCHANGE_PUBLISHED_MODEL_PROOF`；这类工程及完整运行、审批、附件历史使用数据库备份恢复。 |
| 型号库与宿主存储 | 本型号库通过已有 `domain_cable_models`、Types、普通 Study/Run 及本文列出的 API 保存和操作数据。仓库中的 Studio 独立宿主仍使用自己的 `library.sqlite`，与此服务之间没有自动迁移或同步合同，不能将其独立状态视为本型号库状态。 |
