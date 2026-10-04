# 数值仿真与论文复现

cablesim.simulation 是宿主 API 2.1 的方法插件。算法位于插件，宿主负责固定输入、执行、输出校验和封存。入口遵守 cablesim.run/2，通过现有 backend.plugin_host.Executor 运行。论文来源见[复现目标清单](SIMULATION_TARGETS.md)，几何边界见[分析几何接口](../architecture/simulation-geometry.md)。

## 1. 方法与范围

| 能力ID | 输入与输出 | 适用范围 |
| --- | --- | --- |
| multiregion-thermal | 领域文档或显式热模型 → 温度场、温限电流、复现报告 | 1–64根有正间隙同心圆单芯、回填/土层/每缆一管、常热物性 |
| getdp-eddy | 领域文档或统一问题 → GetDP独立进程 → 复数场、损耗、电流与报告 | 2D磁准静态、集肤/邻近、理想互联护套；外部GetDP3.5.0 |
| elmer-heat | 固定热模型或统一问题 → Elmer独立进程 → 温度场/时间序列与报告 | 常物性稳态/瞬态、固定/阶跃热源、均匀初态；外部Elmer26.1 |
| electrothermal | 显式磁问题、热边界和σ(T)定律 → GetDP/P1导热闭环、温度场 | 逐积分点温变电导率、实际焦耳/磁损传热；固定k/μ；有界温度范围 |
| capacitive-cable | 同轴多层与轴向区段 → 复电势、电容、充电电流与护套损耗 | 含位移电流的轴对称频域场；单点、两端、三段交叉互联单支路等效 |
| terminal-field | 显式SI三角网格、材料和等电势端子 → 完整Y/C矩阵 | 三相六端子复电势；接地与浮置护套消元 |
| contact-thermal-field | 显式网格、体热源、k(T)和接触导热 → 双迹温度场 | 非线性热传导、内部薄层接触热阻 |
| contact-electrothermal-field | 独立网格、σ(T)/k(T)、给定电流及Rac(T) → GetDP/接触热场闭环 | 包含被动损耗的均质绕组端口约束；完整06参考模型 |
| insulated-wire | 完整双层圆柱参数 → FEM与解析误差 | B01官方数学基准，不是厂家电缆 |
| solid-bonding-flat | 显式护套回路参数 → 电流与RMS磁场 | E05平排理想两端互联解析子模型，不是电磁FEM |

多区域方法支持不同电缆层数、固定每米热源、导体温变电阻、指定芯温、地表恒温或给定h、侧底分别恒温/绝热/对流，以及孤立空气电缆的表面换热。回填为矩形区域，土层由水平界面划分。所有电缆沿轴向无限长。

`multiregion-thermal`不支持点接触/接触热阻、偏心或非圆截面、多芯内部几何、真实管内流体、土壤干燥/湿迁移、暂态与三维交叉热瓶颈；显式离散场的接触/多芯能力另见§12。辐射仅为对给定环境的局部灰体交换，不含互相遮挡/视角因子。孤立空气电缆不会通过伪空气热导率相互耦合。

## 2. 输入与平台领域模型

领域文档和案例JSON均经过 thermal_input.prepare()，生成相同 ThermalModel，再进入 thermal.solve_thermal()。领域适配复用 DomainDocument 校验，只读取选定截面/负荷、型号与材料，不读取当前画布或“最新运行”。

显式模型包含：

- cables：稳定UID/回路、x/z、按半径递增的层、逐层k及固定W/m热源、电流/电阻模型或给定芯温、温限和可选同心排管。
- environment：背景矩形、土层/回填矩形、全部外边界及数值。
- provenance、assumptions：参数来源、几何推导及等效假设。

地下坐标x横向、z向上、地表z=0，长度m、温度K。每层固定热源必须显式给出，0不代替未知。W/m按实际多边形域面积归一化，源积分保持给定功率。未知k、R20、α、损耗或边界使预检失败。

研究参数：

    controls:
      operation: temperature | ampacity
      mesh_size_m, far_mesh_size_m, mesh_transition_m, max_nodes
      tolerance_k, max_iterations, relaxation
      current_upper_a, current_tolerance_a, rated_circuit
    domain_options:
      section_id, load_id, bounds_m, boundaries
      per_cable: {电缆ID: {electrical, fixed_layer_heat_w_m,
                           prescribed_core_temperature_k, equivalent_layers_acknowledged}}
      duct_air: {排管ID: {resistance_k_m_w, source}}
      source
    reproduction: {citation, scope, targets, missing_inputs, assumptions}

热导率来自领域 thermal_resistivity 的倒数；R20和α来自导体与材料，方法参数不能覆盖。逐缆电流优先于回路电流。丝/带/皱纹层只有在明确声明同心等效并提供等效热物性后才能使用；额外层、电缆和排管不能静默丢弃。

指定芯温与导体发热/电阻驱动互斥，导体作为内Dirichlet孔处理，不补未知芯热导率。此时current_a=0仅表示未启用电流驱动，不是论文实际零负荷。反求电流只改变选定回路并保持其他负荷，全部电缆温限均参与约束。

## 3. 网格和方程

Gmsh OCC fragment保证背景、土层、回填、排管与电缆的材料界面共形。覆盖优先级为背景→土层→回填→管壁/等效空气→电缆外层至内层。同一语义UID被切成多个实体时累计其面积和源向量，不能覆盖前一个实体。

网格核验区域范围、正间隙、退化单元、材料映射、外/内边界唯一归类和节点上限。局部和远场尺寸分别声明；复现入口细化时同步缩放两者。超限明确失败，不自动换粗网格。坐标、连接、域标签和温度保留在JSON场工件；宿主16 MiB单工件限制仍有效。

    −div(k grad(T)) = Q
    Rac(Tmean) = R20 [1 + α20 (Tmean − 293.15)] (1 + ac_extra_factor)
    Pconductor = I² Rac(Tmean)
    Psheath = sheath_loss_factor × Pconductor
    qboundary = h (T−Ta) + ε σSB (T⁴−Ta⁴)

电阻使用面积平均导体温度，温限使用导体节点峰值；分别输出。交流附加、护套损耗系数须有来源，不自动计算集肤/邻近或接地电路。固定介质损耗放入对应绝缘层。给定芯温时通过内边界反力获得供热，不再次施加论文由温差反算的导体损耗。

松弛Picard有明确容差和迭代上限；停止后按接受温度重新核验完整热源、辐射边界、物理残差和能量平衡。仅线性残差小不足以接受非线性解。非有限温度、非正电阻、不收敛和越出数值温区均失败。

温限反求在明确的0—上界区间检查夹根，再二分返回可行低端点。保存试探轨迹和上下端点。零电流已超温、未夹根或不收敛不能返回最后试探值作为载流量。

## 4. 排管等效与IEC对拍

管内空气采用现有IEC插件输出的等效热阻：

    k_air,eq = ln(r_duct,inner / r_cable,outer) / (2π T_air)

这是圆环导热换算，不复制IEC经验式。记录IEC插件精确版本、运行ID、请求/工件摘要与所取状态。T_air固定于该IEC运行的收敛值，FEM不再次实现温变管内空气经验式，不宣称CFD。

iec_compare.py通过宿主直接调用 cablesim.iec60287/steady-rating。同一份领域文档原样传给两个插件；介质总损耗及管内热阻直接取IEC输出。温度比较取运行状态，载流量比较取额定状态的空气热阻。共同交流/护套系数是显式合成输入，用于隔离热模型差异，不是电磁正确性证据。

差异包括：IEC半空间与FEM有限侧底恒温；集总温度与内部梯度/金属热阻；标准介质损耗路径与层内体热源；固定空气热阻与温变经验表达。E03给定芯温缺少R20/α，E02空气模型不在现有IEC地下子集，不能伪造这两篇的IEC同工况结果。

## 5. 统一复现报告

工件类型 x-cablesim.reproduction-report，schema cablesim.reproduction-report/1。报告与场分别封签，不修改工程，engineering_approval恒为false。

| 字段 | 内容 |
| --- | --- |
| kind | case：单网格；suite：多工况/网格；blocked：缺关键输入未运行 |
| reference | ID、作者、题名、年份、DOI/URL；可用时原文SHA |
| scope | 完整问题或明确子问题、近似与不覆盖项 |
| frozen_inputs | JSON路径、原值/推导说明、图表、PDF页及印刷页；HTML明确无页码 |
| rows | 目标ID、物理量、实体、位置/统计方式、SI单位、论文值、计算值、差值、容差来源、状态与原因 |
| numerical_evidence | 节点/单元、网格尺寸、物理和能量残差 |
| variants | 最细结果、网格序列和相邻变化；mesh_independence_certified=false |
| run / 摘要 | 精确方法/插件版本、输入/准备摘要、运行ID、环境、工件摘要 |
| missing_inputs | 缺失字段、出处、原因和影响；存在关键缺项即禁止求解 |

单行状态为matched、outside_tolerance、not_comparable、missing_reference、not_assessed。汇总另含incomplete、comparison_requires_review、blocked_missing_input和solver_failed。求解成功与复现通过分开。

温度默认仅报K绝对差，不以摄氏温度或绝对K作分母稀释误差。无参考值、无预设容差或统计方式不一致不得自动验收。曲线比较指定坐标及插值，不外推补点。容差在运行前冻结，不能跑后放宽。原文在.data/papers，结果在.data/simulation，均不入库。

## 6. 验证与论文案例

plugin-tests/test_simulation_thermal.py覆盖圆柱解析、芯温内边界反力、独立解析电阻反馈、温限反求、分层/回填标签及真实子进程JSON工件。领域与显式模型需产生相同PreparedInput和数值；IEC比较保留双方实际运行。

E03：[Jörgens与Clemens 2021](https://www.mdpi.com/1996-1073/14/16/4910)，Fig.3、Table1/2、Eq.13。指定芯温90°C，干/湿土0.47/2.1 W/(mK)，地表h=1.5。图中1.5 m量至电缆上表面，因此中心深1.5524 m、域底深6.8048 m；解释写入夹具。只验证弱耦合热子问题，不验证电荷输运或载流量。

E02：[Cywiński与Chwastek 2021](https://www.mdpi.com/1996-1073/14/7/2008)，Table1名义几何、p.10功率55.7 W/m及k/辐射、p.11标定h=10.2。这是标定边界的热子模型，不是ICEPACK流体。实测与名义外径不同；上下两点中值不是圆周平均，对该项报告not_comparable。

| 论文热目标 | 参考°C | 最细网格°C | 差值K | 预设绝对门槛 |
| --- | --- | --- | --- | --- |
| E03干土绝缘外侧 | 77.9 | 77.758677 | −0.141323 | 0.5 K |
| E03干土地表中心 | 24.2 | 24.157489 | −0.042511 | 0.5 K |
| E03湿土绝缘外侧 | 61.0 | 60.947278 | −0.052722 | 0.5 K |
| E03湿土地表中心 | 26.7 | 26.734489 | +0.034489 | 0.5 K |
| E02名义结构、等效h的芯温 | 79.2 | 78.282676 | −0.917324 | 1.0 K，近似热子问题 |

E03网格尺寸8/4/2 mm，对应1458/5518/21234节点、2807/10823/42045单元。干土绝缘外侧温度77.611024/77.725315/77.758677°C，湿土60.767888/60.906681/60.947278°C；末次变化0.03336/0.04060 K。地表末次变化分别−0.00772/−0.00089 K。E02网格0.8/0.4/0.2 mm，对应1020/3613/14452节点，芯温78.288761/78.283771/78.282676°C，末次变化−0.00109 K。网格变化已经小于剩余论文偏差，不能继续加密来解释原文取整、边界近似或几何口径差异。

T10原文Fig.5（PDF3/印刷539）给铜丝层外径58.03 mm、PVC厚2.8 mm，却同时给外径66.12 mm，层尺寸不闭合；并缺损耗/温限等数据。T17原文PDF6/印刷874的电阻/集肤式存在量纲疑点；T04缺可读全文。这些案例的字段级缺项保存在插件 tests/cases/thermal-deleon.json、thermal-oclon.json、thermal-nahman.json，统一入口只生成blocked_missing_input报告，不调用求解器，不计作复现成功。

共同输入的合成IEC对照（不是上述论文）已按封签IEC 0.4.0重跑，并再次按研究线程更新的0.5.0重跑，数值一致。在3 mm局部网格、12 m侧/底范围：直埋IEC855.252075 A、FEM859.924316 A（+0.546300%）；排管IEC785.505676 A、FEM785.140991 A（−0.046427%）。400 A运行点的三相温差，直埋为−0.133816/−0.149214/−0.131412 K，排管为−0.062266/+0.032079/−0.063508 K。完整双方版本、运行ID与摘要位于`.data/simulation/iec-comparison/`。模型差异见§4，不能将合成对照称为论文IEC复现。

### B01导线解析基准

[scikit-fem 12.0.2 ex17](https://github.com/kinnala/scikit-fem/blob/12.0.2/docs/examples/ex17.py)：a=2、b=3、k0=101、k1=11、Q=5、h=7。说明段前因子b²与执行代码不一致，采用能量守恒和执行式的a²：

    ΔTcentre = Q a²/(2bh) + Q a² ln(b/a)/(2k1) + Q a²/(4k0)

解析温升0.894300070420 K。该基准保持体热源Q，另记多边形面积误差；通用入口输入W/m并归一化，二者不能混用语义。

| 网格尺寸 | 节点/单元 | 中心温升 K | 相对温升误差 | L2误差 K·m |
| --- | --- | --- | --- | --- |
| 0.300 | 425/785 | 0.891336829609 | −0.331347% | 0.0147457291 |
| 0.150 | 1580/3032 | 0.893532005374 | −0.085884% | 0.00367629141 |
| 0.075 | 6057/11860 | 0.894115953500 | −0.020588% | 0.000916005105 |

观察到约二阶趋势，仅适用于此基准。离散能量残差不等于温度精度，两网格接近也不是无限域误差或GCI证书。

### E05护套解析子模型

[Luncă等2023](https://www.mdpi.com/2076-3417/13/10/6328)，§3.1/4/5.1、Table3。352 A、50 Hz、平排间距0.106 m、深0.8 m；护套25 mm²、均半径14.8 mm、σ20=58 MS/m、α=.00393、约80°C。

| 量 | 论文FEM | 解析子模型 | 相对差 |
| --- | --- | --- | --- |
| A相电流 A | 64.129 | 64.191114 | +0.096858% |
| B相电流 A | 44.704 | 44.729888 | +0.057909% |
| C相电流 A | 61.347 | 61.418454 | +0.116476% |
| 地上1m中心磁场 μT | 3.876 | 3.903382 | +0.706462% |

忽略局部涡流和地返回，理想互联且总护套电流为零。热基准网格证据不能验证该解析电磁模型；“约80°C”和名义面积不支持逐末位复现。

## 7. 运行与检查

数值环境沿用 plugins/requirements-native.txt 或 requirements-electrothermal.txt。基准环境为Windows x64、Python3.11.8、Gmsh4.15.2、scikit-fem12.0.2、NumPy2.3.5、SciPy1.17.0，其他平台另验。

    .\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/replay.py plugins/cablesim.simulation/src/cases/thermal-jorgens.json --output .data/simulation/thermal-jorgens
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/replay.py plugins/cablesim.simulation/src/cases/thermal-cywinski.json --output .data/simulation/thermal-cywinski
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/iec_compare.py
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/replay.py plugins/cablesim.simulation/tests/cases/thermal-deleon.json --output .data/simulation/thermal-deleon
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/reproduce.py
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/reproduce_paper.py
    .\.venv\Scripts\python.exe -m pytest plugin-tests/test_simulation_thermal.py plugin-tests/test_simulation.py

replay.py是统一案例入口，JSON变体和网格使用同一方法。tests/reproduce*.py只重放B01/E05既有回归，由本节引用。宿主作业位于.tmp/simulation-*；报告是本地忽略工件。精确包版本/封签绑定代码，不用文档内Git基线替代。

## 8. 求解器选型

| 能力 | 技术选择 | 范围与验证 |
| --- | --- | --- |
| 稳态多区域/温变电阻 | Gmsh + scikit-fem | 已实现；解析、网格/域、守恒、论文与IEC分别核验 |
| 暂态/周期/应急 | Elmer HeatSolve | 常物性阶跃/周期热源与BDF1/2已适配；温变电阻/应急反求及IEC60853数值认证未实现 |
| 谐波电磁与场路 | GetDP Az-u与Network | 二维P1/P2、理想串并联、给定均质电流与已验证σ(T)热反馈；任意分段接地阻抗及真实3D绞合未实现 |
| 隧道/管内流体 | OpenFOAM候选 | 未实现；需自然/强制对流与共轭热基准 |
| 高阶/大规模/热湿 | FEniCSx候选 | 未实现；双区k与真实湿迁移不能混称 |
| 交叉/轴向瓶颈 | 3D或经验证截面+轴向模型 | 二维无限长模型不覆盖 |

许可和部署依据：[Gmsh GPLv2+及Windows接口](https://gmsh.info/doc/texinfo/gmsh.html)、[scikit-fem BSD-3-Clause](https://github.com/kinnala/scikit-fem)、[DOLFINx LGPL及安装](https://docs.fenicsproject.org/dolfinx/main/python/installation.html)、[Elmer组件许可](https://www.elmerfem.org/blog/license/)、[GetDP GPLv2+及二进制](https://getdp.info/)、[OpenFOAM WSL2](https://openfoam.org/download/windows/)。FEniCSx/OpenFOAM不能假定在当前Windows venv直接可用。第一方许可以包清单为准，进程隔离不自动解决再分发义务。

外部exe/容器、通用二进制和跨插件依赖遵循[唯一插件规范](https://github.com/luohui1/CableSimPro-Plugins/blob/main/SPEC.md)，不在宿主内置算法或绕过版本与审批。

## 9. 外部求解器适配

### 9.1 问题、网格与结果

宿主仍使用既有Python插件运行协议；插件负责翻译和后处理，GetDP/Elmer以独立子进程求解。纯导热的既有scikit-fem方法保留；不在该方法里重写涡流或多物理求解器。

    固定领域快照 / 论文JSON
        → cablesim.simulation-problem/1
        → 共形Gmsh网格 cablesim.analysis-mesh/1
        → GetDP .pro + MSH2 / Elmer .sif + 四个原生mesh文件
        → 独立进程、退出码/日志/结果资格检查
        → cablesim.simulation-bundle/2 + cablesim.reproduction-report/1

统一问题包含：`physics`、有优先次序的`geometry`矩形/圆域（后项覆盖前项，`void`为内孔）、区域材料、外/内边界选择器、热源或RMS复电流/电压梯度激励、频率/时间参数、磁场/电流密度测点、来源和假设。所有物理值使用SI。热材料要求k，瞬态额外要求ρcp；电磁材料必须显式给σ和μr，包括非导体的0。每个导电区域必须明确约束；理想互联组以多区域零总电流表示。

网格保存节点、P1三角形、材料域ID、外边界边及相邻单元、稳定UID和摘要。两个翻译器直接使用这些节点和连接，不各自重新剖分。稳态热模型经`problem_mesh.from_thermal()`保留既有`thermal_mesh.build()`的原始网格；scikit-fem可接收同一个准备好的网格。Elmer回读核对节点、单元连接和区域；GetDP核对节点表、实数非负焦耳损耗和电流/KCL约束。

电磁领域映射读取选定截面、负荷、材料及型号，额外要求显式相角、材料工作温度、非导体声明和护套分组。只接受实心圆导体及光滑同心层；不静默把绞线、铜丝屏蔽或交叉互联转换为另一物理对象。复杂模型可先准备具有明确等效依据的统一问题。Elmer领域热映射目前用于稳态固定损耗/给定芯温；瞬态统一JSON入口已实现，平台原生负荷曲线至热源的自动映射尚未实现。

外部工件增加求解器真实版本、可执行文件/关键模块SHA、插件清单SHA、问题/网格SHA、命令生成的输入文件文本和原始日志。GetDP输出复数Az、区域复电流、每米损耗和测点；Elmer保存最终空间场及有物理时刻的观测序列。时间以PVD索引核对声明时间网格，保留其舍入时刻，不根据VTU文件编号猜时间。宿主单工件16MiB限制不变；超限失败，不丢字段或降低精度冒充完成。

### 9.2 GetDP涡流及磁场后处理

采用官方二维A-u弱式：节点`BF_PerpendicularEdge`表示Az，导电区域`BF_RegionZ`表示轴向电势梯度。导体净电流通过全局约束施加；护套使用`Constraint Type Network`和并联支路同时满足共同电压及电流和为零。不是Python解析回路后置修正。[官方A-u示例](https://onelab.info/pipermail/getdp/2015/001879.html)、[官方网络耦合示例](https://onelab.info/pipermail/getdp/2010/001365.html)。

相量采用RMS，因此`∫σ|E|²dA`即W/m，不再乘1/2。集肤验证另与圆柱Bessel阻抗比较；孤立芯、裸三相和含护套三相是不同控制试验，不能把所有附加损耗都称作yp。

一阶单元的`B=curl(A)`为分片常量；`OnPoint`测点可能随网格变化落入不同单元。工件同时保留该原始值，以及由GetDP实际分布电流密度进行三点三角积分得到的自由空间磁场。后者只在μr=1且测点位于非导电区域时提供，使用实际涡流分布，不是线电流解析替代。积分法仍忽略计算域之外的导电土壤电流，需外域检查。

E05采用原文§3.1的20m方域、σ土壤=0.01S/m、芯90°C/护套80°C；薄护套保留25mm²和14.8mm平均半径。有限A=0边界替代原文Balloon边界，介质极小电导率及位移电流忽略并声明。三档局部网格1/0.5/0.25mm结果：

| 量 | 原文 | 1mm | 0.5mm | 0.25mm | 最细差值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| A护套电流 A | 64.129 | 64.078551 | 64.114921 | 64.127809 | −0.001191 |
| B护套电流 A | 44.704 | 44.659354 | 44.685187 | 44.694674 | −0.009326 |
| C护套电流 A | 61.347 | 61.299583 | 61.333190 | 61.345221 | −0.001779 |
| 地上1m原始curl(A)点场 μT | 3.876 | 3.771011 | 3.863682 | 3.873733 | −0.002267 |

不能由该表单独宣称原始点场已不受外域影响。0.5mm局部网格下，20/40/80m外域的原始点场为3.863682/3.708972/3.869214μT，混合了外域和重新剖分的影响；相应分布电流积分场为3.902703/3.902698/3.902695μT。后者稳定，但与原文3.876μT仍差约0.027μT（0.69%）。原文用73个瞬时样本计算RMS，采样起始相位/端点重复可带来约此量级差异；这只是差异解释的候选，未据此调整相位或验收门槛。

两篇额外参数完整的电磁案例：

| 来源及目标 | 原文FEM | GetDP最细 | 差值 | 网格序列 |
| --- | ---: | ---: | ---: | --- |
| E17 Jabłoński等2020，Table1线对交流电阻 | 177 μΩ/m | 177.192792 μΩ/m | +0.192792 μΩ/m | 2/1/0.5mm：178.201661/177.394637/177.192792 |
| E18 Szczegielniak等2019，Table1被动导体近侧J | 3714 kA/m² | 3742.171523 kA/m² | +28.171523 kA/m² | 2/1/0.5mm：3770.441150/3747.244246/3742.171523 |
| 同上，上侧J | 650 kA/m² | 651.524766 kA/m² | +1.524766 kA/m² | 655.443839/652.020266/651.524766 |
| 同上，远侧J | 2321 kA/m² | 2342.213644 kA/m² | +21.213644 kA/m² | 2362.591080/2346.083518/2342.213644 |

E17为R=10mm、d=40mm、σ=36.9MS/m、60Hz、反向单位RMS电流；线对Rac由总损耗/I²得到。E18为R=10mm、d=30mm、σ=55MS/m、200Hz、源导体1kA及被动导体零净电流；只对照Table1被动导体表面诱导J，不把源导体自身集肤电流混入。层/坐标/统计口径和容差来源分别固定在`eddy-twin.json`、`eddy-induced.json`。解析近似与原文FEM本身存在差异，另保存外域扫描，不使用反拟σ使结果相等。

### 9.3 IEC系数对拍

`tests/compare_eddy_iec.py`直接调用现有封签IEC插件的`electrical()`和`_loss_factors()`，保留其版本和清单摘要，不复制IEC公式。公共`steady-rating`会迭代温度，因此这里使用固定芯90°C/护套80°C的电气系数探针，不冒称一次IEC额定热计算。探针U0=0，未使用介质损耗结果，也未填造热物性。IEC按同一实心等效σ和几何导出R20；不混用厂家150mm²绞线的名义R20。相序显式映射为论文的−120/0/+120度。

| 系数 | GetDP | IEC插件0.5.0 | 解释 |
| --- | --- | --- | --- |
| ys | 0.001565978 | 0.001568838 | 孤立实心芯集肤控制试验 |
| yp，A/B/C | 0.000062663 / 0.000250969 / 0.000062802 | 各相0.000122491 | 裸三相FEM每相邻近效应与IEC共同近似系数，不要求逐相相等 |
| λ1总，A/B/C | 0.123449204 / 0.060446265 / 0.112967870 | 0.123655452 / 0.060042541 / 0.113203854 | 本次IEC输入明确忽略局部涡流；FEM总量还含局部护套涡流，不能直接判相等 |
| λ1环流部分，A/B/C | 0.123296922 / 0.059880398 / 0.112830864 | 同上 | FEM以I护套²Rdc拆分；差值和涡流余量保留在报告 |

该对拍属于模型差异研究，未给人为放宽的“全部通过”判据，报告为`not_assessed`。已执行并校验IEC0.4.0、0.5.0；最新精确清单SHA和GetDP运行、工件摘要在`.data/simulation/eddy-iec/report.json`，不再等待封签。修正了原脚本读取旧full FEM结果的问题：现在每次重新计算完整带护套模型；孤立芯与裸三相控制试验可显式复用输入摘要相同的本地记录，原运行与版本保留在对应文件。探针已显式传递0.5.0需要的相序、接地和土壤分支事实，没有更改IEC算法。

### 9.4 Elmer验证与未覆盖项

Elmer使用官方HeatSolve，P1空间离散和BDF1/2时间推进；适配层只生成材料/边界/热源及采样时刻。以Density=1、HeatCapacity=ρcp表达给定体积热容，HeatSource为W/m³（Elmer内部单位质量源项乘Density），没有补猜ρ和cp。热源按实际网格面积归一化，每米功率保持原值。分段恒定热源在切换后的区间生效，不能提前一时间步加热。

E03干/湿土共三档原始网格，Elmer与既有scikit-fem的最大节点温差分别不超过6.36×10⁻¹¹K和1.31×10⁻¹⁰K。这只证明相同线性离散问题的独立装配/求解一致，不代替论文误差或外域验证。

V02是明确的自建解析验证：厚20mm、宽5mm平板，k=0.2W/(mK)、ρcp=2×10⁶J/(m³K)，两侧293.15K、上下绝热、均匀体热源10⁵W/m³、初温293.15K。阶跃及每1000s启停，算至4000s；独立Fourier级数提供参考。时间步20/10/5s时，全部实际输出时刻的最大测点误差为0.24752/0.13575/0.08181K；空间2/1/0.5mm也独立扫描，保留时空误差可能相互抵消的记录，不仅比较终点。

V01圆导体Bessel基准和V02不计入论文/标准来源数量。尚未完成IEC60853完整算例验证；公开修订单缺基础输入，本地标准目录只有60287及TB880，QuickField的F2重现模型包为专有数据库，未导出核实全部几何与时间曲线。不能将自建阶跃案例标成IEC60853通过。Elmer的温变电阻、辐射、非均匀初态、通用多物理迭代和应急电流反求均不在当前能力内。

### 9.5 安装和可重放命令

Python依赖沿用`plugins/requirements-native.txt`中Gmsh4.15.2、scikit-fem12.0.2、meshio5.3.5及现有宿主环境。外部程序独立安装，不打包入插件、不链接进宿主，不修改系统PATH。插件只接受管理员配置的程序路径或宿主启动PATH，不接受案例提供的可执行命令。

- [GetDP3.5.0 Windows64复数版](https://getdp.info/bin/Windows/getdp-3.5.0-Windows64c.zip)：解压后确认`getdp.exe -version`输出3.5.0。
- [Elmer26.1 Windows no-GUI/no-MPI](https://www.nic.funet.fi/pub/sci/physics/elmer/bin/windows/rel26.1/ElmerFEM-nogui-nompi-Windows-AMD64-rel26.1.zip)：解压运行环境。该发行包的`ElmerSolver --version`实际报告**9.0 / Compiled2026-01-20**，工件同时记发行版26.1和真实Solver版本，不把包名当成程序版本。必须包含`libelmersolver.dll`、`HeatSolve.dll`、`ResultOutputSolve.dll`及运行时DLL。Fortran编译器不用于当前适配。

本机环境配置文件为被忽略的`.data/cablesim-solvers.json`：

    {"getdp":"D:/tools/cablesim-solvers/getdp-3.5.0/getdp-3.5.0-Windows64/getdp.exe",
     "elmer":"D:/tools/cablesim-solvers/elmer-26.1/ElmerFEM-nogui-nompi-Windows-AMD64/bin/ElmerSolver.exe"}

适配器仅给子进程设置Elmer的HOME/LIB及DLL搜索路径，使用参数数组、无shell、超时和退出码检查。未安装、版本不符或关键模块缺失返回`EnvironmentMissing`及官方安装地址；绝不退回解析或scikit-fem结果。GetDP采用GPL，Elmer组件采用GPL/LGPL；独立进程与不分发程序是实现方式，不构成未来产品分发的自动许可豁免。[GetDP许可](https://getdp.info/)、[Elmer许可](https://www.elmerfem.org/blog/license/)。

    .\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/external_replay.py plugins/cablesim.simulation/src/cases/eddy-lunca.json --solver getdp --output .data/simulation/eddy-lunca
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/external_replay.py plugins/cablesim.simulation/src/cases/eddy-twin.json --solver getdp --output .data/simulation/eddy-twin
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/external_replay.py plugins/cablesim.simulation/src/cases/eddy-induced.json --solver getdp --output .data/simulation/eddy-induced
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/verify_external.py
    .\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/compare_eddy_iec.py
    .\.venv\Scripts\python.exe -m pytest tests/test_simulation_external_contracts.py plugin-tests/test_simulation_external.py

`verify_external.py`产生`.data/simulation/external-verification/`中的同网格热场、时步/网格和外域报告；`compare_eddy_iec.py`产生`.data/simulation/eddy-iec/report.json`。原始输入、网格、实际进程日志和结果随宿主运行工件保存；验证用临时目录只放`.tmp/`。

### 9.6 后续求解器接入条件

OpenFOAM接入前必须有完整的空气/流体域、入口出口/壁面条件、温度相关流体物性、自然或强制对流模型、湍流及辐射适用范围，以及共轭传热的界面守恒映射。至少通过公开流动/换热基准和网格/时步检查，确认Windows下受控WSL/容器启动与版本记录后，才能发布流体能力。

FEniCSx用于已有求解器不能满足的高阶、大规模或明确研究方程。接入前需固定Linux/WSL或容器环境、MPI/PETSc版本及许可；统一问题描述必须能完整表达所需方程和边界，并以同网格独立求解器及解析基准核验。不能只换后端名字而忽略不支持的材料/拓扑。本插件尚未安装或接入这两者。

## 10. 可选 COMSOL 参考插件

`cablesim.comsol-bridge` 是独立的外部适配插件，开源仿真仍为默认流程。用户须自行安装 COMSOL 6.2 并持有适用的有效商业许可证及 AC/DC 或 Heat Transfer 模块；平台不分发 COMSOL 程序、库、MPH 模型、许可证或教程全文。独立进程并不替代商业许可约束，模型成果对外发布还须由使用者按其许可证核对。

### 10.1 输入、执行和结果

两个插件共享 `backend/foundation/simulation.py` 和新增电热 SI 数据契约，宿主不包含求解算法。桥接支持二维谐波磁场、恒物性稳态热场以及显式σ(T)电热耦合，调用原生 Magnetic Fields / Heat Transfer / FrequencyStationary 接口；不把求解转移到 Python。暂态、孔洞翻译、非线性热边界及三维尚未翻译。轴对称电容教程目前由固定的只读本机复现脚本对照，不开放任意MPH或Java输入。

管理员在忽略的 `.data/cablesim-solvers.json` 中添加 `comsol` 字段，指向 `E:/comsol/COMSOL62/Multiphysics/bin/win64/comsolbatch.exe`。案例不能提供执行路径、Java 表达式或任意 MPH 文件。启动前核验版本、编译器和所需模块/许可证；记录实测 **6.2.0.290**、模块检测、可执行文件、生成源、模型及日志 SHA256。通过命名互斥锁和系统进程枚举阻止另一 COMSOL 同时启动；超时由宿主 Job Object 终止整个子进程树。COMSOL 返回0仍可能失败，因此另检查编译错误、许可证状态、唯一新模型和 `BRIDGE_COMPLETE`。不修改 COMSOL 安全设置或系统 PATH。

原生场采用二阶单元；磁场/电流峰值除以√2转为 RMS，周期平均损耗保持原值。COMSOL 网格的顶点及线性连接用于显示，实际求解使用原生曲边二阶形函数。探测点有独立局部尺寸约束。GetDP 固定探测三角形、圆周边数等特殊控制不被 COMSOL 静默忽略。稳态热边界通过邻接关系只选外边界，内部材料界面保持连续；分层圆柱以独立解析解检验。

结果沿用 `cablesim.simulation-bundle/2` 和 `cablesim.reproduction-report/1`。复现行可包含 `reference_solver`、`reference_solver_value`、`difference_from_reference_solver`；物理输入 SHA256、量名、对象、单位、测点与时间必须匹配，否则不给比较数字。两插件使用同一排序UTF-8 JSON摘要函数，保持既有开源摘要不变。较早COMSOL工件使用紧凑JSON格式；比较历史工件时，只对完整性已验证的保存输入重新排序并计算共同摘要，同时保留原始证据摘要，不改写历史结果。MPH只作本机运行中间文件，工件保留哈希和可重建源，收集后删除中间模型。所有结果均为数值校核，不含工程批准。

### 10.2 三方对照与误差定位

当前证据位于 `.data/simulation/comsol-comparison/report.json`，每个案例保留 GetDP 二阶三档网格及 COMSOL 两档运行；E05另保留局部探针加密。下表为本轮实际值，不覆盖同一论文的其他工况。

| 工况 / 量 | 论文参考 | GetDP（二阶细网格） | COMSOL | 单位 |
| --- | ---: | ---: | ---: | --- |
| E17 回路交流电阻 | 177 | 177.151779 | 177.134546 | μΩ/m |
| E18 被动导体近侧 J | 3714 | 3742.711868 | 3742.457274 | kA/m² |
| E18 被动导体顶部 J | 650 | 651.727598 | 651.708011 | kA/m² |
| E18 被动导体远侧 J | 2321 | 2341.740895 | 2341.534928 | kA/m² |
| E05 A相护套电流 | 64.129 | 64.183347 | 64.184016 | A |
| E05 B相护套电流 | 44.704 | 44.726563 | 44.726835 | A |
| E05 C相护套电流 | 61.347 | 61.395313 | 61.395906 | A |
| E05 地上1m中心原始点场，20m方域A=0 | 3.876（Balloon外域、73样本） | 3.795283 | 3.795221 | μT |

E17 两求解器差0.017233 μΩ/m，小于 GetDP 最后网格变化0.049581 μΩ/m；论文只列整数177。E18两求解器差0.255/0.020/0.206 kA/m²，均小于 GetDP 最后网格变化0.759/0.059/0.615 kA/m²。它们与论文FEMM仍差约0.77%/0.26%/0.88%，不能归入当前网格误差。原文PDF7/印刷1928的Table2自身给出二阶近似3756/652/2354，而FEMM仍为3714/650/2321；原始FEMM网格与外域条件未公开，原因尚未完全闭合，保留待核对。

E05电流的求解器差小于 GetDP 网格变化。20m有限外域的原始点场差仅0.062 nT；进一步外域变化显著，不能拿该有限外域直接验证论文Balloon结果。论文§3.2明确N=73但没有列出采样相位和端点权重。连续相量RMS约3.90245 μT；假设0–2π含两端的73个余弦样本，则约3.87771 μT。后者是统计口径敏感性检查，**不是已证明复原作者Excel过程**，也不用于修改本次RMS定义或容差。

### 10.3 E05 原始点场外域证据

采用 GetDP 二阶A场，测点位于同一个显式三角形的内部重心。各档探测单元顶点 SHA256 一致，固定近场0.5 mm、远场0.4 m、过渡4 m；8 m外以同一增长规则加粗，不缩放近场参数。

| 方域边长 / m | 原始 curl(A) 的 B RMS / μT |
| ---: | ---: |
| 20 | 3.795168243 |
| 40 | 3.875398772 |
| 80 | 3.895628008 |
| 160 | 3.900799531 |
| 320 | 3.902071882 |
| 640 | 3.902544690 |

最后外域变化0.473 nT，小于事先设定的2 nT。640m域另测探测三角形半径20/10/5 mm、导体网格1/0.5/0.25 mm、外域增长率0.1/0.05；点场均约3.9021–3.9026 μT。证据为实际原始 `curl(A)`，没有用分布J积分场替代。完整数组、网格/单元哈希及控制参数见 `.data/simulation/external-verification/raw-field-convergence.json`。这是有限精度的数值收敛证据，不是严格数学误差界。

### 10.4 官方教程04：两种模型分开复现

参数及页码见 [目标清单 C01–C08](SIMULATION_TARGETS.md)。GetDP使用二阶场、1.5mm近场和每圆至少128段，COMSOL使用原生曲边二阶场。聚合物仅作电磁等价合并，未据此计算热场。铠装损耗同时包括焦耳损耗和复磁导率损耗。

| 模型 / 损耗 | 教程Table1 | GetDP | COMSOL | GetDP相对本次COMSOL偏差 |
| --- | ---: | ---: | ---: | ---: |
| 普通2D · 导体 | 47 | 47.058000 | 47.042680 | +0.033% |
| 普通2D · 屏蔽 | 13 | 12.943725 | 12.946417 | −0.021% |
| 普通2D · 铠装 | 7.6 | 7.586973 | 7.589748 | −0.037% |
| 铠装串联2.5D · 导体 | 47 | 47.231599 | 47.216531 | +0.032% |
| 铠装串联2.5D · 屏蔽 | 15 | 15.035759 | 15.039824 | −0.027% |
| 铠装串联2.5D · 铠装 | 0.36 | 0.357352 | 0.358952 | −0.446% |

单位均为W/m（数值等于kW/km）。从64段到128段后串联铠装损耗变化0.004270 W/m，大于两求解器最终差0.001600 W/m；此历史序列保留几何离散影响。已补充160段及Milliken均质多匝分支，当前结果见§12；分段感应电路或真实三维扭绞仍未覆盖。

### 10.5 IEC暂态与界面边界

IEC对拍已重跑，结果见§6和§9.3。IEC60853完整暂态仍缺可靠闭合资料：60853-1:1985公开9页预览无第7章例题正文，AMD2只修改部分表项；ICEST2012论文缺若干热/电参数；公开IEC60853-2 MATLAB模型缺`Cth_filler`及独立负荷—温度参考表；QuickField F2包含专有二进制几何/结果，尚未取得可靠完整文本导出。再次检索[CIGRE CSE No.23 Dynamic current rating - thermal transient response](https://cse.cigre.org/cse-n023/dynamic-current-rating-thermal-transient-response.html)，正文与Table2已保存：245kV三芯1200mm²Al、6×2.4×1.8m水饱和砂槽、ρ=0.42K·m/W、937A预热12天至67.3°C，但各层几何/热容/损耗/边界尚不闭合，且原表t=0的1300A持续5.4h，下一步却从650min开始，中间326min未说明。[Cableizer的IEC60853-2 F6验证页](https://www.cableizer.com/blog/post/validation-emergency-rating-calculations-iec-60853-2/)亦未给出全部RC网络输入。继续标记缺资料，不用解析基准替代。新增HTML/原表图已复制到受控文献目录与`.data/papers/thermal-fifth/`，登记SHA256；两附件现已加入Zotero CableSimPro；登记状态已按设计负责人确认更新。

工作区 `#/simulation` 可导入现有算例JSON，默认选择GetDP/Elmer；已有研究按统一输入模式自动进入仿真页面。可编辑参数及单位、保存修订、预检确认、查看不可变历史和选择COMSOL参考运行。失联重试保留同一请求标识，重复点击不另建运行；错误输入保留并定位字段。Ctrl+S保存、Ctrl+Z撤销、Enter提交、Esc关闭浮层。参考运行必须有相同物理输入哈希。该页面是数值复现工作台，尚未提供任意三维建模或上述未覆盖物理模型的编辑器。

概念图采用`.data/simulation/concepts/comparison-table.png`，另一方向及完整提示词同目录保存；比较表优先，来源按行展开，避免1366px宽度下挤占数字区。浏览器核验使用隔离数据库，不向用户原工程写入测试研究。

### 10.6 重放

```powershell
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_papers.py
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_open.py
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/summarize_comparison.py
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_tutorial.py --solver getdp
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_tutorial.py --solver comsol
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/verify_raw_field.py
.\.venv\Scripts\python.exe -m pytest tests/test_comsol_bridge.py plugin-tests/test_comsol_native.py
```

COMSOL按顺序运行；不要与全量pytest或另一COMSOL并发。`compare_papers.py`包含E05远场0.2m及局部探针加密档；`summarize_comparison.py`仅合并已生成工件，没有该证据时失败，不默认为零偏差。运行工件在`.data/simulation/`，临时求解文件在`.tmp/`并在核验后清理。

## 11. 温度场、外部损耗与新增耦合能力

稳定工件接口见[温度场](../architecture/temperature-field.md)与[护套/铠装损耗](../architecture/electromagnetic-losses.md)，接地事实只引用[研究拓扑契约](../architecture/electrical-topology.md)。仿真线程仅维护插件、工件和契约，`design/workbench/simulation-study.*` 由研究线程整合，此次没有扩展页面。

### 11.1 逐点电热反馈

`electrothermal` 使用 `cablesim.electrothermal/1`：完整 magnetic 问题、热边界、每个导电域的有来源电阻率温变定律和温度有效范围。`sigma(T)=sigma_ref/[1+alpha*(T-Tref)]`；常物性必须显式给alpha=0。GetDP通过同网格P1温度场在积分点取σ，真实求解A-u及电流约束；随后按区域材料侧电场与磁场积分焦耳/磁热源，交给P1热弱式。不是把每区均温代入电阻，也不是固定λ循环。

热源积分与GetDP原生积分相对差必须≤1e−5；最终接受温度同时满足固定点温差、功率变化、热方程残差和整体热平衡。热平衡采用1e−8 W/m绝对舍入余量加1e−5相对余量，零发热时相对残差为null，保留实际绝对残差，不因除以零而误报不收敛。接受的是本次磁场/σ/热源对应的温度输入态，`proposed`仅用于固定点缺陷检验，避免把未重新求解磁场的下一态作为最终温度。超温区、非正ρ、超时、不收敛和热源映射不守恒均失败。当前只支持P1、固定k/μ、实体共形接触和恒温/绝热热边界，不支持薄层接触热阻、温变k、暂态或介电加热。COMSOL总热源按全部材料域积分，包含σ=0的损耗磁介质；另以同轴环域的独立磁损积分回归核验。

`electrothermal-reference` 独立使用COMSOL原生FrequencyStationary及点式σ(T)，热源为mf.Qh。实际freq由原生表达式读回并校验；非线性求解容差设为1e−8。两个方法共同校验输入，不共享矩阵或求解过程。同轴基准取铜半径13.1mm、外半径40mm、k=400/0.46 W/(mK)、20°C外温、50Hz；它验证06所需反馈能力，**不是完整06教程**。α=0另以圆导体Bessel电流密度加独立径向热积分核验。

| 同轴工况 | 开源最高温度 K | COMSOL K | 温差 K | 开源损耗 W/m | COMSOL W/m |
| --- | ---: | ---: | ---: | ---: | ---: |
| 655 A RMS，0.75mm网格 | 298.827914 | 298.825921 | +0.001993 | 14.695938 | 14.689376 |
| 1800 A RMS，0.75mm网格 | 342.238290 | 342.217326 | +0.020964 | 127.050958 | 126.985571 |

损耗相对偏差分别+0.0447%、+0.0515%。655A从1.5mm细化到0.75mm，最高温度298.831602→298.827914K，损耗14.709925→14.695938W/m。本段为同轴σ(T)基准；完整06独立几何及双向电热反馈见§12。

### 11.2 电容与沿线护套充电电流

`capacitive-cable` 使用 `cablesim.capacitive-cable/1`，求解 `div[(sigma+j*omega*epsilon) grad(V)]=0`。半径、逐层径/轴向电导率、εr、频率、峰值电压、轴向压降、长度、坐标缩放、接地、分段比例与相角均明确给出。轴对称弱式带2πr；几何轴向缩短S倍后，径向弱式系数乘S、轴向除S；热积分保留物理体积。电势为峰值相量，周期平均损耗为 `0.5*∫sigma|E|²dV`，不与GetDP RMS口径混用。

交叉互联仅指COMSOL03的**单条连续护套支路轴对称等效**：沿线依次配对三相，非护套层在段间绝缘，内电极施加对应相角，护套两端接地。不是任意三相三护套接地网络，也不包含互屏蔽电容、感应电压或接地阻抗。节点按绝缘切面分开，护套节点保持连续；不能按相同坐标去重。对角缩放与基于局部电压差的迭代改进用于避免高电导率差造成相减消失；KCL和弱残差均保留并作硬拒绝条件。

COMSOL03原教程明确采用护套径向σ=Spbs/Scab、轴向σ=Spbs的数值材料。夹具如实声明此各向异性，未当作真实各向同性铅。原生对照重新求解用户安装的教程文件，只在内存中切换接地/相角；前后原文件SHA一致。轴对称原生积分显式启用intvolume，含2πr。

| 03接地方式 | 开源护套损耗 W | COMSOL W | 相对偏差 | 开源护套峰值电压 V | COMSOL V |
| --- | ---: | ---: | ---: | ---: | ---: |
| 单点 | 1531.313687 | 1531.226629 | +0.00569% | 82.957389 | 82.955168 |
| 两端 | 383.066829 | 383.041302 | +0.00666% | 20.748215 | 20.747264 |
| 三段交叉互联等效 | 85.127077 | 85.120341 | +0.00791% | 6.916074 | 6.915758 |

每层径向12/24/48单元，轴向每段100/100/200单元；护套损耗序列为单点1533.099683/1531.579411/1531.313687W、两端383.567954/383.144303/383.066829W、交叉85.241615/85.147480/85.127077W。最后网格变化均大于当前两求解器差，未宣称严格误差界或网格独立认证。

02同轴径向子模型另以复层阻抗 `Σ ln(rout/rin)/(2π(σ+jωε))` 作独立手算。细网格C=1.389778971e−10 F/m（0.138977897 μF/km）；原教程解析值1.389714701e−10 F/m。COMSOL完整三相截面、护套置零电位后的相1充电电流为0.005545468689 A/m。本段比较端子量；新增完整三相六端子场及互电容矩阵见§12。

工件在`.data/simulation/electrothermal/`、`capacitive/`，汇总在`.data/simulation/coupling-comparison/report.json`。保留精确方法版本、宿主运行ID、输入及原工件摘要；没有预设工程验收容差的比较行仍为not_assessed。

### 11.3 E18诊断结论

固定源电流1kA RMS、200Hz、55MS/m、R=10mm、间距30mm，重新核对论文PDF5–7的Fig.2与Table1/2。二阶场、至少128圆周分段下，仅改变一个输入，不反拟频率或材料。

| 方域半宽 m | 近侧J kA/m² | 顶部J kA/m² | 远侧J kA/m² |
| ---: | ---: | ---: | ---: |
| 0.1 | 3515.888349 | 641.125369 | 2135.159427 |
| 0.2 | 3699.133399 | 650.411606 | 2300.552778 |
| 0.4（原对照） | 3742.711868 | 651.727598 | 2341.740895 |
| 0.8 | 3753.474514 | 651.994889 | 2352.032787 |
| 1.6 | 3756.156999 | 652.057797 | 2354.605432 |
| 3.2 | 3756.827162 | 652.073362 | 2355.248695 |

放大外域逐渐接近论文Table2二阶解析3756/652/2354，而不是Table1 FEMM3714/650/2321。原0.4m半宽下，1/0.5/0.25mm近网格末次变化约0.759/0.059/0.615kA/m²；远场网格减半只变约0.00145/0.00017/0.00113kA/m²。继续加密当前网格不足以解释论文差距。频率198/202Hz和σ54/56MS/m会改变结果，但名义输入已由原文确认，不能据此调参；向内10μm的实际节点取样仍不能同时消除三处差距。已排除当前主要离散误差及名义频率/σ抄录错误；原FEMM外域/边界与网格未公开，外域是有证据的敏感因素，但不能断言就是作者差异的唯一原因。

### 11.4 重放新增能力

```powershell
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_coupled.py --physics electrothermal
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_coupled.py --physics electrothermal --solver comsol
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_coupled.py --physics capacitive
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_capacitive.py
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/summarize_coupling.py
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/diagnose_induced.py
.\.venv\Scripts\python.exe -m pytest plugin-tests/test_simulation_coupled.py plugin-tests/test_simulation_capacitive.py
```

上述COMSOL命令按顺序运行。不同replay_coupled命令共享专用临时目录，不能并发；宿主仍逐工况固定输入和封签，不读取未通过完整性检查的历史场充作新运行。

## 12. 变温表、完整截面场与复现库

### 12.1 变温损耗进入允许电流迭代

接口唯一说明在[损耗工件契约](../architecture/electromagnetic-losses.md)。实际六轴表有1728个GetDP采样点、216个独立中心点；最大系数绝对插值误差0.001958761，预设容差0.003。温度范围20–100°C，共同电流倍率0–4，改变相序、比例、几何或材料须重算；不外推。IEC每次热迭代按各根导体/护套温度插值，同一合成输入得到594.790870A。中心点误差不含网格误差，也不是全域严格误差界。

### 12.2 完整截面与双向电热

`terminal-field`（`cablesim.terminal-field/1`）独立组装复电势P1方程，按每个等电势端子1V基场求完整单位长度Y矩阵；C=Im(Y)/ω。COMSOL02保留完整三相、护套、铠装、聚合物与24个空气域；非端子金属采用原模型的5S/m数值稳定材料。六端子矩阵用于接地护套与浮置护套两种比较，后者由精确线性Schur消元获得，未把一次三相激励下的I/V冒充完整矩阵。原生COMSOL每个端子独立重算。

`submarine_geometry.py`以原教程尺寸与布尔构建步骤独立生成Gmsh/OCC几何，不导入原生网格或材料掩码。完整截面有166个材料域、24个空气腔、110根钢丝及分成四域的光纤钢管；13类材料域数逐类一致。面积对COMSOL最大差0.148%，最后两档面积变化<0.2%。COMSOL面积以原生曲边单元积分1计算，不能拿顶点直边面积代替。C01仅为几何验证，单列，不凑入物理算例数量。

02独立Gmsh节点24184/40155/66766，对COMSOL非零电容项最大差0.091%；最后网格变化满足0.2%或0.01pF/m门槛。原生六端子分别施加1V，不拿一次三相激励的I/V冒充完整矩阵。当前独立结果在`.data/simulation/capacitive-independent/`；早期原生网格回放保留为诊断证据，不再作为完整几何复现的唯一依据。

端子入口可显式给`floating_terminals`，输出原始六端子矩阵及消元后的保留端子矩阵，奇异浮置子系统拒绝。热入口的恒温节点仅支持外边界；与接触边重合的单侧温度条件无法用当前节点编号表达，明确拒绝。热工件另存接触两侧域号、温度迹节点和有符号传热量，不能只凭重合坐标识别界面。

06使用`contact-electrothermal-field`（`cablesim.contact-electrothermal-field/1`）。GetDP每次按σ(T)重新求无源金属损耗，独立热FEM使用k(T)与20μm空气接触导热；温度双迹反馈到下一次电磁求解。Cu保留原生等效k=30.1124W/(mK)。原生最终模型是Multi线圈及Scup2全局方程：`Rac(T)=1.39 Rcon[1+αCu(T−293.15)]`约束含被动损耗的平均端口电阻。因此均质绕组热量为`3 I_RMS² Rac(Tmean)−Ppassive`，不是把标准系数或原生热源喂给开源模型。参考电流655A RMS；COMSOL原式I0为655√2A峰值。

每单元采用七点积分保守传热，核对GetDP损耗积分和热载荷总和。迭代容差为温度更新1e−4K、功率相对更新1e−6；越出来源温区或均质绕组热量非正即失败。返回热试探温度与最后磁场输入温度在该容差内一致；历史`temperature_input_sha256`只标识磁场输入态，不冒称最终热场摘要。

| 量 | 开源细网格 | 原生COMSOL | 差异 |
| --- | ---: | ---: | ---: |
| 02 接地护套 C11，pF/m | 139.035897 | 138.971627 | +0.0462% |
| 02 浮置护套 C11，pF/m | 97.600325 | 97.528546 | +0.0736% |
| 06 最高温度，K | 362.738486 | 362.804317 | −0.065831 K |
| 06 导体平均温度，K | 362.662662 | 362.728642 | −0.065980 K |
| 06 铅护套平均温度，K | 355.931401 | 356.001428 | −0.070027 K |
| 06 铠装平均温度，K | 343.290096 | 343.459542 | −0.169446 K |
| 06 导体损耗，W/m | 57.854602 | 57.808272 | +0.0801% |
| 06 铅护套损耗，W/m | 11.492717 | 11.541505 | −0.4227% |
| 06 铠装损耗，W/m | 6.957952 | 6.971100 | −0.1886% |

06开源节点24884/40861/60503/90534，最高温度362.553781/362.661098/362.718482/362.738486K；末次变化0.020004K。COMSOL节点9639/24939/30784，最终原生模型SHA前后不变。最热点对拍差<0.1K，分项损耗最大差0.514%（光纤钢管）；平均温度诊断最大差0.169446K，完整保留，不用摄氏百分比稀释。结果和温度场图在`.data/simulation/submarine-coupled/`。这是固定原文边界下的复现，不等于研究页加倍域交付门禁通过；`engineering_approval=false`。

04已补全普通2D、110钢丝串联2.5D及N=1均质多匝三个分支。均质导体热量按给定Scup=59.6MS/m、Acon=500mm²直接计算；其余损耗来自GetDP。多匝分支导体/护套/铠装为43.190436/15.551756/0.370774W/m，原生为43.190436/15.553772/0.371796W/m。全部分支对拍差≤0.5%，最后圆周细化变化≤0.5%；完整记录在`.data/simulation/submarine-inductive/`。这是教程的均质近似，不是三维逐股模型。

### 12.3 复现数量与资料边界

按独立来源计数，不把网格、工况或接地变体算成新来源：

| 类型 | 已完成声明范围 | 部分复现 | 有实际结果合计 |
| --- | ---: | ---: | ---: |
| 论文（E02/E03/E05/E17/E18/E19） | 2 | 4 | 6 |
| 标准算例（TB880六例；IEC60287-1-2 §8.2/§8.3） | 6 | 2 | 8 |
| COMSOL教程（02/03/04/06） | 4 | 0 | 4 |
| 合计 | 12 | 6 | 18 |

另有scikit-fem官方教学基准B01和完整几何验证C01各1项，单列，不凑入18项物理来源或12项完成数。自建Bessel/平板Fourier和变温表回归不计来源。**12项完成由2篇论文、6个标准案例、4个COMSOL教程组成，不是12篇论文。** 标准代数/热路算例无有限元网格，标为“不适用”，保存残差和完整迭代；所有有结果的有限元来源保留真实网格序列。

新增标准案例为TB880 Case1、2、4，均由原始SI几何和材料推导Rc、Rs、λ、T1–T4；Case1的三叶形/平排两个分支只计一个来源。额定电流分别为Case1三叶形990.540145055A、平排1460.454541754A、Case2海缆838.339973934A、Case4铜丝屏蔽537.463109937A。实现及出版物约定见[IEC插件参考链](IEC60287_SINGLE_CORE.md#tb880-原始参数参考链)，宿主执行和摘要在`.data/tb880/complete-references/`。

IEC60287-1-2 §8.3位置2另由GetDP独立场解计算，主分支λ₁″=1.138092118，对标准精算1.146115090差−0.700015%、对印刷1.151差−1.121449%。外域半宽32m，网格/外域末次变化0.0000872%/0.0237100%。Rs和打印电阻率不相容，两个分支分别保留；完整输入、运行ID/版本/摘要及差异说明追加在`.data/iec60287/README.md`。该场解不证明印刷勘误，两个标准例题仍保留原先不通过项与原容差。

E19为Jabłoński等2019，DOI10.3390/en12183584：PDF9给出R=1mm、d=2.5mm、55MS/m、40kHz；PDF12 Table1六个表面点，三种电流组合。GetDP二阶4105/6832/14106节点，三组全部满足预设归一化J绝对容差0.025、相位1°。对论文FEMM列最大幅值相对偏差0.653%、相位偏差0.923°；对独立COMSOL最大幅值差0.0304%、相位差0.0159°。原文提出方法列也保存在夹具，未替换FEMM验证列。源几何的有限外边界以及局部/外部网格约定都随输入保存。

Karahan2009重新读到300mm²三缆、层厚/间距和目标电流，但铜σ(T)与顶面恒温/换热边界仍不闭合；de León2008作者版本再次确认几何缺口，未找到可靠补全版本；Meng2019导体Thickness的几何含义及边界不全；Piwonski2023要求螺旋H–φ能力且正文电阻率单位可疑。它们均未计入有结果数量。IEC60853-2 AMD1预览虽有F3/F6修正值，仍缺完整RC输入。

优先复核了`D:/work/项目综合/载流量文献资料/`现有全文：Henke2020缺所引VDI完整空气物性表，且热源符号存在未取得勘误的疑点；Riba2022材料k/cp只有曲线，不能把近似读图及缺失质量/温变口径冒充完整输入；另查陈民铀2010与徐振宇2026全文，热源/电导率/接触边界仍有缺项。E05仍缺作者73样本时间点，E18原FEMM外域未公开。这些缺口未用反向调参消除，未升级为完整复现。

之前7份资料的Zotero状态已改为“已加入”。新取得/复核正文在受控文献库、Zotero CableSimPro和`.data/`各留一份，名称、日期、来源、摘要与用途在受控资料登记及`.data/simulation/source-registration.json`中；原文不入Git。

### 12.4 复现库页面与重放

一级“库”入口为`#/library/reproductions`，详情按结果、网格、输入来源和覆盖限制分页。数据来自有SHA校验的不可变本地快照，切换历史不会覆盖当前结果；论文原文、标准印刷值、教程约值和COMSOL重新计算分别显示。没有证据时不生成数字或曲线。Ctrl+S导出当前已保存对照JSON，Ctrl+Z撤销筛选，Enter检索/打开，Esc取消检索或返回；空、加载、网络错误/恢复、成功及历史均有浏览器场景。

导入器保存按内容摘要命名的原始报告副本；同输入三方对照优先采用已核验的`three-way.json`，不按同名测点跨外域拼接。相位只显示度数差、温度只显示K差，不将它们混入幅值百分比汇总。C04主表使用128段几何记录，h扫描和圆周离散分开。E05/E17/E18的历史P2直接调用记录缺宿主插件清单版本，界面明示这一追溯限制，不补造旧版本号。

本次先生成`conclusion-first.png`和`chart-first.png`两张概念图，保存在`.data/simulation/reproduction-concepts/`；选择前者，在现有独立详情页顶部放结论，保留整行对照表宽度。实现了中文短名、三位小数（极小/极大数保留三位小数尾数的科学计数法）、单位换算和原SI值提示、状态总览快速筛选、原文/开源/COMSOL系列开关与叠加图。仅连线保存样本，不拟合或补造缺值。样式沿用tokens、正文≥13px。

浏览器脚本为`tests/browser/reproduction-library.js`、`reproduction-library-states.js`、`reproduction-library-comparison.js`，通过BrowserOS neo的run执行；使用真实CDP键鼠和实际Blob导出，状态脚本只注入网络/空数据，不模拟数值。1366×768和1920×1080分别核对交互、键盘、空/加载/错误/恢复/成功/历史及新增叠加控制。

```powershell
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_loss_table.py
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_loss_table.py --consume-only
.\.venv\Scripts\python.exe plugins/cablesim.simulation/src/cablesim_simulation/external_replay.py plugins/cablesim.simulation/src/cases/eddy-two-round.json --solver getdp --output .data/simulation/eddy-two-round
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_two_round.py
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/export_full_fields.py --mode 02 --levels 7 5 3
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/export_full_fields.py --mode 06 --levels 7 5 3
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_full_fields.py --mode 02 --levels 7 5 3 --host
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_full_fields.py --mode 06 --levels 7 5 3 --host
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_double_flat.py --resume
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_submarine_capacitance.py
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/export_tutorial_definition.py --mode 06
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_submarine_inductive.py --levels 7 5 3
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_submarine_inductive.py
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_submarine_inductive.py --branch series
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/compare_submarine_losses.py
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_submarine.py --sizes 0.003 --segments 64
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_submarine.py --sizes 0.002 0.0013 --segments 96
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/replay_submarine.py --sizes 0.001 --segments 128
.\.venv\Scripts\python.exe plugins/cablesim.comsol-bridge/tests/compare_submarine.py --levels 7 5 3
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/compare_submarine_geometry.py
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/compare_submarine_coupling.py
.\.venv\Scripts\python.exe plugins/cablesim.iec60287/tests/replay_tb880_reference.py
.\.venv\Scripts\python.exe plugins/cablesim.simulation/tests/build_reproduction_library.py
```

COMSOL命令串行执行且不与全量pytest重叠。`--consume-only`验证保存输入及原始紧凑JSON工件摘要后只重跑IEC，不能把它当作新的GetDP生产运行。来源目录与注册表在[目标清单](SIMULATION_TARGETS.md)维护，界面只读取证据快照。

## 13. 批量仿真、自动回归与超算

当前执行策略：本机开发和轻量单元检查；真实仿真、原生回归、COMSOL及新性能测试统一提交Slurm。上节Windows重放命令仅说明历史证据生成方式，不再作为本机新计算入口。数据契约、续传、预算和CableLab映射见[批量数据集边界](../architecture/BATCH_DATASETS.md)。

### 13.1 既有12项复现的自动回归

以下按独立来源计数，参数化分支和网格不重复计数。每个测试重新计算；公开印刷值的精度、独立原生计算的误差和数值收敛分别断言，不把保存的场文件当本次计算。

| 来源 | 自动测试位置 | 核对内容 |
| --- | --- | --- |
| E17 双导体解析/公开对照 | `plugin-tests/test_reproduction_regressions.py` | 独立GetDP细网格、所有公开目标行 |
| E19 两圆导体 | 同上 | 三种电流组合、表面电流密度及相位 |
| TB880 Case 0-1 | `plugins/cablesim.iec60287/tests/test_iec60287_tb880.py` | 原始SI输入、逐项中间量及额定电流，含接地/印刷变体 |
| TB880 Case 0-2 | 同上 | 原始SI输入、中间量、电流及涡流变体 |
| TB880 Case 0-3 | `plugins/cablesim.iec60287/tests/test_iec60287_group_tb880.py` | 多缆电流、循环/涡流分量及热平衡 |
| TB880 Case 1 | `plugins/cablesim.iec60287/tests/test_tb880_wire_foil.py` | 三叶形和平排，计一个来源 |
| TB880 Case 2 | `plugins/cablesim.iec60287/tests/test_tb880_reference.py` | 海缆额定电流、导体/护套/铠装损耗 |
| TB880 Case 4 | 同上 | 铜丝屏蔽电流、分项损耗、热平衡 |
| COMSOL 02 | `plugin-tests/test_reproduction_regressions.py` | 新建六端子矩阵、0.14 μF/km印刷精度、对称/正定及浮置消元 |
| COMSOL 03 | `plugin-tests/test_simulation_capacitive.py` | 单点、两端、交叉互联三种充电模式 |
| COMSOL 04 | `plugin-tests/test_reproduction_regressions.py` | 普通、串联钢丝、Milliken三分支及公开损耗表 |
| COMSOL 06 | 同上 | 新建Gmsh、GetDP—热场双向迭代；对§12.2的独立COMSOL冻结参考值及残差 |

TB880 0-1/0-2/0-3测试使用受控目录中注明页码的数值夹具；缺夹具明确跳过，不能声称验证通过。其余数值夹具和来源随测试保存。新增平板Fourier暂态与COMSOL原生输出时间测试用于暂态接口门禁，不增加来源数量。

原生回归用`python scripts/run_plugin_tests_hpc.py`；重连用`--resume <证据目录>`，定向核对可重复传入`--test plugin-tests/<file>.py`。测试源、数值夹具和声明资产带摘要冻结，JUnit、日志、环境版本与实际核时回收到`.data/hpc/native-tests/`。

作业783008已实际通过E17/E19、02/04/06和03的15个参数化原生断言（763.20 s；因16 GiB申请按分区规则分配3核，实际2292核秒）。证据目录`248ab798-965b-42eb-92db-d884d13428c5`保留完整JUnit和日志。它覆盖表中的6个原生来源；TB880六例仍由默认代数测试核对。

### 13.2 2000样本演示

使用显式合成10 kV三回路排管截面、九根单芯电缆，对埋深、土壤热阻率、地温、负荷倍率、水平回路间距作2000点拉丁超立方采样。几何、材料和管内等效热阻均随基准输入保存，不作为厂家产品或实测数据。每个样本执行网格检查、运行温度计算和目标回路电流搜索，其他回路保持采样负荷。

数据集ID为`869b7f24-c22a-4e22-a681-53828c491820`，目录`.data/simulation/batch-demo/dataset/869b7f24-c22a-4e22-a681-53828c491820/`。已完成2000个样本：1998有效、2失败，失败率0.1%。两个失败样本在预设650 A上界内不能夹住限温根，保留失败与原始输入，未提高上界重写结果，也未混入`valid.csv`。

策略调整前本机已完成100个；超算作业782266实际重新计算全部2000个。主数据集保留100条本机历史记录并导入1900条超算记录，完整超算副本在`replicas/80a8dfbe-b52c-583d-af4e-3457d980b3c4/`。100组相同冻结输入/运行代码的后端对照全部一致，最大温度差0 K、电流差0 A；预声明容差为1e−4 K与0.05 A。结果文件包括`exports/<内容摘要>/{samples.csv,valid.csv,samples.jsonl,metadata.json}`；完整原始工件和失败记录继续保留。

Slurm782266实际31836核秒，即8.843333核时。计划预留200核时在完整终态记账后释放。下载/导出会验证输入、方法和文件哈希，后续配置修改只能创建新数据集。

### 13.3 环境与跨平台验证

超算使用Python3.11.16、numpy2.3.5、scipy1.17.0、Gmsh4.15.2、scikit-fem12.0.2、meshio5.3.5、GetDP3.5.0；Elmer为26.2源码构建，记录源码包及二进制/模块摘要，构建作业782200。原本机历史为Python3.11.8与官方Elmer26.1 Windows发行包；这些构建差异保留在工件中，不声称二进制相同。

B01、GetDP感应涡流、Elmer暂态各三档网格，共9组本机/超算对照通过保存容差，报告在`.data/simulation/hpc-verification/comparison.json`，作业782913/782914/782918。实际双进程MPI热求解作业782907与串行150节点解最大节点差6.19e−10 K，最高温318.149118 K，手算318.15 K；报告`.data/hpc/mpi-heat-verification.json`。MPI初始化成功或`-v`输出单独不作为真实求解证明。

COMSOL6.2在超算既有安装与许可证上串行运行，使用`batch -np 1`；每份工件记录完整版本、`license_source=hpc-installation`、Slurm作业号、节点和模型摘要。后续不再启动本机COMSOL。

### 13.4 性能基准

每行核对相同物理输入与网格控制的`case_sha256`，不假定两种求解器产生相同网格。每档运行一次，时间包括插件启动、建模/编译、网格、求解和工件封存，不含Slurm排队与传输；RSS为20 ms采样的进程树RSS总和（MiB），非Slurm单进程MaxRSS。COMSOL Java启动/编译开销包含在内。表中本机数据是执行策略调整前已取得的历史结果，开发机同时存在其他任务，不能据此推断通用硬件加速比。

| 工况／目标网格 | 本机开源 s / MiB | 超算开源 s / MiB | 超算COMSOL s / MiB | 开源—COMSOL绝对差 |
| --- | ---: | ---: | ---: | ---: |
| 单回直埋 4 mm | 16.66 / 147.7 | 3.56 / 155.6 | 68.42 / 1106.3 | 最热点0.308812 K |
| 单回直埋 2 mm | 13.51 / 149.3 | 3.52 / 158.3 | 50.82 / 1153.4 | 0.304784 K |
| 单回直埋 1 mm | 14.40 / 150.1 | 4.39 / 168.4 | 50.74 / 1152.2 | 0.280427 K |
| 三回路排管 4 mm | 36.65 / 166.8 | 11.89 / 202.9 | 61.79 / 1278.3 | 最热点0.256104 K |
| 三回路排管 3 mm | 26.34 / 183.3 | 11.62 / 231.9 | 63.75 / 1377.7 | 0.257168 K |
| 三回路排管 2 mm | 33.78 / 246.5 | 20.26 / 306.6 | 68.91 / 1317.9 | 0.239347 K |
| 护套涡流 2 mm | 19.80 / 325.1 | 9.28 / 348.3 | 73.90 / 1213.2 | 区域焦耳损耗最大差0.325894 W/m |
| 护套涡流 1 mm | 21.72 / 452.8 | 14.09 / 496.1 | 57.81 / 1331.4 | 0.080963 W/m |
| 护套涡流 0.5 mm | 39.73 / 801.9 | 28.74 / 882.6 | 62.27 / 1591.1 | 0.022014 W/m |
| 阶跃暂态 2 mm | 16.06 / 143.6 | 4.50 / 145.2 | 54.08 / 1140.1 | 末时刻最热点0.015265 K；测点0.215237 K |
| 阶跃暂态 1 mm | 14.34 / 144.1 | 4.85 / 144.6 | 53.56 / 1169.7 | 0.001030 K；0.059002 K |
| 阶跃暂态 0.5 mm | 25.25 / 146.8 | 8.15 / 150.1 | 56.86 / 1169.3 | 0.000374 K；0.003733 K |

直埋与排管性能案例为各导体固定10 W/m，区别于§13.2的非线性载流量数据集。开源热为P1，COMSOL为原生曲边P2；外域和圆周离散也影响误差。两组稳态最细网格仍有0.24–0.28 K差异，此表为测量记录，未将它们判为0.1 K工程精度门禁通过。暂态两端均按保存的时间积分设置运行并核验实际输出时间。完整值、网格与原始求解器证据在`.data/simulation/performance/solvers/`；入口`plugins/cablesim.simulation/tests/benchmark_solvers.py slurm|comsol`。

100样本吞吐使用同一固定采样子集；每样本内部串行，进程数只控制样本并行。

| 后端 | 总耗时 s | 有效 / 100 | 内存证据 | 备注 |
| --- | ---: | ---: | ---: | --- |
| 本机1进程（历史） | 2705.47 | 100 | 449.4 MiB，整组进程树峰值 | 0.037有效样本/s |
| 本机4进程（历史） | 697.21 | 100 | 1613.6 MiB，整组峰值 | 0.143有效样本/s |
| 本机8进程（历史） | 447.97 | 100 | 3192.4 MiB，整组峰值 | 0.223有效样本/s |
| 本机16进程（历史） | 303.15 | 78 | 4413.5 MiB，整组峰值 | 22例Windows内存分配失败，不作为100有效样本加速成绩 |
| Slurm8任务数组 | 264.00 | 100 | 691.4 MiB，单任务峰值 | 含传输/排队/回收323.95 s；实际0.554444核时 |

Slurm吞吐作业782924；264 s为最慢数组任务分配时长，并非端到端耗时。数组各任务RSS未同步相加，不与本机整组峰值直接比较。入口`benchmark_hpc_batches.py`及历史`benchmark_batches.py`，数据在`.data/simulation/performance/throughput/`。所有失败保留，不用删失败样本或只计成功耗时美化结果。

### 13.5 批量界面验证

批量页沿用研究壳层，包含参数空间、样本结果和执行记录；范围校验定位字段，失败只出现一次，表格保留原SI值提示，数值采用界面字体与tabular-nums。概念图为`.data/simulation/batch-concepts/parameter-space.png`和`sample-results.png`；采用前者的参数表组织方式，保留现有研究导航。

`tests/browser/batch-datasets.js`通过BrowserOS neo执行真实保存、重复提交、Slurm计算、3样本回收、ZIP导出和历史配置切换；网络错误/加载仅注入传输状态，不模拟计算结果。覆盖空、加载、错误/恢复、成功、历史，Ctrl+S/Ctrl+Z及弹窗取消；1366×768和1920×1080下批量区域最小字号13px且无横向溢出。
