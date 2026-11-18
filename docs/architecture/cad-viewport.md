# CAD 视口组件接口

生产入口为 [CadViewport](../../frontend/src/features/cad/cad-viewport.tsx)，二维截面为 [CableSection](../../frontend/src/features/drawing/cable-section.tsx)。两者引用同一领域结构；宿主执行并固定插件工件，OCCT 只显示、选择和测量。原生桥接源码位于 `frontend/src/features/cad/native/viewer.cpp`，构建后的 JS/WASM 不入库。

构建入口、工具链锁、安装 SDK 摘要和许可分发约定统一维护在 [原生构建说明](../../frontend/src/features/cad/native/README.md)。正式运行资产由前端目录准备；构建与超算 CAD 回归均无需旧样板源码或服务。

## 组件边界

| 输入 / 回调 | 含义 |
| --- | --- |
| geometry | `CadModel \| CadScene \| null`；插件生成的单根结构或敷设场景 |
| state、error | 空、加载、失败、成功、历史；失败保留已显示的有效模型 |
| selectedObject | 稳定层或对象 ID；不以层名识别不同线芯 |
| onSelectionChange | 返回被选中的层 / 场景对象，父页面同步属性与二维图 |
| onPick | 原始 BRep 捕捉值；圆直径或两点距离，单位 mm |
| onCameraChange | 当前相机与视图；旋转和平移不改变源几何 |
| loadExact(model, signal) | 读取相同输入和几何键的完整工件，供精确测量 |
| ref.fit / zoom / view / info | 适应窗口、相对缩放、正交 / 等轴视图、原生显示状态 |

组件不保存领域参数，不计算用料，不批准结果。型号页、研究页负责方法选择、修订校验、加载状态、保存与撤销。STEP 由几何插件从原始实体输出，不能从显示网格重建为权威工程几何。

每个视口拥有独立 OCCT 实例、画布与 WebGL 上下文，共享编译好的 WebAssembly.Module。参数变化原位替换受影响的层，保留相机和选中状态；卸载时取消请求、动画、监听器和观察器，释放实体与 WebGL。`prepare-runtime.mjs` 校验锁定构建摘要后复制到忽略目录，Vite 按内容摘要分发，不读取 CDN。

## 单根结构工件

`cablesim.cad-model/1` 必须含 `brep_unit:"mm"`、`axis:"+Z"`、`length_m`、`outer_diameter_m`、`layers` 与输入摘要。当前支持 1–16 个明确定位的圆形 / 扇形芯、最多128个结构层；公共填充、内衬、钢带 / 金属丝铠装与外护套按输入逐层构造。

每层保留：

- `source_target:{scope,core_id?,role}`、稳定 `entity` 和中文 `label`。三芯的同名绝缘、屏蔽不能只按 role 匹配。
- `center_m` 与 `section_profile:{outer,inner,holes}`。扇形给定圆弧直径、夹角和朝向；均匀包覆是该凸轮廓的等距平行曲线。外径由最远轮廓点和公共层推导，不使用扇形外接圆替代芯间碰撞检查。
- `section_outline_brep` 是实际截面轮廓，仅供高亮；精确测量仍加载原始实体。填充的内部轮廓是全部线芯，不是一个等效圆孔。
- `peel_fraction` 按结构深度定义，同一层级的三个导体保持相同可见长度。原生 `info()` 返回 `visible_lengths_mm` 与 `profile_parts`，用于核验显示状态。
- 原始 `brep_text` 或同源 `display_mesh`、`geometry_key`、尺寸、材料、构造与体积。精确替换还核对芯身份、轮廓和中心位置，拒绝旧输入工件。

扇形角度或朝向缺失的历史草稿可读取，绘图和半径计算明确拒绝，不推测角度。中空、波纹和未覆盖的非圆离散丝结构明确拒绝。三芯目前沿轴向挤出展示，不模拟成缆扭转；该几何边界随工件保存，不能当成实际绞合制造模型。

二维使用同一圆形 / 扇形平行轮廓和填充孔洞。每芯导体与公共层标注常显，展开所选芯的中文层名；所有层仍可从原始轮廓或分层表选择。新增芯复制设计构造，清除实测字段，位置必须明确且无重叠。

## 用料与制造输入

`volume_m3` 是原生实体体积，`material_volume_m3` 是用料体积，两者可能不同；`quantity_basis` 说明依据。`mass_kg_per_km` 按用料体积 / 展示长度 × 密度 × 1000 汇总，缺任一层的构造或密度时合计为空，不补猜值。

| 构造 | 几何与用料 |
| --- | --- |
| 圆绞导体 / 金属丝层 | 明确根数、丝径、节距；理想螺旋实体积分，包含螺旋长度，不模拟接触变形 |
| 紧压、分割、扇形导体 | 声明外轮廓包络；用料为标称截面 × 展示长度 × 明确绞入系数。缺系数不把包络体积算成实铜 |
| 连续层 / 填充 | 原始实体积分；填充扣除各芯真实外轮廓，保留芯间空隙所占材料 |
| 单带搭盖屏蔽 | 显示径向设计包络；用料为平均轮廓周长 × 单带厚度 × 长度 / (1−搭盖率)。扇形使用展开周长，包络体积不作金属量 |
| 双钢带间隙铠装 | 两条相错半节距的原生螺旋带；数量为2、径向厚度为2倍单带厚，给定带宽和最大轴向间隙。节距按这些明确参数推导；若同时输入节距，须一致 |

搭盖金属带不模拟层间接触电阻，不能据 CAD 包络给出屏蔽纵向电阻。铜带缺带宽时可以显示明确的包络，但用料保持缺项；完整规格书生成会在结构用料步骤阻止继续。

型号演示库的 `system.specification-yjv22-300` 使用江苏华远公开 3×300 尺寸与明示教学参数。导体 R20 是标准上限设计输入；密度、绞入系数、连续接触模型等不是厂家实测。已有独立演示库通过 `frontend/scripts/seed-engineering-demo.py --supplement-mv` 只补缺项，并保存逐字段来源和三项规格书条件。原始厂家候选、工厂测量与审批不被覆盖。其他设计演示及标准原文依据保留在各型号来源中。

## 预览、缓存与运行环境

自动预览 `include_exact:false` 只省略完整 BRep / STEP 序列化；实体、有效性、体积已在插件中生成。原生网格包含实例变换，使用保持拓扑共享的 Location 变换，避免平移克隆导致三角化缓存丢失。精确请求从同源实体读取完整工件；输入变化则拒绝过期结果。

宿主缓存按工作区、插件版本和封签隔离，最多六份已验收预览；几何插件缓存按轮廓、位置、长度和制造参数匹配。密度及绞入系数变化只重算相关用料，几何不变则复用。驻留进程串行执行，超时和服务退出清理进程树。原生测量不使用显示裁剪新面或三角网格代替原始拓扑。

超算 CAD 使用 `.data/hpc/cad-config.json` 和 `~/cablesim/cad-env/bin/python`：锁定 CadQuery 2.8.0 / OCP 7.9.3.1.1 / VTK 9.6.2，隔离 Ubuntu 22.04 运行时提供 glibc 2.35；环境、镜像与原生库摘要记录在 `.data/hpc/environment-lock.json`。Slurm 控制程序使用宿主 Python，计算进程进入 CAD 运行时，避免在容器内嵌套调度。普通仿真环境保持独立。

原生回归由 `scripts/run_plugin_tests_hpc.py --profile .data/hpc/cad-config.json` 提交 Slurm 超算集群，保存冻结源码、测试结果和实际核时。手算覆盖圆形 / 扇形尺寸、凸轮廓平行层面积与周长、填充体积、用料和场景区域守恒；浏览器检查入口见前端 `cad/README.md` 与 `type/README.md`。敷设坐标与区域契约见 [installation-scene.md](installation-scene.md)。
