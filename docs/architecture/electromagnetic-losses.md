# 护套与铠装损耗工件接口

`cablesim.simulation/getdp-eddy` 在显式提供 `parameters.loss_export` 时输出 `x-cablesim.loss-coefficients`，JSON `schema=cablesim.loss-coefficients/1`。与[接地拓扑契约](electrical-topology.md)使用同一类型、领域摘要和引用格式。损耗来自 GetDP 实际涡流结果；工件供研究线程保存为 IEC 外部系数的来源，**不自动改写或执行 IEC 研究**。当前 IEC 群组热路的外部系数入口仍拒绝非零 λ₂，输出 λ₂ 不意味着该接收路径已经支持铠装热路。

## 导出输入与拓扑绑定

`loss_export` 必填字段：

| 字段 | 约定 |
| --- | --- |
| `bindings[]` | 稳定 entity；显式 `conductor_regions`、`sheath_regions`、`armor_regions`。后两项无该构件时填空数组；不能根据名字/图层猜。区域不可重复分配，共享铠装绑定整组，不能重复算到每相 |
| `source_domain_sha256` | 被分析的固定领域输入摘要，采用宿主排序紧凑UTF-8 JSON；领域输入导出时核验实际摘要。显式问题须由调用方提供其关联领域摘要及映射依据，不自动把仿真问题摘要当领域摘要 |
| `topology` | 必含 `constraints`，逐项等于本次统一问题激励的 regions/kind/connection/value；复数RMS二元数组不能省略相角。领域输入另要求 `circuits={回路ID:{electrical_topology,bonding}}` 逐项等于完整领域快照，保留来源 |
| `material_temperatures_k` | 每个绑定导电区域的工作温度K，必须完整；实际sigma及材料来源另存同次 bundle.problem |
| `source` | 该映射、温度和拓扑的依据 |
| `temperature_table` | 可选变温张量：每轴 `entity/state/regions/values_c`，state 为 conductor_temperature_c 或 sheath_temperature_c；每个导电域完整绑定 `resistivity_laws`（参考温度K、alpha、有效温度K、来源），以及共同电流倍率 `current_scale_range` 和独立校验绝对误差限 `maximum_validation_absolute_error` |

`topology_sha256` 按完整拓扑快照计算。拓扑事实由[接地拓扑契约](electrical-topology.md)唯一维护。当前领域适配只接受未换位的单点/两端接地；两端互联组与单区域零净电流是不同约束，不能仅凭 `bonding.kind` 名称互换。有限接地阻抗、跨段换位、跨回路接地网未经翻译必须拒绝。领域已保存的相序、参考角必须与实际复数激励一致，不能将不一致的显式相角包装成同一领域工况。

## 结果量与适用范围

| 字段 | 定义 / 单位 |
| --- | --- |
| `source` / `producer` | 来源说明；producer复用[温度场source契约](temperature-field.md)，保存运行/工况、精确插件版本/能力、单工况输入与清单摘要、同次 bundle 原始字节SHA256 |
| `domain_input_sha256` / `coefficients` / `unit` | 领域快照摘要；按entity索引的lambda1/lambda2/ac_extra_factor；单位固定为1 |
| `rows[].conductor_loss_w_m` | 绑定导体的周期平均焦耳损耗之和，W/m |
| `sheath_loss_w_m` / `armor_loss_w_m` | 对应区域焦耳与复磁导率损耗之和，W/m |
| `lambda1` / `lambda2` | 上述护套/铠装总损耗分别除以导体总焦耳损耗，无量纲；λ₁包含环流和局部涡流，不标成纯环流 |
| `ac_resistance_factor` | 导体总焦耳损耗 / Σ(Irms²·Rdc)，即有效Rac/Rdc |
| `ac_extra_factor` | 上项减1；不能据此拆成独立ys与yp |
| `ac_resistance_ohm_m` / `dc_resistance_ohm_m` | 单导体绑定时返回；多导体组为null，不猜串/并联等效电阻 |
| `frequency_hz`、`material_temperatures_k` | 固定运行点；与拓扑、几何、材料电导率共同限制复用 |
| `validity` | 未给温度表时为 fixed_operating_point、ampacity_iteration_allowed=false；完整采样和独立检查通过后为 temperature_tensor、ampacity_iteration_allowed=true |

原始周期平均损耗不再次除以2。零导体电流/损耗时无法定义比值，导出拒绝；不返回零λ或无穷大。共享铠装若绑定整组，接收方不能无依据地均分到单芯电缆。

## 研究与 IEC 接收

宿主对工件原始文件计算 `artifact_digests['x-cablesim.loss-coefficients']`。研究参数使用接地拓扑契约的 `external_loss_reference={run_id,case_id,artifact_type,artifact_sha256}`；宿主解析封存正文并追加resolved_source，客户端不能替换正文。不能只保存几项数字。

固定点仍只能作为证据，IEC拒绝用它迭代。变温工件的 `temperature_table.rows` 保存完整张量节点、逐对象 λ₁/λ₂/ac_extra_factor、材料问题摘要、实际GetDP执行和日志；`validation_points` 为每个张量单元中心的独立GetDP解。消费方使用多线性插值，每次热平衡迭代按**各对象自己的导体及护套温度**取值，不用平均温度代替六个独立材料状态。Rac/Rdc=1+ac_extra_factor。

`error.maximum_absolute_by_entity` 和 maximum_absolute 是上述校验点上实测的无量纲绝对插值误差，**不是整个温度区间的数学误差上界**，也不包含网格误差。超出预先给出的 acceptance_absolute 时不生成可消费工件。轴最多8个、节点总数最多2048；范围较宽时应增加节点并另做网格收敛核验。

电流倍率只适用于固定频率、线性σ/μ、固定相角和所有电缆共同缩放的电流向量；温度通过显式ρ(T)更新，材料μ保持输入值。仅支持电流激励及零电压互联、零磁矢势边界；非零独立电压源拒绝。`reference_current_a`、current_scale_range固定这一前提，改变回路间电流比例须重算，不可在各回路独立反求时复用一张共同倍率表。零电流只作为线性尺度极限，不重新定义0/0损耗比。

`dc_reference` 保存每根导体的R20和alpha20，IEC须与自身输入一致（R20容许0.5%多边形面积离散差，alpha20绝对差≤1e−8/K）。每对象一个明确实心导体区域；不把绞线电阻自动替换为等面积实心电阻。频率、领域摘要、拓扑、对象绑定由既有契约继续校验。λ₂非零仍拒绝进入当前无铠装IEC热路。

实心圆导体仅在上述外部变温表路径进入IEC群组热模型；常规自动电损耗入口的结构范围不因此放宽。消费方重新从保存的中心点和角点计算实测插值误差，拒绝伪造的误差摘要；宿主验证工件原始字节摘要，插件的SHA格式校验不替代宿主真实性校验。

实际六轴回归：三根导体分别取20/46.6667/73.3333/100°C，三根护套分别取20/60/100°C，共1728个GetDP节点和216个独立中心点，固定400A RMS电流向量、共同倍率范围0–4。最大实测绝对误差0.001958761，小于预先设定0.003；IEC在同一领域快照求得594.790870A。较粗729节点表因0.00576962超差被拒绝，未通过放宽容差接受。该合成例只校验接口与迭代，不计为论文复现；其原始生产运行、网格及清单摘要保存在`.data/simulation/loss-temperature/`。

温度或电流越界时不外推。允许电流搜索可以缩小越界试探区间，但最终必须在有效表内达到温限残差要求；尚未达到温限就碰到表边界时返回 LOSS_COEFFICIENT_VALIDITY_EXCEEDED，不能把表边界报告成允许电流。最终trace携带 resolved_source 和 external_loss_interpolation_error。

工件损坏、未知版本、范围不匹配或绑定缺失时保留原保存研究并显示具体字段错误。AI和插件不批准这些系数。测试覆盖公式归一化、磁损计入、拓扑不匹配、重复区域、零电流和实际GetDP宿主工件摘要。

## 接口变更记录（研究线程）

- 2026-10-03：schema `/1` 增加可选 `temperature_table`，原固定点语义不变。研究引用仍用 external_loss_reference，由宿主封存并转交；无需客户端展开或重算表。IEC已接入逐迭代多线性插值、材料/电流比例校验、越界拒绝及误差追溯。研究页面展示时须标“中心点实测插值误差”，不可写“全域误差保证”。本记录为给研究线程的接口通知。
