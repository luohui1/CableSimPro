# 结果类型设计（cablesim.results/1）

版本：0.1 设计草案，待评审
日期：2026-09-26
适用：插件输出（`result.json`，见[插件契约](./PLUGIN_CONTRACT.md) §5.4）的类型体系，以及前端、报告、比较、研究驱动器和工程助手对结果的统一处理方式。

相关文档：[插件契约](./PLUGIN_CONTRACT.md) · [领域模型](./DOMAIN_MODEL.md) · [模块实施细则](./MODULE_DESIGN.md)

## 0. 一页结论

- 插件输出由三部分组成：**物理量**（量纲和 SI 单位）、**语义键**（这个数是什么，如 `ampacity`）、**结果类型**（数据的形状，如标量、表、曲线、时间序列、截面场）。
- 前端、报告、比较、扫描、选型**只认这三样**，不认插件 ID。任何插件只要按词表输出，就能被显示、比较、写进计算书，不需要写界面代码。
- 每个结果都绑定一个领域对象（`entity`），并带有**可用性状态**。不可用时必须给出原因，界面显示原因，不显示 0 或空白。
- **执行成功**、**满足设计准则**、**经过验证**是三件不同的事，分开显示，不压缩成一个绿色对勾。
- 限值判断（温度是否超限、负荷率）由宿主按工程的设计准则统一计算。这是比较运算，不是物理计算，不违背"宿主不内置算法"。

## 1. 物理量 `quantities`

每个物理量有固定量纲和 SI 单位；显示单位只在界面和报告中使用。

| 物理量 | SI 单位 | 常用显示单位 |
| --- | --- | --- |
| `length` | m | mm、m、km |
| `area` | m² | mm² |
| `current` | A | A、kA |
| `voltage` | V | kV |
| `absolute_temperature` | K | °C |
| `temperature_difference` | K | K（温差不做 273.15 换算） |
| `time` | s | s、min、h |
| `frequency` | Hz | Hz |
| `power` | W | W、kW |
| `linear_power` | W/m | W/m |
| `linear_resistance` | Ω/m | Ω/km |
| `linear_thermal_resistance` | K·m/W | K·m/W（电缆各层、外部热阻） |
| `thermal_resistivity` | K·m/W | K·m/W（材料属性，与上一项单位相同但含义不同，不能混用） |
| `linear_capacitance` | F/m | nF/km、µF/km |
| `electric_field` | V/m | kV/mm |
| `magnetic_flux_density` | T | µT |
| `current_density` | A/m² | A/mm² |
| `ratio` | 1 | 无量纲或 %（如损耗系数、负荷率） |

单位相同但物理含义不同的量（例如热阻与热阻率）必须用不同的物理量名，比较和换算时不能互相替代。

## 2. 语义键 `keys`

语义键规定"这个结果是什么"，每个键对应固定的物理量。研究驱动器、比较和报告模板按键工作。

| 键 | 物理量 | 典型粒度 | 说明 |
| --- | --- | --- | --- |
| `ampacity` | current | circuit | 允许电流（满足准则的最大电流） |
| `conductor_temperature` | absolute_temperature | core | 导体温度 |
| `sheath_temperature` | absolute_temperature | cable | 金属护套 / 屏蔽温度 |
| `surface_temperature` | absolute_temperature | cable | 电缆外表面温度 |
| `ground_surface_temperature` | absolute_temperature | point | 地表温度 |
| `losses.conductor` / `losses.sheath` / `losses.armour` / `losses.dielectric` | linear_power | core / cable | 各部分单位长度损耗 |
| `losses.total` | linear_power 或 power | cable / circuit | 合计损耗 |
| `loss_factor.sheath` / `loss_factor.armour` | ratio | cable | 护套、铠装损耗与导体损耗之比 |
| `ac_resistance` | linear_resistance | core | 运行温度下的交流电阻 |
| `thermal_resistance.<part>` | linear_thermal_resistance | cable | 绝缘、垫层、外护套、外部等各部分热阻 |
| `mutual_thermal_resistance` | linear_thermal_resistance | cable × cable | 电缆之间的互热阻（矩阵） |
| `capacitance` | linear_capacitance | core | 单位长度电容 |
| `time_to_limit` | time | core | 暂态下达到温度限值所需时间 |
| `emergency_rating` | current | circuit | 给定持续时间的应急允许电流 |
| `cyclic_rating_factor` | ratio | circuit | 周期负荷系数 |
| `short_circuit_temperature` | absolute_temperature | core / cable | 短路结束时温度 |
| `temperature_field` | absolute_temperature | section | 截面温度场（见 §3 场类型） |
| `electric_field_distribution` / `magnetic_field_distribution` | electric_field / magnetic_flux_density | section | 截面电场、磁场 |

同一个键可以以不同类型出现，例如 `conductor_temperature` 既有 `quantity`（某工况下的值），也有 `curve`（随电流变化）。结果由"键 + 类型 + 实体 + 工况"唯一确定，比较和报告按这四项对齐。

**扩展**：插件可以定义自己的键，必须带发布者前缀，如 `x-acme.hotspot_index`，并在清单中声明物理量。自定义键仍按类型通用显示，但不会被选型等驱动器当作标准目标使用。常用的自定义键经评审后可以收入标准词表（词表次版本号升级）。

## 3. 结果类型 `types`

所有结果共用一个外层结构：

```json
{
  "key": "conductor_temperature",
  "type": "quantity",
  "entity": "cable/c1-L2/core/1",
  "case": "load/steady",
  "status": "available",
  "value": 351.4, "unit": "K",
  "uncertainty": null
}
```

| 字段 | 说明 |
| --- | --- |
| `key` / `type` | 语义键与结果类型 |
| `entity` | 领域快照中的语义 ID；场结果为截面 ID |
| `case` | 对应的负荷工况或批量 case |
| `status` | `available`、`unavailable`（带 `reason` 代码和说明）、`not_computed`（本次未请求） |
| `unit` | 必须是该物理量的 SI 单位；宿主校验 |
| `uncertainty` | 可选：`{"kind": "bracket", "low": …, "high": …}`（区间夹逼得到的值）或 `{"kind": "estimate", "value": …, "basis": "网格收敛 GCI"}` |

宿主在封存时为每个结果补充来源信息：运行 ID、插件 ID 与版本、能力 ID、输入摘要。插件不需要也不能自己填写。

### 3.1 类型一览

| type | 数据 | 前端显示 | 报告 | 可比较方式 |
| --- | --- | --- | --- | --- |
| `quantity` | 单个数值 | 数值 + 显示单位；按实体组成三相 / 多回路明细表 | 表格行 | 同键、同实体、同工况直接相减 |
| `table` | 列（每列一个键和物理量）+ 行（每行一个实体） | 表格 | 表格 | 按行实体和列键对齐 |
| `matrix` | 行实体 × 列实体，一个物理量 | 矩阵表 / 热图 | 表格 | 实体集合相同时逐项比较 |
| `curve` | x 物理量、y 物理量、若干条系列（每条对应一个实体） | 折线图，坐标轴带单位 | 图 + 数据表 | 同 x 取值时比较，否则只并排显示 |
| `time_series` | 时间（s）+ 各实体的值；可附 `events`（如超限时刻） | 时间曲线，叠加准则限值线 | 图 + 关键时刻表 | 同时间轴比较；否则比较极值与时刻 |
| `field.section2d` | 工件文件（VTU）+ 摘要：最小值、最大值及位置、网格规模 | 等比例截面云图，真实坐标与单位，可叠加等值线和电缆轮廓 | 图 + 摘要 | 网格摘要相同才逐点比较；否则只比较摘要 |
| `geometry` | 工件文件（STEP、GLB）+ 用途（`analysis` / `display`） | 三维查看器，标明用途 | 截图 | 只比较来源与摘要 |
| `mesh` | 工件文件（MSH）+ 规模、质量统计 | 网格查看、统计表 | 统计表 | 比较统计量 |
| `check` | 一项检查的结论：`{criterion, value, limit, satisfied}` | 通过 / 不通过标记，与执行状态分开 | 准则检查表 | — |

新增类型（如三维场、沿线路分布）需要同时定义：数据结构、前端渲染器、报告渲染、比较规则。四项齐全才收入词表。

## 4. 宿主统一派生的结果

以下结果由宿主根据插件结果和工程设计准则计算。它们是定义性运算（比较、相除、取最大），不涉及物理模型，所以由宿主统一做，保证所有插件口径一致：

| 派生结果 | 规则 |
| --- | --- |
| 准则检查（`check`） | 对每个带限值的准则，取对应键的结果与限值比较，例如导体温度与导体温度上限 |
| 温度裕度 | 限值减对应温度；温差物理量 |
| 负荷率 | 负荷工况电流 ÷ `ampacity`，同一回路 |
| 最热相 / 最热电缆 | 同一回路中对应温度键取最大的实体 |
| 最不利截面 | 多截面时，各截面 `ampacity` 的最小者 |

插件如果输出了同名结果，以插件结果为准，并在界面上标明来源。

## 5. 显示规则

1. **界面不显示没有来源的数字**：每个数值都能展开查看运行、插件版本、输入摘要。
2. **不可用就显示原因**：`unavailable` 显示原因说明，并链接到缺失的输入字段（如果原因是输入缺失）。
3. **三种状态分开显示**：
   - 执行状态：成功 / 失败 / 已取消；
   - 设计准则：满足 / 不满足 / 无法判断；
   - 验证等级：插件声明的验证等级。
4. **历史结果有明确标识**：结果属于旧版本输入时，显示对应的工程版本及它和当前输入的差异，不当作当前结果展示。
5. **精度**：存储保持完整精度；显示按物理量设定有效位数（例如电流取整到 1 A，温度保留 0.1 K），报告同一规则。不因显示四舍五入而改变准则判断。
6. **单位**：显示单位按物理量设默认值（温度 °C、截面 mm²），用户可在设置中切换；换算只在显示层进行。

## 6. 研究驱动器如何使用结果

| 驱动器 | 使用的键和类型 | 说明 |
| --- | --- | --- |
| 参数扫描 | 任意 `quantity` 键 | 以扫描参数为 x、所选键为 y 生成 `curve`；每个采样点保留成败状态，失败点不画成数值 |
| 反向选型 | `ampacity`（或用户选的目标键）+ `check` | 每个候选的结果与准则检查一起排序；不满足准则的候选列出原因 |
| 方案比较 | 所有同键、同实体的结果 | 先显示输入差异、方法差异，再显示结果差异 |
| 交叉校核 | 两个方法的同键结果 | 显示绝对差和相对差，并列出两个方法的局限说明；不自动判断哪个正确 |

## 7. 工程助手

工程助手解释结果时只能引用具体结果条目（运行 ID + 键 + 实体），不能自行生成数值。回答"为什么超温"时，引用 `thermal_resistance.*`、`losses.*` 等已有结果；这些结果不存在时，回答"本次方法没有输出这项信息"。

## 8. 从现有热网络输出迁移

现有 `backend/engine.py` 的 `calculate()` 输出与新结果的对应关系：

| 现有字段 | 新结果 |
| --- | --- |
| `summary.ampacity_a` | `ampacity`（quantity，circuit） |
| `rating.temperatures_c`、`operating.temperatures_c` | `conductor_temperature`（quantity，每芯；`case` 分别为求载流量工况和运行工况） |
| `summary.operating_max_temperature_c`、`limiting_phase` | 宿主派生：最热相 |
| `summary.thermal_margin_c` | 宿主派生：温度裕度 |
| `summary.utilization_percent` | 宿主派生：负荷率 |
| `summary.circuit_loss_kw`、各相损耗 | `losses.total`（circuit）与 `losses.*`（每根电缆） |
| `thermal.layer_resistances_k_m_w` | `table`：各层 `thermal_resistance.<part>` |
| `thermal.soil_matrix_k_m_w`、`conductor_influence_matrix_k_m_w` | `matrix`：`mutual_thermal_resistance` |
| `thermal.capacitance_nf_km`、`dielectric_loss_w_m` | `capacitance`、`losses.dielectric` |
| `thermal.r20_ohm_km`、`alpha_per_k` | 不是结果，是插件实际采用的输入：放入运行证据的"采用参数"表 |
| `curve` | `curve`：x = current，y = conductor_temperature |
| `field` | `field.section2d`：`temperature_field` |
| `warnings`、`sources` | 运行的警告列表；方法局限与标准引用来自插件清单 |
| `geometry` | 不是计算结果，由领域快照推导显示 |

## 9. 版本

- 词表版本 `cablesim.results/1`，插件在清单中声明使用的词表主版本。
- 新增物理量、键、类型：次版本升级，旧插件不受影响。
- 改变已有键的物理量或含义：主版本升级，旧运行结果按原版本解释和显示。

## 10. 待评审问题

1. **不确定度**：目前只支持"区间"和"估计"两种形式。是否需要按标准要求报告测量不确定度或置信水平？
2. **沿线路分布**：隧道纵向温升、长线路的温度分布属于"沿线路位置 → 值"的一维分布，是否在第一版加入 `profile.along_route` 类型？
3. **三维场**：第一版不包含三维场类型（接头、终端的三维热场）。需要时单独定义。
4. **报告模板**：报告按类型通用生成。是否还需要支持客户自定义计算书模板（例如企业自己的格式）？
