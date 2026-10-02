# CableSimPro

电缆行业垂直的设计 / 计算平台。以工程项目为中心，在同一份可追溯的数据上完成电缆结构定义、敷设配置、研究计算、结果复核和计算书交付。

**核心理念是插件式**：宿主提供工程底座（工程与版本、研究 / 运行快照、来源追溯、结果工件、报告、审批），计算方法在插件子进程中执行。简化热网络、竖向与场分析归入 `plugins/cablesim.thermal-network`，IEC 方法归入 `plugins/cablesim.iec60287`，原生 CAD / 网格 / FEM / 电热 / 线源实现归入 `plugins/cablesim.native-reference`。旧接口通过适配层调用这些实现。

- 产品需求与分期：[docs/product/PRD.md](docs/product/PRD.md)
- 系统架构：[docs/design/SYSTEM_ARCHITECTURE.md](docs/design/SYSTEM_ARCHITECTURE.md) · [模块实施细则](docs/design/MODULE_DESIGN.md)
- 插件规范：[唯一现行规范](https://github.com/luohui1/CableSimPro-Plugins/blob/main/SPEC.md) · [插件说明](docs/plugins/)
- 独立插件仓库：[CableSimPro-Plugins](https://github.com/luohui1/CableSimPro-Plugins)（私有）：维护三个第一方插件包、封签校验、测试与打包。当前宿主仍读取本仓库的 `plugins/`，尚未接入跨仓自动同步；核心插件继续随产品内置交付。
- 计算方法与适用边界：[docs/METHOD.md](docs/METHOD.md)
- 开发约定与仓库卫生规则：[AGENTS.md](AGENTS.md)

## 版本
已发布版本 **0.1.0**（git 标签 `v0.1.0`；版本号唯一来源为 `backend/__init__.py`）。本分支包含尚未发布的 D4–D6 后端增量；本仓库不包含许可未确认的第三方图片或字体。

## 当前能力

**界面正在重建。** 2026-10 已删除全部旧前端，重建依据是 [前端需求](docs/design/FRONTEND_REQUIREMENTS.md)（导航、工程文档结构、建模编辑器、库与建模起点、视觉规则、行为验收清单、后端依赖）。插件页面素材保留在 `design/plugin-system/`。重建期间宿主只提供 API，`http://127.0.0.1:8000/docs` 可浏览全部接口：

- **工程与版本**：本机 SQLite 工作区，参数锁、版本冲突检测、撤销 / 重做，工程输入 JSON 导入 / 导出，另存为独立方案。
- **领域模型**：SI 工程事实（电缆类型、回路、截面、负荷、判据）、引用校验与显式 v0 转换。
- **计算**：方法插件经 `/api/methods` 发现；简化热网络载流量 / 网络参数 / 竖向 / 截面场、IEC 60287 单芯接触品字形、原生有限元 / 电热 / 线源校核。
- **结果与交付**：不可变运行快照、历史比较、HTML 计算书，不重新计算。

新增研究 API：`GET /api/methods` 发现精确方法版本；在工程内保存 `studies`，先 `preflight`，再凭工程 / 研究版本、请求 UUID、锁摘要和范围确认发起 `runs`。结果与工件固定保存，导出只读取指定运行；接口示例与行为测试见 `tests/test_research.py`。领域转换需显式调用 `domain/conversion`，原版本保留；转换后的 v0 接口只读。扫描、阈值选型、比较和交叉校核均通过保存研究执行，单点失败保留，不自动应用候选或判定工程合格。

目录职责：`backend/kernel/` 负责研究编排、不可变运行与交付；`backend/domain/` 负责 SI 工程事实、引用校验与转换；`backend/plugin_host/` 负责通用子进程协议；`backend/plugins/` 保留 v1 安装、锁定及传输兼容；`plugins/<id>/src/` 存放计算实现。领域模型和插件仍有明确支持子集，见[实施范围](docs/design/DOMAIN_MODEL.md)。

## 工程边界

研究工具，**不是**完整 IEC 60287 / GB 实现、通用有限元软件或经认证的设计系统，不应直接用于最终设计签审。

稳态直埋限于单回路、三根相同无铠装单芯电缆、均匀土壤。竖向为给定换热系数的单根轴向模型，不求解井道气流。电场 / 磁场为范围明确的解析模型，不是全耦合电磁热 FEM。FEM 插件只在声明的基准工况上验证过。标准目录只做范围检查，不代表条款已实现。

## 运行

需要 Python 3.11–3.13。

```sh
python scripts/run_demo.py            # 首次会安装后端依赖；打开 http://127.0.0.1:8000/docs
```

原生插件（CAD / 网格 / FEM）为可选环境：`pip install -r plugins/requirements-native.txt`。未安装时核心方法照常使用，原生方法会报告缺少的运行环境。

默认只监听本机，没有身份认证与多租户权限，不要暴露到公网。数据在 `.data/`（可用 `CABLESIM_DB` 调整），完整备份请停服后复制整个 `.data` 目录。云端 OCR / 模型的 Key 只保存在服务端内存或环境变量中，外发数据需明确同意。

## 测试

```sh
python -m pip install -r backend/requirements-dev.txt
python -m pytest                                  # 后端 + 仓库卫生检查
python -m pytest plugin-tests                     # 原生插件（需原生环境）
```

CI（`.github/workflows/ci.yml`）在 main 和每个 PR 上运行：卫生与插件目录检查、后端 Python 3.11–3.13、Linux / Windows 原生插件，全部通过后才打包演示版。

本地中间文件用 `python scripts/clean.py` 清理。
