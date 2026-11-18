# 标准依据库

`cablesim.standards-basis` 0.9.1 是离线、只读的数据插件。当前含 **316 个表或条款索引、4,406 条输出格记录**，其中4,396格已核验；GB/T12706.2表18的10格因电压轴歧义阻止resolve。本发行只修正核验状态摘要及其编制检查，未新增或改动数值记录。标准值、文献直接值、文献派生参考值分别声明语义；宿主不内置算法。表格完整保留行轴、原空白和破折号，不将缺值变成零，也不插值。两条土壤混合公式由本插件执行，全部物性与现场参数必填，无默认土壤。

资源库“标准与规则”支持完整表格、选格详情、条件检索及复制引用。格内仅显示值，量名和单位集中在标题；选中后在下方查看完整条件、页码和两路核验，并复制固定引用。方向键移动选格，Enter复制，宽表在自身区域滚动且首列固定。破折号仅显示“—”，悬停解释原表不适用；原表空白与破折号保持区别。型号要求、标准核对、规格书的引用契约兼容上一发行；这些消费者由三维线程接入。源值核验通过不等于设计或试验合格，输出始终带 `approval=not_granted`。设计负责人已在正式应用挂载通用只读路由；本线程的浏览器回归继续使用真实路由与Executor组成的隔离应用，不写演示数据库。

## 0.9.1 核验状态索引修正

GB/T12706.1表17、表18及GB/T12706.2表19在0.4.0起已有完整PDF图像双路核验记录，共220、133、250格。此前`verification.json.not_released`仍保留0.3.0的未发布说明，与同文件的`methods/cells/comparison`及已发布记录矛盾。此版将这三条旧说明移入`resolved_extraction_issues`，保留原原因与对应核验表ID；所有两路值、23个记录分册、4,406条逐记录摘要和适用条件均保持原样。这是既有证据索引的纠正，不构成一次新的原页目视核验。

IEC60287-2-1:2023 Table2按现有核验说明为28×20格。`hB/wB=3、LG/hB=3`的印刷格`3,2-`尚未确认，整表560格仍不发布；未发布摘要不再使用旧的29×20表述，也不宣称其余559格已在本轮重新核验。GB/T12706.2表18的电压轴歧义仍保留，10格继续`blocked`。

重建器检查编制与核验版本、表ID集合、未解决摘要与实际blocked表，以及未发布摘要与完整verified表之间的一致性。该门禁不读取原件、不证明转录独立性，也不将完整值矩阵提升为工程或试验合格结论。

固定消费者随发行显式更新：standard-check发行1.8.6、方法1.8.5（修复浏览器整数值浮点回传造成的查询身份与记录摘要误拒，另固定925条记录的内容摘要；原发方摘要不变）；type-electrical发行1.2.5、方法1.2.4；gb50217-correction发行1.0.7、方法1.0.0。两份消费者锁与GB校正默认依据摘要固定到0.9.1，计算和判定方法不变。旧工程、已发布资料及历史回执不迁移；再用旧选择写入或计算时继续受现有发行变化门禁约束，须重新查询、预览或确认。

## 来源、存放与版本

解析前阅读了本地库的《合法正文目录说明-2026-07-21.md》和《标准题录与数据用途.md》。原 PDF/DOCX 不入库，插件不需要访问本地标准目录、联网、数据库或求解器。仅保留结构化表值、参数、条款标题及必要的一句话条件说明，使用权限仍为 `not_assessed`，不把持有正文当成对外分发许可。

采用独立v2插件：数据可固定发行、封签、离线重放，多个消费者共用同一份证据。现行宿主没有 `data` capability kind，故以 `kind=method / analysis=standards_lookup / capability=lookup` 承载通用查询，输出数量及 `x-cablesim.standards-basis` JSON 工件。读取沿用方案(b)：现行资源下载端点只接受清单presentation中的SVG/WebP，不能直接下发JSON编制数据。通用路由按能力的 `read_only=true` 声明开放，不按插件ID判断，无需修改SDK或数据库。

目录 `plugins/cablesim.standards-basis/`：

| 文件 | 用途 |
| --- | --- |
| `plugin.json` | v2 清单、0.9.1 发行、无网络、read_only能力和逐文件封签 |
| `assets/icon.svg` | 插件图标 |
| `src/cablesim_standards_basis/excerpts.json` | 审阅后的完整矩形输出格、完整行轴、条件与公式参数，作为编制输入 |
| `verification.json` | 每格的 route_a / route_b、方法、源 SHA256、结果和已解决提取问题 |
| `basis.json` / `records-*.json` | 表索引与按标准分册的紧凑记录，由编制输入确定性生成；单文件满足卫生体积限制 |
| `integrity.json` | 数据与核验文件的 SHA256 和字节数 |
| `library.py` / `main.py` | 只读查询及现有 `cablesim.run/2` 进程适配 |
| `query.schema.json` | 查询结构与 SI 输入条件约束 |
| `rebuild.py` | 确定性重建与一致性检查；不读取标准全文 |

每条记录含 `standard/edition/clause/table/title/printed_page/pdf_page/source_file/source_sha256/conditions/quantity/value/semantic/criterion/verification`。`quantity` 含中文名、量纲、原表单位；`axes` 保存输入轴，`row/column/row_label` 保存定位。续页逐行保存准确页码，不用表的第一页代替。

`basis.json.record_files`逐个保存分册名称、SHA256和字节数，因此`data_sha256`也覆盖所有记录分册；`integrity.json`再次核对，加载时拒绝不一致。分册布局属于插件内部编制格式，消费者使用稳定的`lookup`答复，不直接读取内部文件。新增的`column_header/column_conditions/value_details`为可选展示信息；r1记录ID、查询schema、引用schema、数值单位及状态语义不变。升级发行需要显式更新发行/数据摘要，旧摘要不会自动迁移。

**消费者接入**：0.4.0保持旧记录ID与查询schema，修正出处/语义及核验状态会改变record摘要，须显式更新允许版本和摘要。本轮按授权执行`basis_catalog.py --write`，以LF锁定全部4,017条记录，standard-check机械升为1.3.2并重封签，判定逻辑未改。旧0.3.0引用固定旧快照，不自动换版；表18的新查询因歧义明确失败。

0.5.0保留以上记录身份与resolve/list契约；standard-check当前工作区发行1.5.0机械升至1.5.1，LF清单锁定全部4,080条记录，未改判定逻辑。GB50217校正插件1.0.1机械升至1.0.2，只更新依据发行默认摘要与默认依据说明；原有保存配置继续固定旧摘要，须工程师重新确认，不能静默换表。

## 0.7.0 短路依据与暂态材料边界

本发行合并已完成双路核验的115条记录，既有记录键和查询契约保持兼容；短路计算由方法插件执行，依据库只返回参数、公式和适用条件。新增分册为`records-short-circuit.json`。IEC60949英文分册仅有印刷5、7、9、11、13、15、17、19、21、23、25页（PDF1–11）；PDF12为空白，不引用为印刷27页。修订单1988/AMD1:2008仅覆盖英文印刷2–3页（PDF4–5），与基础版分开查询。名为preview的基础版本地文件实为HTML，不作数值证明，不声明已取得完整合订标准。

| 标准 / 表或条款 | 记录数 | 印刷 / PDF页 | 核验方式 |
| --- | ---: | --- | --- |
| IEC60949:1988 Table I / 3，六种载流金属的K、β、σc、ρ20 | 24 | 17 / 7 | 原页完整图像转录 / 独立盲转录 |
| Table II，20种相邻材料热阻率及体积热容 | 40 | 17 / 7 | 同上，逐行逐格完整 |
| Table III / 5.2，七种绝缘的铜/铝X、Y | 28 | 19 / 8 | 同上，保留含接触系数的简式用途 |
| 引言短路持续时间、t/S参考判据 | 2 | 7 / 2 | 两次独立原页图像核验 |
| 2；3绝热公式与K定义 | 3 | 9–11 / 3–4 | 同上 |
| 5.1、5.2、5.3.1、5.3.2 | 4 | 11–13 / 4–5 | 同上，导体/疏离丝构造条件 |
| 6.1一般非绝热公式及接触系数 | 2 | 13、15 / 5、6 | 同上，跨页定义保留 |
| 6.2、6.3.1、6.3.2、6.4、6.5截面积分支 | 5 | 15 / 6 | 同上，五种构造分别收录 |
| IEC60949:1988/AMD1:2008 Table II修订 | 4 | 3 / 5 | 修订原页图像 / 独立盲转录 |
| AMD1 §4 并联金属部件电流分配 | 1 | 2–3 / 4–5 | 同上 |
| GB/T12706.2—2020 §4.2 引用与最长温度持续时间 | 2 | 5 / 13 | 独立DOCX转录 / 原PDF图像复核 |

### 型号电气与屏蔽容量接入

铜原表行是导体材料行。方法插件可显式引用纯铜材料参数，仍须单独确认屏蔽的初温、允许终温及构造，不能伪造“铜屏蔽专用常数”或沿用导体温限。GB/T12706.2 §4.2实际引用IEC60986；该处5s限制是导体短路温度的最长持续时间。IEC60949引言适用于各短路持续时间，不能自行添加通用1–5s范围。引言t/S<0.1s/mm²的简化说明针对通常电力导体，不推广到薄铜带屏蔽。

| 量 / 记录键 | 查询条件 | 返回 / 页码 |
| --- | --- | --- |
| `short_circuit_material_k` / `sc-material-constants/r1/K` | material=copper, material_role=conductor | 226 A·s^0.5/mm²；17/7 |
| `resistance_temperature_coefficient_reciprocal_0c` / 同行`beta` | 同上 | 234.5 K；17/7 |
| `volumetric_heat_capacity_20c` / 同行`sigma_c` | 同上 | 3.45e6 J/(m³·K)；17/7 |
| `electrical_resistivity_20c` / 同行`rho20` | 同上 | 1.7241e-8 Ω·m；17/7 |
| `adiabatic_short_circuit_formula` / `sc-adiabatic-current/r1/adiabatic_short_circuit_formula` | 无 | I_AD²t=K²S²ln((θf+β)/(θi+β))；9/3 |
| `short_circuit_k_definition` / `sc-k-definition/r1/short_circuit_k_definition` | 无 | K的σc、β、ρ20定义；11/4 |
| `short_circuit_geometrical_area_formula` / `sc-helical-tape-area/r1/short_circuit_geometrical_area_formula` | screen_construction=helically_lapped_tape | S=nwδ，电流沿螺旋，不假定匝间/带间可靠接触；15/6 |
| `screen_thermal_contact_factor_rule` / `sc-screen-contact/r1/screen_thermal_contact_factor_rule` | application_case=sheath_screen_armour | 推荐0.7、一面完全粘结0.9；15/6 |

铜带屏蔽按6.3.2截面积与6.1非绝热分支；5.2及Table III的X/Y简式不能直接套用铜带。工程师输入故障电流、保护持续时间、载流部件截面和各部件初温/终温，方法插件保存这些输入与依据快照。依据库不执行本段短路公式，也不批准型号。明确手算输入为纯铜25mm²、1s、90→250℃，由原表K=226、β=234.5得到3577.09A，仅用于公式代数对拍。

真实只读路由示例；`release_digest`从`GET /api/methods`取得本发行摘要并固定保存，不使用暂存库旧摘要：

```json
{
  "release_digest": "<当前0.7.0发行摘要>",
  "input": {
    "schema_version": "cablesim.standards-query/1",
    "operation": "resolve",
    "standard": "IEC 60949",
    "edition": "1988",
    "locator": "Table I",
    "quantity": "short_circuit_material_k",
    "record_id": "sc-material-constants/r1/K",
    "conditions": {"material": "copper", "material_role": "conductor"}
  }
}
```

提交至`POST /api/plugin-queries/cablesim.standards-basis/lookup`。改量及记录键查询同行β/σc/ρ20；公式改`locator="3"`及上表公式键、条件为空。返回值带印刷/PDF页、两路核验、source_sha256与record_sha256。短路计算由下轮型号电气方法接入，沿用既有basis_ref快照契约。

### 城南暂态的四类材料

IEC60949 Table II半导电XLPE/PE与EPR分别为2.4e6、2.1e6 J/(m³·K)，记录键为`sc-adjacent-thermal/r19/sigma`及`r20/sigma`。查询`quantity=volumetric_heat_capacity`，条件分别`material=semiconducting_XLPE_PE`或`semiconducting_EPR`，另需`material_role=other_component, application_case=short_circuit_non_adiabatic`。页码17/7。它们是已核验物性参考，原标准用途是短路非绝热，未给城南配方、密度和暂态宽温域认证；改成`application_case=transient`返回`not_covered`且无记录，不给计算参数。仿真须记录材料匹配及工程师取值依据，不能由本库自动扩展适用范围。

阻水缓冲带：Zhang等2024公开论文Table1（PDF3）的600kg/m³×2000J/(kg·K)=1.2e6 J/(m³·K)是特定110kV/630mm²电缆的候选参考。当前取得出版社文字提取，未取得PDF字节及独立逐格图像核验，留在仓库外，不给城南默认值；不得把另篇论文k=0.17与此密度/比热拼接。

沥青防腐层：厂家结构页证明有层，缺牌号、密度、比热、温度范围。IEC60949 Table II的`PVC_bitumen`是波纹铝护套上的组合保护层、短路非绝热用途（1.7e6 J/(m³·K)），不是独立纯沥青物性。城南纯沥青层仍未覆盖。

波纹护套内封闭气隙：Yang等2018论文同时采用空气隙热阻Ta与热容Qa，约1.2e3 J/(m³·K)是该论文候选；不是仅用热阻即可替代所有暂态热容的通用规定。缺独立原PDF图像核验、城南有效间隙/接触几何及气体状态，继续暂存。IEC60853-2修订的T4是电缆外部空气热阻，不能当作护套内空气隙。已发布空气物性文献也不自动认证城南封闭气隙。

本轮无新增已闭合的城南专用热容值。IEC60853-1/-2预览未覆盖完整材料原表与暂态方法；Sah7格仍缺正式发表版逐值复核及测点密度/温度对应，暂缓项页码已改为PDF/印刷12（r1–r5）、12–13（r6）、13（r7）。IEC60287-2-1:2023 Table2整表560格及GB/T12706.2表18十格继续暂缓。

### 消费者机械同步

standard-check 1.6.0→1.6.1，`basis_catalog.py --write`以LF钉住4,342条记录及0.7.0版次；其方法版本与判据源码不改。gb50217-correction 1.0.3→1.0.4，只改依据默认发行摘要及说明，方法版本不改。已有工程配置保持旧绑定，不静默改历史数据。三个插件分别按显式清单路径封签；消费者判据适配交三维/研究线程复核。

## 第五批与制造判据覆盖

### 0.6.0 新增与型号审核接入

| 来源 / 完整定位 | 新增格 / 同ID更新 | 印刷 / PDF页 | 两路核验与用途 |
| --- | ---: | --- | --- |
| GB50217—2018 3.6.2、3.6.3、3.6.4 | 16 / 0 | 11–12 / 21–22 | 原页图像转录 / 独立盲提取；应/宜、严格不等号分开 |
| GB50217 表D.0.6、D.0.7 | 0 / 8+24 | 74 / 84 | 两次完整图像转录；原值不变，补间距/基准环境条件 |
| Youn et al. 2019 Table1 | 9 / 0 | 8 / 8 | pdfplumber文字层 / 完整图像转录；文献参考，不自动选范围值 |
| Sah et al. 2022预印本v1 Table2、Table3 | 16+99 / 0 | 6–7 / 6–7 | 文字层逐行解析 / 完整图像转录；配方、压实参考，非正式发表版本 |
| GB/T12706.2—2020 10.1、10.2.1、10.2.2、10.2.3、17.5.3 | 7 / 1页码修正 | 10、18 / 18、26 | 独立DOCX / 原PDF图像复读；含标准未规定固定截面的结论 |

两份文献原件已登记受控资料目录及Zotero，附件回读SHA256与项目副本一致。全文不进入插件。Sah热容汇总7格继续暂缓：正式版逐值复核及测点密度、温度对应未闭合；可自动采用的新增现场热容为0。IEC60287-2-1:2023 Table2整表560格仍暂缓，同版本印刷不清格未确认，不零散放行559格。

D.0.6查询必须新增`cable_spacing_condition="no_gap"`；D.0.7新增`current_basis_environment="indoor_air_at_outdoor_ambient"`。缺条件明确失败。3.6.3第7项原文为“宜”，已将暂存的`required`修正为`recommended`及`recommended_calculation`；敷设计算要求不是载流量乘数。排管、穿管、电缆沟的通用固定乘数及独立埋深校正仍未覆盖。

型号YJV22 8.7/15kV 3×240的九项要求按下表引用。每芯屏蔽截面三项使用同一标准记录，工程要求仍保留各自芯身份；引用不批准任何芯。

| 要求 | quantity / 记录键 | 条件与实际查询结果 | 印刷 / PDF页 |
| --- | --- | --- | --- |
| 三芯各自铜带屏蔽标称截面 | `screen_nominal_area_requirement` / `mv-screen-tape-area-rule/r1/screen_nominal_area_requirement` | `screen_kind=copper_tape`；`fixed_numeric_area=standard_not_specified`，要求工程输入与独立性能依据 | 10 / 18 |
| 铜丝屏蔽截面分支 | 同量 / `mv-screen-wire-area-rule/r1/screen_nominal_area_requirement` | `screen_kind=copper_wire`；无固定数值，按故障电流容量确定 | 10 / 18 |
| 挤包内衬最薄点 | `extruded_inner_covering_measured_min` / `mv-extruded-inner-measured/r1/extruded_inner_covering_measured_min` | `covering_construction=extruded`；0.8×内衬标称厚度−0.2mm，需实测值 | 18 / 26 |
| 铠装材料类别 | `armour_allowed_materials` / `mv-armour-materials/r2/armour_allowed_materials` | `armour_kind=tape`；镀锌钢、非磁不锈钢、铝、铝合金。普通steel标签须另声明镀锌类别，不能擅自等同 | 11 / 19 |
| 三芯铠装下内衬 | `armour_inner_covering_rule` / `mv-armour-inner-three/r1/armour_inner_covering_rule` | `core_count=3`；`required_conforming_8.2` | 11 / 19 |
| 挤包隔离套适用分支 | `separation_sheath_application` / `mv-isolation-applicability/r1/separation_sheath_application` | `metal_layer_relation=different,longitudinal_water_barrier=false,lead_sheath_present=false`；`extruded_required` | 11 / 19 |
| 金属带层数 | `armour_tape_layer_count` / `mv-tape-layer-count/r1/armour_tape_layer_count` | `armour_kind=tape`；螺旋绕包两层（非至少两层） | 13 / 21 |
| 每层最大间隙率 | `armour_tape_gap_ratio_max` / `mv-tape-gap/r1/armour_tape_gap_ratio_max` | `armour_kind=tape`；0.5（50%），需实测/工艺声明并区分层 | 13 / 21 |
| 铠装带实测厚度 | `armour_measured_negative_deviation_max` / `mv-armour-deviation/r3/armour_measured_negative_deviation_max` | `armour_kind=tape`；最大负偏差0.10；0.5mm带须≥0.45mm，需按17.7.2实测 | 19 / 27 |
| 完整铠装厚度表 | `armour_tape_nominal` / `mv-表11/r1..r3/steel或al` | `diameter_m=0.0666,armour_material=steel`→0.5mm；假设直径按13.4，不能用成品外径 | 13 / 21 |

“标准未规定”指该版本10.1–10.2.3未给每芯固定数值屏蔽截面：铜丝明确按故障电流容量确定；铜带明确规定厚度、搭盖及实测厚度。不能把它翻译为不需要短路校核或数值0，更不能用附录A.2假设直径增量表替代屏蔽容量。新quantity返回有字段的规则对象而非数值，`engineering_input_required=true`；standard-check下一轮实现人工设计依据/性能校核分支，本轮不改其判定逻辑。

17.5标题明确包括挤包内衬，17.5.1规定测量方法，17.5.3式(6)在印刷18/PDF26。新记录按该明确范围引用内衬标称厚度和内衬实测值，没有套用外护套输入。既有`mv-rule-17.5.3/r1/value`亦修正为公式所在续页18/26，旧记录键不变。绕包内衬继续用17.12；双金属带绕包内衬及附加垫层总厚度用13.7，两者不可混用。实测铠带按≤40mm中央、>40mm距两边20mm各测并平均；测量精度±0.01mm，平测头直径5mm。

宿主实际请求示例（发行摘要从`GET /api/methods`获取，禁止写死示例摘要）：

```json
{
  "release_digest": "<当前0.6.0发行摘要>",
  "input": {
    "schema_version": "cablesim.standards-query/1",
    "operation": "resolve",
    "standard": "GB/T 12706.2", "edition": "2020",
    "locator": "17.5.3", "quantity": "extruded_inner_covering_measured_min",
    "conditions": {"covering_construction": "extruded"}
  }
}
```

POST `/api/plugin-queries/cablesim.standards-basis/lookup`返回唯一记录、公式参数、18/26页码、两路verified及摘要。厚度输入/输出均mm：1.8mm标称内衬的最薄点手算下限1.24mm；这不是现场实测值，缺实测必须停在测量字段。

依赖发行机械同步：standard-check 1.5.1→1.5.2，仅`basis-records.json`以LF重新锁定4227条及清单版本/封签；GB校正1.0.2→1.0.3，仅默认依据发行摘要、说明、补丁版本与封签。其`method_version=1.0.0`与判定源码不变，保存配置不静默换发行。宿主依赖封签闭包变化会由seal重生成`src/host-dependencies.json`，纳入机械文件清单，交研究复核。

并入前确认0.5.0现有excerpts、verification、basis、integrity与清单封签逐字节一致，三维机械重封签未造成这四份依据内容漂移。本轮封签工具已包含公共线程对清单路径的修复：指定清单仅写目标，其他漂移返回警告；封签前后摘要审计未发现非目标清单写入。工作区其他插件既有差异不属于本线程改动。

| 来源与定位 | 新增格 | 印刷页 / PDF页 | 双路核验 |
| --- | ---: | --- | --- |
| Qi et al. 2021 Table 1 完整表 / ρc派生 | 12 / 3 | 3 / 3 | 原PDF文字层 / 独立全表图像转录；派生另作乘积复算 |
| Deng et al. 2020 Table 2 完整表 / ρc派生 | 13 / 3 | 5 / 5 | 原PDF文字层 / 独立全表图像转录；单位换算及乘积复算 |
| Hopmans et al. 2002 §2.2 Eq.(1)/(2) | 2 | 7-3 / 3 | 文字层公式 / 原页图像独立重读 |
| GB/T12706.2—2020 13.2 | 3 | 11 / 19 | 独立DOCX条款转录 / 主代理PDF图像 |
| 同上13.3.1、13.3.2 | 1 / 1 | 11 / 19 | 同上 |
| 同上13.3.3适用规则及纵向阻水例外 | 3 / 1 | 11–12 / 19–20 | 同上；原有厚度公式保留 |
| 同上13.7层数、间隙率、绕包附加垫层及总实测厚度 | 1 / 1 / 2 / 1 | 13 / 21 | 同上 |
| 同上17.7.2测量参数 / 17.7.3最大负偏差 | 4 / 3 | 18–19 / 26–27 | 同上 |
| 同上17.5.1测量范围 / 17.12绕包内衬实测下限 | 1 / 1 | 17、21 / 25、29 | 同上 |
| GB/T12706.3—2020 10.2.2铜带标称、搭盖、实测 | 2 / 2 / 1 | 8 / 13 | 独立DOCX条款转录 / 主代理PDF图像 |
| 同上10.2.3铜丝结构及平均间隙 | 1 / 1 | 8 / 13 | 同上 |

铜带条款按实际原文收录于**10.2.2**。10.2.3是截面≥500mm²的铜丝屏蔽要求，9.2.3未在此正文中出现，不能为错误编号编造铜带判据。所有厚度系数、负偏差和最小搭盖等记录的限制明确写“需实测值”；三维包络与假设直径不是实测值。13.7的0.5/0.8mm增量和总厚度下限仅适用于绕包内衬。17.12明确针对绕包；挤包内衬测量应引用17.5标题所列范围、17.5.1方法及17.5.3的非金属护套判据，不能把17.12或外护套专用输入直接改名为内衬实测。现有通用`nonmetal_sheath_min`保留，不新增猜测的内衬专用公式。

型号消费者必须同时核对屏蔽结构：`.3`截面≥500mm²应读取10.2.3的`screen_required_construction`，不能仅查10.2.2的铜带厚度就宣称该截面允许铜带屏蔽。这项结构判定由三维消费者接入，本线程只机械同步其依据清单。

IEC60287-2-1:2023 Table2整表560格继续暂缓：本地“3,2-”印刷格未取得同版本合法清晰副本或正式勘误确认，不并入。Hopmans Table1固相热容与脚注乘积不一致，同样不作为默认参数。Qi空气是流动管内空气，Deng回填是地热钻孔回填，温度范围/配方未给；仅为明确文献工况参考，不能自动覆盖城南封闭管内空气、专用电缆回填或现场干湿土壤。半导电配方及现场相物性缺项保持未覆盖。

## 土壤公式与按表读取契约

`catalog`新增可选`compact:true`，省略目录中的逐格record_ids，完整目录默认答复不变。首次浏览使用`browse`：同一Executor运行返回紧凑目录和明确所选一张表（必填standard/edition/locator），避免先目录后表格的串行启动；条件/记录筛选用resolve。后续只按所选表取`list`，不预取整库。分册按表索引按需解析；全库各文件仍先核对摘要与封签。依据浏览页不加载隐藏的资源名片与详情，切换“资源版本”时恢复原读取。前端按发行摘要缓存目录和已打开表，仅存当前会话内存；不保存工程数据、不静默刷新历史引用。原印刷页允许整数或章节页字符串（如`7-3`）；PDF页仍为正整数。

`list/browse`新增可选`table_id`（目录的id），前端完整表格始终带此字段：同一条款的标称厚度、搭盖率、测量系数可以有不同的行轴，不能按row号合并。同条款的未带table_id旧查询仍返回全部判据，兼容已有消费者；消费者若自行呈现表格，必须按`verification.evidence_id`分组，或携带table_id读取。resolve的唯一性与记录引用契约不变。

只有Hopmans两条土壤公式支持`operation:evaluate`。公式来源仍为`literature_reference`，与IEC标准推荐值区分。物性取值和适用温度/压力须由工程师另有来源；本插件不给默认值。`formula_inputs`均用字段所示SI单位：

```json
{
  "schema_version": "cablesim.standards-query/1",
  "operation": "evaluate",
  "standard": "Hopmans et al.", "edition": "2002",
  "locator": "§2.2 Eq. (1)/(2)", "quantity": "soil_capacity_expression",
  "conditions": {
    "material": "soil", "material_role": "porous_soil",
    "soil_capacity_method": "three_phase", "parameter_origin": "project_measured"
  },
  "formula_inputs": {
    "dry_bulk_density_kg_m3": 1500, "particle_density_kg_m3": 2500,
    "solid_specific_heat_capacity_j_kg_k": 800,
    "water_volumetric_heat_capacity_j_m3_k": 4180000,
    "air_volumetric_heat_capacity_j_m3_k": 1200,
    "water_volume_fraction": 0.2,
    "phase_assumption": "single_temperature_no_phase_change"
  }
}
```

上述仅为**手算校验输入**，并非城南现场数据：孔隙率φ=1−ρd/ρs=0.4（质量体积定义的换算），Cs=ρs·cs；原式C=Cs(1−φ)+Cwθ+Ca(φ−θ)，结果2,036,240J/(m³·K)。输入正有限密度/相热容、0≤θ≤φ≤1、ρd≤ρs并明确同温无相变；缺项停在`/formula_inputs/<字段>`。`air_capacity_neglected`分支须明确选择，不能传气相参数后暗中忽略。冻结/相变、未知相温度不在范围内。返回`calculation`含原输入及其摘要、推导量、结果单位、插件版本、记录摘要、来源摘要、页码引用和`approval:not_granted`；消费者保存原结果，不把手算参数写成现场实测。

在依据浏览中选择这两条公式后，详情的“代入现场参数”提供同一只读宿主查询：参数初始为空，所有单位直接写在字段标签，需确认同温无相变。计算期间禁止重复提交；越界错误聚焦具体字段；修改参数后上次值明确标为历史结果，不能冒充新结果。Esc取消查询并收起表单，当前会话保留输入；不写工程库、不自动采用热容。

铠装例：`standard=GB/T12706.2,edition=2020,locator=13.7,quantity=armour_tape_gap_ratio_max,conditions={armour_kind:tape}`返回0.5、印刷13/PDF21；每层间隙率均须有实测或声明后才可比较。铜带例：`.3/10.2.2/screen_tape_nominal_min,{core_count:3}`返回0.10mm、印刷8/PDF13；`screen_tape_measured_min_ratio,{}`返回0.9，必须再提供铜带标称厚度和最薄实测值。

比值统一为无量纲比例：原文50%、10%、90%分别返回0.5、0.1、0.9，消费者不得再除以100。查询条件的厚度、带宽用m；返回原条款尺寸阈值用mm，按quantity.unit转换后再比较。

原文件摘要（完整 64 位）：

| 标准 | 文件 | SHA256 |
| --- | --- | --- |
| GB/T 12706.1—2020 | PDF | `9c398e261e5b88d24db5f0ca5a698402bc25eab6e4da0de063ebd4cd7790f6f1` |
| 同上 | DOCX | `cb45f149b626e5ab9f50c491f7950965ad604a37cb9dac2c76eee013511f0970` |
| GB/T 12706.2—2020 | PDF | `3b5fa321c213d4aaac7e04a293b9026626f43cc5b15209b26b713172e56f748d` |
| 同上 | DOCX | `b6251feba7318676bc7b28d481f7e978fc66b1efa9f5c16e8bf0f83d0399555a` |
| GB/T 12706.3—2020 | PDF | `4b2cca105c903cf4fed10b7f06cced06b834da1561170f1d9be96eb67ad0e3bb` |
| 同上 | DOCX | `5cf2ff30a362b32f674dc2d2498796625ca13b4f3c27923277560b36f40cf0dc` |
| GB/T 3956—2008 | PDF | `b9a118e1282b4eeee6ec6ae4653e8c80e0a42beee0df5bf84360c4876a856939` |
| IEC 60228:2023 | PDF | `d50b9d8338bdd224b0ffef2714d2e58722b2408e624c161d3503ae2c3374605e` |
| GB/T 11017.2—2024 | PDF | `5a9ecebbedf59c0b99d44c4b3520147d8bd08208ff2b7b6f338cdbbe5628b89b` |
| GB 50217—2018 | PDF | `5e15e9a4a78e40df66a8b91a2e6f5da3047e92304dc0eb7cb62522e418e09483` |
| IEC 60287-1-1:2023 | PDF | `b300bb2bea52ce64e24c8137193559d7ee4cc04013ec4122357a2625e868a327` |
| IEC 60287-2-1:2023 | PDF | `a273d784ccf13b73915557c22ce3642c6c1bef94be6034ebd8237e8a7d997f52` |
| IEC 60287-3-1:2017 | PDF | `618e8d8cd829a15cb0bdcf08af4d73afc0b8928a3ea0eeb42bdc75cc87b08f63` |

## 覆盖与核验

下表的记录数是输出格数，包含原表不适用的空格；截面积、电压、直径边界等输入轴单独保存，未丢弃原格。A.1/A.2 左右并排表规范化为一个连续行序列，原数值全部保留。核验方法：

- **D/P**：DOCX 表或段落独立提取，对比 PDF 对应页逐格抄录；12706.1/.2 的扫描页使用离线 OCR 辅助，不以错误 OCR 代替原图。整列 DOCX 数字及摘要另保存在核验记录；12706.3 同时检查 PDF 文字层。
- **T/P**：PDF 表格或文字层独立提取，再对照渲染页独立抄录；GB/T 3956 使用 fitz 与 pdfplumber 两路提取，图像确认破碎小数及破折号。
- **P/P**：IEC 60228 表页无文字层，当前原页两次独立数值抄录并逐格比对，保存两路矩阵摘要；主线程另抽查关键页。文字层为空不算数值核验来源。

### 第一批（保留）

| 标准与版本 | 条款 / 完整表 | 规范化行 × 输出列 | 记录数 | 印刷页 / PDF 页 | 核验 |
| --- | --- | --- | ---: | --- | --- |
| GB/T 12706.1—2020 | 6.2 / 表6 PVC/A | 13×2 | 26 | 6 / 12 | D/P |
| 同上 | 6.2 / 表7 XLPE | 16×2 | 32 | 6 / 12 | D/P |
| 同上 | 6.2 / 表8 EPR/HEPR | 17×4 | 68 | 7 / 13 | D/P |
| 同上 | 7.2.3 / 表9 内衬层 | 6×1 | 6 | 8 / 14 | D/P |
| 同上 | 12.5 / 表10 圆铠丝 | 6×1 | 6 | 12 / 18 | D/P |
| 同上 | 12.5 / 表11 铠带 | 3×2 | 6 | 12 / 18 | D/P |
| 同上 | 15.3.4 / 表12 例行电压 | 2×1 | 2 | 15 / 21 | D/P |
| GB/T 12706.2—2020 | 6.2 / 表6 PVC/B | 1×1 | 1 | 6 / 14 | D/P |
| 同上 | 6.2 / 表7 XLPE | 9×5 | 45 | 7 / 15 | D/P |
| 同上 | 6.2 / 表8 EPR/HEPR | 9×6 | 54 | 7 / 15 | D/P |
| 同上 | 8.2.3 / 表9 内衬层 | 6×1 | 6 | 9 / 17 | D/P |
| 同上 | 13.5 / 表10 圆铠丝 | 6×1 | 6 | 12 / 20 | D/P |
| 同上 | 13.5 / 表11 铠带 | 3×2 | 6 | 13 / 21 | D/P |
| 同上 | 16.4.4 / 表12 例行电压 | 5×1 | 5 | 16 / 24 | D/P |
| GB/T 12706.3—2020 | 6.2 / 表6 绝缘 | 1×2 | 2 | 6 / 11 | D/P |
| 同上 | 8.2.3 / 表7 内衬层 | 5×1 | 5 | 7 / 12 | D/P |
| 同上 | 13.5 / 表8 圆铠丝 | 3×1 | 3 | 10 / 15 | D/P |
| 同上 | 13.5 / 表9 钢带 | 2×1 | 2 | 10 / 15 | D/P |
| 同上 | A.2.1 / 表A.1 导体假设直径 | 16×1 | 16 | 32 / 37 | D/P |
| 同上 | A.2.5 / 表A.2 屏蔽直径增量 | 16×1 | 16 | 33 / 38 | D/P |
| 同上 | 16.4.4 / 表10 例行电压 | 2×2 | 4 | 13 / 18 | D/P |
| 同上 | 17.9.3 / 表12 抽样电压 | 2×1 | 2 | 16 / 21 | D/P |
| GB/T 3956—2008 | 5.1.2 / 表1 第1类 | 25×3 | 75 | 3–4 / 6–7 | T/P |
| 同上 | 5.2.2 / 表2 第2类 | 30×9 | 270 | 4–5 / 7–8 | T/P |
| 同上 | 6.1/6.2 / 表3 第5类 | 22×3 | 66 | 5 / 8 | T/P |
| 同上 | 6.1/6.2 / 表4 第6类 | 19×3 | 57 | 6 / 9 | T/P |
| IEC 60228:2023 | 6.1 / Table3 第1类 | 27×3 | 81 | 12 / 14 | P/P |
| 同上 | 6.2 / Table4 第2类 | 33×9 | 297 | 13 / 15 | P/P |
| 同上 | 6.3 / Table5 第5类 | 22×3 | 66 | 14 / 16 | P/P |
| 同上 | 6.4 / Table6 第6类 | 19×3 | 57 | 15 / 17 | P/P |
| GB/T 11017.2—2024 | 6.4 / 表2 绝缘 | 12×3 | 36 | 4 / 10 | T/P |
| 同上 | 6.6 / 表3 金属套 | 12×3 | 36 | 7 / 13 | T/P |
| 同上 | 6.7.2 / 表4 外护套 | 12×2 | 24 | 8 / 14 | T/P |

以上共 1,384 个输出格。另有 45 条条款记录，每条也保存两路取值与页码：

| 标准 | 条款 × 记录数 | 内容 | 核验 |
| --- | --- | --- | --- |
| GB/T 12706.1—2020 | 11×1；12.3.3×2；13.3×2；16.5.2×2；16.5.3×1；16.6.1×1；9.2.3×5（共14） | 铅套/隔离套/外护套公式与下限，绝缘均值和最小值，非金属护套/铅套最小厚度，铜带厚度与搭盖 | D/P |
| GB/T 12706.2—2020 | 12×1；13.3.3×2；14.3×2；17.5.2×2；17.5.3×1；17.6.1×1；10.2.3×5（共14） | 厚度公式、最小测量厚度、绝缘偏心率、铜带屏蔽 | D/P |
| GB/T 12706.3—2020 | 12×1；13.3.3×2；14.3×2；17.5.2×2；17.5.3×1；17.6.1×1（共9） | 厚度公式、最小测量厚度、15%偏心率 | D/P |
| GB/T 11017.2—2024 | 6.3.2×2；6.3.3×2；6.5.2×3；6.7.3×1（共8） | 屏蔽参考/最小厚度、铜丝直径/间隙/公式、外护套半导电层20%上限 | T/P |

### 第二批完整矩阵与条件包

下列579格在上一批1,429格基础上新增。试验表的合并标题展开为有具体量和单位的物理子行，仍保留全部材料列和破折号。D/P为独立DOCX数列对PDF原页文字层或图像；T/P为独立PDF文字层/表格提取对渲染原页逐格转录。每格实际方法、来源摘要和一致结果保存在核验文件，并由构建器逐格比较两路值。

| 标准 | 表/条款 | 行×列／记录数 | 印刷页／PDF页 | 核验 |
| --- | --- | --- | --- | --- |
| GB 50217—2018 | D.0.1 | 5×8／40 | 72／82 | T/P |
| 同上 | D.0.3 | 5×1／5 | 72–73／82–83 | T/P |
| 同上 | D.0.4、D.0.5 | 各3×6／各18 | 73、74／83、84 | T/P |
| 同上 | D.0.6 | 2×4／8 | 74／84 | T/P |
| 同上 | D.0.7 | 3×8／24 | 74／84 | T/P |
| 同上 | 5.3.3、表5.3.5 | 1×3／3；15×2／30 | 35／45 | T/P |
| 同上 | D.0.2、5.3.2、5.1.2 | 1、2、1格 | 72、34、28／82、44、38 | T/P |
| IEC 60287-1-1:2023 | Table 1、Table 2 | 7×2／14；14×2／28 | 35、36／83、84 | T/P |
| IEC 60287-2-1:2023 | Table 1 | 29×1／29 | 33／89 | T/P |
| GB/T 12706.1—2020 | 表1、2、3、4、5 | 2×3／6；4×2／8；4×3／12；6×3／18；4×3／12 | 4–5／10–11 | D/P |
| 同上 | 表16 | 5×3／15 | 20／26 | D/P |
| GB/T 12706.2—2020 | 表1、2、3、4、5 | 5×3／15；4×2／8；4×3／12；6×3／18；4×3／12 | 4–6／12–14 | D/P |
| 同上 | 表17 | 6×3／18 | 23／31 | D/P |
| GB/T 12706.3—2020 | 表1、2、3、4、5 | 1×3／3；3×2／6；2×3／6；4×3／12；4×3／12 | 4–5／9–10 | D/P |
| 同上 | 表13、14 | 15×3／45；8×1／8 | 16–17、17／21–22、22 | D/P |
| 同上 | 表15 | 2×2／4 | 19／24 | D/P |
| 同上 | 表17、18 | 9×3／27；9×4／36 | 23、24／28、29 | D/P |
| 同上 | 表19、20、21 | 9×1／9；8×1／8；7×1／7 | 25–26／30–31 | D/P |
| GB/T 11017.2—2024 | 表1 | 7×3／21 | 3／9 | T/P |

GB50217条件包明确区分温度、土壤热阻率、并列/叠层根数、间距、系统和桥架。5.3.3区分非冻土区的电缆外皮至基础0.3m净距、至地面0.7m深度，以及耕地下不得小于1m，不能合并成无条件限值。5.3.2仅编制第1、2款的软土/沙层100mm及保护板每侧50mm；其余款及标志间隔等未覆盖。D.0.2保留计算式参数，不执行。IEC Table2脚注a的空心导体系数为公式描述，不把它猜成1；半导电层2.5 K·m/W限定到原表构造，其他分支须核对相邻介电层或4.1.3。

GB/T12706.3表13的XLPE吸水量1 mg/cm²限制到密度≤1000 kg/m³；更高密度脚注未给明确替代限值，该数值查询返回未覆盖，第三批另提供条件说明。表17–21温度偏差随行显示，表20密度试验保留无数值限值的条件摘要。GB/T12706.2表17体积电阻率按脚注a限制到3.6/6(7.2)kV无屏蔽PVC/EPR/HEPR；tanδ按18.2.6和本部分适用范围限制到6/10kV至18/30kV，35kV/110kV不得取用。标准的试验温度是原表°C值，查询环境温度条件仍使用K。

0.4.0保留全部逐格核验，但表18电压轴仍未确认，10格阻止自动查询。已解决的提取问题保存在 `verification.json.resolved_extraction_issues`：3956 续页页码；扫描页无文字层和 DOCX 合并格；12706.1 表10 OCR 将边界35误读；12706.3 表9的原题“直径”与列名“厚度”不一致（保留原题，量按列名，附限制）。编制过程中发现的 HEPR 整列错位已由完整 DOCX 数列对照拦截并修正，不放行错误格。

第二批核验还拦截了12706.3表18的ST7行错位：老化后抗张强度原格为破折号，300属于老化后断裂伸长率；重新对照DOCX与PDF29后保留正确的null/300。IEC文字层的破碎小数通过完整原页重新确认。未对齐的完整试验矩阵未发布，没有将抽查正确推断为全表已核验。

两个注意点：表10末行的 3.15 / 4.0 mm 是两个选项，返回数组而不任择其一；12706.3 表10含两种试验程序的电压列，分别命名，不能任选较低列。11017.2 屏蔽“约”厚度为 `standard_reference/approximate`，最小测量厚度才是 `standard_limit/minimum`。

### 第三批完整矩阵与规定

下列818格新增于第二批2,008格。D/P为DOCX独立物理数列提取对完整PDF原页抄录；T/P为PDF文字层独立提取对渲染原页抄录。每格都有两路值；温度偏差、正负变化率、范围、原空白分别保存，不把温度偏差当温度值。采样长度表完整保留4×5格及“余类推”，尚未实现任意批量长度的自动样品数算法。

| 标准及版本 | 表或条款 | 记录数 | 印刷页 / PDF页 | 核验 |
| --- | --- | ---: | --- | --- |
| GB/T12706.1—2020 | 表13 | 20 | 15 / 21 | D/P |
| 同上 | 表14 | 45 | 17–18 / 23–24 | D/P |
| 同上 | 表15 | 8 | 18 / 24 | D/P |
| 同上 | 表19 | 54 | 30 / 36 | D/P |
| 同上 | 表20 | 18 | 30 / 36 | D/P |
| 同上 | 表21 | 7 | 31 / 37 | D/P |
| 同上 | 表22 | 16 | 31 / 37 | D/P |
| 同上 | 表23 | 7 | 32 / 38 | D/P |
| 同上 | 16.9.2 / 表14脚注a | 1 | 18 / 24 | D/P |
| GB/T12706.2—2020 | 表13 | 20 | 17 / 25 | D/P |
| 同上 | 表14 | 8 | 19 / 27 | D/P |
| 同上 | 表15 | 45 | 20 / 28 | D/P |
| 同上 | 表16 | 8 | 20–21 / 28–29 | D/P |
| 同上 | 表18 | 10 | 24 / 32 | D/P |
| 同上 | 表20 | 40 | 29 / 37 | D/P |
| 同上 | 表21 | 54 | 30 / 38 | D/P |
| 同上 | 表22 | 18 | 31 / 39 | D/P |
| 同上 | 表23 | 9 | 32 / 40 | D/P |
| 同上 | 表24 | 16 | 32 / 40 | D/P |
| 同上 | 表25 | 7 | 33 / 41 | D/P |
| 同上 | 17.10.2 / 表15脚注a | 1 | 20 / 28 | D/P |
| GB/T12706.3—2020 | 表11 | 20 | 14 / 19 | D/P |
| 同上 | 表16 | 182 | 21 / 26 | D/P |
| 同上 | 17.10 / 表13脚注a | 1 | 17 / 22 | D/P |
| GB50217—2018 | 表5.1.7 | 6 | 29–30 / 39–40 | T/P |
| 同上 | 5.1.11 | 2 | 31 / 41 | T/P |
| 同上 | 5.1.18第2款 | 2 | 32 / 42 | T/P |
| 同上 | 5.3.6 | 8 | 36 / 46 | T/P |
| 同上 | 5.3.8第1、2款 | 2 | 36 / 46 | T/P |
| 同上 | 5.4.4第2款 | 2 | 37 / 47 | T/P |
| 同上 | 5.4.5 | 5 | 37 / 47 | T/P |
| 同上 | 5.4.6第3、4款 | 2 | 37 / 47 | T/P |
| 同上 | 表5.5.1 | 6 | 38 / 48 | T/P |
| 同上 | 表5.5.2 | 16 | 38 / 48 | T/P |
| 同上 | 5.5.3第1、2款 | 3 | 39 / 49 | T/P |
| 同上 | 5.5.4第3款 | 2 | 39 / 49 | T/P |
| 同上 | 5.5.5第1款 | 1 | 39 / 49 | T/P |
| 同上 | 5.5.6 | 1 | 39 / 49 | T/P |
| 同上 | 5.6.1第1、2款 | 7 | 40 / 50 | T/P |
| 同上 | 表5.6.1 | 6 | 40 / 50 | T/P |
| 同上 | 5.6.3第1、2款 | 3 | 40 / 50 | T/P |
| IEC60287-1-1:2023 | Table3 | 34 | 37 / 85 | T/P |
| 同上 | Table4 | 5 | 37 / 85 | T/P |
| IEC60287-2-1:2023 | Table3 | 30 | 35 / 91 | T/P |
| 同上 | Table4 | 5 | 36 / 92 | T/P |
| 同上 | Table5 | 30 | 36 / 92 | T/P |
| IEC60287-3-1:2017 | Table1 | 12 | 7 / 39 | T/P |
| 同上 | Table2 | 4 | 7 / 39 | T/P |
| 同上 | Annex A.4中国条件 | 9 | 10 / 42 | T/P |

IEC2-1 Table3按真实安装图区分单根、两根/三根、水平/垂直、接触/有间隔、品字形及墙面夹装，加入直径上限、距墙净距和净间隔约束。Table5按4.2.6.3限制外径适用区间；经验系数单位按对应公式标注，公式需要的mm/°C约定写入限制，库不执行公式。IEC3-1 Table1/2仅在国家数据不可用时采用；Annex A.4为资料性`standard_reference/reference_only`，不当项目默认值。

GB50217表5.5.2保留最后一行槽盒`h+80 / h+100 mm`，`h`为槽盒外壳高度；返回公式描述，`execution_status=not_implemented`。载流量修正与沟道尺寸是不同量。高密度XLPE分支在三个电压部分均返回`standard_condition/no_numeric_limit`，不把“应考虑增加大于1”转换为合格下限或无限上限。

GB50217的5.1.18第2款使用实际`voltage_v`（V，0＜值≤35000）、`route_length=non_long_distance`、`remaining_segment=unusable`查询订货长度裕量；须满足整盘截取后剩余段不可利用这一前提。35kV是范围上限，不是要求工程师填写的固定电压。

### 拦截与未放行

| 标准 / 表 | 当前处理 | 印刷 / PDF页 |
| --- | --- | --- |
| GB/T12706.1 表17/18、GB/T12706.2 表19 | 第四批已完成完整第二路核验，全部并入 | 28/34、29/35、26–27/34–35 |
| IEC60287-2-1 Table2 | 28×20格已准备，hB/wB=3、LG/hB=3的原印刷为`3,2-`；一格不能确定，整表560格不并入 | 34/90 |
| GB/T12706.2 表18 | 原表头U₀和6/10/15/20/30轴语义冲突；无合法勘误，保留旧ID/条件供浏览，10格标blocked，resolve禁止使用 | 24/32 |

### 0.3.0抽查问题的处理

13个抽样格归为5组，本轮回原PDF确认后：GB/T12706.1表3全部12格改为印刷4/PDF10；GB/T12706.2表5全部12格改为印刷6/PDF14；GB/T12706.3铅套条款改为8/13，隔离套两分支改为9/14；GB50217 5.3.3耕地下1m改为最小深度、not_less_than；GB/T12706.2表18不猜U₀/U映射，按上表拦截。没有改变数值。

## 下一轮及未覆盖

未覆盖项保存于`basis.json.not_covered`；不得跨版本补值。剩余完整试验操作程序、直接包带等制造例外、合金及特殊用途判据、IEC60228温度修正/附录、GB/T11017.1引用试验仍未覆盖。附录A/B数值和分支参数已覆盖，几何生成执行器由三维线程负责；依据插件本身不执行算法。高密度XLPE的替代吸水数值上限原标准没有给出，不能判为通过。

GB50217附录D没有独立通用埋深校正系数；附录C基准载流量/埋深工况和不同深度修正方法留到下一轮。5.3.3的0.7m/1m是设计埋深规定，不是载流量系数。IEC60287-2-1 Table2整表继续暂缓。

IEC60853-2本地只有合法预览/修订单，官方ANSI合法预览同样未含原材料数值表；未获得合法全文，不能以作者代码或二手表替代原表。TB880扫描资料中本轮未找到可双路核验的完整材料热容表，不能推断整份文献没有该信息。半导电层的Alliander CSV候选2000000缺明确单位及原表页，不放行；干土、湿土和回填料体积热容未覆盖。论文的MPP管壁、空气层与未区分湿度的土壤只作为该案例参考，不推广到任意温压/配方。

## 第四批与新增参数的完整覆盖

以下61个新索引共1,191格。第四批868格沿用已验收的两路矩阵；A/B参数由独立DOCX/公式图转录对原PDF全表目视复读；文献由独立文字层提取对原PDF逐行逐列目视复读。每格的方法及源SHA256保存在verification.json，不把抽查当完整核验。

| 标准 / 来源 | 条款或表 | 行×列 / 格数 | 印刷 / PDF页 | 核验 |
| --- | --- | --- | --- | --- |
| GB/T 12706.1—2020 | 表 17 | 22×10 / 220 | 28/34 | P/P |
| GB/T 12706.1—2020 | 表 18 | 19×7 / 133 | 29/35 | P/P |
| GB/T 12706.2—2020 | 表 19（续） | 25×10 / 250 | 26/34、27/35 | P/P |
| GB/T 3956—2008 | 表A.1 | 41×1 / 41 | 7/10、8/11 | T/P |
| GB/T 3956—2008 | 表C.1 | 24×3 / 72 | 10/13、11/14 | T/P |
| GB/T 3956—2008 | 表C.2 | 15×2 / 30 | 11/14 | T/P |
| GB/T 3956—2008 | 表C.3 | 18×2 / 36 | 12/15 | T/P |
| GB/T 3956—2008 | 附录A | 3×1 / 3 | 7/10 | 独立原页转录 / 图像及手算 |
| GB/T 3956—2008 | 附录B（铜） | 4×1 / 4 | 9/12 | 独立原页转录 / 图像及手算 |
| GB/T 3956—2008 | 附录B（铝） | 4×1 / 4 | 9/12 | 独立原页转录 / 图像及手算 |
| IEC 60228—2023 | Table 1 | 4×1 / 4 | 8/10 | P/P |
| IEC 60228—2023 | Table 2 | 2×1 / 2 | 9/11 | P/P |
| GB/T 12706.4—2020 | 表14 | 7×7 / 49 | 15/19 | D/P |
| GB/T 12706.4—2020 | 表1 | 5×2 / 10 | 6/10 | D/P |
| GB/T 12706.4—2020 | 表8 | 5×2 / 10 | 11/15 | D/P |
| GB/T 12706.1—2020 | 表 A.1 | 21×1 / 21 | 33/39 | D/P |
| GB/T 12706.2—2020 | 表 A.1 | 20×1 / 20 | 39/47 | D/P |
| GB/T 12706.1—2020 | 表 A.2 | 55×1 / 55 | 35/41 | D/P |
| GB/T 12706.2—2020 | A.2.3 | 1×1 / 1 | 40/48 | D/P |
| GB/T 12706.3—2020 | A.2.3 | 1×1 / 1 | 33/38 | D/P |
| GB/T 12706.1—2020 | A.2.2 | 1×1 / 1 | 34/40 | D/P |
| GB/T 12706.2—2020 | A.2.2 | 2×1 / 2 | 40/48 | D/P |
| GB/T 12706.3—2020 | A.2.2 | 1×1 / 1 | 33/38 | D/P |
| GB/T 12706.1—2020 | 式 A.3 | 1×1 / 1 | 34/40 | D/P |
| GB/T 12706.1—2020 | 式 A.4 | 1×1 / 1 | 34/40 | D/P |
| GB/T 12706.1—2020 | 式 A.5 | 1×1 / 1 | 34/40 | D/P |
| GB/T 12706.1—2020 | 式 A.6 | 1×1 / 1 | 34/40 | D/P |
| GB/T 12706.1—2020 | 式 A.7 | 1×1 / 1 | 34/40 | D/P |
| GB/T 12706.1—2020 | A.2.4 | 5×1 / 5 | 35/41 | D/P |
| GB/T 12706.2—2020 | A.2.4 | 5×1 / 5 | 40/48 | D/P |
| GB/T 12706.3—2020 | A.2.4 | 1×1 / 1 | 33/38 | D/P |
| GB/T 12706.1—2020 | 表 A.3 | 16×1 / 16 | 36/42 | D/P |
| GB/T 12706.2—2020 | 表 A.2 | 16×1 / 16 | 41/49 | D/P |
| GB/T 12706.1—2020 | A.2.5 参数 | 2×1 / 2 | 36/42 | D/P |
| GB/T 12706.1—2020 | A.2.6 | 1×1 / 1 | 37/43 | D/P |
| GB/T 12706.1—2020 | A.2.7 | 1×1 / 1 | 37/43 | D/P |
| GB/T 12706.1—2020 | A.2.8 | 1×1 / 1 | 37/43 | D/P |
| GB/T 12706.1—2020 | A.2.10 | 2×1 / 2 | 37/43 | D/P |
| GB/T 12706.2—2020 | A.2.5 参数 | 2×1 / 2 | 41/49 | D/P |
| GB/T 12706.2—2020 | A.2.6 | 1×1 / 1 | 41/49 | D/P |
| GB/T 12706.2—2020 | A.2.7 | 1×1 / 1 | 42/50 | D/P |
| GB/T 12706.2—2020 | A.2.8 | 1×1 / 1 | 42/50 | D/P |
| GB/T 12706.2—2020 | A.2.10 | 2×1 / 2 | 42/50 | D/P |
| GB/T 12706.3—2020 | A.2.5 参数 | 2×1 / 2 | 34/39 | D/P |
| GB/T 12706.3—2020 | A.2.6 | 1×1 / 1 | 34/39 | D/P |
| GB/T 12706.3—2020 | A.2.7 | 1×1 / 1 | 34/39 | D/P |
| GB/T 12706.3—2020 | A.2.8 | 1×1 / 1 | 34/39 | D/P |
| GB/T 12706.3—2020 | A.2.9 | 2×1 / 2 | 35/40 | D/P |
| GB/T 12706.1—2020 | 表 A.4 | 2×1 / 2 | 37/43 | D/P |
| GB/T 12706.2—2020 | 表 A.3 | 2×1 / 2 | 42/50 | D/P |
| GB/T 12706.1—2020 | B.1 | 1×1 / 1 | 38/44 | D/P |
| GB/T 12706.1—2020 | B.2 | 1×1 / 1 | 38/44 | D/P |
| GB/T 12706.1—2020 | 表 B.1 | 11×2 / 22 | 39/45 | D/P |
| GB/T 12706.2—2020 | B.1 | 1×1 / 1 | 43/51 | D/P |
| GB/T 12706.2—2020 | B.2 | 1×1 / 1 | 43/51 | D/P |
| GB/T 12706.2—2020 | 表 B.1 | 10×2 / 20 | 44/52 | D/P |
| GB/T 12706.3—2020 | B.1 | 1×1 / 1 | 36/41 | D/P |
| GB/T 12706.3—2020 | B.2 | 1×1 / 1 | 36/41 | D/P |
| GB/T 12706.3—2020 | 表 B.1 | 8×2 / 16 | 37/42 | D/P |
| Nielsen et al.—2019 | Table 1 | 7×2 / 14 | 8/9 | T/P |
| Huang and Niu—2025 | Table A1 | 14×5 / 70 | 68/13 | T/P（原表 + 派生乘法对拍） |

GB/T3956表1的第1类R₂₀已在0.3.0完整覆盖75格，本轮不重复导入；真实宿主验收铜185mm²不镀金属圆形导体0.101Ω/km，印刷3/PDF6。

### 附录A/B可执行参数速查

| quantity | 明确条件与返回值 | 出处 |
| --- | --- | --- |
| conductor_fictitious_diameter | area_m2；.1表A.1完整21格、.2完整20格 | .1印刷33/PDF39；.2 39/47 |
| core_fictitious_parameters | .1绝缘倍数2/屏蔽增量0；.2 screened=yes/no为3/0mm；.3固定3mm。screened仅指半导电屏蔽，不包含金属屏蔽 | .1 34/40；.2 40/48；.3 33/38 |
| bundle_factor | .1 core_count、equal_core_sections=true、cable_arrangement=standard或single_layer；四芯2.42，三芯2.16；55行含6脚注分支。.2/.3仅三芯等截面2.16 | .1 35/41；.2 40/48；.3 33/38 |
| bundle_parameters | .1不等截面3/4/5芯；equal_core_sections=false、排列分支；明确直径比边界及式A.3–A.7 | .1 34/40 |
| cover_fictitious_parameters | 内衬、铅套、隔离套、包带垫层倍数2；wire倍数2/扎带倍数2、tape倍数4。≤0.3mm扎带忽略；金属屏蔽按单独规则 | .1 35–37/41–43；.2 40–42/48–50；.3 33–35/38–40 |
| inner_covering_fictitious_thickness | .1多芯/.2三芯有无内衬均适用；单芯必须inner_covering_present=true；diameter_m≤0.04为0.4mm，>0.04为0.6mm。.3用其表7标称厚度 | .1 35/41；.2 40/48；.3 33/38 |
| screen_diameter_increase、screen_fictitious_parameters | screen_area_m2精确表轴；中间截面按next_upper_nominal_area。screen_construction=tape/wire，带总厚<0.15mm为0增量；纵包搭盖率30%为分界 | .1 36/42；.2 41/49；.3原表33/38及规则34/39 |
| additional_bedding_diameter_increase | .1表A.4/.2表A.3；diameter_m≤0.029为1mm，>0.029为1.6mm | .1 37/43；.2 42/50 |
| fictitious_rounding（B.1） | {increment:0.1,unit:"mm",mode:"half_up",scope:"each_annex_a_stage"}，每阶段先修约再代入 | .1 38/44；.2 43/51；.3 36/41 |
| fictitious_rounding（B.2） | half_up；requires_explicit_increment=true，精度由有关条文给出。B.2没有通用0.1/0.01mm，缺精度须停止 | 同上 |
| comparison_rounding / comparison_measured_rounding | 表B.1分别11/10/8行；.1均厚0.1mm，其余0.01；.2/.3全部0.01。保留规定值/测量值两列 | .1 39/45；.2 44/52；.3 37/42 |

A.2.2式本身按屏蔽区分，电压范围由所选标准部分及绝缘表共同限制；不是跨部分通用公式。.2无半导电屏蔽只能用于其正文允许的3.6/6kV分支，生成器必须同时取得相应绝缘/屏蔽要求。金属屏蔽增量另按A.2.5；隔离套替代内衬时不得重复加内衬。普通排列是原表假设计算分支，不提供实体芯坐标。所有参数应作为受限模型输入保存，不eval任意表达式。

```python
bundle_query = {
    'schema_version':'cablesim.standards-query/1',
    'standard':'GB/T 12706.1','edition':'2020','locator':'表 A.2',
    'quantity':'bundle_factor',
    'conditions':{'core_count':4,'equal_core_sections':True,'cable_arrangement':'standard'}
} # 2.42，印刷35/PDF41；.2/.3没有四芯系数
```

.2的`core_fictitious_parameters`查询还必须传`conditions={"screened":"yes"}`或明确的`"no"`分支；例如8.7/15kV XLPE采用正文要求的半导电屏蔽分支。调用者不能仍用空条件查询A.2.2。GB50217校正插件的`basis_release_digest`默认锁定值由研究线程显式更新到0.4.0，不由依据库替其他插件自动换版。

### 体积热容：文献参考与采用条件

Nielsen等2019，Table1完整7×2格，印刷8/PDF9；SHA256 `e5b2632dfc9e88d5097da1a91c3653df9ed53d61ef77ce82fcfa39de41496bcf`，[原论文](https://doi.org/10.3390/app9040800)。Cu3.46e6、Al2.46e6、铅/铅合金1.47e6、PE/XLPE2.4e6、PP1.8e6 J/(m³·K)。它是文献直接参考（literature_reference），并非IEC60853原表核验；海床砂砾热容原表未给。

Huang/Niu正式卷期2025（在线发表2024），TableA1完整14行×4原参数列56格，另列密度×比热容14格，印刷68/PDF13；SHA256 `34fc4f54064ac14e70b437dc99146b295aa21a9bf73d421067475559372a12d1`，[原论文](https://doi.org/10.1049/hve2.12465)。派生值semantic=literature_derived_reference，value_details保留密度、比热容和推导式；原表导热/比热的温差°C与K等价，输出用K。PVC1,356,750；钢屏蔽3,728,750；MPP管壁616,400；案例空气层1,196.64527；未区分湿度土壤层2,470,000 J/(m³·K)。铜导体与连接管密度不同，查询必须提供material_role，不能混合。填充PP是缆芯填充，不是土壤回填。

这两篇原资料、题录、SHA和Zotero附件已登记在本地资料库（Nielsen SSZHKSQ9、Huang PVS8W2JZ），本轮复用既有合法文件，未重新下载。体积热容只供显式选定文献/工况后的参考采用，不是任意材料的默认工程事实；皱纹铝不得自动用普通铝替代。仿真消费者需保留采用来源、输入温压/含水率/配方及适用确认，不能把该来源身份标为IEC60853标准值。

```python
heat_query = {
    'schema_version':'cablesim.standards-query/1',
    'standard':'Nielsen et al.','edition':'2019','locator':'Table 1',
    'quantity':'volumetric_heat_capacity','conditions':{'material':'copper'}
} # 3460000 J/(m³·K)，印刷8/PDF9
pipe_query = {
    'schema_version':'cablesim.standards-query/1',
    'standard':'Huang and Niu','edition':'2025','locator':'Table A1',
    'quantity':'volumetric_heat_capacity','conditions':{'material':'MPP','material_role':'pipe'}
} # 920×670=616400 J/(m³·K)，印刷68/PDF13；仅该论文管壁案例
```

文献破折号查询返回reference_value_missing，仍带完整出处；标准破折号保持explicit_not_applicable。新增boolean条件必须为JSON true/false，字符串和0/1均拒绝；缺条件不默认。资料表号保持精确原编制标识，例如附件使用`表14`，不模糊替换成`表 14`。

## 只读查询契约

消费者优先通过现有 `backend.plugin_host.executor.Executor` 调用 `cablesim.standards-basis / lookup`；host会验证清单封签、进程超时及工件摘要。进程输入为 `cablesim.run/2`，工况的 `input` 为 `cablesim.standards-query/1`，`parameters` 留空。直接本地使用 `BasisLibrary.query()` 也校验数据、核验文件、integrity及清单中的数据封签；工程运行仍应走Executor以保留运行身份。

新增 `backend/plugin_host/query_router.py` 提供通用 `POST /api/plugin-queries/{plugin_id}/{capability_id}`。请求为 `{release_digest: <GET /api/methods 返回的发行摘要>, input: <查询>}`，输入64KiB上限；先重载注册表、校验封签和只读声明，再经Executor执行。每次缓存命中也验证发行和封签，缓存键为发行摘要、插件/能力、规范化查询摘要；成功答复最多32条/32MiB，同键并发合并，不缓存失败、不写数据库。执行再次固定准入清单，避免读取期间升级错配。发行变更409、未声明只读403、具体字段错误422，超时/进程错误沿用宿主状态。

`Capability.read_only`是默认false的可选字段；旧清单未显式声明时序列化仍省略该字段，旧发行摘要不变。只有本地method能力可声明只读。该能力仍受清单代码信任边界约束；标志本身不是操作系统沙箱。清单模型源码被native-reference静态封签闭包引用，所以该插件须由其负责人一起重新封签；其他插件不因未声明字段而改变清单身份。现有manifest schema的可选声明由负责schema的线程同步，本线程不重写其生成文件。

**正式应用已挂载**：设计负责人在`backend/main.py`的`create_app`内、API兜底路由之前挂载下列路由，复用`research.executor`及`PluginHostError`处理器。本线程没有修改main.py。

```python
from .plugin_host.query_router import make_router as capability_query_router
app.include_router(capability_query_router(research.executor))
```

新增`operation=catalog`仅需schema_version与operation，返回标准/表/量目录、条件字段、未覆盖清单及固定摘要，不返回全部格。`operation=list`返回完整表，`resolve`沿用r1行为；前端在标准切换/离开/取消时中止读取，重试保留当前选择。浏览历史仅为本次会话内最多10个查询快照，不冒充持久工程历史；Ctrl+Z恢复上次查询条件、Ctrl+S给出只读状态、Esc取消/收起、Enter检索。

```python
from backend.plugin_host.executor import Executor
saved_query = {
    'schema_version': 'cablesim.standards-query/1',
    'standard': 'GB/T 12706.2', 'edition': '2020', 'locator': '表 7',
    'quantity': 'insulation_nominal',
    'conditions': {'area_m2': 0.00024, 'u0_v': 12000,
                   'u_v': 20000, 'insulation': 'XLPE'}
}
result = Executor().run('cablesim.standards-basis', 'lookup', cases=[{
    'case_id': 'insulation',
    'input': saved_query
}])
answer = result.cases[0].artifacts['x-cablesim.standards-basis']
# status=resolved；value=5.5，unit=mm；印刷7 / PDF15；approval=not_granted
```

`locator` 精确使用 `表 7`、`表 A.1`、`Table 4` 或条款号 `17.5.2`，不模糊匹配。`operation=list` 加标准、版本、表号可列完整表；不传条件/record_id。返回每格完整条件，再由消费者填足后 `resolve`；后者必须指定 `quantity`。`record_id` 可消歧，但不免除条件检查。历史重放传 `expected_data_sha256`，不符则 `BASIS_VERSION_CHANGED`。

条件单位：`area_m2` 是导体截面积，`screen_area_m2` 是表A.2的屏蔽/同心导体截面积；`diameter_m` 是该表规定位置的假设直径；电压为V，长度为m，`core_count/conductor_class`为整数。禁止传 `area_mm2` 或把240 mm²写为240 m²。返回数值保持标准原单位（mm、kV、Ω/km等），消费者作显式单位转换，不将它们直接写进SI事实。

材料代号：`PVC/A`、`PVC/B`、`XLPE`、`EPR`、`HEPR`；`copper/aluminium`；`plain/metal_coated`；`circular/compacted/shaped`；`screened=yes/no`。金属套为`lead/corrugated_aluminium/plain_aluminium`，隔离套公式的`non_lead`为明确分支代号，不代表自动识别材料。依据选择只传返回记录声明的条件；多余字段不会被忽略。公式查询返回参数描述，不接收计算输入也不执行表达式。

| 状态或错误 | 消费者处理 |
| --- | --- |
| `resolved` / `verification.status=verified` | 可显示已核验依据与原值；核对实测值还需完整适用条件和算法 |
| `explicit_not_applicable` | 原表是破折号，不产生零值/近似值 |
| `not_covered` | 显示“本轮未覆盖此条款/条件”，保留版本声明，禁止判合格 |
| `CONDITIONS_REQUIRED` / `INPUT_INVALID` | 错误含字段路径与修改说明，补足该字段后再查询 |
| `BASIS_AMBIGUOUS` | 增加明确条件或record_id，不自行选格 |
| `EVIDENCE_BLOCKED` | 保留差异列表，仅供审阅，不给自动判据 |
| `BASIS_VERSION_CHANGED` / `BASIS_INTEGRITY_FAILED` | 禁止静默更新引用；重装准确发行或重新核对版本 |
| 宿主超时/进程失败/环境缺失 | 沿用宿主明确错误；已有要求与运行快照不被本插件修改 |

## 型号、标准核对与规格书接入

### 三芯真实芯位置：标准约束与工程事实

GB/T12706规定缆芯、填充、屏蔽接触和假设直径；所核对条款没有给出实体线芯中心的x/y坐标、相位角、成缆节距或一个可用于所有三芯构造的布局模板。不能从标称截面、标准厚度或`B=2.16`补出“真实位置”。

| 标准 / 条款 | 出处 | 对三维建模的约束 |
| --- | --- | --- |
| GB/T12706.1—2020 7.1、7.2.1、7.2.2 | 印刷7 / PDF13 | 成缆与电压/金属屏蔽有关；绕包内衬的圆形线芯间隙须填充（五芯以上另有例外）；填充须温度适合、相容及符合吸湿/无卤分支 |
| 同上7.2.3、7.2.4、7.3 | 印刷8 / PDF14 | 表9及绕包厚度以假设直径选取；0.6/1kV直接包带、圆整省内衬均是有条件例外，不提供实体中心位置 |
| GB/T12706.2—2020 7.1、8.1、8.2.1、8.2.2 | 印刷8 / PDF16 | 金属/半导电屏蔽有电压与材料例外；圆形三芯的绕包内衬要求先填充芯间隙；填充与运行温度/绝缘相容 |
| 同上8.2.3、8.2.4、8.3、8.4 | 印刷8–9 / PDF16–17 | 内衬厚度按假设直径；分相金属屏蔽相互接触，统包层的材料组合决定内衬/隔离套要求；未规定统一的实体芯坐标 |
| GB/T12706.3—2020 8.1、8.2.1 | 印刷6 / PDF11 | 三芯各线芯有金属屏蔽；内衬层采用挤包，可先包带扎紧；有护套单芯成缆不套8.2/8.3 |
| 同上8.2.2、8.2.3 | 印刷7 / PDF12 | 填充和内衬适合运行温度、与绝缘相容；非纵向阻水型采用非吸湿材料；表7提供假设直径对应内衬厚度，未规定空隙实体形状 |
| 同上8.3 | 印刷7 / PDF12 | 分相金属层相互接触；统包层存在时须核对材料组合、内衬或隔离套；无统包层且外形圆整时可省内衬 |
| 同上A.2.3 | 印刷33 / PDF38 | 成缆系数2.16用于假设直径计算，与实体中心坐标、接触几何及绕绞节距不是同一量 |

以上说明按本轮原页复核；各电压部分独立适用。三维线程应让工程师给出每芯中心坐标(m)、导体及各屏蔽/护套的实际外径、排列/相序及资料来源；需要三维绞合实体时另给节距(m)、绞向和轴向参照截面。厂家截面图、工艺定义或明确输入的几何约束可作为来源；按接触约束推导的布置须标为推导并记录输入和算法版本。缺少坐标或有效几何约束时阻止“真实芯位置”建模，保留缺项。标准参考厚度也不能替代实际外径，更不能使重叠芯自动合格。

### GB50217载流量修正：研究查询示例

先列完整表，读取返回的原始`conditions`，再按现场事实填写；不能只按电缆型号取一个通用系数。输入用SI，输出保留表中无量纲系数；来源摘要、记录摘要及基准工况随结果保存。

```python
# 空气温度校正：导体最高工作温度90°C，环境40°C
temperature_query = {
    'schema_version': 'cablesim.standards-query/1',
    'standard': 'GB 50217', 'edition': '2018', 'locator': '表D.0.1',
    'quantity': 'ampacity_correction',
    'conditions': {'voltage_v': 10000, 'installation_medium': 'air',
                   'conductor_max_working_temperature_k': 363.15,
                   'ambient_temperature_k': 313.15}
}
# status=resolved；value=1.0；unit=1；印刷72 / PDF82。
# 温度条件单位K：90°C=363.15K、40°C=313.15K；土壤热阻率K·m/W；间距m。
```

GB50217附录D的系数与附录C基准载流量及敷设条件配套。D.0.3土壤热阻率、D.0.4–D.0.7并列/桥架等条件不能脱离其表注；不插值、不跨敷设方式，也不把多个相关系数无条件相乘。附录D没有可脱离基准表通用套用的埋深系数；5.3.3的0.7m/1m是敷设深度设计规定，不是载流量修正系数。若研究要改埋深，应采用其计算插件有依据的埋深模型和明确基准，当前库只返回已有条款/参考工况，不执行载流量修正，也不改研究代码。

已有型号标准资源仍采用`type_resource_bindings.standard[SHA256({standard,source_digest})]`，固定`resource_id/asset_id/version/content_sha256`。执行标准声明`cablesim.execution-standards/1`只说明使用版本；不自动批准条款。新依据引用补充到已支持的`sources[].reference` JSON字符串，不更换原资源摘要，也不改变SDK物理事实。拟消费的JSON schema名为`cablesim.standard-basis-ref/1`：

```python
record = answer['records'][0]
basis_ref = {
    'schema': 'cablesim.standard-basis-ref/1',
    'plugin_id': answer['plugin_id'], 'plugin_version': answer['plugin_version'],
    'data_sha256': answer['data_sha256'], 'query_sha256': answer['query_sha256'],
    'query': saved_query,  # 上述查询正文；保存原条件
    'record_id': record['id'], 'record_sha256': record['record_sha256'],
    'standard': record['standard'], 'edition': record['edition'],
    'locator': record['table'] or record['clause'],
    'printed_page': record['printed_page'], 'pdf_page': record['pdf_page'],
    'source_sha256': record['source_sha256'],
    'record': record       # 固定原值、单位、条件、语义和核验快照
}
# reference=json.dumps(basis_ref, ensure_ascii=False)
# 同时保存宿主运行的request_sha256、插件发行摘要及当前型号输入修订/摘要。
```

这是稳定的消费者接入示例；消费者本轮的接入由三维线程验收。型号输入变化使既有依据引用过期；仅数据内容相同不代表新型号仍适用。历史要求、运行和规格书读已保存的record快照及摘要，不重新取“最新”值。数据插件不创建要求、不改其审批状态，人工确认仍走已有流程。

标准核对按固定标准版本、量和明确条件取唯一格；核对记录保存查询、插件版本/发行摘要、原文件摘要、record摘要及型号输入摘要。先检查`status/semantic/criterion/limitations`，再作单位转换和比较。`nominal`、`minimum`、`maximum`、`approximate`不能混用；数组必须由有依据的结构分支选定；公式参数不允许当字符串`eval`。第1类特殊用途、合金和试验程序未覆盖时不能把逐格数字核对升格为整标准合格。

运行编排的对接顺序为：宿主通过统一Executor执行`lookup`，保存`run_id`、`artifact_digests['x-cablesim.standards-basis']`及完整答复；把固定的`basis_ref`写入标准核对输入已有的来源reference载荷，由标准核对插件读取并验证摘要、型号输入身份及条件后取判据。消费者可据此使用数据，无需导入宿主算法或修改SDK。资料接口和标准核对输入适配由三维线程验收；0.4.0发行的允许版本与摘要按前述接入步骤显式审核，本轮判据清单已机械同步。

规格书优先展示查询返回的`citation`：**GB/T 12706.2—2020 表 7，第 7 页**；详情补“PDF第15页”，版本、源摘要及记录身份。公式展示“GB/T 12706.2—2020 17.5.2，第17页”及参数/单位；表值注明行条件，如“240 mm²、12/20 kV、XLPE：5.5 mm”。本轮已核验条目可由消费者替换“原文未核验”为“依据已核验”，缺项显示“本轮未覆盖”，批准状态单独保留。

## 重建与检查

```sh
python plugins/cablesim.standards-basis/src/cablesim_standards_basis/rebuild.py
python -m pytest tests/test_standards_basis.py tests/test_standards_basis_query.py tests/test_standards_basis_round.py -q
python -m pytest tests/test_standards_basis_release.py -q
python plugins/cablesim.standards-basis/validation/constants.py
# 在frontend目录用vite build --outDir ../.data/standards-basis/frontend-acceptance --emptyOutDir准备独立验收构建
node frontend/src/features/standards/tests/verify-browser.mjs
python scripts/plugin_sdk.py seal plugins/cablesim.standards-basis/plugin.json --write
python plugins/cablesim.standard-check/src/cablesim_standard_check/basis_catalog.py --write
python plugins/cablesim.type-electrical/src/cablesim_type_electrical/basis_catalog.py --write
python scripts/plugin_sdk.py seal plugins/cablesim.standard-check/plugin.json --write
python scripts/plugin_sdk.py seal plugins/cablesim.type-electrical/plugin.json --write
python scripts/plugin_sdk.py seal plugins/cablesim.gb50217-correction/plugin.json --write
python scripts/plugin_sdk.py seal
python scripts/plugin_sdk.py verify
python scripts/seal_plugin_catalog.py
```

数值修改先更新完整编制输入与独立核验矩阵，再`rebuild.py --write`；默认命令只检查，不改文件。新发行或版本更新按根AGENTS.md封签规则处理，不修改已发布版本；先升版并运行全库只读seal，再按实际受影响范围定向写入。消费者编制器只读取已完成封签的依据发行；GB校正清单中的默认依据摘要和说明须显式更新后再封签。现行工具支持显式清单路径；0.9.1分别封签四个受影响插件，仅更新对应清单、依赖锁及registry条目，其他漂移只提示。临时工作副本不入库。

相关测试覆盖人工页码数值锚点、完整矩阵尺寸、4,406条记录的条件查询/歧义拦截、出处与双路结果、确定性重建及封签、分册篡改、输入单位/缺条件、空格/多个选项/边界、不跨版本/合金派生、手算公式参数对拍，以及真实Executor进程和ASGI只读路由的缓存/并发/发行错误。土壤公式还检验干燥/饱和边界、含水率越界及缺参数；参数只是明确的手算示例，不是现场值。重建器统一UTF-8/LF字节；实际Git autocrlf检出测试核对封签、重建及读取一致性。本插件无原生求解器测试。

浏览器脚本使用正式SPA构建、backend.main真实宿主与真实Executor，SQLite只读backup发布库到隔离副本，运行后关闭任务服务/浏览器；不写源演示库；验证标准/表切换、整表行数、原页悬停、240mm²/12/20kV/XLPE→5.5mm、选格详情/准确剪贴板引用、方向键/Enter、缺条件、历史、宽表首列固定及第三批公差显示。自动布局检查覆盖1366×768与1920×1080、深浅主题、空/加载/错误/成功/历史共20项，检查溢出、重叠、13px字号、对比度及主操作数量。结果保存在不入库的`.data/standards-basis/browser-checks.json`；本轮验收截图为`thermal-capacity.png`、`accessory-tests.png`；五态中的空/加载/错误通过明确的网络故障注入，其余流程使用真实响应。五类查询收据为`real-queries.json`。任务浏览器上下文和服务在finally关闭。

两张概念图在`.data/standards-basis/concepts/browser-columns.png`及`browser-wide.png`；采用后者的顶部选择器与宽表布局，1366宽度能保留更多数值列，沿用现有白灰工作界面。图只用于布局方向，图中示意数值不构成依据。

发布库缺失的干净环境将真实使用测试标为环境缺失/skip，不能当作通过。旧孤立路由fixture已移除；任务浏览器标签页、随机端口服务及其子进程在finally关闭，隔离副本随任务清理。五态中的空/加载/错误使用明确的网络故障注入，其余来源和值由真实宿主/Executor提供。

全量结果按当前工作区实测另行交设计负责人；依据库相关检查通过不代表其他线程的工作区全绿。

0.5.0验收：相关pytest 29项通过；真实宿主/Executor、发布库只读隔离副本完成热容公式、铠装、铜带和已有五类来源查询。浏览器22项检查通过，保留两尺寸/两主题/五态20项，另覆盖土壤参数输入、成功结果、修改后的历史状态、越界字段聚焦及同条款表格隔离。截图为`.data/standards-basis/thermal-capacity.png`与`copper-manufacturing.png`，输入数字为明确手算对拍值，非城南实测。

`test:visible-text`和`test:regularity`各4页检查通过（1366/1920）；普通界面代号外露及规整发现均为0。最终`test:performance`4次真实测量均通过：标准列表冷2.321s/热0.815s，资源定位入口冷0.875s/热0.773s。无错误终态和拦截写入，首次浏览断言只发一条browse查询，后续按所选表读取。样式、TypeScript、独立生产构建通过。数据重建、SDK封签、发行目录和卫生检查通过。

全量pytest待设计负责人快照验收：观察到其他线程PID58636持续运行`python -m pytest -q -p no:cacheprovider`，30分钟等待上限后仍未结束，因此本线程未并发启动全量。不能将上述通过项称为整仓全绿；没有Git提交，8100/8200和来源发布库未写入。清理被执行工具拒绝的路径另列于`.data/standards-basis/release-report.md`，原工具只返回`blocked by policy`，无更具体原因。

## 现有IEC插件常数对拍（只读交研究线程）

`validation/constants.py`以AST读取实际插件源码，报告字段、源码摘要、值、依据记录ID及结果，既不执行算法，也不修改IEC插件。铜电阻率1.7241e-8 Ω·m、温度系数0.00393 K⁻¹、XLPE热阻率3.5 K·m/W及符合表注构造的半导电材料2.5 K·m/W一致。PVC数据6与保护护层行5不一致；原表又允许按对应绝缘等级考虑，该差异需要研究线程确认材料角色/配方，不能自动宣称算法错误。填充层没有对应通用固定值；ks/kp在现有插件是输入参数而非内置常数，本次静态常数对拍标为依据未覆盖，不代表Table2没有解析。

现有IEC热阻率常数注释写PDF41/印刷39，而本次2023 CMV原件对应PDF89/印刷33，也交研究线程修正引用定位。差异测试输出为结构化报告，检验确实识别差异；测试通过不等于所有常数一致。未修改`plugins/cablesim.iec60287`。
