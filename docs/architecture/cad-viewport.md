# CAD 视口组件接口

实现入口为 [cad-viewport.js](../../design/workbench/cad-viewport.js)，样式为 [cad-viewport.css](../../design/workbench/cad-viewport.css)，原生适配器为 [occt-viewer-adapter.js](../../design/workbench/occt-viewer-adapter.js)。型号结构页已经调用此组件。研究工作区的“敷设截面 → 三维”应复用这个入口，不复制相机、选中、测量或剖切代码。

## 挂载与数据边界

`await mountCadViewport(host, model, options)` 返回组件实例；挂载过期时返回 `null`，原生环境或工件错误时拒绝 Promise。host 是有明确高度的 HTMLElement。先加载已有主题变量和组件 CSS。

model 是插件生成的 `cablesim.cad-model/1` 工件，必须含 `brep_unit: "mm"`、`axis: "+Z"`、`length_m`、`outer_diameter_m`、`layers`。每层含原始 `brep_text` 或同源 `display_mesh`，以及 `inner_radius_m`、`outer_radius_m`、`category`、`material`，可带 `construction.wire_diameter`；材料显示读取 `material_sources`。测量基于原始 BRep，显示轮廓是整层内外径包络，不是制造轮廓或尺寸计算来源。仅显示网格的工件带 `exact_pending:true`；调用方提供 loadExact，测量前取得同一输入与 geometry_key 的精确工件。

组件不请求后端、不保存领域参数、不计算用料、不生成或导出 STEP。调用方负责取得插件工件、检查输入身份与修订、显示加载/失败状态、管理选中对象和属性、处理导出。型号页面的自动预览仍由 model.js 管理，运行与审批仍由宿主管理。

当前工件和剥切/剖面以一根同轴、沿 +Z 的电缆为基准，支持最多 32 层。复杂多根敷设、回填或土壤体的几何契约尚未接入；研究页应在真实几何能力可用后启用三维页签。不能用此单根工件替代敷设场景结果。

## options

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| selected | 0 | 选中层的零基索引 |
| mode | peel | peel / section / transparent |
| measurement | part | part / diameter / point |
| section | 0.55 | 轴向剖切位置，限制在长度的 0.05–0.95 |
| initialCamera | 等轴、100% | 可传 yaw、elevation、heading（rad）、zoom（相对适应窗口）、panX、panY |
| isCurrent | 返回 true | 异步挂载的当前性判断，过期工件不进入画布 |
| onSelect(index) | 无 | 点击后的层索引；调用方同步列表和属性 |
| onPick(value) | 无 | 原始几何捕捉结果，空白为 null |
| onChange(state) | 无 | 相机、view（中文名称）、mode、measurement、section；调用方更新状态栏并保存导航偏好 |
| onReady() | 无 | 实体加载和初次绘制完成 |
| loadExact() | 无 | 异步返回当前模型的完整 BRep 工件；组件检查输入摘要和各层 geometry_key；网络请求由调用方实现 |

onPick 的圆/圆柱结果含 diameter_mm；两点捕捉第一次含 measure_pending=true，第二次含 distance_mm，两次均返回源几何坐标 x_mm/y_mm/z_mm。旋转和平移不计入源几何尺寸。顶点或边以原始拓扑吸附；透明度和显示网格不参与测量。剥切/剖面的填色切面是显示裁剪生成的面，不是新增的原始拓扑；量端面圆直径可切换透明模式并捕捉原始圆边。

## 实例方法与生命周期

| 方法 | 行为 |
| --- | --- |
| update(model, options) | 在同一 OCCT 上下文原位替换实体，保留相机、选中层、显示模式、剖切位置；Promise 返回是否完成 |
| updating(text) | 视口角上的阶段/实体装载进度；空字符串清除提示，不覆盖画布 |
| select(index) | 同步外部选中；选中层实色及整层轮廓，其余层约 30% 不透明 |
| selection(kind) | 异步切换 part / diameter / point；必要时加载原始拓扑，再清理旧测量标记；调用方处理 Promise 拒绝 |
| view(name) | peel / section / transparent 或 iso / front / top / end |
| fit()、zoom(factor) | 适应窗口、相对缩放 |
| section(fraction) | 设置轴向剖切比例 |
| project(x,y,z) | 源几何 mm 坐标 → 画布 CSS 像素坐标 |
| info() | 原生层数、selected、hovered、interacting、selection_kind、原始拓扑层数、实际窗口尺寸、活动选择模式、MSAA 设置、细边线层数及最近一次 update_stats |
| profile({durationMs}) | 前台连续转台重绘测量，默认 3000 ms，先预热 300 ms；返回 FPS、帧间隔及画布条件 |
| dispose() | 停止过渡、移除事件和 ResizeObserver、释放显示实体与组件 DOM |

当前 WASM 维护一个 OCCT 上下文，一个页面只能有一个活动组件。参数变化及新工件到达时调用 update()，不销毁 canvas、不重挂载 WASM。仅切换工作区/host 或离开页签时 dispose()；并发挂载会明确失败。离开时也要使 isCurrent() 返回 false，以取消尚未完成的挂载。

update 的 options 为 {envelope:false,isLatest:()=>true,onProgress:(loaded,total)=>{}}。包络工件显式带 envelope:true，层中只有内外径、材料、类别与构造，无需 brep_text；调用 update(envelopes,{envelope:true}) 使用轻量圆柱/环柱显示网格，不描单丝。尺寸不变的已加载内层仍保留精细实体。此阶段禁止原始拓扑测量，用料与 STEP 等待精细工件；不能把包络当成工程结果。精细层的 geometry_key 与原始 brep_text 用于复用不变层；isLatest 过期立即停止后续层替换，旧画面始终留在画布上。

update_stats 分别记录 shape_ms、replace_ms、commit_ms、draw_ms、elapsed_ms 和 envelope；elapsed_ms 包含精细装载时等待的帧回调，不能替代从参数输入到可见画面的延迟。型号调用方另记录 envelope_submit_ms（输入至绘制提交）、envelope_ms（下一帧回调）、request_ms、viewport_ms 和 total_ms。测量前确认实际活动标签页及窗口可见，后台限帧样本不能作为前台 FPS。

```js
import {mountCadViewport} from './cad-viewport.js';

let generation=0,lifetime=0,viewport=null,camera={};
async function showGeometry(host,artifact) {
  const token=++generation;
  if(viewport){
    viewport.updating('精细实体更新中');
    await viewport.update(artifact,{isLatest:()=>token===generation,
      onProgress:(n,total)=>viewport.updating(`精细实体 ${n}/${total}`)});
    if(token===generation)viewport.updating('');
    return;
  }
  const life=lifetime;
  const next=await mountCadViewport(host,artifact,{
    initialCamera:camera,
    isCurrent:()=>life===lifetime&&host.isConnected,
    onSelect:index=>selectStudyObject(artifact.layers[index].entity),
    onPick:result=>showMeasurement(result),
    onChange:state=>{camera=state;showViewportStatus(state);}
  });
  if(token!==generation)next?.dispose();
  else viewport=next;
}
function leaveThreeTab(){
  ++generation;++lifetime;
  viewport?.dispose();
  viewport=null;
}
```

上述 selectStudyObject、showMeasurement、showViewportStatus 由研究页面提供，均只更新界面选择和只读信息。

## 显示与性能含义

- 立方体面为端面 / 侧视 / 俯视，中心角点切等轴；切换 300 ms，可被直接操作打断，减弱动态下下一帧完成。
- 悬停只画中性深灰层包络的端圈与两条外轮廓线；转台旋转/平移时不显示悬停。原生选择仍使用真实实体。
- 原生视口使用 4 倍 MSAA。完整 BRep 的细丝边线按屏幕像素尺寸在近看时开启，采用阈值滞回，远看和旋转时简化；共享网格显示不计算细丝拓扑边线。CAD 曲面与 STEP 不受影响。
- 新显示对象以当前选择模式注册，布局切换只更新已有显示对象的裁剪、透明度和位置，不重新以不可选择模式显示。活动模式需同时有已计算的敏感实体与实际激活状态；仅敏感实体计数不代表可拾取。
- profile 测量的是实际 OCCT 重绘、组件回调与浏览器帧调度合在一起的持续转台帧率，不是静止页面 RAF 频率。返回 duration_ms、frames、frame_ms_median、frame_ms_p95、frame_ms_max、draw_ms_mean 和画布尺寸；结果受设备、刷新率、GPU、电源模式与同机任务影响。GPU draw_ms_mean 是同步调用耗时，不代表独立 GPU 完成时间。
- CableModel.performance() 读取 envelope_ms（参数输入至包络首帧）、debounce_ms、request_ms（HTTP 与插件执行）、viewport_ms（原位替换）、total_ms（精细首帧）、reused_layers/generated_layers；首开含 WASM 初始化，暖更新分别计量。连续输入防抖 200 ms，过期响应不应用；旧模型在计算和错误期间可见。最近六份完整工件支持草稿撤销回放，不冒充新生成测量。
- 宿主仅缓存已通过执行器验收的预览工件，按工作区、插件版本/封签隔离，最多六份。支持 resident_warmup/resident_main 的插件由通用预览执行器驻留运行，按入口内容和封签隔离；单工作进程串行执行私有任务，超时和服务关闭结束进程树。每次输出仍经过 Executor 验收；正式工程运行保留原执行路径。未驻留插件的 reuse_from 只接受已存在的请求摘要，工件经私有 input/reuse-artifacts.json 传递并绑定摘要。客户端参数不能提供可信复用几何。
- 几何插件最多缓存 48 个原生层，按几何版本、角色、内外径、长度与制造参数匹配；材料密度变化重新换算用料，改变层及半径受影响的外层重建。单丝原型检查有效性并积分，旋转阵列保留刚体体积；显示网格共享原型和位置矩阵。浏览器 OCCT 共享三角形缓冲并保留逐实例真实三角形拾取。代理拓扑仅供显示；圆直径/两点测量加载原始拓扑，不读取代理面作为测量实体。
- 自动显示预览发送 include_exact:false，仅省略 BRep 文本和 STEP 序列化；有效原生实体和体积在插件中已生成。导出和精确测量使用 include_exact:true 从同源实体生成完整工件；默认正式输出仍含 BRep/STEP。加载期间有明确提示，输入变更则拒绝过期精确工件。缓存不修改输入或审批。
- 分段计时覆盖服务器请求排队、输入校验、宿主准备/进程/验收、CadQuery 导入、逐层建模/有效性与体积/网格/序列化、STEP 和 JSON 序列化、HTTP 响应体与客户端解码、WASM 解析/网格/显示/拾取及首帧。显示首帧总延迟不包含用户随后请求的精确测量或 STEP 导出；已启用精确测量时参数更新仍加载完整拓扑。

## 用料与演示来源

几何插件工件含每层和全电缆的 mass_kg_per_km。圆绞合和已知连续层按原始实体体积 / 展示长度 × 材料密度 × 1000 计算；它包含理想螺旋引起的实际材料长度增加。紧压与分割导体的 CAD/STEP 是设计 diameter 的外包络，未建单丝压实或分割缝；其材料体积另按 nominal_area × 展示长度 × lay_factor 计算，用料为 nominal_area × density × lay_factor × 1000，不随包络外径虚增。volume_m3 保留原生实体体积，material_volume_m3 为用料体积，两者不能混用，quantity_basis 明示依据。lay_factor 是可空、至少为 1 的明确制造输入，无默认补值，来源沿用领域 provenance；缺少该系数、构造或密度时，相应层和合计为 null，quantity_missing_layers 列出未覆盖层。mass_kg 表示展示段的理论用料，型号属性和参数表使用 kg/km。

演示为 YJV72 8.7/15 kV 1×120 mm²：铜绞合导体、XLPE、铜丝屏蔽与反向铜扎带、非磁性铝丝铠装、PVC 隔离套/外护套。U0/U/Um 为 8700/15000/17500 V，R20 示例值 0.000153 Ω/m。参数旁来源图标记录原文位置，来源的工程复核状态未自动批准。

已读 GB/T 12706.2-2020 原件（Zotero NIDKZ4D2 / CIUHMVQW，PDF 页=印刷页+8）与 IEC 60287-1-1:2023 原件（U7C9U2R3 / 24J5BWEN，国际标准表3在 PDF 页85、印刷页37）：

| 参数 | 演示采用 | 依据与边界 |
| --- | --- | --- |
| XLPE 绝缘 | 4.5 mm | GB 表7，印刷页7；8.7/15 kV、120 mm²。对应 IEC 60502-2 表6 |
| 半导电屏蔽 | 0.6 / 0.7 mm | GB 7.2 / 7.3，页8规定结构；厚度为制造设计值，标准无唯一名义值 |
| 铜丝屏蔽与反向带 | 24×0.8 mm；0.1×8 mm 带 | GB 10.2.2，页10：软铜丝、反向扎带、平均间隙≤4 mm；故障电流与时间未给定，不能判定屏蔽短路容量。扎带不等同于10.2.3的主铜带屏蔽 |
| PVC 隔离套 | 1.2 mm | GB 13.3.3，页11–12；铜与铝之间需隔离。假设屏蔽外径25.5 mm，公式0.02D+0.6修约为1.1，采用1.2 mm下限 |
| 铝丝铠装 | 2.0 mm，47根，300 mm绞距 | GB 表10，页12：假设铠装前直径27.9 mm，25–35 mm档采用2.0 mm；材料符合13.2。根数/绞距为制造设计输入，理想螺旋无接触形变 |
| PVC 外护套 | 2.1 mm | GB 14.3与附录A，页14、39–42：假设铠装外径31.9 mm，0.035D+1.0修约至2.1 mm |
| XLPE εr / tanδ | 2.5 / 0.004 | IEC 60287-1-1:2023 表3，无填充XLPE、≤18/30 kV |

假设直径按附录A用于选择护层公称尺寸，与 CAD 实际外径分开；密度、单丝绞距等仍是示例。保存、原文核对或几何有效不代表产品已通过标准试验/审核。
