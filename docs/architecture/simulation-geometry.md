# 仿真几何与材料交换接口

本文定义跨插件分析工件的接口提案；跨插件工件传递尚未实现。现行插件协议以 [SPEC](https://github.com/luohui1/CableSimPro-Plugins/blob/main/SPEC.md) 为准。仿真插件内部已实现统一问题与共用分析网格，交由scikit-fem、GetDP或Elmer适配器消费；具体契约与范围唯一维护在[仿真方法§9](../plugins/SIMULATION.md#9-外部求解器适配)。这些内部工件不冒充几何插件已发布的跨插件接口，也不读取显示网格。

## 数据所有权

宿主固定 `cablesim.domain/1`、研究参数及其摘要。仿真插件只读 `materials`、`cable_types`、`circuits`、`sections`、`load_cases` 和 `provenance`；方法特定预处理归插件。几何线程拥有 `cablesim.cable-geometry`，仿真线程不得根据 CAD 颜色、层序号或当前视口猜材料。已有 `cablesim.cad-model/1` 见 [CAD 视口接口](cad-viewport.md)；现有 `cablesim.cad-scene/1` 见 [敷设场景接口](installation-scene.md)。两者不自动具备分析资格。场景的 `transform_mm` 是行优先3×4、轴向+Y；分析适配必须补齐齐次行并显式转换平移单位。`crop_bounds_m` 仍为显示窗口，不是求解远场边界。显示工件有效不等于数值分析资格通过。

## 建议的分析工件内容

下列为待双方确认的 `x-cablesim.analysis-geometry` JSON 内容约定，不是新增宿主顶层协议：

| 字段 | 要求 |
| --- | --- |
| `schema` | `cablesim.analysis-geometry/1`；版本不匹配拒绝 |
| `source` | 固定输入摘要、源运行 ID、几何插件 ID/精确版本/清单摘要、几何参数摘要 |
| `dimension` / `purpose` | 2 或 3；`analysis`；不接受 `display` 替代 |
| `coordinates` | 长度 m，右手坐标，显式 4×4 刚体/单位变换；标明截面和轴向 |
| `regions` | 稳定 `uid`、领域对象路径（电缆实例/芯/层或土壤分区）、材料 ID/版本/来源、几何实体集合 |
| `boundaries` | 稳定 `uid`、相邻 region UID、角色（地表/远场/接触/端面）、法向约定 |
| `interfaces` | 两侧 region UID、共享拓扑或配对关系、接触热阻所需参数；不得把重合面当作已合并 |
| `files` | 受控工件 ID、媒体类型、长度与 SHA-256；不接受任意本机路径/URL |
| `qualification` | 尺寸/单位、闭合、无重叠、共享节点/拓扑、材料映射的逐项结果；失败项保留 |
| `simplifications` | 绞线等效实体、护套均质化、轴向无限长、忽略薄层等逐项声明和依据 |

CAD BRep 的 mm 必须显式转换为 m；显示 GLB、BRep 和分析网格分别记录单位，不能对整个包统一缩放。平台截面 `(x,z)` 中 z 向上，现有 native-reference 的 `(x,y)` 中 y 为埋深，二者转换为 `y=-z`。三维电缆局部 +Z 轴不等于平台截面 z 或重力，必须另给变换。

材料从固定领域文档解析：`thermal_resistivity` 的倒数为 k；`volumetric_heat_capacity` 为 ρcp；电阻率、温度系数、介电和磁性数据按物理方法逐项要求。当前标量物性不足以表达 k(T)、B-H、湿度相关 k/迁移系数时，先在方法参数中显式提供有版本的数据表，不静默改公共领域模型。缺值即预检失败。材料引用名称相同不代表版本相同。

## 资格与失败边界

1. 核对源输入、上游运行、包版本和每个文件摘要；历史几何不得绑到新输入。
2. 在当前几何上重新解析 UID → 实体映射；禁止保存 OCC 面号后跨次重建复用。
3. 验证实体封闭、区域覆盖、接触/重叠、最小厚度；网格另验正 Jacobian、退化单元、孤立节点和界面连通。
4. 验证每个单元材料、边界和热源均唯一绑定；W/m 通过实际截面面积转换为 W/m³，记录积分误差。
5. 失败只返回缺口和诊断；可以保留显示预览，但不能发出已求解温度。

跨插件输入要求几何生产者提供分析资格证据、仿真消费者提供接受/拒绝夹具、宿主绑定固定快照与上游工件。接口接入需统一审查。当前 `dependencies=[]`、Python入口和JSON工件限制保持有效。
