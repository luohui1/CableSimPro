import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { safeRequestHeaders, saveRawResponse } from './resource-exchange-walk.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const artifactType = 'x-cablesim.gb50217-correction';
const releaseDigest = 'a25ffd1914d271f7b9f776fc8be84aee8c8e8c22f3fa1f5e3f3ba6640ee96915';

// Explicit synthetic mechanism input: the two 400 A declarations are neither
// manufacturer ratings nor a temperature curve. Keep their original bytes.
// The CI runtime validates this fixed Domain and sealed records without pytest,
// test-fixture imports, native solvers or any implicit physical defaults.
const fixedSyntheticInput = String.raw`{
  "purpose": "仅用于显式合成机制拒绝与原表乘法；不是厂家、实测或完整行业示例",
  "origin": {
    "schema": "cablesim.d07-mechanism-fixture/1",
    "source_export_sha256": "9ddab68b347499d3e6025a786c2d05acf6996ce74ffb3b5e26a6d60146a7f4ec"
  },
  "domain": {
    "schema_version": "cablesim.domain/1",
    "name": "D.0.7 1000V 三芯95mm²合成机制，不是厂家或线路实例",
    "materials": [
      {
        "id": "material/conductor",
        "label": "铜导体（合成机制）",
        "category": "conductor",
        "standard_kind": null,
        "thermal_resistivity": null,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/semicon",
        "label": "半导电材料（合成机制）",
        "category": "semiconductor",
        "standard_kind": null,
        "thermal_resistivity": 2.5,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/insulation",
        "label": "绝缘材料（合成机制）",
        "category": "insulation",
        "standard_kind": null,
        "thermal_resistivity": 3.5,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": 2.3,
        "loss_tangent": 0.0004,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/screen",
        "label": "金属屏蔽（结构未指定，合成机制）",
        "category": "metal",
        "standard_kind": null,
        "thermal_resistivity": null,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/jacket",
        "label": "外护套聚合物材料（合成机制）",
        "category": "polymer",
        "standard_kind": null,
        "thermal_resistivity": 3.5,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      }
    ],
    "cable_types": [
      {
        "id": "cable_type/ct1",
        "label": "D.0.7 三芯95mm²合成机制",
        "construction": "three_core",
        "rating": {
          "u0": 600,
          "u": 1000,
          "um": 1200,
          "max_conductor_temperature": {
            "normal": 363.15
          }
        },
        "cores": [
          {
            "id": "core/k0",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.00009499999999999999,
              "diameter": 0.01822496766671072,
              "sector_angle_deg": null,
              "sector_rotation_deg": null,
              "r20": null,
              "conductor_class": null,
              "r20_basis": null,
              "inner_diameter": null,
              "segments": null,
              "wire_count": null,
              "insulated_wires": null,
              "wire_diameter": null,
              "lay_length": null,
              "lay_direction": null,
              "lay_factor": null
            },
            "layers": [
              {
                "role": "insulation",
                "material": "material/insulation",
                "thickness": 0.0055,
                "form": null,
                "corrugation_depth": null,
                "corrugation_pitch": null,
                "wire_count": null,
                "wire_diameter": null,
                "lay_length": null,
                "overlap": null,
                "mean_wire_diameter": null,
                "padding_thickness": null,
                "tape_width": null,
                "lay_direction": null,
                "minimum_thickness": null,
                "maximum_thickness": null,
                "mean_thickness": null,
                "nominal_tape_thickness": null,
                "tape_count": null,
                "tape_application": null,
                "minimum_overlap": null,
                "reverse_binder_thickness": null,
                "reverse_binder_width": null,
                "reverse_binder_count": null,
                "screen_inner_diameter": null,
                "minimum_tape_thickness": null,
                "longitudinal_r20": null,
                "longitudinal_resistance_basis": null,
                "longitudinal_resistance_frequency": null,
                "tape_gap": null
              }
            ],
            "x": -0.04,
            "z": 0
          },
          {
            "id": "core/k1",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.00009499999999999999,
              "diameter": 0.01822496766671072,
              "sector_angle_deg": null,
              "sector_rotation_deg": null,
              "r20": null,
              "conductor_class": null,
              "r20_basis": null,
              "inner_diameter": null,
              "segments": null,
              "wire_count": null,
              "insulated_wires": null,
              "wire_diameter": null,
              "lay_length": null,
              "lay_direction": null,
              "lay_factor": null
            },
            "layers": [
              {
                "role": "insulation",
                "material": "material/insulation",
                "thickness": 0.0055,
                "form": null,
                "corrugation_depth": null,
                "corrugation_pitch": null,
                "wire_count": null,
                "wire_diameter": null,
                "lay_length": null,
                "overlap": null,
                "mean_wire_diameter": null,
                "padding_thickness": null,
                "tape_width": null,
                "lay_direction": null,
                "minimum_thickness": null,
                "maximum_thickness": null,
                "mean_thickness": null,
                "nominal_tape_thickness": null,
                "tape_count": null,
                "tape_application": null,
                "minimum_overlap": null,
                "reverse_binder_thickness": null,
                "reverse_binder_width": null,
                "reverse_binder_count": null,
                "screen_inner_diameter": null,
                "minimum_tape_thickness": null,
                "longitudinal_r20": null,
                "longitudinal_resistance_basis": null,
                "longitudinal_resistance_frequency": null,
                "tape_gap": null
              }
            ],
            "x": 0.04,
            "z": 0
          },
          {
            "id": "core/k2",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.00009499999999999999,
              "diameter": 0.01822496766671072,
              "sector_angle_deg": null,
              "sector_rotation_deg": null,
              "r20": null,
              "conductor_class": null,
              "r20_basis": null,
              "inner_diameter": null,
              "segments": null,
              "wire_count": null,
              "insulated_wires": null,
              "wire_diameter": null,
              "lay_length": null,
              "lay_direction": null,
              "lay_factor": null
            },
            "layers": [
              {
                "role": "insulation",
                "material": "material/insulation",
                "thickness": 0.0055,
                "form": null,
                "corrugation_depth": null,
                "corrugation_pitch": null,
                "wire_count": null,
                "wire_diameter": null,
                "lay_length": null,
                "overlap": null,
                "mean_wire_diameter": null,
                "padding_thickness": null,
                "tape_width": null,
                "lay_direction": null,
                "minimum_thickness": null,
                "maximum_thickness": null,
                "mean_thickness": null,
                "nominal_tape_thickness": null,
                "tape_count": null,
                "tape_application": null,
                "minimum_overlap": null,
                "reverse_binder_thickness": null,
                "reverse_binder_width": null,
                "reverse_binder_count": null,
                "screen_inner_diameter": null,
                "minimum_tape_thickness": null,
                "longitudinal_r20": null,
                "longitudinal_resistance_basis": null,
                "longitudinal_resistance_frequency": null,
                "tape_gap": null
              }
            ],
            "x": 0,
            "z": 0.07
          }
        ],
        "common_layers": [
          {
            "role": "conductor_screen",
            "material": "material/semicon",
            "thickness": 0.0006,
            "form": null,
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          },
          {
            "role": "insulation_screen",
            "material": "material/semicon",
            "thickness": 0.0007,
            "form": null,
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          },
          {
            "role": "metallic_screen",
            "material": "material/screen",
            "thickness": 0.0005,
            "form": "unspecified",
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          },
          {
            "role": "oversheath",
            "material": "material/jacket",
            "thickness": 0.0025,
            "form": null,
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          }
        ],
        "core_lay_length": null
      }
    ],
    "circuits": [
      {
        "id": "circuit/c1",
        "label": "回路 1",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50,
          "voltage": 1000
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p1",
            "phase": "L1L2L3",
            "parallel_index": 1
          }
        ],
        "bonding": {
          "kind": "unspecified",
          "minor_section_lengths": [],
          "transposed": false,
          "section_permutations": [],
          "source": null
        },
        "electrical_topology": null
      }
    ],
    "sections": [
      {
        "id": "section/s1",
        "label": "户外自然通风合成机制截面",
        "kind": "air",
        "length": 1000,
        "medium": {
          "material": null,
          "surface_temperature": null,
          "air_temperature": 303.15,
          "wind_speed": null,
          "solar_irradiance": null,
          "ventilation": "natural"
        },
        "enclosures": [],
        "placements": [
          {
            "cable": "cable/p1",
            "x": 0,
            "z": 0,
            "enclosure": null
          }
        ],
        "layout_template": {},
        "backfill": null,
        "soil_layers": []
      }
    ],
    "load_cases": [
      {
        "id": "load/steady",
        "kind": "steady",
        "currents": {
          "circuit/c1": 300
        },
        "profile": {},
        "base_current": {},
        "duration": null,
        "period": null,
        "preload": null,
        "initial": null
      }
    ],
    "criteria": {
      "max_conductor_temperature": 363.15
    },
    "provenance": {
      "/materials/material~1conductor": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1semicon": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1insulation": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1screen": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1jacket": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/cable_types/cable_type~1ct1": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/circuits/circuit~1c1": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/sections/section~1s1": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/load_cases/load~1steady": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      }
    },
    "measurements": []
  },
  "null_domain": {
    "schema_version": "cablesim.domain/1",
    "name": "D.0.7 1000V 三芯35mm²合成机制，不是厂家或线路实例",
    "materials": [
      {
        "id": "material/conductor",
        "label": "铜导体（合成机制）",
        "category": "conductor",
        "standard_kind": null,
        "thermal_resistivity": null,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/semicon",
        "label": "半导电材料（合成机制）",
        "category": "semiconductor",
        "standard_kind": null,
        "thermal_resistivity": 2.5,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/insulation",
        "label": "绝缘材料（合成机制）",
        "category": "insulation",
        "standard_kind": null,
        "thermal_resistivity": 3.5,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": 2.3,
        "loss_tangent": 0.0004,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/screen",
        "label": "金属屏蔽（结构未指定，合成机制）",
        "category": "metal",
        "standard_kind": null,
        "thermal_resistivity": null,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      },
      {
        "id": "material/jacket",
        "label": "外护套聚合物材料（合成机制）",
        "category": "polymer",
        "standard_kind": null,
        "thermal_resistivity": 3.5,
        "volumetric_heat_capacity": null,
        "electrical_resistivity_20": null,
        "temperature_coefficient_20": null,
        "relative_permittivity": null,
        "loss_tangent": null,
        "relative_permeability": null,
        "emissivity": null,
        "solar_absorptivity": null,
        "dry_thermal_resistivity": null,
        "critical_temperature_rise": null,
        "density": null
      }
    ],
    "cable_types": [
      {
        "id": "cable_type/ct1",
        "label": "D.0.7 三芯35mm²合成机制",
        "construction": "three_core",
        "rating": {
          "u0": 600,
          "u": 1000,
          "um": 1200,
          "max_conductor_temperature": {
            "normal": 363.15
          }
        },
        "cores": [
          {
            "id": "core/k0",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.000035,
              "diameter": 0.01822496766671072,
              "sector_angle_deg": null,
              "sector_rotation_deg": null,
              "r20": null,
              "conductor_class": null,
              "r20_basis": null,
              "inner_diameter": null,
              "segments": null,
              "wire_count": null,
              "insulated_wires": null,
              "wire_diameter": null,
              "lay_length": null,
              "lay_direction": null,
              "lay_factor": null
            },
            "layers": [
              {
                "role": "insulation",
                "material": "material/insulation",
                "thickness": 0.0055,
                "form": null,
                "corrugation_depth": null,
                "corrugation_pitch": null,
                "wire_count": null,
                "wire_diameter": null,
                "lay_length": null,
                "overlap": null,
                "mean_wire_diameter": null,
                "padding_thickness": null,
                "tape_width": null,
                "lay_direction": null,
                "minimum_thickness": null,
                "maximum_thickness": null,
                "mean_thickness": null,
                "nominal_tape_thickness": null,
                "tape_count": null,
                "tape_application": null,
                "minimum_overlap": null,
                "reverse_binder_thickness": null,
                "reverse_binder_width": null,
                "reverse_binder_count": null,
                "screen_inner_diameter": null,
                "minimum_tape_thickness": null,
                "longitudinal_r20": null,
                "longitudinal_resistance_basis": null,
                "longitudinal_resistance_frequency": null,
                "tape_gap": null
              }
            ],
            "x": -0.04,
            "z": 0
          },
          {
            "id": "core/k1",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.000035,
              "diameter": 0.01822496766671072,
              "sector_angle_deg": null,
              "sector_rotation_deg": null,
              "r20": null,
              "conductor_class": null,
              "r20_basis": null,
              "inner_diameter": null,
              "segments": null,
              "wire_count": null,
              "insulated_wires": null,
              "wire_diameter": null,
              "lay_length": null,
              "lay_direction": null,
              "lay_factor": null
            },
            "layers": [
              {
                "role": "insulation",
                "material": "material/insulation",
                "thickness": 0.0055,
                "form": null,
                "corrugation_depth": null,
                "corrugation_pitch": null,
                "wire_count": null,
                "wire_diameter": null,
                "lay_length": null,
                "overlap": null,
                "mean_wire_diameter": null,
                "padding_thickness": null,
                "tape_width": null,
                "lay_direction": null,
                "minimum_thickness": null,
                "maximum_thickness": null,
                "mean_thickness": null,
                "nominal_tape_thickness": null,
                "tape_count": null,
                "tape_application": null,
                "minimum_overlap": null,
                "reverse_binder_thickness": null,
                "reverse_binder_width": null,
                "reverse_binder_count": null,
                "screen_inner_diameter": null,
                "minimum_tape_thickness": null,
                "longitudinal_r20": null,
                "longitudinal_resistance_basis": null,
                "longitudinal_resistance_frequency": null,
                "tape_gap": null
              }
            ],
            "x": 0.04,
            "z": 0
          },
          {
            "id": "core/k2",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.000035,
              "diameter": 0.01822496766671072,
              "sector_angle_deg": null,
              "sector_rotation_deg": null,
              "r20": null,
              "conductor_class": null,
              "r20_basis": null,
              "inner_diameter": null,
              "segments": null,
              "wire_count": null,
              "insulated_wires": null,
              "wire_diameter": null,
              "lay_length": null,
              "lay_direction": null,
              "lay_factor": null
            },
            "layers": [
              {
                "role": "insulation",
                "material": "material/insulation",
                "thickness": 0.0055,
                "form": null,
                "corrugation_depth": null,
                "corrugation_pitch": null,
                "wire_count": null,
                "wire_diameter": null,
                "lay_length": null,
                "overlap": null,
                "mean_wire_diameter": null,
                "padding_thickness": null,
                "tape_width": null,
                "lay_direction": null,
                "minimum_thickness": null,
                "maximum_thickness": null,
                "mean_thickness": null,
                "nominal_tape_thickness": null,
                "tape_count": null,
                "tape_application": null,
                "minimum_overlap": null,
                "reverse_binder_thickness": null,
                "reverse_binder_width": null,
                "reverse_binder_count": null,
                "screen_inner_diameter": null,
                "minimum_tape_thickness": null,
                "longitudinal_r20": null,
                "longitudinal_resistance_basis": null,
                "longitudinal_resistance_frequency": null,
                "tape_gap": null
              }
            ],
            "x": 0,
            "z": 0.07
          }
        ],
        "common_layers": [
          {
            "role": "conductor_screen",
            "material": "material/semicon",
            "thickness": 0.0006,
            "form": null,
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          },
          {
            "role": "insulation_screen",
            "material": "material/semicon",
            "thickness": 0.0007,
            "form": null,
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          },
          {
            "role": "metallic_screen",
            "material": "material/screen",
            "thickness": 0.0005,
            "form": "unspecified",
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          },
          {
            "role": "oversheath",
            "material": "material/jacket",
            "thickness": 0.0025,
            "form": null,
            "corrugation_depth": null,
            "corrugation_pitch": null,
            "wire_count": null,
            "wire_diameter": null,
            "lay_length": null,
            "overlap": null,
            "mean_wire_diameter": null,
            "padding_thickness": null,
            "tape_width": null,
            "lay_direction": null,
            "minimum_thickness": null,
            "maximum_thickness": null,
            "mean_thickness": null,
            "nominal_tape_thickness": null,
            "tape_count": null,
            "tape_application": null,
            "minimum_overlap": null,
            "reverse_binder_thickness": null,
            "reverse_binder_width": null,
            "reverse_binder_count": null,
            "screen_inner_diameter": null,
            "minimum_tape_thickness": null,
            "longitudinal_r20": null,
            "longitudinal_resistance_basis": null,
            "longitudinal_resistance_frequency": null,
            "tape_gap": null
          }
        ],
        "core_lay_length": null
      }
    ],
    "circuits": [
      {
        "id": "circuit/c1",
        "label": "回路 1",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50,
          "voltage": 1000
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p1",
            "phase": "L1L2L3",
            "parallel_index": 1
          }
        ],
        "bonding": {
          "kind": "unspecified",
          "minor_section_lengths": [],
          "transposed": false,
          "section_permutations": [],
          "source": null
        },
        "electrical_topology": null
      }
    ],
    "sections": [
      {
        "id": "section/s1",
        "label": "户外自然通风合成机制截面",
        "kind": "air",
        "length": 1000,
        "medium": {
          "material": null,
          "surface_temperature": null,
          "air_temperature": 303.15,
          "wind_speed": null,
          "solar_irradiance": null,
          "ventilation": "natural"
        },
        "enclosures": [],
        "placements": [
          {
            "cable": "cable/p1",
            "x": 0,
            "z": 0,
            "enclosure": null
          }
        ],
        "layout_template": {},
        "backfill": null,
        "soil_layers": []
      }
    ],
    "load_cases": [
      {
        "id": "load/steady",
        "kind": "steady",
        "currents": {
          "circuit/c1": 300
        },
        "profile": {},
        "base_current": {},
        "duration": null,
        "period": null,
        "preload": null,
        "initial": null
      }
    ],
    "criteria": {
      "max_conductor_temperature": 363.15
    },
    "provenance": {
      "/materials/material~1conductor": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1semicon": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1insulation": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1screen": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/materials/material~1jacket": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/cable_types/cable_type~1ct1": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/circuits/circuit~1c1": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/sections/section~1s1": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      },
      "/load_cases/load~1steady": {
        "kind": "demo",
        "reviewed": false,
        "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
      }
    },
    "measurements": []
  },
  "parameters_unconfirmed": {
    "baseline_current_a": 400,
    "baseline_ambient_k": 313.15,
    "baseline_environment": "indoor_air_at_outdoor_ambient",
    "baseline_source": "D.0.7 合成机制基准 v1，第1页 ambient-40 行：1000V、三芯各95mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。",
    "baseline_sha256": "f66a272e408dcd10184c2963277ef1a1211fa573394dfb6bffca579ee5f04083",
    "baseline_page": 1,
    "baseline_reviewed": true,
    "outdoor_exposure_source": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据",
    "outdoor_unshaded_confirmed": false,
    "basis_release_digest": "1babba59486ce48b4581ee0d1b4058cff93b58b6ab7230b4794c81f85f6be743"
  },
  "parameters_complete": {
    "baseline_current_a": 400,
    "baseline_ambient_k": 303.15,
    "baseline_environment": "indoor_air_at_outdoor_ambient",
    "baseline_source": "D.0.7 合成机制基准 v1，第1页 ambient-30 行：1000V、三芯各95mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。",
    "baseline_sha256": "f66a272e408dcd10184c2963277ef1a1211fa573394dfb6bffca579ee5f04083",
    "baseline_page": 1,
    "baseline_reviewed": true,
    "outdoor_exposure_source": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据",
    "outdoor_unshaded_confirmed": true,
    "basis_release_digest": "1babba59486ce48b4581ee0d1b4058cff93b58b6ab7230b4794c81f85f6be743"
  },
  "parameters_null": {
    "baseline_current_a": 400,
    "baseline_ambient_k": 303.15,
    "baseline_environment": "indoor_air_at_outdoor_ambient",
    "baseline_source": "D.0.7 合成机制基准 v1，第1页 ambient-30 行：1000V、三芯各35mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。",
    "baseline_sha256": "c8d4a6c6fa7581cec9b471ec414565f6c3939fdaed973f56abb3d0a155ece512",
    "baseline_page": 1,
    "baseline_reviewed": true,
    "outdoor_exposure_source": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据",
    "outdoor_unshaded_confirmed": true,
    "basis_release_digest": "1babba59486ce48b4581ee0d1b4058cff93b58b6ab7230b4794c81f85f6be743"
  },
  "input_sources": {
    "/parameters/baseline_current_a": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：f66a272e408dcd10184c2963277ef1a1211fa573394dfb6bffca579ee5f04083"
    },
    "/parameters/baseline_ambient_k": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页 ambient-40 行：1000V、三芯各95mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。"
    },
    "/parameters/baseline_environment": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：f66a272e408dcd10184c2963277ef1a1211fa573394dfb6bffca579ee5f04083"
    },
    "/parameters/baseline_source": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页 ambient-40 行：1000V、三芯各95mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。"
    },
    "/parameters/baseline_sha256": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：f66a272e408dcd10184c2963277ef1a1211fa573394dfb6bffca579ee5f04083"
    },
    "/parameters/baseline_page": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：f66a272e408dcd10184c2963277ef1a1211fa573394dfb6bffca579ee5f04083"
    },
    "/parameters/baseline_reviewed": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页 ambient-40 行：1000V、三芯各95mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。"
    },
    "/parameters/outdoor_exposure_source": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
    },
    "/parameters/outdoor_unshaded_confirmed": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制输入 v1；1000V、三芯各95mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
    },
    "/parameters/basis_release_digest": {
      "kind": "demo",
      "reviewed": false,
      "reference": "实际封签标准依据库的固定发行身份，摘要：1babba59486ce48b4581ee0d1b4058cff93b58b6ab7230b4794c81f85f6be743"
    }
  },
  "null_input_sources": {
    "/parameters/baseline_current_a": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：c8d4a6c6fa7581cec9b471ec414565f6c3939fdaed973f56abb3d0a155ece512"
    },
    "/parameters/baseline_ambient_k": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页 ambient-30 行：1000V、三芯各35mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。"
    },
    "/parameters/baseline_environment": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：c8d4a6c6fa7581cec9b471ec414565f6c3939fdaed973f56abb3d0a155ece512"
    },
    "/parameters/baseline_source": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页 ambient-30 行：1000V、三芯各35mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。"
    },
    "/parameters/baseline_sha256": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：c8d4a6c6fa7581cec9b471ec414565f6c3939fdaed973f56abb3d0a155ece512"
    },
    "/parameters/baseline_page": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；不是温度曲线或厂家额定值；同型号和温限范围见完整原件，原始UTF-8字节SHA256：c8d4a6c6fa7581cec9b471ec414565f6c3939fdaed973f56abb3d0a155ece512"
    },
    "/parameters/baseline_reviewed": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制基准 v1，第1页 ambient-30 行：1000V、三芯各35mm²、同正常温限90℃、户内空气单根400 A独立声明；仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。"
    },
    "/parameters/outdoor_exposure_source": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
    },
    "/parameters/outdoor_unshaded_confirmed": {
      "kind": "demo",
      "reviewed": false,
      "reference": "D.0.7 合成机制输入 v1；1000V、三芯各35mm²、空气30℃、正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据"
    },
    "/parameters/basis_release_digest": {
      "kind": "demo",
      "reviewed": false,
      "reference": "实际封签标准依据库的固定发行身份，摘要：1babba59486ce48b4581ee0d1b4058cff93b58b6ab7230b4794c81f85f6be743"
    }
  },
  "baseline_original": "{\n  \"approval\": \"not_granted\",\n  \"cable\": {\n    \"core_count\": 3,\n    \"nominal_area_m2\": 9.499999999999999e-05,\n    \"normal_conductor_temperature_k\": 363.15,\n    \"rated_voltage_v\": 1000\n  },\n  \"confidence\": \"reference\",\n  \"current_basis_environment\": \"indoor_air_at_outdoor_ambient\",\n  \"method\": {\n    \"id\": \"synthetic-mechanism-declaration\",\n    \"version\": \"1.0.0\"\n  },\n  \"name\": \"D.0.7 合成机制基准；不是厂家额定值、实测值或完整行业示例\",\n  \"pages\": [\n    {\n      \"number\": 1,\n      \"rows\": [\n        {\n          \"ambient_temperature_k\": 303.15,\n          \"current_a\": 400.0,\n          \"id\": \"ambient-30\"\n        },\n        {\n          \"ambient_temperature_k\": 313.15,\n          \"current_a\": 400.0,\n          \"id\": \"ambient-40\"\n        }\n      ]\n    }\n  ],\n  \"purpose\": \"仅验证拒绝边界和单次原表乘法；30℃和40℃的400 A分别独立声明，不是温度曲线或换算结果。\",\n  \"schema\": \"cablesim.synthetic-d07-baseline/1\",\n  \"source_kind\": \"demo\"\n}\n",
  "null_baseline_original": "{\n  \"approval\": \"not_granted\",\n  \"cable\": {\n    \"core_count\": 3,\n    \"nominal_area_m2\": 3.5e-05,\n    \"normal_conductor_temperature_k\": 363.15,\n    \"rated_voltage_v\": 1000\n  },\n  \"confidence\": \"reference\",\n  \"current_basis_environment\": \"indoor_air_at_outdoor_ambient\",\n  \"method\": {\n    \"id\": \"synthetic-mechanism-declaration\",\n    \"version\": \"1.0.0\"\n  },\n  \"name\": \"D.0.7 合成机制基准；不是厂家额定值、实测值或完整行业示例\",\n  \"pages\": [\n    {\n      \"number\": 1,\n      \"rows\": [\n        {\n          \"ambient_temperature_k\": 303.15,\n          \"current_a\": 400.0,\n          \"id\": \"ambient-30\"\n        },\n        {\n          \"ambient_temperature_k\": 313.15,\n          \"current_a\": 400.0,\n          \"id\": \"ambient-40\"\n        }\n      ]\n    }\n  ],\n  \"purpose\": \"仅验证拒绝边界和单次原表乘法；30℃和40℃的400 A分别独立声明，不是温度曲线或换算结果。\",\n  \"schema\": \"cablesim.synthetic-d07-baseline/1\",\n  \"source_kind\": \"demo\"\n}\n",
  "refusals": {
    "unconfirmed": {
      "ready": false,
      "code": "CORRECTION_CONFIRMATION_REQUIRED",
      "field": "/parameters/outdoor_unshaded_confirmed"
    },
    "baseline_mismatch": {
      "ready": false,
      "code": "CORRECTION_BASELINE_MISMATCH",
      "field": "/parameters/baseline_ambient_k"
    },
    "null_cell": {
      "ready": false,
      "code": "CORRECTION_TABLE_NOT_COVERED",
      "field": "/input/cable_types/0/cores/0/conductor/nominal_area"
    }
  }
}`;

const fixtureSource = String.raw`import hashlib,json,sys
from pathlib import Path
from cablesim_sdk.domain import DomainDocument
from backend.plugin_host.registry import Registry

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()

raw=sys.stdin.buffer.read()
fixed=json.loads(raw)
document=DomainDocument.model_validate(fixed['domain']).model_dump(mode='json')
null_document=DomainDocument.model_validate(fixed['null_domain']).model_dump(mode='json')
assert document==fixed['domain'], 'Synthetic Domain must already include every explicit stored field'
assert null_document==fixed['null_domain'], 'Null-cell synthetic Domain must already be complete'
for current in (document,null_document):
    assert current['sections'][0]['medium']['air_temperature']==303.15
    assert current['sections'][0]['medium']['wind_speed'] is None
    assert current['sections'][0]['medium']['solar_irradiance'] is None
    assert current['sections'][0]['medium']['ventilation']=='natural'
    assert current['sections'][0]['enclosures']==[]
    assert current['sections'][0]['medium']['material'] is None
    assert current['sections'][0]['layout_template']=={}
    assert not any(material['id']=='material/soil' for material in current['materials'])
    assert all(source['kind']=='demo' and source['reviewed'] is False for source in current['provenance'].values())
baseline=fixed['baseline_original']
baseline_digest=hashlib.sha256(baseline.encode()).hexdigest()
null_baseline=fixed['null_baseline_original']
null_baseline_digest=hashlib.sha256(null_baseline.encode()).hexdigest()
for text,current,area in ((baseline,document,95e-6),(null_baseline,null_document,35e-6)):
    original=json.loads(text)
    assert original['schema']=='cablesim.synthetic-d07-baseline/1'
    assert original['source_kind']=='demo' and original['confidence']=='reference' and original['approval']=='not_granted'
    assert original['current_basis_environment']=='indoor_air_at_outdoor_ambient'
    assert original['cable']==dict(rated_voltage_v=1000,core_count=3,nominal_area_m2=current['cable_types'][0]['cores'][0]['conductor']['nominal_area'],normal_conductor_temperature_k=363.15)
    assert original['pages']==[dict(number=1,rows=[dict(id='ambient-30',ambient_temperature_k=303.15,current_a=400),dict(id='ambient-40',ambient_temperature_k=313.15,current_a=400)])]
    assert all(core['conductor']['nominal_area']==(95*1e-6 if area==95e-6 else 35*1e-6) for core in current['cable_types'][0]['cores'])
for key in ('parameters_unconfirmed','parameters_complete','parameters_null'):
    assert fixed[key]['baseline_sha256']==(null_baseline_digest if key=='parameters_null' else baseline_digest)
    assert fixed[key]['baseline_current_a']==400
    assert fixed[key]['baseline_environment']=='indoor_air_at_outdoor_ambient'
assert fixed['parameters_unconfirmed']['baseline_ambient_k']==313.15
assert fixed['parameters_complete']['baseline_ambient_k']==303.15
assert fixed['parameters_null']['baseline_ambient_k']==303.15
basis=Registry(plugin_id='cablesim.standards-basis').get('cablesim.standards-basis').manifest
basis_digest=digest(basis.model_dump(mode='json',by_alias=True))
assert basis.version=='0.9.1'
lookup=next(cap for cap in basis.capabilities if cap.id=='lookup')
assert lookup.method_version=='0.9.1'
for key in ('parameters_unconfirmed','parameters_complete','parameters_null'):
    assert fixed[key]['basis_release_digest']==basis_digest
manifest=Registry(plugin_id='cablesim.gb50217-correction').get('cablesim.gb50217-correction').manifest
cap=next(cap for cap in manifest.capabilities if cap.id=='outdoor-unshaded-rating')
assert manifest.version=='1.0.9' and cap.method_version=='1.0.0'
records_path=Path('plugins/cablesim.standards-basis/src/cablesim_standards_basis/records-installation.json')
records_bytes=records_path.read_bytes()
assert hashlib.sha256(records_bytes).hexdigest()=='2610aa10c0e8ac37ed76da600c475f6ff57a2033c7f18cfdab5201cb9ed21f0f'
records={record['id']:record for record in json.loads(records_bytes)}
positive,negative=records['gb50217-D-0-7/r1/c4'],records['gb50217-D-0-7/r1/c1']
assert positive['value']==.90 and negative['value'] is None
assert positive['conditions']['u_v']['eq']==negative['conditions']['u_v']['eq']==1000
assert positive['conditions']['core_count']['eq']==negative['conditions']['core_count']['eq']==3
assert positive['conditions']['area_m2']['eq']==.000095 and negative['conditions']['area_m2']['eq']==.000035
assert 'pytest' not in sys.modules
sources=[]
for name in ('frontend/src/features/library-import/gb-outdoor-walk.mjs','plugins/cablesim.gb50217-correction/plugin.json','plugins/cablesim.standards-basis/plugin.json',str(records_path)):
    source=Path(name);value=source.read_bytes()
    sources.append(dict(file=name,size=len(value),sha256=hashlib.sha256(value).hexdigest()))
print(json.dumps(dict(fixed,
    preparation=dict(kind='fixed_synthetic_input',input_sha256=hashlib.sha256(raw).hexdigest(),pytest_imported=False,solver_executed=False),
    sources=sources,domain=document,null_domain=null_document,domain_sha256=digest(document),null_domain_sha256=digest(null_document),
    method=dict(plugin_id=manifest.id,version=manifest.version,capability=cap.id,release_digest=digest(manifest.model_dump(mode='json',by_alias=True))),
    method_version=cap.method_version,basis=dict(version=basis.version,method_version=lookup.method_version,release_digest=basis_digest),
    records=dict(resolved=positive,null_cell=negative),record_sha256=digest(positive)),ensure_ascii=False,allow_nan=False))
`;

function atPointer(value, pointer) {
  assert.ok(pointer.startsWith('/'));
  for (const part of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    assert.ok(value !== null && typeof value === 'object' && Object.hasOwn(value, part), `保存输入缺少证据位置：${pointer}`);
    value = value[part];
  }
  return value;
}

export async function walkGbOutdoor({ page, base, viewport, out, root, expect, capture, afterAction, report }) {
  const prefix = `${viewport.width}-gb-outdoor`, layoutStart = report.layout_failures.length;
  const evidence = { viewport, purpose: 'D.0.7 合成机制核验；两条 400 A 输入不是厂家额定值、温度曲线或真实线路验收',
    factory_or_line_verification: false, status: 'running', api_calls: [], ui_requests: [], ui_responses: [],
    console_errors: [], screenshots: [], expected_http_errors: [], cases: [],
    observation_boundary: '只记录本模块开始至返回期间实际收到的事件；不把模块返回视为全页零待定请求' };
  const write = () => fs.writeFile(path.join(out, prefix + '-summary.json'), JSON.stringify(evidence, null, 2));
  const requestRecords = new WeakMap();
  let counter = 0, operation = 'prepare';
  const onRequest = request => {
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith('/api/')) return;
    const record = { id: ++counter, operation, at: new Date().toISOString(), method: request.method(), url: request.url(), status: 'started' };
    requestRecords.set(request, record); evidence.ui_requests.push(record);
  };
  const onResponse = response => { const record = requestRecords.get(response.request()); if (record) { record.headers_at = new Date().toISOString(); record.response_status = response.status(); } };
  const onFinished = request => { const record = requestRecords.get(request); if (record) { record.status = 'finished'; record.finished_at = new Date().toISOString(); } };
  const onFailed = request => { const record = requestRecords.get(request); if (record) { record.status = 'failed'; record.failed_at = new Date().toISOString(); record.failure = request.failure(); } };
  const onConsole = entry => { if (entry.type() === 'error') evidence.console_errors.push({ at: new Date().toISOString(), operation, text: entry.text(), location: entry.location() }); };
  async function shot(label) { await capture(label); evidence.screenshots.push(report.screenshots.at(-1)); await write(); }
  async function api(label, method, endpoint, body, status = 200) {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const requestFile = `${prefix}-${label}-request.bin`;
    if (bytes) await fs.writeFile(path.join(out, requestFile), bytes);
    const startedAt = new Date().toISOString();
    const response = await page.request.fetch(base + endpoint, { method, ...(bytes ? { data: bytes, headers: { 'Content-Type': 'application/json' } } : {}), timeout: 180000 });
    try {
      const raw = await saveRawResponse(response, path.join(out, `${prefix}-${label}-response.json`));
      evidence.api_calls.push({ label, method, endpoint, started_at: startedAt, completed_at: new Date().toISOString(), status: response.status(),
        request: bytes ? { file: requestFile, size: bytes.length, sha256: hash(bytes) } : null, raw_response: raw });
      await write();
      assert.equal(response.status(), status, `${method} ${endpoint}: ${await response.text()}`);
      return await response.json();
    } finally { await response.dispose(); }
  }
  async function recordUi(label, response) {
    const request = response.request(), bytes = request.postDataBuffer(), file = `${prefix}-${label}-request.bin`;
    if (bytes) await fs.writeFile(path.join(out, file), bytes);
    const record = requestRecords.get(request);
    assert.ok(record, '可见控件请求须对应实际 Playwright Request 身份');
    const finishedError = await response.finished();
    const raw = await saveRawResponse(response, path.join(out, `${prefix}-${label}-response.json`));
    evidence.ui_responses.push({ label, request_id: record.id, method: request.method(), url: request.url(), request_headers: safeRequestHeaders(request),
      request: bytes ? { file, size: bytes.length, sha256: hash(bytes) } : null, status: response.status(), raw_response: raw,
      finished_error: finishedError ? String(finishedError) : null, body_completed_at: new Date().toISOString() });
    await write();
    assert.equal(finishedError, null, '完整响应正文必须正常结束');
    await expect.poll(() => record.status).toBe('finished');
    assert.equal(response.status(), 200, await response.text());
    return await response.json();
  }
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfinished', onFinished); page.on('requestfailed', onFailed); page.on('console', onConsole);
  await write();
  try {
    const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
    const bytes = execFileSync(python, ['-c', fixtureSource], { cwd: root, input: fixedSyntheticInput, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    await fs.writeFile(path.join(out, prefix + '-synthetic-input.json'), bytes);
    const fixture = JSON.parse(bytes.toString('utf8'));
    evidence.fixture = { file: prefix + '-synthetic-input.json', size: bytes.length, sha256: hash(bytes), preparation: fixture.preparation, sources: fixture.sources };
    assert.equal(fixture.method.version, '1.0.9'); assert.equal(fixture.method.capability, 'outdoor-unshaded-rating');
    assert.equal(fixture.method.release_digest, releaseDigest); assert.equal(fixture.method_version, '1.0.0');
    assert.deepEqual([fixture.basis.version, fixture.basis.method_version], ['0.9.1', '0.9.1']);
    const baselineBytes = Buffer.from(fixture.baseline_original);
    await fs.writeFile(path.join(out, prefix + '-synthetic-baseline.json'), baselineBytes);
    evidence.baseline_original = { file: prefix + '-synthetic-baseline.json', size: baselineBytes.length, sha256: hash(baselineBytes), purpose: fixture.purpose, area_mm2: 95 };
    const nullBaselineBytes = Buffer.from(fixture.null_baseline_original);
    await fs.writeFile(path.join(out, prefix + '-null-synthetic-baseline.json'), nullBaselineBytes);
    evidence.null_baseline_original = { file: prefix + '-null-synthetic-baseline.json', size: nullBaselineBytes.length, sha256: hash(nullBaselineBytes), purpose: fixture.purpose, area_mm2: 35 };
    assert.equal(hash(baselineBytes), fixture.parameters_unconfirmed.baseline_sha256);
    assert.equal(fixture.parameters_unconfirmed.baseline_current_a, 400);
    assert.equal(fixture.parameters_unconfirmed.baseline_ambient_k, 313.15);
    assert.equal(fixture.parameters_unconfirmed.outdoor_unshaded_confirmed, false);
    assert.equal(fixture.parameters_complete.baseline_current_a, 400);
    assert.equal(fixture.parameters_complete.baseline_ambient_k, 303.15);
    assert.equal(fixture.parameters_complete.outdoor_unshaded_confirmed, true);
    assert.equal(fixture.parameters_complete.baseline_reviewed, true);
    assert.equal(fixture.parameters_complete.baseline_environment, 'indoor_air_at_outdoor_ambient');
    assert.equal(fixture.parameters_complete.baseline_sha256, fixture.parameters_unconfirmed.baseline_sha256);
    assert.match(fixture.parameters_complete.baseline_source, /合成机制/); assert.match(fixture.parameters_complete.baseline_source, /不是厂家额定值/);
    const forbiddenParameters = ['baseline_soil_rho', 'baseline_depth_m', 'tray_kind', 'tray_layout_source', 'tray_layout_confirmed'];
    for (const parameters of [fixture.parameters_unconfirmed, fixture.parameters_complete, fixture.parameters_null]) {
      assert.deepEqual(forbiddenParameters.filter(key => Object.hasOwn(parameters, key)), []);
      assert.equal(parameters.basis_release_digest, fixture.basis.release_digest);
    }
    assert.equal(fixture.records.resolved.id, 'gb50217-D-0-7/r1/c4'); assert.equal(fixture.records.resolved.value, .9);
    assert.equal(fixture.records.null_cell.id, 'gb50217-D-0-7/r1/c1'); assert.equal(fixture.records.null_cell.value, null);
    const methods = await api('methods', 'GET', '/api/methods');
    const candidates = methods.flatMap(card => card.capabilities.filter(cap => card.method.plugin_id === fixture.method.plugin_id && cap.id === fixture.method.capability)
      .map(cap => ({ ...card.method, capability: cap.id })));
    assert.equal(candidates.length, 1); const method = candidates[0]; assert.deepEqual(method, fixture.method);
    const contracts = await api('contract', 'GET', '/api/input-contracts?' + new URLSearchParams(method));
    assert.equal(contracts.length, 1); assert.deepEqual(contracts[0].method, method);
    const contract = contracts[0], properties = contract.parameter_schema.properties;
    assert.equal(contract.parameter_schema.additionalProperties, false);
    assert.deepEqual(Object.keys(properties).sort(), Object.keys(fixture.parameters_complete).sort());
    for (const key of Object.keys(properties).filter(key => key !== 'basis_release_digest')) assert.equal(Object.hasOwn(properties[key], 'default'), false);
    assert.deepEqual(properties.baseline_environment.enum, ['indoor_air_at_outdoor_ambient']);
    for (const key of ['baseline_reviewed', 'outdoor_unshaded_confirmed']) assert.equal(properties[key].type, 'boolean');
    assert.deepEqual(properties.baseline_ambient_k['x-unit'], { si: 'K', display: '°C', scale: 1, offset: -273.15 });

    async function field(key, role) {
      const schema = properties[key]; assert.ok(schema); assert.match(schema.title, /[\u3400-\u9fff]/);
      if (['advanced', 'expert'].includes(schema['x-level'])) {
        const advanced = page.locator('.study-inspector details.parameter-advanced');
        await expect(advanced).toHaveCount(1);
        const toggle = advanced.locator(':scope > summary'); await expect(toggle).toContainText('高级参数');
        if (!await advanced.evaluate(node => node.open)) await toggle.click();
        await expect(advanced).toHaveJSProperty('open', true);
      }
      const title = schema.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const required = contract.parameter_schema.required.includes(key);
      // Shared number/switch labels prefix the required marker; text labels
      // suffix it. Match the full accessible name without choosing an index.
      const name = new RegExp(required ? (role === 'textbox' ? '^' + title + '\\s*\\*$' : '^\\*\\s*' + title + '$') : '^' + title + '$');
      const control = page.getByRole(role, { name });
      await expect(control).toHaveCount(1); await expect(control).toBeVisible(); return control;
    }
    async function prepareCase(label, document, parameters, area, areaMm2, inputSources) {
      const section = document.sections[0], cable = document.cable_types[0], circuit = document.circuits[0];
      assert.deepEqual([document.sections.length, document.circuits.length, section.placements.length, circuit.cables.length], [1, 1, 1, 1]);
      assert.deepEqual([section.kind, section.medium.air_temperature, section.medium.solar_irradiance, section.medium.wind_speed], ['air', 303.15, null, null]);
      assert.deepEqual(section.enclosures, []); assert.deepEqual(section.soil_layers, []); assert.equal(section.backfill, null);
      assert.deepEqual([cable.construction, cable.cores.length, cable.rating.u, circuit.system.voltage, circuit.system.kind], ['three_core', 3, 1000, 1000, 'ac_three_phase']);
      assert.equal(area, areaMm2 * 1e-6);
      assert.deepEqual(cable.cores.map(core => core.conductor.nominal_area), [area, area, area]);
      assert.deepEqual([circuit.cables[0].phase, circuit.cables[0].parallel_index], ['L1L2L3', 1]);
      assert.ok(Object.values(document.provenance).every(source => source.kind === 'demo' && source.reviewed === false));
      let workspace = await api(label + '-create-workspace', 'POST', '/api/workspaces', {}, 201);
      const workspaceRoot = '/api/workspaces/' + workspace.id;
      const converted = await api(label + '-convert-domain', 'POST', workspaceRoot + '/domain/conversion', { expected_revision: workspace.revision });
      await api(label + '-save-domain', 'PUT', workspaceRoot + '/domain', { expected_revision: converted.revision, document });
      workspace = await api(label + '-saved-workspace', 'GET', workspaceRoot);
      assert.deepEqual(workspace.domain, document);
      const title = `D.0.7 合成机制核验 · 1 千伏三芯 ${areaMm2} 平方毫米 · 400 安 · ${viewport.width}`;
      const study = await api(label + '-create-study', 'POST', workspaceRoot + '/studies', { expected_revision: workspace.revision, title, method, task: 'rating', input_source: 'domain',
        parameters, input_sources: inputSources, driver: { kind: 'single' } }, 201);
      assert.deepEqual(study.definition.parameters, parameters); assert.deepEqual(study.definition.input_sources, inputSources);
      const studyRoot = workspaceRoot + '/studies/' + study.id;
      const state = { label, workspaceRoot, studyRoot, localStudyRoot: '/api/hpc' + studyRoot.slice('/api'.length), workspace, study, title };
      evidence.cases.push({ label, workspace_id: workspace.id, workspace_revision: workspace.revision, study_id: study.id, initial_study_revision: study.revision, area_m2: area });
      return state;
    }
    const runPosts = state => evidence.ui_requests.filter(item => item.method === 'POST' && item.url === base + state.studyRoot + '/runs');
    async function unchangedWorkspace(state, label) {
      const saved = await api(label, 'GET', state.workspaceRoot);
      assert.equal(saved.revision, state.workspace.revision); assert.deepEqual(saved.domain, state.workspace.domain); return saved;
    }
    async function openStudy(state) {
      operation = state.label + '-open';
      await page.goto(base + `/studies/${state.study.id}/ampacity/results?workspace=${state.workspace.id}&inspector=method`);
      await expect(page.getByRole('heading', { name: state.title, exact: true })).toBeVisible();
      const environment = page.getByRole('combobox', { name: properties.baseline_environment.title + '（必填）', exact: true });
      await expect(environment).toContainText(properties.baseline_environment['x-enum-labels'].indoor_air_at_outdoor_ambient);
      await expect(page.getByRole('combobox', { name: '方法版本', exact: true })).toContainText('户外无遮阳');
      assert.equal(runPosts(state).length, 0);
    }
    async function save(state, label, parameters, changedKeys) {
      operation = label;
      const previousRevision = state.study.revision, previousSources = structuredClone(state.study.definition.input_sources);
      const response = await afterAction(page.waitForResponse(response => response.url() === base + state.studyRoot && response.request().method() === 'PUT', { timeout: 180000 }),
        () => page.getByRole('toolbar', { name: '工程命令', exact: true }).getByRole('button', { name: '保存修改', exact: true }).click());
      await recordUi(label, response);
      const request = response.request().postDataJSON();
      assert.deepEqual(request.parameters, parameters); assert.deepEqual(request.method, method);
      assert.equal(request.input_source, 'domain'); assert.equal(request.driver.kind, 'single');
      assert.deepEqual([request.expected_revision, request.expected_study_revision], [state.workspace.revision, previousRevision]);
      state.study = await api(label + '-readback', 'GET', state.studyRoot);
      assert.equal(state.study.revision, previousRevision + 1); assert.deepEqual(state.study.definition.parameters, parameters);
      assert.deepEqual(state.study.definition.method, method); assert.equal(state.study.definition.input_source, 'domain'); assert.equal(state.study.definition.driver.kind, 'single');
      const expectedSources = { ...previousSources };
      for (const key of changedKeys) {
        const source = state.study.definition.input_sources['/parameters/' + key];
        assert.equal(source.kind, 'user'); assert.equal(source.reviewed, false); assert.ok(source.reference.trim());
        expectedSources['/parameters/' + key] = source;
      }
      assert.deepEqual(request.input_sources, expectedSources);
      assert.deepEqual(state.study.definition.input_sources, expectedSources);
      await expect(page.getByRole('toolbar', { name: '工程命令', exact: true }).getByRole('button', { name: '已保存', exact: true })).toBeDisabled();
      await unchangedWorkspace(state, label + '-workspace');
    }
    async function renameAndSave(state, label, parameters) {
      await page.locator('.topbar .status-mark').click(); await page.getByRole('button', { name: '修改研究名称', exact: true }).click();
      state.title += ' · 已核对保存输入';
      await page.getByRole('textbox', { name: '研究名称', exact: true }).fill(state.title);
      await page.getByRole('button', { name: '保留草稿', exact: true }).click();
      await save(state, label, parameters, []);
    }
    async function preflight(state, label, expected) {
      operation = label;
      const [input, response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === state.localStudyRoot + '/input-preflight' && response.request().method() === 'GET', { timeout: 180000 }),
        page.waitForResponse(response => new URL(response.url()).pathname === state.studyRoot + '/preflight' && response.request().method() === 'GET', { timeout: 180000 }),
        page.getByRole('button', { name: '预检并运行', exact: true }).click(),
      ]);
      const inputResult = await recordUi(label + '-input', input);
      assert.deepEqual([inputResult.ready, inputResult.input_ready, inputResult.local_only], [false, true, true]);
      assert.deepEqual(inputResult.cases.map(item => item.status), ['succeeded']);
      const result = await recordUi(label, response), query = new URL(response.url()).searchParams;
      assert.equal(query.get('expected_revision'), String(state.workspace.revision)); assert.equal(query.get('expected_study_revision'), String(state.study.revision));
      assert.equal(result.ready, expected.ready); assert.equal(result.cases.length, 1);
      const dialog = page.getByRole('dialog', { name: '运行前预检', exact: true }); await expect(dialog).toBeVisible();
      const run = dialog.getByRole('button', { name: '确认并运行', exact: true });
      if (expected.ready) {
        assert.deepEqual(result.runnable_case_ids, ['case-0']); assert.equal(result.partial, false); assert.equal(result.cases[0].status, 'succeeded'); await expect(run).toBeEnabled();
      } else {
        assert.deepEqual(result.runnable_case_ids, []); assert.equal(result.cases[0].status, 'not_applicable');
        assert.equal(result.cases[0].error.code, expected.code); assert.equal(result.cases[0].error.field, expected.field);
        await expect(dialog).toContainText(result.cases[0].error.message); await expect(run).toBeDisabled();
        assert.equal(runPosts(state).length, 0); assert.deepEqual((await api(label + '-runs', 'GET', state.studyRoot + '/runs?view=full')).items, []);
      }
      await shot(expected.screenshot); return { result, dialog, run };
    }

    const primary = await prepareCase('same-temperature', fixture.domain, fixture.parameters_unconfirmed, 95 * 1e-6, 95, fixture.input_sources);
    await openStudy(primary);
    const initialTemperature = await field('baseline_ambient_k', 'spinbutton'); await expect(initialTemperature).toHaveValue('40');
    await initialTemperature.scrollIntoViewIfNeeded(); await expect(initialTemperature).toBeInViewport({ ratio: 1 });
    await shot('D07合成原件40度行基准400安与实际户外30度分开');
    const unshaded = await field('outdoor_unshaded_confirmed', 'switch'); await expect(unshaded).not.toBeChecked();
    await unshaded.scrollIntoViewIfNeeded(); await expect(unshaded).toBeInViewport({ ratio: 1 });
    await shot('D07合成400安机制未人工确认无遮阳');
    await renameAndSave(primary, 'unconfirmed-save', fixture.parameters_unconfirmed);
    const unconfirmed = await preflight(primary, 'unconfirmed', { ...fixture.refusals.unconfirmed, screenshot: 'D07未人工确认无遮阳实际拒绝且零运行' });
    await page.keyboard.press('Escape'); await expect(unconfirmed.dialog).toBeHidden();
    const confirmation = await field('outdoor_unshaded_confirmed', 'switch'); await confirmation.click(); await expect(confirmation).toBeChecked();
    const mismatched = { ...fixture.parameters_unconfirmed, outdoor_unshaded_confirmed: true };
    await save(primary, 'confirmed-mismatched-save', mismatched, ['outdoor_unshaded_confirmed']);
    const mismatch = await preflight(primary, 'baseline-mismatch', { ...fixture.refusals.baseline_mismatch, screenshot: 'D07基准40度与保存户外30度不符实际拒绝' });
    await page.keyboard.press('Escape'); await expect(mismatch.dialog).toBeHidden();
    const correctedTemperature = await field('baseline_ambient_k', 'spinbutton'); await correctedTemperature.fill('30'); await correctedTemperature.blur();
    const correctedSource = await field('baseline_source', 'textbox'); await correctedSource.fill(fixture.parameters_complete.baseline_source); await correctedSource.blur();
    const reviewed = await field('baseline_reviewed', 'switch'); await expect(reviewed).toBeChecked();
    await reviewed.click(); await expect(reviewed).not.toBeChecked(); await reviewed.click(); await expect(reviewed).toBeChecked();
    const shownTemperature = await field('baseline_ambient_k', 'spinbutton'); await expect(shownTemperature).toHaveValue('30');
    await shownTemperature.scrollIntoViewIfNeeded(); await expect(shownTemperature).toBeInViewport({ ratio: 1 });
    await shot('D07人工更改为同温30度基准未叠加温度系数');
    await expect(await field('outdoor_unshaded_confirmed', 'switch')).toBeChecked();
    await correctedSource.scrollIntoViewIfNeeded(); await expect(correctedSource).toBeInViewport({ ratio: 1 });
    await shot('D07合成原件对应30度行来源与重新确认');
    await save(primary, 'same-ambient-save', fixture.parameters_complete, ['baseline_ambient_k', 'baseline_source', 'baseline_reviewed']);
    const ready = await preflight(primary, 'same-ambient', { ready: true, screenshot: 'D07同温30度与无遮阳声明预检通过尚未运行' });
    assert.equal(runPosts(primary).length, 0); operation = 'manual-run';
    const runResponse = await afterAction(page.waitForResponse(response => response.url() === base + primary.studyRoot + '/runs' && response.request().method() === 'POST', { timeout: 180000 }), () => ready.run.click());
    const receipt = await recordUi('manual-run', runResponse);
    assert.equal(runPosts(primary).length, 1);
    const request = runResponse.request().postDataJSON();
    assert.equal(request.scope_acknowledged, true); assert.equal(request.lock_digest, ready.result.lock_digest);
    assert.deepEqual([request.expected_revision, request.expected_study_revision], [primary.workspace.revision, primary.study.revision]);
    assert.deepEqual([receipt.status, receipt.integrity], ['succeeded', 'verified']);
    const run = await api('saved-run-readback', 'GET', primary.studyRoot + '/runs/' + receipt.id + '?view=full');
    assert.deepEqual(run.output, receipt.output); assert.deepEqual(run.snapshot, receipt.snapshot);
    assert.deepEqual([run.id, run.status, run.integrity], [receipt.id, 'succeeded', 'verified']);
    assert.deepEqual([run.snapshot.workspace_id, run.snapshot.workspace_revision, run.snapshot.study_id, run.snapshot.study_revision],
      [primary.workspace.id, primary.workspace.revision, primary.study.id, primary.study.revision]);
    assert.deepEqual(run.snapshot.definition.method, method); assert.equal(run.output.plugin_id, method.plugin_id);
    assert.deepEqual(run.snapshot.definition.parameters, fixture.parameters_complete); assert.deepEqual(run.snapshot.definition.input_sources, primary.study.definition.input_sources);
    assert.deepEqual(run.snapshot.cases[0].input, primary.workspace.domain);
    assert.deepEqual([run.output.capability, run.output.plugin_version, run.output.method_version, run.output.environment.method], ['outdoor-unshaded-rating', '1.0.9', '1.0.0', '1.0.0']);
    const result = run.output.cases[0], trace = result.artifacts[artifactType];
    assert.ok(trace); assert.equal(result.status, 'succeeded');
    assert.equal(trace.domain_input_sha256, fixture.domain_sha256); assert.deepEqual(trace.baseline, fixture.parameters_complete);
    assert.equal(trace.corrected_current_a, 360); assert.equal(trace.total_factor, .9);
    assert.equal(trace.coefficients.length, 1); assert.deepEqual(trace.coefficients.map(item => item.record.clause), ['D.0.7']);
    const coefficient = trace.coefficients[0];
    assert.equal(coefficient.factor, .9); assert.equal(coefficient.release_digest, fixture.basis.release_digest);
    for (const [key, value] of Object.entries(fixture.records.resolved)) assert.deepEqual(coefficient.record[key], value, '原标准记录必须逐字段回读：' + key);
    assert.equal(coefficient.record.record_sha256, fixture.record_sha256);
    assert.deepEqual([coefficient.record.printed_page, coefficient.record.pdf_page, coefficient.record.source_sha256],
      [74, 84, '5e15e9a4a78e40df66a8b91a2e6f5da3047e92304dc0eb7cb62522e418e09483']);
    assert.deepEqual([coefficient.answer.status, coefficient.answer.plugin_version, coefficient.answer.approval], ['resolved', '0.9.1', 'not_granted']);
    assert.deepEqual(coefficient.query.conditions, { current_basis_environment: 'indoor_air_at_outdoor_ambient', outdoor_unshaded: 'yes', u_v: 1000, core_count: 3, area_m2: primary.workspace.domain.cable_types[0].cores[0].conductor.nominal_area });
    for (const key of ['request_sha256', 'artifact_sha256']) assert.match(coefficient[key], /^[a-f0-9]{64}$/);
    const conditions = trace.actual_conditions;
    assert.deepEqual([conditions.source_kind, conditions.confidence, conditions.approval, conditions.method_version], ['declared', 'reference', 'not_granted', '1.0.0']);
    assert.deepEqual([conditions.ambient_temperature_k, conditions.conductor_max_working_temperature_k, conditions.cable_count, conditions.core_count, conditions.area_m2], [303.15, 363.15, 1, 3, 95 * 1e-6]);
    assert.equal(conditions.exposure_source, fixture.parameters_complete.outdoor_exposure_source); assert.ok(conditions.input_sources.length > 0);
    for (const source of conditions.input_sources) {
      assert.deepEqual(source.source, primary.workspace.domain.provenance[source.source_path]);
      assert.equal(source.source.kind, 'demo'); assert.equal(source.source.reviewed, false);
      assert.deepEqual(source.value, atPointer(primary.workspace.domain, source.indexed_path));
    }
    const currents = result.results.filter(item => item.key === 'ampacity'); assert.equal(currents.length, 1);
    assert.deepEqual([currents[0].value, currents[0].unit, currents[0].rating_basis.kind, currents[0].case], [360, 'A', 'single_circuit', 'rating-simultaneous']);
    assert.deepEqual(currents[0].rating_basis.varied_circuits, [primary.workspace.domain.circuits[0].id]);
    assert.match(result.artifact_digests[artifactType], /^[a-f0-9]{64}$/);
    assert.deepEqual((await api('runs-after', 'GET', primary.studyRoot + '/runs?view=full')).items.map(item => item.id), [run.id]);
    await unchangedWorkspace(primary, 'workspace-after-run');
    await expect(ready.dialog).toBeHidden();
    const conclusion = page.getByRole('region', { name: 'GB 50217 校正结论', exact: true });
    await expect(conclusion).toBeVisible(); await expect(conclusion).toContainText('400'); await expect(conclusion).toContainText('360');
    await conclusion.scrollIntoViewIfNeeded(); await shot('D07合成400安仅乘标准0点90实际保存360安');
    const coefficients = page.locator('details.study-detail-group').filter({ has: page.locator(':scope > summary', { hasText: /^校正系数与标准出处/ }) });
    await expect(coefficients).toHaveCount(1);
    if (!await coefficients.evaluate(node => node.open)) await coefficients.locator(':scope > summary').click();
    const table = coefficients.getByRole('table', { name: 'GB 50217 校正系数', exact: true });
    await expect(table.getByRole('row')).toHaveCount(2); await expect(table).toContainText('D.0.7'); await expect(table).toContainText('74');
    await expect(table).not.toContainText(/D\.0\.[1-6]/); await table.scrollIntoViewIfNeeded(); await shot('D07唯一系数与表74页同温条件完整显示');
    const baseline = page.locator('details.study-detail-group').filter({ has: page.locator(':scope > summary', { hasText: /^基准条件与来源$/ }) });
    await expect(baseline).toHaveCount(1);
    if (!await baseline.evaluate(node => node.open)) await baseline.locator(':scope > summary').click();
    await expect(baseline).toContainText(fixture.parameters_complete.baseline_source); await expect(baseline).toContainText('不代表厂家已保证');
    await baseline.scrollIntoViewIfNeeded(); await shot('D07合成基准两条机制输入且不代表厂家额定');
    evidence.result = { study: primary.study, run_id: run.id, input_digest: run.input_digest, output_digest: run.output_digest,
      artifact_digest: result.artifact_digests[artifactType], corrected_current_a: trace.corrected_current_a, total_factor: trace.total_factor,
      method_version: run.output.method_version, plugin_version: run.output.plugin_version, coefficient_count: 1,
      domain_unchanged: true, automatic_run_posts: 0, explicit_run_posts: runPosts(primary).length };

    assert.deepEqual([fixture.parameters_null.baseline_current_a, fixture.parameters_null.baseline_ambient_k, fixture.parameters_null.baseline_sha256], [400, 303.15, hash(nullBaselineBytes)]);
    assert.equal(fixture.parameters_null.outdoor_unshaded_confirmed, true); assert.equal(fixture.parameters_null.baseline_reviewed, true);
    assert.match(fixture.parameters_null.baseline_source, /35/); assert.match(fixture.parameters_null.baseline_source, /合成机制/);
    const nullCell = await prepareCase('null-cell', fixture.null_domain, fixture.parameters_null, 35 * 1e-6, 35, fixture.null_input_sources);
    await openStudy(nullCell); await renameAndSave(nullCell, 'null-cell-save', fixture.parameters_null);
    const refused = await preflight(nullCell, 'null-cell', { ...fixture.refusals.null_cell, screenshot: 'D07一千伏三芯35平方原空格实际拒绝不补系数' });
    await page.keyboard.press('Escape'); await expect(refused.dialog).toBeHidden();
    const savedNull = await api('null-cell-study-readback', 'GET', nullCell.studyRoot);
    assert.deepEqual(savedNull, nullCell.study); await unchangedWorkspace(nullCell, 'null-cell-workspace-readback');
    assert.equal(runPosts(nullCell).length, 0); assert.equal(runPosts(primary).length, 1);
    assert.equal(evidence.api_calls.filter(item => item.method === 'POST' && item.endpoint.endsWith('/runs')).length, 0);
    assert.deepEqual(evidence.ui_requests.filter(item => item.method !== 'GET').map(item => [item.method, item.url]), [
      ['PUT', base + primary.studyRoot], ['PUT', base + primary.studyRoot], ['PUT', base + primary.studyRoot],
      ['POST', base + primary.studyRoot + '/runs'], ['PUT', base + nullCell.studyRoot],
    ], '界面只可保存四次研究并人工运行一次，不得额外写入、自动运行或批准');
    evidence.null_cell = { study: nullCell.study, record: fixture.records.null_cell, refusal: refused.result, domain_unchanged: true, run_posts: 0 };
    evidence.data_checks_passed = true;
    evidence.layout_failures = report.layout_failures.slice(layoutStart);
    assert.deepEqual(evidence.layout_failures.map(item => ({ screenshot: item.screenshot, message: item.message })), [], 'D07机制流程的原布局和可见名称门禁未通过');
    evidence.status = 'passed';
    report.checks.push(`${viewport.width}：D.0.7 独立方法经真实研究表单保存、预检和人工运行。无遮阳未确认与40℃基准/30℃户外错配分别拒绝且零运行；人工改为同温30℃、原件对应行并重新确认后，400A合成机制输入仅乘标准0.90得360A，无D.0.1–6叠加。1kV三芯35mm²原null另存研究并实际拒绝，零运行。标准0.9.1原页/记录/摘要、真实参数来源与Domain回读一致，风速与辐照均为空、参考未批准。400A及30/40℃两行不是厂家额定、温度曲线或完整线路验证。`);
  } catch (error) {
    evidence.status = 'failed'; evidence.error = { name: error.name, message: error.message, stack: error.stack };
    try {
      const screenshot = prefix + '-failure.png'; await page.screenshot({ path: path.join(out, screenshot) });
      await fs.writeFile(path.join(out, prefix + '-failure.txt'), await page.locator('body').innerText());
      evidence.screenshots.push(screenshot); report.screenshots.push(screenshot);
    } catch (captureError) { evidence.failure_capture_error = String(captureError); }
    throw error;
  } finally {
    page.off('request', onRequest); page.off('response', onResponse); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed); page.off('console', onConsole);
    evidence.observation_closed_at = new Date().toISOString(); await write();
  }
}
