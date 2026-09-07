# CableSimPro · Agent-first 电缆工程工作空间

0.2 原型：从工程任务进入模型，检查参数变更，再执行可追溯的计算。工作区按模型树、属性、图形、研究与结果组织，不是 KPI 仪表盘。

当前开发分支：`feat/agent-workspace`，审查见 [PR #2](https://github.com/luohui1/CableSimPro/pull/2)。基于 v0.1 的 PR #1 继续开发；两者均不代表已经合并 main。

> **工程边界**：仍为单回路三根相同无铠装单芯电缆、均匀土壤直埋的稳态热网络。不是完整 IEC 60287、有限元求解器或经认证的工程设计软件。交流附加与屏蔽损耗系数是输入假设，模板不是厂家数据。

## 运行

预构建 ZIP 包：需要 Python 3.11–3.13，不需要 Node.js。解压后进入包含 backend、frontend、scripts 的目录：

```sh
python scripts/run_demo.py
```

启动器创建隔离的 `.venv`、安装依赖、启动服务并打开 `http://127.0.0.1:8000`。首次安装需要联网，按 Ctrl+C 结束。macOS/Linux 可以使用 `python3`，Windows 可以使用 `py -3.12`。

源码构建另外需要 Node.js 22.12+（22.x）：

```sh
git clone --branch feat/agent-workspace https://github.com/luohui1/CableSimPro.git
cd CableSimPro
python scripts/run_demo.py
```

修改前端源码后加 `--rebuild`。不要双击源码的 index.html，前端需要构建并通过同源 HTTP 服务访问计算 API。没有公网部署。

## 体验任务流程

首页加载参考输入但不自动求解。默认使用明确标注的**本地命令解析器**，不是大模型。

```text
运行电流设为 350 A，计算载流量
截面积改为 400 mm²，重新计算
埋深设为 1.2 m，计算
改为三角排列，计算
比较土壤热阻率 0.8、1.2、1.6、2.0 下的载流量
解释当前模型的假设
```

提交后先出现参数差异、完整输入和假设。点击确认才运行内核；未确认不计算、不修改、不保存。手动修改输入会使旧结果与旧操作方案失效。可以撤销最后一次 Agent 操作，但不能覆盖其后的手动编辑。

从左侧模型树可以直接进入层结构、材料、敷设、稳态研究、扫描、明细和方案对比。三维结构、二维截面、敷设图、土壤解析温度图使用相同工程输入。土壤场不是 FEM，三维轴向剖切是结构示意。

工程参数可保存、更新、重开、删除、JSON 导入导出。保留 HTML 计算书、运行 CSV、手动扫描和最多四个结果快照。计算书可用浏览器打印为 PDF；没有专门的服务端 PDF 引擎。

## 可选大模型入口

已实现服务端 OpenAI Responses API 严格函数调用适配器。没有密钥时不连接云端，不伪称有通用自然语言能力。设置两个服务端环境变量后重启：

```sh
export OPENAI_API_KEY='your-key'
export CABLESIM_AGENT_MODEL='your-supported-model-id'
python scripts/run_demo.py
```

在界面选择 OpenAI 并勾选数据发送同意。任务与当前完整工程参数（包括名称、说明）会发送到 OpenAI，调用可能计费。密钥不写入浏览器、工程文件或源码仓库。不要将真实密钥粘贴到聊天或提交到 Git。

当前是单任务规划 + 人工确认 + 确定性工具执行，不是无限循环自主 Agent。模拟提供商测试只验证接口契约，**没有使用真实密钥验证大模型端到端成功率**。详见 [Agent 架构与接入说明](docs/AGENT_WORKSPACE.md)。

## 验证

```sh
python -m pip install -r backend/requirements-dev.txt
python -m pytest
cd frontend
npm install
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e
cd ..
python scripts/package_demo.py
```

GitHub Actions 在 Python 3.11/3.12/3.13 下执行后端测试，并运行 TypeScript 检查、Vite 构建和连接真实 API 的 Chromium、桌面 WebKit、移动 WebKit 测试。实际结果以对应提交的 Actions 为准。测试截图、报告和成功构建 ZIP 保存在同次运行的 Artifacts；BUILD_INFO.json 记录检出提交。移动 WebKit 是模拟，不等于真机验收。

数学性质、热平衡、软件逻辑测试不替代正式标准算例、独立软件与厂家数据校核。方法见 [METHOD.md](docs/METHOD.md)。v0.1 验收范围见 [ACCEPTANCE.md](docs/ACCEPTANCE.md)，本轮新增 Agent 边界见 [AGENT_WORKSPACE.md](docs/AGENT_WORKSPACE.md)。

## 数据与部署

默认仅监听本机。SQLite 位于 `.data/cablesim.sqlite`，可通过 `CABLESIM_DB` 改变路径。对话、操作日志和方案快照仅属于当前页面会话，没有持久化版本历史、多人协作或权限隔离。重要工程请导出备份。

不直接暴露公网。多用户上线前需要鉴权、请求来源保护、限流与费用控制、云端审计、备份、迁移和多进程票据存储。OpenAI 的 `store:false` 不等于绝无数据保留，需确认账户政策和工程数据权限。

前端完整解析锁文件随 CI 工件保存，源码未锁定全部传递依赖；建议使用同次测试的构建包。已有依赖可使用 `python scripts/run_demo.py --skip-install --no-browser --port 8001`。
