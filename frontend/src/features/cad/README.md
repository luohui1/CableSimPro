# 电缆专业画布

沿用 [前端工程规范](../../../README.md) 和 [图纸要求](../../../../docs/design/FRONTEND_REQUIREMENTS.md)。组件实现、陈列条目与验收工具仅位于 `cad/` 和相邻 `drawing/`。业务页面通过各目录的 `index.ts` 引入组件；陈列数据与浏览器探针只由独立陈列入口引用。

## 接口

| 组件 | 输入 | 受控编辑与回调 |
| --- | --- | --- |
| `CadViewport` | `geometry: CadModel \| CadScene \| null`，`selectedObject`，五态 `state`，`error`；工件长度用 m，原始 BRep/显示网格用 mm | `onSelectionChange` 返回稳定层/对象 ID；`onPick` 返回原生捕捉值；`onCameraChange`、`onReady`、`onError`；`loadExact(model, signal)` 按同一输入摘要和层标识取得精确工件。ref 提供 `fit/zoom/view/info` |
| `CableSection` | OpenAPI 的 `CableType` 和 `Material[]`，`selectedObject: LayerTarget`，五态、`editable`、`isLocked` | `onSelectionChange`；`onDimensionChange({target, field, valueM, previousValueM})`。图上输入为 mm，回调为 m；提交失败保留输入框草稿 |
| `LayingSection` | OpenAPI 的 `DomainDocument`、`sectionId`、`selectedObject`，五态、`editable`、`isLocked(field)` | `onChange(nextSection, {gestureId, kind, selection, fields})`；一次拖动提交一次。`onPreview` 仅表示拖动预览，取消/结束返回 null；`onTemplateRequest(id)` 由父页面读取正式模板并更新 props |

`DrawingCommand` 为 `undo/redo/save`。父页面管理研究草稿、保存与撤销记录，组件不创建另一份已保存领域状态。输入框保留浏览器文本撤销。历史图纸可选择和查看，尺寸与位置只读。`onObjectCommand` 让父页面处理实例复制/删除及布置操作；`objectCommands` 指定当前已接入的操作，未接入按钮保持禁用。`canUndo/canRedo` 由页面提供。

电缆参数截面保持圆形 / 扇形层的真实比例与原始芯坐标，不据标称面积反推外轮廓。扇形须给圆弧直径、夹角及朝向，分割导体显示声明的设计包络；填充扣除各芯外轮廓。三芯同名层以芯 ID 区分，中文标注展开所选芯。材料缺项、碰撞和无效尺寸报到具体字段。敷设视图仅转换 SI 坐标与显示包络，不给标准间距、载流量、质量或热学结果。拖动提交前检查几何重叠、地表、管内边界、土层边界和字段锁定；页面仍负责正式领域校验。

模板默认展示 `single/double/duct/backfill/three-core` 五个陈列标识。生产页面应通过 `templates` 传入正式接口实际接受的 ID，再由 `onTemplateRequest` 请求；组件不猜接口路径或模板工程参数。开启管缆联动时，移动电缆可带动所属管道及关联成员；也可关闭联动。缩略窗和局部放大不改变主图比例；窄画布的缩略窗移到主图下方，避开尺寸和编辑器。

## 原生运行资产

原生源码、构建入口与版本锁位于 [native/](native/README.md)。`prepare-runtime.mjs` 从 `.data/occt-toolchain/viewer/` 读取产物，核对版本、源码、JS/WASM 和许可摘要后写入本目录被忽略的 `node_modules/.cache/cablesim-occt/`。Vite 按内容哈希分发 JS/WASM；不读取 CDN。每个视口拥有独立原生实例、画布和 WebGL 上下文，只共享已编译的 `WebAssembly.Module`；卸载关闭监听器、观察器、动画、精确工件请求，移除原生实体并释放 WebGL 上下文。编译失败不留失败缓存，后续重试可重新加载。精确替换同时核对输入摘要、展示长度、外径、各层半径、材料和已声明构造；没有 geometry_key 也不接受尺寸错配。

`prepare-fixtures.py` 仅为陈列生成少量真实原生几何，不运行求解器。原始工件位于本目录被忽略的 `node_modules/.cache/gallery/`；示例参数全部标为演示，正式组件不引用它们。

```sh
# 仓库根目录；使用已有 CAD 虚拟环境
python frontend/src/features/cad/native/prepare.py --jobs 4
python frontend/src/features/cad/tests/test_runtime_bootstrap.py
.venv/Scripts/python.exe frontend/src/features/cad/prepare-fixtures.py

# frontend 目录
node src/features/cad/prepare-runtime.mjs
npm run check:styles
npx tsc -p src/features/cad/tsconfig.json
npx vite build --config src/features/cad/gallery.config.ts --logLevel warn
node --test src/features/cad/tests/runtime-assets.test.mjs src/features/cad/tests/geometry.test.mjs src/features/cad/tests/component.test.mjs
node src/features/cad/tests/verify-browser.mjs
```

独立陈列构建保存在 `.data/frontend-canvas/build/`。验收脚本自行分配本地端口，只服务构建产物；结束关闭全部自建标签页、核对数量并删除隔离浏览器配置。截图与机器结果保存到 `.data/frontend-canvas/`，不入库。几何单元测试的临时转译文件在 `.tmp/frontend/`，同次运行结束删除。

## 陈列入口与公共层接线

`cad/gallery-entry.tsx` 和 `drawing/gallery-entry.tsx` 各自导出 `galleryEntries`，条目为 `{id, title, Component}`，组件接收 `state`。三个 ID 分别为 `cad`、`cable-section`、`laying-section`。当前公共 README 与 GalleryPage 没有功能目录注册入口，因此使用本目录 `gallery-root.tsx` 复用公共 AppShell，在独立构建的 `/gallery` 验证；这不等于公共正式 `/gallery` 已挂载。

前端线程需协调：

1. 公共 GalleryPage 读取上述条目并挂载三个分区；陈列 fixture 保持仅陈列可达。
2. 公共构建准备阶段调用 `prepare-runtime.mjs`，陈列构建前准备 fixtures；公共 `npm test/test:browser` 登记这里的验收入口。
3. 型号/研究页面传入正式几何与领域数据，绑定稳定选择 ID、字段锁定、模板接口、保存和页面撤销；调用业务接口的适用性与审批仍由页面/宿主负责。

不修改公共组件、路由、令牌、package scripts 或业务页面。共享前端并行迁移产生的类型错误须由其所属线程处理；上述局部严格类型检查独立验证当前交付。

## 验证范围

手算校验单芯绘图外径 38 mm，并对照原生工件；验证三芯原始坐标、SI/像素变换、1 mm 捕捉、原生工件身份、原始拓扑加载、失败回滚、原子管缆移动、土层联动、锁定字段、父页面撤销与五态。浏览器流程包含尺寸提交失败保留草稿、五种模板、回填缩放、缩略窗、保存回调和减少动态。

`onReady.elapsedMs` 从工件到达客户端开始计时，到原生更新后的下一动画帧；首挂载计入运行加载/编译，不包含插件求解、服务端计算与传输等待。单根更新与场景首显要求小于 3000 ms，结果记录实际环境的样本，不作为求解器性能基准。WASM 编译复用与卸载后原生实例归零在组件测试中检查。

桌面检查 1366×768、1920×1080，浅/深色及 100/125/150% CDP 模拟；直接由 CDP 截图并核对像素尺寸，避免截图工具恢复默认视口。另查 390 px 移动宽度。Windows 系统 DPI 尚未实机核验。超算 CAD 回归使用 `.data/hpc/cad-config.json` 提交 dg83，保存源码快照、测试日志及实际核时。
