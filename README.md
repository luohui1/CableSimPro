# CableSimPro 0.4.1 · 电缆设计与资料工作台

开发分支 `feat/unified-design-v041`，基于 v0.4 并整合竖向研究，尚未合并 main。

**高对比工程界面 + OCR / Agent 接入 + 企业资料页校对与引用 + 型号库反向选型 + 专项场分析。**

> 本机工程辅助 Preview，不是完整 IEC 60287、通用多物理场或已经认证的设计软件。当前载流量内核仍是单回路三根相同无铠装单芯电缆、均匀土壤直埋、平衡稳态模型。竖向空气电热是单独的轴向有限体积研究，不求解井道气流/烟囱效应，不可套用直埋边界。

## 启动

下载成功 CI 的 `CableSimPro-demo` 工件并解压内部 ZIP，进入 `CableSimPro` 目录：

```sh
python scripts/run_demo.py
```

预构建包需要 Python 3.11–3.13，首次安装 Python 依赖需联网，不需要 Node.js。Windows 可用 `py -3.12 scripts/run_demo.py`。默认 `http://127.0.0.1:8000`，Ctrl+C 停止；不要直接双击源码 index.html。

源码版另需 Node.js 22.12+（22.x）：

```sh
git clone --branch feat/unified-design-v041 https://github.com/luohui1/CableSimPro.git
cd CableSimPro
python scripts/run_demo.py
```

前端改动后加 `--rebuild`。界面“专注工作区”可以放大当前主工作区，再次点击退出。

## 0.4.1 统一版本

在0.4基础上新增“场分析 → 竖向电热”和“反向选型 → 单根隔离竖向空气”研究域；显示沿高温度、热点、能量平衡和粗细网格差异。审批候选不误触直埋求解；更改目标/边界后禁止使用旧选型结果。Markdown标签/值/单位和U₀提取也已接入。方法与限制见 [统一研究域说明](docs/UNIFIED_V041.md)。

## 已集成模块

| 模块 | 已实现 |
|---|---|
| 界面 | 更深文字、更大属性和表格字号、强化表头/边框/状态对比；保留可停靠工作区，新增资料/选型/场分析/接入入口 |
| OCR 接入 | Mistral OCR 与自定义 JSON 协议；地址、模型、内存密钥设置；无 Key 不调用云端；请求前明确同意 |
| Agent 接入 | Responses 与 Chat Completions 兼容工具调用；服务端验证意图、人工审批工程变更；本地解析器仍明确标为非大模型 |
| 企业资料 | PDF 文字层、PNG/JPEG、UTF-8 TXT/MD；原件摘要、页码、文字校对、版本历史、引用与有边界的参数提取 |
| 资料检索/问答 | 本机分页文字匹配；可选 Agent 引用检索片段回答，需同意发送；不因回答自动修改工程 |
| 型号库 | 12 个明确标注的演示型号 + 用户核对后入库的完整电缆快照，可关联工程来源与每米价格 |
| 反向选型 | 目标电流、预留、外径、材料约束；逐候选真实计算；按面积/损耗/同币种采购估算排序；可行候选经审批应用 |
| 数值土壤热场 | 五点有限差分 + 稀疏解，显示残差、源功率、边界净热流与粗细网格对照；不替代载流量内核 |
| 竖向电热 | 单根隔离电缆，轴向有限体积+四节点径向电热，给定对流/辐射与沿高空气温度，不是井道 CFD |
| 电场/磁场 | 同轴绝缘电场 RMS 解析；三相平衡电流相量外部磁场解析；分别说明假设，不伪称全耦合 FEM |

## OCR / Agent API Key 后续接入

进入 **接入设置**。填协议、Base URL、模型 ID 与 Key。界面 Key 只留服务端内存，重启失效；配置读取、错误信息和工程导出都不回传密钥。地址和模型名持久化，真实 Key 不写磁盘或 Git。

持久使用请由管理员设置服务端环境变量（不要把真实值发到聊天）：

```powershell
$env:OPENAI_API_KEY='your-key'
$env:CABLESIM_AGENT_MODEL='your-supported-model-id'
$env:CABLESIM_OCR_API_KEY='your-ocr-key'
python scripts/run_demo.py
```

OCR 默认按 Mistral 协议；不同服务商不保证只换 Key 即兼容。自定义协议和 Host 许可配置见 [完整 v0.4 方法与接入文档](docs/ENGINEERING_V04.md)。当前没有用户 Key，未完成真实付费云端 OCR / LLM 成功率验证，自动测试使用模拟响应验证契约。

## 体验流程

1. **资料库**：上传一页产品 PDF 或图片。文字层直接读取；扫描页需配置 OCR 并确认发送原文件。校对文字和单位、确认页面，再生成参数提案并批准。
2. **型号库**：检查当前电缆的全部参数，填型号/企业/可选价格和来源，确认保存。仅提取了少量字段不意味着整根电缆已由厂家资料定义。
3. **反向选型**：输入目标电流与预留；默认只用用户核对型号。没有厂家数据时可明确勾选演示型号。查看失败原因和可行候选，送审后才应用。
4. **场分析**：分别运行土壤数值热场、绝缘电场、外部磁场，或切换“竖向电热”显式设置空气边界。129×129 热场会增加 65×65 的对照；检查方法假设、数值残差和输入版本。

资料提取目前限带明确标签/单位的 U₀、截面积、R20、绝缘/护套厚度，多型号表需要选取单型号节选；不是无监督全型号表识别。资料问答的引用编号会校验，但不能保证每条模型解释正确。

## 数据与工程限制

SQLite 及企业原件默认在 `.data/` 内。资料、型号快照、审批、运行和选型研究持久化。完整备份请停服后备份整个数据目录。工程 JSON 仅包含计算参数，不包含完整资料、历史、锁和凭据。

本版未做：铠装、排管、多回路、土壤干燥、循环/应急、物理竖井气流/烟囱效应、缺陷电场、屏蔽涡流、压降/短路/保护协调完整设计；也没有自动查价、向量资料检索或无限自主 Agent。价格缺失不能宣称成本最优；全部候选失败时报告无可行方案，不放宽边界。

仅供可信本机用户。新增 Host/Origin 防护不等于登录认证。无多租户隔离、调用预算和公网权限体系，**不要直接暴露互联网**。自定义服务需管理员许可 HTTPS 域名；OCR 前明确同意完整文件上传，可能计费。

## 测试

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

GitHub Actions 运行三个 Python 版本、类型检查/生产构建以及 Chromium、WebKit 和移动 WebKit 回归。成功运行保存报告、实际截图、完整依赖解析锁与预构建 ZIP。真实结果以所选提交的 CI 为准；移动模拟不是实体手机，软件测试不替代外部工程校核。

方法详见 [v0.4](docs/ENGINEERING_V04.md)、[基础热网络](docs/METHOD.md)。开源组件包括 Dockview、Konva、TanStack Table、Three.js、LangGraph，以及新增的 pypdf、Pillow、python-multipart、SciPy。构建包附第三方许可证，不包含用户资料、数据库、Key 或字体文件。
