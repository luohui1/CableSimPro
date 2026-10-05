# 正式宿主输入与交付接口

正式后端 `backend.main:create_app` 发布全部接口和 OpenAPI。`design/workbench/serve.py` 只挂载静态样板；输入契约、几何预览和计算书服务均由 kernel 提供。前端从 `/openapi.json` 生成类型，插件参数模式从 `/api/input-contracts` 获取，不在页面补猜字段。

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

新接口的业务错误采用 `detail: {code,message}`；字段校验沿用 `detail: [{loc,msg,type}]`，停止在具体字段。稳定代码包括 `WORKSPACE_REVISION_CONFLICT`、`DOMAIN_INPUT_REQUIRED`、`GEOMETRY_CAPABILITY_REQUIRED`、`DELIVERY_SOURCE_COMBINATION_INVALID`、`RESOURCE_NOT_FOUND`、`INPUT_OR_RESULT_CONFLICT`、`INPUT_OR_SCOPE_INVALID`，以及执行器的 `WORKER_TIMEOUT`、`WORKER_EXIT_FAILED` 等实际代码。输入契约封签失败直接返回执行器原码。HTTP 422 不产生保存或计算副作用；运行接口采用 request_id 幂等，交付可使用同样模式。

研究响应 `StudyResponse`、`PreflightResponse`、`RunResponse`、`RunPage` 明确公开身份、修订、生命周期、完整性、当前性和工件状态；插件扩展正文用 JSON 值映射保留声明类型，具体物理字段由工件 schema 定义，不手写每个插件的平行 DTO。

验证见 `tests/test_host_api.py`、`tests/test_simulation_study_tasks.py`；原生流程见 `plugin-tests/test_simulation_study_workflow.py`，求解只经 Slurm 执行。浏览器契约流程：独立验收数据库启动正式宿主后，设置 `E2E_ISOLATED=1`、`HOST_API_URL` 并执行 `node tests/browser/host-workflow.mjs`。该脚本经隔离的 Edge --headless=new / CDP 创建研究、预检、运行、重复提交、轮询、交付和实际下载，核验两种桌面宽度下保存计算书的横向溢出；结束关闭所有自有标签页并删除浏览器配置。它验证浏览器网络和下载流程，不是新前端页面操作次数或工程师耗时。
