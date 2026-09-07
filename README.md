# CableSimPro 0.4 · 电缆设计与资料研究工作台

开发分支：`feat/design-ocr-v04`，基于 v0.3 继续开发，不代表 main 已合并。高对比工程工作台 + 可复核物理研究 + 引用式企业资料库 + 可接入的 OCR / Agent。

> **工程辅助 Preview**：不是完整 IEC 60287、通用 COMSOL 或经认证的选型软件。所有演示值需厂家资料与参考算例校核；不能将软件测试通过等同于工程认证。

## 运行

预构建 ZIP：Python 3.11–3.13，首次安装依赖需要联网，运行不需要 Node.js。解压进入含 backend、frontend、scripts 的 CableSimPro 文件夹：

```sh
python scripts/run_demo.py
```

Windows 可用 `py -3.12 scripts/run_demo.py`。默认浏览器地址 `http://127.0.0.1:8000`，按 Ctrl+C 停止。不要直接双击源码 index.html。

源码版另需 Node.js 22.12+（22.x）：

```sh
git clone --branch feat/design-ocr-v04 https://github.com/luohui1/CableSimPro.git
cd CableSimPro
python scripts/run_demo.py
```

修改前端后用 `python scripts/run_demo.py --rebuild`。已经安装依赖的当前 Python 环境可用 `--skip-install --no-browser`，这不是离线安装器。

## 已实现的工作区

| 模块 | 功能与边界 |
|---|---|
| 工程工作台 | Dockview 停靠布局、Konva 米制敷设画布、精确属性、参数锁、三相结果表联动、撤销/重做、SQLite 自动保存与版本冲突保护。文字/表格/标尺对比度已加强。 |
| 直埋分析 | 单回路三根相同无铠装单芯电缆；均匀土壤稳态互热网络和半空间解析温度图，非任意土壤 FEM。 |
| 竖向热研究 | 单根隔离电缆的轴向有限体积 + 四节点径向热网络，焦耳/屏蔽/介质损耗、给定对流系数与辐射；输出沿高温度、热点、载流量和热平衡残差。 |
| 绝缘电场 | 均匀同轴绝缘解析电势、RMS/峰值场强、电容与截面图；不计算缺陷、局放或击穿合格判据。 |
| 反向选型 | 目标电流、裕量、U₀、材料、外径和锁定条件逐项筛选，给出失败原因；通过者中按最小截面排序，不宣称最低成本或全局最优。 |
| 企业资料库 | PDF/PNG/JPEG/TXT/MD/CSV 上传，原件保存、页级文字/核对状态、关键词检索、原文引用、人工确认后保存部分有来源的电缆条目。 |
| OCR 接入 | pypdf 原生文字优先；扫描件接 Mistral OCR 或规范化 Gateway，未配置时保留原件待识别。 |
| Agent 接入 | 服务端 Responses / Chat Completions 工具调用；旧工程修改需审批，新资料研究可检索、检查工程、调用选型，只读且有步数限制。 |

顶部 **“设计中心 · OCR / 选型”** 进入新增研究。直埋计算与设计中心的竖向/电场求解按钮分开，避免在空气模型中误用土壤条件。

## 建议体验

在主工作台执行直埋计算或编辑电缆结构，再打开设计中心。先运行竖向热模型，查看温度—高度曲线及残差；再查看绝缘电场。反向选型默认不纳入演示条目，首次体验可以明确勾选，观察目标 500 A 加 10% 裕量的筛选和失败理由。

企业资料上传后，对照原件核对文字，解析单一产品页面的明确标签和单位，检查完整电缆定义，再确认入库。OCR/文本解析目前支持截面积、R20、绝缘/护套厚度、U₀；其它参数沿用当前工程假设并明确提示。复杂多产品表格/跨页关联尚未自动解析。

演示库为铜/铝 120、185、240、300、400、500、630 mm² 共 14 项，不是厂家数据库。人工确认条目仍标为 `reviewed_partial`，不能将部分字段有引用当作完整认证。应用条目先生成服务端差异提案，批准后仅替换电缆定义，必须按所选研究域重算。

## OCR 与 Agent key 后续接入

复制根目录 `config.example.env` 为 `.env`，在本机填入提供商信息后重启；已有系统环境变量优先。不要把真实密钥发到聊天或提交 Git。浏览器只显示非敏感配置状态，**已配置不等于已验证联通**。

OCR 配置项：`CABLESIM_OCR_PROVIDER`、`CABLESIM_OCR_API_KEY`、可选 `CABLESIM_OCR_URL` / `CABLESIM_OCR_MODEL`。内置 Mistral 和规范化 Gateway，不同厂商 key 不能混用；其它供应商需按其协议映射。Gateway 请求/响应、页码和错误保护详见方法文档。

Agent 配置项：`CABLESIM_AGENT_PROTOCOL=responses` 或 `chat_completions`、`CABLESIM_AGENT_BASE_URL`、`CABLESIM_AGENT_API_KEY`、`CABLESIM_AGENT_MODEL`。旧 `OPENAI_API_KEY` 可以回退使用。模型必须支持工具调用。

**无 key 时**：物理计算、选型、数字 PDF 文字提取和本地检索可用；工程 Copilot 是明确标注的本地命令解析器，新资料 Agent 是关键词检索，不伪装成大模型。

OCR 与 Agent 分别需要界面同意。OCR 服务收到完整原件，即使只选部分页；Agent 服务收到任务、完整工程和实际检索片段，可能计费。最多四轮模型、三次只读工具；无 shell、URL 抓取或解锁工具。云端解释仍可能错误，数值以工具结果、原文以引用为准。

**尚未使用真实 key 完成外部 OCR / 大模型联调**。自动测试中的提供商响应为契约模拟，不代表实际识别准确率或模型任务成功率。

## 仿真范围

“垂向”本轮按竖向敷设支持，同时保留电缆垂直领域的直埋设计。竖向模型的空气温度梯度和 h 是给定边界，不是自动求解井道流场。两端轴向绝热，只计导体轴向热导；不计并束、支架热桥、接头和烟囱效应。热点为网格中心，应加密网格检查。

未实现磁场/涡流、空间电荷、气流 CFD、热应力、任意三维 FEM。选型还没有压降、短路耐受、阻燃、绝缘配合、竖向自重与夹具等完整约束。不能直接用于批准施工。

详细公式、单位、假设、接口契约和测试范围：**[docs/DESIGN_V04.md](docs/DESIGN_V04.md)**。旧内核说明见 [METHOD.md](docs/METHOD.md)，原工作台结构见 [PRO_WORKBENCH.md](docs/PRO_WORKBENCH.md)。

## 数据、备份与安全

默认数据库 `.data/cablesim.sqlite`，通过 `CABLESIM_DB` 可指定路径；企业原件在数据库同目录的 `library-blobs/`。研究快照绑定工程版本并持久化。聊天气泡/当前页面研究输入不等于完整数据库备份；Scenario JSON 导出只包含计算参数。完整备份应停止服务后复制数据库及 blobs。

仅供本机使用。没有企业 SSO、租户隔离、公网鉴权、防滥用限额、收费预算或防篡改合规审计，**不要直接暴露互联网**。PDF 解析不是真正隔离沙箱，企业上线需单独加固文件解析、权限、备份与资源配额。

打包器排除原始资料 blobs、数据库、密钥文件、运行环境和字体。默认不包含用户资料，代码中测试凭据仅为模拟占位。

## 测试与构建

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

GitHub Actions 验证 Python 3.11/3.12/3.13、TypeScript/Vite、真实 HTTP 后端的 Chromium、桌面 WebKit 和移动 WebKit 模拟。新界面用例在 `frontend/pro-e2e`。实际是否通过以所选提交的 CI 为准；移动模拟不是真机验收。

后端验证热平衡、解析退化解、网格对比、电场积分、OCR 页码与失败保护、证据、选型锁、无可行解、工具权限和私有资料打包排除。测试通过不能替代独立标准算例和厂家实测校核。

构建包包含当前解析的前端 package-lock、第三方许可证与 BUILD_INFO.json；源码指定直接依赖版本但未锁定全部传递依赖，优先使用同次测试的构建工件。继续复用 Dockview、Konva、TanStack Table、Three.js、LangGraph，新增 pypdf、SciPy、Pillow 和 python-dotenv 等，不引入商业 CAD 内核。
