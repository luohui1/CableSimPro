# 工程库备份、恢复与版本保护

数据库的 `PRAGMA user_version=1` 标识当前宿主存储基线。历史未标版库为0，启动时保留数据并建立现有幂等表结构后标记为1；后续不兼容存储改动须增加版本并提供迁移。构造工程库对象时以及启动初始化前均用只读连接检查版本，新于程序支持范围则抛出 `DATABASE_VERSION_TOO_NEW`，不执行 DDL、WAL设置或其他数据库写入。

备份使用 SQLite 在线 backup API，包含已提交的 WAL 内容，输出独立SQLite文件、SHA256及JSON元数据；不直接复制运行中的主文件。包含库内所有表：工程及版本、型号资料、厂家原件BLOB、提取/审批、运行快照、JSON工件和保存报告。插件程序、外部超算原始作业/数据集目录和环境配置不是数据库备份的一部分；本接口不宣称打包这些外部资产。

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
