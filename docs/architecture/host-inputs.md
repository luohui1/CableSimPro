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

| 作业接口 | 记录字段与语义 |
| --- | --- |
| GET `/api/hpc/jobs`；POST `/api/hpc/jobs/{id}/cancel`、`/refresh` | 分页 `items/total/next_offset`；每项含 `workspace_id/workspace_name`、`study_id/study_name`、`run_id`、`job_id`、`type`（single 单次 / convergence 收敛 / batch 批量）、`status`、`queue_position/queue_position_basis`、`used_core_hours/budget_core_hours`、`started/finished`（UTC）、`cancellable`；收敛另含 `convergence_id/convergence_level/phase/workflow_budget_core_hours`。排队位置为 dg83 可见待调度作业的优先序，非预计开跑顺序；未知位置为 null。预检没有运行时 run_id 为 null；历史缺失身份或预算列入 missing_fields，不猜测。原 workspace/study/kind/core_hours/execution 字段保留兼容。GET 只读本地回执；refresh 查询原 Slurm 作业，不重新提交。跨对象目录属于 `/runs` 记录页，设置只保留连接配置。 |

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

平台能力统一入口：`GET /api/agent/capabilities?module=&q=&offset=&limit=`返回`{items,total,next_offset}`，每项为实际注册、非弃用API的`{id,module,name,method,path,mode,reason}`。`id`是宿主operation身份，不接受模型提供URL。`mode=read`允许检查契约后读取JSON；`human`要求普通平台入口人工操作（含系统管理、写入、执行、批准、发布）；`reference`指向文件/大工件的普通读取入口。目录跟随实际路由与策略元数据变化失效，不用TTL；尚未注册为宿主API的前端/CAD交互不会被编造为可调用能力。路由可用`openapi_extra:{"x-agent-access":"human"|"reference"}`进一步收紧GET权限，不能借此开放写操作。

模型工具`platform_capabilities({operation?,tool?,module?,q?,schema_path?,offset?,limit?})`查目录或按需检查完整请求/响应契约；`tool`检查本会话已开放宿主工具，插件仍用`plugin_inspect`按封签契约启用。`platform_read({operation,path_parameters?,query?,view?,offset?,limit?})`只在进程内调用所选注册GET接口，验证参数schema、会话工作区及固定修订，并记录响应摘要与契约摘要。禁止客户端请求头、URL、凭据、路径跳转；会执行插件预检的研究接口沿用专用工具权限。读取超时由`CABLESIM_AGENT_PLATFORM_READ_TIMEOUT_S`控制（默认8秒），同时受本条消息剩余时间约束；原始响应上限1MiB，不读取整场工件。步骤保留实际响应，模型视图限6KiB；用返回对象内JSON Pointer `view`及`offset/limit`逐项展开，省略字段明确标注原因与子路径，不截成半句话。

`platform_prepare({operation,path_parameters?,query?,body?})`准备4KiB内的结构合规人工请求，返回`request:{operation,arguments,contract_digest,workspace_revision,executed:false,human_confirmation_required:true,business_validation:"pending",approval_granted:false}`并写`platform.action.prepared`审计；不调用写接口，不生成工程批准。任务保持`waiting/scope_confirmation`，由人在对应模块的普通入口补业务检查并执行；文件上传和敏感管理契约明确要求人操作。既有字段方案继续使用现有方案批准机制。前端可据该事件显示待人工执行参数与操作说明，不能将其渲染为已保存回执或自动批准按钮。目录、契约默认值和准备请求属于元数据，不能作为工程数值证据；真实保存数据继续经过原数值、对象身份与验证状态核验。通用运行读取复用`run_points`的完整性与有限元收敛资格，覆盖各插件已保存量值；原件保留在`response`，核验只采用`evidence`，不采用未合格结果或内嵌schema的默认值。

自由消息由模型根据完整目标与工具证据选择路线；权限、参数校验、固定修订、审批与正式运行边界由宿主执行。新增`task_plan({goals:[{id,description,requires:[{tool,arguments}]}]})`，复杂任务可与读取一起调用，简单问题无需额外规划。目标参数限4KiB，返回进度限6KiB；参数使用实际工具契约，未知/不适用工具、重复目标ID或非法参数在具体目标字段返回诊断。目标保存在`task.goals`追加事件；`task.progress`以本条消息成功回执及参数匹配计算`goals[].status/source_node_ids/missing/all_satisfied`，不采信模型自报完成，也不代表工程批准。未齐证据的目标在回答后明确列出；旧消息目标不影响新消息。模型可根据诊断更新证据路线，配方仍可复用。

回答核验按名称或标题所指的研究/运行限制量值来源，不能拿其他对象的同值替代；对象名数字、舍入与推导规则保留。核验失败反馈具体问题并保留原草稿与reasoning_content；数值证据不足可在原max_repair_attempts与总预算内补取只读证据，再重写。修正阶段只开放read工具，不开放方案、预检、试算、配方或插件执行；模型返回隐藏写操作也不执行。补读仍入计划、步骤与审计，`answer.repair.read_tools_allowed/engineering_writes_allowed:false`记录边界。

正式后端注册`backend/harness/`，前端既有`agent-api.ts`无需另换端点。M09架构、状态、持久意图、权限和恢复边界统一见[模块设计 §14](../design/MODULE_DESIGN.md#14-原生-agent-harness)。配置只读宿主环境中的`CABLESIM_LLM_BASE_URL`、`CABLESIM_LLM_MODEL`、`CABLESIM_LLM_API_KEY`（任一 OpenAI 兼容地址与模型名，由部署方设置）。没有密钥或完整配置时configured=false；工具查询仍可用，消息返回明确错误，不产生模型调用。

| 接口 | 请求/结果 |
| --- | --- |
| GET `/api/agent/status` | `{configured,model,tools}`；model未配置时展示deepseek-flash；从内存清单计数，不构建工具规格或等待输入契约锁 |
| GET `/api/agent/settings` | 当前生效的模型连接：`source`（settings/environment/none）、地址、模型名、`has_key`、末四位提示、密钥来源与存放位置（system 系统凭据库 / memory 仅本次进程）、自定义指令、单次请求超时；从不返回密钥 |
| PUT `/api/agent/settings` | `{base_url,model,api_key?,instructions,model_timeout_s?}`；api_key 省略则保留原密钥，空串清除；非敏感项写入工程库 `agent_settings`，密钥只进系统凭据库或进程内存；保存的设置优先于 `CABLESIM_LLM_*` 环境变量 |
| DELETE `/api/agent/settings` | 清除界面设置与保存的密钥，回到环境变量配置 |
| POST `/api/agent/settings/test` | `{base_url?,model?,api_key?}`，缺项取当前生效值；发一次最小对话请求，返回 `{ok,latency_ms?,model?,code?,message?}`，不保存任何内容 |
| GET / PUT `/api/agent/memory/settings` | 查看或保存`{enabled,recall_limit}`，默认关闭、召回5条（1至8）；状态含`engine:"langmem",version,available,code,retrieval:"sqlite_lexical_and_scope",worker_running,worker_error,engineering_evidence:false`。运行时未按requirements安装时启用返回503，不影响普通会话 |
| GET `/api/agent/memories?workspace_id=&study_id=&q=&limit=&offset=` | 本工作区记忆与可选同研究记忆，`{items,total}`；每页1至20条，按查询词匹配与更新时间排序。条目含`id,kind,topic,content,revision,status,reason,sources:[{task_id,sequence}],workspace_revision,study_revision,methods,created,updated,engineering_evidence:false,authority:false` |
| PUT / DELETE `/api/agent/memories/{id}` | 人工纠正用`{expected_revision,content}`；删除用查询参数`expected_revision`。冲突409，不覆盖人工修改；删除清空记忆文本和来源副本、保留身份墓碑。原始会话审计仍保留，删除记忆不等于删除聊天历史 |
| GET / POST `/api/agent/sessions/{id}/memory` | GET返回本会话有界召回`context`与后台`jobs`（状态、原因码、独立请求数/tokens/耗时）；POST对已结束的最近消息入队，返回`{job_id}`，同一turn幂等，不重新计费抽取。关闭时409，活动消息409 |
| GET `/api/agent/tools` | `[{name,title,kind,description,plugin_id?,hpc}]`；可选session_id或workspace_id（二者不能同时给）筛选适用工具；kind为read/propose/run，宿主工具不带plugin_id；沿用源码通知缓存，完整封签核验仍在能力检查与执行边界进行 |
| GET `/api/agent/recipes` | `[{id,name,description,parameters}]`；可选session_id或workspace_id筛选适用配方；parameters为JSON Schema，供“/”菜单填参；型号会话返回type_review及只读inbox_triage，type_review的type_id默认且限定为绑定工作区；未筛选时保留完整目录 |
| GET `/api/agent/sessions?workspace_id=` | 任务列表，按更新时间新到旧：绑定、状态/等待原因、首条提问作标题、未决方案数；不含消息正文与结果 |
| POST `/api/agent/sessions` | `{workspace_id,study_id:null或UUID}` → `{id,context:{kind:"project"|"type",id,default_proposal_kind:"domain"|"type",default_recipe:null|"type_review"}}`；型号设计也使用workspace_id，记录固定修订与适用范围，不扩大执行授权 |
| POST `/api/agent/sessions/{id}/messages` | `{content,recipe?:{id,parameters}}` → `text/event-stream`；省略recipe沿用自由提问；每会话同时只处理一条消息，冲突409 |
| GET `/api/agent/sessions/{id}` | 绑定、context（同创建响应）、任务状态/等待原因、预算、消息、工具调用/结果摘要、方案、计划、步骤、按序审计事件 |
| POST `/api/agent/proposals/{id}/approve` | 无正文；人工批准后普通保存，返回`{status:approved}`；修订/锁/封签/有效期冲突409中文原因 |
| POST `/api/agent/proposals/{id}/reject` | 无正文；`{status:rejected}`，不改工程或研究；同决定重放幂等，反向决定409 |
| POST `/api/agent/sessions/{id}/reconcile` | 无正文；查询原Run，返回`{resolved,unknown,reissued:false}`；不重新执行未知预览或提交作业 |
| GET `/api/agent/contract` | 生成的事件、节点和实际模型工具参数JSON Schema；SSE事件schema也写入OpenAPI的x-sse-events |

宿主工具目录以tools为准，另从已安装清单的可调用能力生成插件工具，总数由status.tools返回。模型请求省略宿主参数schema中的重复description/title/default/examples注释；recipe_execute保留配方ID及参数对象，具体配方参数通过platform_capabilities(tool="recipe_execute")按需检查。/contract和broker保留完整校验约束，不以紧凑模型定义替代执行校验。插件工具未绑定研究时只生成新建研究方案，批准后只保存Study；绑定研究时必须与该研究的准确方法一致，只有preview且非远程能力可本机试算。原生或HPC预检需要人工执行，不通过LLM触发远程作业。

长期记忆使用LangMem的结构化抽取API，复用当前ModelPort、密钥管理和思考模式回传；不替换会话执行器，不优化系统提示。启用后，正常结束的消息自动进入单个宿主后台线程；只提供本条消息的原始用户文本、宿主状态回执与失败诊断（不带工具结果正文），不提供助手解释、思维链、被拦草稿或厂家全文。记忆限preference/goal/decision/lesson，每条引用真实事件序号；宿主核对来源并原子保存整批提议，非法来源整批失败。pending/running/completed/failed/cancelled、异常类别及真实用量写入agent_memory_jobs，终态清空抽取输入副本；后台失败不改变已完成的对话。每批最多3次模型请求、30秒、48KiB请求上下文，单次15秒；用量独立于前台消息预算并在memory.extracted/failed审计，重启时未完成调用明确记为MEMORY_INTERRUPTED，不重放。关闭记忆取消队列，正在返回的旧抽取也不能提交；宿主关闭时先结束记忆线程，数据库连接仅在短事务内使用。

记忆在同一SQLite库按工作区和研究隔离保存，人工纠正/删除带乐观修订及空间generation，后台不能覆盖期间的人工改动。只抽取本条消息，删除后的旧用户原文不会在下一条消息中再次送给抽取器。召回采用本地词匹配（中文双字词、英文单词）和对象范围，最多6KiB；目前没有向量相似度、跨工程用户画像或独立用户ACL。偏好可跨输入修订保留；目标、决策及经验按输入/研究修订和已有方法发行引用判断过期，过期条目仍可查看但不装入模型。上下文memory单独标为历史参考，不进入工程数值证据或审批授权；最新用户说明优先，回答仍需从真实工具读取数值。前端可接上述人工管理及启用接口，本轮未新增记忆页面。

敷设、参数化CAD与仿真准备共用不可变领域草稿，模型按目标自主组合工具，不按问句匹配固定流程：

| 工具 | 参数与实际效果 |
| --- | --- |
| draft_read | `{view?:input|catalog|changes,draft_id?,paths?,compare_to?,offset?,limit?,expected_catalog_revision?}`；input为默认，省略ID读固定保存输入（persisted=true），带ID读本会话草稿（persisted=false）。稳定路径、显示单位和input_digest，最多8条路径；大结果的read_hint保留准确草稿ID。catalog只投影候选身份，分页列草稿与分析配置、parent_id、基准修订、摘要及available/expired/outdated原因；目录元数据不作数值证据，按ID使用时重新核验原件。changes须指定draft_id，compare_to省略与保存基准比，指定则比较两个本会话候选；只比较输入，不推算工程影响。catalog/changes返回完整行分页total/offset/next_page，上限6KiB，单行过大明确拒绝而不截断字段。limit默认10、上限20，offset默认0；next_page保留准确对象与catalog_revision，目录变化返回DRAFT_CATALOG_CHANGED须从0重读；各视图不接受无效组合参数。 |
| draft_update | `{draft_id?,changes:[{path,value,unit}]}`或`{draft_id?,template:{kind,depth,spacing,unit:"m"}}`，二选一；普通领域/型号编辑校验及锁，返回新的draft_id，不保存工程。型号长度mm，工程长度m，工程量必须显式单位。模板kind取普通section-template契约，必须明确埋深与间距；会重排截面，保留教学来源和未审核物性，不能视为工程优化结论。 |
| draft_geometry | `{draft_id?,method,parameters}`；Method固定四项封签身份，parameters先查plugin_inspect。只执行普通本机geometry/domain预览；远程能力、完整STEP/BRep导出转人工。聊天步骤只记录工件摘要、已核对量值和省略说明，不复制CAD网格；原显示网格保留在普通几何预览服务，detail_ref指向工作区/草稿几何预览，网格并未成为保存运行。模型仅读6KiB紧凑投影中的工件类型、真实外径量值、输入/方法/请求摘要与警告。核对回执及各工件的输入摘要、方法与修订；source分别保留本次调用的host_request_digest和插件执行回执request_sha256，两者的请求格式不同，不能相互比较。仿真配置参数及显示网格不提供温度/载流量证据。 |
| simulation_prepare | `{draft_id?,method,parameters,title}`；按接受domain的封签分析契约核对结构和输入锁，保存不可变simulation_plan_id，与具体草稿/输入摘要绑定；不物理预检、不建网格、不求解。预算`{status:"requires_saved_study",core_hours:null,reason}`，不猜算力。 |
| draft_propose | `{draft_id?,simulation_plan_id?,title}`；完整字段差异和可选新研究配置进入原审核，`kind:"draft_workflow",base_revision`，型号另有type_id。公开差异上限64KiB，超过拒绝，不隐藏待批准变更。 |

草稿与分析配置在agent_plan_revisions保存，分别kind=draft/simulation；draft.created及simulation.prepared记录身份、摘要、修订和过期时间，完整原件留在计划，工具步骤照常进预算与审计。草稿上限1MiB、有效期1小时；共享修订变化返回DRAFT_BASE_CHANGED，跨会话ID、过期、错误单位、锁、非法路径返回具体诊断；草稿变化后旧分析配置返回SIMULATION_DRAFT_MISMATCH。几何检查沿用普通几何服务超时与错误，剩余预算小于能力超时上限时拒绝启动。人批准draft_workflow时重新核验全部输入、派生规则、锁和方法参数摘要，在同一事务调用普通save_domain及research.save；任一步冲突全部回滚，重复批准幂等。仅保存输入及研究，不运行、不发布、不提交超算。批准后会话采用新修订及新研究身份，可经平台只读接口读availability/estimate与已有人工作业；预检、确认预算和提交仍在普通研究工作台执行。

模型上下文独立保留最近6份候选身份、总数、省略数及catalog读取提示，历史工具消息裁剪后仍能找回候选。内部record(model_context=true)由SQLite投影计划，只加载候选元数据和公开审核差异，不反复反序列化完整草稿、私有方案输入或分析参数；计划原件及原摘要保持不变，HTTP会话历史仍流式返回完整原件，人工批准仍读取完整方案。投影的body_projected标记说明body不等于原digest对应内容；候选不是保存运行，也不授予审批或执行权限。

这条链让CAD检查与分析配置引用同一领域输入，未建立BRep→分析网格资格桥。draft_geometry的analysis_qualification="not_connected"；显示工件不能冒充求解网格、收敛结论或已保存运行。完整STEP/BRep、自由绘图编辑和超算提交仍由普通模块的人审入口处理。新增草稿方案沿用proposal.created事件，前端需识别draft_workflow，并完整展示结构增删和新研究的对象差异；会话步骤提供几何量值及工件摘要，完整网格须由普通几何预览读取，本轮不提供新的渲染事件。

`object_find({kind?,q?,limit?,offset?})`与`object_relations({kind,id,limit?,offset?})`使用下文统一索引的同一对象身份，覆盖整个工程库；只读元数据，不授予跨工程修改权限。工具默认10项、上限20项，结果紧凑UTF-8 JSON不超过6KiB。API名片保留完整限制说明，Agent验证视图保留状态、关键偏差及单位、收敛、出处与保存版本，limitations仅选取预算内的完整条目（最多640字节），不截断句子。validation增添`total_limitations,omitted_limitations,omission_note,detail_ref:{kind:"validation",id,snapshot_digest,view:"results"}`；明确省略几条、全文在验证对象的家（结果页）。采用独立紧凑视图是为避免长说明挤掉证据，不改变原件或API名片；不能将省略内容说成已检查。`data.total/offset/next_offset`供继续分页；关联按uses、used_by、unresolved顺序分页，data.source_errors保留源错误。状态、名称和过期原因按名片引用，工程量仍须从project_digest或保存运行证据读取。两个工具照常进入计划、步骤、预算与审计。

精度/公开算例问题复用上述两个工具，不新增配方：先按插件ID查validation关联，再以`object_find({kind:"validation",q:<目标ID>})`读取该验证名片；也可按公开标准名称搜索并分页。这样插件验证页与Agent共用同一保存证据，不固化特定算例流程。只有`subtype:"reproduced"`的`validation.metrics`是已校验复现快照的量值，按目标、行、字段路径与snapshot_digest纳入回答数值核验；relative_difference_percent仅为保存比值×100的百分数显示投影。引用不能把另一个目标的偏差移到当前目标。清单声明不提供量值证明；部分复现、偏差超限不能称作整体验证通过，收敛通过独立说明，项目门槛不能称作缺证据的报告工程容差。违反时返回UNSUPPORTED_VALIDATION_CLAIM，经原修正/收尾回路重写；兜底也保留保存状态和限制。正文对象名称加引号，SSE的object_refs引用同一验证名片。

`inbox_read({category?,limit?,offset?,expected_digest?})`读取与`GET /api/index/inbox`同一份完整索引快照，范围为全库跨工程只读，不按会话工程过滤，也不授予跨工程修改权限。category为review/stale/missing/running；默认10项，上限20项，offset从0开始。返回`data:{scope:"library_read_only",category,counts,total,offset,items,next_offset,next_page,inbox_digest}`；counts为全库四类计数，total为筛选后条数。items保留InboxItem全部字段和原因原文，增添`home:ObjectCard,next_step,handled_by,requires_human_approval`。home只沿保存父对象找原工作台，方法版本只读安装名片；不猜缺字段值、审批人姓名或资源绑定。整个ToolResult紧凑UTF-8不超过6KiB，单项过大返回INBOX_ITEM_TOO_LARGE，不截断原因；next_page保留筛选、limit与摘要。分页期间待办变化返回INBOX_CHANGED（/expected_digest），从offset=0重读，不拼接不同版本清单。

`inbox_triage`配方参数与inbox_read相同，工程和型号会话均适用。宿主只执行inbox_read，最多续读四页，每步照常记录计划、步骤、预算与审计，然后一次无工具模型请求解释处理顺序。宿主在通过核验的解释后附处理清单：同一类别中原因原文、下一步、处理人及人工审批要求相同的对象合成一组，列出全部对象名称，只展示一次原因与操作；比较操作时只去掉已保存home的准确名称，不模糊匹配不同原因或动作。每个对象及其home仍保留在object_refs，逐项原文仍在工具结果；审计items仍是对象数，分页完整性规则不变。型号模块沿保存parent引用找到所属型号；名片保持索引原文，title为“型号名 · 模块名”，home为型号名片，next_step指向型号工作台对应模块，不按名称猜归属。清单同时列型号与模块；不同模块操作不合并。模型不复述清单。不执行重算、批准、发布、提取或超算提交，也不猜输入生成补字段方案。用户后续明确对象、路径、值和单位时，须在该对象绑定会话按现有提案机制提出，由人批准。`inbox.triaged`审计含items、complete、category、offset、next_page、inbox_digest及engineering_writes:false；分页上限/源变化显式说明未展开范围，next_page可作为下一条recipe参数继续。自由提问由模型按完整目标选择inbox_read或配方，也可组合其他只读证据；宿主不按关键词自动把整条消息改成配方。首页入口显式携带recipe时仍确定性执行、禁止代办。

首页“让 Agent 整理”调用：先用当前工程UUID（没有选中时从统一索引选现有project；也可用现有type工作区）POST `/api/agent/sessions` `{workspace_id,study_id:null}`，再POST `/api/agent/sessions/{id}/messages` `{content:"帮我理一下待办",recipe:{id:"inbox_triage",parameters:{}}}`并读SSE。绑定仅为会话归档锚点，整理仍覆盖整个库；不必绑定研究。不为整理创建虚构工程，库内没有任何工程/型号时保留待办列表并禁用此入口。后续修改其他工程或型号必须新建该对象会话。首个message.delta与会话消息的object_refs照常带待办对象及原工作台名片；正文保持纯文本。

`type_read({type_id,view?,after?,limit?,expected_revision?})`的type_id是型号设计工作区UUID，不是候选型号或发布资产ID。view为summary（默认）、structure、requirements、plans、runs、specification、review；每页紧凑UTF-8不超过6KiB，返回`object/type_id/type_revision/view/total/items/next_page`。items按section区分结构字段、保存外径链、要求及执行标准条款、方案、运行来源、规格书状态和缺项；工程字段带`path/value/unit/source`，来源含保存修订、摘要、字段来源或保存运行方法与摘要。长度输入显示mm；保存几何运行量按原m引用。不推算未运行的外径，不把缺标准运行称为符合。分页用next_page原参数继续，含expected_revision，期间修订变化返回TYPE_REVISION_CONFLICT。单项过大返回TYPE_RESULT_TOO_LARGE，指导工作台查看原件。

`propose_type_changes({type_id,changes:[{path,value,unit}],reason})`只接受当前会话绑定型号工作区的稳定标量路径；工程量必须给显示单位，长度用mm。材料切换只接受该文档已有材料ID，外部材料版本须先在工作台显式导入；不能修改来源、身份或审核状态。单位、范围、路径和锁错误含`diagnostics[].path`。公开方案增加`kind:"type"/type_id/base_revision`，差异包含普通编辑器产生的联动字段；只进入原人工审核、右栏和统一review待办。人工approve调用工作台同一`save_domain`服务，重新核验候选摘要、锁和基准修订，原子保存及记决定，重复批准不重复保存；修订冲突返回409，方案保留pending。不采纳版本、不发布，不宣称改动已通过标准或计算。

`type_review`配方参数schema由GET `/api/agent/recipes`返回，必填type_id，可选after、limit、expected_revision，view固定review。宿主先执行type_read并按next_page续读，每步保存计划、预算和审计，随后一次无工具请求解释缺项、已保存标准判定和改进建议；没有标准证据时明确未覆盖。仅建议，不生成修改或运行。

型号工作台创建会话时传其工作区UUID（study_id通常省略），前端“/”菜单用`GET /api/agent/recipes?session_id=<会话ID>`，尚未创建会话时可用workspace_id。`session.context`审计固定kind与默认方案类型，旧会话按绑定修订的来源字段识别；人工批准改变修订不改变工作区类别。型号会话开放type_read、propose_type_changes、对象工具、目录读取、task_plan及platform能力发现/只读/人工请求准备，也可用draft_read/update/geometry/propose检查型号草稿；不展示工程研究工具、simulation_prepare或直接执行插件工具。型号草稿不接受工程敷设模板。绕过目录调用研究工具也返回`TYPE_TOOL_NOT_APPLICABLE`；指定研究配方在消息开始前422 `RECIPE_NOT_APPLICABLE`。type_read与propose_type_changes可省略type_id，默认绑定型号；type_read保留显式读取其他型号的能力，propose_type_changes的显式ID只能为本会话型号，避免跨型号写入。

型号会话的普通消息先由宿主执行一页type_read(summary)，结果进入计划、步骤、预算、数值证据与`context.loaded`审计（含status与固定修订），再交模型；分页未展开部分不得称为已检查。自由提问由模型结合摘要和全部目标选择type_review、补读或提出明确字段方案；宿主不按“检查”等关键词改写任务。前端显式携带`recipe:{id:"type_review",parameters:{}}`时仍按next_page读完后一次无工具解释，`recipe.requested.source=human.message`；保留思考回传和回答核验。新建来源按type_creation识别；空白/资料导入草稿的空字段作为路径缺项，不伪造数值。完整型号修改仍使用普通保存的范围、锁与修订校验；不完整草稿返回TYPE_DRAFT_INCOMPLETE与请求字段path，指引在型号工作台补齐必填结构、额定要求及来源。

回答正文保持纯文本。首个`message.delta`增加`object_refs:ObjectCard[]`，从统一索引按正文首次出现顺序、kind/id去重；后续分片不重复附带，前端需在本条回答中保留并按kind渲染引用。会话GET的assistant消息也保留object_refs，普通作答、修正、收尾和证据兜底共用此规则；引用不替代数值核验。优先使用工具读取的对象身份；同名且身份不明时不猜指向。类别覆盖统一索引的ObjectCard.kind，包括待办方案、厂家资料、资源、交付与作业；宿主待办清单按已读取的准确身份附名片，不按名称推测。索引暂不可用时普通引用返回空数组并记object_refs.unavailable；已成功读取的待办名片可保留，不推测或编造新名片。

`project_digest({after?,limit?,case_after?})`返回本工程各研究最新保存运行：`data.studies[]`含`study_id/title/study_revision/run_state/latest_run`，run_state为`not_run/stale/failed/normal/running`；latest_run带方法版本与发行摘要、输入/输出摘要、headlines（实体、工况、SI及显示单位）、各口径允许电流、导体温度、温限余量、限制对象与最热导体。`cases[].input_fields`只来自冻结工况，含土壤热阻率、负荷与埋深；地下敷设的负z坐标投影为正埋深并保留`saved_z`和投影说明，地上敷设保留z坐标；不以当前工程冒充历史输入。完整性失败不提供量值，有限元未收敛只给诊断。整个工具结果UTF-8紧凑JSON不超过6KiB；`next_page`非空时以该对象参数继续配方分页，含研究游标和必要的工况分段游标，保留全部工况量值而不丢弃大研究。`next_cursor`保留研究分页兼容字段。自由提问由模型判断摘要是否覆盖全部目标，可继续补读缺失输入或其他对象；显式结论配方仍在完整分页后一次无工具作答。未绑定研究的`run_list`直接返回此摘要，不再发STUDY_REQUIRED。

`recipe_execute({recipe,parameters})`只编译有限的既有工具步骤：`conclusion_summary`→project_digest；`missing_inputs`→workspace_read、study_preflight；`proposal_comparison`→study_baseline、字段方案、study_preview；`sensitivity_advice`→workspace_read、sensitivity_inputs、project_digest；`type_review`→type_read；`inbox_triage`→inbox_read。方案对比要求`scope:domain|parameters`及明确`changes`，可指定研究、模块、原运行和工况；自动选择当前最新正常保存运行，single使用唯一主工况、selection使用已保存推荐工况，扫描/批量须指定case_id。失败或过期原运行会停止后续步骤。所有步骤照常计入预算、保存计划和操作身份；绑定值仅来自同配方已成功步骤。`recipe.compiled`记录展开节点，`recipe.bound`记录来源节点、字段路径与解析后参数摘要。参数敏感性只整理已保存字段和封签约束，不计算敏感性或自动采样。

前端“/”菜单选中配方时直接发送例如`{"content":"汇总各研究的结论与限制因素","recipe":{"id":"conclusion_summary","parameters":{}}}`。`id`为五个目录ID之一；`parameters`省略等同空对象，按GET `/recipes`对应条目的JSON Schema校验，方案对比仍须`scope/changes`。非法参数在开始消息或执行工具前返回422，`detail`含`code:RECIPE_PARAMETERS_INVALID/path:/recipe/parameters/具体字段/message`。宿主确定性展开步骤并自动续读结论分页，最后发一次无工具解释请求（`model.request.phase=recipe_answer`）；核验失败仍按原上限修正。`recipe.requested/recipe.compiled/recipe.finished`审计标明`source:human.message|host`；不会放宽正式运行、批准与超算权限。模型历史的`reasoning_content`仍原样回传，宿主生成的工具意图不伪造模型思考。

自由提问不按关键词限制成某一配方，也不因累计读取次数或已有摘要而强制结束。有新证据的读取继续使用模型/工具/时间总预算；连续读取没有新增工具数据或诊断达到`CABLESIM_AGENT_MAX_READ_TOOL_CALLS`（默认6）时关闭下一请求工具，要求说明已完成部分与缺口。配置字段名保留，语义为连续无进展读取，task_plan不计入无进展读取。`turn.read_policy.mode=consecutive_unproductive_reads`；`turn.answer_only.reason=recipe_complete|evidence_stalled`，同时记录读取总数、连续无进展数和阈值。同批意图被中止时`plan.read_limit.reason=evidence_stalled/skipped_node_ids`标明未执行节点。显式配方有限步骤及总预算不变。

`study_baseline`过期、历史、部分成功或无保存运行时返回error，不生成方案或预览；`diagnostics[].code=BASELINE_INVALID|BASELINE_REQUIRED`，`details`与`data.baseline`含`reasons:[{code,message,...源版本/修订}]`、`requested_run/latest_run/available_runs`（最近最多3个，仅身份、状态、方法与修订）、`actions:[{id,label,target,workspace_id,study_id,module,requires_human:true}]`和`stale_reference_allowed:false/proposal_executed:false/preview_executed:false`。运行摘要的`usable_as_baseline`仅表示运行级状态满足，扫描/批量仍须选成功主工况。常见原因包括`METHOD_VERSION_CHANGED/METHOD_UNAVAILABLE/MODEL_VERSION_CHANGED/INPUT_REVISION_CHANGED/STUDY_INPUT_CHANGED/PARTIAL_SUCCESS/HISTORICAL_BASELINE/SESSION_REVISION_MISMATCH/MODULE_MISMATCH`。动作`rerun_study`指导工作台先更新升级的方法/型号来源、核对工况，再人工重算保存；`new_session`指导重算后新建当前研究会话。任务等待`missing_input`；显式配方的下一请求无工具，自由提问可继续读取诊断证据或处理其他目标，过期基准仍不执行试算；解释仍失败时由宿主返回该可执行诊断并记录`answer.diagnostic`，不会只给“模型解释未通过核验”。本轮不允许把过期基准作参照试算。

方法发行变化阻断预检或试算时，`diagnostics[].code=METHOD_RELEASE_CHANGED`，data及details保留saved_method/installed_method、准确方法名和retry_requires_human，data.preflight_executed=false。宿主停止本批后续节点，plan.blocked列skipped_node_ids；下一请求关闭工具，turn.answer_only.reason=method_release_changed，任务等待missing_input。普通回答说明尚未检查输入缺项，指导在对应工作台升级方法、核对参数并保存，再预检；需要当前结果时由人重算，不展示内部码。模型解释失败时宿主返回同一人话诊断与下一步，不拼内部码证据摘要。

模型返回的工具调用与reasoning_content保留在原历史中。宿主配方及型号预读的chat.message另标source=host，模型上下文把它们投影为host_observations（准确工具、参数与回执），不伪造缺少思考内容的assistant工具调用；旧宿主记录按计划provider_call_id识别，真实模型思考仍原样回传。步骤、计划及审计原件不改变。

同条消息中完全相同的工具、参数与输入身份已返回错误时，宿主不再执行该动作；`tool.diagnostic_reused`引用原操作，后续返回DIAGNOSTIC_ALREADY_REPORTED并进入一次收尾。修改输入或进入新消息可重新检查。

`workspace_read`支持`view:outline|locks`、`offset`（默认0）、`limit`（默认20，上限30）。模型视图按完整对象或字段分页，`next_page`给出可直接续读的参数；大纲只保留锁路径总数与读取提示，锁不是缺项。`coverage`标明当前页覆盖范围和未展开项，完整原件保留在会话工具步骤。`study_preflight`优先呈现ready、工况诊断和覆盖范围，方法限制保留省略条数及工作台全文位置；通过只代表保存方法的输入预检，不代表现场真实性、来源已批准或工程合格。同条消息重复读取相同工程修订或预检相同封签的方法时，`tool.result_reused`引用原成功操作；输入修订或方法封签变化不复用。模型仍选择任务路线；整套重复配方均引用旧回执且无待续页时，下一请求只解释结果，`recipe.finished.all_results_reused`及`turn.answer_only`记录原因。

OpenAPI的`x-sse-events`使用指向本扩展内`$defs`的完整JSON Pointer，包含discriminator映射；无需生成客户端时忽略引用警告。真实自由问答回归命令：设置`CABLESIM_AGENT_REAL_USE=1`和`CABLESIM_AGENT_REAL_USE_OUTPUT=.data/agent-live/real-use-r21.json`后运行`python -m pytest -s -q tests/test_harness_free_questions.py`；经发布库隔离副本、正常方法升级接口和平台凭据路径调用实际模型，包含三种自由问法、首次索引请求与实际OpenAPI客户端生成。

`run_read/study_read(run_id)`可由本工程保存运行反查研究；显式研究或会话绑定冲突仍拒绝。`workspace_read`与输入字段读取路径无效时返回PATH_NOT_FOUND，列可用顶层路径、最接近路径和下一步。会话内重复`run_read`同运行、同视图及相同工程/研究版本时引用上次成功结果，`tool.result_reused`记录原操作；不会重读运行或重算。

`fem_comparison_read({run_id?,iec_run_id?,case_id?})`读取保存的IEC/FEM对照工件，或比较输入及IEC参数完全一致的两次保存运行。量值带方法、实体、工况、单位和运行/工件摘要；仅既有收敛检查通过时提供有限元偏差，未收敛保留诊断，工程批准仍为false。温度相对差用K，算术差值不是新的求解结果。省略运行时读取最近有限元运行并搜索最多20个IEC参考档；未匹配明示缺项。`propose_fem_verification({run_id,case_id?,capability?,parameters?,title?})`为当前保存工况生成新建研究方案，方法为封签的iec-thermal-field或iec-fem-comparison，IEC参数由宿主绑定。边界、网格和来源须明确，缺项定位字段；不从CAD显示范围推断求解边界。人保存研究后仍须预检、确认核时并在工作台提交超算；Agent不提交、不求解、不自动批准。

任务事务和只读工具对sqlite_busy最多尝试3次（短等待），读工具重试记录`runtime.retry`异常类别；方案/试算不自动重放。MemoryError及其他sqlite运行异常降级为已取得的有界工具证据摘要，`harness.error`记录异常类别，无可用证据时明示缺项。持久资源不足时SSE仍给出诊断与摘要；无法写入的事件不声称已保存，未完成意图继续由既有对账流程处理。GET会话在一致数据库快照内分块输出JSON，不构造整份记录；大工具原件仍在steps/results，`tool.observation`副本限6KiB并给出原步骤引用与内容摘要。

SSE每个事件恰为`event: 类型`与`data: 单行JSON`，空行分隔；中文JSON保留字符，字符串内换行转义。事件data字段：

回答核验审计通过会话GET的`events`读取：`answer.rejected.data`含`turn_id/phase/attempt/draft/issues`，issue含`code/rule/fragment/start/end/value/unit/message/available_values`；凭据已隐藏。草稿仅供审计，不是回答。`answer.repair`记录实际重写次数与反馈，`model.request.phase`区分`tools/repair/closing`，`answer.accepted.matches`记录量值来源，`answer.fallback.sources`记录确定性摘要来源。核验沿用下列字段；名片渲染另消费首个message.delta中的object_refs；若增加核验诊断面板，只读取审计事件。

数值按回答实际书写精度与证据舍入一致时接受（含科学计数法及K/°C换算）；例如保存338.6719999639408 K可写338.672 K或65.522 °C。载流量余量不误当作允许电流，直接引用须来自current_margin，不能把负荷值冒充余量；差值优先用同句两个证据锚点，同段跨句仅在恰好有两个不同量值、无其他竞争操作数时推导，否则要求模型明确写出两数。各层参数列表共享末尾单位时，每个数仍按该单位核验。已观察到的名片名称、研究title及验证行variant原文无论有无引号均作身份引用；名片内的精确3×35等规格片段可用于紧凑列表，不因此授权独立的35 mm²或110 kV工程量。匹配审计保留源字段路径，新增未加引号名称规则evidence_object_name；编造电流、算错差值、部分复现夸大为已验证继续拒绝。修正反馈要求只改缺证据的片段，保留已有结论与输入依据。真实草稿的脱敏静态回放位于tests/test_harness_live_evidence.py，不读实时会话文件或请求真实模型。

```text
message.delta    {text,object_refs?:ObjectCard[]}  # 首个分片附带，本条回答内保留
tool.call        {id,tool,title,arguments}
tool.result      {id,status:"ok"|"error",summary,next_actions,diagnostics?:[{code,message,path,recoverable,evidence_refs,details}]}
proposal.created {id,title,changes:[{path,label,before,after,unit}],checks,kind?,type_id?,base_revision?}
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

模型默认只收到宿主工具；插件目录只含工具名和中文说明。`plugin_inspect(tool)`或指定`plugin_id/capability`成功后，会话`enabled_tools`列出后续启用的插件能力，完整注册表仍由`/tools`提供。`workspace_read(paths)`读取大纲或指定字段；`run_read`支持`entity/key/case_id`；`study_preview`支持`proposal_id`，选择/批量工况还须原`run_id/case_id`。完整结果保留在步骤，审计副本与进入模型的单项结果最多6KiB，超限明确标注并给出继续读取提示。

每次请求审计增加`turn_id/request_number/phase/definition_bytes/prompt_bytes`，`model.result`记录对应实际`usage`；`phase=closing`为一次无工具收尾。预算规则统一见[模块设计 §14.3](../design/MODULE_DESIGN.md#143-权限保存与预算)。会话预算`scope=message`，done报告本条消息已报告token，`session_totals`保留会话合计；提供方缺失用量时`usage_complete=false`。SSE工具卡片事件字段保持不变，完整结果在`results/steps`读取，`tool.observation`为有界审计副本。未知预览仍保持unknown，不重新执行。

`tests/test_harness.py`保留历史离线回归，不作为Agent功能验收；真实使用入口见下段，通过平台读取系统凭据，不要求把密钥放入环境变量。

同条消息中已成功的study_preflight范围，只有再次核对当前输入修订与实际方法封签一致后，才从后续模型工具参数中排除；其他研究和模块仍可检查。省略study_id与会话研究等价，省略module与null等价；显式其他模块不合并。审计preflight.scopes_satisfied保留范围、来源操作及封签重验事实；模型仍请求已完成范围时引用原工具回执，不再执行，输入或来源变化则重新预检。此规则覆盖自由问答及回答修正，不按用户问法分流。

模型主动选择的有限配方在成功完成且没有待续页后，即进入无工具解释请求，不再等待同一配方重做一次才收尾；有显式task_plan多目标时，全部目标已有成功回执才收尾。回答仍说明已覆盖与未覆盖范围，数值证据不足时沿用只读修正回路；不扩大配方的权限，也不按自然语言关键词替模型选配方。

Agent功能验收使用真实已配置deepseek-flash和发布库隔离副本：PowerShell先设`$env:CABLESIM_AGENT_REAL_USE='1'`，再运行`python -m pytest -q -s tests/test_harness_real_use.py`。串起待办配方、真实方法发行变化诊断、型号单项提案→人工批准→普通工作区history/undo撤销；待办最多2次模型请求，其余最多8次。每阶段记录模型/工具次数、耗时、回答、名片及实际审批修订，保存到`.data/agent-live/real-use-r20.json`。只复用来源库的Windows凭据账户标识，由平台鉴权，不读取或复制密钥；不写8100/8200，不提交求解作业，临时服务关闭时核对端口。来源库或模型不可用时明确未覆盖，不改用假数据；默认不开真实模型计费开关。已有离线回归保留，但不作为真实使用验收证据。

只读插件依据查询使用`plugin_query({plugin_id,capability,input?,view?,offset?,limit?})`：不带input时读取安装清单的standalone_schema，或包内已封签且$id匹配input_schema的唯一JSON查询契约；schema标识字符串不是参数定义，契约缺失须明确诊断。带input时经过实际`/api/plugin-queries/{plugin_id}/{capability_id}`入口，核对封签、read_only和本机执行限制。目录中四列记录为此类查询；不是plugin_inspect的工具名。该宿主已登记的只读POST可由platform_read读取，其他POST仍是人工操作；模型不能用参数改变权限。返回页码、条款、版本和实际依据，契约本身不当作证据。

workspace_read指定容器路径时同时投影其中已有标量的明确单位；宿主layout_template的depth/spacing按其保存契约投影为m，读投影不扩展可编辑字段。study_read提供保存输入的input_fields和按封签参数契约产生的parameter_fields，不从数值后缀猜单位。冻结运行摘要保留负z原坐标与其埋深口径。领域provenance及保存方法参数source/geometry_source的声明量值只可在明确引用来源、文献或工程参考条件时引用，不能作计算结果或已批准输入；实际来源年份与方法版本是身份，不作为工程量。依据库record的quantity.unit与value沿用实际回执，不补默认值。数值列表不跨逗号借单位，已核验的同一推导量可在相同对象范围内复述；未知值、错误推导及过度验证宣称仍拒绝。

`inbox_read(view:"groups")`提供紧凑分组视图：groups含category、origin、原因原文、共同next_step、handled_by、requires_human_approval和members；members保留每个object、title、created，home与object不同才重复附带。只合并相同原因和相同人工动作；offset/total仍按对象计数，next_page保持筛选、view和inbox_digest。方法引用另由method_refs提供实际名片。items视图和原配方默认行为保持兼容，普通回答优先使用分组视图；未展开条目照常注明。

真实回答成对回归入口为`tests/test_harness_answer_real_use.py`，真实索引操作入口为`tests/test_index_incremental_real_use.py`；均须显式CABLESIM_AGENT_REAL_USE=1并指定发布库隔离来源。每个问题保留实际次数、耗时、首稿核验和修正记录，不以离线模型通过替代真实验收。提供方只复用经过核对的TLS信任上下文，证书文件身份或环境变化时重建；每次请求的HTTP客户端仍关闭，不缓存密钥或绕过证书校验。

## 统一索引

复现验证前端接入：插件“验证”页签读取plugin的validation关联，按target.subtype区分清单声明和保存复现；Relation.reason已带状态、关键偏差与出处，完整结构见target.validation。现有关联面板位于插件“使用情况”页签，需要前端将验证引用放到“验证”页签；source.kind=reproduction_library的名片按kind/id导航到该算例结果页（`/validation/{id}/results`），并以validation.snapshot_digest保留当前引用版本。本接口不返回页面地址。

kind=validation的查询及plugin的关联优先展示有保存结果的目标，其中已有收敛证据的先展示，再展示其余复现目标和清单声明；同级沿用原更新时间顺序。这个顺序表示证据可供读取，不表示复现状态通过，partial与超限仍保留原值；避免精度查询先读完清单声明而漏掉真实算例。

`backend/index/`在同一只读数据库快照中投影已有元数据，不初始化表、不迁移数据、不求解、不刷新远端作业，也不加载厂家原件、结果正文、计算书HTML或场数组。仅研究配置与运行的冻结方法/锁/型号引用参与当前性检查。页面导航由前端按kind换算，API不返回地址。

索引另保留一份不超过8MiB的已核验投影，避免研究详情的大响应淘汰侧栏元数据；查找仍要求相同数据库提交代次、源码通知代次、复现库及作业回执身份，变化立即重建。重建的短期只读连接启用至多1GiB文件映射，降低SQLite跨越大运行正文去读取后置元数据的页面复制开销；不把正文读入Python，不增加常驻连接，退出连接即释放映射。Index.last_build.source_timings记录各表投影耗时和行数。发布库副本的并发页面/冷关联/热列表实测入口为`CABLESIM_AGENT_REAL_USE=1 python -m pytest -s -q tests/test_index_read_real_use.py`，逐请求记录在CABLESIM_AGENT_REAL_USE_OUTPUT指定的.data文件中。

同一投影身份只解码一次，API只读投影借用该对象；向其他模块提供snapshot时复制，待办排序不修改缓存。复现库保留一份经过snapshot完整核验的快照，仅根目录、index.json字节摘要、当前快照身份均一致且读取前后稳定时复用；发布、损坏、修复仍沿原失效机制重新校验，不把库故障当空数据。关闭索引生命周期时释放这些缓存。
数据库提交后按各来源的修订、状态与摘要比较行身份，仅重读变化行；删除行立即移除。运行仍核对冻结输入/输出摘要，封签或源码变化仍重新判断方法当前性；身份不完整的旧表回退完整投影。变化对象沿实际引用传播，重新求值受影响的关联与待办，新目标会重试未解析关联；未变化的名片、冻结元数据和当前性可复用，不用TTL，也不持有新数据库连接。last_build新增affected_objects、reused_run_states；source_timings记录loaded_rows/reused_rows。真实操作验收另用独立完整投影逐项对比全部名片、关联、未解析项和待办，不能只比较数量或响应时间。
元数据投影复用宿主ReadResponses的有界缓存；SQLite提交与封签源码通知使缓存失效。方案有效期到点、调度回执内容变化、复现库index.json字节或当前快照文件身份变化也会触发重建，不用固定TTL保留旧待办。三个接口与Agent工具共用该投影。宿主完成数据库初始化后，在同一study-read-warmup后台线程先预建统一索引，再预热研究目录；索引路由启动阶段最多等5秒再宣告服务就绪，把冷构建等待移出首个页面请求。只变更Agent任务或方案且非Agent元数据及封签来源身份完全一致时，复用已校验清单和运行当前性；研究输入、运行、资源与方法变化仍重建对应状态。不加载历史运行正文、不持有额外数据库连接。构建期间其他读取最多等待3秒，超时返回503、Retry-After: 1及`detail:{code:"INDEX_BUILDING",state:"building",message,max_wait_seconds:3}`，不返回部分items。内存不足返回INDEX_RESOURCE_PRESSURE；预建失败后普通读取仍可重试，保留原数据。

运行回执按批读取：本机作业计划存在时仍调用宿主execution_status读取最新小型回执，始终重新检查计划是否存在；随附超算证据使用宿主evidence_index校验的目录，一批多项不逐项重复核验。仅目录、见证摘要、schema全部字节一致时复用已校验目录，改变任一文件立即重验，不用TTL或仅mtime信任，不读取大场工件或提交作业。缓存仅一份小目录，API回执与宿主原读接口保持一致。Index.last_read记录锁等待、回执、复现目录、缓存及解码耗时和cache_hit，便于区分热读取与来源变化后的重建，不作为工程证据。真实测速与待办验收：设置CABLESIM_AGENT_REAL_USE=1、CABLESIM_AGENT_REAL_USE_OUTPUT指向本轮.data记录，运行`python -m pytest -s -q tests/test_index_real_use.py`；发布库隔离副本经实际HTTP接口，首次读取与10次热读取分别记录，热预算200 ms，随后调用已配置的真实模型和比对已保存超算回执。


| 接口 | 请求与结果 |
| --- | --- |
| GET `/api/index/objects` | 可选kind、q（名称或ID，最多200字符）、limit（1–100，默认50）、offset（非负）；返回`{items:ObjectCard[],total,source_errors:[]}`，按更新时间降序 |
| GET `/api/index/objects/{kind}/{id}/relations` | 返回`{uses:Relation[],used_by:Relation[],unresolved:[{role,freshness:"unknown",reason}],source_errors:[]}`；对象不存在404 |
| GET `/api/index/inbox` | 返回`{items:InboxItem[],counts:{review,stale,missing,running},source_errors:[]}`；同一类别、来源与对象只出现一次 |

`ObjectCard={kind,id,name,version?,revision?,status:{code,label,reason?},source?:{kind,label},updated,parent?:{kind,id,name},subtype?,validation?}`。kind包含project、study、type、cable_version、asset、run、job、delivery、plugin、validation、document、proposal、agent_task，以及供运行引用的input_snapshot。asset的subtype为material、component、assembly、installation、study_template、rule。缺少持久时间或可选字段时为null，不编造更新时间。input_snapshot与对应run共用ID、kind不同；超算job来自本机保存的调度回执，收敛工作流job用`convergence:<保存ID>`。系统教学型号明确标示来源，不称厂家实测。

validation分为`subtype:declared|reproduced`。declared保留插件清单原声明，validation=null，不代表执行成功。reproduced来自宿主同根目录`CABLESIM_REPRODUCTION_LIBRARY`（默认`.data/simulation/library`），调用ReproductionLibrary.snapshot校验当前不可变快照；每个目标一张卡，id/title保持原文，状态为reproduced/partial/missing_data/capability_gap，中文为已复现/部分复现/缺资料/能力未覆盖。subtype表示来自复现库，不表示目标通过。`source:{kind:"reproduction_library",label:"保存的复现结果"}`，updated取快照时间；前端按此来源导航到验证对象的家，不按清单声明的父插件导航。

`validation={snapshot_digest,citation,reference_location,source_pages,scope,metrics,total_metrics,outside_tolerance,convergence_passed,limitations,runs,report_tolerance}`。metrics最多三条关键结果，按超限、不可直接比较、已匹配、未评估排序，保留`id,variant,quantity,unit,reference,open_source,comsol,difference,relative_difference,relative_difference_percent,status,source,tolerance`；not_comparable原样保留，不能把其偏差当作同条件验证通过。relative_difference保留原比值，percent为其×100。total_metrics及outside_tolerance统计所有原行，未展示明细保留在原验证页。source_pages只取保存输入的pdf_page/printed_page与出处；convergence_passed缺证据为null。runs保留plugin_id/plugin_version/method_version/source_sha256/engineering_approval已有字段，不替换为当前安装版本。report_tolerance缺失为null，不能当作项目门槛；limitations保持来源限制。数字为公开复现量值，不是当前工程计算结果。

按保存runs[].plugin_id去重建立plugin→validation（role:validation），pinned.digest固定复现快照摘要；一张验证卡可以被多个插件引用，不按名称猜插件。freshness:current表示引用对应当前库快照，不表示当前安装插件版本通过，保存方法版本见runs。没有保存插件引用的缺资料目标仍可查找，但不猜关联。JSON损坏、快照摘要不符、被指向的文件缺失或格式不合法时，kind=validation列表及真实验证对象的关联返回503 `detail:{code:"INDEX_REPRODUCTION_INVALID",state:"invalid",source:"reproduction_library",message,reason}`，不返回空复现库、旧卡或半成品；明确按清单声明的完整ID或名称查询仍可读取declared名片，其关联也照常返回。其他类别、跨类别搜索、首页与待办返回200，source_errors带上述错误；插件保留清单声明的validation关联，同时unresolved增加真实复现库错误，不猜受影响算例。待办missing增加一条`origin:"validation"`、标题“复现库校验失败”，对象`kind:"validation",id:"reproduction-library",status.code:"unavailable",source.kind:"reproduction_library"`代表库状态而非算例，前端应导航验证首页；inbox_triage给出在验证页核对当前快照并由复现库维护人修复的下一步，不触发计算。修复后下一次读取删除错误与该待办。读取期间快照变化也限定在此源，可重试。尚未登记index.json时不制造复现目标。失效检测读小型目录并检查当前快照文件身份，重建才读取并校验完整快照；不读网格或原始求解工件、不运行求解器、不持有额外数据库连接。

对象工具与索引回归使用tests/conftest.py共享library夹具，为test_harness*/test_index*生成隔离复现库，其他模块保留各自环境；通过CABLESIM_REPRODUCTION_LIBRARY隔离。reproduction_data提供同源案例及快照发布函数，夹具含完整长限制、偏差超限及测试中构造的损坏快照，不依赖.data/simulation/library发布时机，也不从另一测试文件导入library夹具。一条命令：`python -m pytest -q tests/test_index_reproductions.py tests/test_harness_validation.py tests/test_harness_index.py tests/test_harness_recipes.py::test_digest_pages_saved_quantities_and_cold_catalog_avoids_input_contracts`；不用真实密钥或原生求解器。

研究只使用最新保存运行，状态在索引快照内算一次：没有运行为not_run；运行未结束为running；成功且宿主`read_models.run_state`判为当前为current；成功但方法/锁/研究配置/工程修订/绑定型号变化为outdated；失败、中断或部分成功为failed。outdated.reason必须非空，复用`version_status.inspect`的方法与型号版本诊断，再补已保存输入修订变化；同版本发行摘要改变也明确说明。索引不验证结果正文完整性，也不提供工程量，读取工程结果仍走原运行证据核验。前端各处消费此study.status，不重新推断“正常/历史”。

`Relation={role,target:ObjectCard,pinned?:{version?,revision?,digest?},freshness:"current"|"outdated"|"unknown",reason?}`；uses是该对象保存的引用，used_by是反向引用。主要role为workspace、type、method、cable_version、source、study、input_snapshot、delivery、source_run、specification、source_design、published_cable_version、source_document、source_proposal、dependency、validation、agent_task；型号改动方案以type关联目标型号，pinned.revision记录基准修订。厂家来源保存了document_id时才建立关联，页码写在reason；原件摘要入pinned.digest。保存的ID未登记时，target名片标unknown；从未保存目标ID时放入unresolved，不能造一个目标来填Relation。不按名称配对，适用性仍由原工作台核验。

型号设计资源角色读取type_resource_bindings（cablesim.type-resource-bindings/1），resource_id关联资源，version/content_sha256固定版本与摘要。复用型号工作台的_resource_targets：仅枚举结构使用的材料及已核对标准目标，当前材料fingerprint与绑定input_digest不同则material关联outdated、reason="材料参数在绑定后被修改"；材料目标已移除则说明解除引用，旧绑定缺输入摘要为unknown。工作区投影保留domain.provenance['/execution_standards']供宿主识别已审核的cablesim.execution-standards/1声明，和要求审核回执共同判定标准身份，不另算摘要；未声明或未批准的标准保持unknown。部分绑定中每个未绑定目标保留unresolved unknown，reason含“未绑定资源”和目标名称，即使库里同名也不自动补配。已绑定资源的reason显示资源名称与版本，内部asset_id仅在结构化引用中保留。投影只增读材料事实、结构引用、执行标准声明与要求审核回执，不读运行正文。

发布关系来自engineering_type_releases：published_cable_version固定资产version/content_sha256；source_design使用发布记录冻结的规格书payload.source_design.revision，旧记录回退payload.revision，不使用当前设计或提交修订代替发布修订。sources.reference结构化source_design由这条关系消费，不再重复列为缺document_id的unknown来源；与发布记录submission/digest完全一致的宿主规格书出处由source_specification消费，固定发布规格书摘要。新建来源以[型号工作区引用契约](../../frontend/src/features/type/README.md#材料执行标准与发布版本引用契约)为准：type_origin_reference的保存ID建source关联（含从型号库复制的固定资产版本）；type_creation.kind=standard读source.methods[].method封签身份，import读source.document_id/proposal_id/references的文档、提案和页码。缺字段保持unknown，空白设计不猜来源。索引不持有额外SQLite连接；复用的研究只读缓存由research.close在workspace_store.close之前关闭，避免只读连接晚关留下WAL。

`InboxItem={category:"review"|"stale"|"missing"|"running",origin:"agent"|"document"|"asset"|"type"|"study"|"job",title,object:ObjectCard,reason,created}`。review汇总有效未决定Agent方案、厂家提案、draft/reviewed资源、submitted/approved型号规格书；人作出决定或发布后，下次读取即消失。stale为过期研究及其原因；missing为不完整型号与失败/中断资料提取；running为研究、作业、资料提取或批量数据集的保存状态。created缺少持久日期时为null。不存在待办记录时items为空且四项计数均为0。
