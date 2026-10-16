# 场景与热分析工作区

正式入口：研究的「敷设截面 → 三维」；载流量、温度场、暂态温度、电热耦合模块的「可视化」页签。读取现有工程预览及保存运行，不建立第二份工程，不修改计算插件、原始数据或审批路径。

## 场景查看与精确几何

敷设场景在对象列表旁提供「场景视图」和「几何工具」。前者使用原生 WebGL 2，读取同源显示网格，提供实例复用、GGX 材质光照、选择轮廓、旋转/平移/缩放、相机预设、显示剖切和环境透视。后者保留 OCCT 及原有几何工具。两者共享工程对象选择，不能把显示三角形或 shader 剖切当作精确 CAD 拓扑。没有引入 Three.js 或新的运行时依赖。

鼠标拖动旋转，Shift/右键拖动平移，滚轮缩放；触控双指缩放。方向键旋转，F 适应窗口，1/2/3 切换轴测/端面/俯视。视图按需绘制；后台停止绘制，卸载释放事件和 GPU 缓冲区。显卡上下文丢失时明确报错，重试使用新画布。配色来自 design/tokens.css；材质参数仅控制外观。

分组对象列表支持搜索、选择、显示/隐藏、隔离与恢复。控制只影响显示，Blender 导出仍包含完整原场景。显示预算为 128 对象、512 绘制组、50 万唯一顶点、100 万唯一三角形、8192 实例与 400 万展开三角形；超限明确失败，不静默丢对象。像素比上限 2，单边 framebuffer 上限 4096。这些是显示资源限制，不是求解器能力声明。

## 热分析可视化

`thermal-workbench` 只读宿主校验通过的运行与工件。按明确工况选择，失败/未知工况不借用另一工况数据。工件需要完整摘要；温度历史和场图必须绑定该工况原始场束。校验通过不等于工程审批或标准认证。

- 热网络工件：六个已保存同心等效半径、径向热阻、三相节点温度与土壤影响矩阵。可切换相别和运行/额定点，点击节点查看属性。无效运行点保持缺失，不自动用额定点替代。ΔT/R 标为由保存量得到的展示值；土壤 G 矩阵不是独立串联电阻。
- IEC 额定点：呈现工件里的 T1、T2、金属层、T3、T4 及零项，不补造中间温度或热容。电气电容不能当作热容。
- 动态过程：读取已保存的导体温度时间曲线，支持逐步、播放/暂停、重播、1/60/600/3600 倍速、时间游标、分页原始数据和 CSV。按物理时间间隔播放；不同曲线采样时刻不同时，明确标出保持的上一保存值，不插值、不外推。减少动画设置禁用自动播放但保留逐步与拖动；后台自动暂停。
- IEC 60853 应急曲线：显示允许电流与持续时长，单位 A；不称为实际运行电流或温度历史。
- 保存温度场：将真实二维 x/z 网格放入三维视口，使用固定、不受材质灯光影响的色标。现行工件只有单个时间场快照，不能伪装为随时间变化的三维场。

空间模型优先使用同工况 CAD 工件，否则仅热网络协议可用其保存半径生成显式标注的同心等效结构。0.6 m 轴向剥切是展示长度，不是工程长度，也不虚构绞线。时间播放只更新 ID 精确匹配对象的数值标签，不会把导体峰值铺成外护套温度场。当前不从其他运行借模型，不从缺失工件推导三维温度历史。

## 状态与交换边界

二维敷设和三维场景共享截面选择；属性与视图按工程、研究及当前/冻结输入隔离。状态放在有界进程内缓存，不写工程数据库，整页刷新后重置。无效草稿、等待新预览及预览失败不会把旧几何展示为当前；历史运行缺场景工件时不重新计算当前模型冒充历史。

浏览器导出 `cablesim-scene.json`，协议 `cablesim.blender-scene/1`，保留完整对象 ID、资产几何键、输入摘要、工程/研究/截面/修订身份和米制实例网格。不包含工程数据库、B-Rep 或求解结果。原显示 mm 顶点和 3×4 行主序位姿的 3/7/11 项除以 1000，旋转不变。交换坐标右手 Z-up，沿 +Y 展示；Blender glTF 导出器完成 Z-up → Y-up，不重复旋转。包络保留 `display-envelope`，B-Rep-only 部件拒绝猜测替代。

交换文件限制 64 MiB，128 对象、512 部件、50 万唯一顶点、100 万唯一三角形、8192 展开实例；拒绝非有限值、越界索引、缺失资产、镜像、缩放/剪切及身份缺项。

```sh
python frontend/src/features/scene/blender/export_scene.py --input /path/cablesim-scene.json --validate-only
blender --background --factory-startup --python-exit-code 1 --python frontend/src/features/scene/blender/export_scene.py -- --input /path/cablesim-scene.json --output /path/scene.glb --save-blend
```

输出路径必须尚不存在；只在独立后台 Blender 进程执行，不清理交互式用户场景。Windows 使用 Blender 可执行文件完整路径。GLB、可选 .blend 与 .manifest.json 保存为仓库外工件；manifest 记录交换/GLB 摘要、输入身份和实际 Blender 版本。extras 中保留对象和几何键用于关联，不代表编辑后仍与工程几何等价。普通查看不需要 Blender。本轮仍是单向交换，未实现 GLB 回导、精细环境资产库、自由建模或动态三维求解。

## 验证

```sh
cd frontend
npm test
npm run check:styles
npm run check:visualization
npx playwright install --with-deps chromium
npm run test:visualization-browser
# 仓库根目录
python -m unittest discover -s tests -p test_scene_exchange.py -v
```

新增 `visualization.test.mjs` 验证真实数据契约拒绝路径、时间处理、温标、几何、拾取及预算；`verify-visualization.mjs` 用合成测试数据加载真实生产 React/WebGL 组件，覆盖 StrictMode、相别/属性、相机、剖切、不等间距时间回放、CSV、主题、窄屏、减少动画、上下文丢失、重载和卸载。fixture 只由测试导入，不进入应用。截图在 test-results/visualization，不提交 Git。

`check:visualization` 是当前可视化模块及其依赖的严格类型检查，不等于完整应用 `npm run build`。浏览器回归不是完整路由/API/OCCT/真实工程验收，也不是数值算法验证。实际执行状态以 CI 日志为准，不由文档声明推断通过。

CI 保留原后端、Slurm 和发布门禁。Blender 测试需显式 CABLESIM_BLENDER，可用时校验真实 GLB、.blend、对象身份和世界坐标；缺失则跳过，不计为通过。正式发布仍需全量构建、真实工程交互、Windows DPI、性能及原生求解回归。
