# CableSimPro

电缆行业垂直的设计 / 计算平台。以工程项目为中心，在同一份可追溯的数据上完成电缆结构定义、敷设配置、研究计算、结果复核和计算书交付。

**核心理念是插件式**：宿主提供工程底座（工程与版本、研究 / 运行快照、来源追溯、结果工件、报告、审批），计算方法以插件形式接入。目标是宿主不内置任何算法；目前热网络等核心计算仍在宿主内，正按插件契约 v2 迁出。

- 产品需求与分期：[docs/product/PRD.md](docs/product/PRD.md)
- 系统架构：[docs/design/SYSTEM_ARCHITECTURE.md](docs/design/SYSTEM_ARCHITECTURE.md) · [模块实施细则](docs/design/MODULE_DESIGN.md)
- 插件规范：[plugin-spec/README.md](plugin-spec/README.md) · [插件说明](docs/plugins/)
- 计算方法与适用边界：[docs/METHOD.md](docs/METHOD.md)
- 开发约定与仓库卫生规则：[AGENTS.md](AGENTS.md)

## 当前能力

- **工程与版本**：本机 SQLite 工作区，参数锁、版本冲突检测、撤销 / 重做，提案需人工批准。
- **电缆与敷设**：参数化分层结构、二维截面 / 三维模型、直埋水平 / 等边三角排列。
- **计算**：稳态直埋热网络（允许电流、运行温度）、敷设参数扫描、竖向空气电热、截面电场 / 磁场解析、反向选型。
- **插件**（`plugins/registry.json`，19 个清单）：CAD（cadquery STEP）、gmsh 截面网格、scikit-fem 传热、meshio / pyvista 后处理、三根直埋电缆土壤 FEM 参考、电热耦合 R(T) 参考、半空间线源解析校核；安装需预览计划并批准，按项目锁定准确版本，原生计算在独立子进程运行。
- **资料与型号**：PDF 文字层 / OCR 入口、页级核对与引用、企业型号版本与候选复算。
- **结果与交付**：运行记录只读保存，历史比较，HTML 计算书。

## 工程边界

研究工具，**不是**完整 IEC 60287 / GB 实现、通用有限元软件或经认证的设计系统，不应直接用于最终设计签审。

稳态直埋限于单回路、三根相同无铠装单芯电缆、均匀土壤。竖向为给定换热系数的单根轴向模型，不求解井道气流。电场 / 磁场为范围明确的解析模型，不是全耦合电磁热 FEM。FEM 插件只在声明的基准工况上验证过。标准目录只做范围检查，不代表条款已实现。

## 运行

需要 Python 3.11–3.13；源码构建前端需要 Node.js 22.12+。

```sh
python scripts/run_demo.py            # 首次会安装后端依赖；默认 http://127.0.0.1:8000
python scripts/run_demo.py --rebuild  # 修改前端后重新构建
```

原生插件（CAD / 网格 / FEM）为可选环境：`pip install -r plugins/requirements-native.txt`。未安装时核心流程照常使用，插件中心会显示缺少的运行环境。

默认只监听本机，没有身份认证与多租户权限，不要暴露到公网。数据在 `.data/`（可用 `CABLESIM_DB` 调整），完整备份请停服后复制整个 `.data` 目录。云端 OCR / 模型的 Key 只保存在服务端内存或环境变量中，外发数据需明确同意。

## 测试

```sh
python -m pip install -r backend/requirements-dev.txt
python -m pytest                                  # 后端 + 仓库卫生检查
python -m pytest plugin-tests                     # 原生插件（需原生环境）
cd frontend && npm ci && npm run build
npx playwright install chromium webkit
npx playwright test --project=chromium --project=workflow-plugins
```

CI（`.github/workflows/ci.yml`）在 main 和每个 PR 上运行：卫生与插件目录检查、后端 Python 3.11–3.13、Linux / Windows 原生插件、Chromium / WebKit / 移动 WebKit / Windows 100–150% 缩放与 Edge 浏览器矩阵，全部通过后才打包演示版。

本地中间文件用 `python scripts/clean.py` 清理。
