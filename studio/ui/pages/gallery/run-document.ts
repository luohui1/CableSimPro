// The laying and cable of run record run-9dd64e85 (project p-91533251), copied unchanged from the 8210 host on 2026-11-16:
// YJV22-8.7/15 kV 3×240, 三芯直埋 · 单回, 1.2 m, 1 K·m/W, 25 °C, 300 A. The gallery draws its sections from it.
import type { CableState, DomainDocument } from '@shared/types';

export const RUN_DOCUMENT = {
  "schema_version": "cablesim.domain/1",
  "name": "YJV22-8.7/15 3×240 直埋载流量校核",
  "materials": [
    {
      "id": "material/cu",
      "label": "铜",
      "category": "conductor"
    },
    {
      "id": "material/semi",
      "label": "半导电聚乙烯参考",
      "category": "semiconductor"
    },
    {
      "id": "material/xlpe",
      "label": "XLPE参考",
      "category": "insulation"
    },
    {
      "id": "material/filler",
      "label": "工程师给定填充与包带",
      "category": "filler"
    },
    {
      "id": "material/pvc",
      "label": "PVC护套参考（绝缘等级口径）",
      "category": "polymer"
    },
    {
      "id": "material/steel",
      "label": "工程师给定磁性钢带",
      "category": "metal"
    },
    {
      "id": "material/soil",
      "label": "原土",
      "category": "soil"
    }
  ],
  "cable_types": [
    {
      "id": "cable_type/ct1",
      "label": "YJV22-8.7/15 kV 3×240",
      "construction": "three_core",
      "rating": {
        "u0": 8700,
        "u": 15000,
        "max_conductor_temperature": {
          "normal": 363.15
        }
      },
      "cores": [
        {
          "id": "core/1",
          "conductor": {
            "material": "material/cu",
            "form": "stranded_round_compacted",
            "nominal_area": 0.00023999999999999998,
            "diameter": 0.0184,
            "r20": 7.539999999999999e-05,
            "conductor_class": 2,
            "r20_basis": "design"
          },
          "layers": [
            {
              "role": "conductor_screen",
              "material": "material/semi",
              "thickness": 0.0008
            },
            {
              "role": "insulation",
              "material": "material/xlpe",
              "thickness": 0.0045000000000000005
            },
            {
              "role": "insulation_screen",
              "material": "material/semi",
              "thickness": 0.0007
            },
            {
              "role": "metallic_screen",
              "material": "material/cu",
              "thickness": 0.0002,
              "form": "tape",
              "overlap": 0.15,
              "nominal_tape_thickness": 0.0001,
              "longitudinal_r20": 0.0015270012865847774,
              "longitudinal_resistance_basis": "dc"
            }
          ],
          "x": 0,
          "z": 0.017782388291040476
        },
        {
          "id": "core/2",
          "conductor": {
            "material": "material/cu",
            "form": "stranded_round_compacted",
            "nominal_area": 0.00023999999999999998,
            "diameter": 0.0184,
            "r20": 7.539999999999999e-05,
            "conductor_class": 2,
            "r20_basis": "design"
          },
          "layers": [
            {
              "role": "conductor_screen",
              "material": "material/semi",
              "thickness": 0.0008
            },
            {
              "role": "insulation",
              "material": "material/xlpe",
              "thickness": 0.0045000000000000005
            },
            {
              "role": "insulation_screen",
              "material": "material/semi",
              "thickness": 0.0007
            },
            {
              "role": "metallic_screen",
              "material": "material/cu",
              "thickness": 0.0002,
              "form": "tape",
              "overlap": 0.15,
              "nominal_tape_thickness": 0.0001,
              "longitudinal_r20": 0.0015270012865847774,
              "longitudinal_resistance_basis": "dc"
            }
          ],
          "x": -0.015400000000000002,
          "z": -0.008891194145520238
        },
        {
          "id": "core/3",
          "conductor": {
            "material": "material/cu",
            "form": "stranded_round_compacted",
            "nominal_area": 0.00023999999999999998,
            "diameter": 0.0184,
            "r20": 7.539999999999999e-05,
            "conductor_class": 2,
            "r20_basis": "design"
          },
          "layers": [
            {
              "role": "conductor_screen",
              "material": "material/semi",
              "thickness": 0.0008
            },
            {
              "role": "insulation",
              "material": "material/xlpe",
              "thickness": 0.0045000000000000005
            },
            {
              "role": "insulation_screen",
              "material": "material/semi",
              "thickness": 0.0007
            },
            {
              "role": "metallic_screen",
              "material": "material/cu",
              "thickness": 0.0002,
              "form": "tape",
              "overlap": 0.15,
              "nominal_tape_thickness": 0.0001,
              "longitudinal_r20": 0.0015270012865847774,
              "longitudinal_resistance_basis": "dc"
            }
          ],
          "x": 0.015400000000000002,
          "z": -0.008891194145520238
        }
      ],
      "common_layers": [
        {
          "role": "filler",
          "material": "material/filler",
          "thickness": 0.0014176117089595235
        },
        {
          "role": "bedding",
          "material": "material/pvc",
          "thickness": 0.0019
        },
        {
          "role": "armour",
          "material": "material/steel",
          "thickness": 0.001,
          "form": "tape",
          "tape_width": 0.05,
          "nominal_tape_thickness": 0.0005,
          "tape_count": 2,
          "tape_application": "two_tape_gap",
          "tape_gap": 0.025
        },
        {
          "role": "oversheath",
          "material": "material/pvc",
          "thickness": 0.0035
        }
      ],
      "core_lay_length": 2.152
    }
  ],
  "circuits": [
    {
      "id": "circuit/c1",
      "label": "回路 1",
      "cable_type": "cable_type/ct1",
      "system": {
        "kind": "ac_three_phase",
        "frequency": 50,
        "voltage": 15000
      },
      "cables": [
        {
          "id": "cable/c1",
          "phase": "L1L2L3"
        }
      ],
      "bonding": {
        "kind": "both_ends"
      }
    }
  ],
  "sections": [
    {
      "id": "section/s1",
      "label": "三芯直埋 · 单回",
      "kind": "ground",
      "medium": {
        "material": "material/soil",
        "surface_temperature": 298.15
      },
      "placements": [
        {
          "cable": "cable/c1",
          "x": 0,
          "z": -1.2
        }
      ],
      "enclosures": [],
      "layout_template": {
        "kind": "three_core_buried_single",
        "depth": 1.2,
        "spacing": null
      }
    }
  ],
  "load_cases": []
} as unknown as DomainDocument;

/** The solver of the same run: summary.operating.iterations. */
export const RUN_SOLVER = { iterations: 33 };

export const RUN_CABLE = {
  "id": "cable/c1",
  "circuit": "circuit/c1",
  "phase": "L1L2L3",
  "x": 0,
  "z": -1.2,
  "current_a": 300,
  "conductor_c": 49.69344964107793,
  "limit_c": 90,
  "margin_k": 40.30655035892207,
  "sheath_c": 47.67303089786336,
  "surface_c": 40.719406603883264,
  "armour_c": 42.78753595960496,
  "losses_w_m": {
    "conductor": 23.396321593215532,
    "sheath": 0.4635335011833193,
    "dielectric": 0.10698784611977322,
    "total": 24.27112495816417,
    "armour": 0.30428201764554264
  },
  "thermal_k_m_w": {
    "t1": 0.25847777887364914,
    "t3": 0.08520945606297625,
    "t4_air": 0,
    "t4_wall": 0,
    "t4_soil": 0.6476587562784422,
    "t2": 0.20384390845232808
  },
  "mutual_rise_k": 0,
  "external_rise_k": 15.719406603883263,
  "lambda1": 0.01981223840408036,
  "lambda2": 0.013005549459269631,
  "ac_resistance_ohm_m": 8.66530429378353e-05,
  "capacitance_f_m": 3.749426291609847e-10
} as unknown as CableState;
