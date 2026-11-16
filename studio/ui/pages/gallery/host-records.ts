// Round two's examples, computed on this branch's own host (8212, user label 工程师) on 2026-11-16 and copied unchanged:
// the public sample workbook inspected and previewed, a project on YJV22-8.7/15 kV 3×240 (version 3, the same structure as
// version 1) rated, swept over the soil resistivity and asked to select a size for 400 A, version 1 submitted, approved,
// published and exported, version 3 submitted by 工程师 and approved by 审核员 (the host run under each label in turn),
// and the stored ampacity table and short-circuit results of version 1.

export const IMPORT = {
 "ready": 11,
 "failed": 0,
 "file": "人民电缆 8.7-15kV 结构表（公开手册）.xlsx",
 "sheets": [
  {
   "name": "表1 YJV",
   "headerRows": [
    3,
    4
   ],
   "firstDataRow": 5,
   "dataRows": 13
  },
  {
   "name": "表2 YJV",
   "headerRows": [
    3,
    4
   ],
   "firstDataRow": 5,
   "dataRows": 11
  },
  {
   "name": "表3 YJV22",
   "headerRows": [
    3,
    4
   ],
   "firstDataRow": 5,
   "dataRows": 11
  },
  {
   "name": "表5 YJV32",
   "headerRows": [
    3,
    4
   ],
   "firstDataRow": 5,
   "dataRows": 11
  }
 ],
 "sheet": "表3 YJV22",
 "columns": [
  {
   "letter": "A",
   "header": "标称截面 mm²",
   "field": "area",
   "sample": [
    25,
    35,
    50
   ]
  },
  {
   "letter": "B",
   "header": "导体外径 mm",
   "field": "conductor_diameter",
   "sample": [
    6,
    7,
    8.1
   ]
  },
  {
   "letter": "C",
   "header": "绝缘标称厚度 mm",
   "field": "insulation_thickness",
   "sample": [
    4.5,
    4.5,
    4.5
   ]
  },
  {
   "letter": "D",
   "header": "内衬层厚度 mm",
   "field": "bedding_thickness",
   "sample": [
    1.4,
    1.4,
    1.5
   ]
  },
  {
   "letter": "E",
   "header": "钢带厚度 mm",
   "field": "armour_tape_thickness",
   "sample": [
    0.5,
    0.5,
    0.5
   ]
  },
  {
   "letter": "F",
   "header": "护套标称厚度 mm",
   "field": "oversheath_thickness",
   "sample": [
    2.5,
    2.6,
    2.7
   ]
  },
  {
   "letter": "G",
   "header": "电缆近似外径 mm",
   "field": "outer_diameter",
   "sample": [
    52,
    54,
    58
   ]
  },
  {
   "letter": "H",
   "header": "电缆近似重量 kg/km YJV22",
   "field": "weight",
   "sample": [
    3164,
    4091,
    4715
   ]
  },
  {
   "letter": "I",
   "header": "电缆近似重量 kg/km YJY23",
   "field": null,
   "sample": [
    17935,
    3343,
    3800
   ]
  },
  {
   "letter": "J",
   "header": "电缆近似重量 kg/km YJLV22",
   "field": null,
   "sample": [
    3139,
    3433,
    3824
   ]
  },
  {
   "letter": "K",
   "header": "电缆近似重量 kg/km YJLY23",
   "field": null,
   "sample": [
    2868,
    3142,
    3501
   ]
  }
 ],
 "fields": {
  "area": {
   "label": "标称截面",
   "unit": "mm²"
  },
  "conductor_diameter": {
   "label": "导体外径",
   "unit": "mm"
  },
  "conductor_wire_count": {
   "label": "导体单线根数",
   "unit": "根"
  },
  "conductor_wire_diameter": {
   "label": "导体单线直径",
   "unit": "mm"
  },
  "r20": {
   "label": "20 °C 导体直流电阻",
   "unit": "Ω/km"
  },
  "conductor_screen_thickness": {
   "label": "导体屏蔽厚度",
   "unit": "mm"
  },
  "insulation_thickness": {
   "label": "绝缘标称厚度",
   "unit": "mm"
  },
  "insulation_screen_thickness": {
   "label": "绝缘屏蔽厚度",
   "unit": "mm"
  },
  "screen_tape_thickness": {
   "label": "铜带厚度",
   "unit": "mm"
  },
  "screen_tape_width": {
   "label": "铜带宽度",
   "unit": "mm"
  },
  "screen_tape_overlap": {
   "label": "铜带标称搭盖率",
   "unit": "%"
  },
  "binder_thickness": {
   "label": "包带厚度",
   "unit": "mm"
  },
  "bedding_thickness": {
   "label": "内衬层厚度",
   "unit": "mm"
  },
  "armour_tape_thickness": {
   "label": "钢带厚度",
   "unit": "mm"
  },
  "armour_tape_width": {
   "label": "钢带宽度",
   "unit": "mm"
  },
  "armour_wire_diameter": {
   "label": "钢丝直径",
   "unit": "mm"
  },
  "armour_wire_count": {
   "label": "钢丝根数",
   "unit": "根"
  },
  "oversheath_thickness": {
   "label": "外护套标称厚度",
   "unit": "mm"
  },
  "outer_diameter": {
   "label": "电缆近似外径",
   "unit": "mm"
  },
  "weight": {
   "label": "电缆近似重量",
   "unit": "kg/km"
  }
 },
 "designation": {
  "model": "YJV22",
  "description": "铜芯交联聚乙烯绝缘双钢带铠装聚氯乙烯护套电力电缆",
  "insulation": "XLPE",
  "conductor": "copper",
  "sheath": "PVC",
  "armour": "双钢带铠装"
 },
 "rows": [
  {
   "row": 5,
   "key": "3×25",
   "ok": true,
   "od": 52.00000000000001,
   "listed": 49.846489906178235,
   "residual": 1.0767550469108835,
   "tolerance": 1.02,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 6,
   "key": "3×35",
   "ok": true,
   "od": 54,
   "listed": 52.20119044455749,
   "residual": 0.8994047777212549,
   "tolerance": 1.04,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 7,
   "key": "3×50",
   "ok": true,
   "od": 58,
   "listed": 54.97136103677466,
   "residual": 1.51431948161267,
   "tolerance": 1.08,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 8,
   "key": "3×70",
   "ok": true,
   "od": 62,
   "listed": 59.449822005857314,
   "residual": 1.2750889970713428,
   "tolerance": 1.1199999999999999,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 9,
   "key": "3×95",
   "ok": true,
   "od": 66,
   "listed": 63.09734286726411,
   "residual": 1.4513285663679474,
   "tolerance": 1.16,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 10,
   "key": "3×120",
   "ok": true,
   "od": 69,
   "listed": 66.51392362099506,
   "residual": 1.2430381895024711,
   "tolerance": 1.1900000000000002,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 11,
   "key": "3×150",
   "ok": true,
   "od": 72.00000000000001,
   "listed": 69.93050437472601,
   "residual": 1.034747812636995,
   "tolerance": 1.2200000000000002,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 12,
   "key": "3×185",
   "ok": true,
   "od": 76,
   "listed": 73.79349528997075,
   "residual": 1.103252355014621,
   "tolerance": 1.26,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 13,
   "key": "3×240",
   "ok": true,
   "od": 82,
   "listed": 79.56477658208095,
   "residual": 1.2176117089595233,
   "tolerance": 1.32,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 14,
   "key": "3×300",
   "ok": true,
   "od": 88,
   "listed": 86.1051177665153,
   "residual": 0.9474411167423452,
   "tolerance": 1.38,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  },
  {
   "row": 15,
   "key": "3×400",
   "ok": true,
   "od": 95,
   "listed": 92.72280922013928,
   "residual": 1.138595389930358,
   "tolerance": 1.45,
   "placedIn": "filler",
   "warnings": [],
   "error": null
  }
 ],
 "skipped": [
  {
   "row": 17,
   "text": "注：导体外径仅供参考。"
  }
 ],
 "declaration": {
  "name": "人民电缆集团 YJV22-8.7/15 kV 三芯",
  "manufacturer": "人民电缆集团",
  "designation": "YJV22",
  "cores": 3,
  "u0_v": 8700,
  "u_v": 15000,
  "um_v": 17500,
  "standards": [
   "GB/T 12706.2-2020",
   "GB/T 3956-2008"
  ],
  "common": {
   "conductor_screen_thickness": 0.8,
   "insulation_screen_thickness": 0.7,
   "binder_thickness": 0.2,
   "screen_tape_thickness": 0.1,
   "armour_tape_width": 50
  },
  "common_basis": {
   "conductor_screen_thickness": "目录未列；取同电压等级公开结构表（江苏华远 YJV22-8.7/15 kV）的列示值",
   "insulation_screen_thickness": "目录未列；取同电压等级公开结构表（江苏华远 YJV22-8.7/15 kV）的列示值",
   "binder_thickness": "目录未列；取同电压等级公开结构表（江苏华远 YJV22-8.7/15 kV）的包带厚度",
   "screen_tape_thickness": "目录未列；取 GB/T 12706.2—2020 10.2.3 规定的最小标称厚度",
   "armour_tape_width": "目录未列；钢带损耗按间隙率计，结果与带宽无关"
  }
 }
};

export const LAYOUTS = [
 {
  "kind": "three_core_buried_single",
  "label": "三芯直埋 · 单回",
  "circuits": 1,
  "ducted": false
 },
 {
  "kind": "three_core_buried_horizontal",
  "label": "三芯直埋 · 三回水平",
  "circuits": 3,
  "ducted": false
 },
 {
  "kind": "three_core_ducts_horizontal",
  "label": "三芯排管 · 三回水平",
  "circuits": 3,
  "ducted": true
 },
 {
  "kind": "three_core_ducts_2x3",
  "label": "三芯排管 · 2×3",
  "circuits": 6,
  "ducted": true
 },
 {
  "kind": "three_core_ducts_3x3",
  "label": "三芯排管 · 3×3",
  "circuits": 9,
  "ducted": true
 }
];
export const DEFAULTS = {
 "installation": {
  "layout": "three_core_buried_single",
  "depth_m": 1.2,
  "spacing_m": null,
  "duct": null,
  "backfill": null,
  "bonding": "both_ends"
 },
 "conditions": {
  "soil_thermal_resistivity": 1,
  "ambient_temperature_c": 25,
  "frequency_hz": 50,
  "system_voltage_v": 15000,
  "currents_a": [
   300
  ]
 }
};
export const CANDIDATES = [
 {
  "id": "huayuan.yjv22-15kv-185",
  "name": "华远 YJV22-8.7/15 kV 3×185",
  "family": "YJV22-8.7/15 kV 三芯（华远公开表）",
  "state": "public",
  "review": "published"
 },
 {
  "id": "huayuan.yjv22-15kv-240",
  "name": "华远 YJV22-8.7/15 kV 3×240",
  "family": "YJV22-8.7/15 kV 三芯（华远公开表）",
  "state": "public",
  "review": "published"
 },
 {
  "id": "huayuan.yjv22-15kv-300",
  "name": "华远 YJV22-8.7/15 kV 3×300",
  "family": "YJV22-8.7/15 kV 三芯（华远公开表）",
  "state": "public",
  "review": "published"
 },
 {
  "id": "s-89150e51.3x185",
  "name": "YJV22-8.7/15 kV 3×185",
  "family": "人民电缆集团 YJV22-8.7/15 kV 三芯",
  "state": "public",
  "review": "draft"
 },
 {
  "id": "s-89150e51.3x240",
  "name": "YJV22-8.7/15 kV 3×240",
  "family": "人民电缆集团 YJV22-8.7/15 kV 三芯",
  "state": "public",
  "review": "reviewed"
 },
 {
  "id": "s-89150e51.3x300",
  "name": "YJV22-8.7/15 kV 3×300",
  "family": "人民电缆集团 YJV22-8.7/15 kV 三芯",
  "state": "public",
  "review": "draft"
 }
];

export const SWEEP = {
 "title": "扫描 · 土壤热阻率 0.8–3 K·m/W",
 "sequence": 2,
 "label": "土壤热阻率",
 "unit": "K·m/W",
 "load": 300,
 "limit": 90,
 "points": [
  {
   "value": 0.8,
   "ampacity": 491.0435199737549,
   "conductor": 46.31955102448391,
   "status": "succeeded",
   "withinLimit": true,
   "error": null
  },
  {
   "value": 1,
   "ampacity": 458.7102770805359,
   "conductor": 49.69344964107793,
   "status": "succeeded",
   "withinLimit": true,
   "error": null
  },
  {
   "value": 1.2,
   "ampacity": 432.0136785507202,
   "conductor": 53.14069060270054,
   "status": "succeeded",
   "withinLimit": true,
   "error": null
  },
  {
   "value": 1.5,
   "ampacity": 399.4638830423355,
   "conductor": 58.45467212228249,
   "status": "succeeded",
   "withinLimit": true,
   "error": null
  },
  {
   "value": 2,
   "ampacity": 358.4557235240936,
   "conductor": 67.71583673049797,
   "status": "succeeded",
   "withinLimit": true,
   "error": null
  },
  {
   "value": 2.5,
   "ampacity": 327.9097080230713,
   "conductor": 77.52326765565273,
   "status": "succeeded",
   "withinLimit": true,
   "error": null
  },
  {
   "value": 3,
   "ampacity": 304.01864647865295,
   "conductor": 87.92917579401428,
   "status": "succeeded",
   "withinLimit": true,
   "error": null
  }
 ]
};
export const SELECTION = {
 "title": "选型 · 400 A → YJV22-8.7/15 kV 3×240",
 "sequence": 3,
 "target": 400,
 "rule": "满足目标电流的候选中取导体截面最小者；截面相同取允许电流较小者。",
 "chosen": "s-89150e51.3x240",
 "candidates": [
  {
   "id": "s-89150e51.3x25",
   "name": "YJV22-8.7/15 kV 3×25",
   "area": 25,
   "ampacity": 136.61356568336487,
   "meets": false,
   "margin": -263.38643431663513,
   "conductorAtTarget": null,
   "error": null,
   "atTargetError": "该负荷下无有效稳态解；减小负荷或使用数值模型。",
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x35",
   "name": "YJV22-8.7/15 kV 3×35",
   "area": 35,
   "ampacity": 163.52524161338806,
   "meets": false,
   "margin": -236.47475838661194,
   "conductorAtTarget": null,
   "error": null,
   "atTargetError": "该负荷下无有效稳态解；减小负荷或使用数值模型。",
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x50",
   "name": "YJV22-8.7/15 kV 3×50",
   "area": 50,
   "ampacity": null,
   "meets": null,
   "margin": null,
   "conductorAtTarget": null,
   "error": "填充与内衬厚度/芯外径须在(0,0.15]，图6范围外改用数值传热方法。",
   "atTargetError": null,
   "tier": null,
   "basis": null
  },
  {
   "id": "s-89150e51.3x70",
   "name": "YJV22-8.7/15 kV 3×70",
   "area": 70,
   "ampacity": 233.04648995399475,
   "meets": false,
   "margin": -166.95351004600525,
   "conductorAtTarget": 394.2837506600098,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x95",
   "name": "YJV22-8.7/15 kV 3×95",
   "area": 95,
   "ampacity": 277.4982273578644,
   "meets": false,
   "margin": -122.50177264213562,
   "conductorAtTarget": 208.53154523930442,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x120",
   "name": "YJV22-8.7/15 kV 3×120",
   "area": 120,
   "ampacity": 315.3188645839691,
   "meets": false,
   "margin": -84.68113541603088,
   "conductorAtTarget": 147.72173418652588,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x150",
   "name": "YJV22-8.7/15 kV 3×150",
   "area": 150,
   "ampacity": 353.76845598220825,
   "meets": false,
   "margin": -46.23154401779175,
   "conductorAtTarget": 114.01836326210065,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x185",
   "name": "YJV22-8.7/15 kV 3×185",
   "area": 185,
   "ampacity": 398.53307604789734,
   "meets": false,
   "margin": -1.4669239521026611,
   "conductorAtTarget": 90.5922626279106,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x240",
   "name": "YJV22-8.7/15 kV 3×240",
   "area": 240,
   "ampacity": 458.7102770805359,
   "meets": true,
   "margin": 58.71027708053589,
   "conductorAtTarget": 71.91701770204517,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x300",
   "name": "YJV22-8.7/15 kV 3×300",
   "area": 300,
   "ampacity": 517.5013601779938,
   "meets": true,
   "margin": 117.50136017799377,
   "conductorAtTarget": 60.79149900397919,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  },
  {
   "id": "s-89150e51.3x400",
   "name": "YJV22-8.7/15 kV 3×400",
   "area": 400,
   "ampacity": 580.8238327503204,
   "meets": true,
   "margin": 180.82383275032043,
   "conductorAtTarget": 52.98958471126316,
   "error": null,
   "atTargetError": null,
   "tier": "reference",
   "basis": "单回路能力"
  }
 ]
};

export const RATING_TABLE = {
 "tierMeaning": "本敷设形式只有手算或解析自洽检查，没有公开算例的整链对照；结果供比较与初判，交付前应另行核对。",
 "tierBasis": [
  "三芯分支：六种直埋 / 排管手算核对，TB 880 算例 2 的热阻与钢丝损耗、算例 10 的钢带损耗只对照了组件，没有整链公开算例。"
 ],
 "warning": "平衡圆形三芯独立金属屏蔽；每芯环流按SL分支，公共磁性钢带/钢丝铠装按对应条款。",
 "created": "2026-11-16T03:57:50.269Z",
 "method": "cablesim.iec60287 1.2.0",
 "rows": [
  {
   "id": "three_core_buried_single@1",
   "layout": "三芯直埋 · 单回",
   "circuits": 1,
   "basis": "单回路能力",
   "ampacity": 479.3961822986603,
   "depth": 0.7,
   "soil": 1,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_buried_single@1.2",
   "layout": "三芯直埋 · 单回",
   "circuits": 1,
   "basis": "单回路能力",
   "ampacity": 452.85101532936096,
   "depth": 0.7,
   "soil": 1.2,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_buried_single@1.5",
   "layout": "三芯直埋 · 单回",
   "circuits": 1,
   "basis": "单回路能力",
   "ampacity": 420.17350792884827,
   "depth": 0.7,
   "soil": 1.5,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_buried_single@2",
   "layout": "三芯直埋 · 单回",
   "circuits": 1,
   "basis": "单回路能力",
   "ampacity": 378.54630947113037,
   "depth": 0.7,
   "soil": 2,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_buried_single@2.5",
   "layout": "三芯直埋 · 单回",
   "circuits": 1,
   "basis": "单回路能力",
   "ampacity": 347.2314774990082,
   "depth": 0.7,
   "soil": 2.5,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_buried_single@3",
   "layout": "三芯直埋 · 单回",
   "circuits": 1,
   "basis": "单回路能力",
   "ampacity": 322.5699782371521,
   "depth": 0.7,
   "soil": 3,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_ducts_horizontal@1",
   "layout": "三芯排管 · 三回水平",
   "circuits": 3,
   "basis": "全回路共同能力",
   "ampacity": 342.15837121009827,
   "depth": 0.7,
   "soil": 1,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_ducts_horizontal@1.2",
   "layout": "三芯排管 · 三回水平",
   "circuits": 3,
   "basis": "全回路共同能力",
   "ampacity": 325.0671625137329,
   "depth": 0.7,
   "soil": 1.2,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_ducts_horizontal@1.5",
   "layout": "三芯排管 · 三回水平",
   "circuits": 3,
   "basis": "全回路共同能力",
   "ampacity": 303.55817675590515,
   "depth": 0.7,
   "soil": 1.5,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_ducts_horizontal@2",
   "layout": "三芯排管 · 三回水平",
   "circuits": 3,
   "basis": "全回路共同能力",
   "ampacity": 275.4758417606354,
   "depth": 0.7,
   "soil": 2,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_ducts_horizontal@2.5",
   "layout": "三芯排管 · 三回水平",
   "circuits": 3,
   "basis": "全回路共同能力",
   "ampacity": 253.8977026939392,
   "depth": 0.7,
   "soil": 2.5,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  },
  {
   "id": "three_core_ducts_horizontal@3",
   "layout": "三芯排管 · 三回水平",
   "circuits": 3,
   "basis": "全回路共同能力",
   "ampacity": 236.6582691669464,
   "depth": 0.7,
   "soil": 3,
   "ambient": 25,
   "tier": "参考",
   "tierKey": "reference"
  }
 ],
 "version": 1,
 "tierKey": "reference"
};
export const SHORT_CIRCUIT = {
 "conditions": {
  "duration_s": "短路持续时间 1 s（规格书口径）",
  "initial_temperature_k": "短路前导体处于最高连续工作温度",
  "final_temperature_k": "XLPE 绝缘导体短路允许最高温度 250 °C（GB/T 12706.2—2020）"
 },
 "rows": [
  {
   "title": "芯 1 · 导体绝热允许短路电流",
   "value": 34340.04159876265,
   "unit": "A"
  },
  {
   "title": "芯 1 · 导体非绝热修正因数",
   "value": 1.0133930067841814,
   "unit": "1"
  },
  {
   "title": "芯 1 · 导体非绝热允许短路电流",
   "value": 34799.95800886395,
   "unit": "A"
  }
 ]
};

export const VERSIONS = [
 {
  "number": 3,
  "review": "reviewed",
  "note": "减薄后核对不过，恢复 4.5 mm",
  "created": "2026-11-16T06:05:54.260Z",
  "submitted": {
   "at": "2026-11-16T07:53:15.632Z",
   "by": "工程师",
   "note": "减薄方案不用，恢复 4.5 mm 后提交审核"
  },
  "reviewed": {
   "at": "2026-11-16T07:54:36.021Z",
   "by": "审核员",
   "note": "结构与第 1 版相同，核对结果一致"
  },
  "check": {
   "passed": 13,
   "missing": 21,
   "uncovered": 4
  }
 },
 {
  "number": 2,
  "review": "draft",
  "note": "客户要求减薄绝缘，先看是否合规",
  "created": "2026-11-16T03:57:53.765Z",
  "check": {
   "passed": 10,
   "failed": 3,
   "missing": 21,
   "uncovered": 4
  }
 },
 {
  "number": 1,
  "review": "published",
  "note": "由结构表 人民电缆 8.7-15kV 结构表（公开手册）.xlsx 导入",
  "created": "2026-11-16T03:56:36.744Z",
  "submitted": {
   "at": "2026-11-16T06:04:00.306Z",
   "by": "工程师",
   "note": "公开手册转录，提交审核"
  },
  "reviewed": {
   "at": "2026-11-16T06:04:00.361Z",
   "by": "工程师",
   "note": "结构尺寸与手册表 3 核对一致"
  },
  "published": {
   "at": "2026-11-16T06:04:00.410Z",
   "by": "工程师"
  },
  "check": {
   "passed": 13,
   "missing": 21,
   "uncovered": 4
  }
 }
];
export const DOCUMENTS = [
 {
  "title": "YJV22-8.7/15 kV 3×240 · 第 1 版",
  "version": 1,
  "review": "published",
  "created": "2026-11-16T06:04:00.476Z"
 }
];

// The initial structure GB/T 12706.2—2020 gives the same cable (cablesim.standard-check, capability structure-proposal), run
// with studio-types' core on 2026-11-15: the insulation alone, then complete with the screens the engineer states.
// The calculation is the annex chain the bedding, armour tape and oversheath came from. PRINTED is what the published
// table itself prints for 3×240 (version 1, rows of origin "table"), to set the proposal against.
export const PROPOSAL = {
 "standard": "GB/T 12706.2—2020",
 "inputs": {
  "standard": "GB/T 12706.2-2020",
  "u0_v": 8700,
  "u_v": 15000,
  "cores": 3,
  "conductor": "copper",
  "area_mm2": 240,
  "insulation": "XLPE",
  "armour": "steel_tape",
  "conductor_diameter_mm": null,
  "screened": true,
  "scope": "complete",
  "conductor_screen_thickness_mm": 0.8,
  "insulation_screen_thickness_mm": 0.7,
  "screen_tape_thickness_mm": 0.1,
  "screen_tape_width_mm": 40
 },
 "insulationOnly": {
  "dimensions": [
   {
    "field": "insulation_thickness",
    "label": "绝缘标称厚度",
    "value": 4.5,
    "unit": "mm",
    "kind": "standard",
    "clause": "表 7",
    "printed_page": 7,
    "pdf_page": 15,
    "basis": "GB/T 12706.2—2020 表 7（印刷第 7 页，PDF 第 15 页）"
   }
  ],
  "missing": [
   {
    "field": "conductor_diameter",
    "label": "导体外径",
    "unit": "mm",
    "reason": "导体外径由绞合工艺决定，标准不规定；建规格时按实际值填写"
   },
   {
    "field": "conductor_screen_thickness",
    "label": "导体屏蔽厚度",
    "unit": "mm",
    "reason": "标准只规定铜带的最小标称厚度，屏蔽层的实际厚度由工程师给定"
   },
   {
    "field": "insulation_screen_thickness",
    "label": "绝缘屏蔽厚度",
    "unit": "mm",
    "reason": "标准只规定铜带的最小标称厚度，屏蔽层的实际厚度由工程师给定"
   },
   {
    "field": "screen_tape_thickness",
    "label": "铜带厚度",
    "unit": "mm",
    "reason": "标准只规定铜带的最小标称厚度，屏蔽层的实际厚度由工程师给定"
   },
   {
    "field": "oversheath_thickness",
    "label": "外护套标称厚度",
    "unit": "mm",
    "reason": "外护套厚度由附录计算得出；需要 scope 为 complete，并给出屏蔽的厚度"
   },
   {
    "field": "outer_diameter",
    "label": "电缆近似外径",
    "unit": "mm",
    "reason": "成品外径由各层叠加后设计或实测得出；建规格时用来做外径闭合核对"
   },
   {
    "field": "bedding_thickness",
    "label": "内衬层厚度",
    "unit": "mm",
    "reason": "内衬层厚度由附录计算得出；需要 scope 为 complete，并给出屏蔽的厚度"
   },
   {
    "field": "armour_tape_thickness",
    "label": "钢带厚度",
    "unit": "mm",
    "reason": "钢带厚度由附录计算得出；需要 scope 为 complete，并给出屏蔽的厚度"
   }
  ],
  "limitations": [
   "仅提出 XLPE 绝缘及导体几何；屏蔽、护套、铠装、制造数据和物性需另行设计。",
   "标准厚度不是实测最薄点；提案不构成合格判定或型号发布。"
  ],
  "steps": 2
 },
 "complete": {
  "dimensions": [
   {
    "field": "insulation_thickness",
    "label": "绝缘标称厚度",
    "value": 4.5,
    "unit": "mm",
    "kind": "standard",
    "clause": "表 7",
    "printed_page": 7,
    "pdf_page": 15,
    "basis": "GB/T 12706.2—2020 表 7（印刷第 7 页，PDF 第 15 页）"
   },
   {
    "field": "conductor_screen_thickness",
    "label": "导体屏蔽厚度",
    "value": 0.8,
    "unit": "mm",
    "kind": "given",
    "clause": null,
    "printed_page": null,
    "pdf_page": null,
    "basis": "工程师给定"
   },
   {
    "field": "insulation_screen_thickness",
    "label": "绝缘屏蔽厚度",
    "value": 0.7,
    "unit": "mm",
    "kind": "given",
    "clause": null,
    "printed_page": null,
    "pdf_page": null,
    "basis": "工程师给定"
   },
   {
    "field": "bedding_thickness",
    "label": "内衬层厚度",
    "value": 1.8,
    "unit": "mm",
    "kind": "standard",
    "clause": "表 9",
    "printed_page": 9,
    "pdf_page": 17,
    "basis": "GB/T 12706.2—2020 表 9（印刷第 9 页，PDF 第 17 页）"
   },
   {
    "field": "armour_tape_thickness",
    "label": "钢带厚度",
    "value": 0.5,
    "unit": "mm",
    "kind": "standard",
    "clause": "表 11",
    "printed_page": 13,
    "pdf_page": 21,
    "basis": "GB/T 12706.2—2020 表 11（印刷第 13 页，PDF 第 21 页）"
   },
   {
    "field": "oversheath_thickness",
    "label": "外护套标称厚度",
    "value": 3.4,
    "unit": "mm",
    "kind": "derived",
    "clause": "14.3",
    "printed_page": 14,
    "pdf_page": 22,
    "basis": "按 GB/T 12706.2—2020 14.3 计算得出（印刷第 14 页，PDF 第 22 页）"
   },
   {
    "field": "screen_tape_thickness",
    "label": "铜带厚度",
    "value": 0.1,
    "unit": "mm",
    "kind": "given",
    "clause": null,
    "printed_page": null,
    "pdf_page": null,
    "basis": "工程师给定"
   },
   {
    "field": "screen_tape_width",
    "label": "铜带宽度",
    "value": 40,
    "unit": "mm",
    "kind": "given",
    "clause": null,
    "printed_page": null,
    "pdf_page": null,
    "basis": "工程师给定"
   }
  ],
  "missing": [
   {
    "field": "conductor_diameter",
    "label": "导体外径",
    "unit": "mm",
    "reason": "导体外径由绞合工艺决定，标准不规定；建规格时按实际值填写"
   },
   {
    "field": "outer_diameter",
    "label": "电缆近似外径",
    "unit": "mm",
    "reason": "成品外径由各层叠加后设计或实测得出；建规格时用来做外径闭合核对"
   }
  ],
  "limitations": [
   "完整尺寸采用已核验附录及正文表；实际芯位置由实体几何插件推导，填充工艺、铜带搭盖、钢带宽度与间隙、实测最薄点、物性仍须工程师补齐。",
   "标准厚度不是实测最薄点；提案不构成合格判定或型号发布。"
  ],
  "steps": 9
 },
 "calculation": [
  {
   "stage": "导体假设直径",
   "formula": "dL = 表 A.1",
   "value": 17.5,
   "unit": "mm"
  },
  {
   "stage": "绝缘线芯假设直径",
   "formula": "Dc = dL + m·ti + Δscreen",
   "value": 29.5,
   "unit": "mm"
  },
  {
   "stage": "金属屏蔽后假设直径",
   "formula": "Ds = Dc + Δs；屏蔽截面按表取不小于实际值的档",
   "value": 30.0,
   "unit": "mm"
  },
  {
   "stage": "缆芯假设直径",
   "formula": "Df = B·Dc",
   "value": 64.8,
   "unit": "mm"
  },
  {
   "stage": "内衬标称与假设厚度",
   "formula": "标称厚度查正文表；假设厚度查附录 A.2.4，二者不混用",
   "value": 1.8,
   "unit": "mm"
  },
  {
   "stage": "内衬后假设直径",
   "formula": "Dout = Din + m·t",
   "value": 66.0,
   "unit": "mm"
  },
  {
   "stage": "双钢带后假设直径",
   "formula": "Dout = Din + m·t",
   "value": 68.0,
   "unit": "mm"
  },
  {
   "stage": "挤包外护套标称厚度",
   "formula": "t = max(tmin, roundB(a·D+b))",
   "value": 3.4,
   "unit": "mm"
  }
 ],
 "method": {
  "plugin_id": "cablesim.standard-check",
  "plugin_version": "1.6.1",
  "capability": "structure-proposal",
  "method_version": "1.5.1"
 }
};

/** What the types test hands library.series.create and library.spec.create with this proposal. */
export const STANDARD_SERIES = {
 name: '按标准生成：YJV22-8.7/15 kV 三芯',
 common: [
  { field: 'binder_thickness', value: 0.2, basis: '取同电压等级公开结构表的包带厚度' },
  { field: 'armour_tape_width', value: 50, basis: '钢带损耗按间隙率计，结果与带宽无关' },
 ],
 /** The basis a dimension taken from the proposal is written with, as the created version shows it. */
 basisExample: '人工填写；GB/T 12706.2—2020 表 7（印刷第 7 页，PDF 第 15 页）',
};

export const PRINTED: Record<string, number> = {
 "area": 240,
 "conductor_diameter": 18.4,
 "insulation_thickness": 4.5,
 "bedding_thickness": 1.9,
 "armour_tape_thickness": 0.5,
 "oversheath_thickness": 3.5,
 "outer_diameter": 82,
 "weight": 12371
};

// The project of these runs (project.get p-fad964a2) and its three run records, oldest first, as the host titles them.
export const PROJECT = { id: 'p-fad964a2', name: 'YJV22-8.7/15 3×240 直埋载流量校核', cable: 's-89150e51.3x240', version: 3 };
export const RUNS = [
 { id: 'run-08e19314', sequence: 1, kind: 'rating', title: '校核 · 458.7 A', created: '2026-11-16T06:06:06.896Z' },
 { id: 'run-3a790cf5', sequence: 2, kind: 'sweep', title: '扫描 · 土壤热阻率 0.8–3 K·m/W', created: '2026-11-16T06:06:10.071Z' },
 { id: 'run-77b9dd47', sequence: 3, kind: 'selection', title: '选型 · 400 A → YJV22-8.7/15 kV 3×240', created: '2026-11-16T06:06:15.551Z' },
];

// The inputs the three runs were made with (one digest for all three) and the method that made them.
export const RUN_INPUTS = {
 "installation": {
  "layout": "three_core_buried_single",
  "depth_m": 1.2,
  "spacing_m": null,
  "duct": null,
  "backfill": null,
  "bonding": "both_ends"
 },
 "conditions": {
  "soil_thermal_resistivity": 1,
  "ambient_temperature_c": 25,
  "frequency_hz": 50,
  "system_voltage_v": 15000,
  "currents_a": [
   300
  ]
 }
};
export const RUN_METHOD = {
 "plugin": "cablesim.iec60287",
 "version": "1.2.0",
 "card": "IEC 60287 稳态载流量"
};

// The methods by name, as their plugins' manifests give them (plugins/<id>/plugin.json: name, and capabilities[].title for
// one capability). A screen writes a method as its name and version; the plugin id goes only into the sources page of a
// report or a datasheet.
export const METHOD_NAMES: Record<string, string> = {
 "cablesim.iec60287": "IEC 60287 载流量",
 "cablesim.iec60287/model-completion": "三芯工程参数与标准推导",
 "cablesim.standard-check": "产品标准尺寸核对",
 "cablesim.standard-check/structure-proposal": "XLPE 标准结构提案",
 "cablesim.type-electrical": "型号电气参数与短路容量"
};
/** A method as the screens write it: its name and version. `id` is a plugin id, or plugin/capability. */
export const methodLabel = (id: string, version: string) => `${METHOD_NAMES[id] ?? '方法未登记'} ${version}`;
/**
 * A sentence of the host that names a method by plugin id ("由 cablesim.iec60287 1.2.0 model-completion 推导"), with the
 * method's name in the id's place: 由 三芯工程参数与标准推导（IEC 60287 载流量 1.2.0）推导.
 */
export const methodsNamed = (text: string) => text.replace(/cablesim\.([\w-]+) ([\d.]+)(?: ([a-z][\w-]*))?/g, (_, id: string, version: string, capability?: string) => {
  const name = capability && METHOD_NAMES[`cablesim.${id}/${capability}`];
  return name ? `${name}（${methodLabel(`cablesim.${id}`, version)}）` : methodLabel(`cablesim.${id}`, version) + (capability ? ` ${capability}` : '');
});
/** The same from the "plugin version" string a record keeps (the rating table's method). */
export const methodText = (method: string) => methodLabel(method.split(' ')[0], method.split(' ')[1] ?? '');

// The method parameters of run-08e19314 on this branch's host (parameters, from the cable's method_defaults): the skin and
// proximity coefficients, which the method takes from the user ("由使用者按标准表给定", cablesim.iec60287 method.py).
export const RUN_PARAMETERS = {
 "ks": 1,
 "kp": 1
};

// The sizes of series s-89150e51 as this branch's host lists them (library.series.get): the spec switch of the workspace.
export const SERIES_SPECS = [
 { "id": "s-89150e51.3x25", "key": "3×25", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x35", "key": "3×35", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x50", "key": "3×50", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x70", "key": "3×70", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x95", "key": "3×95", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x120", "key": "3×120", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x150", "key": "3×150", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x185", "key": "3×185", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x240", "key": "3×240", "version": 3, "review": "reviewed" },
 { "id": "s-89150e51.3x300", "key": "3×300", "version": 1, "review": "draft" },
 { "id": "s-89150e51.3x400", "key": "3×400", "version": 1, "review": "draft" }
];

// The projects on this branch's host (/api/projects, /api/projects/<id>) with their runs, newest first: the 全部工程 page.
export const PROJECT_LIST = [
 {
  "id": "p-fad964a2",
  "name": "YJV22-8.7/15 3×240 直埋载流量校核",
  "updated": "2026-11-16T06:06:15.849Z",
  "cable": "YJV22-8.7/15 kV 3×240",
  "layout": "three_core_buried_single",
  "depth": 1.2,
  "runs": [
   {
    "id": "run-77b9dd47",
    "sequence": 3,
    "kind": "selection",
    "title": "选型 · 400 A → YJV22-8.7/15 kV 3×240",
    "by": "human",
    "status": "succeeded",
    "tier": "reference",
    "created": "2026-11-16T06:06:15.551Z"
   },
   {
    "id": "run-3a790cf5",
    "sequence": 2,
    "kind": "sweep",
    "title": "扫描 · 土壤热阻率 0.8–3 K·m/W",
    "by": "human",
    "status": "succeeded",
    "tier": "reference",
    "created": "2026-11-16T06:06:10.071Z"
   },
   {
    "id": "run-08e19314",
    "sequence": 1,
    "kind": "rating",
    "title": "校核 · 458.7 A",
    "by": "human",
    "status": "succeeded",
    "tier": "reference",
    "created": "2026-11-16T06:06:06.896Z"
   }
  ]
 },
 {
  "id": "p-34fedd43",
  "name": "YJV22-8.7/15 3×240 直埋载流量校核",
  "updated": "2026-11-16T06:03:43.482Z",
  "cable": "YJV22-8.7/15 kV 3×240",
  "layout": "three_core_buried_single",
  "depth": 1.2,
  "runs": [
   {
    "id": "run-75c352f5",
    "sequence": 3,
    "kind": "selection",
    "title": "选型 · 400 A → YJV22-8.7/15 kV 3×240",
    "by": "human",
    "status": "succeeded",
    "tier": "reference",
    "created": "2026-11-16T06:03:43.202Z"
   },
   {
    "id": "run-1521c6be",
    "sequence": 2,
    "kind": "sweep",
    "title": "扫描 · 土壤热阻率 0.8–3 K·m/W",
    "by": "human",
    "status": "succeeded",
    "tier": "reference",
    "created": "2026-11-16T06:03:36.635Z"
   },
   {
    "id": "run-939993dd",
    "sequence": 1,
    "kind": "rating",
    "title": "校核 · 450.5 A",
    "by": "human",
    "status": "succeeded",
    "tier": "reference",
    "created": "2026-11-16T06:03:33.431Z"
   }
  ]
 }
];

// The method card of run-08e19314 (method_card), copied unchanged: what the method covers, what it assumes, what checked it.
export const RUN_METHOD_CARD = {
 "method": "IEC 60287 稳态载流量",
 "method_version": "1.2.0",
 "tier": {
  "tier": "reference",
  "label": "参考",
  "meaning": "本敷设形式只有手算或解析自洽检查，没有公开算例的整链对照；结果供比较与初判，交付前应另行核对。",
  "basis": [
   "三芯分支：六种直埋 / 排管手算核对，TB 880 算例 2 的热阻与钢丝损耗、算例 10 的钢带损耗只对照了组件，没有整链公开算例。"
  ]
 },
 "standards": [
  "IEC 60287-1-1:2023 4.2.1 Eq.(1); 5.1.2; 5.1.3; 5.1.5.1; 5.2; 5.3.1/5.3.2/5.3.11; 5.4.3.3.1/5.4.3.4/5.4.3.5",
  "IEC 60287-2-1:2023 4.1.2.3.1/4.1.2.5; 4.1.3; 4.1.4.2; 4.1.5; 5.6/Figure6; 4.2.2/4.2.3.2/4.2.6; Annex A"
 ],
 "scope": [
  "地下稳态、恒温地表、均匀原土或单一矩形回填区；不支持分层土壤、多介质分区或土壤干燥。",
  "单芯自动电损耗适用于完整平衡三相单回路或1-2验证的双回平排温度分支；其他单芯多回路、任意排列或不平衡三相须外部损耗系数与来源。",
  "三芯仅等结构圆绞导体、芯相接触、独立铜带或光滑金属屏蔽、平衡三相和两端接地；需要成缆绞距、铜带20 ℃纵向电阻、填充材料与钢带实际间隙。",
  "单回路接触品字形采用标准等效组热阻；其他接触组合明确拒算。排管每根一管、同心、电缆外径 25–100 mm。",
  "逐回路允许电流保持其他回路保存负荷，各回路上限不可同时使用。",
  "三芯磁性钢带厚度0.3–1.0 mm；钢丝圆导体至400 mm²且需工频交流铠装电阻；非磁性、混合填料、分离芯、单点接地三芯与分割/扇形领域结构拒算。单芯无铠装，支持光滑管套及显式波深/节距/缓冲/间隙有效热阻率的皱纹管套；局部接触与放电热点不在平均直径模型范围。",
  "集肤、邻近效应系数及排管热阻常数须显式给定；工程计算使用 2023 表 2，范围外或无法核实的节点拒算。水平护套涡流按 1-1:2023 5.3.7.1(2)，已用 TB 880 单点接地与两端接地变体验证。",
  "选择 TB 880 历史参考口径时，仅复现 TB 880 所用旧版电容、等效回填半径和接触品字形热阻约定，结果标为参考复现，不能作为 IEC 2023 工程结论。",
  "验证夹具来自受控资料，不随公开仓库分发；验证只覆盖所列算例与分支，不构成合规认证。",
  "快速土壤场采用保存负荷的Kennelly镜像线热源；均匀土壤、地表等温；排管为外部近似、内部不出值；不替代有限元。表面64点周向平均误差不大于0.1 K；回填、分层及接触等效组不发布。",
  "交叉热源按 IEC 60287-3-3:2007 4.1–4.3 及附录 A：一根三芯或同埋深非接触平行单芯单回路直埋；固定 W/m 热源、交叉位置重合。第 1 条指出接触电缆叠加偏乐观，接触品字形拒绝；不给定电流温度，不联合求解热源载流量。"
 ],
 "assumptions": [
  "导体电阻、护套电阻、管内空气热阻随温度迭代；返回热平衡残差。",
  "每根源电缆采用实际损耗 W/m；镜像法互热未以平均负荷替代。",
  "介质损耗内部热路按 IEC 60287-1-1 4.2.1 式 (1) 取 0.5·T1，包含半导电层。",
  "回填修正按共同温升 C·ΣW 叠加；等负荷时还原标准 N·C 热阻修正。",
  "T1、Rc及电容按每芯；导体、屏蔽、介质及铠装损耗按整根三芯电缆W/m输出；芯明细单独保留。",
  "平衡圆形三芯独立金属屏蔽；每芯环流按SL分支，公共磁性钢带/钢丝铠装按对应条款。",
  "IEC 2023 地下稳态；电损耗须满足声明范围"
 ],
 "validation": {
  "cases": [
   "CIGRE TB 880 算例 0-1",
   "CIGRE TB 880 算例 0-1：外部热阻精确根式",
   "CIGRE TB 880 算例 0-1：单端接地",
   "CIGRE TB 880 算例 0-1：GP31 涡流",
   "CIGRE TB 880 算例 0-2",
   "CIGRE TB 880 算例 0-2：GP31 涡流",
   "CIGRE TB 880 算例 0-3：平排排管",
   "CIGRE TB 880 算例 0-3：单端接地",
   "CIGRE TB 880 算例 0-3：GP31 涡流",
   "IEC 2023：双电缆及多热源不等负荷镜像解析核对",
   "IEC 2023 表 2：节点、插值与非均匀回填修正核对",
   "九种单芯敷设模板：独立对数热平衡与冻结损耗二次方程核对",
   "三芯逐芯屏蔽：六种直埋/排管手算；TB 880 算例 2 热阻与钢丝损耗、算例 10 钢带损耗组件核对"
  ],
  "this_configuration": [
   "三芯分支：六种直埋 / 排管手算核对，TB 880 算例 2 的热阻与钢丝损耗、算例 10 的钢带损耗只对照了组件，没有整链公开算例。"
  ]
 }
};
