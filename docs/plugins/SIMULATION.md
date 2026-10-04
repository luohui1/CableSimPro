# 数值仿真与论文复现

cablesim.simulation 是宿主 API 2.1 的方法插件。算法位于插件，宿主负责固定输入、执行、输出校验和封存。入口遵守 cablesim.run/2，通过现有 backend.plugin_host.Executor 运行。论文来源见[复现目标清单](SIMULATION_TARGETS.md)，几何边界见[分析几何接口](../architecture/simulation-geometry.md)。

## 1. 方法与范围

| 能力ID | 输入与输出 | 适用范围 |
| --- | --- | --- |
| multiregion-thermal | 领域文档或显式热模型 → 温度场、温限电流、复现报告 | 1–64根有正间隙同心圆单芯、回填/土层/每缆一管、常热物性 |
| getdp-eddy | 领域文档或统一问题 → GetDP独立进程 → 复数场、损耗、电流与报告 | 2D磁准静态、集肤/邻近、理想互联护套；外部GetDP3.5.0 |
| elmer-heat | 固定热模型或统一问题 → Elmer独立进程 → 温度场/时间序列与报告 | 常物性稳态/瞬态、固定/阶跃热源、均匀初态；外部Elmer26.1 |
| insulated-wire | 完整双层圆柱参数 → FEM与解析误差 | B01官方数学基准，不是厂家电缆 |
| solid-bonding-flat | 显式护套回路参数 → 电流与RMS磁场 | E05平排理想两端互联解析子模型，不是电磁FEM |

多区域方法支持不同电缆层数、固定每米热源、导体温变电阻、指定芯温、地表恒温或给定h、侧底分别恒温/绝热/对流，以及孤立空气电缆的表面换热。回填为矩形区域，土层由水平界面划分。所有电缆沿轴向无限长。

不支持点接触/接触热阻、偏心或非圆截面、多芯内部几何、真实管内流体、土壤干燥/湿迁移、暂态与三维交叉热瓶颈。辐射仅为对给定环境的局部灰体交换，不含互相遮挡/视角因子。孤立空气电缆不会通过伪空气热导率相互耦合。

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

共同输入的合成IEC对照（不是上述论文）在3 mm局部网格、12 m侧/底范围得到：直埋IEC855.263519 A、FEM859.924316 A（+0.544955%）；排管IEC785.517120 A、FEM785.140991 A（−0.047883%）。400 A运行点的三相温差，直埋为−0.131863/−0.147255/−0.129459 K，排管为−0.060290/+0.034061/−0.061532 K。模型差异见§4，不能将合成对照称为论文IEC复现。

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
| 谐波电磁与场路 | GetDP Az-u与Network | 已适配二维恒定物性、实心圆芯/同心屏蔽、理想浮置并联；交叉互联/接地阻抗/铠装绞合未实现 |
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

| 系数 | GetDP | IEC插件0.3.0 | 解释 |
| --- | --- | --- | --- |
| ys | 0.001565978 | 0.001568838 | 孤立实心芯集肤控制试验 |
| yp，A/B/C | 0.000062663 / 0.000250969 / 0.000062802 | 各相0.000122491 | 裸三相FEM每相邻近效应与IEC共同近似系数，不要求逐相相等 |
| λ1总，A/B/C | 0.123548902 / 0.060496462 / 0.113058019 | 0.123655452 / 0.060042541 / 0.113203854 | 当前IEC平排分支只计环流；FEM还含局部护套涡流 |
| λ1环流部分，A/B/C | 0.123396500 / 0.059930104 / 0.112920899 | 同上 | FEM以I护套²Rdc拆分；差值和涡流余量保留在报告 |

该对拍属于模型差异研究，未给人为放宽的“全部通过”判据，报告为`not_assessed`。上表绑定已成功校验并执行的IEC 0.3.0清单SHA `01755376fcf3229ea81e316e43c2ee6503dbe4c0433c4cd57ece773545ac4854`；它是该版本快照的结果，不代表后续修改中的IEC实现。重新对拍必须先通过IEC插件自身的封签校验，不能沿用数值冒充新版本验证。

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

两个插件共享 `backend/foundation/simulation.py` 的 SI 数据契约，宿主不包含求解算法。桥接支持二维谐波磁场和恒物性稳态热场，调用原生 Magnetic Fields / Heat Transfer 接口；不把求解转移到 Python。暂态、孔洞翻译、非线性热边界、三维、轴对称及电容场明确拒绝或标记未覆盖。

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

单位均为W/m（数值等于kW/km）。从64段到128段后串联铠装损耗变化0.004270 W/m，大于两求解器最终差0.001600 W/m；本轮差异可由已观察的几何离散变化覆盖。最初少边数圆域的误差较大，保留网格序列，没有只挑最终值。此处未复现Milliken均匀导体、完整电容/跨区段电路、温变电热反馈或三维扭绞；C02/03/05/06/07/08明确未覆盖。

### 10.5 IEC暂态与界面边界

IEC对拍继续标记**等待 IEC 插件封签**，未改动或替其他线程封签。IEC60853完整暂态仍缺可靠闭合资料：60853-1:1985公开9页预览无第7章例题正文，AMD2只修改部分表项；ICEST2012论文缺若干热/电参数；公开IEC60853-2 MATLAB模型缺`Cth_filler`及独立负荷—温度参考表；QuickField F2包含专有二进制几何/结果，尚未取得可靠完整文本导出。保留之前通过的解析暂态基准，但不把它改名为IEC算例。新增资料已复制到标准资料目录与`.data/`并登记SHA256；Zotero工具不可调用，附件待加入。

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
