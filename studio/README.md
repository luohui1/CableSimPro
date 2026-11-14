# Cable Studio

电缆专业软件：工作台是主体，一张活的敷设断面图占主屏的大半，上方是四格前提（电缆、敷设、工况、方法），右侧是结论，下方是运行记录；Agent 是在工作台里干活的同事。第一项功能是地下敷设（直埋、排管）的稳态载流量校核、扫描与选型，只用仓库里已验证的开源方法。

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
| `ui/` | React 工作台：`canvas/` 断面画布（相机、GPU 温度场层、矢量层、标注避让）；`results/` 结论栏；`workbench/` 顶栏、前提带、运行记录轨；`components/` 自绘控件；`state/` 读取宿主与视图状态；`pages/gallery.tsx` 组件陈列（`/gallery`） |
| `core/tests/`、`tests/` | 真实流程测试与界面走查 |

计算核心直接引用仓库里的 `cablesim_sdk/` 和 `plugins/cablesim.iec60287/`，不复制、不改算法。厂家公开结构表读自 `backend/kernel/model_series_data/`。

## 界面

- 规则只有一份：`design/tokens.css`。`ui/styles/app.css` 把它映射成 Tailwind CSS 4 的工具类，并清空默认的颜色、字号、圆角和阴影，规则之外的类不存在。图标用 `design/icons/`。
- 控件写在 Base UI 原语上，形状按职责区分：药丸形按钮（对工程的动作）、圆角方形工具（对图的动作）、凹槽分段器（同一视图的几种状态）、下划线标签页（同一位置的不同内容）、方形印鉴（信任等级，常驻）、实心徽标（需要处理的状态）。
- 断面画布按真实比例绘制，不折断坐标。三层共用一个相机：GPU 层画土壤、网格、温度场和等温线（three 的 WebGPU 渲染器，没有 WebGPU 时用 WebGL 2）；SVG 层画电缆的真实结构层、尺寸和等温线数值；HTML 层放电缆标签和工具。标签逐个占位，后放的避开先放的。
- 温度场：方法只在一张粗的显示网格上发布温度场，并声明了它的模型（镜像线热源，取各电缆保存负荷下的总损耗）。显示层按这个模型逐像素计算，显示前先与方法发布的每个节点比较，差值超过 1e-6 K 就改为只用发布的节点线性插值。温度场只在保存负荷下显示。
- 工程数据只在宿主里。界面用 TanStack Query 读取，用事件流得知何时重读；界面自己的状态只有选中、工况切换、图层和相机。
- 其余：React 19.3 加 React Compiler（不手写记忆化）、TypeScript 7、Vite 8、Motion、TanStack Router（代码式路由）。

界面目前覆盖：查看四个前提、断面与温度场、结论与归因、对象数值、方法卡、切换运行记录、运行校核、导出计算书。修改输入、发起参数扫描和选型、Agent 的任务与审阅，宿主接口都有，界面还没有接上。

## 数据

一个工程是 `CABLE_STUDIO_HOME/projects/<id>/` 下的一个文件夹：

- `project.json`、`cable.json`（绑定的型号库版本）、`installation.json`、`conditions.json`、`method.json`：带结构版本号的输入，可改。
- `runs/<run>/record.json`：一次计算的完整记录（当时的输入、发给插件的请求、插件的结果与工件、各项摘要、插件版本、方法卡），写入后不可改。输入变了以后，旧记录仍在，只标为“旧输入”。
- `reports/<run>.html`：从运行记录生成的计算书，可打印，浏览器里可另存为 PDF。

## 操作层与 Agent

工作台的每个动作在 `host/operations.ts` 里只有一份：人点按钮经 `POST /api/ops/<操作>` 调用，Agent 把同一个操作当工具调用。Agent 内核是 pi 的 `@earendil-works/pi-agent-core`，只有这些操作，没有读写文件、命令行或联网工具。

- 读取和计算（校核、扫描、选型、导出计算书）直接执行；计算生成的是运行记录，不改输入。
- 改输入（换型号、改敷设、改工况、改方法参数）在 `beforeToolCall` 里停下，变成一项待审改动：带着改了什么、改动后的可信分档和改动后的断面。接受后才写入；拒绝的原因会告诉 Agent。
- 任务和步骤由内核的事件流驱动（`/api/events`），只有步骤和去向；结果落在运行记录里，和人手工算出来的是同一种东西。

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
cd studio && npm run build && npm run walk  # 界面走查：真实宿主和内核，1366×768 与 1920×1080，逐步截图并检查文字重叠和裁切
```

走查的截图默认写到 `<仓库>/.tmp/studio-walk/`，也可以把输出目录作为参数给出。

`core/tests` 核对的内容：TB 880 算例 0-1、0-2 及其变体经“型号库条目 → 组装 → 独立进程运行”重算出公开值；独立进程的结果与进程内直接调用算法逐位相同；公开的起帆结构重算出 CableSimPro 发布时记录的值；扫描、选型、拒算、封签被改时拒绝运行、本机服务往返。
