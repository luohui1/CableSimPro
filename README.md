# CableSimPro 0.3 · 专业电缆工程工作台

开发分支 `feat/pro-workbench-v03`。本轮不是换皮：以可停靠的工程树、属性编辑、敷设画布、结果表和工程 Copilot 取代前一版展示型页面。

> 工程辅助 Preview，不是完整 IEC 60287 实现、有限元求解器或经认证的工程设计软件。内核仍为单回路三根相同无铠装单芯电缆、均匀土壤直埋、平衡稳态热网络。交流附加与屏蔽损耗系数是输入；模板不是厂家数据。

## 启动

预构建 Demo ZIP：Python 3.11–3.13，首次安装依赖需要联网，不需要 Node.js。解压进入 CableSimPro 目录：

```sh
python scripts/run_demo.py
```

Windows 可用 `py -3.12 scripts/run_demo.py`。默认地址 `http://127.0.0.1:8000`，Ctrl+C 停止。不要双击源码 index.html。

源码版另需 Node.js 22.12+（22.x）：

```sh
git clone --branch feat/pro-workbench-v03 https://github.com/luohui1/CableSimPro.git
cd CableSimPro
python scripts/run_demo.py
```

修改前端后用 `python scripts/run_demo.py --rebuild`。

## 本轮功能

- Dockview 可调整、拖动停靠的五个工作区；布局保存到浏览器，可重置；小屏切换为模型/属性/Copilot/结果标签。
- Konva 二维敷设画布：真实米制坐标、标尺、埋深/间距尺寸、10 mm 吸附、缩放、平移、选择关联。主画布尺寸一致，局部放大框明确标为结构示意。
- 画布拖动修改受支持的规则排列参数；属性栏精确录入；不能任意拖成求解器不支持的形状。
- TanStack Table 三相结果表、排序、选中行关联对象；保留二维截面、Three.js 三维、土壤解析图、曲线、明细和 HTML 计算书。
- SQLite 工程版本、输入锁、审计记录、撤销/重做、不可变计算快照。每次修改采用预期版本校验，冲突返回 409，不覆盖新编辑。
- 人工与 Agent 通过同一受约束工程修改/校验服务；LangGraph 编排规划与确定性求解工具，提案必须审批。
- 本地任务解析、可选 OpenAI Responses 工具调用；参数差异、假设与完整输入可审查，过期和重复审批被拒绝。
- 资料文字节选提取：支持带标签与单位的截面积、R20、绝缘厚度、护套厚度；原文引用、用户声明页码、原文 SHA-256 随批准记录保存。不是 PDF/OCR 导入，缺失参数不猜测，冲突值不导入。

## 建议体验顺序

1. 直接点“执行计算”；选中结果表的 C 相，观察工程属性关联。
2. 拖动中相改变埋深，或精确输入 1.2 m；旧结果失效，然后撤销/重做。
3. 在 Copilot 输入 `截面积改为 400 mm²，重新计算`。先检查差异，再“批准并执行”。
4. 在“资料来源”粘贴 `截面积: 300 mm²` 与 `R20: 0.0601 Ω/km`，生成提案后确认来源。此文字只是功能演示，不代表厂家产品。
5. 输入 `比较土壤热阻率 0.8、1.2、1.6、2.0 下的载流量`，批准后在“特性曲线”查看扫描。

## 真正的大模型接入

无密钥时使用明确标注的本地命令解析器，**不是通用 AI**。不支持的文本要求澄清，不假装理解。已有服务端 OpenAI Responses 严格函数调用适配器，设置环境变量后重启：

```sh
export OPENAI_API_KEY='your-key'
export CABLESIM_AGENT_MODEL='your-supported-model-id'
python scripts/run_demo.py
```

PowerShell：

```powershell
$env:OPENAI_API_KEY='your-key'
$env:CABLESIM_AGENT_MODEL='your-supported-model-id'
python scripts/run_demo.py
```

然后在界面选择 OpenAI 并确认数据发送。任务与完整工程参数会发送给模型服务，调用可能计费。密钥只留服务端，不要提交 Git 或粘贴到聊天。没有使用用户真实密钥进行云端端到端验证；契约测试不能代表模型实际任务成功率。LangGraph 是有限任务图，不是无限循环、自主联网或任意代码 Agent。没有引入 CopilotKit/AG-UI，当前使用自定义类型化工程组件。

## 保存、历史与兼容

默认数据库 `.data/cablesim.sqlite`（可用 `CABLESIM_DB` 覆盖）。工程修改自动保存，版本单调增加；撤销/重做不回退版本号。编辑分叉会清除重做链。审批和运行记录持久化，聊天气泡仅在当前页面中。当前界面刷新后需重新规划待审批任务；服务器仍保留原审批记录并校验有效期。

工程 JSON 导出仅包含可移植计算参数，不包括整个数据库历史、引用与锁。备份完整工作空间需关闭应用后备份数据库目录。旧 v0.1/v0.2 数据表保留，旧工程可导出 Scenario JSON 后在新版导入；不会自动转换全部旧历史。

前端新入口为 Studio；旧组件与旧 e2e 文件保留作迁移参考，当前 CI 执行 `frontend/pro-e2e`，不是继续用旧界面的通过率代表新界面。后端原有数学/API/Agent 测试继续执行。

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

GitHub Actions 验证 Python 3.11/3.12/3.13、TypeScript/Vite、Chromium、WebKit 与移动 WebKit 模拟。截图、浏览器报告、JUnit、已构建 ZIP 和完整解析依赖锁在对应运行的 Artifacts。实际是否通过以具体提交的 CI 结论为准。移动模拟不是真机验收。前端源依赖指定版本，但完整传递锁文件随构建包交付；选择同次测试工件，不能保证未来重新安装得到同一传递依赖树。

## 未实现与安全边界

没有任意 CAD/排管/干燥带/铠装/多回路/循环与应急求解，没有认证的材料库或成本最优化，没有 PDF/OCR、云端文档检索、多 Agent 自主设计。土壤图为解析叠加，不是 FEM。尚无跨运行的一键多方案对比面板；目前支持不可变运行记录和单参数扫描。

默认仅本机使用，无认证、租户隔离、云端费用上限和公网请求防护，**不要直接暴露互联网**。审批记录是本机审计，不是防篡改合规日志。完整 IEC 方程与正式算例校核仍是独立工程任务，AI/UI 更新不代表求解器已获工程认证。

开源组件：Dockview、Konva/react-konva、TanStack Table、Lucide、React、Three.js、LangGraph，以及 FastAPI/Pydantic/NumPy。构建时生成第三方许可证清单；未采用 Dockview Enterprise 或商业 CAD 内核。详见 `docs/PRO_WORKBENCH.md` 和原 `docs/METHOD.md`。
