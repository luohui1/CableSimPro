# Cable Studio

电缆专业软件：工作台是主体（工程树、截面画布、属性面板、结果、计算书），Agent 是在工作台里干活的同事。第一项功能是地下敷设（直埋、排管）的稳态载流量校核、扫描与选型，只用仓库里已验证的开源方法。

## 运行

需要 Python 3.11+（含 `pydantic`、`jsonschema`，即 `backend/requirements.txt` 的环境）和 Node.js 22.19+。

```sh
cd studio
npm install
npm run build     # 构建界面到 studio/dist
npm start         # http://127.0.0.1:8200/ ，只监听本机
```

`npm run dev` 另起带热更新的界面（8201），接口转发到 8200 上的宿主。

| 环境变量 | 作用 |
| --- | --- |
| `CABLE_STUDIO_PORT` | 宿主端口，默认 8200 |
| `CABLE_STUDIO_HOME` | 工程目录，默认 `<仓库>/.data/studio` |
| `CABLE_STUDIO_PYTHON` | 计算核心与插件使用的 Python，默认 `python` |
| `DEEPSEEK_API_KEY` | Agent 用 DeepSeek（模型默认 `deepseek-flash`，可用 `CABLE_STUDIO_MODEL_ID` 改） |
| `CABLE_STUDIO_MODEL_BASE_URL`、`CABLE_STUDIO_MODEL_ID`、`CABLE_STUDIO_MODEL_API_KEY` | Agent 用任意 OpenAI 兼容接口 |
| `CABLE_STUDIO_MODEL_THINKING` | 思考强度 `off`（默认）/ `low` / `medium` / `high` |

密钥只从环境变量读取，不写入磁盘。没有配置模型时 Agent 面板显示“模型未配置”，其余功能照常可用。

## 结构

| 目录 | 内容 |
| --- | --- |
| `core/studio_core/` | Python 计算核心，不含算法：`runner.py` 按 `cablesim.run/2` 在独立进程里运行 `plugins/` 下的插件，运行前核对封签；`library.py` 型号库；`layouts.py` 敷设模板；`scene.py` 把型号、敷设、工况组成 `cablesim.domain/1` 文档；`study.py` 校核、扫描、选型；`methods.py` 方法卡与可信分档；`__main__.py` 给宿主用的本机服务（标准输入输出，每行一个 JSON） |
| `host/` | Node 宿主（TypeScript，由 Node 直接运行）：`store.ts` 工程文件夹；`operations.ts` 操作层；`agent.ts` Agent；`report.ts` 计算书；`server.ts` HTTP 与界面 |
| `shared/` | 宿主与界面共用的类型、数值写法和绘图几何 |
| `ui/` | React 工作台 |
| `core/tests/`、`tests/` | 真实流程测试 |

计算核心直接引用仓库里的 `cablesim_sdk/` 和 `plugins/cablesim.iec60287/`，不复制、不改算法。厂家公开结构表读自 `backend/kernel/model_series_data/`。

## 数据

一个工程是 `CABLE_STUDIO_HOME/projects/<id>/` 下的一个文件夹：

- `project.json`、`cable.json`（绑定的型号库版本）、`installation.json`、`conditions.json`、`method.json`：带结构版本号的输入，可改。
- `runs/<run>/record.json`：一次计算的完整记录（当时的输入、发给插件的请求、插件的结果与工件、各项摘要、插件版本、方法卡），写入后不可改。输入变了以后，旧记录仍在，只标为“旧输入”。
- `reports/<run>.html`：从运行记录生成的计算书，可打印，浏览器里可另存为 PDF。

## 操作层与 Agent

工作台的每个动作在 `host/operations.ts` 里只有一份：人点按钮经 `POST /api/ops/<操作>` 调用，Agent 把同一个操作当工具调用。Agent 内核是 pi 的 `@earendil-works/pi-agent-core`，只有这些操作，没有读写文件、命令行或联网工具。

- 读取和计算（校核、扫描、选型、导出计算书）直接执行；计算生成的是运行记录，不改输入。
- 改输入（换型号、改敷设、改工况、改方法参数）在 `beforeToolCall` 里停下，变成工作台上方的一项待审改动：显示改了什么、改动后的可信分档，可在截面上预览。接受后才写入；拒绝的原因会告诉 Agent。
- 任务面板由内核的事件流驱动，只显示步骤和去向；结果落在运行记录里，和人手工算出来的是同一种东西。

## 可信分档

每条结果带分档和方法卡（方法、适用范围、假设、验证依据）。分档由实际计算的敷设形式决定，与结果数值无关，规则在 `core/studio_core/methods.py`：

- **可交付**：单回路、单芯、光滑金属套，直埋或穿管。依据是 CIGRE TB 880 算例 0-1（接触品字形直埋）、0-2（接触品字形穿管）、0-3（平排穿管加包封）的整链对照。直埋水平和留间隔品字形没有单独的整链公开算例，方法卡里写明了这一点。
- **参考**：多回路、矩形回填与包封、三芯、皱纹金属套、外部给定损耗系数。只有手算或解析自洽检查。
- **探索**：留给尚未通过评测基准的方法，目前没有方法落在这一档。

分档说的是方法；型号数据的来源另外标注。库里的型号是“结构演示”或“公开厂家资料”，都不是厂家确认的产品数据，计算书的结论处会写明。

## 测试

```sh
python -m pytest studio/core/tests          # 计算核心；设 CABLESIM_TB880_FIXTURES 后重算 TB 880 六个算例
cd studio && npm test                       # 宿主：工程师流程与 Agent 流程（脚本模型）
```

`core/tests` 核对的内容：TB 880 算例 0-1、0-2 及其变体经“型号库条目 → 组装 → 独立进程运行”重算出公开值；独立进程的结果与进程内直接调用算法逐位相同；公开的起帆结构重算出 CableSimPro 发布时记录的值；扫描、选型、拒算、封签被改时拒绝运行、本机服务往返。
