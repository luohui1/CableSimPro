# 视觉素材

依据 [视觉素材需求](../docs/design/VISUAL_ASSETS.md) 制作；`tokens.css` 是 [前端需求 §5](../docs/design/FRONTEND_REQUIREMENTS.md#5-视觉规则) 的共享代码落点。图标路径均为本项目原创。

全量包含 117 个原创 SVG，分为 nav / module / object / action / run / agent / source / calc / tool / route / resource / result 共 12 组，另有品牌标记与动效演示。具体功能、尺寸与状态规则只维护在视觉素材需求中。

```sh
cd design
npm ci
npm run preview
```

访问 `http://127.0.0.1:8027/design/icons/` 与 `http://127.0.0.1:8027/design/motion/`。安装后字体与 Motion 均从本地加载，页面无外部请求。浏览器须通过 HTTP 读取 SVG 文件。

页面原型位于 `workbench/index.html`，访问 `http://127.0.0.1:8027/design/workbench/`。入口为首页 / 型号 / 研究 / 库 / 插件 / 设置。型号结构设计与研究共用模块栏、画布、属性栏、校核项和状态栏；研究已接入客户问询、有限参数扫描、同输入方法对比及当前运行计算书。

`workbench/serve.py` 挂载真实宿主 API 和设计文件，单独使用 `.data/design-workbench/cablesim.sqlite`，不读取或修改业务数据库。需要已安装 `backend/requirements.txt`。也可在仓库根目录运行 `python design/workbench/serve.py`。纯静态 HTTP 服务不能提供此工作台所需的 API。

型号结构设计通过 `cablesim.cable-geometry` 插件生成 CadQuery / Open CASCADE 实体、BRep 和 STEP。浏览器使用 OCCT 自身的 AIS / V3d / OpenGL ES，经 WebAssembly 编译；不依赖 Three.js。剥切、轴向剖面和透明仅改变显示；整层悬停/选中轮廓与列表、属性同步，点距与直径由原始几何捕捉。参数提交后自动生成只读预览，旧几何和用料立即失效，不自动发起工程研究运行。导体单丝、屏蔽丝、反向扎带与丝铠装生成理想螺旋实体；紧压导体明确标为面积等效近似。每层及合计用料使用 kg/km，缺少构造或密度则显示缺少参数，展示段克数只在 STEP 导出时说明。可复用组件、研究接入边界及性能测量接口统一见 [CAD 视口接口](../docs/architecture/cad-viewport.md)。

CAD 依赖使用 `plugins/requirements-native.txt` 中的 CadQuery / OCCT 版本。若默认 Python 未安装原生库，可使用已安装依赖的仓库 `.venv`。并行预览可设置 `CABLESIM_DESIGN_DB` 为独立数据库路径，然后运行 `.venv/Scripts/python.exe -m uvicorn design.workbench.serve:app --host 127.0.0.1 --port 8031`；同一数据库不能由两个服务同时持有。`?view=three` 可直接打开型号三维视图。

原生视口须单独编译，`npm ci` 仅安装界面依赖。`workbench/build-occt.py` 校验 OCCT V7_9_0 提交 `858dd02fed80c8ca68cf1d70a6e03ecf97f849ca`，使用 Emscripten 3.1.73、CMake 3.31.6 与 Ninja。默认上游源码位于仓库 `.tmp/occt-build/OCCT`，emsdk 位于 `.data/occt-toolchain/emsdk`；CMake 可安装到 `.venv`，Ninja 放到 `.data/occt-toolchain/ninja/ninja.exe`。运行 `npm run build:occt -- --jobs 8`，仅修改桥接代码时追加 `--bridge-only` 复用已安装的 OCCT 库。源码可从 [OCCT 官方仓库](https://github.com/Open-Cascade-SAS/OCCT/tree/V7_9_0) 获取，工具链从 [Emscripten 官方 emsdk](https://github.com/emscripten-core/emsdk) 安装。构建默认只包含 TKV3d、TKOpenGles 及其依赖，不引入商业 SDK。

生成的 `occt-viewer.js`、`.wasm`、构建信息及 OCCT 许可证位于 `node_modules/.cache/cablesim-occt/`，不入库。视口要求 WebGL 2，使用 4 倍 MSAA；全部资产从本机服务加载。CAD / STEP 使用 mm，领域事实继续使用 SI。桥接源码保留在 `workbench/occt/`；分发构建物时同时保留 LGPL 2.1、OCCT exception、对应源码与重建方式。理想几何和显示网格的近似范围记录在工件中；复杂多芯、接触形变、制造公差及标准符合性判定仍未接入。

从后端 `/api/presets` 显式选择演示输入，经过领域转换后读写 `/api/workspaces/{wid}/domain`。数据按 `cablesim.domain/1` 保存；草稿、修订基准、冲突拒绝、锁定与历史恢复沿用真实接口。支持单芯公共结构层的尺寸 / 材料编辑、Excel TSV 批量粘贴、缩放、平移、视图中心捕捉及快捷键。型号结构页在窄屏纵向排列几何、校核与对象属性，宽表局部滚动；研究页在窄屏使用模块选择、独立滚动页签和可收起的属性面板。页签支持方向键、Home / End、焦点恢复，未接入页签明确禁用。浏览器本地存储仅保存主题和动效偏好。

型号模块目录遵循前端需求 §3.1，方法可用性读取 `/api/methods`；业务模块与计算方法分别展示。型号顶栏“运行记录”打开抽屉并链接原研究的运行详情，底部保留校核与消息。只读 `/api/design/input-contracts` 从第一方实际 Pydantic 输入模型生成表单并核验封签，提供 IEC 的领域 / 独立输入和热网络领域输入；通用插件参数发布协议尚未完成。几何研究留在型号入口，载流量入口按方法的实际分析类型分类。

载流量原型使用真实 Study → preflight → Run → Delivery 接口；支持温限求允许电流、给定电流求温度和目标电流校核，具体入口受方法能力限制（IEC 不提供任意运行电流下的温度）。结果按 rating / operating 分开，损耗、热阻和求解诊断读取同次运行的类型化结果与已封存 JSON 工件。有限采样逐点运行，失败点不填数；比较先核对输入与方法，再显示同键同工况差值；CSV 和 HTML 计算书绑定选定运行，不重新求解。研究 `input_sources` 保存独立输入及方法参数来源，并随运行封存。

研究共用 `study-shell` 外壳，路由为 `#/studies/<id>/<module>/<tab>`；页签与浏览器前后导航保留草稿和对象选择。新建研究选择问题、任务、型号版本与方法。系统型号库的 Cu / XLPE 演示版本以内容摘要锁定，引用替换使用修订校验，材料和结构不能绕过引用锁修改。方法专用输入可编辑，共享输入只读引用并链接所属模块。直埋品字形、直埋水平和排管模板生成真实坐标；默认视图包含地表，尺寸、拖拽、坐标表与撤销共用草稿，可选择整组调整。

结果先回答所选任务，余量和判定读取插件封存的 `goal_checks`，不在界面判断温限，也不把额定温度当作运行温度。该判定是研究目标校核，不替代产品标准条款、批准的要求对象或签审。土壤、平均埋深、相间中心距和负荷扫描按范围 / 步长逐点执行，曲线与 CSV 保留真实值、单位、版本和失败原因；临界值只报告满足采样值及相邻区间，不插值。方法对比固定相同共享输入，分别保存假设和验证声明。计算书只纳入当前输入的已核验运行，生成、预览、下载均不重算，生成期间输入变化会被拒绝。来源采用统一 16 px 图标，核对状态在来源说明中呈现；回填区、研究三维及场图仍明确显示未接入。

研究演示型号与方法假设在 `workbench/scenarios.py` 显式声明、经领域模型验证；240 mm² 型号物性参照公开 IEC 测试 BASE，400 mm² 参数为声明的演示假设。CAD 演示在 `workbench/cable_example.py` 声明为 YJV72 单芯非磁性铝丝铠装，尺寸与密度保留演示来源。未读取受控 TB 880 数据，不固定结果或绘制示意曲线。型号外径在 CAD 插件生成前显示“未生成”；用料仅在构造和密度齐全时可用；标准限值缺少核对原文时不填。系统演示版本引用已接入，企业型号审核 / 发布、制造公差、Agent 领域提案、复杂回填 / 接头等扩展尚未完成。

SVG 图标内联后继承 `currentColor`；品牌额外引用 `--text-secondary` 和 `--conductor`，缺少主题时降级为单色。字标使用本地 Noto Sans SC 600。Windows 图标从 `brand/mark.svg` 与共享浅色变量生成，使用纸面圆底适配深浅任务栏；运行 `npm run brand` 可重新生成（需要 Pillow）。

图标用 `group/name` 唯一引用，不能通过中文标题定位。选择组件由 `icons/selection.js` 与 `selection.css` 共享；`CableIconSelection.mount(root, { reduced, onChange })` 为 `.icon-choice[data-icon-key]` 控件提供选择、重播、键盘切换与取消，图形放入 `.icon-glyph`。导航容器使用 `data-selection-mode="navigation"`；按钮通过 `aria-pressed` 记录当前项。销毁时调用 `destroy()`；筛选可见项后调用 `refresh()`。系统减少动态效果或后台隐藏时会清理描线，保留实际选中值。

总览的点击仅预览选中，不触发 SVG 名称所指的业务操作。领域状态继续使用独立的状态点与文字，不能把一个描完的图标当成计算通过。

图标页的“重播选中”用于重看当前示例；“慢放 3×”通过选择组件的可选 `durationScale` 回调控制，仅用于预览。正常描线总时长为 320 ms，结束后恢复原始 SVG；系统启用减少动态效果时直接切换，并在控件旁显示状态。

Motion（MIT）、Noto Sans SC 和 IBM Plex Mono（SIL OFL）通过锁定的 npm 依赖分发；原许可分别在 `node_modules/motion/LICENSE.md`、`node_modules/@fontsource/noto-sans-sc/LICENSE` 与 `node_modules/@fontsource/ibm-plex-mono/LICENSE` 中。第三方包不纳入 git。

动效页数值、修订、预检原因和 Agent 文字全部为交互演示数据，不调用工程 API。
