# 离线发行构建、安装与回退

发行入口是 `scripts/build_release.py`、`scripts/install_release.py` 和
`scripts/run_release.py`。`scripts/run_demo.py` 的开发构建和数据行为保持原样。

## 构建与发行范围

为 Windows 10 / 11 x64 和 Linux x86_64 分别构建 ZIP。**安装端不需要预装 Python、Python Launcher、Node、npm、编译器或 Git**，也不需要管理员权限。
包内 `runtime/python` 是固定的 64 位 CPython 3.12.15（python-build-standalone，20261003）；
`start.cmd` / `start.sh` 直接运行这个解释器，不寻找系统的 `py`、`python` 或 `python3.12`。
系统只有 Python 3.11 或完全未装 Python，不改变发行入口选择。
Linux 使用兼容 wheel 的 glibc 系统；发行包包含 CAD 需要的图形运行库和对应许可证，
`runtime/native-manifest.json` 记录实际依赖的最低 glibc，安装前核对当前系统版本。
发行包不替换系统 glibc、动态加载器或硬件驱动。CI 的干净 Ubuntu / Windows runner
会实际验证安装和 CAD 导出。包内运行时、标准库、venv、ensurepip、pip、SQLite/TLS 依赖和上游许可一并保留；不宣称适用于所有 Linux 发行版或 ARM。
运行时 URL、版本及 SHA256 固定在 `scripts/python_runtime.lock.json`；下载仅发生在构建机，
校验摘要后安全解包，把包内符号链接物化为普通文件，拒绝越界、循环链接和特殊文件。
`runtime/python-runtime.json` 记录来源与许可路径，所有运行时文件纳入发行摘要。

构建机器联网准备既有前端生产构建和平台 wheel；最终用户安装时全程离线：

```sh
# 在仓库根目录；先按既有 OCCT 准备流程生成经验证的 JS/WASM。
python scripts/prepare_release_frontend.py --jobs 4
cd frontend
npm ci
npm run build:release -- --outDir ../.data/release-build/frontend --emptyOutDir
cd ..
python scripts/build_release.py --frontend-dist .data/release-build/frontend --output artifacts/CableSimPro.zip
```

CI 使用 `.github/workflows/ci.yml` 的既有发行任务在两个系统完成构建与安装验收。
前端目录必须有真实 `index.html`、JS 和 OCCT WASM；打包前执行全库插件封签核验。
Linux 可使用同一套经核验的跨平台前端构建。发行构建不运行有限元求解器。

`build_release.py` 将宿主依赖和 `cablesim.cable-geometry` 声明的精确依赖解析为当前
平台 wheel，生成包含所有传递依赖 SHA256 的 `requirements.lock`。可用
`--wheelhouse <目录>` 重用已经解析的完整 wheel 集；多版本重复包或非 wheel 文件会拒绝。
ZIP 内含后端、SDK、封签插件、种子入口、规格书样式、预构建前端、Python 运行时和离线依赖。
构建时还用实际随包解释器离线解析完整哈希锁，确认 wheel 与其 ABI 相容；不只依据构建机版本判断。
源码来自 Git 跟踪文件，开发库、密钥、测试输出和本地环境不会进入发行包。

每个 ZIP 旁生成 `.zip.json`，记录归档 SHA256、源码提交、平台/Python 目标和 build_id；
同提交的 `.source.zip` 保存 Git 跟踪的构建与测试源码，摘要写入回执，用于独立复现，不包含工作区生成物。
包内 `release-manifest.json` 记录每个不可变文件的大小与 SHA256；文件损坏会阻止安装
或启动。它提供完整性核验，不冒充发行方数字签名。`release.toml` 为可编辑配置，不纳入
不可变文件摘要；安装后的每个程序版本都有独立的不可变目录。

## 一条命令安装并启动

解压后编辑根目录的 `release.toml`（源模板为 `scripts/release.toml`）。保留这份配置，
升级继续使用同一个 `storage.data_dir`。新配置默认 `~/CableSimPro-data`，其中 `~` 是
用户主目录；Windows 不依赖 Downloads 中可能很深的解压路径。已有配置里的显式路径
继续原样使用。其它相对路径仍相对于配置文件目录解释，也可指定 `D:/CableSimPro-data`
等短路径。数据目录必须放在解压目录之外。

Windows：

```powershell
.\start.cmd
```

也可以双击 `start.cmd`（源文件 `scripts/start_release.cmd`）。Linux：

```sh
sh start.sh
```

`start.sh` 源文件为 `scripts/start_release.sh`。两个入口都直接使用当前解压包内的解释器，
安装时先把运行时复制到 `data_dir/programs/<build_id前16位>/runtime/python`，再由该副本创建 `.venv`。
因此 `pyvenv.cfg` 不引用系统 Python 或原下载目录；清理原解压目录不会破坏已安装解释器。
后续可运行安装目录内的同名入口，并通过 `--config` 指向保留在程序目录外的配置。
可追加 `--no-browser` 在无桌面系统使用；`--no-start` 只完成安装校验。
安装命令使用 `--no-index --require-hashes --no-cache-dir`，只从随包 wheelhouse 安装，
再执行依赖完整性检查和真实宿主/CAD 导入检查。依赖缺失会明确失败，不临时联网补装。

首次启动仅在工程库不存在且 `initialization.seed_examples=true` 时调用现有的
`seed_release`，从公开、注明用途的随附教学输入生成发布示例。它不读取开发库，不调用
外部模型，不生成有限元结果。已有库无论种子版本是否变化都不会重新播种或替换。
设置 `seed_examples=false` 可创建空工程库。

服务启动后同时检查 `/api/health`、`/api/release-info` 和前端主页，再打开浏览器。
`GET /api/release-info` 返回当前发行 `build_id` 和 `git_commit`，用于确认健康检查命中
正确发行版本。所有 API 和前端共用配置中的一个端口。缺少的 API 或静态资源返回 404，
前端页面导航才回退到 SPA。正常退出、启动失败或必需伴随进程退出都会回收子进程。

运行期间不执行 npm、pip、自动更新或外部资产下载。默认模型连接为空；使用内网模型时
填写 `model.base_url`、`model.model`，密钥填写在 `model.api_key_env` 指定的环境变量，
不要把密钥写进配置。已有后端模型设置仍按现有规则优先。对外网络断开时，计算与导出
使用本地方法、字体、前端资产和依赖；不需要模型服务。

## 升级与恢复

停止当前服务，把新发行包解压到另一个目录，使用原配置执行同一安装命令：

```sh
sh start.sh --config /path/to/release.toml
```

Windows 使用 `start.cmd --config D:\config\release.toml`，同样无需系统 Python。
程序、运行时与依赖安装在 `data_dir/programs/<build_id前16位>/`，运行解释器是其 `.venv`；旧程序与
环境被保留。工程库位于 `data_dir/engineering.sqlite`，数据集、复现资料和工程证据
分别位于 `datasets/`、`library/`、`engineering-evidence/`。

清单与安装记录始终使用完整 64 位 build_id；复用短目录前核对完整身份，身份冲突会拒绝，
不会覆盖另一个版本。Windows 安装前读取并记录 `LongPathsEnabled`，按实际 wheel
成员及字节码目标检查路径长度；超出默认限制时提示选择更短 `data_dir`，不要求修改系统
策略。旧的完整摘要目录仍可读取和回退。

启动程序使用独占运行锁，先调用既有 `database_ops.check_existing` 的只读版本门禁。
新于程序支持版本的库在任何迁移前被拒绝。切换到新的发行版本前，在数据库所有权锁下
调用 SQLite backup API（含已提交 WAL）创建 `release-snapshots/` 快照，校验完整性
和 SHA256，随后才允许新宿主初始化。已有待重启恢复请求时升级会拒绝，须先用当前版
完成或取消。备份范围与[工程库维护契约](database-operations.md)一致。

只有 API 和前端都健康才更新 `release-state.json`。健康检查前失败会停止新进程并
恢复升级前工程库，旧 active 版本不变；进程被强制中断时，下次启动从
`release-pending.json` 恢复未完成升级。健康检查后已经可以接受用户写入，之后的运行
错误不会自动丢弃用户数据。

启动提交完成前，发行入口仅允许 `/api/health`、`/api/release-info` 和静态页面访问；
所有工程 API 读写均返回 `503 RELEASE_STARTING`。更新 active 并清除 pending 后才开放，
因此不能在仍可能回退的健康检查窗口接受工程写入。

若首次启动在没有旧快照时失败但已经产生数据库，会保留全部文件并写
`release-initialization-failed.json`，后续启动明确拒绝把它当成完整初始化结果。
应核对日志、使用数据库维护工具检查或恢复，完成后再移除失败标记；程序不自动删除它。

需要主动回退到上一版本时，停止服务后执行：

```sh
/path/to/data_dir/programs/<当前build_id前16位>/.venv/bin/python /path/to/data_dir/programs/<当前build_id前16位>/scripts/run_release.py --config /path/to/release.toml --rollback --no-browser
```

Windows 对应使用安装目录的 `.venv\Scripts\python.exe`，不是系统 `py`。
此命令恢复上一份已运行程序及其升级前数据库；回退前仍按既有恢复契约保留当前数据库
安全副本。**升级后新增或修改的工程数据不会出现在升级前快照中**，因此只应在明确需要
回退时使用；后续数据可从保留的安全副本核查。日常数据库恢复仍用
`scripts/workspace_db.py` 和现有数据库 API，不手工复制运行中的 SQLite 主文件。
存在未完成发行升级或已排队的数据库恢复请求时，版本回退明确拒绝；先完成或取消对应
请求，避免两种恢复操作互相覆盖。

## 伴随进程扩展

配置可追加 `[[processes]]`，设置唯一名称、参数数组 `command`、`cwd`、非敏感 `env`
及 `required`。占位符 `{python}`、`{app_dir}`、`{data_dir}` 解析为发行解释器、当前
程序和数据目录。命令直接执行，不交给 shell；不自动下载进程依赖。
必需进程退出会停止宿主，可选进程退出不阻断核心工作台。此接口为后续 Agent 边车保留，
不修改开发启动器或添加前端页面。

Linux 宿主把随包 `runtime/linux-libs` 加入其原生库搜索路径，保留原有路径。插件宿主会
清理子进程继承的环境，因此发行专用 `scripts/release_python.sh` 在进入同一 `.venv`
之前重新绑定这个固定目录；不向插件开放宿主密钥或代理环境，也不改插件执行器和封签。

发行验收脚本 `scripts/verify_installation.py` 在解压目录外隔离数据，实际调用 `start.cmd` / `start.sh` 安装、启动并经发布示例 API 导出。
安装子进程的 PATH 中没有 Python、py、pip、Node 或 npm；记录实际解释器、基础运行时、标准库路径与版本。
`prepare_release_verifier.py` 用发行 ZIP 自带运行时和随包哈希锁 wheel 创建独立的证据工具环境；
进入操作系统网络隔离后的验证驱动也使用该环境，而非 `actions/setup-python` 的解释器。
Windows 防火墙覆盖驱动、安装器、已安装基础解释器及 venv，避免重定向器绕过禁网。
验收末尾删除原始解压目录后再次运行已安装的公开入口，并验证健康、运行时来源和外网阻断。
`release_runtime_verification.py` 保存这些独立观察，不把单元测试替代实际安装证据。
包、PDF、Excel、逐页图片、接口快照与验证日志只进入 CI artifact。
Windows 10/11 真实桌面双击、机构内网策略和特定 Linux 系统运行库仍需在对应机器核验，
不以 Windows Server runner 替代这些桌面环境结论。
