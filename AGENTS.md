# CableSimPro 开发约定

适用于所有人和所有 AI 助手（Codex、Claude 等）。`CLAUDE.md` 引用本文件，只维护这一份。

## 项目是什么

电缆行业垂直的设计 / 计算平台，核心理念是**插件式**：宿主只提供工程底座（工程与版本、研究/运行快照、来源追溯、结果工件、报告、审批），**所有计算方法都是插件**，宿主不内置算法。

- 产品需求：`docs/product/PRD.md`
- 架构与实施细则：`docs/design/SYSTEM_ARCHITECTURE.md`、`docs/design/MODULE_DESIGN.md`
- 插件规范：[唯一现行规范](https://github.com/luohui1/CableSimPro-Plugins/blob/main/SPEC.md)，v2 清单 `plugins/<id>/plugin.json`；`plugins/registry.json` 仅为这些清单生成的发布索引。

工程底线：不产生假结果（缺数据就明确失败，不用编造公式兜底）；每个结果可追溯到输入、方法和版本；AI 与插件只提提案，不能自行批准。

## 目录

| 目录 | 内容 |
| --- | --- |
| `backend/` | FastAPI 宿主；`kernel/` 保存工程、研究、快照执行、比较与交付，并提供敷设/需求/载流量表接口；`domain/` SI 事实与旧数据显式迁移；`foundation/` 几何与资源；`plugin_host/` 通用 v2 执行器与工件校验 |
| `frontend/` | 正式 React 工程与路径路由；浏览器回归使用 `scripts/verify-*.mjs` 和型号模块测试；OCCT 源码位于 `src/features/cad/native/` |
| `design/` | 保留设计素材；`plugin-system/` 为插件页面素材，自研图标、品牌、动效放 `icons/`、`brand/`、`motion/`（规格见 `docs/design/VISUAL_ASSETS.md`）；不再承载应用运行入口 |
| `plugins/` | 每个第一方插件一个 `plugins/<id>/src/` 与 v2 清单；IEC 标准子集、热网络交叉校核参考、原生算法及仿真插件；清单封签含静态引用的公共源码 |
| `cablesim_sdk/` | 插件与宿主共用的领域和仿真工件契约 |
| `plugin-spec/` | v2 插件清单与仍在使用的物理工件 JSON Schema；schema 数字版本不代表已删除的 v1 执行器 |
| `tests/` | 默认 pytest；`plugin-tests/` 需要原生环境 |
| `scripts/` | 仍在使用的工具脚本（每个都必须被 CI、代码或本文件引用） |
| `docs/` | `product/` 需求，`design/` 架构，`architecture/` 已实现的契约，`plugins/` 插件说明，`METHOD.md` 计算方法 |

## 常用命令

```sh
python scripts/run_demo.py                      # 构建前端并打开 http://127.0.0.1:8100/；API 同端口
python scripts/verify_release_workflows.py       # 新临时发布种子库，经API验收询价PDF/共同能力CSV/改型号规格书；首个失败停止，退出码1
cd frontend; node scripts/isolated-e2e.mjs verify-crossing-real-use.mjs # E2E_DATABASE_SOURCE 指向发布库：只读复制后实测交叉热源适用范围、降额及客户PDF
python -m pytest                                # 后端 + 仓库卫生检查
python scripts/run_plugin_tests_hpc.py          # 原生仿真回归提交 Slurm，自动回收结果与核时
python scripts/check_hygiene.py                 # 仓库卫生检查
python scripts/clean.py [--dry-run]             # 清理本地中间文件
python scripts/workspace_db.py backup --database .data/cablesim.sqlite --output .data/snapshots/library.sqlite
python scripts/workspace_db.py restore --database .data/cablesim.sqlite --source .data/snapshots/library.sqlite --sha256 <备份返回的SHA256> --confirm-replace
```

一键演示需要 Python 3.11+、Node.js 22.12+ 和 npm；首次联网安装依赖。独立 Python 环境、前端构建和演示数据库均放在 `.data/release/`，首次用仓库教学输入生成，后续启动保留已有数据，不读取开发库或测试库。依赖已准备好时可用 `--skip-install`；`--no-browser` 适用于自动检查，Ctrl+C 停服。

发布业务门禁`verify_release_workflows.py`复用启动器调用的`seed_release`函数，使用全新临时库；不调用只允许正式发布目录的种子CLI，也不读取来源服务/开发库或改动`.data/release/`。只经真实ASGI接口和默认插件执行器验收；不修复种子、不填假候选。逐接口耗时、数值、失败归属和PDF/CSV保存在默认`.data/acceptance/release-<uuid>/`或`--output <新目录>`，临时数据库退出时删除。CSV与现有前端相同，从保存运行API结果在客户端导出并带SI单位、口径、方法版本与来源摘要；不宣称有独立CSV下载接口。任一步失败立即停止后续流程，修复归属问题后从全新库重跑；此门禁通过才可声称三条发布流程已验收。

干净检出先运行 `python frontend/src/features/cad/native/prepare.py --jobs 4` 准备 OCCT 发布资产（由 3D 模块维护）。资产缺失或版本/摘要不匹配时发布构建明确失败。启动器使用 `frontend` 的 `build:release`，只打包生产入口，不加载 CAD 陈列 JSON；开发陈列仍由 `npm run dev` 提供，完整开发类型检查保留在 `npm run build`。

备份包含已提交的整个工程数据库（原件、输入版本、结果及内嵌工件、计算书）；不是插件安装包或超算原始作业目录的镜像。命令行恢复前停服，恢复会保留替换前安全副本；API 恢复在重启且取得独占锁后执行。接口和数据库版本门禁见 `docs/architecture/database-operations.md`。

仿真验证工具：`plugins/cablesim.simulation/validation/benchmark_hpc_batches.py` 从已保存设计提交 Slurm 吞吐评测；`plugins/cablesim.simulation/validation/compare_batch_backends.py` 对比已有副本的输入身份、温度与载流量，不启动本机求解。混合模型验证辅助模块 `plugins/cablesim.hybrid-rating/validation/training_input.py` 核验批量工件并组装训练输入，`plugins/cablesim.hybrid-rating/validation/register_model.py` 登记已验证 Slurm 训练产物，保留 `reference_only`，不自动批准。

IEC 展示验证图由 `python plugins/cablesim.iec60287/validation/presentation.py` 重生成；`--check` 只核对图内记录与已声明四热源解析算例的数据，不运行原生求解器或提交作业。更新图后重新封签。

## 仓库卫生规则（CI 强制，`scripts/check_hygiene.py`）

1. **文件名不带版本号或临时字样。** 禁止 `_v04`、`V073`、`_r3`、`20260908`、`legacy/old/new/final/tmp/backup` 等。版本只写在 git tag 和提交记录里。
2. **生成物不入库。** `dist`、`test-results`、截图（`design/`、`docs/` 中的设计素材除外）、`artifacts`、日志、数据库、`*.bin`、分片/base64 包、`__pycache__` 一律不提交。必须入库的生成物（如 `plugins/releases/` 里的插件封签）要能用脚本重新生成，并由检查脚本校验一致。
3. **临时文件当场清理。** 一次性脚本、payload、调试探针只放 `.tmp/`（已忽略）或仓库外，产生它的同一个任务 / PR 内删除。不允许"一次性 bootstrap"提交。
4. **每个主题只保留一份在用文档。** 不提交会话交接、同步记录、截图验收、版本快照文档；文档过时就更新或删除，历史留在 git。
5. **CI 只在 main 和 PR 上运行。** 不写绑定某个特性分支名的工作流；新测试加进 `.github/workflows/ci.yml` 已有任务。
6. **不留死代码。** 无人引用的脚本会让检查失败。

历史遗留违规登记在 `scripts/hygiene-baseline.txt`，**只能减少**：修掉一项就删掉对应行，不能新增。

## 每个任务结束前

1. 删除本任务产生的临时文件、调试输出、临时 worktree / 分支。
2. `python scripts/clean.py` 清掉本地中间文件（不会动 `.data/` 里的工程数据）。
3. `python -m pytest` 通过（含卫生检查）；动了插件跑 `plugin-tests`。
4. 改了插件或公共被封签源码：`python scripts/plugin_sdk.py seal` 检查各 v2 清单和生成索引；未发布版本用 `seal --write`，已发布版本先升版本号。清单模型/物理工件 schema 改动后用 `python scripts/seal_plugin_catalog.py --write-draft` 同步生成文件。最后确认 `python scripts/plugin_sdk.py verify` 与 `python scripts/seal_plugin_catalog.py` 通过。
5. 有限元、批量仿真、收敛与性能计算只提交超算 dg83；CI 原生回归使用 `cablesim-hpc` 自托管 runner 的 `CABLESIM_HPC_PROFILE`。本机保留轻量单元与标准代数核验；不要在本机执行原生求解器。

## 分支

- `main` 是唯一主线，必须保持 CI 通过。功能分支从 main 拉，短期存在，合并后删除。
- 不在功能分支上长期维护平行版本；被替代的界面 / 实现删除，不保留"旧版入口"。
