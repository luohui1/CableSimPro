---
title: 升级与备份恢复
description: 升级到新版本、回退到上一版本，以及工程库的备份与恢复。
sidebar:
  order: 4
---

## 升级

1. 停止正在运行的服务（在启动窗口按 Ctrl+C）。
2. 把新版安装包解压到**另一个**目录。
3. 用安装时保存在解压目录之外的那份配置文件，运行新包里的入口：

   ```powershell
   .\start.cmd --config D:\CableSimPro-config\release.toml
   ```

   ```sh
   sh start.sh --config /etc/cablesimpro/release.toml
   ```

升级时会发生这些事：

- 新程序装进 `数据目录/programs/<新构建编号前16位>/`，旧程序和它的环境保留不动。
- 启动新版之前，先用 SQLite 备份接口给工程库做一份快照，放在 `数据目录/release-snapshots/`，并核对完整性和 SHA256。
- 新版只有在界面和接口都检查通过后才成为当前版本。健康检查前失败会停止新进程、恢复升级前的工程库，旧版本保持为当前版本；升级过程中被强制中断，下次启动会自动从未完成的升级中恢复。
- 工程库版本比程序支持的更新时，任何迁移之前就会拒绝启动。

## 回退到上一版本

只在升级后确实需要回到旧版时使用。停止服务后，用**当前版本**程序目录里的解释器执行：

```sh
<数据目录>/programs/<当前构建编号前16位>/.venv/bin/python <数据目录>/programs/<当前构建编号前16位>/scripts/run_release.py --config /etc/cablesimpro/release.toml --rollback --no-browser
```

Windows 使用 `.venv\Scripts\python.exe`。回退会恢复上一版程序和它的升级前工程库；回退前仍会保留当前工程库的安全副本。

:::caution
**升级之后新增或修改的工程数据不在升级前快照里**，回退后看不到这些数据，需要时可以从保留的安全副本中核查。存在未完成的升级或已排队的数据库恢复请求时，回退会被拒绝，先完成或取消对应请求。
:::

## 备份工程库

备份包含整个工程库：厂家原件、输入版本、运行结果、内嵌工件和计算书。它不是插件安装包，也不包含超算上的原始作业目录。

**在界面里**：打开“设置 → 数据与备份”，点 **立即备份**。完成的备份列在同一页，可以下载。

**用命令行**（在程序目录中，用其 `.venv` 的 Python）：

```sh
python scripts/workspace_db.py backup --database <数据目录>/engineering.sqlite --output <备份目录>/library.sqlite
```

命令输出 JSON，其中有备份文件的 SHA256，请和备份文件一起保存。目标文件已存在时拒绝覆盖。备份使用 SQLite 在线备份接口，包含已提交的数据，服务运行时也可以执行。

## 恢复工程库

**在界面里**：在“设置 → 数据与备份”选择一份备份发起恢复。恢复不会立即替换当前工程库，而是在**下次启动**、取得工程库独占锁之后执行；替换前会先保留一份当前工程库的副本。待执行的恢复可以取消。

**用命令行**：先停止服务，再执行：

```sh
python scripts/workspace_db.py restore --database <数据目录>/engineering.sqlite --source <备份目录>/library.sqlite --sha256 <备份时返回的SHA256> --confirm-replace
```

服务仍在运行时会返回 `DATABASE_IN_USE`。恢复前会核对 SHA256、SQLite 完整性、必要的工程表和库版本。

不要手工复制运行中的 `engineering.sqlite` 主文件来代替备份。

## 进一步阅读

- [离线发行技术说明](../reference/release-installation/)：升级状态文件、回退条件和失败处理的完整规则。
- [工程库维护技术说明](../reference/database-operations/)：备份内容、版本门禁、接口和错误码。
