# CableSimPro 开发约定

适用于所有人和所有 AI 助手（Codex、Claude 等）。`CLAUDE.md` 引用本文件，只维护这一份。

## 项目是什么

电缆行业垂直的设计 / 计算平台，核心理念是**插件式**：宿主只提供工程底座（工程与版本、研究/运行快照、来源追溯、结果工件、报告、审批），**所有计算方法都是插件**，宿主不内置算法。

- 产品需求：`docs/product/PRD.md`
- 架构与实施细则：`docs/design/SYSTEM_ARCHITECTURE.md`、`docs/design/MODULE_DESIGN.md`
- 前端技术栈与开源组件准入：[FRONTEND_STACK.md](docs/design/FRONTEND_STACK.md)
- 插件规范：[唯一现行规范](https://github.com/luohui1/CableSimPro-Plugins/blob/main/SPEC.md)，v2 清单 `plugins/<id>/plugin.json`；`plugins/registry.json` 仅为这些清单生成的发布索引。

工程底线：不产生假结果（缺数据就明确失败，不用编造公式兜底）；每个结果可追溯到输入、方法和版本；AI 与插件只提提案，不能自行批准。

## 前端开源组件与框架迁移

允许主动引入、替换和二次开发成熟开源组件，不以当前已安装依赖为上限。目标主栈为 Next.js、Vercel AI SDK、AI Elements 与 shadcn/ui；专业表格、表单、图表、工作流、PDF 与检索按 `FRONTEND_STACK.md` 的职责边界集成。该目标不代表依赖已经安装、迁移完成或兼容性已经验证。

此前前端规范中对新增组件来源的限制，不得解释成禁止本次已授权的开源选型。统一设计令牌、组件入口、领域契约、版本身份、人工审批和真实验收要求仍然有效；引入组件时同步调整具体规范与测试，不关闭样式门禁或复制第二套工程状态。Next.js 迁移不替换 FastAPI 工程宿主，不授权云部署、外发私有资料或购买商业扩展。

## 目录

| 目录 | 内容 |
| --- | --- |
| `backend/` | FastAPI 宿主；`kernel/` 保存工程、研究、快照执行、比较与交付，并提供敷设/需求/载流量表接口；`domain/` SI 事实与旧数据显式迁移；`foundation/` 几何与资源；`plugin_host/` 通用 v2 执行器与工件校验 |
| `design/` | 设计素材；`plugin-system/` 为插件页面素材（封面、图标、原型）；自研图标、品牌、动效放 `icons/`、`brand/`、`motion/`（规格见 `docs/design/VISUAL_ASSETS.md`）。界面待按 `docs/design/FRONTEND_REQUIREMENTS.md` 重建 |
| `plugins/` | 每个第一方插件一个 `plugins/<id>/src/` 与 v2 清单；IEC 标准子集、热网络交叉校核参考、原生算法及仿真插件；清单封签含静态引用的公共源码 |
| `cablesim_sdk/` | 插件与宿主共用的领域和仿真工件契约 |
| `plugin-spec/` | v2 插件清单与仍在使用的物理工件 JSON Schema；schema 数字版本不代表已删除的 v1 执行器 |
| `tests/` | 默认 pytest；`plugin-tests/` 需要原生环境 |
| `scripts/` | 仍在使用的工具脚本（每个都必须被 CI、代码或本文件引用） |
| `docs/` | `product/` 需求，`design/` 架构，`architecture/` 已实现的契约，`plugins/` 插件说明，`METHOD.md` 计算方法 |

## 常用命令

```sh
python scripts/run_demo.py                      # 本机运行
python -m pytest                                # 后端 + 仓库卫生检查
python scripts/run_plugin_tests_hpc.py          # 原生仿真回归提交 Slurm，自动回收结果与核时
python scripts/check_hygiene.py                 # 仓库卫生检查
python scripts/clean.py [--dry-run]             # 清理本地中间文件
```

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
