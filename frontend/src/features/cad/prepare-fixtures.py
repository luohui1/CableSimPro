"""Build tiny native CAD fixtures for the feature gallery; no solver is invoked."""
import importlib.util
from copy import deepcopy
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))
CACHE = Path(__file__).parent / "node_modules/.cache/gallery"
ENTRY = ROOT / "plugins/cablesim.cable-geometry/src/cablesim_cable_geometry/main.py"


def demonstration():
    materials = [
        {"id": "cu", "label": "演示铜", "category": "conductor"},
        {"id": "semi", "label": "演示屏蔽", "category": "semiconductor"},
        {"id": "xlpe", "label": "演示绝缘", "category": "insulation"},
        {"id": "metal", "label": "演示金属", "category": "metal"},
        {"id": "pe", "label": "演示护套", "category": "polymer"},
        {"id": "soil", "label": "演示土壤", "category": "soil"},
        {"id": "sand", "label": "演示回填", "category": "backfill"},
        {"id": "duct", "label": "演示管材", "category": "duct"},
    ]
    cable = {"id": "type/demo", "label": "陈列用单芯圆形结构", "construction": "single_core",
             "rating": {"u0": 12000, "u": 20000, "max_conductor_temperature": {}},
             "cores": [{"id": "core/1", "x": 0, "z": 0,
                        "conductor": {"diameter": .02, "nominal_area": .00024,
                                      "form": "solid_round", "material": "cu"}, "layers": []}],
             "common_layers": [
                 {"role": "conductor_screen", "material": "semi", "thickness": .001},
                 {"role": "insulation", "material": "xlpe", "thickness": .004},
                 {"role": "insulation_screen", "material": "semi", "thickness": .001},
                 {"role": "metallic_screen", "material": "metal", "thickness": .001, "form": "smooth"},
                 {"role": "oversheath", "material": "pe", "thickness": .002},
             ]}
    circuit = {"id": "circuit/1", "label": "陈列回路", "cable_type": cable["id"],
               "system": {"kind": "ac_three_phase", "frequency": 50},
               "bonding": {"kind": "unspecified"},
               "cables": [{"id": f"cable/{phase}", "phase": phase} for phase in "ABC"]}
    section = {"id": "section/demo", "label": "排管与回填", "kind": "ground", "length": 100,
               "medium": {"material": "soil"},
               "placements": [{"cable": f"cable/{phase}", "x": (index - 1) * .16,
                               "z": -.75, "enclosure": f"duct/{phase}"} for index, phase in enumerate("ABC")],
               "enclosures": [{"id": f"duct/{phase}", "type": "duct", "material": "duct",
                               "x": (index - 1) * .16, "z": -.75, "inner_diameter": .1,
                               "outer_diameter": .12, "contains": [f"cable/{phase}"]} for index, phase in enumerate("ABC")],
               "backfill": {"id": "backfill/1", "label": "回填区", "material": "sand",
                            "x": 0, "z": -.75, "width": .8, "height": .45},
               "soil_layers": [{"id": "soil/upper", "label": "上部土层", "material": "soil", "top_z": 0, "bottom_z": -.5},
                               {"id": "soil/lower", "label": "下部土层", "material": "soil", "top_z": -.5, "bottom_z": -1.2}]}
    return {"schema_version": "cablesim.domain/1", "name": "画布组件陈列 · 演示",
            "materials": materials, "cable_types": [cable], "circuits": [circuit],
            "sections": [section], "load_cases": [], "provenance": {"gallery": {"kind": "demo", "reference": "Explicit synthetic geometry"}}}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    scratch_root = ROOT / ".tmp/frontend"
    scratch_root.mkdir(parents=True, exist_ok=True)
    document = demonstration()
    specification = importlib.util.spec_from_file_location("gallery_cable_geometry", ENTRY)
    native = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(native)
    with tempfile.TemporaryDirectory(prefix="canvas-fixtures-", dir=scratch_root) as directory:
        output = Path(directory)
        native.build(document, {"cable_type_id": "type/demo", "length_m": .12}, output, "model")
        changed = deepcopy(document)
        changed["cable_types"][0]["common_layers"][1]["thickness"] = .005
        native.build(changed, {"cable_type_id": "type/demo", "length_m": .12}, output, "updated")
        native.build_scene(document, {"section_id": "section/demo", "length_m": .24, "include_exact": False}, output, "scene")
        shutil.copyfile(output / "model.geometry.json", CACHE / "model.json")
        shutil.copyfile(output / "updated.geometry.json", CACHE / "updated-model.json")
        shutil.copyfile(output / "scene.scene.json", CACHE / "scene.json")
    (CACHE / "document.json").write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    print("陈列原生几何工件已生成；未执行求解器。")


if __name__ == "__main__":
    main()
