# 正式宿主输入与交付接口

正式后端 `backend.main:create_app` 发布全部接口和 OpenAPI；输入契约、几何预览和计算书服务均由 kernel 提供。正式界面位于 `frontend/`，从 `/openapi.json` 生成类型，插件参数模式从 `/api/input-contracts` 获取，不在页面补猜字段。

## 地址映射与兼容

| 原样板地址 | 正式地址 | 行为 |
| --- | --- | --- |
| POST `/api/design/workspaces/{wid}/geometry-preview` | POST `/api/workspaces/{wid}/geometry-preview` | 固定 revision、完整 SI 领域文档和 Method；生成预览，不保存输入 |
| GET `/api/design/input-contracts` | GET `/api/input-contracts` | 已验证发行对应的输入和参数 JSON Schema |
| GET `/api/design/examples/iec` | GET `/api/examples/iec` | 公开合成输入、来源文件及 SHA256；不是标准公开参考值 |
| GET `/api/design/examples/cable` | GET `/api/examples/cable` | 带来源的领域结构示例，保留 scenario 兼容字段；不作工程结果 |
| GET `/api/design/workspaces/{wid}/deliveries/{did}/file` | GET `/api/workspaces/{wid}/deliveries/{did}/file` | 校验归属与摘要后下载保存的 HTML；不重新计算 |
| POST `/api/design/workspaces/{wid}/deliveries` | POST `/api/workspaces/{wid}/deliveries/current` | 只纳入当前有效运行；可传 request_id 避免重复交付 |

旧地址为同一处理函数的兼容别名，在 OpenAPI 标为 deprecated。本轮不删除；待前端 §11 迁移验收完成且调用方切换后，再安排移除，未指定固定失效日期。其请求和响应结构保持兼容，增加字段说明和可选 request_id；预览 `reuse_from` 明确为 SHA256 缓存提示。全量相同输入/版本/参数的重复预览共用成功缓存，失败不缓存。

既有 POST `/api/workspaces/{wid}/deliveries` 保留指定历史运行的存档交付语义，不能用它替代客户计算书的 `/deliveries/current`。单源研究计算书接受一个运行；型号规格书兼容一个几何加一个载流量表运行。下载历史保存文件仍可进行，但不能借此生成新的当前结论。`X-Artifact-SHA256` 是交付记录（renderer/sources/html）的规范摘要，不是 HTML 文件字节摘要。

## 模型与错误

预览使用 `GeometryPreview` / `GeometryPreviewResult`，方法四项身份必填，revision ≥1；领域长度 m、温度 K、RMS 电流 A。响应保留 CAD 模型/场景工件、输入 SHA256、请求 SHA256、基准 revision、实际环境、警告和 ms 计时。CAD 结果为预览，不进入研究 Run 或改变工程修订。方法版本变化、参数错误、进程超时/崩溃/环境缺失拒绝返回替代几何。

新接口的业务错误采用 `detail: {code,message}`；字段校验沿用 `detail: [{loc,msg,type}]`，停止在具体字段。稳定代码包括 `WORKSPACE_REVISION_CONFLICT`、`DOMAIN_INPUT_REQUIRED`、`GEOMETRY_CAPABILITY_REQUIRED`、`DELIVERY_SOURCE_COMBINATION_INVALID`、`RESOURCE_NOT_FOUND`、`INPUT_OR_RESULT_CONFLICT`、`INPUT_OR_SCOPE_INVALID`，以及执行器的 `WORKER_TIMEOUT`、`WORKER_EXIT_FAILED` 等实际代码。输入契约封签失败直接返回执行器原码。普通输入422不产生计算副作用；明确更新版本后再预检的重算流程见下节。运行接口采用 request_id 幂等，交付可使用同样模式。

研究响应 `StudyResponse`、`PreflightResponse`、`RunResponse`、`RunPage` 明确公开身份、修订、生命周期、完整性、当前性和工件状态；插件扩展正文用 JSON 值映射保留声明类型，具体物理字段由工件 schema 定义，不手写每个插件的平行 DTO。

### 列表投影与输入契约缓存

`GET /api/workspaces/{wid}/studies/{sid}/runs?view=summary` 返回 `RunSummaryPage`，保持既有 `after/limit/next_cursor` 分页。每项包含 `id/workspace/study/sequence/status/created/finished/freshness/integrity/version_status`、`snapshot.module`、保存的方法四项身份 `method`、至多512字符的运行级 `error.code/message`及至多三个`headlines`；没有`output`、完整快照或网格。`headlines`从同工况已校验见证工件投影，含SI值、显示值与单位、实体、工况和来源摘要，不填默认数值。single沿用能力声明；selection只取与选型结论一致的推荐候选和工况，没有推荐则为空；sweep/batch/crosscheck返回空，不跨样本聚合。前端可对single和selection显示研究答案。运行列表省略view或传view=full仍保持完整RunPage。

`GET .../runs/{rid}`默认`view=detail`，完整校验保存的snapshot/output后，省略`snapshot.cases[*].input`，改为`input_ref{url,sha256}`并标记`snapshot_view=inputs-on-demand`。返回的input_digest始终是原完整快照摘要，不是裁剪投影的摘要；数据库原件、报告、比较、历史回放及内部Research.get_run保持完整语义。`view=full`返回原完整RunResponse，不增加投影字段。非法view返回422。

`GET .../runs/{rid}/cases/{case_id}/input`按固定快照工况读取原输入，返回`run_id/case_id/input/input_digest/run_input_digest/integrity=verified`；case的input_digest与input_ref.sha256相同。归属错误或没有工况为404，原快照或输出完整性失败为409；不拿当前领域文档替代历史输入。详情和按工况输入复用现有已验证响应缓存，数据库提交、源码/封签变化仍使缓存失效；这是读取投影，不是运行数据迁移。

研究列表及单个研究新增只读 `workspace_revision`、`model_reference{id,name,version,content_sha256}`。引用身份来自当前保存的 `study_cable_reference` 或 `type_origin_reference`，没有版本绑定时可显示本地域文档首个电缆的真实ID和标签，此时version/digest为空；独立 `input_source=study` 返回null，不冒用工程型号。前端可直接显示这些字段，减少为一个型号名称请求完整工程快照。研究读取不再为取得 `version_status` 调用完整运行/工件展示校验。

完整性投影最多保留64条进程内记录。缓存身份包含工程/运行ID、已声明输入与输出摘要，以及重建时从数据库读取的snapshot/output/error原始字节SHA256；输入摘要绑定保存的插件发行封签。首次读取内容需解析并验证规范摘要，摘要没改而正文被篡改也会失效。这里只缓存不可变证据的校验和小型投影；重建响应时重新检查当前工程/研究修订、安装方法封签及已发布型号版本。新运行、正文或摘要变化、进程重启、LRU淘汰均须重建；损坏返回 `corrupt/unknown`，不沿用旧的“有效”状态。读取不回写旧运行。

输入契约目录按完整方法发行身份（包含同版本号的release_digest）及宿主契约源文件内容摘要缓存，最多保留4份；已校验的响应JSON可直接复用。同一请求中的能力共享一次目录和封签检查、一次领域Schema生成；文件读取最多4个线程，读取任务完成后才返回，宿主关闭时收回线程池。Windows只读核验通过原生目录变更通知复用已校验内容，监控backend、cablesim_sdk及plugins的新增、删除、改写和目录替换，忽略不进入封签的pyc/__pycache__；不依赖mtime或TTL。通知不可用、失败或溢出时停用响应缓存并重新读取实际字节验证，其他平台也采用逐次内容核验。插件新增、删除、封签或契约源变化、重启/淘汰导致重建；未封签源码改动和损坏清单返回409，不返回旧缓存。真正执行插件前仍独立重验实际字节，不能借用先前只读请求的验证结果。

研究列表、详情、运行摘要及输入契约另有已验证JSON响应缓存，最多64条、总计8MiB。条目保留上述实际输入/输出摘要与方法发行身份，查找还要求路由参数、数据库提交代次和来源通知代次相同。数据库代次来自同一持久只读SQLite连接的PRAGMA data_version；任何其他连接的提交都使研究响应失效，包含工程、研究、运行正文及型号发布变更。输入契约不依赖数据库。生成前后代次不同的响应只服务当前请求，不进入缓存；全量运行列表不走该缓存。宿主关闭时取消并等待目录通知I/O，再释放缓冲区、句柄与数据库连接。

启动完成数据库初始化后，对至多64个现有研究预热列表、详情及首50条运行摘要；只读取和验证已保存证据，不运行计算方法。超过此数量不预热，首次请求承担完整性核验；输入契约始终按需首次构建。预热增加的启动时间单独报告，不计入请求热缓存耗时。

回归见 `tests/test_read_projections.py`、`tests/test_live_seal_errors.py`、`tests/test_verified_executor.py`，覆盖默认兼容、摘要分页/字段、型号显示身份、原始正文篡改、封签变化与恢复mtime后的源码变化。

## 交付目录与研究撤销

`GET /api/workspaces/{wid}/deliveries` 返回 `DeliverySummary[]`，最新在前；空工程返回空数组。字段为 `id/workspace/kind/version/renderer/created/sources/digest/download_url/media_type`。`kind` 为 calculation 或 specification，`version` 为工程内从1开始的生成序号；`renderer` 单独保存渲染器版本，时间为UTC，`sources` 包含源运行ID及输入/输出SHA256。目录只列已封存计算书/规格书HTML，不把尚未封存的规格书预览当成交付。查询和下载均校验归属与摘要，损坏记录返回409，历史文件不会重算。

`POST /api/workspaces/{wid}/studies/{sid}/undo` 与 `/redo` 接受 `StudyHistoryRequest{expected_revision,expected_study_revision,request_id}`，返回完整 `StudyResponse`。两项修订均须匹配；研究冲突为409 `STUDY_REVISION_CONFLICT`，历史边界为 `STUDY_HISTORY_BOUNDARY`，同请求不同正文为 `REQUEST_CONFLICT`。同请求重试返回原操作结果。每次恢复产生新的递增研究revision，`can_undo/can_redo` 明确按钮状态；保存新编辑截断重做分支，但保留全部不可变 `study_versions` 与旧运行。此历史与型号结构/工程撤销分开，不改变工作区revision、领域结构或已保存结果。旧研究启动时将既有版本迁入历史指针，重新开库不会重置指针。测试：`tests/test_study_history.py`。

仿真复现输入的精确契约为 `GET /api/simulation/problem-contract`，详见[仿真研究](simulation-research.md)。这些接口没有样板兼容别名，也未删除旧地址。

## 版本过期与明确重算

`GET /api/workspaces/{wid}/studies`及新增`GET /api/workspaces/{wid}/studies/{sid}`返回`latest_run_id`和`version_status`。`GET .../runs`及`GET .../runs/{rid}`在每条运行上返回同一结构。运行`status`仍表示执行状态；`freshness`保留current/historical/unknown兼容语义，版本过期也归historical；前端用`version_status.status == stale`显示“结果已过期 · 重算”。没有运行的研究为empty，不把失败或加载中改成过期。

```json
{"status":"stale","display_name":"基于旧版本方法 0.9.0（cablesim.iec60287）；当前安装版本 0.9.1","reasons":[{"kind":"method","code":"METHOD_VERSION_CHANGED","id":"cablesim.iec60287","from_version":"0.9.0","to_version":"0.9.1","from_digest":"旧发行SHA256","to_digest":"当前发行SHA256","message":"基于旧版本方法 0.9.0（cablesim.iec60287）；当前安装版本 0.9.1"}]}
```

比较主方法、对照方法及候选工程补全方法的精确版本和发行摘要；同号不同摘要也过期。型号按稳定系统ID或已发布型号family比较，不以名称、截面或草稿创建时间猜版本；只取最新published发布序号，未批准草稿不使当前型号过期。独立`input_source=study`输入不冒用工作区型号绑定；`input_source=domain`检查`study_cable_reference`或独立草稿的`type_origin_reference`。这些状态在读取时计算，不写进旧运行输入/输出摘要。

新增`POST /api/workspaces/{wid}/studies/{sid}/recalculate`，请求模型`RecalculateStudy`：

```json
{"expected_revision":4,"expected_study_revision":2,"request_id":"UUID","module":null,"scope_acknowledged":true}
```

一次明确操作采用当前安装方法、更新已绑定的系统/已发布型号、保存新的研究修订，然后走原预检和执行链。`module`指定已有模块，null选择主配置；其他模块不改。保存的参数、工况、负荷、敷设与手动锁保留，未要求改变的载流量口径也保留；新版预检不通过就返回422及字段定位，不生成假运行。独立编辑的型号草稿不自动覆盖，基准过期返回409 `MODEL_REBASE_REQUIRED`，工程师先合并型号变更；芯数结构改变返回409 `MODEL_LAYOUT_CHANGE_REQUIRED`。

返回`RunResponse`，本地完成为200，异步为202及`Location/Retry-After`，沿用现有运行轮询地址。旧运行、旧输入及旧交付均保留。刷新后的工作区/研究revision可从新运行`snapshot.workspace_revision/study_revision`读取。预检前版本采用已原子保存，预检失败也保留为可编辑的新配置；再次以相同request_id和相同正文提交不会重复换版。断网或主机重启后使用原请求重试；已经接受的运行不再执行第二次。409 `REQUEST_CONFLICT`表示同标识不同正文，研究revision不符为`STUDY_REVISION_CONFLICT`。方法未安装、封签失配仍拒绝执行，不自动下载或降级。

计算书创建/详情和交付列表增加`version_status`（`DeliveryResult/DeliverySummary`）；读取历史交付仅附动态状态，不改保存HTML或摘要。用历史运行新生成的计算书封面带“基于旧版本方法x.y.z”；严格`/deliveries/current`仍拒绝过期输入。规格书`lifecycle.version_status`提供相同字段，HTML及现有规格书PDF共享的封面“文件状态”消费它；已发布规格书payload和批准摘要不改写。研究PDF独立排版模块可直接消费运行的`version_status`，本轮未修改其排版代码。

回归：`tests/test_version_refresh.py`覆盖版本差异、空状态、重新执行及幂等、409、失败预检、断网重试、型号升级保留敷设/负荷、仅选published型号、历史工件不变和规格书封面。

验证见 `tests/test_host_api.py`、`tests/test_simulation_study_tasks.py`；原生流程见 `plugin-tests/test_simulation_study_workflow.py`，求解只经 Slurm 执行。浏览器契约流程：独立验收数据库启动正式宿主后，设置 `E2E_ISOLATED=1`、`HOST_API_URL` 并执行 `node tests/browser/host-workflow.mjs`。该脚本经隔离的 Edge --headless=new / CDP 创建研究、预检、运行、重复提交、轮询、交付和实际下载，核验两种桌面宽度下保存计算书的横向溢出；结束关闭所有自有标签页并删除浏览器配置。它验证浏览器网络和下载流程，不是新前端页面操作次数或工程师耗时。

## Agent 会话与工具接口

正式后端注册`backend/harness/`，前端既有`agent-api.ts`无需另换端点。M09架构、状态、持久意图、权限和恢复边界统一见[模块设计 §14](../design/MODULE_DESIGN.md#14-原生-agent-harness)。配置只读宿主环境中的`CABLESIM_LLM_BASE_URL`、`CABLESIM_LLM_MODEL`、`CABLESIM_LLM_API_KEY`（任一 OpenAI 兼容地址与模型名，由部署方设置）。没有密钥或完整配置时configured=false；工具查询仍可用，消息返回明确错误，不产生模型调用。

| 接口 | 请求/结果 |
| --- | --- |
| GET `/api/agent/status` | `{configured,model,tools}`；model未配置时展示deepseek-flash；从内存清单计数，不构建工具规格或等待输入契约锁 |
| GET `/api/agent/settings` | 当前生效的模型连接：`source`（settings/environment/none）、地址、模型名、`has_key`、末四位提示、密钥来源与存放位置（system 系统凭据库 / memory 仅本次进程）、自定义指令、单次请求超时；从不返回密钥 |
| PUT `/api/agent/settings` | `{base_url,model,api_key?,instructions,model_timeout_s?}`；api_key 省略则保留原密钥，空串清除；非敏感项写入工程库 `agent_settings`，密钥只进系统凭据库或进程内存；保存的设置优先于 `CABLESIM_LLM_*` 环境变量 |
| DELETE `/api/agent/settings` | 清除界面设置与保存的密钥，回到环境变量配置 |
| POST `/api/agent/settings/test` | `{base_url?,model?,api_key?}`，缺项取当前生效值；发一次最小对话请求，返回 `{ok,latency_ms?,model?,code?,message?}`，不保存任何内容 |
| GET `/api/agent/tools` | `[{name,title,kind,description,plugin_id?,hpc}]`；kind为read/propose/run，宿主工具不带plugin_id；直接从已校验清单构建发现信息，后续沿用源码通知缓存；完整封签核验仍在能力检查与执行边界进行 |
| GET `/api/agent/recipes` | `[{id,name,description,parameters}]`；parameters为所需参数的JSON Schema，供前端“/”菜单展示与填参；未给study_id时使用会话绑定研究 |
| GET `/api/agent/sessions?workspace_id=` | 任务列表，按更新时间新到旧：绑定、状态/等待原因、首条提问作标题、未决方案数；不含消息正文与结果 |
| POST `/api/agent/sessions` | `{workspace_id,study_id:null或UUID}` → `{id}`；校验工程与研究归属，记录固定修订及本机快速执行授权 |
| POST `/api/agent/sessions/{id}/messages` | `{content}` → `text/event-stream`；每会话同时只处理一条消息，冲突409 |
| GET `/api/agent/sessions/{id}` | 绑定、任务状态/等待原因、预算、消息、工具调用/结果摘要、方案、计划、步骤、按序审计事件 |
| POST `/api/agent/proposals/{id}/approve` | 无正文；人工批准后普通保存，返回`{status:approved}`；修订/锁/封签/有效期冲突409中文原因 |
| POST `/api/agent/proposals/{id}/reject` | 无正文；`{status:rejected}`，不改工程或研究；同决定重放幂等，反向决定409 |
| POST `/api/agent/sessions/{id}/reconcile` | 无正文；查询原Run，返回`{resolved,unknown,reissued:false}`；不重新执行未知预览或提交作业 |
| GET `/api/agent/contract` | 生成的事件、节点和实际模型工具参数JSON Schema；SSE事件schema也写入OpenAPI的x-sse-events |

当前16个宿主工具为workspace_list/read、study_list/read、run_list/read、plugin_inspect、cable_model_read、propose_domain_changes、propose_method_parameters、study_preflight、study_preview、project_digest、study_baseline、sensitivity_inputs、recipe_execute。另从51个已安装能力生成工具，总计67。插件工具未绑定研究时只生成新建研究方案，批准后只保存Study；绑定研究时必须与该研究的准确方法一致，只有preview且非远程能力可本机试算。原生或HPC预检需要人工执行，不通过LLM触发远程作业。

`project_digest({after?,limit?})`返回本工程各研究最新保存运行：`data.studies[]`含`study_id/title/study_revision/run_state/latest_run`，run_state为`not_run/stale/failed/normal/running`；latest_run带运行身份、方法版本与发行摘要、输入/输出摘要、headlines（实体、工况、SI及显示单位）、插件限制对象及原工况证据。完整性失败时不提供量值。整个工具结果UTF-8紧凑JSON不超过6KiB；`next_cursor`非空表示尚有研究，继续用`after=next_cursor`分页；单研究过大时`details_omitted=true`并指向`run_read(study_id,run_id)`。未绑定研究的`run_list`直接返回此摘要，不再发STUDY_REQUIRED。

`recipe_execute({recipe,parameters})`只编译有限的既有工具步骤：`conclusion_summary`→project_digest；`missing_inputs`→workspace_read、study_preflight；`proposal_comparison`→study_baseline、字段方案、study_preview；`sensitivity_advice`→workspace_read、sensitivity_inputs、project_digest。方案对比要求`scope:domain|parameters`及明确`changes`，可指定研究、模块、原运行和工况；自动选择当前最新正常保存运行，single使用唯一主工况、selection使用已保存推荐工况，扫描/批量须指定case_id。失败或过期原运行会停止后续步骤。所有步骤照常计入预算、保存计划和操作身份；绑定值仅来自同配方已成功步骤。`recipe.compiled`记录展开节点，`recipe.bound`记录来源节点、字段路径与解析后参数摘要。参数敏感性只整理已保存字段和封签约束，不计算敏感性或自动采样。

同条消息中完全相同的工具、参数与输入身份已返回错误时，宿主不再执行该动作；`tool.diagnostic_reused`引用原操作，后续返回DIAGNOSTIC_ALREADY_REPORTED并进入一次收尾。修改输入或进入新消息可重新检查。

SSE每个事件恰为`event: 类型`与`data: 单行JSON`，空行分隔；中文JSON保留字符，字符串内换行转义。事件data字段：

回答核验审计通过会话GET的`events`读取：`answer.rejected.data`含`turn_id/phase/attempt/draft/issues`，issue含`code/rule/fragment/start/end/value/unit/message/available_values`；凭据已隐藏。草稿仅供审计，不是回答。`answer.repair`记录实际重写次数与反馈，`model.request.phase`区分`tools/repair/closing`，`answer.accepted.matches`记录量值来源，`answer.fallback.sources`记录确定性摘要来源。SSE沿用下列现有字段，前端展示回答无需新增字段；若增加核验诊断面板，只读取审计事件。

```text
message.delta    {text}
tool.call        {id,tool,title,arguments}
tool.result      {id,status:"ok"|"error",summary,next_actions}
proposal.created {id,title,changes:[{path,label,before,after,unit}],checks}
error            {code,message}
done             {usage:{prompt_tokens,completion_tokens}}
```

示例（说明用ID，数值为候选输入而非计算结果）：

```text
event: proposal.created
data: {"id":"方案UUID","title":"调整地表温度","changes":[{"path":"/sections/section~1s1/medium/surface_temperature","label":"地表温度","before":25,"after":30,"unit":"°C"}],"checks":["领域结构与锁校验通过；等待人工批准。"]}

event: done
data: {"usage":{"prompt_tokens":120,"completion_tokens":20}}
```

批准后内部温度以K保存；长度变更以m显示和保存，截面按声明显示mm²、存m²。方法参数单位来自封签元数据，不按后缀猜。修改只读来源、批准自己、调用任意命令、隐藏正式执行均被broker拒绝。常见流错误为LLM_NOT_CONFIGURED、LLM_AUTH_FAILED、LLM_TIMEOUT、BUDGET_EXCEEDED、UNKNOWN_OPERATION、REPAIR_LIMIT_EXCEEDED、UNGROUNDED_NUMBER/QUANTITY；工具错误先形成结构化公共结果回给模型，保留字段定位和下一步。

模型默认只收到宿主工具；插件目录只含工具名和中文说明。`plugin_inspect(tool)`或指定`plugin_id/capability`成功后，会话`enabled_tools`列出后续启用的插件能力，完整注册表仍由`/tools`提供。`workspace_read(paths)`读取大纲或指定字段；`run_read`支持`entity/key/case_id`；`study_preview`支持`proposal_id`，选择/批量工况还须原`run_id/case_id`。完整结果保留在步骤与审计，进入模型的单项结果最多6KiB，超限明确标注并给出继续读取提示。

每次请求审计增加`turn_id/request_number/phase/definition_bytes/prompt_bytes`，`model.result`记录对应实际`usage`；`phase=closing`为一次无工具收尾。预算规则统一见[模块设计 §14.3](../design/MODULE_DESIGN.md#143-权限保存与预算)。会话预算`scope=message`，done报告本条消息已报告token，`session_totals`保留会话合计；提供方缺失用量时`usage_complete=false`。SSE工具卡片事件字段保持不变，完整结果在`results/steps`和`tool.observation`审计中读取。未知预览仍保持unknown，不重新执行。

验证见`tests/test_harness.py`，使用本地OpenAI兼容假HTTP服务，不请求真实模型；真实提供方冒烟仅在设置CABLESIM_LLM_API_KEY时启用，交由真实环境联调。CAD分析资格、有限元自动修复及通用HPC授权执行不在本轮实现范围。
