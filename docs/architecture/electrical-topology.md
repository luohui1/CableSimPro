# 接地拓扑与外部电损耗接口

现行领域文档仍为 `cablesim.domain/1`。拓扑是输入事实；λ₁、λ₂是方法结果。宿主只校验、固定和转交工件，不计算电损耗，也不批准工程结果。

## 领域字段

`circuits[].electrical_topology` 包含必填 `phase_sequence: ABC | ACB`、`reference_angle_rad`（−π至π，rad，A/L1 相角，所有回路共用同一时间参考）、`source`（既有 Source，reference 必填）。B/C 或 L2/L3 的相角由相序定义：ABC 为 A−2π/3、A+2π/3；ACB 相反。回路之间的相对相角取两个保存参考相角之差，不用回路名称推断。

`circuits[].bonding` 复用既有 `kind`：single_point、both_ends、cross_bonded；增加 `source`。交叉互联必须保存三个正 `minor_section_lengths`（m）和三个 `section_permutations`（每项是0/1/2的位置排列）；每列代表一条连续护套支路，每条支路必须依次经过三个位置。`transposed` 指导体沿线路换位，不能与护套交叉互联混同。拓扑来源不为空；reviewed 不自动改为 true。

旧文档缺 electrical_topology 仍可读取。显式新拓扑一旦提供，子字段不得缺失。IEC 单回路旧输入沿用既有 ABC 假设并在追溯中明示；双回自动损耗必须给出两回完整拓扑，不能猜相角。重新保存接地方案时界面要求明确来源。交叉互联只支持一个大段、恒定截面；段间几何/材料变化和非理想接地阻抗不在现行IEC分支内。

## IEC 边界

- 1-1:2023 §5.3.2–5.3.4：品字形/平排单回路两端接地环流；按保存相序区分平排领先/滞后。
- §5.3.7.1、§5.3.7.2 式(11)：单点/交叉互联涡流及已知不等小段的残余环流。恒定截面下，以最短段为a，其余为pa、qa，环流乘 `(1+p²+q²−p−pq−q)/(1+p+q)²`。只有电气相同的等小段才可置零。
- 1-2:2023 §4–7、表1–11：同一水平线上两组三相等间距平排，单点接地或无显著残余环流的交叉互联；同型号、频率和三相平衡负荷；相位识别及相对相角符合§6.1。CH双线性、CN线性、CJ三线性插值，仅在来源表范围内，禁止外推。当前只提供 `operation=temperature` 的等负荷温度计算；逐回改变电流求独立载流量会破坏等负荷前提，明确拒绝。两端接地双回、任意独立多回、不等相角及尚未验证的双回导体换位明确拒算。
- 不支持的电磁输入提示：用数值仿真插件（GetDP涡流）计算护套损耗后，作为外部系数带入。具体GetDP拓扑范围仍以仿真插件预检为准，不承诺它支持任意接地网络。

1-2 的新分支不能沿用 TB 880 单回路验证声明。受控表工作副本须从方法参数导入，版本、表号、页码和来源摘要随输入保存。§8.2、§8.3 的详算 cable 1 与独立插值/位置对称测试通过；六缆打印汇总按预先声明容差共9/12通过。§8.2位置2/5的差可由例题中间舍入复现；§8.3位置2打印1.151，而按表精算1.146115，根因仍未确认。保留原值和原容差，不将该项标成通过；工程验收须单独审阅该印刷参考冲突。

## 损耗工件

工件类型为 `x-cablesim.loss-coefficients`，schema为 `cablesim.loss-coefficients/1`。生产字段、绑定和归一化定义唯一维护在[电磁损耗工件](electromagnetic-losses.md)。固定点仍声明 fixed_operating_point、ampacity_iteration_allowed=false；GetDP可显式生成 temperature_tensor 工件，由IEC按各导体/护套迭代温度插值。不能以填写一个来源说明代替有效范围核验。

范围工件须覆盖全部电缆，系数为非负有限数值。温度轴、共同电流倍率、R20/alpha20匹配、独立校验误差和禁止外推的规则统一见[电磁损耗工件](electromagnetic-losses.md#研究与-iec-接收)，不另维护一套区间字段。领域N单芯分支仍拒绝非零λ₂。独立 `armoured-sl-rating` 已实现三芯圆导体钢丝铠装SL热路：§5.4.1铠装温度迭代、§5.4.3.3.1损耗和§5.4.3.5屏蔽修正，以TB880 Case2 PDF172–179校验λ₂、允许电流与铠装功率；输入Rc/Rs/λ₁/T₁–T₄必须来自同一温限工作点，不能将它扩展为任意多芯领域映射。非磁性按§5.4.2实现并联电阻和均方根直径替代量；完整非磁性热路、单芯磁性、钢带、两芯仍未验证并拒算。

消费方在研究参数中只保存 `external_loss_reference={run_id,case_id,artifact_type,artifact_sha256}`。SHA256为宿主CaseResult.artifact_digests保存的原始工件文件摘要；宿主另校验整个运行快照与输出封存摘要。只接受同工程的成功、完整运行；校验类型、工况、原SHA和领域摘要后，将正文复制到固定请求的 `external_loss_artifact`，追加 resolved_source（准确方法版本、运行、输入/输出摘要）。禁止客户端直接替换正文。

工件缺失、被篡改、摘要不同、对象缺项、超出有效区间都给字段级拒绝。保存引用不改变来源运行或工程参数，不把未批准结果改成已批准。

`domain_input_sha256` 必须使用 `backend.workbench.fingerprint` 对实际保存的领域对象计算（UTF-8、ensure_ascii=false、sort_keys=true、紧凑逗号/冒号分隔）。它不是整个仿真输入的 SHA，也不是 study run 的 input_digest；生产线程须把这个领域摘要绑定到所用模型。正文文件摘要则沿用工作器保存的原始字节摘要，不能用重新序列化的 JSON 摘要代替。

## 研究模块执行

研究的 `modules` 是最多五个已保存 StudyConfiguration，复用同一领域文档、保存修订和运行记录。温度场使用 `modules["thermal-field"]`；可比IEC使用 `modules["iec-thermal-reference"]`。GET preflight 查询参数 `module` 与POST runs的 `module` 只选择已保存配置，不携带替代输入。快照固定模块标识、主研究定义、实际方法及输入；幂等请求、插件锁和时效校验覆盖所选模块。模块运行不能替代载流量模块的结果。

温度场按[温度场工件契约](temperature-field.md)消费独立 x-cablesim.temperature-field；宿主核验版本、节点/连接/区域、网格摘要、来源输入与同次bundle原始摘要，未知或不匹配时不显示场图。simulation-bundle仅补充逐缆统计和诊断。等温线为明确线性三角形表示的可视化，不是新物理求解。IEC与FEM只比较同一领域输入、负荷和损耗口径的当前运行；峰值、均值与IEC集总统计分列，不设默认通过门槛。新增或修改其他模块不会让未改变输入、方法和配置的模块结果失效。
收敛配置、0.1 K交付门禁、等温线显示平滑及IEC/FEM差异提示唯一规则见[温度场工件契约](temperature-field.md#收敛与交付门禁)。
