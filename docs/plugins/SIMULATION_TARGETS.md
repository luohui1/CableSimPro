# 电缆仿真复现目标清单

检索日期：2026-10-03。用途：为数值仿真插件确定能力和取得数据的优先级。共 **51 个文献或官方算例条目**：18 篇热研究、15 篇电磁/耦合研究、10 项官方基准/标准、8 个 COMSOL 海缆教程。标准分册及不同教程分别登记，不按每张图重复计数。不是“已复现51篇”，也不能据此统计行业论文覆盖率。自建解析验证不计入来源数量。

实现、能力矩阵及验证证据见 [仿真方法](SIMULATION.md)，几何接口见 [仿真几何契约](../architecture/simulation-geometry.md)。可运行案例包括B01、E05解析基准及GetDP二维磁准静态FEM、E17/E18涡流FEM，以及E03/E02限定热子问题；E03还进行Elmer同网格独立校核。各自近似和未覆盖量在报告中声明。原文保存在忽略的 `.data/papers/`，不入库；仓库只保存引用、必要参数/目标及定位。

## 证据与优先级

- **A**：已读官方/作者全文或源码，定位到参数及比较目标；仍需逐条检查缺参。
- **B**：已核验出版社/作者摘要或公开正文片段；不足以冻结输入。
- **C**：官方标准/报告目录，完整数值与授权待取得。不能作为已通过算例。
- **完整性**按具体工况判定：B01及E03热子问题有冻结输入；E02明确使用名义几何和标定边界，其余缺口见条目与案例文件。不根据题名猜参数齐全。难度为本项目估计：低=线性二维导热，中=分区/瞬态/反算，高=电磁电路/非线性/CFD，极高=三维绞合及湿迁移。
- 定位采用原文图表/章节；只读 HTML 时写“无页码”，未知图表写“待原文”，不拿期刊总页码冒充具体目标所在页。

## 热传导、敷设与暂态（18 篇）

| ID / 引用 | 物理问题与几何 | 材料、边界与完整性 | 可比较目标及位置 | 能力 / 难度 / 证据 |
| --- | --- | --- | --- | --- |
| T01 Anders, Chaaban, Bedard, Ganton (1987). **New Approach to Ampacity Evaluation of Cables in Ducts Using Finite Element Technique**. IEEE TPD 2(4), 969–975. [DOI](https://doi.org/10.1109/TPWRD.1987.4308208) | 混凝土排管内 12 根电缆；非均匀热流 | 摘要确认全尺寸装置与试验；各层材料、管内空气换热及完整几何待原文 | 42 天测温序列对 FEM；实际温度点、表号/页码待原文 | 2D 导热、管内换热、试验对照；中高；B |
| T02 Yongchun Liang (2012). **Steady-state thermal analysis of power cable systems in ducts using streamline-upwind/Petrov-Galerkin finite element method**. IEEE TDEI 19(1), 283–290. [DOI](https://doi.org/10.1109/TDEI.2012.6148529) | 三缆/PVC 管与空气隙 | 导热、自然对流、辐射和实验装置已确认；物性、尺寸及孔洞边界待全文 | 温度/载流量与实验、解析法比较；目标数字、图表页码待提取 | 2D 流固热耦合、SUPG、温限反算；高；B |
| T03 Yongchun Liang (2011). **Thermal analysis of cables in tunnel using SUPG finite element method**. IEEE IAS Annual Meeting, 1–5. [DOI](https://doi.org/10.1109/IAS.2011.6074407) | 隧道内电缆与空气域 | 摘要有对流/辐射及非线性模型；通风、壁面物性未完整核验 | 温度场与载流量；图号、数值、页码待原文 | 隧道 CFD/辐射/损耗耦合；高；B |
| T04 Nahman, Tanaskovic (2002). **Determination of the current carrying capacity of cables using the finite element method**. Electric Power Systems Research 61(2), 109–117. [DOI](https://doi.org/10.1016/S0378-7796(02)00003-2) | 110 kV、3×1000 mm²、真实沟槽、混凝土/沥青及回填 | 已知工程结构、干燥与周期负荷主题；材料表、完整边界尚未取得 | 稳态与逐小时负荷温度/允许峰值电流；精确图表页码待原文 | 2D 多材料稳态/暂态、干燥模型；高；B |
| T05 Garrido, Otero, Cidrás (2003). **Theoretical model to calculate steady-state and transient ampacity and temperature in buried cables**. IEEE TPD 18(3), 667–678. [DOI](https://doi.org/10.1109/TPWRD.2002.801429) | 三缆、多层土壤；电缆柱坐标与土壤笛卡尔坐标 | 模型范围已核验；各应用工况参数待全文 | 稳态/过载温度曲线、暂态载流量；数字和定位待原文 | 2D 瞬态导热、变网格/等效网络；中；B |
| T06 Hanna, Chikhani, Salama (1993). **Thermal analysis of power cables in multi-layered soil. I. Theoretical model**. IEEE TPD 8(3), 761–771. [DOI](https://doi.org/10.1109/61.252604) | 多层土壤电缆 | 有能量守恒、网格与稳定性讨论；物性表未取得 | 分层土壤温度、网格稳定性；具体图表/页码待原文 | 2D 分区导热、界面连续；中；B |
| T07 Hanna, Chikhani, Salama (1993). **Thermal analysis of power cables in multi-layered soil. II. Practical considerations**. IEEE TPD 8(3), 772–778. [DOI](https://doi.org/10.1109/61.252605) | 沟槽/回填宽度、缆径及环境变化 | 回填热导率是关键因素；参数组合未完整核验 | 载流量随回填/沟槽尺寸变化；图表数值待原文 | 2D 稳态、参数扫描；中；B |
| T08 Hanna, Chikhani, Salama (1994). **Thermal analysis of power cables in multi-layered soil. III. Case of two cables in a trench**. IEEE TPD 9(1), 572–578. [DOI](https://doi.org/10.1109/61.277730) | 同沟槽双缆、分层介质 | 缆间距与沟槽几何待全文；不可用三相默认值替代 | 双缆载流量/缆径/沟槽宽度曲线；定位待原文 | 2D 多热源、分层、扫描；中；B |
| T09 Tarasiewicz, Kuffel, Grzybowski (1985). **Calculation of Temperature Distributions Within Cable Trench Backfill and the Surrounding Soil**. IEEE TPAS PAS-104(8), 1973–1978. [DOI](https://doi.org/10.1109/TPAS.1985.318770) | 沟槽回填与原状土温度场 | 题录/问题已核验；尺寸、k、热源和边界未完整读取 | 回填及土壤温度分布；数值/图表页码待原文 | 2D 多材料导热；中；B |
| T10 de León, Anders (2008). **Effects of Backfilling on Cable Ampacity Analyzed With the Finite Element Method**. IEEE TPD 23(2), 537–543. [DOI](https://doi.org/10.1109/TPWRD.2008.917648) · [作者单位全文](https://research.engineering.nyu.edu/power/sites/engineering.nyu.edu.power/files/uploads/Backfilling.pdf) | 直埋三组品字形、矩形回填/顶部回填 | 小/中/大回填 0.7×0.5、1.2×1.0、2×1.5 m；土壤热阻率扫描 0.5–4 K·m/W；远侧/底绝热。电缆层尺寸及损耗公式须继续从图和原公式核验 | Fig.8 相对直埋增幅 37.5%、72%、95%；Fig.13/15 宽高扫描；Fig.17 顶部回填增幅。单点工况与 PDF 页码须逐页再核，不直接把增幅通用于全部扫描点 | 2D 分区导热+电流反算；中；A（尚不可直接冻结输入） |
| T11 Anders, Radhakrishna (1988). **Power cable thermal analysis with consideration of heat and moisture transfer in the soil**. IEEE TPD 3(4), 1280–1288. [DOI](https://doi.org/10.1109/61.193921) | 埋地电缆周围热—湿迁移 | 含水率、迁移系数、土壤特征曲线未取得 | 温度/含水率场及干燥过程；图表/数值/页码待原文 | 热湿耦合 PDE、非线性物性；极高；B |
| T12 Black, Park (1983). **Emergency Ampacities of Direct Buried Three Phase Underground Cable Systems**. IEEE TPAS PAS-102(7), 2124–2132. [DOI](https://doi.org/10.1109/TPAS.1983.318200) | 直埋三相短时应急 | 必须补齐预负荷、热容量和应急时长；目前未完整核验 | 应急电流—持续时间、导体温度历程；图表页码待原文 | 瞬态热、初态/负荷史、温限反算；中高；B |
| T13 Anders, Brakelmann (1999). **Cable Crossings—Derating Considerations. I. Derivation of Derating Equations**. IEEE TPD 14(3), 709–714. [DOI](https://doi.org/10.1109/61.772304) | 电缆交叉局部热干扰 | 交叉角、深度、纵向导热参数待全文 | 降额方程与温升；图表页码待原文 | 3D 或横截面+轴向热模型；高；B |
| T14 Anders, Brakelmann (1999). **Cable Crossings—Derating Considerations. II. Example of Derivation of Derating Curves**. IEEE TPD 14(3), 715–720. [DOI](https://doi.org/10.1109/61.772305) | 交叉角/垂距变化 | 案例几何、两线路负荷待全文 | 明确以降额曲线为目标；坐标点与图表页码待原文 | 3D/有限长度线源与轴向热扩散；高；B |
| T15 Brakelmann, Sahin (1998). **Transient temperature rise of cable crossings**. European Transactions on Electrical Power 8(3), 217–220. [DOI](https://doi.org/10.1002/etep.4450080311) | 交叉电缆暂态、金属构件纵向热流 | 摘要明确考虑纵向热流；热容量与工况未完整核验 | 交叉点瞬态温升；图表/数字/页码待原文 | 3D/轴向耦合瞬态；高；B |
| T16 Purushothaman, de León, Terracciano (2014). **Calculation of cable thermal rating considering non-isothermal earth surface**. IET GTD. [DOI](https://doi.org/10.1049/iet-gtd.2013.0721) | 道路/停车区域等非等温地表边界 | 边界温度空间分布、尺度未完整核验 | 温度场与降额；图表/数字/页码待原文 | 空间变边界导热；若有限轴向热区则需3D；中高；B |
| T17 Paweł Ocłoń, Piotr Cisek, Marcelina Matysiak (2021). **Analysis of an application possibility of geopolymer materials as thermal backfill for underground power cable system**. Clean Technologies and Environmental Policy 23, 869–878. [官方全文](https://doi.org/10.1007/s10098-020-01942-8) | 400 kV 平排、回填、对称半域 x=0–5 m，深10 m | 埋深2 m，1200 A，土壤k=1，回填k=0.8/1.4，环境30°C，地表h=5；芯/绝缘/外层k=400/0.285/0.57。部分几何从等效面积多项式推导。HTML Eq.(6)/(7)/(11)/(12) 的电阻/集肤表达有量纲或排版疑点，未核对PDF前不可照抄运行 | Fig.6d：地聚物k=1.4且1400 mm²时芯温<90°C；砂水泥同面积>90°C，需1600 mm²。HTML “UPCS physical model”“Results and discussion”，无页码；具体曲线值待数字化 | 2D 回填+温变电阻/损耗；中高；A，有待澄清公式 |
| T18 Hwang, Chang, Chen (2000). **Calculation of ampacities for cables in trays using finite elements**. Electric Power Systems Research 54(2), 75–81. [出版社](https://www.sciencedirect.com/science/article/abs/pii/S0378779699000723) · [DOI](https://doi.org/10.1016/S0378-7796(99)00072-3) | 桥架宽0.6096 m、填深0.0762 m；开口/加盖；四种XLP铜缆 | 2D无限长均质缆束、对流/辐射；填充等效k、发射率和热源完整性待原文 | Fig.4 ampacity，Fig.5–6 填深降额曲线；绝对电流/页码待提取，不使用未核单位的拟合式 | 2D 非线性热边界/均质化；中高；B |

## 电磁、护套、铠装与多物理场（15 篇）

| ID / 引用 | 问题与几何 | 材料与参数完整性 | 比较目标与定位 | 能力 / 难度 / 证据 |
| --- | --- | --- | --- | --- |
| E01 Ahmadi, Khan, Grattan (2025). **Impact of Twisting on Skin and Proximity Losses in Segmented Underground Cables: A 3D Finite-Element Study**. Applied Sciences 15, 2814. [DOI](https://doi.org/10.3390/app15052814) · [作者PDF](https://openaccess.city.ac.uk/id/eprint/34847/1/113.pdf) | 五分割导体，绞距0.1–5 m，0–50 Hz | 频率/绞距及研究范围已核验；股间接触/绝缘、电导率和精确截面需逐表提取 | 摘要给50 Hz的Rac/Rdc约1.32→1.72；具体图号/PDF页码待核，先作范围目标 | 3D 谐波涡流、螺旋周期边界；极高；B |
| E02 Cywiński, Chwastek (2021). **A Multiphysics Analysis of Coupled Electromagnetic-Thermal Phenomena in Cable Lines**. Energies 14, 2008. [全文](https://www.mdpi.com/1996-1073/14/7/2008) | 空气中并联单芯YAKXS铝缆；六缆平铺 | §2/3 给1×240 mm²试件1.384 m、176.75 μΩ、608 A，铝σ=34.8 MS/m、α=.0041；自然对流参数有实验标定，接触电阻和几何仍需逐表固定 | §3/Fig.10：实验稳态芯79.0°C、绝缘69.8°C、下/上表面62.0/67.1°C，环境22.1–24.1°C；六缆迭代温度需另绑其工况，不能混用单缆测试。HTML无页码 | 电路+电磁损耗+热迭代、对流辐射；高；A |
| E03 Jörgens, Clemens (2021). **Electric Field and Temperature Simulations of High-Voltage Direct Current Cables Considering the Soil Environment**. Energies 14, 4910. [全文](https://www.mdpi.com/1996-1073/14/16/4910) | 埋地HVDC单缆/双缆，温度影响绝缘电场 | 环境20°C、土壤k=0.47/2.1；完整电导率温场依赖和几何需逐表录入 | 地表温度约24.2–26.7°C、绝缘温差约12–29 K的工况曲线；图表号/页码待复核，不作为冻结点值 | DC电场/电荷输运+瞬态热耦合；极高；B |
| E04 Plumed, Lope, Carretero, Acero (2020). **A recursive methodology for modelling multi-stranded wires with multilevel helix structure**. Applied Mathematical Modelling. [DOI](https://doi.org/10.1016/j.apm.2020.02.020) · [机构全文](https://zaguan.unizar.es/record/89963) | 32股、0.2 mm、2×4×4与4×4×2多级Litz绞线 | 几何主题及结构已核验；铜属性、端部激励/接触需全文冻结 | AC损耗/均流及2D–3D对比；数值图表页码待提取。高频绕组导线是补充验证，不算高压电缆敷设覆盖 | 3D 高频涡流、跨尺度均质化；极高；B |
| E05 Luncă, Vornicu, Sălceanu (2023). **Numerical and Analytical Analysis of the Low-Frequency Magnetic Fields Generated by Three-Phase Underground Power Cables with Solid Bonding**. Applied Sciences 13, 6328. [全文](https://www.mdpi.com/2076-3417/13/10/6328) | 12/20kV平排/品字形、两端接地、50Hz | Table1/§3.1给金属σ、温度修正、层径；20m方域、土壤σ=.01S/m；护套25mm²及平均半径14.8mm。GetDP平排输入已冻结，有限A=0替代Balloon并做外域检查 | Table3护套64.129/44.704/61.347A；§5.1地上1m中心3.876μT。原文73瞬时样本RMS与精确相量RMS有统计差别；原始curl(A)及分布J积分场均保存。HTML无页码 | 2D磁准静态FEM+网络；独立运行、三档网格及IEC系数对照；高；A |
| E06 Bompou, Mijatović, Træholt, Willén, Thidemann (2018). **Loss in Steel Armour Wires for Submarine Power Cables**. IEEE PESGM. [DOI](https://doi.org/10.1109/PESGM.2018.8586209) · [DTU](https://orbit.dtu.dk/en/publications/loss-in-steel-armour-wires-for-submarine-power-cables/) | 钢铠装丝直径6/7/10 mm，温度30/60/90°C，纵向交变磁通 | 实测B-H、磁滞与涡流；实际曲线/材料牌号待全文 | 损耗—磁通/温度曲线；具体W/m值与页码未取得 | 非线性磁性、磁滞/涡流分解；高；B |
| E07 Giussani, Di Rienzo, Bechis, de Falco (2020在线). **Computation of Armor Losses in AC Submarine Cables**. IEEE TPD. [DOI](https://doi.org/10.1109/TPWRD.2020.3031735) | 三芯AC海缆、同向/反向铠装绞合 | 3D积分方法与丝离散；几何、σ/μ及具体激励未完整提取 | 铠装损耗和计算规模；W/m曲线/图表页码待原文 | 3D磁准静态、周期螺旋、积分方程或FEM；极高；B |
| E08 Giussani, Di Rienzo, Bechis, de Falco (2021在线). **Fully Coupled Computation of Losses in Metallic Sheaths and Armor of AC Submarine Cables**. IEEE TPD. [DOI](https://doi.org/10.1109/TPWRD.2021.3137661) · [机构记录](https://re.public.polimi.it/handle/11311/1193825) | 三芯海缆金属护套—铠装互感 | 参数化几何/材料；需取得后印本表格和激励 | 护套/铠装损耗、参数扫描；数字与位置待原文 | 3D场路耦合与周期对称；极高；B |
| E09 Osmani, Schulz (2024). **Modeling Magnetic Fields around Stranded Electrical Transmission Lines via Finite Element Analysis (FEA)**. Energies 17, 801. [全文](https://www.mdpi.com/1996-1073/17/4/801) | 7/19/37/61/91股绞线，铝/钢复合 | 开放正文；具体电流、坐标及材料表待逐项转录 | Fig.12–17磁场分布/电流对比；点值待提取，HTML无页码。架空绞线是磁场补充基准，不代表电缆载流量覆盖 | 3D磁场、绞线几何；高；B |
| E10 Gu, Zhang, Han, Li, Liu, Li, Zhao (2022). **Cable Loading in Tunnels Based on Efficient Multi-physics Simulation Method**. IEEE ICHVE. [DOI](https://doi.org/10.1109/ICHVE53725.2022.9961768) | 200 m隧道、24根HV电缆、波纹护套 | 入口温度/湍流、壁面与完整电缆参数待原文 | 摘要：距壁增加0.3 m温度降约3 K，风速<3 m/s影响更显著；点值工况/图表页码待原文 | 3D共轭传热、通风、电热；极高；B |
| E11 Zhou, Lin, Niu, Fu, Liu (2020). **Electro-Thermal-Fluid Coupling Analysis of Ultra-High Voltage Cable Tunnel**. IEEE SCEMS. [DOI](https://doi.org/10.1109/SCEMS48876.2020.9352415) | 超高压隧道、多回路、电流/通风变化 | 几何、风速和入口/壁面参数未完整取得 | 出口/入口空气温度、导体温度与通风曲线；没有冻结数字，图表页码待原文 | 3D电热流、辐射；极高；B |
| E12 Rachek, Nait Larbi (2008). **Magnetic Eddy-Current and Thermal Coupled Models for the Finite-Element Behavior Analysis of Underground Power Cables**. IEEE Transactions on Magnetics. [DOI](https://doi.org/10.1109/TMAG.2008.2004212) | 地下电缆涡流—热场耦合 | 题录和方法已确认；几何、材料、边界需全文 | 电流密度、损耗、温度；图表数字与页码待原文 | 谐波涡流+温度依赖材料迭代；高；B |
| E13 Noufal, Anders (2020). **Sheath Loss Factor for Cross-Bonded Cable Systems With Unknown Minor Section Lengths—Field Verification of the IEC Standard**. IEEE TPD 35(6), 2722–2730. [DOI](https://doi.org/10.1109/TPWRD.2020.2972732) · [IEEE记录](https://ieeexplore.ieee.org/document/8989822) | 132/220 kV交叉互联；已知/未知及不规则小段长度 | 原始DOI及摘要已核实；未取得该文正文的护套实测表/完整材料和接地参数 | 实测护套感应电压/电流、损耗因子及载流量比较；具体表号和页码待原文；不得混入2021配套论文数字 | 场—电路、小段长度与换位；高；B |
| E17 Jabłoński, Kusiak, Szczegielniak (2020). **Analytical-Numerical Approach to the Skin and Proximity Effect in Lines with Round Parallel Wires**. Energies13,6716. [全文](https://www.mdpi.com/1996-1073/13/24/6716) | 无限长双圆导体，反向RMS电流 | Table1 c=1：R10mm、d40mm、σ36.9MS/m、60Hz；线性单位电流归一化，外域另扫 | Table1线对FEM电阻177μΩ/m；GetDP三档网格及域扫描，HTML无页码 | 2D集肤/邻近损耗；中；A，输入完整 |
| E18 Szczegielniak, Jabłoński, Kusiak, Piątek (2019). **Eddy Currents Induced in Two Parallel Round Conductors**. ACES Journal34(12). [全文PDF](https://journals.riverpublishers.com/index.php/ACES/article/download/8089/6643/27797) | 有源圆导体对无净电流圆导体的诱导涡流 | R10mm、d30mm、σ55MS/m、200Hz、源1kA；被动导体零净电流；Fig2坐标和Table1已视觉核对 | PDF5/印刷1926，Table1被动导体θ=0/π2/π的FEM J=3714/650/2321kA/m²；不能与源导体总J混用 | 2D分布涡流与材料侧测点；中；A，输入完整 |

## 官方算例与标准依据（10 项）

| ID / 引用 | 问题与几何 | 完整性 / 可取得性 | 比较目标与位置 | 能力 / 难度 / 证据 |
| --- | --- | --- | --- | --- |
| B01 scikit-fem 12.0.2. **Example 17: Insulated wire**. [官方源码](https://github.com/kinnala/scikit-fem/blob/12.0.2/docs/examples/ex17.py) | 同心圆芯a=2、外径半径b=3；均匀热源、外表Robin | **完整**：k0=101、k1=11、A=5、h=7；温升问题。此为数学教学尺寸，非厂家电缆 | 源码参数段及 `T0['exact']`；无PDF页码。由执行式独立求得中心温升0.894300070420 K；本项目已实跑，详见设计文档 | 2D稳态多材料导热/对流边界；低；A |
| B02 CIGRE WG B1.56 (2022). **TB 880: Power cable rating examples for calculation tool verification**. [官方目录](https://www.e-cigre.org/publications/detail/880-power-cable-rating-examples-for-calculation-tool-verification.html) | 11组case studies、多种电缆与敷设；331页 | 已定位用户提供的本地331页扫描PDF并核对目录；现有IEC受控对拍由研究线程维护，未作为本插件新增运行 | I、Rac、λ、热阻；目录PDF6–8主要为稳态例题，不能当作IEC60853瞬态输入 | 稳态标准损耗/热阻；中高；B，尚未在本插件冻结完整标准工况 |
| B03 CIGRE WG B1.35 (2015). **TB 640: A guide for rating calculations of insulated cables**. [官方目录](https://www.e-cigre.org/publications/detail/640-a-guide-for-rating-calculations-of-insulated-cables.html) | 电缆载流量计算指导 | 目录级；指导书不自动等于有完整公开基准，需原文确定章节与算例 | 可比中间量/案例待授权原文选定；暂无数值夹具 | 方法选择与边界核验；中高；C |
| B04 IEC (2023). **IEC 60287-1-1: Electric cables—Calculation of the current rating—Current rating equations and calculation of losses—General**. [IEC](https://webstore.iec.ch/en/publication/68118) | 稳态载流量与损耗，适用范围按分支明确 | 官方范围，非本轮全文；参数/条款由研究线程受控资料维护 | I、ys/yp、护套/铠装损耗；具体算例从B02绑定，不伪造IEC出版算例数值 | 电气损耗/稳态反算；中；C |
| B05 IEC (2023). **IEC 60287-2-1: Thermal resistance—Calculation of thermal resistance**. [IEC](https://webstore.iec.ch/en/publication/68134) | 埋地、排管、空气等热阻 | 官方目录；具体表格/工况须授权原文 | T1–T4及边界处理；条款页码未转录，暂无独立数字目标 | 热阻、排管/空气换热；中；C |
| B06 IEC (1985). **IEC 60853-1: Calculation of the cyclic and emergency current rating of cables—Cyclic rating factor for cables up to and including 18/30 (36) kV**. [IEC](https://webstore.iec.ch/en/publication/3709) | ≤18/30(36) kV周期负荷 | 官方目录；原始负荷谱、修订单及示例待核验 | 周期系数/峰值温度；图表/页码/数字待原文 | 暂态热、负荷历史与周期初态；中；C |
| B07 IEC (1989). **IEC 60853-2: Cyclic rating of cables greater than 18/30 (36) kV and emergency ratings for cables of all voltages**. [IEC](https://webstore.iec.ch/en/publication/3711) | HV周期、全电压应急 | 官方目录；F2的公开重现见B09，不将其等同已取得标准全文 | 温升—时间、应急载流量；原文页码待授权核对 | 热容量/时步/初始负荷/反算；中高；C |
| B08 IEC (2002). **IEC 60853-3: Cyclic rating factor for cables of all voltages, with partial drying of the soil**. [IEC](https://webstore.iec.ch/en/publication/3712) | 全电压周期、部分土壤干燥 | 官方目录；湿/干参数、临界温升和计算示例待原文 | 周期系数、干燥区影响；数值/图表页码待原文 | 非线性暂态/干湿区；高；C |
| B09 QuickField. **Cable transients**（IEC 60853-2 F2重现）. [官方页面](https://quickfield.com/advanced/cable_transients.htm) | 400kV、50Hz、0→1580A持续24h | 官方原始模型包已下载到.data/papers/thermal-b/cable_transients.zip；mod/dht/res为专有数据库，尚未导出完整层径、边界和温度曲线。页面等效直径/半径及介损单位仍须核对 | 页面初态约28°C、导体36.5W/m、护套2.1W/m；12.1W/km介损不能未经模型确认直接转录；网页无页码 | 暂态热与预负荷；中；B，原始数据包可用但未冻结 |
| B10 QuickField. **Power cable parameters calculation**. [官方算例](https://quickfield.com/advanced/cable.htm) | 四芯：三扇形相导体120 mm²、圆中性线35 mm²，钢带、绝缘、外径42.8 mm | 有材料和层厚，但扇形完整坐标、填充物性与外部h/辐射条件缺口；环境20°C已给出 | “Conductors average temperature”表45.9/46.8/45.9/39.3°C；相损耗4.71/4.74/4.71 W/m。网页表格，无页码；不能据此反拟h后称独立复现 | 2D电磁→热、扇形网格；高；A，尚缺输入 |

## COMSOL 6.2 海缆教程（8 项）

来源为本机 `E:/comsol/COMSOL62/Multiphysics/applications/ACDC_Module/Tutorials,_Cables/` 的参数文本及对应官方 PDF。PDF 位于安装目录 `doc/help/wtpwebapps/ROOT/doc/com.comsol.help.models.acdc.submarine_cable_XX_名称/`。只登记必要数字与出处，不将 MPH、库、许可证或教程全文提交仓库。桥接实测版本为 **6.2.0.290**。

共享参数取自 `a_geom_parameters.txt`、`b_geom_parameters.txt`、`c_elec_parameters.txt`（均带 `submarine_cable_` 前缀）：Dcon=26.2 mm，Tins=24 mm，Dins=77.6 mm，铅/PE各2.9 mm，Dcab=219 mm，铠装110根、直径5.6 mm；Acon=500 mm²，Lcab=10 km；50 Hz，I0=655√2 A峰值，V0=220/√3 kV峰值；Cu/Pb/armor电导率59.6/4.55/4.03 MS/m，铠装μr=100−50j。Ncon=Acon/(π(Dcon/2)²) 修正导体等效电导率，不能直接使用实心铜截面。

| ID / 教程 | 原文参数与定位 | 参考目标 | 开源复现与缺项 |
| --- | --- | --- | --- |
| C01 `01_introduction` | PDF29材料表、31–56几何；三相圆心(-Dpha/(2√3),±Dpha/2)、(Dpha/√3,0)，磁域R=5Dcab/2；外热域10×8 m | 几何/材料/网格模板，本身无独立求解结果 | 已重建用于04的三芯、SCC、铅、钢光纤套及110根铠装磁域；将同μ、可忽略漏导的聚合物合并，仅为电磁等价子域，不宣称已重建全部热几何与接触面 |
| C02 `02_capacitive_effects` | PDF10–11；εXLPE=2.5，σXLPE=1e−18 S/m，σSCC=2 S/m；c参数Cpha/Icpha表达式 | 约0.14 μF/km、5.5 A/km，10 km端部电压变化 | **未覆盖完整场解**：当前公共问题/适配器尚无频域电流连续方程、复介电参数与电容/端子输出 |
| C03 `03_bonding_capacitive` | PDF2–7；轴对称10 km，三段各1/3，单点/两端/交叉互联 | PDF7：55 A/83 V/1.5 kW；28 A/21 V/0.38 kW；10.7 A/6.9 V/85 W | **未覆盖**：轴对称带2πr权重的电流场、终端及区段互联；不能拿二维横截面电磁结果代替 |
| C04 `04_inductive_effects` | PDF6–10、16–18；a/b/c参数；普通2D、铠装串联2.5D、Milliken三种模型分开 | Table1：普通2D损耗47/13/7.6 W/m；2.5D为47/15/0.36；Milliken为43/16/0.37 | **普通2D与串联2.5D已实跑对照**，数值见SIMULATION §10；包含复磁导率磁损。Milliken均质多匝尚未覆盖；未据此宣称真实3D绞合 |
| C05 `05_bonding_inductive` | PDF2–8，三个磁场区段+电路；显式固接/单点/交叉互联 | 单点屏蔽约2.9 W/m、Rac45 mΩ/km、屏蔽473 V；交叉区段158 V | **未覆盖完整教程**：目前只有单截面理想串/并联约束，尚无分段长度、电压未知量和跨段换位联立 |
| C06 `06_thermal_effects` | PDF4–7；d参数：导体/铅/铠装预设89.4/82.7/70.1°C，外界20°C，αCu/Pb/armor=.0039/.00386/.0053 K⁻¹；20μm空气接触层 | Table1：单向81°C；线性电阻92°C；全耦合90/83/70°C，损耗58/11/6.8 W/m | **未覆盖完整教程**：需真实聚合物/空气域和接触面、温变σ与损耗—温度闭环。已验证的恒物性稳态热桥接不能代替此耦合算例 |
| C07 `07_geometry_mesh_3d` | PDF2–14；f参数LLpha=18Dpha3、LLarm=−15Darm、Nper=1/10或1 | 无物理方程；目标是扭绞几何与扫掠/映射网格 | **未覆盖**：三维周期切片、共形面映射、扫掠网格、曲面面积校正；不是缺一个损耗公式 |
| C08 `08_inductive_effects_3d` | PDF17、20、22–24；相电流655√2 A，绝缘稳定化σ=50 S/m；忽略电容 | Table2三维损耗48/17.5/2.8 W/m、Rac53 mΩ/km、L0.44 mH/km | **未覆盖**：3D矢量A、线圈几何分析、twisted/short-twisted周期映射、横向涡流和稳定化补偿，不能用2.5D数值冒充 |

本轮只完成 C04 两个模型及 C01 所需电磁几何。C02/03/05/06/07/08 没有开源偏差数值，明确计为未覆盖；八项登记不等于八项完成。

## 接地方式取数注意事项

E13为交叉互联优先候选。检索过程中发现公开镜像中的一份PDF实际对应 [2021年配套论文，DOI 10.1049/gtd2.12063](https://doi.org/10.1049/gtd2.12063)，不能将其表9/10的计算数字冒充2020年IEEE论文的现场测量。单点接地优先沿用研究线程的TB880受控分支；两端接地从E05推进。完成各种接地方式的仿真需要场—电路耦合及每小段长度/换位/接地阻抗，不能只调整一个经验λ值。

## 覆盖与下一步取数

| 所需覆盖 | 目标来源 | 未解决的数据门槛 |
| --- | --- | --- |
| 直埋/排管/分层/回填 | T01/02/04–10/17，B02 | 逐域几何与k、损耗分配、边界和标准中间量 |
| 隧道/空气/桥架 | T03/18，E02/10/11，B10 | 自然/强制对流区别、h或空气PDE、辐射视角因子 |
| 交叉/局部热瓶颈 | T13–16 | 轴向有限长度、交叉角、纵向传热；2D截面不足 |
| 干燥/湿迁移 | T04/11，B08 | 湿/干k与临界温度不同于真实湿迁移；需独立数据 |
| 阶跃/周期/应急 | T05/12/15，B06–09 | ρcp、负荷全历史、初态及时间步误差 |
| 集肤/邻近/绞合/铠装 | E01/04/06–09/12，B04 | 电导率、股间接触、B-H/损耗、绞距、周期边界 |
| 单点/两端/交叉互联 | B02/04、E05/13 | 原始护套电流/损耗表、接地电路；交叉互联证据需补齐 |

优先采用有完整材料、几何、激励、初态和边界的公开工况。E05/E17/E18可直接重放；T10/T17/T04的缺项保留，不能反拟参数。B09需先从作者原始模型导出并核实输入，IEC60853需完整原文/受控夹具。覆盖统计以实际跑通且边界明确的工况与物理类别为准，不以题录数量替代。
