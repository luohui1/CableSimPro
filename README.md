# CableSimPro · 中压电缆工程工作台

面向单回路中压电缆的可运行工程辅助 Demo：参数化二维/三维建模、稳态载流量及温度计算、工程保存、计算书、参数扫描与方案对比。

> **计算边界**：这不是经认证的工程设计软件，也不是完整 IEC 60287 实现。当前内核为同心圆筒径向热阻 + 均匀土壤半空间三相互热模型；交流附加系数、屏蔽损耗系数是显式输入。不得将演示默认值直接用于工程选型或保护整定。

## 立即运行

当前 Demo 在分支 `feat/mv-engineering-demo`，代码审查见 [PR #1](https://github.com/luohui1/CableSimPro/pull/1)。

### 方式一：源码启动

准备 Python 3.11–3.13，以及 Node.js 22.12 或以上的 22.x 版本。首次安装依赖需要联网。

```sh
git clone --branch feat/mv-engineering-demo https://github.com/luohui1/CableSimPro.git
cd CableSimPro
python scripts/run_demo.py
```

macOS/Linux 的 Python 命令可能为 `python3`。Windows 可以使用 `py -3.12 scripts/run_demo.py`。

启动器在仓库内创建 `.venv`，安装后端依赖，构建前端，然后启动服务并打开 `http://127.0.0.1:8000`。按 Ctrl+C 停止。更改前端源码后运行：

```sh
python scripts/run_demo.py --rebuild
```

### 方式二：使用已经构建的 Demo 包

打开 [GitHub Actions](https://github.com/luohui1/CableSimPro/actions)，选择本分支**成功**的 `CableSimPro CI` 运行，在 Artifacts 中获取 `CableSimPro-demo`，解压其中的 `CableSimPro-demo.zip`。进入包含 `backend`、`frontend`、`scripts` 的 `CableSimPro` 目录：

```sh
python scripts/run_demo.py
```

此包包含 `frontend/dist`，**运行时不需要 Node.js**；仍需要 Python 及首次安装后端依赖的网络。GitHub 下载 Actions 工件可能要求登录。包内 `BUILD_INFO.json` 记录构建时检出的 Git 提交。

仅提供源码和本地启动流程，不代表已经部署到公网。不要直接双击源码中的 `frontend/index.html`；它需要构建，并通过同源 HTTP 服务访问计算 API。

## 功能

| 模块 | 已实现行为 |
|---|---|
| 参数化建模 | 铜/铝单芯电缆、导体屏蔽、XLPE 绝缘、绝缘屏蔽、等效金属屏蔽、外护套；二维尺寸与三维结构联动 |
| 三维交互 | 剖切结构、分层展开、旋转/缩放、重置视角；WebGL 不可用时退回二维 |
| 敷设 | 均匀土壤直埋；单回路三根相同电缆；水平和等边三角排列；三相平均中心埋深与中心间距 |
| 计算 | 温度修正电阻、导体/屏蔽/介质损耗、分层热阻、三相互热、允许载流量、给定运行电流的温度与裕量 |
| 结果 | 三相明细、径向节点温度、热阻矩阵、电流温度曲线、外部土壤解析温度图 |
| 工程管理 | SQLite 保存、重开、更新、删除；带版本的 JSON 导入/导出；导入前完整校验 |
| 方案研究 | 四种敷设参数扫描；最多四个不可变结果快照对比（当前会话内） |
| 交付 | 含输入快照、模型版本、SHA-256 和警告的 HTML 计算书；运行结果 CSV |
| 防误读 | 参数改变立即隐藏旧结果；不能导出过期计算书；无稳定运行解时不伪造温度或损耗 |

HTML 计算书下载后用浏览器打开，可通过浏览器打印功能另存为 PDF。当前不包含服务器端 PDF 排版引擎。

## 推荐演示流程

首次打开会加载 Cu / XLPE 12/20 kV、240 mm²、0.8 m 平均中心埋深、0.12 m 中心间距的演示工况并执行计算。所有模板为演示假设，不是厂家产品库。

1. 在“二维截面”和“三维结构”间切换，尝试“分层展开”。
2. 将导体截面积改为 400 mm²，观察模型联动和旧结果清空，然后点击“执行计算”。
3. 在“敷设”页调整土壤热阻率、埋深或三相排列；查看“土壤温度”与敏感性曲线。
4. 将不同工况加入“方案对比”，再保存工程并导出计算书。

**相对地电压 U₀ 不是线电压 U**。默认模板为 12/20 kV 的参数演示。电压、绝缘厚度及材料的组合没有经过绝缘配合校核，不会因选择某个电压就自动成为对应电压等级的合格产品。

## 计算方法与验收

详见 [方法、方程与单位](docs/METHOD.md)、[验收与测试说明](docs/ACCEPTANCE.md)。

自动测试验证软件逻辑、解析退化解、热平衡、单调性和浏览器功能。它们不能替代 IEC 正式算例、厂家数据、独立参考软件或实测工况校核。实际测试是否通过，以所选提交的 Actions 运行记录为准。

CI 执行三个 Python 版本的后端测试，TypeScript 类型检查、Vite 生产构建，并通过真实 API 在 Chromium、桌面 WebKit 和移动 WebKit 中测试工作流。测试报告、界面截图与成功构建的 Demo 包保存在 Actions 工件中；移动 WebKit 是模拟测试，不等于实体 iPhone 真机验收。

## 开发模式

后端（从仓库根目录运行）：

```sh
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell 使用 .venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

另一个终端启动前端：

```sh
cd frontend
npm install
npm run dev
```

前端开发地址由 Vite 输出，`/api` 自动代理到 8000 端口，无需放开跨域。生产构建则由 FastAPI 同源提供静态资源。**后端统一从仓库根目录启动，不再支持旧的 `cd backend && uvicorn main:app` 路径。**

测试与打包：

```sh
python -m pytest
cd frontend
npm install
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e
cd ..
python scripts/package_demo.py
```

依赖的主版本/精确版本见 requirements 与 package.json；前端完整解析锁文件随 CI 工件保存，源码尚未锁定全部传递依赖。应使用经过测试的同次构建工件，不能宣称日后重新安装必然得到相同依赖树。

## 数据与部署边界

SQLite 默认位于 `.data/cablesim.sqlite`，可通过 `CABLESIM_DB` 改变路径。关闭程序不会删除保存的工程；删除工程需界面确认。方案对比快照只保留在当前页面会话中，刷新会清除。重要工程应使用“导出工程”备份。

启动器默认仅监听本机。需要在同一局域网的手机浏览器访问时，可在受信任网络中使用 `--host 0.0.0.0`，浏览器打开电脑的局域网 IP 与端口；系统防火墙需允许访问。**没有登录、鉴权、权限隔离或公网请求限流，不应直接暴露到互联网**。正式多用户部署需要补充身份认证、访问控制、反向代理 TLS、请求限制、备份与数据迁移。

已有依赖时可使用 `python scripts/run_demo.py --skip-install --no-browser --port 8001`；此选项使用执行该命令的当前 Python 环境，不会自动切换到 `.venv`。

## 目录

```text
backend/              输入校验、计算内核、API、报告与持久化
frontend/src/         React + TypeScript 工作台、Three.js 模型与二维图表
frontend/e2e/         真实后端浏览器测试
scripts/              启动与 Demo 打包脚本
tests/                数学性质、API 和打包边界测试
docs/                 计算方法、工程边界与验收清单
.github/workflows/    自动测试、构建和工件保存
```
