"""Illustrative presets, never manufacturer-certified cable catalogue entries."""
from .schemas import Scenario


def presets() -> list[dict]:
    result = []
    for material, material_name in [("copper", "Cu"), ("aluminium", "Al")]:
        for area in [120, 240, 400]:
            s = Scenario()
            s.cable.conductor = material
            s.cable.area_mm2 = area
            s.cable.name = f"演示 · {material_name} / XLPE 12/20 kV · 1×{area}"
            s.name = f"{material_name} {area} mm² · 直埋方案"
            result.append({"id": f"{material}-{area}", "label": s.cable.name,
                           "source": "演示假设，非厂家数据", "scenario": s.model_dump(mode="json")})
    return result
