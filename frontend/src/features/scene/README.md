# 场景工作区与 Blender 交换

场景工作区位于研究的「敷设截面 → 三维」，由 `StudyGeometry` 调用。它读取现有 `x-cablesim.cad-scene` 工件，不建立第二份工程，不改变计算插件或审批路径。业务组件从本目录 `index.ts` 导入。

## 当前实现

同一视口旁展示按类型分组的对象列表，支持搜索、选择、显示/隐藏、隔离与恢复。控制只影响显示；导出仍包含完整原场景。原生视口继续使用 OCCT，精确 CAD 能力不迁移、不替换。本轮没有引入 Three.js、vtk.js、自由三维建模或新的运行时依赖。

研究导航按「工程对象、当前研究、进阶研究、交付」分组；进阶研究默认收起，进入该组时展开。模块依然自由切换，不是强制步骤向导。前端 `study-view-policy.ts` 检查结果所属模块，跨计算模块不继承不相干的运行/交付/批量/比较标识。输入和报告仍可查看显式选中的运行快照，错误链接不得静默替换为另一条结果。

二维敷设与三维场景共享截面选择；查看属性按工作区、研究、模块及当前/固定输入隔离。视图状态存于有容量限制的进程内缓存，不写工程数据库，不持久化工程结果。刷新整个页面会重置视图状态。无效草稿、等待新预览及预览失败不能把旧几何展示为当前；历史运行没有场景工件时明确拒绝重新计算。

## 交换边界

浏览器按钮导出 `cablesim-scene.json`，协议 `cablesim.blender-scene/1`。它保留完整对象 ID、资产几何键、输入 SHA-256、工程/研究/截面/修订身份、实例关系，以及米制显示网格。它不包含工程数据库、B-Rep 或求解结果，也不证明物理正确性。

原显示网格为 mm，转换时顶点和 3×4 行主序位姿的第 3/7/11 项（从 0 开始）除以 1000。旋转不变。交换坐标为右手 Z 向上，沿 +Y 展示。Blender glTF 导出器统一完成 Z-up → Y-up，不能重复旋转。包络预览保留 `display-envelope` 标记；只有 B-Rep 而没有显示网格的部件明确拒绝，不猜测替代几何。

交换文件限制：64 MiB、128 对象、512 部件、50 万唯一顶点、100 万唯一三角形、8192 展开实例。非有限值、越界索引、缺失资产、镜像、缩放/剪切及身份缺项拒绝。上述限制用于显示资源控制，不是求解器能力声明。

## 使用 Blender

先从研究页面导出交换文件。可以用普通 Python 检查，无须安装 Blender：

```sh
python frontend/src/features/scene/blender/export_scene.py --input /path/cablesim-scene.json --validate-only
```

仅在独立后台进程运行导出器，输出必须为不存在的新路径：

```sh
blender --background --factory-startup --python-exit-code 1 --python frontend/src/features/scene/blender/export_scene.py -- --input /path/cablesim-scene.json --output /path/scene.glb --save-blend
```

Windows 可将 `blender` 替换为 Blender 可执行文件的完整路径。普通工程师查看场景不需要安装 Blender。

导出器只导入传入的三角形显示网格、复用实例并设置显示材质；不新增虚构电缆、结构层、热物性或温度动画。生成 GLB、可选 `.blend` 和 `.manifest.json`，后者记录交换文件摘要、GLB 摘要、输入身份和实际 Blender 版本。物体 `extras` 保留 `cablesim_entity_id`、`cablesim_geometry_key` 与输入摘要。身份字段用于关联，不代表经过 Blender 编辑后仍与工程几何等价。

生成文件保存在仓库外或已忽略的工作目录，不提交到 Git。本轮是单向交换；从 Blender 回导 GLB 到浏览器、可复用环境资产库、PBR 浏览器场景、温度场三维叠加及精确测量联动尚未实现，不能当作已经交付。

## 测试与验收

```sh
cd frontend
npm run test:scene
# 仓库根目录
python -m unittest discover -s tests -p test_scene_exchange.py -v
```

`frontend/scripts/scene-workspace.test.mjs` 覆盖结果路由、视图缓存、显示过滤、单位转换和交换拒绝行为；它是纯逻辑测试，不是 React/OCCT 浏览器验收。`tests/test_scene_exchange.py` 使用合成三角形，普通 Python 验证格式与资源限制。设置 `CABLESIM_BLENDER` 为已安装可执行文件后，额外执行真实 GLB 导出，核对节点身份、摘要，以及顶点从 Z-up 到 Y-up 的世界坐标。缺少该环境时明确跳过，不能计为通过。

CI 在现有工作流增加独立场景契约与 Blender 交换任务，不删除原后端、Slurm 或发布门禁。完整产品构建、真实工程 UI 回归、Windows DPI 与性能测试仍需在正式环境执行；契约测试不能代替这些验收，也不能代替数值验证。
