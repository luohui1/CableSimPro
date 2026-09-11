# CableSimPro Plugin Specification · 0.1 draft / host API 1

状态：可执行的第一方适配器契约；尚未冻结为公共稳定标准。先在同一仓库验证
Model → Mesh → Solver → Result → Report 的纵向链，再拆 SDK/注册中心仓库。
此版本只接受精选目录与随源码交付的第一方适配器，不执行下载来的任意代码。

## 1. 三层产品，四类证据

- 宿主：工程状态、revision、锁、审批、审计、项目插件锁、任务和工件。
- 插件：领域能力、明确输入/输出、适用范围、受控 UI 插槽；不拥有工程数据库。
- 市场：发现、依赖计划、许可/权限审查、安装登记、项目启用和版本信息。

四件事不得混为一谈：来源身份；文件完整性；软件接口测试；数值/试验验证。
SHA-256 只能证明与所信任清单一致，不证明作者身份、无恶意代码或工程正确性。
目录当前不提供签名、认证、销量、评分或厂家数据背书。

## 2. 数据与模型契约

复用 `backend/foundation/contracts.py`，不另造不兼容的 Quantity、AssetRef、PayloadFile。
- 所有几何、网格坐标及物性采用明示单位；圆形配方几何为 m。
- STEP 适配器使用 mm，必须在 geometry.json 明示 CAD 单位；报表体积为 m³。
- Quantity 区分绝对温度与温差，degC 的偏置不能用于温差。
- 当前输入是 project_input_snapshot，不伪装成厂家发布资产。
- `CircularRecipe` 的稳定 uid 对应语义层，不使用临时 CAD 面编号作为领域身份。
- 真实设计、分析简化、展示几何分别保存。GLB 不冒充 B-Rep，网格不冒充温度场。
- 今后非同心、多芯、铠装和安装域应发布新 schema；不得静默套当前六层物理映射。

## 3. Manifest（机器定义：manifest.schema.json）

必须包含 publisher.name ID、独立插件版本、host API major、类别、运行方式、
平台、输入输出契约、effect、权限、精确依赖、上游运行包、许可证、适用边界和文件哈希。
当前 release version 使用稳定 x.y.z 子集，不接受 latest、星号、版本区间或预发布字符串。
一个 catalogue 暂保留每个 ID 的一个版本；依赖图只使用准确版本，支持循环、缺失、
冲突和深度检测。公共多版本索引与版本迁移另行实现。

分发状态与运行状态正交：

| 维度 | 状态/含义 |
|---|---|
| distribution=core | 沿用原宿主能力，不经本页卸载 |
| bundled-adapter | 代码已随可信源包交付，可审查并登记安装 |
| roadmap | 尚无适配器文件，不提供可用假象 |
| installed | 已确认文件版本和权限，不表示原生运行包已安装 |
| metadata_ready | 精确上游包版本存在，尚不证明 DLL/so 可加载 |
| succeeded | 某个确定输入上完成了真实执行，仍受模型边界限制 |
| numerical validation | 独立登记指定基准证据，不自动产生合规结论 |

## 4. 权限与 effect

V1 仅支持 project.read、project.propose、study.run、artifact.read、artifact.write。
read / proposal / study / artifact 的 effect 显式声明，proposal/study/artifact 必须有对应权限。
没有 project.approve、解锁、凭据、任意 SQL、shell、路径或 URL 权限。
市场安装必须逐项确认整个依赖闭包的准确权限。项目 enable 是独立确认，不执行任务。
新插件入口使用统一 Invocation 契约；confirmed 表示明确发起本任务，不赋予自动
批准工程修改的权限。GUI 已接入；现有 Agent 仍使用旧宿主运行时，新目录工具桥接尚未完成。
旧 model.generate 仍只创建原宿主的待审批变更。

当前只对第一方受控入口实施上述能力边界，**不是对恶意 Python 的安全隔离**。
进程仍具有运行该服务的 OS 用户权限，不能加载第三方不可信代码。

## 5. 生命周期与安装计划

GET catalogue → POST install-plan（只读预览）→ 明确权限/许可确认 → POST install
→ 项目 enable → 冻结插件锁 → 明确 invoke → 验证工件 → 保存结果。

安装计划哈希覆盖 catalogue、状态 revision、依赖顺序、版本/哈希、权限及许可要求。
审批时重新求闭包/核文件/CAS；不执行 pip、postinstall、脚本或网络下载。
同 ID/版本的已安装摘要不同必须拒绝，不能用重新安装掩盖同版本替换。
将来正常升级必须新版本、审查权限差异；已有项目保持旧锁，不自动迁移研究。
卸载前拒绝仍被安装依赖或项目引用的插件；保留历史任务和工件。
不承诺“停用 core 即封禁兼容 API”：旧入口仍是宿主迁移兼容面，单独登记。

## 6. 项目锁（project-lock.schema.json）

锁包括 project ID、工程 revision、插件锁 revision，以及每个确切插件的版本、
release digest 和权限。核心封装作为有效内建 pins；可选依赖按项目持久化。
只读导出不创建任务、不更改工程。启用/停用改变插件锁 revision，而不是电缆参数 revision。
工程修改后旧 lock hash 失效。源网格/温度场必须属于本工程，且源快照摘要和生产插件
版本仍匹配；跨项目、改材料后复用旧输入、被篡改的工件均拒绝。

## 7. 运行和协议

宿主能力沿用 `/api/runtime` 的同一实现，不复制算法。
原生适配器通过固定白名单 `python -I worker.py`：stdin 为有界 JSON，cwd 为独立 job 目录。
无自定义 entrypoint 字符串、eval、任意命令行或调用方文件路径。
超时终止 worker。只传 PATH/SystemRoot 等最小环境，不继承 API Key、代理、PYTHONPATH、DB 路径。
这是进程级故障隔离，**不是 OS sandbox**；尚无网络命名空间、内存/CPU/磁盘强配额或通用取消队列。
首次 API 采用请求内等待，客户端超时不等于取消任务；请求 UUID 查询/重放禁止重复启动。
同 ID 不同请求拒绝；失败/中断重新提交必须使用新 UUID。服务重启将 running 标记 interrupted，
不会把未知结果自动改成功。仅支持一个服务进程持有一个本机项目数据库。

## 8. 工件与证据

每个运行保存：输入快照、工程 revision、来源 hash、插件 pin、lock hash、实际 Python/
运行库版本、开始/结束时间、状态、warnings、每个输出的 path/size/SHA-256。
任意旧工程状态不会把插件结果自动晋升为当前载流量。
若任务期间工程发生变化，结果保存为 stale，允许只读归档但不可供新研究直接复用。
下载与下游读取均校验归属、相对路径、实际文件字节；无数据库目录任意下载接口。
运行记录为本机审计，不是防篡改签名审计。

## 9. UI 插槽

command / inspector / canvas / results / artifacts 是允许的贡献位置。
V1 catalogue 展示贡献声明；原生适配器先通过折叠验证台和工件输出接入。
**尚不提供**任意远程 React bundle 注入或完整动态 inspector/canvas 渲染 SDK。
下一步 UI 适配应复用宿主控件、对象树、标签、错误、空状态、进度语义、单位和焦点规则。
禁止每个插件增加一级导航、常驻 KPI 卡墙、自己的项目数据副本或越权自动审批按钮。

## 10. 兼容与公共市场发布门槛

以下全部完成前，不开放第三方自助分发：发布者身份与命名空间占有证明；不可变发行包；
签名根与密钥轮换；目录过期/回滚/撤回防护；依赖与 SBOM；可复现构建；许可审查；
隔离执行；资源限制；兼容矩阵；漏洞响应；卸载/升级/回滚语义；工程验证证据。
计划采用 TUF 元数据角色或兼容实现管理分发信任，不自制“有个 hash 就安全”的更新器。
当前没有 TUF/OCI 服务器或签名验证实现，不能标为已部署。

## 11. SDK 与开发流程

```sh
python scripts/plugin_sdk.py verify
python scripts/plugin_sdk.py manifest plugin.json
```

新增第一方适配器：先更新契约/测试 → 受控输入模型与固定 handler → 错误/超时/来源校验
→ 几何/数值基准 → 清单准确范围 → 安装/项目锁/API/UI 流程验证 → 发布新版本。
`seal_plugin_catalog.py` 是维护者预发布清单生成工具，不是用户安装器，更不是签名器。

插件、宿主 API、领域 schema、算法、上游库版本分别记录，不混成一个 UI 版本号。
标准正式冻结前，新增破坏性字段需要在本分支升级契约并明确迁移策略。
