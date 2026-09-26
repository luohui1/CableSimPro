# 领域模型设计（cablesim.domain/1）

版本：0.1 设计草案，待评审
日期：2026-09-26
适用：取代 `backend/schemas.py` 中的 `Scenario`（下称 v0），作为工程数据与插件输入的共同语言。评审通过前不改代码。

相关文档：[插件契约](./PLUGIN_CONTRACT.md) · [模块实施细则](./MODULE_DESIGN.md) · [结果类型](./RESULT_TYPES.md)

## 0. 一页结论

- **领域模型只描述工程事实**：电缆是什么结构、用什么材料、怎么敷设、组成哪些回路、承受什么负荷、按什么准则设计。**不包含计算方法的假设**：交流电阻系数、屏蔽损耗系数、外部热阻的计算方法、网格、收敛参数都属于插件的方法参数或插件内部推导。
- **第一版就能表达**：直埋 / 排管 / 多回路；空气 / 隧道 / 竖井 / 桥架；单芯 / 三芯 / 多芯、带铠装；稳态、周期负荷、应急负荷、短路和变化的环境温度。
- **能表达 ≠ 能计算。** 领域模型允许描述任何工况，某个工况能不能算、用哪个方法算，由插件在 `domain.supports` 和预检中声明。宿主不再写"埋深至少为外半径 10 倍"这类方法限制。
- **每个对象有稳定语义 ID**（如 `cable/c1-L2`），结果、比较、报告靠它对齐。
- **每个值有来源**：演示值、用户输入、厂家资料、标准值、推导值，以及是否经人工核对，与数值分开记录。
- **插件拿到的快照统一为 SI 单位、Z 轴向上的坐标**；界面按工程习惯显示 mm、°C、mm²。

## 1. 从 v0 `Scenario` 的问题出发

| v0 的做法 | 问题 | v1 的处理 |
| --- | --- | --- |
| `ac_extra_factor`、`screen_loss_factor` 放在电缆上 | 方法假设冒充电缆属性；换一个会计算损耗的方法就无处安放 | 移到方法插件参数；领域只记录接地方式、护套结构等决定损耗的事实 |
| 导体直径由截面积和填充系数估算 | 估算值与厂家实测直径混在一起 | 导体直径是事实输入；若由估算得到，来源标为"推导"并可见 |
| 敷设只有 `flat` / `trefoil` + 间距 | 无法表达多回路、排管、非对称布置 | 每根电缆存明确坐标；"平排 / 品字形"只是生成坐标的模板 |
| 单回路、三根单芯写死 | 无法表达多回路、并联、三芯 | 电缆类型、回路、电缆实例分开建模 |
| 长度 mm / m、温度 °C 混用 | 插件间单位约定不一致 | 存储和快照一律 SI；显示单位只在界面层 |
| 校验里含方法限制（埋深 ≥ 10 倍外半径） | 宿主替方法做判断 | 宿主只校验几何与物理一致性；方法限制由插件声明 |
| 负荷只有一个运行电流 | 无法表达周期负荷、应急和短路 | 负荷工况独立建模，支持时间序列 |

## 2. 顶层结构

```text
DomainDocument (cablesim.domain/1)
├── materials[]          材料：热、电、介电、磁、热容属性
├── cable_types[]        电缆类型：结构、分层、额定值（可引用型号库资产）
├── circuits[]           回路：电气系统、使用的电缆类型、相与电缆实例、接地方式
├── sections[]           敷设截面：沿线路的若干截面工况（直埋、排管、空气、隧道、竖井…）
│   ├── medium            周围介质与边界（土壤分层、回填、空气、隧道通风…）
│   ├── enclosures[]      排管、管道、桥架、槽盒等容纳结构
│   ├── placements[]      每根电缆实例在该截面的位置与所在容纳结构
│   └── external_sources[] 不属于本工程的外部热源（其他电缆、热力管道）
├── load_cases[]         负荷工况：稳态、周期、应急、短路；可含时间序列
├── criteria             设计准则：温度限值、护套限值、土壤临界温升等
└── provenance           每个值的来源与核对状态（按 JSON Pointer 索引）
```

一份工程当前只有一份可编辑的 `DomainDocument`（与 MODULE_DESIGN §4.1 一致）。研究运行时，宿主把它解析成**领域快照**（§9）交给插件。

## 3. 通用约定

### 3.1 单位

- 存储和快照中所有数值均为 SI：长度 m、面积 m²、温度 K、温差 K、电流 A、电压 V、功率 W、线功率 W/m、热阻率 K·m/W、电阻率 Ω·m、时间 s。
- 字段名不带单位后缀，单位由 schema 的 `x-quantity` 标注决定（例如 `thickness` 是 length，`max_conductor_temperature` 是 absolute_temperature）。
- 绝对温度与温差是不同物理量（沿用 `foundation.Quantity` 的规则），温差永远不做 273.15 偏移。
- 界面层负责显示单位换算（mm、mm²、°C、kV、Ω/km）。用户输入 "5.5 mm" 在保存时换算为 0.0055。

### 3.2 坐标

- 每个敷设截面是一个二维平面，坐标 `(x, z)`，单位 m，**Z 轴向上**（与 CableModelKit 一致）。
- 地下截面：地表为 `z = 0`，埋入的对象 `z < 0`，"埋深"是 `-z`，只在界面显示。
- 空气、隧道、竖井截面：原点为该截面的参考点（如隧道底板中心），在 `sections[].frame` 中说明。
- 电缆位置指电缆中心；三芯电缆内部各芯的位置由电缆类型的几何推导，不在截面中重复。

### 3.3 语义 ID

- 格式 `<kind>/<local-id>`，如 `material/xlpe`、`cable_type/ct-240`、`circuit/c1`、`cable/c1-L2`、`section/s-buried`、`enclosure/d3`。
- 在工程内唯一且稳定：改名只改 `label`，不改 ID；删除后 ID 不复用。
- 插件结果中的 `entity` 必须引用快照中存在的 ID；派生对象（如三芯电缆的某一芯）用路径形式 `cable/c1-A/core/2`。

### 3.4 来源与核对

数值和来源分开存放。`provenance` 以 JSON Pointer 为键：

```json
"provenance": {
  "/cable_types/0/cores/0/conductor/r20": {"kind": "manufacturer", "reference": "doc/datasheet-2025#p3", "reviewed": true},
  "/sections/0/medium/soil/thermal_resistivity": {"kind": "user", "reviewed": false},
  "/materials/2/thermal_resistivity": {"kind": "standard", "reference": "IEC 60287-2-1 表值（版次按资料填写）", "reviewed": true}
}
```

- `kind`：`demo`（演示）、`user`（用户录入）、`manufacturer`（厂家资料）、`standard`（标准值）、`measurement`（实测）、`derived`（由其他值推导）、`asset`（来自型号 / 材料库的某个版本）。
- `reviewed` 表示经过人工核对，不等于独立认证。
- 没有来源记录的值视为 `user` 且未核对。演示模板中的值必须标 `demo`，报告中可见。

## 4. 材料 `materials[]`

```json
{
  "id": "material/xlpe", "label": "XLPE 绝缘", "category": "insulation",
  "thermal_resistivity": 3.5,
  "volumetric_heat_capacity": 2.4e6,
  "relative_permittivity": 2.5, "loss_tangent": 0.001
}
```

| 属性 | 物理量 | 用于 |
| --- | --- | --- |
| `thermal_resistivity` | K·m/W | 所有热计算 |
| `volumetric_heat_capacity` | J/(m³·K) | 暂态、周期负荷 |
| `electrical_resistivity_20` / `temperature_coefficient_20` | Ω·m、1/K | 导体、护套、铠装的电阻 |
| `relative_permittivity` / `loss_tangent` | 无量纲 | 介质损耗 |
| `relative_permeability` | 无量纲 | 磁性铠装、钢管 |
| `dry_thermal_resistivity` / `critical_temperature_rise` | K·m/W、K | 土壤干燥（两区模型等） |
| `emissivity` / `solar_absorptivity` | 无量纲 | 空气中敷设的辐射与日照 |

- `category`：`conductor`、`semiconductor`、`insulation`、`metal`（护套、屏蔽、铠装）、`polymer`（外护套、垫层）、`filler`、`soil`、`backfill`、`concrete`、`duct`、`fluid`（空气、水、膨润土）。
- 属性可以是常数，也可以是随温度变化的表 `{"table": {"temperature": [...], "value": [...]}}`；插件声明是否支持温度相关属性。
- 材料可以是工程内定义，也可以引用材料库资产（`asset: {asset_id, version, content_sha256}`），快照中总是给出解析后的数值。

## 5. 电缆类型 `cable_types[]`

电缆类型描述"一种电缆"的结构，可被多个回路使用；可以引用型号库资产（MODULE M04）。

```json
{
  "id": "cable_type/ct-240", "label": "Cu/XLPE/CWS/PE 12/20 kV 1×240",
  "construction": "single_core",
  "rating": {"u0": 12000, "u": 20000, "um": 24000,
             "max_conductor_temperature": {"normal": 363.15, "emergency": 378.15, "short_circuit": 523.15}},
  "cores": [{
    "id": "core/1",
    "conductor": {"material": "material/copper", "form": "stranded_round_compacted",
                  "nominal_area": 240e-6, "diameter": 0.0182, "r20": 7.54e-5},
    "layers": [
      {"role": "conductor_screen",  "material": "material/semicon", "thickness": 0.0006},
      {"role": "insulation",        "material": "material/xlpe",    "thickness": 0.0055},
      {"role": "insulation_screen", "material": "material/semicon", "thickness": 0.0007}
    ]
  }],
  "common_layers": [
    {"role": "metallic_screen", "material": "material/copper", "form": "wires", "wire_count": 50, "wire_diameter": 0.0008, "lay_length": 0.3},
    {"role": "separator",       "material": "material/pe",     "thickness": 0.0003},
    {"role": "oversheath",      "material": "material/pe",     "thickness": 0.0025}
  ]
}
```

### 5.1 结构类型 `construction`

| 取值 | 含义 | `cores` | 芯的排布 |
| --- | --- | --- | --- |
| `single_core` | 单芯电缆 | 1 | 位于中心 |
| `three_core` | 三芯电缆（分相屏蔽或统包） | 3 | 品字形，由 `core_arrangement` 给出中心距或由芯外径推导 |
| `multi_core` | 低压多芯（含中性线、保护线） | 2–5 或更多 | `core_arrangement` 给出每芯位置或标准排布 |

扇形芯、异形结构通过 `conductor.form = "sectoral"` 与 `core_arrangement.positions` 表达；插件声明是否支持。

### 5.2 导体 `conductor`

| 字段 | 说明 |
| --- | --- |
| `material` | 铜、铝等材料 ID |
| `form` | `solid_round`、`stranded_round`、`stranded_round_compacted`、`segmental`（分割导体）、`hollow`、`sectoral` |
| `nominal_area` | 标称截面积 m² |
| `diameter` | 导体外径 m（厂家值优先；推导值在来源中标 `derived`） |
| `r20` | 20 °C 直流电阻 Ω/m；可以缺失，缺失时由方法决定失败还是按其声明的规则处理 |
| `inner_diameter` | 中空导体内径 |
| `segments` / `wire_count` | 分割数、单线根数（影响集肤、邻近效应系数的取值，由方法使用） |
| `insulated_wires` | 分割导体单线是否绝缘（大截面导体常见） |

集肤、邻近效应的系数不在这里，由方法按 `form` 等事实推导或作为方法参数。

### 5.3 分层 `layers[]` / `common_layers[]`

分层按从内到外的顺序排列，`layers` 属于每一芯，`common_layers` 包在所有芯外面（单芯电缆两者等价，推荐只用 `common_layers` 放芯外公共层）。

| `role` | 典型材料 | 几何字段 |
| --- | --- | --- |
| `conductor_screen`、`insulation_screen` | 半导电材料 | `thickness` |
| `insulation` | XLPE、EPR、PVC、油纸 | `thickness` |
| `metallic_screen` | 铜丝、铜带 | `form: wires` + `wire_count`、`wire_diameter`、`lay_length`；或 `form: tape` + `thickness`、`overlap` |
| `metallic_sheath` | 铅、平铝、皱纹铝、铜 | `form: smooth` + `thickness`；`form: corrugated` + `inner_diameter`、`outer_diameter`、`thickness` |
| `bedding`、`separator`、`filler`、`binder` | 聚合物、填充 | `thickness`；三芯填充可用 `fill_material` |
| `armour` | 钢丝、钢带、非磁性金属丝 | `form: wires` / `tape`，`wire_count`、`wire_diameter`、`lay_length`，材料带 `relative_permeability` |
| `oversheath` | PE、PVC | `thickness` |

宿主校验：每层厚度为正、从内到外连续、金属层参数与 `form` 相符。宿主据此计算各层内外径（纯几何，不是物理模型），快照中同时给出输入值和推导的直径，推导值标记为 `derived`。

### 5.4 额定值 `rating`

`u0`、`u`、`um`（V），各运行状态下的导体最高允许温度（K）。它们是电缆类型的事实（来自标准或厂家），工程可以在 `criteria` 中给出更严格的限值。

## 6. 回路 `circuits[]`

```json
{
  "id": "circuit/c1", "label": "1# 馈线",
  "system": {"kind": "ac_three_phase", "frequency": 50, "voltage": 20000},
  "cable_type": "cable_type/ct-240",
  "cables": [
    {"id": "cable/c1-L1", "phase": "L1"},
    {"id": "cable/c1-L2", "phase": "L2"},
    {"id": "cable/c1-L3", "phase": "L3"}
  ],
  "bonding": {"kind": "cross_bonded", "minor_section_lengths": [480, 500, 520], "transposed": true}
}
```

| 字段 | 说明 |
| --- | --- |
| `system.kind` | `ac_three_phase`、`ac_single_phase`、`dc`（`dc` 以 `polarity` 代替相） |
| `cable_type` | 本回路使用的电缆类型 |
| `cables[]` | 电缆实例。单芯三相回路 3 根；**每相并联 n 根**时每相多根，`phase` 相同、`parallel_index` 区分；三芯电缆每回路 1 根，`phase` 为 `L1L2L3` |
| `bonding` | 金属护套 / 屏蔽的接地方式：`both_ends`（两端接地）、`single_point`（单端接地）、`cross_bonded`（交叉互联，含各小段长度）、`none`；另可给出接地回流线 `ecc` |

接地方式是决定护套损耗的事实，护套损耗系数本身由方法计算或作为方法参数，不写在这里。

## 7. 敷设截面 `sections[]`

一条线路沿途可能经过多种敷设方式（直埋段、穿管过路段、隧道段）。每个截面描述一种二维横截面工况，列出经过该截面的电缆实例及其位置；载流量通常由最不利截面决定。第一阶段界面可以只编辑一个截面，模型上允许多个。

```json
{
  "id": "section/s-buried", "label": "直埋段", "kind": "ground",
  "length": 1200,
  "medium": {
    "surface_temperature": 298.15,
    "soil": {"material": "material/soil-native"},
    "zones": [{"id": "zone/backfill", "shape": {"rect": {"x": -0.6, "z": -1.3, "width": 1.2, "height": 0.8}},
               "material": "material/sand-cement"}]
  },
  "enclosures": [],
  "placements": [
    {"cable": "cable/c1-L1", "x": -0.035, "z": -0.97},
    {"cable": "cable/c1-L2", "x":  0.0,   "z": -0.91},
    {"cable": "cable/c1-L3", "x":  0.035, "z": -0.97}
  ],
  "layout_template": {"kind": "trefoil", "depth": 0.95, "spacing": 0.07}
}
```

`layout_template` 只记录界面用于生成坐标的模板参数，**计算以 `placements` 的坐标为准**。

### 7.1 截面种类 `kind`

| `kind` | 覆盖工况 | `medium` 的主要内容 | 常用 `enclosures` |
| --- | --- | --- | --- |
| `ground` | 直埋、排管、回填、多回路 | 地表温度（常数或时间序列）、原状土材料、分层土 `layers[]`、回填 / 混凝土区域 `zones[]` | `duct_bank`（混凝土包封，内含 `ducts`）、`duct`（单管） |
| `air` | 自由空气、沿墙、桥架 / 梯架 | 空气温度、日照强度与是否遮阳、风速；附近墙面位置 | `tray`（有孔 / 无孔托盘、梯架）、`cleat_group`（夹具固定） |
| `tunnel` | 电缆隧道、电缆沟 | 隧道断面几何、壁面材料与外侧土壤、通风方式（自然 / 强制）、风速、进风温度、隧道长度 | `tray`、`rack`（支架层） |
| `shaft` | 竖井、竖向敷设 | 竖井高度、通风条件、上下端温度 | `tray`、`cleat_group` |

扩展新的敷设方式（如桥梁、水下、管道充油）时新增 `kind`，旧插件因 `domain.supports` 未声明而自动不适用。

### 7.2 容纳结构 `enclosures[]`

| `type` | 字段 |
| --- | --- |
| `duct` | 中心坐标、内径、外径、管材材料、管内介质（`air` / `water` / `bentonite`）、`contains`（其中的电缆实例） |
| `duct_bank` | 包封外轮廓（矩形）、包封材料、`ducts[]`（上面的单管，含空管） |
| `tray` | 类型（有孔 / 无孔 / 梯架）、位置与宽度、层号、`contains` |
| `cleat_group` | 夹具固定的一组电缆，品字形或平排 |
| `rack` | 隧道内支架，包含若干层 `tray` |

校验：电缆必须完全在其容纳结构内；管子之间、管子与包封边界不重叠；地下对象全部在地表以下。

### 7.3 外部热源 `external_sources[]`

不属于本工程设计范围、但影响温度的热源：其他电缆（给出外径与单位长度损耗，或给出其温度）、热力管道（外径与表面温度）。它们只作为边界条件，不参与本工程的载流量求解。

## 8. 负荷工况与设计准则

### 8.1 负荷工况 `load_cases[]`

```json
[
  {"id": "load/steady", "kind": "steady", "currents": {"circuit/c1": 400}},
  {"id": "load/daily",  "kind": "cyclic", "period": 86400,
   "profile": {"circuit/c1": {"time": [0, 21600, 43200, 64800], "value": [0.6, 1.0, 0.9, 0.7], "interpolation": "step", "scale": "per_unit"}},
   "base_current": {"circuit/c1": 450}},
  {"id": "load/emergency", "kind": "emergency", "preload": "load/steady",
   "currents": {"circuit/c1": 650}, "duration": 7200},
  {"id": "load/fault", "kind": "short_circuit", "fault_current": {"circuit/c1": 25000}, "duration": 1.0, "initial": "load/steady"}
]
```

| `kind` | 含义 | 典型方法 |
| --- | --- | --- |
| `steady` | 给定电流的稳态运行点；为空表示"求允许电流" | 稳态载流量、运行温度 |
| `cyclic` | 周期负荷曲线（通常 24 h） | 周期载流量（IEC 60853 类方法） |
| `emergency` | 在预负荷基础上的应急电流及持续时间 | 应急 / 短时过载 |
| `short_circuit` | 故障电流及持续时间 | 短路温升 |
| `time_series` | 任意电流时间序列（如实测负荷） | 动态温度、动态增容 |

时间序列统一格式：`{"time": [...], "value": [...], "interpolation": "step" | "linear", "scale": "absolute" | "per_unit"}`，时间单位 s。环境温度、地表温度、日照强度也可以用同样的时间序列表示变化。

### 8.2 设计准则 `criteria`

工程采用的限值，优先于电缆类型的默认额定值：各运行状态的导体温度上限、金属护套温度上限、土壤临界温升（防干燥）、地表温度上限、允许的最大负荷率等。每个准则可以引用设计依据条目（M05）。

## 9. 领域快照（插件看到的内容）

研究运行时，宿主从已保存的 `DomainDocument` 生成快照：

1. **解析引用**：材料库、型号库资产展开为具体数值，同时保留 `asset` 引用（版本 + 摘要）用于追溯。
2. **推导几何**：按 §5.3 计算各层内外径，推导值标为 `derived`。
3. **统一单位与坐标**：确认全部为 SI、Z 轴向上。
4. **裁剪**：只保留本次研究涉及的截面、回路和负荷工况（研究配置指定），减小快照并明确计算范围。
5. **附带来源**：`provenance` 随快照一起给插件，插件可以在结果中引用"某个输入未经核对"作为警告。
6. **计算摘要**：`digest = content_hash(快照)`，进入运行的 `input_digest`。

插件**只能**读取快照，不能访问工程数据库或其他工程。快照一经生成不可变。

## 10. 宿主校验与插件校验的分工

| 层次 | 由谁检查 | 例子 | 失败时 |
| --- | --- | --- | --- |
| 结构 | 宿主（schema） | 类型、必填、正数、枚举取值 | 无法保存，定位到字段 |
| 一致性 | 宿主 | 分层连续、电缆不重叠、电缆在管内、对象在地表以下、ID 引用存在、回路相数与电缆数一致 | 无法保存，定位到对象 |
| 完整性 | 插件声明（`domain.requires`），宿主执行 | 该方法需要 R20、土壤干燥参数、材料热容 | 预检列出缺项，不启动插件 |
| 适用范围 | 插件声明（`domain.supports`）+ 可选 `check` 阶段 | 不支持铠装、不支持隧道、埋深过浅超出近似条件 | 预检说明不适用原因 |

宿主只保证"描述是自洽的"，不判断"用某个方法算是否可靠"。

## 11. 覆盖检查：四类工况如何表达

| 工况 | 表达方式 |
| --- | --- |
| 单回路直埋品字形 | 1 个 `ground` 截面，3 个 `placements`，`layout_template: trefoil` |
| 多回路直埋、不同回路不同电缆 | 多个 `circuits`，各自 `cable_type`；同一截面内多组 `placements` |
| 排管（混凝土包封 3×3 管，部分空管） | `enclosures: duct_bank` + 9 个 `ducts`，电缆放在指定管内，空管 `contains` 为空 |
| 回填沙 / 分层土 | `medium.zones`（回填区域）、`medium.layers`（分层土） |
| 空气中桥架、多层 | `air` 截面 + 多个 `tray`，电缆在托盘内的位置 |
| 隧道支架多层多回路 | `tunnel` 截面，通风参数，`rack` 含若干层 `tray` |
| 竖井 | `shaft` 截面，高度与通风条件 |
| 三芯铠装电缆（海缆、配网电缆） | `construction: three_core`，`common_layers` 含 `metallic_sheath`、`bedding`、`armour`（磁性材料） |
| 低压四芯 / 五芯电缆 | `construction: multi_core`，`cores` 含中性线、保护线，`core_arrangement` |
| 每相并联两根 | `circuits[].cables` 每相两个实例，`parallel_index` 区分 |
| 交叉互联 | `bonding: cross_bonded` + 各小段长度 |
| 24 h 周期负荷 | `load_cases: cyclic` + 负荷曲线；材料带 `volumetric_heat_capacity` |
| 应急过载 2 h | `load_cases: emergency`，引用预负荷 |
| 短路温升 | `load_cases: short_circuit` |
| 日照、季节地温变化 | `air.medium` 日照；`surface_temperature` 用时间序列 |
| 附近的热力管道 | `external_sources` |

## 12. 从 v0 `Scenario` 迁移

| v0 字段 | v1 位置 |
| --- | --- |
| `cable.conductor`、`area_mm2` | `materials` + `cable_types[].cores[0].conductor.material / nominal_area` |
| `cable.fill_factor` | 不再保留；用它推导出的导体直径写入 `conductor.diameter`，来源标 `derived` |
| `cable.r20_ohm_km` | `conductor.r20`（Ω/m） |
| `cable.*_mm` 各层厚度 | `layers` / `common_layers` 的 `thickness`（m） |
| `cable.*_rho_k_m_w` | 各层材料的 `thermal_resistivity` |
| `cable.u0_kv`、`frequency_hz` | `rating.u0`、`circuits[].system.frequency` |
| `cable.relative_permittivity`、`tan_delta` | 绝缘材料属性 |
| `cable.ac_extra_factor`、`screen_loss_factor` | **移出领域**：热网络插件的方法参数；迁移时写入已有研究的参数，来源标为 v0 用户输入 |
| `cable.max_temperature_c` | `rating.max_conductor_temperature.normal` 与 `criteria` |
| `installation.arrangement`、`depth_m`、`spacing_m` | 生成 `placements` 坐标；原值保存在 `layout_template` |
| `installation.ambient_temperature_c` | `ground` 截面的 `surface_temperature` |
| `installation.soil_rho_k_m_w` | 原状土材料的 `thermal_resistivity` |
| `operating_current_a` | `load_cases: steady` |
| `circuit_length_m` | `sections[].length` |
| v0 校验"埋深 ≥ 10 倍外半径" | 移到热网络插件的 `domain.supports` / `check` |

迁移是确定性转换：旧工程按原 revision 生成新文档并形成新版本，原 v0 数据保留只读；转换不能表达的内容明确报告，不静默丢弃。已有运行记录保持原样，仍按 v0 输入展示。

## 13. 不在领域模型里的东西

- 方法假设与数值设置：交流电阻系数、护套 / 铠装损耗系数、外部热阻算法、互热计算方式、网格、收敛容差。
- 计算结果：允许电流、温度、损耗、场。
- 界面状态：视图角度、选中对象、面板布局。
- 厂家原始文件：属于资料库（M05），领域中只保存引用和核对状态。

## 14. 待评审问题

1. **多截面**：第一阶段界面只编辑一个截面，但模型允许多个。是否需要从第一版起就在界面上支持"线路多段、取最不利截面"？
2. **三芯电缆内部几何**：芯的排布是由宿主按芯外径推导，还是要求用户（或型号库）明确给出？推导适合标准结构，异形结构必须明确给出。
3. **土壤湿度迁移**：目前只用"干区热阻率 + 临界温升"表达，满足常用的两区模型。是否需要表达更完整的土壤水分参数？
4. **直流电缆**：`system.kind = dc` 已预留。HVDC 的电场与空间电荷问题是否在近期范围内？
5. **隧道的纵向**：隧道通风的纵向温升本质上是沿长度方向的问题。第一版用"截面 + 隧道长度 + 进风温度"表达，是否足够？
