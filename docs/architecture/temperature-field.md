# 温度场结果工件接口

研究页消费 `x-cablesim.temperature-field`，JSON `schema_version=cablesim.temperature-field/1`。生产者为 `cablesim.simulation` 的 `multiregion-thermal`、`elmer-heat`、`electrothermal`、`contact-thermal-field`、`contact-electrothermal-field`；页面由研究线程整合，插件不依赖页面。类型校验在 `cablesim_sdk/simulation_artifacts.py`，生产实现位于插件 `artifacts.py`。这不是 CAD 显示网格，也不改变宿主运行协议。

## 字段与坐标

| 字段 | 约定 |
| --- | --- |
| `source` | 原运行/工况、插件精确版本、能力、输入 SHA256、清单 SHA256、同次 simulation-bundle **原始 UTF-8 文件字节** SHA256 |
| `mesh` | `points=[[x,z],…]`，m，z向上；`triangles` 为零起始三个节点索引；`domain_ids` 每单元一个，关联 `regions[].id/uid`；无删点/缩放 |
| `mesh.sha256` | 由 points/triangles/domain_ids/regions 四字段共同计算的排序 JSON 摘要，算法为 `cablesim_sdk.reproduction.digest` |
| `mesh.representation` | 实际输出表示；曲边高阶求解器的顶点显示网格不能标成完整高阶求解网格 |
| `temperature_k` | 与 points 一一对应的正绝对温度；`association=node`、`temperature_unit=K` |
| `time_s` | 此场的时间；稳态为0，瞬态为最后一步。不是完整时空帧序列 |
| `samples[]` | entity、point_m、temperature_k、time_s、method；线性插值与原生高阶采样必须区分；Elmer包含全部已请求的时间点采样 |
| `hotspot` | 输出节点场的真实最大温度及位置；它是“节点最热点”，不承诺连续场极值。界面可显示°C但保留原始K |
| `convergence` | 求解状态、可获得的迭代/守恒/时间信息；单次网格默认 `mesh_status=not_assessed_single_mesh`，不得显示“网格已收敛” |
| `engineering_approval` | 恒为 false；显示和数值验证不批准工程方案 |

等温线由页面在明确的线性三角形表示上生成；输入工件不需要同时储存一份重复的等温线。不要把导体中心采样、导体均温和节点最热点混成同一个温度量。`contact-thermal-field`已支持接触热阻双节点温跃：必须保留重合坐标的不同节点及各自三角形连接，不能按坐标合并或跨界平均。工件的representation明确标为两侧独立温度迹；仍沿用本文件的网格/域收敛门禁，不把接触模型的单次求解标成已收敛。

`contact-electrothermal-field`复用相同双迹工件，新增GetDP损耗与温变接触热场闭环。输入三角形先统一为逆时针节点顺序，使温度、场梯度和热源积分使用相同的局部节点映射；不改变全局节点及材料域编号。均质绕组Rac(T)是有来源的平均端口电阻（包含被动损耗），不补未知IEC系数。历史`temperature_input_sha256`对应最后磁迭代输入；返回的是与该输入在声明容差内一致的热试探场，两者不是机器精度相同的数组。原生06对照见[仿真方法§12](../plugins/SIMULATION.md#122-完整截面与双向电热)。新增生产者不改变下方研究页交付门禁。

## 接收与失败

先验证宿主 `artifact_digests['x-cablesim.temperature-field']`，再校验版本、source与保存运行的关系、节点数、索引、区域映射和正有限温度。`source.input_sha256` 对应原始单工况input，使用 `cablesim_sdk.reproduction.digest`；它不是宿主整个运行快照的input_digest，也不是损耗契约的紧凑JSON领域摘要。`source.bundle_sha256` 绑定同次运行原始工件字节，禁止 JSON 重排后重算并冒称原摘要。工件自身摘要由宿主保存，避免自引用。

空/等待/失败来自运行状态，不构造全零温度场；失败运行不产生成功温度工件。历史场只读，不贴到新工程输入上；明确打开历史快照时，可与输入、负荷、边界、热源一致且完整性已核验的保存IEC运行作信息比较，历史状态和交付限制保持不变。未知版本、缺失或损坏工件显示不可用，不用当前运行补齐旧结果。网格未做收敛扫描不妨碍显示，但必须保留未核验状态。

## 收敛与交付门禁

研究配置`verification`固定至少三档由粗到细的网格工况与同最细网格下的加倍域工况ID。除网格/节点资源上限和域边界外，输入、负荷、热源和边界条件必须相同；加倍域保持水平中心及地表位置，宽度和深度各加倍。最细相邻网格与加倍域的全场节点最热点变化均须严格小于0.1 K。工件不可用、缺项、不同物理模型或未达阈值时标“未收敛”，宿主交付API拒绝纳入计算书；已收敛报告携带完整收敛表。单次工件的mesh_status不被覆写或补造。自动扫描当前覆盖领域温度场；独立多区域模型须保存明示扫描，未覆盖时不能补证据。

默认场图包含地表，等温线连接P1线性网格交点后只在5px内圆滑显示；节点场、极值、取样和色场插值保持不变。IEC/FEM只比较同输入、负荷、边界与热源口径的当前结果。差异超过max(2 K,3%×IEC相对环境温升)时标“需要解释”，列出集总与峰值、有限域、边界、排管空气等效等可能原因，信息差异不作为通过判据。

关联 [仿真几何与坐标契约](simulation-geometry.md) 和 [电磁损耗工件](electromagnetic-losses.md)。接地改变会改变上游电热输入摘要；热场本身不重新解释接地拓扑。
