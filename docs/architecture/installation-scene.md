# 敷设场景几何接口

本接口由 `cablesim.cable-geometry` 的 `installation-scene` 能力生成，输入为同一份 `cablesim.domain/1` 领域文档及选定 `section_id`。研究二维截面和三维不保存第二份坐标；宿主只执行、验收和固定输入，几何构造在插件内完成。

## 坐标、范围与参数

- 领域坐标为 m：x 横向，z 竖向向上，地表 z=0。场景沿 y 从 0 拉伸到 `length_m`，默认 0.4 m；不代替线路实际长度。
- BRep、显示网格及位姿矩阵使用 mm。原单根电缆局部轴为 +Z；通过刚体变换 `(local_x, local_y, local_z) → (x+local_x, local_z, z-local_y)` 安放，保持右手坐标系和实体体积。
- 排管按输入内外径、中心坐标拉伸；矩形容纳结构缺壁厚时只生成明确标注的外包络。回填按中心 x/z、width/height 拉伸；土壤分层保留原 top_z/bottom_z，未指定分层部分采用截面的基准土壤。
- 土壤横向无限范围不能输出有限 BRep。`crop_bounds_m` 明示本次有限显示窗口，默认包围电缆、容纳结构、回填和已给定分层并留边距；可显式指定。它不是数值分析的远场边界。地表是这个窗口上的参考面，不能作为一层有厚度的材料。
- 土壤扣除回填、排管外包络和电缆外包络；回填扣除排管、电缆外包络。层间及实体不会重复占用介质体积；管内空腔和电缆内部构造缺项不擅自填充材料。
- 当前复用已有单芯同心型号能力；不支持的多芯、偏心、中空、波纹等输入明确拒绝，不生成替代实体。紧压 / 分割导体仍是设计外径包络，其名义材料量与包络体积分别记录。

## `cablesim.cad-scene/1` 工件

```text
schema, section_id, input_sha256, length_m
geometry_unit: m, brep_unit: mm, coordinate_frame: x/y/z, extrusion_axis: +Y
crop_bounds_m: [xmin, ymin, zmin, xmax, ymax, zmax]
assets: {asset_id: {geometry_key, brep_text?, display_mesh, category, material,
                   representation, volume_m3, inner_radius_m?, outer_radius_m?}}
objects: [{id, kind, label, cable_type_id?, position_m?, bounds_m,
           parts: [{asset_id, transform_mm}]}]
exact_pending, step_text?, material_sources, build_stats, limitations
```

`kind` 为 cable / enclosure / backfill / soil / ground。电缆、容纳结构、回填和分层的 ID 沿用领域 ID；基准土壤及地表使用截面 ID 派生的稳定 ID。同型号、同长度的电缆共享局部层工件，每根实例仅携带位姿。`transform_mm` 是行优先 3×4 刚体矩阵，前三列为无量纲旋转，最后一列为 mm 平移；先变换局部 BRep 或局部显示网格，再组成整个世界场景。网格内部的 prototype/instances 位姿在此变换之前应用。

默认完整输出含各 asset 的原始 BRep 与世界坐标 STEP。显示预览可用 `include_exact:false` 省略文本序列化，此时原生实体已生成并检查，`exact_pending:true`；`include_exact:true` 取得相同输入、几何键和位姿的精确工件。显示网格仍为原生实体的细分缓存，不能用于权威尺寸、材料量或数值网格。原始形状有效不代表近似已经获工程批准。

## 视口与研究挂载

视口使用同一 OCCT 组件及 `update()` 生命周期，按 object ID 选中电缆或区域，逐 part 复用不变 asset，只更新位姿；介质发生变化时替换相应原生实体。默认电缆实色，土壤 / 回填半透明，地表浅色且不拦截电缆点击；支持轴向剖面。导航及参数更新保留相机和当前对象。

研究挂载读取现有 `StudySection.selection()`，通过 `restoreSelection()` 恢复电缆 / 回填选中状态并刷新研究选中显示，不改变其坐标编辑和计算流程。包络先行只提供当前尺寸的显示，精细工件未到达或失败时明确显示状态，不把包络当成计算结果。

## 数值插件读取边界

数值插件应请求完整 BRep，检查 `input_sha256`、工件摘要、几何键、单位与变换，并自行声明求解域、网格和几何近似的适用范围。不得直接把显示裁剪边界或显示三角形升级为求解域 / 数值网格；导体包络也不能被当成同体积实铜。几何插件不写入输入、不配置物性、不批准数值模型。
