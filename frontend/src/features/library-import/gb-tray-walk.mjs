import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { safeRequestHeaders, saveRawResponse } from './resource-exchange-walk.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const trayFields = ['tray_kind', 'tray_layout_source', 'tray_layout_confirmed'];
const artifactType = 'x-cablesim.gb50217-correction';
const releaseDigest = '0d15c0740489df0fab5a65bf66a18542c2fd9e8825327d02d694caceb02bdf78';

// Fixed synthetic values captured from tray_example(kind, 1) at the exact
// test-source SHA checked below. Both kinds use this same seven-cable Domain;
// only the explicit tray-kind declaration differs. These are mechanism inputs,
// never manufacturer data. Runtime preparation reads no test module and runs no
// correction method, service or solver.
const fixedSyntheticInput = String.raw`{
  "domain": {
    "schema_version": "cablesim.domain/1",
    "name": "D.0.6 合成机制核验，不是厂家或真实线路示例",
    "materials": [
      {
        "id": "material/conductor",
        "label": "copper",
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
        "label": "v0 semiconductor",
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
        "label": "v0 insulation",
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
        "label": "v0 screen, construction unspecified",
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
        "label": "v0 oversheath",
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
      },
      {
        "id": "material/soil",
        "label": "v0 soil",
        "category": "soil",
        "standard_kind": null,
        "thermal_resistivity": 1.2,
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
        "label": "演示 · Cu / XLPE 12/20 kV · 1×240",
        "construction": "three_core",
        "rating": {
          "u0": 12000.0,
          "u": null,
          "um": null,
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
              "nominal_area": 0.00023999999999999998,
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
            "z": 0.0
          },
          {
            "id": "core/k1",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.00023999999999999998,
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
            "z": 0.0
          },
          {
            "id": "core/k2",
            "conductor": {
              "material": "material/conductor",
              "form": "unspecified",
              "nominal_area": 0.00023999999999999998,
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
            "x": 0.0,
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
          "frequency": 50.0,
          "voltage": 10000.0
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
      },
      {
        "id": "circuit/c2",
        "label": "回路 2",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50.0,
          "voltage": 10000.0
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p2",
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
      },
      {
        "id": "circuit/c3",
        "label": "回路 3",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50.0,
          "voltage": 10000.0
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p3",
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
      },
      {
        "id": "circuit/c4",
        "label": "回路 4",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50.0,
          "voltage": 10000.0
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p4",
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
      },
      {
        "id": "circuit/c5",
        "label": "回路 5",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50.0,
          "voltage": 10000.0
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p5",
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
      },
      {
        "id": "circuit/c6",
        "label": "回路 6",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50.0,
          "voltage": 10000.0
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p6",
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
      },
      {
        "id": "circuit/c7",
        "label": "回路 7",
        "system": {
          "kind": "ac_three_phase",
          "frequency": 50.0,
          "voltage": 10000.0
        },
        "cable_type": "cable_type/ct1",
        "cables": [
          {
            "id": "cable/p7",
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
        "label": "v0 buried section",
        "kind": "air",
        "length": 1000.0,
        "medium": {
          "material": "material/soil",
          "surface_temperature": null,
          "air_temperature": 313.15,
          "wind_speed": 0.0,
          "solar_irradiance": 0.0,
          "ventilation": "natural"
        },
        "enclosures": [
          {
            "id": "enclosure/tray1",
            "type": "tray",
            "x": 0.0,
            "z": 0.0,
            "material": null,
            "inner_diameter": null,
            "outer_diameter": null,
            "width": null,
            "height": null,
            "contains": [
              "cable/p1",
              "cable/p2",
              "cable/p3",
              "cable/p4",
              "cable/p5",
              "cable/p6",
              "cable/p7"
            ]
          }
        ],
        "placements": [
          {
            "cable": "cable/p1",
            "x": 0.0,
            "z": 0.0,
            "enclosure": "enclosure/tray1"
          },
          {
            "cable": "cable/p2",
            "x": 0.17782496766671074,
            "z": 0.0,
            "enclosure": "enclosure/tray1"
          },
          {
            "cable": "cable/p3",
            "x": 0.3556499353334215,
            "z": 0.0,
            "enclosure": "enclosure/tray1"
          },
          {
            "cable": "cable/p4",
            "x": 0.5334749030001322,
            "z": 0.0,
            "enclosure": "enclosure/tray1"
          },
          {
            "cable": "cable/p5",
            "x": 0.711299870666843,
            "z": 0.0,
            "enclosure": "enclosure/tray1"
          },
          {
            "cable": "cable/p6",
            "x": 0.8891248383335537,
            "z": 0.0,
            "enclosure": "enclosure/tray1"
          },
          {
            "cable": "cable/p7",
            "x": 1.0669498060002645,
            "z": 0.0,
            "enclosure": "enclosure/tray1"
          }
        ],
        "layout_template": {
          "kind": "flat",
          "depth": 0.8,
          "spacing": 0.12
        },
        "backfill": null,
        "soil_layers": []
      }
    ],
    "load_cases": [
      {
        "id": "load/steady",
        "kind": "steady",
        "currents": {
          "circuit/c1": 300.0,
          "circuit/c2": 300.0,
          "circuit/c3": 300.0,
          "circuit/c4": 300.0,
          "circuit/c5": 300.0,
          "circuit/c6": 300.0,
          "circuit/c7": 300.0
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
      "/cable_types/cable_type~1ct1": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/circuits/circuit~1c1": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/circuits/circuit~1c2": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/circuits/circuit~1c3": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/circuits/circuit~1c4": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/circuits/circuit~1c5": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/circuits/circuit~1c6": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/circuits/circuit~1c7": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      },
      "/sections/section~1s1": {
        "kind": "demo",
        "reference": "D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据",
        "reviewed": false
      }
    },
    "measurements": []
  },
  "parameters_without_tray": {
    "baseline_current_a": 400.0,
    "baseline_ambient_k": 313.15,
    "baseline_soil_rho": 1.2,
    "baseline_kind": "manufacturer",
    "baseline_source": "手算核验用人工给定基准；单根、同温限及埋深；不是厂家额定值",
    "baseline_sha256": "c7e9203a6da0c126bb5833a16d4b412b1152babd34631e963a2b90f572a17ce3",
    "baseline_page": 1,
    "baseline_depth_m": 0.8,
    "baseline_reviewed": true,
    "basis_release_digest": "1babba59486ce48b4581ee0d1b4058cff93b58b6ab7230b4794c81f85f6be743"
  },
  "tray_layout_source": "D.0.6 合成机制布局 v1；人工声明桥架类别和各层实际位置；不是工程或厂家凭证",
  "tray_layout_confirmed": true
}`;

const fixtureSource = String.raw`
import hashlib,json,sys
from pathlib import Path
from cablesim_sdk.domain import DomainDocument
from backend.plugin_host.registry import Registry

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()

source=Path('tests/test_gb50217_correction.py')
source_sha256=hashlib.sha256(source.read_bytes()).hexdigest()
assert source_sha256=='222c5fc5c8feea2609454eb6c65fcdcafe054e73c986dc93a036c45b30be5b3c', 'Frozen synthetic input source changed; compare every value before recapturing'
assert sys.argv[1] in ('ladder','tray')
fixed=json.load(sys.stdin)
document=DomainDocument.model_validate(fixed['domain']).model_dump(mode='json')
assert document==fixed['domain'], 'Frozen synthetic Domain must already be complete'
parameters=fixed['parameters_without_tray']
keys=('tray_kind','tray_layout_source','tray_layout_confirmed')
assert not any(key in parameters for key in keys)
baseline=json.dumps({'synthetic_baseline_a':400},sort_keys=True,ensure_ascii=False,separators=(',',':'))
assert hashlib.sha256(baseline.encode()).hexdigest()==parameters['baseline_sha256']
basis=Registry(plugin_id='cablesim.standards-basis').get('cablesim.standards-basis').manifest
assert digest(basis.model_dump(mode='json',by_alias=True))==parameters['basis_release_digest'], 'Frozen synthetic baseline basis pin changed'
manifest=Registry(plugin_id='cablesim.gb50217-correction').get('cablesim.gb50217-correction').manifest
print(json.dumps(dict(purpose='400 A 合成机制核验；不是厂家额定值或真实线路验收',
 source=dict(file=str(source),size=source.stat().st_size,sha256=source_sha256),
 preparation=dict(kind='fixed_synthetic_input',original_fixture='tray_example(kind, 1)',fixed_input_sha256=digest(fixed)),
 domain=document,domain_sha256=digest(document),parameters_without_tray=parameters,
 tray_declarations=dict(tray_kind=sys.argv[1],tray_layout_source=fixed['tray_layout_source'],tray_layout_confirmed=fixed['tray_layout_confirmed']),baseline_original=baseline,
 diameter_m=DomainDocument.model_validate(document).cable_types[0].radius()*2,
 method=dict(plugin_id=manifest.id,version=manifest.version,capability='steady-rating',
 release_digest=digest(manifest.model_dump(mode='json',by_alias=True)))),ensure_ascii=False,allow_nan=False))
`;

function atPointer(value, pointer) {
  assert.ok(pointer.startsWith('/'));
  for (const part of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    assert.ok(value !== null && typeof value === 'object' && Object.hasOwn(value, part), `保存输入缺少证据位置：${pointer}`);
    value = value[part];
  }
  return value;
}

/** The saved Study form supplies all new conditions. The 400 A starting input
 * is deliberately synthetic and is never claimed as a manufacturer's rating. */
export async function walkGbTray({ page, base, viewport, out, root, expect, capture, select, afterAction, report }) {
  const prefix = `${viewport.width}-gb-tray`;
  const layoutStart = report.layout_failures.length;
  const kind = viewport.width === 1366 ? 'ladder' : 'tray';
  const kindLabel = kind === 'ladder' ? '梯架' : '托盘';
  const expectedFactor = kind === 'ladder' ? .8 : .7;
  const title = `D.0.6 合成机制核验 · 400 A · ${kindLabel} · ${viewport.width}`;
  const evidence = { viewport, purpose: '400 A 合成机制核验；不是厂家额定值或真实线路验收', factory_or_line_verification: false,
    status: 'running', api_calls: [], ui_requests: [], ui_responses: [], console_errors: [], screenshots: [], expected_http_errors: [] };
  const write = () => fs.writeFile(path.join(out, prefix + '-summary.json'), JSON.stringify(evidence, null, 2));
  const requestRecords = new WeakMap();
  let studyRoot = '', localStudyRoot = '', counter = 0;
  const onRequest = request => {
    if (!studyRoot || ![studyRoot, localStudyRoot].some(prefix => request.url().startsWith(base + prefix))) return;
    const record = { id: ++counter, at: new Date().toISOString(), method: request.method(), url: request.url(), status: 'started' };
    requestRecords.set(request, record); evidence.ui_requests.push(record);
  };
  const onResponse = response => {
    const record = requestRecords.get(response.request());
    if (record) { record.headers_at = new Date().toISOString(); record.response_status = response.status(); }
  };
  const onFinished = request => { const record = requestRecords.get(request); if (record) { record.status = 'finished'; record.finished_at = new Date().toISOString(); } };
  const onFailed = request => { const record = requestRecords.get(request); if (record) { record.status = 'failed'; record.failed_at = new Date().toISOString(); record.failure = request.failure(); } };
  const onConsole = entry => { if (entry.type() === 'error') evidence.console_errors.push({ at: new Date().toISOString(), text: entry.text(), location: entry.location() }); };
  async function shot(label) { await capture(label); evidence.screenshots.push(report.screenshots.at(-1)); await write(); }
  async function api(label, method, endpoint, body, status = 200) {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const requestFile = `${prefix}-${label}-request.bin`;
    if (bytes) await fs.writeFile(path.join(out, requestFile), bytes);
    const response = await page.request.fetch(base + endpoint, { method, ...(bytes ? { data: bytes, headers: { 'Content-Type': 'application/json' } } : {}), timeout: 180000 });
    try {
      const raw = await saveRawResponse(response, path.join(out, `${prefix}-${label}-response.json`));
      evidence.api_calls.push({ label, method, endpoint, status: response.status(), request: bytes ? { file: requestFile, size: bytes.length, sha256: hash(bytes) } : null, raw_response: raw });
      assert.equal(response.status(), status, `${method} ${endpoint}: ${await response.text()}`);
      return await response.json();
    } finally { await response.dispose(); }
  }
  async function recordUi(label, response) {
    const request = response.request(), bytes = request.postDataBuffer(), file = `${prefix}-${label}-request.bin`;
    if (bytes) await fs.writeFile(path.join(out, file), bytes);
    const raw = await saveRawResponse(response, path.join(out, `${prefix}-${label}-response.json`));
    const record = requestRecords.get(request);
    assert.ok(record, '可见控件请求须对应实际 Playwright Request 身份');
    evidence.ui_responses.push({ label, request_id: record.id, method: request.method(), url: request.url(), request_headers: safeRequestHeaders(request),
      request: bytes ? { file, size: bytes.length, sha256: hash(bytes) } : null, status: response.status(), raw_response: raw, body_completed_at: new Date().toISOString() });
    assert.equal(response.status(), 200, await response.text());
    return await response.json();
  }
  async function advanced() {
    const details = page.locator('.study-inspector details.parameter-advanced');
    await expect(details).toHaveCount(1);
    const toggle = details.locator(':scope > summary');
    await expect(toggle).toContainText('高级参数');
    if (!await details.evaluate(node => node.open)) await toggle.click();
    await expect(details).toHaveJSProperty('open', true);
    const group = details.getByRole('region', { name: '桥架适用条件（可选，三项须同时提供）', exact: true });
    await expect(group).toHaveCount(1);
    return { group, source: group.getByRole('textbox', { name: '桥架与布局出处', exact: true }),
      confirmed: group.getByRole('switch', { name: '已核对桥架类别与保存布局', exact: true }) };
  }
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfinished', onFinished); page.on('requestfailed', onFailed); page.on('console', onConsole);
  await write();
  try {
    const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
    const bytes = execFileSync(python, ['-c', fixtureSource, kind], { cwd: root, input: fixedSyntheticInput, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    await fs.writeFile(path.join(out, prefix + '-synthetic-input.json'), bytes);
    const fixture = JSON.parse(bytes.toString('utf8'));
    evidence.fixture = { file: prefix + '-synthetic-input.json', size: bytes.length, sha256: hash(bytes), source: fixture.source };
    assert.equal(fixture.source.sha256, '222c5fc5c8feea2609454eb6c65fcdcafe054e73c986dc93a036c45b30be5b3c');
    assert.equal(fixture.method.version, '1.0.8'); assert.equal(fixture.method.release_digest, releaseDigest);
    const baselineBytes = Buffer.from(fixture.baseline_original);
    await fs.writeFile(path.join(out, prefix + '-synthetic-baseline.json'), baselineBytes);
    assert.equal(hash(baselineBytes), fixture.parameters_without_tray.baseline_sha256);
    assert.equal(fixture.parameters_without_tray.baseline_current_a, 400);
    assert.match(fixture.parameters_without_tray.baseline_source, /不是厂家额定值/);
    assert.deepEqual(trayFields.filter(key => Object.hasOwn(fixture.parameters_without_tray, key)), []);
    assert.equal(Object.keys(fixture.parameters_without_tray).length, 10);
    assert.deepEqual(fixture.tray_declarations, { tray_kind: kind, tray_layout_source: 'D.0.6 合成机制布局 v1；人工声明桥架类别和各层实际位置；不是工程或厂家凭证', tray_layout_confirmed: true });
    const domain = fixture.domain, section = domain.sections[0];
    assert.deepEqual([domain.sections.length, section.kind, section.medium.air_temperature, domain.circuits.length, section.enclosures.length, section.placements.length], [1, 'air', 313.15, 7, 1, 7]);
    assert.equal(domain.cable_types[0].construction, 'three_core');
    assert.equal(domain.cable_types[0].rating.max_conductor_temperature.normal, 363.15);
    assert.ok(domain.circuits.every(circuit => circuit.cables.length === 1 && circuit.system.voltage === 10000));
    assert.equal(section.enclosures[0].type, 'tray');
    for (const [index, position] of section.placements.entries()) {
      assert.equal(position.x, index * fixture.diameter_m); assert.equal(position.z, 0);
      assert.equal(position.enclosure, section.enclosures[0].id);
    }
    assert.deepEqual(section.enclosures[0].contains, section.placements.map(position => position.cable));
    assert.ok(Object.values(domain.provenance).every(source => source.kind === 'demo' && source.reviewed === false));
    const methods = await api('methods', 'GET', '/api/methods');
    const candidates = methods.filter(item => item.method.plugin_id === fixture.method.plugin_id);
    assert.equal(candidates.length, 1);
    const method = { ...candidates[0].method, capability: 'steady-rating' };
    assert.deepEqual(method, fixture.method);
    const contracts = await api('contract', 'GET', '/api/input-contracts?' + new URLSearchParams(method));
    assert.equal(contracts.length, 1); assert.deepEqual(contracts[0].method, method);
    const contract = contracts[0];
    for (const key of trayFields) {
      const field = contract.parameter_schema.properties[key];
      assert.ok(field); assert.equal(field['x-level'], 'advanced');
      assert.equal(Object.hasOwn(field, 'default'), false); assert.equal(contract.parameter_schema.required.includes(key), false);
    }
    assert.deepEqual(contract.parameter_schema.properties.tray_kind.enum, ['ladder', 'tray']);
    assert.equal(contract.parameter_schema.properties.tray_layout_confirmed.type, 'boolean');
    let workspace = await api('create-workspace', 'POST', '/api/workspaces', {}, 201);
    const workspaceRoot = '/api/workspaces/' + workspace.id;
    const converted = await api('convert-domain', 'POST', workspaceRoot + '/domain/conversion', { expected_revision: workspace.revision });
    await api('save-domain', 'PUT', workspaceRoot + '/domain', { expected_revision: converted.revision, document: domain });
    workspace = await api('saved-workspace', 'GET', workspaceRoot);
    assert.deepEqual(workspace.domain, domain);
    const preparedRevision = workspace.revision;
    let study = await api('create-study', 'POST', workspaceRoot + '/studies', { expected_revision: preparedRevision, title, method, task: 'rating', input_source: 'domain',
      parameters: fixture.parameters_without_tray, input_sources: {}, driver: { kind: 'single' } }, 201);
    studyRoot = workspaceRoot + '/studies/' + study.id;
    localStudyRoot = '/api/hpc' + studyRoot.slice('/api'.length);
    evidence.identity = { workspace_id: workspace.id, workspace_revision: preparedRevision, study_id: study.id, method };
    assert.deepEqual(study.definition.parameters, fixture.parameters_without_tray);
    assert.deepEqual(study.definition.input_sources, {});
    const runPosts = () => evidence.ui_requests.filter(item => item.method === 'POST' && item.url === base + studyRoot + '/runs');
    const unchangedWorkspace = async label => {
      const saved = await api(label, 'GET', workspaceRoot);
      assert.equal(saved.revision, preparedRevision); assert.deepEqual(saved.domain, workspace.domain);
      return saved;
    };
    async function savedFromUi(label, expectedParameters) {
      const beforeRevision = study.revision;
      const response = await afterAction(page.waitForResponse(response => response.url() === base + studyRoot && response.request().method() === 'PUT', { timeout: 180000 }),
        () => page.getByRole('toolbar', { name: '工程命令', exact: true }).getByRole('button', { name: '保存修改', exact: true }).click());
      await recordUi(label, response);
      const request = response.request().postDataJSON();
      assert.deepEqual(request.parameters, expectedParameters);
      assert.deepEqual([request.expected_revision, request.expected_study_revision], [preparedRevision, beforeRevision]);
      study = await api(label + '-readback', 'GET', studyRoot);
      assert.equal(study.revision, beforeRevision + 1); assert.deepEqual(study.definition.parameters, expectedParameters);
      for (const key of trayFields.filter(key => Object.hasOwn(expectedParameters, key))) {
        const source = study.definition.input_sources['/parameters/' + key];
        assert.equal(source.kind, 'user'); assert.equal(source.reviewed, false); assert.ok(source.reference.trim());
      }
      await expect(page.getByRole('toolbar', { name: '工程命令', exact: true }).getByRole('button', { name: '已保存', exact: true })).toBeDisabled();
      await unchangedWorkspace(label + '-workspace');
    }
    async function preflight(label, ready, field) {
      const [input, response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === localStudyRoot + '/input-preflight' && response.request().method() === 'GET', { timeout: 180000 }),
        page.waitForResponse(response => new URL(response.url()).pathname === studyRoot + '/preflight' && response.request().method() === 'GET', { timeout: 180000 }),
        page.getByRole('button', { name: '预检并运行', exact: true }).click(),
      ]);
      const inputResult = await recordUi(label + '-input', input);
      assert.deepEqual([inputResult.ready, inputResult.input_ready, inputResult.local_only], [false, true, true]);
      assert.deepEqual(inputResult.cases.map(item => item.status), ['succeeded']);
      const result = await recordUi(label, response);
      const query = new URL(response.url()).searchParams;
      assert.equal(query.get('expected_revision'), String(preparedRevision)); assert.equal(query.get('expected_study_revision'), String(study.revision));
      assert.equal(result.ready, ready); assert.equal(result.cases.length, 1);
      const dialog = page.getByRole('dialog', { name: '运行前预检', exact: true });
      await expect(dialog).toBeVisible();
      const run = dialog.getByRole('button', { name: '确认并运行', exact: true });
      if (!ready) {
        assert.deepEqual(result.runnable_case_ids, []); assert.equal(result.cases[0].status, 'not_applicable');
        assert.equal(result.cases[0].error.code, 'CORRECTION_NOT_APPLICABLE'); assert.equal(result.cases[0].error.field, field);
        await expect(dialog).toContainText(result.cases[0].error.message); await expect(run).toBeDisabled();
        assert.equal(runPosts().length, 0);
        assert.deepEqual((await api(label + '-runs', 'GET', studyRoot + '/runs?view=full')).items, []);
      } else {
        assert.deepEqual(result.runnable_case_ids, ['case-0']); assert.equal(result.partial, false);
        assert.equal(result.cases[0].status, 'succeeded'); await expect(run).toBeEnabled();
      }
      await shot(ready ? `D06${kindLabel}合成400安机制明确条件后预检` : `D06${label === 'absent' ? '旧研究未声明三条件保留原拒绝' : '仅选类别仍缺出处和确认拒绝'}`);
      return { result, dialog, run };
    }
    await page.goto(base + `/studies/${study.id}/ampacity/results?workspace=${workspace.id}&inspector=method`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '桥架类别', exact: true })).toHaveText('请选择');
    let fields = await advanced();
    await expect(fields.source).toHaveValue(''); await expect(fields.confirmed).not.toBeChecked();
    await fields.group.scrollIntoViewIfNeeded();
    await shot('D06合成400安机制三条件未声明且未确认');
    // Saving an unrelated visible title exercises the form's real draft path:
    // an untouched switch must not serialize a new false/default parameter.
    await page.locator('.topbar .status-mark').click();
    await page.getByRole('button', { name: '修改研究名称', exact: true }).click();
    const renamed = title + ' · 旧参数已核对';
    await page.getByRole('textbox', { name: '研究名称', exact: true }).fill(renamed);
    await page.getByRole('button', { name: '保留草稿', exact: true }).click();
    await savedFromUi('untouched-conditions-save', fixture.parameters_without_tray);
    assert.deepEqual(trayFields.filter(key => Object.hasOwn(study.definition.parameters, key)), []);
    const absent = await preflight('absent', false, '/input/sections/0');
    await page.keyboard.press('Escape'); await expect(absent.dialog).toBeHidden();
    await select('桥架类别', kindLabel);
    const partial = { ...fixture.parameters_without_tray, tray_kind: kind };
    await savedFromUi('kind-only-save', partial);
    assert.equal(Object.hasOwn(study.definition.parameters, 'tray_layout_confirmed'), false);
    assert.equal(Object.hasOwn(study.definition.parameters, 'tray_layout_source'), false);
    const refused = await preflight('partial', false, '/parameters/tray_layout_confirmed');
    await page.keyboard.press('Escape'); await expect(refused.dialog).toBeHidden();
    fields = await advanced();
    await fields.source.fill(fixture.tray_declarations.tray_layout_source);
    await fields.source.blur();
    await expect(fields.confirmed).not.toBeChecked();
    await fields.confirmed.click();
    await expect(fields.confirmed).toBeChecked(); await expect(fields.source).toHaveValue(fixture.tray_declarations.tray_layout_source);
    await fields.group.scrollIntoViewIfNeeded();
    await shot(`D06${kindLabel}合成400安机制人工填写出处并确认`);
    const complete = { ...fixture.parameters_without_tray, ...fixture.tray_declarations };
    await savedFromUi('explicit-conditions-save', complete);
    assert.equal(study.definition.parameters.tray_layout_confirmed, true);
    const ready = await preflight('explicit', true);
    assert.equal(runPosts().length, 0);
    const runResponse = await afterAction(page.waitForResponse(response => response.url() === base + studyRoot + '/runs' && response.request().method() === 'POST', { timeout: 180000 }), () => ready.run.click());
    const receipt = await recordUi('manual-run', runResponse);
    assert.equal(runPosts().length, 1);
    const request = runResponse.request().postDataJSON();
    assert.equal(request.scope_acknowledged, true); assert.equal(request.lock_digest, ready.result.lock_digest);
    assert.deepEqual([request.expected_revision, request.expected_study_revision], [preparedRevision, study.revision]);
    assert.deepEqual([receipt.status, receipt.integrity], ['succeeded', 'verified']);
    const run = await api('saved-run-readback', 'GET', studyRoot + '/runs/' + receipt.id + '?view=full');
    assert.deepEqual(run.output, receipt.output); assert.deepEqual(run.snapshot, receipt.snapshot);
    assert.deepEqual(run.snapshot.definition.parameters, complete); assert.deepEqual(run.snapshot.definition.input_sources, study.definition.input_sources);
    assert.deepEqual(run.snapshot.cases[0].input, workspace.domain);
    assert.deepEqual([run.output.plugin_version, run.output.method_version, run.output.environment.method], ['1.0.8', '1.1.0', '1.1.0']);
    const result = run.output.cases[0], trace = result.artifacts[artifactType];
    assert.ok(trace); assert.equal(result.status, 'succeeded');
    assert.equal(trace.domain_input_sha256, fixture.domain_sha256); assert.deepEqual(trace.baseline, complete);
    assert.ok(Math.abs(trace.corrected_current_a - 400 * expectedFactor) < 1e-10);
    assert.ok(Math.abs(trace.total_factor - expectedFactor) < 1e-12);
    assert.deepEqual(trace.coefficients.map(item => item.record.clause), ['D.0.1', 'D.0.6']);
    assert.deepEqual(trace.coefficients.map(item => item.factor), [1, expectedFactor]);
    const group = trace.coefficients[1];
    assert.equal(group.record.id, `gb50217-D-0-6/r${kind === 'ladder' ? 1 : 2}/c1`);
    assert.deepEqual([group.record.printed_page, group.record.pdf_page, group.record.source_sha256, group.release_digest],
      [74, 84, '5e15e9a4a78e40df66a8b91a2e6f5da3047e92304dc0eb7cb62522e418e09483', complete.basis_release_digest]);
    assert.equal(group.record.verification.status, 'verified'); assert.equal(group.record.value, expectedFactor);
    for (const key of ['request_sha256', 'artifact_sha256']) assert.match(group[key], /^[a-f0-9]{64}$/);
    const layout = trace.actual_conditions.tray_layout;
    assert.deepEqual([layout.layer_count, layout.layers.map(layer => layer.cable_count), layout.source_kind, layout.confidence, layout.approval, layout.method_version], [1, [7], 'declared', 'reference', 'not_granted', '1.1.0']);
    assert.equal(layout.layout_source, complete.tray_layout_source); assert.ok(layout.geometry_sources.length > 0);
    for (const item of layout.geometry_sources) {
      assert.deepEqual(item.source, workspace.domain.provenance[item.source_path]);
      assert.equal(item.source.kind, 'demo'); assert.equal(item.source.reviewed, false);
      assert.deepEqual(item.value, atPointer(workspace.domain, item.indexed_path));
    }
    const currents = result.results.filter(item => item.key === 'ampacity');
    assert.equal(currents.length, 7);
    for (const current of currents) {
      assert.ok(Math.abs(current.value - 400 * expectedFactor) < 1e-10);
      assert.equal(current.unit, 'A'); assert.equal(current.rating_basis.kind, 'common_balanced');
      assert.equal(current.case, 'rating-simultaneous');
    }
    assert.match(result.artifact_digests[artifactType], /^[a-f0-9]{64}$/);
    const runs = await api('runs-after', 'GET', studyRoot + '/runs?view=full');
    assert.deepEqual(runs.items.map(item => item.id), [run.id]);
    await unchangedWorkspace('workspace-after-run');
    await expect(ready.dialog).toBeHidden();
    const conclusion = page.getByRole('region', { name: 'GB 50217 校正结论', exact: true });
    await expect(conclusion).toBeVisible(); await expect(conclusion).toContainText('400');
    await expect(conclusion).toContainText(String(400 * expectedFactor));
    await conclusion.scrollIntoViewIfNeeded();
    await shot(`D06${kindLabel}合成400安机制实际保存结果${400 * expectedFactor}安`);
    const coefficients = page.locator('details.study-detail-group').filter({ has: page.locator(':scope > summary', { hasText: /^校正系数与标准出处/ }) });
    await expect(coefficients).toHaveCount(1);
    if (!await coefficients.evaluate(node => node.open)) await coefficients.locator(':scope > summary').click();
    const table = coefficients.getByRole('table', { name: 'GB 50217 校正系数', exact: true });
    await expect(table.getByRole('row')).toHaveCount(3); await expect(table).toContainText('D.0.6');
    await expect(table).not.toContainText('D.0.5'); await expect(table).toContainText('74');
    await table.scrollIntoViewIfNeeded();
    await shot(`D06${kindLabel}实际单层七根与唯一分组系数标准出处`);
    const baseline = page.locator('details.study-detail-group').filter({ has: page.locator(':scope > summary', { hasText: /^基准条件与来源$/ }) });
    await expect(baseline).toHaveCount(1);
    if (!await baseline.evaluate(node => node.open)) await baseline.locator(':scope > summary').click();
    await expect(baseline).toContainText('不是厂家额定值'); await expect(baseline).toContainText('不代表厂家已保证本次校正结果');
    await baseline.scrollIntoViewIfNeeded();
    await shot(`D06${kindLabel}合成基准出处与非厂家保证边界`);
    evidence.result = { study, run_id: run.id, input_digest: run.input_digest, output_digest: run.output_digest,
      artifact_digest: result.artifact_digests[artifactType], corrected_current_a: trace.corrected_current_a,
      expected_current_a: 400 * expectedFactor, method_version: run.output.method_version, plugin_version: run.output.plugin_version,
      domain_unchanged: true, automatic_run_posts: 0, explicit_run_posts: runPosts().length };
    evidence.data_checks_passed = true;
    evidence.layout_failures = report.layout_failures.slice(layoutStart);
    assert.deepEqual(evidence.layout_failures.map(item => ({ screenshot: item.screenshot, message: item.message })), [], 'D06机制流程的原布局和可见名称门禁未通过');
    evidence.status = 'passed';
    report.checks.push(`${viewport.width}：原研究通用表单实际展开高级桥架参数；400A明确合成机制输入保存旧研究后新增三键仍全部缺省，保留原范围拒绝。只选${kindLabel}时缺出处和布尔确认被预检拒绝且零运行；人工填写完整来源并确认后真实保存/预检/运行一次，单层7根实际接触的D.0.6系数${expectedFactor}得${400 * expectedFactor}A，与D.0.5互斥，标准原件与几何来源完整回读，Domain修订不变、参考且未批准。此项不是厂家载流量或完整线路验证。`);
  } catch (error) {
    evidence.status = 'failed'; evidence.error = { name: error.name, message: error.message, stack: error.stack };
    try {
      const screenshot = prefix + '-failure.png';
      await page.screenshot({ path: path.join(out, screenshot) });
      await fs.writeFile(path.join(out, prefix + '-failure.txt'), await page.locator('body').innerText());
      evidence.screenshots.push(screenshot); report.screenshots.push(screenshot);
    } catch (captureError) { evidence.failure_capture_error = String(captureError); }
    throw error;
  }
  finally {
    page.off('request', onRequest); page.off('response', onResponse); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed); page.off('console', onConsole);
    await write();
  }
}
