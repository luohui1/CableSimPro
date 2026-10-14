# 工程库备份、恢复与版本保护

数据库的 `PRAGMA user_version=2` 标识当前宿主存储基线。版本0/1库在取得独占所有权的启动初始化中保留全部工程、研究和运行，增量建立四张Agent任务侧表，升级为2；任务表的具体职责见[模块设计 §14](../design/MODULE_DESIGN.md#14-原生-agent-harness)。计划修订不可变、事件只追加，工程事实和运行仍由原表保存。仅支持版本0/1的旧程序不能写版本2库；后续不兼容存储改动须继续增加版本并提供迁移。构造工程库对象时以及启动初始化前均用只读连接检查版本，新于程序支持范围则抛出 `DATABASE_VERSION_TOO_NEW`，不执行DDL、WAL设置或其他数据库写入。

备份使用 SQLite 在线 backup API，包含已提交的 WAL 内容，输出独立SQLite文件、SHA256及JSON元数据；不直接复制运行中的主文件。包含库内所有表：工程及版本、型号资料、厂家原件BLOB、提取/审批、运行快照、JSON工件、保存报告，以及Agent任务、计划、步骤和审计事件。模型的非敏感设置包含在备份中；密钥由系统凭据库、进程内存或环境提供，不进入数据库或备份，恢复数据库不会恢复密钥。插件程序、外部超算原始作业/数据集目录和环境配置不是数据库备份的一部分；本接口不宣称打包这些外部资产。

## 提交级变化通知与索引回退

宿主在版本2库内增加两张内部通知表和每张普通工程业务表的三个原生 `AFTER INSERT/UPDATE/DELETE` 触发器。这是附加元数据，未增加 `user_version`；通知表沿用的 `schema_version` 字段现在保存实际结构的 SHA256，而消费游标中的同名字段保存 SQLite 的结构变化计数，两者均与前述存储版本门禁不同。SQLite backup/restore 可改变内部结构计数而不改变任何建表/触发器定义，不能因此追加工程变化通知。

| 对象 | 内容与用途 |
| --- | --- |
| `_workspace_change_state` | 单行保存通知命名空间 `namespace`、行变化序号 `epoch` 和触发器覆盖时的结构 SHA256（历史字段名 `schema_version`）。摘要核对 `sqlite_master` 中的实际定义；旧计数格式在当前宿主初始化时转为摘要格式。用于判断增量窗口是否连续，不能用序号推断运行或研究状态。 |
| `_workspace_changes` | 每个受影响行记录序号、来源表、操作和旧/新行键。行键含物理主键及可用的 `id/proposal_id/task_id/workspace/study/document`；没有安全行键时记空值，索引保守比较该来源表。 |
| `_workspace_change_<表名摘要>_<insert/update/delete>` | 工程业务表的通知触发器；排除 SQLite 内部表、上述两张通知表和 `agent_` 元数据表。其他宿主连接、外部普通 SQL 同样触发，不依赖 Python 回调。UPDATE 用空值安全、区分存储类型的二进制比较，只在新旧行值实际不同时记录。 |

通知与业务修改在同一连接、同一事务内写入，提交才对其他连接可见，事务或保存点回滚会同时撤回通知和序号。它不保存字段差异、工程输入/输出正文、工件、原件BLOB或凭据，也不代替业务审计、历史版本与撤销记录；索引仍从原表读取并核验冻结摘要、引用和当前性。DDL 不逐行记录，安装或修复覆盖时追加 `source_table='*', operation='SCHEMA'` 屏障。

索引单次最多消费4096条连续通知。仅在本次 `WorkspaceStore` 事务确实留下通知时，提交前删除 `epoch < 当前序号 - 4096` 的记录，因此该次提交后最多保留4097条（含边界记录）；空事务、同值更新和已撤回全部变化的保存点不修剪、不改 epoch。这是条数窗口，不是按时间过期，也不是数据库字节上限。独立模块连接或外部 SQL 的触发器只追加，不自行修剪，需等下一次产生通知的正常宿主写事务修剪；期间可能超过4097条。消费者落后超过窗口、记录缺失或格式异常时回退完整来源身份比较，不以缺记录表示“没有变化”。

只读 Agent 回答可以记录任务、计划、步骤、事件等 `agent_` 元数据，但不能因此修改工程通知表。索引对这些较小的任务/方案身份做完整精确比较，身份包含相关事件序号；工程运行等大来源仍按通知增量读取。方案提出、批准或拒绝后，任务名片、方案状态和统一待办照常即时刷新。没有新增通知表，也没有给测试的 authorizer 或完整转储断言开例外。

备份包含这两张表、已提交通知和触发器，包含未合并到主文件的已提交WAL；索引内存缓存和消费游标不在备份中。离线恢复后重启宿主，索引首先完整比较来源并核验，再建立新的增量基线。当前通知格式的库若实际结构不变，幂等接口和恢复后的初始化均保持通知表及触发器内容不变；旧通知格式升级会在初始化中修复触发器并建立结构屏障。恢复没有通知表的旧备份时，当前宿主在启动写初始化中建立通知表与触发器，第一次索引仍完整比较，随后使用连续通知。不要手动删除通知表而保留触发器，否则后续业务写入会因触发器找不到表而失败。

外部新增表、增加列或改动触发器使 SQLite `schema_version` 改变，下一次索引读取立即完整比较。只读索引不修复数据库结构；下次正常 `WorkspaceStore` 写事务在提交前安装或修复触发器并写结构屏障，索引再完整比较一次、建立基线，之后连续提交恢复增量。未覆盖的新表不会被当成“已完整记录”；不能省略这两次可能出现的回退，也不要求工程师手动清缓存。

回退到仍支持版本2、但不认识通知的旧宿主时，已有原生触发器仍随普通业务写入追加记录；旧宿主不会修剪，通知表可持续增长，并增加写入与备份体积。它也不会给新建业务表补触发器。再次用当前宿主打开时修复覆盖、按窗口修剪并完整建立索引基线。更老且不支持版本2的程序仍受版本门禁拒绝；附加通知结构不保证任意版本降级兼容。需要降级时先备份并核对目标版本，不把通知日志当作可独立恢复工程的文件。

## 命令行

```powershell
python scripts/workspace_db.py backup --database .data/cablesim.sqlite --output .data/snapshots/library.sqlite
python scripts/workspace_db.py version --database .data/cablesim.sqlite
# 先停止使用该库的后端，将 HEX 替换为备份命令返回的 SHA256。
python scripts/workspace_db.py restore --database .data/cablesim.sqlite --source .data/snapshots/library.sqlite --sha256 HEX --confirm-replace
```

输出为UTF-8 JSON；成功退出0，拒绝/失败退出2。备份目标已存在时拒绝覆盖。恢复取得与宿主相同的OS独占锁；仍在运行则返回 `DATABASE_IN_USE`。恢复前核对SHA256、SQLite完整性、必要工程表和版本，先生成 `数据库路径.snapshots/before-restore-UUID.sqlite` 安全副本，再通过SQLite事务恢复。校验失败不替换原库。

## 宿主接口

接口在既有宿主router中挂载，所有请求/JSON响应有OpenAPI模型。时间为UTC；大小为byte；版本与ID无物理单位。

| 请求 | 输入与结果 |
| --- | --- |
| `GET /api/database/version` | 当前库版本和支持的最高版本 |
| `POST /api/database/backups` | `{request_id:UUID}`；201返回id、SHA256、schema_version、size_bytes、created、download_url；相同编号重试复用原备份 |
| `GET /api/database/backups` | 已完成且通过完整性核对的备份列表 |
| `GET /api/database/backups/{id}/file` | 下载SQLite备份，`X-Artifact-SHA256`响应头 |
| `POST /api/database/restores` | `{request_id:UUID,backup_id:UUID,sha256:HEX,confirm_replace:true}`；202表示`pending_restart`，当前库尚未改变 |
| `GET /api/database/restores/current` | `none/pending_restart/restored`，恢复完成后给出安全副本位置 |
| `DELETE /api/database/restores/current?request_id=UUID` | 取消同一待执行请求；204。不同编号返回409 |

API恢复在下次宿主启动、取得工程库独占锁后执行，早于任意模块初始化；不在活跃请求、计算线程或WAL锚连接存在时替换数据库。恢复前安全副本包含重启前最新保存的数据。前端收到`pending_restart`应提示停止编辑并重启；确认对象是整个工程库，不是单个工程。恢复凭据保存在数据库外，恢复完成后的相同请求重放不会再次覆盖数据。损坏备份在启动时仍会阻止恢复，保留原库和待处理请求，不宣称成功。

常用错误码：`DATABASE_VERSION_TOO_NEW`、`DATABASE_SNAPSHOT_CORRUPT`、`DATABASE_SNAPSHOT_INVALID`、`DATABASE_SNAPSHOT_EXISTS`、`DATABASE_RESTORE_CONFIRMATION_REQUIRED`、`DATABASE_RESTORE_PENDING`、`DATABASE_RESTORE_CONFLICT`、`DATABASE_IN_USE`、`DATABASE_IO_ERROR`。接口拒绝使用404/409/422，磁盘/权限/SQLite I/O故障为503。

## 源码封签与平台一致性

`.gitattributes` 对全部backend公共源码、SDK、插件源码和清单指定LF；插件assets使用`text=auto eol=lf`，SVG等文本固定LF，PNG等二进制保留原字节。`tests/test_checkout_seals.py` 将当前源码放入隔离Git索引，以`core.autocrlf=true`干净检出后实际执行`plugin_sdk.py verify`，不提交或改动主仓库索引。

运行中的宿主每次解析方法重新读取清单并核验源码；`/api/input-contracts`及方法调用遇到封签不符返回409和原`PACKAGE_*`错误码，清单解析/文件读取失败分别用`PLUGIN_MANIFEST_INVALID`、`PLUGIN_SEAL_INVALID`、`PLUGIN_INPUT_CONTRACT_INVALID`。旧运行不重算，已保存工程不丢失。
