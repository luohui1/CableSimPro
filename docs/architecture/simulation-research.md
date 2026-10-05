# 仿真研究接口

三项能力由 `cablesim.simulation` 提供，输入均为保存的 `cablesim.domain/1` SI 文档。宿主保存输入、发行锁、运行状态、工件及摘要，并按管理员配置提交 Slurm；不实现热、电磁或电热算法。共享数据模型放在根目录 `cablesim_sdk/`，插件源码不导入 `backend`。宿主和插件封签记录共享 SDK 的依赖摘要。

## 独立问题复现导入

`GET /api/simulation/problem-contract` 发布 `cablesim_sdk/simulation.py::Problem` 的准确JSON Schema，附 `schema_version/source/source_sha256/schema_sha256/units`，不维护宿主平行物理模型。`GET /api/input-contracts` 中 `getdp-eddy/elmer-heat` 的 `schema/standalone_schema` 采用该模型；研究模块的领域输入契约保持原状。独立导入使用 `input_source=study`、完整 `method_input`、相应发行锁及 `parameters.mesh`；`parameters` 模型为 `StandaloneParameters`，可带 reproduction 和显式 loss_export。保存和历史预检都验证原问题，非法字段/数值返回422 `SIMULATION_PROBLEM_INVALID` 并附 `/method_input/...` 路径；电磁/热能力不匹配返回 `SIMULATION_PHYSICS_MISMATCH`。输入正文及其原有来源原样进入冻结快照和输入摘要，验证不调用求解器、不自动补物性。

顶层准确字段：`schema_version, physics, geometry, boundaries, excitations, frequency_hz, time, probes_m, current_probes, temperature_regions, axial_lengths_m, electrical_networks, provenance, assumptions`。拒绝额外字段和非有限数。physics 为 steady_heat / transient_heat / magnetic_harmonic；热问题不能带频率，磁场必须有正Hz频率，只有暂态可带time。geometry为1–256个rectangle/disk，values分别为 `[x0,z0,x1,z1]` / `[x,z,r]`，单位m；材料显式给导热率W/(m·K)、暂态体积热容J/(m³·K)，或电导率S/m和无量纲磁导率。boundaries的坐标为m，温度为K、换热系数W/(m²·K)、磁矢势Wb/m；热源W/m、电流RMS A、电压梯度V/m，复数用实/虚部分量。schedule为 `[时间s,无量纲倍率]`，time含初温K、步长s、步数和BDF阶数。探针为m，轴向长度为m，网络节点为无单位正整数；区域、激励、网络和测点引用由SDK校验。磁场导电区必须显式指定电流/电压或互联约束，不能猜零电流。稳态热不能全绝热。完整嵌套字段及上下限以发布Schema及同源校验器为准，验证入口 `tests/test_host_api.py::test_exact_simulation_problem_contract_and_import_validation`。

## 能力与工件

| capability | 分析 | 必需工件 | 用户可读结果 |
| --- | --- | --- | --- |
| `transient-temperature` | `transient` | `x-cablesim.simulation-bundle`、`x-cablesim.temperature-field`、`x-cablesim.temperature-history` | 每根导体的温度曲线、峰值及出现时刻、到温限时间和时间步括区 |
| `sheath-losses` | `frequency_domain` | `x-cablesim.simulation-bundle`、`x-cablesim.sheath-losses`、`x-cablesim.loss-coefficients` | 各区域护套电流相量、每米损耗、每根电缆 λ1/λ2、原生电流约束误差 |
| `electrothermal-steady` | `steady_state` | `x-cablesim.simulation-bundle`、`x-cablesim.temperature-field` | 收敛温度场、温度/功率更新量、迭代历史、能量及场间传递残差 |

查询 `GET /api/methods`，选择返回的完整 `method` 发行锁，再从同一条目的 `capabilities` 选择 capability ID 填入 method.capability；保留 `version` 和 `release_digest`，能力的 `method_version` 由该发行声明。不得自行拼装发行摘要。所有自定义温度使用 K，长度 m，时间 s，电流为 RMS A，导热率 W/(m·K)，体积热容量 J/(m³·K)。示例输入在 `tests/simulation_fixtures.py`，明确为合成验证数据，不是产品默认值。

## 暂态输入

`parameters` 必须包含 `domain_options`、`time`、`mesh`、`resistance_temperature_k`、`duct_air_capacity`。`domain_options` 选择已保存的 `section_id` 和 `load_id`，沿用领域热截面的边界、逐根电缆热源和管道等效参数。

负荷来自 `load_cases`：`time_series`、`cyclic` 或 `emergency` 的逐回路 `profile`。仅接受显式阶跃插值，时间轴从 0 开始且落在固定时间步上；时长覆盖负荷曲线，周期末值等于首值。应急使用已保存的 emergency 温限；缺失就拒绝。预负荷稳态初场尚未覆盖，不把任意均匀初温伪装成预负荷解。

`time` 为 `{initial_temperature_k, step_s, steps, bdf_order}`；`mesh` 为共用网格控制，Elmer 热场只接受 P1。所有材料须保存正导热率和体积热容量。每根导体的电阻参考温度由 `resistance_temperature_k` 明确给出；当前暂态是固定物性热扩散，热源按保存的 I(t)²R 变化，未覆盖逐步 R(T) 电热反馈。额外护套因子、介质或层热源必须有显式来源，不用默认猜值。

`cablesim.temperature-history/1` 的 `curves` 逐根绑定电缆 UID，包含相同长度的 `time_s`、`maximum_temperature_k`、`mean_temperature_k`，及 `peak_temperature_k`、`peak_time_s`。`limit_status` 为 `reached`、`initially_exceeded` 或 `not_reached`；`limit_crossing` 只在实际时间步括区内插值，显示 `bracket_s`，不外推到运行时长以外。原生 SaveScalars 每步记录导体区域统计，完整场帧另按不超过约 100 帧采样，不能用最后一帧冒充完整曲线。

## 护套接地与 IEC 外部损耗

`parameters` 为 `{electromagnetic_options, mesh}`，可显式加 `temperature_table`。`electromagnetic_options` 的字段为 `section_id`、`load_id`、`bounds_m`、`background`、`material_states`、`probes_m`、`source`。每种材料的 `material_states` 保存温度、是否非导电和来源。相角只从已保存的 `circuits[].electrical_topology` 的相序与参考角取得；接地只从 `bonding` 取得，不读取标签猜测。

支持完整三相单芯圆形实体，单点、两端、三个小段交叉互联。必须有 `bonding.source`。交叉互联须保存三段 `minor_section_lengths` 与每段 `section_permutations`，总长等于当前截面 length；各回路共同分段。原生 GetDP 网络使用各段实际电压降、节点 KCL 和回路约束。损耗按实际段长加权，保留各段区域积分。导体空间换位、大地回流、多芯或绞线等效、电磁分段三维端部效应，以及不同回路不同分段暂未覆盖。分层土壤、沟槽等须通过已验证的电磁几何入口；接口拒绝未翻译结构，不静默丢弃。

`cablesim.loss-coefficients/1` 绑定领域输入摘要、producer 插件/版本、原始 bundle 摘要、拓扑、材料温度和原始区域积分。λ1 是护套总损耗/导体损耗，包含原生场中的局部涡流；环流电流另列，不能把 λ1 解释成只有环流损耗。温度表由每个声明温度网格点的实际原生求解生成；三段交叉互联温度表当前拒绝。

IEC 研究参数引用保存运行，而不上传系数正文：

```json
{"external_loss_reference":{"run_id":"运行 UUID","case_id":"case-0","artifact_type":"x-cablesim.loss-coefficients","artifact_sha256":"工件 SHA256"}}
```

宿主解析同工程工件后传给 IEC 插件，验证来源运行、工件摘要和领域输入完全相同。固定温度点不能跨温度外推；需要温度反馈的 IEC 能力使用符合其契约的温度表。IEC 的公式与条款由 IEC 插件负责，本仿真工件不声称是 IEC 标准公式结果。

## 双向电热稳态

`parameters` 包含 `electromagnetic_options`、`mesh`、`thermal_boundaries`、`material_validity`、`initial_temperature_k`；迭代控制为 `maximum_iterations`、`temperature_tolerance_k`、`power_relative_tolerance`、`relaxation`。每个导电材料须保存 `electrical_resistivity_20`、`temperature_coefficient_20`、热阻率及有来源的有效温度区间，边界温度必须绑定已保存环境温度。

GetDP 按当前温度更新逐点电导率与焦耳损耗，热场按该损耗更新温度，迭代至温度和功率门槛同时满足。越出材料有效区间、迭代不收敛、能量或功率传递残差超限均失败，不发布近似温度场。当前为单截面三相单芯稳态；三段交叉互联的分段温度反馈、额外介质热源及三维端部模型未覆盖。

## 研究页面如何调用

正式任务清单为 `GET /api/study-tasks`，模块 ID / task 均为 `transient-temperature`、`sheath-losses`、`electrothermal-steady`。清单绑定已安装完整 Method、分析类型、Slurm 执行策略及必需工件；参数表单模式由 `GET /api/input-contracts` 发布，旧 `/api/design/input-contracts` 兼容保留。一个 Study 可在 `modules` 中保存三项独立的 `StudyConfiguration`；主配置保留，模块运行用 module 字段选择。任务与 capability/analysis 不符返回 `TASK_CAPABILITY_MISMATCH`，这些任务使用选型驱动返回 `TASK_DRIVER_NOT_SUPPORTED`。

三种参数模型 `TransientParameters` / `SheathLossParameters` / `CoupledParameters` 纳入 OpenAPI。截面/负荷引用、边界、每缆热源、材料温度与来源均有嵌套模型和单位；保存时拒绝字符串冒充数值及布尔字段错误，错误消息保留 parameters 字段路径。`parameter_source` 与 SHA256 标明宿主类型模型；插件 `source` 与 SHA256 单独保留。宿主只验证形状/单位，物理适用性、领域事实一致性与所有求解仍由插件预检和执行决定；不填充缺省物性或改变保存参数。

声明上述 task 的运行请求返回 HTTP 202 和 `Location` / `Retry-After: 2`；输入和 request_id 先写入数据库，随后在宿主后台提交冻结的超算作业。GET Location 轮询 accepted/running/succeeded/failed/interrupted。未声明三种 task 的旧研究维持同步响应。相同 request_id 返回同一 Run；失联/宿主重启保留快照，使用既有 resume 回收原作业，不重新提交。

计算书渲染器 `/13` 提供 `data-section="transient-temperature"`（峰值、时刻、温限状态和时间步括区）、`sheath-losses`（每米损耗、λ、工件/原始场/输入摘要）、`electrothermal-steady`（逐轮温度与功率更新、能量及传递残差）、`temperature-convergence`（逐档网格/节点/峰值/差值）。暂态时间步误差须独立验证，网格门禁不声称已验证时间离散。

暂态、电热耦合的 single 任务在准入时自动冻结 `cablesim.refinement/1`：网格尺寸 2h、h、h/2（远场同步缩放，圆周分段随细化增加），同一域/材料/负荷/时间步；有限外部域另加水平居中、上边界不动的宽深加倍工况，使用最细网格。一次 sbatch 提交作业数组，每个网格 case 独立运行并校验 request/plan/runtime/result SHA256，合并后保留逐档环境和成本；同一 Run 恢复回收该原数组，不重复提交。暂态按完整历史曲线峰值比较，电热按稳态热点比较。最近两次相邻网格变化及加倍域变化均严格 <0.1 K 才能进客户计算书，避免只看最后一次小差而忽略前一档大跳变；报告主结果使用 `reference_case_id` 的最细基准域工件，其他档作诊断证据。未收敛、失败档或不完整工件一律拦截，逐档状态保留。

单根空气截面的外边界可为模型实际电缆表面（bounds_m=null），属于明确物理边界，做三档网格而不把物体尺寸加倍；有限土壤/外部域不能使用此例外。旧显式 sweep verification 仍要求三档及加倍域。保存的研究参数不被改写，细化配置只进入冻结运行快照 `automatic_convergence`；原网格值的单位为 m。

损耗引用由宿主同时验证 `artifact_status=verified`、源 Run 完整性、同工程/工况归属、领域输入摘要、原始场绑定及 artifact_sha256；不能直接提交 external_loss_artifact 正文。IEC 工件和计算书 `external-loss-source` 区块保留源 Run、输入/输出摘要与原始系数工件 SHA256。固定点工件仍拒绝 IEC 变温迭代；须用已验证温度张量且禁止外推。验证入口：`plugin-tests/test_simulation_study_workflow.py`、`plugin-tests/test_research_simulation.py::test_research_sheath_temperature_artifact_is_consumed_by_iec_saved_reference`。

1. 保存领域截面、材料、接地拓扑与负荷，调用 `POST /api/workspaces/{wid}/studies`，使用 `input_source: "domain"`、选定的完整 method、上述 parameters 和 `driver: {"kind":"single"}`。接口支持研究模块；调用模块时沿用研究契约的 module 字段。保存研究本身不启动求解。
2. `GET .../studies/{sid}/preflight?expected_revision=...&expected_study_revision=...`。核对 `ready`、逐字段错误、适用限制与 `lock_digest`。缺项提示明确字段及 SI 单位；工程师改正保存后重新预检。
3. `POST .../studies/{sid}/runs`，传 `request_id`、两项 expected revision、`lock_digest` 和 `scope_acknowledged: true`。一次点击生成一个 request_id，重试 HTTP 请求复用它。不同输入复用该标识返回 409。相同运行复用相同 Slurm 提交标识，不重复计算。
4. 从 `GET .../runs/{rid}` 和 `GET .../runs` 读取当前及历史状态。温度图只消费 `artifact_status` 为 verified 的工件；将 `not_reached` 显示为“本时长内未到达温限”，将失败与环境缺失显示为错误状态，不画替代曲线。空、加载、错误、成功、历史状态的页面由研究线程实现。
5. 网络中断保存原输入、运行与 Slurm 标识。单工况或自动收敛数组且没有交叉对照时，调用 `POST .../runs/{rid}/resume` 回收原冻结作业；恢复不创建新求解。其他扫描/批量使用既有数据集恢复入口。已完成运行恢复直接返回历史结果。当前跨多个方法中途断网的单一 resume 尚未覆盖。

管理员 `.data/hpc/config.json` 的 `remote_plugins` 控制宿主路由，当前仿真与 COMSOL 在名单中；插件还拒绝非 Slurm 求解环境。研究执行将源码、SDK、发行和输入冻结到 `.data/hpc/research-runs/`，传输及结果均校验摘要。运行 environment 的 `remote_execution` 保存 plan/runtime/result SHA256、job_id、节点记账及实际 CPU 秒。超时和崩溃清理计算进程树；失败工件不混入成功结果，历史研究保持可读。

## IEC 与有限元对比

新增 `task=iec-fem-comparison`，通过同名仿真插件能力调用，保持既有研究保存、预检、运行、恢复和计算书端点。前端从任务清单选择完整发行锁，从 `/api/input-contracts` 获取 `cablesim_sdk/iec_fem.py` 的参数契约。`section_id`、`load_id` 选择保存工况；`controls.rated_circuit` 指定反求回路，其余回路保持保存负荷。支持范围、冻结系数确认和偏差定义见 [仿真插件说明](../plugins/SIMULATION.md)。

`x-cablesim.iec-fem-comparison` 的 `conclusion` 可直接显示；`iec`、`fem` 分别有 `status/ampacity_a/operating_temperature_k/basis`。分层工况的 IEC 为明确确认的均匀土壤对照；`iec_over_fem_percent` 的分母是 FEM 电流。`valid=false` 时 FEM 和偏差为 null，界面显示收敛原因；`judgment` 为 `conservative/nonconservative/within_numerical_tolerance/unavailable`。`assumption_checks` 提供不满足的假设及输入位置。工件的 `source` 绑定保存输入、方法版本与原始计算记录；只消费 `artifact_status=verified` 的结果。

此能力在插件内部保存至少三档网格及加倍域，末两档与加倍域均须满足温度≤0.1 K、允许电流≤0.5 A（可收紧）；未通过不得导出客户计算书。`x-cablesim.simulation-bundle` 保留逐档温度/电流/残差、网格摘要、IEC 过程与完整重放参数；比较工件不传输节点温度场。渲染器 `/14` 的 `data-section="iec-fem-comparison"` 读取这些封存结果。

运行对象新增可选 `execution`：`backend=slurm`、`state`、`job_id`、`plan_id`、`slurm_states`、`actual_cpu_seconds`、`updated`。提交前为 `preparing/submitted`，Slurm 实际 PENDING 为 `queued`，RUNNING/COMPLETING 为 `running`，终态回收为 `collecting`；结束后跟随研究 `succeeded/partial/failed/interrupted`。外层 `status=running` 表示宿主执行流程进行中，不能作为已在计算节点运行的证据。GET 只读调度缓存，不新增 SSH 查询或求解。

## 验证入口

- `plugin-tests/test_research_simulation.py`：完整 Bessel 阶跃热曲线、峰值与温限括区；三种接地拓扑与独立 Faraday/Kirchhoff 薄护套电路手算；双向迭代、能量守恒与同轴热阻 I²R(T) 手算；64 节点温度表经保存引用由 IEC 消费。
- `plugin-tests/test_transient_history.py`：每个时间步都有实际统计，不因场帧限额跳过曲线采样。
- `plugin-tests/test_transient_refinement.py`：相同 Fourier 平板问题分别加密网格和时间步，保留全时长误差，再与原生 COMSOL 对照。
- `tests/test_research_simulation_inputs.py`：缺热容量、未对齐负荷时间、来源/拓扑缺项及越界拒绝。
- `tests/test_hpc_executor.py`：断网恢复、原作业复用、输入/输出/方法摘要篡改及超时/崩溃错误码。

所有含求解器的验证通过 `python scripts/run_plugin_tests_hpc.py --test <测试文件>` 提交 dg83。复现与基准 CLI 在各插件 `validation/`；详细复现范围、来源和限制见 [仿真插件说明](../plugins/SIMULATION.md)。上述数值验证不代替任意用户模型的网格/外域收敛证明，也不产生工程审批。

本机 `.data/simulation/performance/transient-refinement/` 保留本轮加密证据。Fourier 平板 0–4000 s：h=0.0005 m、dt=10 s 的 Elmer 全步误差 0.112159 K；仅 h 减半为 0.114833 K；dt=5 s、2.5 s 分别为 0.054560 K、0.025533 K。COMSOL h=0.0005 m、dt=2.5 s 的已保存测点曲线误差 0.069482 K，两求解器在全部 102 个共同保存时刻最大差 0.056992 K；Elmer 保存 1601 个逐步统计。此算例显示时间离散主导，未把离散采样门槛解释成任意连续时间/任意模型的误差上界。
