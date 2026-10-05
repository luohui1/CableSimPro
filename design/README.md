# 视觉素材

依据 [视觉素材需求](../docs/design/VISUAL_ASSETS.md) 制作；`tokens.css` 是 [前端需求 §5](../docs/design/FRONTEND_REQUIREMENTS.md#5-视觉规则) 的共享代码落点。图标路径均为本项目原创。

全量包含 117 个原创 SVG，分为 nav / module / object / action / run / agent / source / calc / tool / route / resource / result 共 12 组，另有品牌标记与动效演示。具体功能、尺寸与状态规则只维护在视觉素材需求中。

```sh
cd design
npm ci
npm run preview
```

访问 `http://127.0.0.1:8028/design/icons/` 与 `http://127.0.0.1:8028/design/motion/`。安装后字体与 Motion 均从本地加载，页面无外部请求。浏览器须通过 HTTP 读取 SVG 文件。

正式业务界面与启动方式见 [frontend/README.md](../frontend/README.md)。本目录的 `preview` 只通过本机 HTTP 提供图标、字体与动效素材，不启动工程 API，也不读取业务数据库。

CAD 原生视口的源码、构建脚本、版本锁和许可证分发方式统一见 [native/README.md](../frontend/src/features/cad/native/README.md)。`npm run build:occt -- --bridge-only --jobs 4` 转到该构建入口；产物写入 `.data/occt-toolchain/viewer/`，由正式前端核对后准备，不存放在素材目录。

电缆几何由 `cablesim.cable-geometry` 插件生成，视口只显示、选择和测量；接口与边界见 [CAD 视口接口](../docs/architecture/cad-viewport.md)。研究算例由 `backend/kernel/scenarios.py` 提供，CAD 演示由 `backend/kernel/cable_example.py` 提供，均保留输入来源。

SVG 图标内联后继承 `currentColor`；品牌额外引用 `--text-secondary` 和 `--conductor`，缺少主题时降级为单色。字标使用本地 Noto Sans SC 600。Windows 图标从 `brand/mark.svg` 与共享浅色变量生成，使用纸面圆底适配深浅任务栏；运行 `npm run brand` 可重新生成（需要 Pillow）。

图标用 `group/name` 唯一引用，不能通过中文标题定位。选择组件由 `icons/selection.js` 与 `selection.css` 共享；`CableIconSelection.mount(root, { reduced, onChange })` 为 `.icon-choice[data-icon-key]` 控件提供选择、重播、键盘切换与取消，图形放入 `.icon-glyph`。导航容器使用 `data-selection-mode="navigation"`；按钮通过 `aria-pressed` 记录当前项。销毁时调用 `destroy()`；筛选可见项后调用 `refresh()`。系统减少动态效果或后台隐藏时会清理描线，保留实际选中值。

总览的点击仅预览选中，不触发 SVG 名称所指的业务操作。领域状态继续使用独立的状态点与文字，不能把一个描完的图标当成计算通过。

图标页的“重播选中”用于重看当前示例；“慢放 3×”通过选择组件的可选 `durationScale` 回调控制，仅用于预览。正常描线总时长为 320 ms，结束后恢复原始 SVG；系统启用减少动态效果时直接切换，并在控件旁显示状态。

Motion（MIT）、Noto Sans SC 和 IBM Plex Mono（SIL OFL）通过锁定的 npm 依赖分发；原许可分别在 `node_modules/motion/LICENSE.md`、`node_modules/@fontsource/noto-sans-sc/LICENSE` 与 `node_modules/@fontsource/ibm-plex-mono/LICENSE` 中。第三方包不纳入 git。

动效页数值、修订、预检原因和 Agent 文字全部为交互演示数据，不调用工程 API。
