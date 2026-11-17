# 系列、结构表和数据交换接口

型号库复用 `domain_cable_models`、`Types` 工作空间、型号方案/审核/发布表及普通 `Study`/`Run`。系列表只保存成员关系、原始结构表、固定预览和版本引用，不另存计算结果。发布与批准仍通过原有型号门禁。界面入口为 `/resources/cables/structure-import`。

## 结构表导入

1. `POST /api/type-library/imports/upload`：multipart `file`，支持 XLSX、CSV 和旧 XLS。返回 `upload_id`、原件 SHA-256、工作表、表头与建议列映射。仅完全匹配随附样本内容摘要时提供样本声明。
2. `GET /api/type-library/vocabulary`：字段单位、建模参数及其参考出处；参考值必须由操作者明确选用。
3. `GET/POST /api/type-library/mappings`：保存和复用 `{name,mapping,headers}`。列索引从 0 开始，不允许两字段映射同一列。
4. `POST /api/type-library/imports/preview`：`{upload_id,sheet,first_data_row,mapping,series}`，起始行从 1 开始。返回固定的 `preview_id` / `preview_digest`、每行数值、错误单元格、缺项、来源与结构闭合说明。公式不求值，不使用缓存值。
5. `POST /api/type-library/imports/commit`：`{preview_id,preview_digest,request_id,human_confirmed:true,skip_errors:false}`，要求 `X-CableSim-Actor: human`。预览、原件或请求摘要不一致会拒绝；存在错误行默认整批拒绝。只有明确选择 `skip_errors:true` 才跳过已显示的错误行。

`series` 声明包括名称、厂家、原样本型号、芯数、U0/U/Um（V）、执行标准的明确版本、系列共用值及逐项出处，以及显式建模参数。不能从型号名称唯一识别材料时须填写材料声明。GB/T 3956 标准电阻上限必须单独选择 `resistance_basis: standard_limit`，保留完整标准记录，不标作厂家实测。

每个原始数值都有 SI 值和原表显示值、文件摘要、表名、行列、方法名/版本和可信分档。缺项可保存为不完整资料；不生成虚构层厚、材料参数或载流量。完整型号只是工程草稿，来源确认与产品审核是不同的动作。

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

Agent 可以上传原件、提出映射、请求预览和展示结果；不能把人工头或确认字段作为自动批准手段。T2 的 Studio 宿主接入此组接口后应删除原先型号 JSON 存储；这组接口不访问 Studio 的用户数据目录。

## 标准、材料与环境值

`GET /api/library/resources/catalogue?category=materials|environment|manufacturing` 和 `/table?category=...&table_id=...` 读取真实封签数据插件。`POST /api/library/resources/select` 要求固定 `release_digest/data_sha256/standard/edition/locator/quantity/record_id/conditions`，返回数值、适用条件、出处和可信分档。选择记录不直接修改工程，也不代表批准。

## 公开样本对照

`GET /api/type-library/samples` 提供人民电缆和 Bahra 的原始来源及随附表声明；`/samples/{name}.xlsx` 或 `.csv?table=...` 下载可直接导入的结构表。`POST /api/type-library/catalogue-comparison/{name}` 重新调用真实方法，逐规格返回外径、重量、R20、载流量及偏差原因。表列读回标记为 `declared_input`，不能当作独立计算验证；未公开或方法不能算的值不会填零。载流量对照使用报告列明的样本条件和明确建模假设，不能自动作为工程发布依据。

## 两台机器之间的数据搬运

型号使用 `/api/type-library/exchange/export`（`{series_ids,format:json|xlsx}`）；材料与已保存工程输入使用 `/api/library/exchange/export`（`{asset_ids,workspace_ids,format}`）。每组接口都有 multipart `/preview` 和 `/import`：提交 `file`、预览的 `reviewed_sha256`、`confirmed:true`、`request_id` 及人工头。

Excel 含可读索引与完整传输内容，JSON 与 Excel 具有相同语义摘要。导入前验证原件、型号/资源/工程摘要和身份关系；任何同名系列或版本冲突整包拒绝。型号包携带当前版本与原始结构表；新机创建草稿并记录来源机的版本身份，不继承批准或运行历史。尚未改版的设计修改须先建立新版本才能导出。完整历史、所有附件和运行备份继续使用 `scripts/workspace_db.py backup/restore`。
