"""Auditable steady-state thermal network, NOT a complete IEC 60287 implementation.

Concentric radial conduction + half-space image-source mutual heating. AC and
screen loss factors are inputs, not automatically derived standard formulae.
See docs/METHOD.md for equations, applicability, and limitations.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from math import acosh, log, pi, sqrt

import numpy as np

from .schemas import Scenario

MODEL_VERSION = "MV-THERMAL-0.1.0"
PHASES = ["A", "B", "C"]
COLORS = ["#ce9451", "#434d5c", "#ece6d6", "#5a6572", "#b9cad1", "#293c55"]
LAYER_NAMES = ["导体", "导体屏蔽", "XLPE 绝缘", "绝缘屏蔽", "金属屏蔽（等效层）", "外护套"]
SOURCES = [
    {"title": "IEC 60287-1-1:2023 — 稳态载流量与损耗（范围参考）", "url": "https://webstore.iec.ch/en/publication/68118"},
    {"title": "IEC 60287-2-1:2023 — 热阻（范围参考）", "url": "https://webstore.iec.ch/en/publication/68134"},
]


class ModelError(ValueError):
    """Input is within schema bounds but has no admissible model solution."""


class ThermalNetwork:
    def __init__(self, scenario: Scenario):
        self.s = scenario
        c, env = scenario.cable, scenario.installation
        self.radii = np.array(c.radii_mm()) / 1000
        self.positions = np.array(env.positions_m())
        self.alpha = 0.00393 if c.conductor == "copper" else 0.00403
        rho20 = 0.017241 if c.conductor == "copper" else 0.028264
        self.r20 = (c.r20_ohm_km / 1000 if c.r20_ohm_km is not None else rho20 / c.area_mm2)
        self.r20ac = self.r20 * (1 + c.ac_extra_factor)
        # Metallic layer rho=1/k, with demo copper thermal conductivity k=400 W/(m K).
        rho = [c.semicon_rho_k_m_w, c.insulation_rho_k_m_w,
               c.semicon_rho_k_m_w, 1 / 400, c.jacket_rho_k_m_w]
        self.t = np.array([rho[i] * log(self.radii[i + 1] / self.radii[i]) / (2 * pi)
                           for i in range(5)])
        self.capacitance_f_m = 2 * pi * 8.8541878128e-12 * c.relative_permittivity / log(self.radii[2] / self.radii[1])
        self.wd = 2 * pi * c.frequency_hz * self.capacitance_f_m * (c.u0_kv * 1000) ** 2 * c.tan_delta
        self.g = np.zeros((3, 3))
        for i, (x, h) in enumerate(self.positions):
            for j, (xx, hh) in enumerate(self.positions):
                factor = (acosh(h / self.radii[-1]) if i == j else
                          log(sqrt((x - xx) ** 2 + (h + hh) ** 2) /
                              sqrt((x - xx) ** 2 + (h - hh) ** 2)))
                self.g[i, j] = env.soil_rho_k_m_w * factor / (2 * pi)
        # u = H q_conductor + d. Screen heat enters at the outer metal-screen node.
        self.h = (1 + c.screen_loss_factor) * self.g + np.eye(3) * (sum(self.t) + c.screen_loss_factor * self.t[-1])
        dielectric_internal = 0.5 * self.t[1] + sum(self.t[2:])
        self.d = self.wd * (self.g @ np.ones(3) + dielectric_internal)
        self.max_eigenvalue = float(np.linalg.eigvalsh(self.h)[-1])

    def temperatures(self, current_a: float) -> np.ndarray:
        if not np.isfinite(current_a) or current_a < 0:
            raise ModelError("电流必须为非负有限数。")
        feedback = current_a ** 2 * self.r20ac * self.alpha
        if feedback * self.max_eigenvalue >= 1:
            raise ModelError("输入电流超过此线性电阻热反馈模型的稳定范围。")
        ambient = self.s.installation.ambient_temperature_c
        q_ambient = current_a ** 2 * self.r20ac * (1 + self.alpha * (ambient - 20))
        rise = np.linalg.solve(np.eye(3) - feedback * self.h,
                               self.h @ np.full(3, q_ambient) + self.d)
        if not np.all(np.isfinite(rise)) or np.any(rise < -1e-7):
            raise ModelError("热网络未获得有效稳定解。")
        return rise + ambient

    def ampacity(self) -> float:
        limit = self.s.cable.max_temperature_c
        if float(max(self.temperatures(0))) >= limit:
            raise ModelError("即使电流为零，介质损耗与环境温度也已达到允许温度。")
        low = 0.0
        high = sqrt(0.9999 / (self.r20ac * self.alpha * self.max_eigenvalue))
        for _ in range(70):
            mid = (low + high) / 2
            if max(self.temperatures(mid)) > limit:
                high = mid
            else:
                low = mid
        return (low + high) / 2

    def state(self, current_a: float) -> dict:
        temperatures = self.temperatures(current_a)
        resistances = self.r20ac * (1 + self.alpha * (temperatures - 20))
        conductor = current_a ** 2 * resistances
        screen = self.s.cable.screen_loss_factor * conductor
        total = conductor + screen + self.wd
        outside = self.s.installation.ambient_temperature_c + self.g @ total
        check = (self.s.installation.ambient_temperature_c + self.h @ conductor + self.d)
        profiles = []
        for i in range(3):
            qc, qs, wd = float(conductor[i]), float(screen[i]), self.wd
            values = [float(temperatures[i])]
            drops = [qc * self.t[0], (qc + 0.5 * wd) * self.t[1],
                     (qc + wd) * self.t[2], (qc + wd) * self.t[3],
                     (qc + qs + wd) * self.t[4]]
            for drop in drops:
                values.append(values[-1] - float(drop))
            profiles.append({"phase": PHASES[i], "points": [
                {"radius_mm": float(r * 1000), "temperature_c": value, "layer": name}
                for r, value, name in zip(self.radii, values, LAYER_NAMES)]})
        return {
            "current_a": current_a, "temperatures_c": temperatures.tolist(),
            "surface_temperatures_c": outside.tolist(),
            "resistances_ohm_km": (resistances * 1000).tolist(),
            "conductor_losses_w_m": conductor.tolist(), "screen_losses_w_m": screen.tolist(),
            "dielectric_loss_w_m": self.wd, "total_losses_w_m": total.tolist(),
            "circuit_loss_kw": float(sum(total) * self.s.circuit_length_m / 1000),
            "residual_k": float(max(abs(temperatures - check))), "radial_profiles": profiles,
        }

    def field(self, state: dict) -> dict:
        half_width = max(1.0, self.s.installation.spacing_m * 2.4)
        bottom = max(1.6, float(max(self.positions[:, 1])) + 0.8)
        xs, ys = np.linspace(-half_width, half_width, 81), np.linspace(0, bottom, 49)
        xx, yy = np.meshgrid(xs, ys)
        field = np.full_like(xx, self.s.installation.ambient_temperature_c)
        mask = np.zeros_like(xx, dtype=bool)
        for (x, h), loss in zip(self.positions, state["total_losses_w_m"]):
            d = np.sqrt((xx - x) ** 2 + (yy - h) ** 2)
            image_d = np.sqrt((xx - x) ** 2 + (yy + h) ** 2)
            mask |= d <= self.radii[-1]
            # Clipping only avoids singular arithmetic inside excluded cable disks.
            field += self.s.installation.soil_rho_k_m_w * loss / (2 * pi) * np.log(image_d / np.maximum(d, self.radii[-1]))
        return {"x_m": xs.tolist(), "depth_m": ys.tolist(), "current_a": state["current_a"],
                "temperature_c": [[None if mask[j, i] else round(float(field[j, i]), 3)
                                   for i in range(len(xs))] for j in range(len(ys))],
                "method": "半空间线热源叠加；电缆内部已屏蔽；非有限元温度场"}


def calculate(scenario: Scenario, include_field: bool = True) -> dict:
    net = ThermalNetwork(scenario)
    ampacity = net.ampacity()
    rating = net.state(ampacity)
    warnings = [
        "这是工程辅助 Demo：尚未通过正式标准算例或第三方工程认证。",
        "只支持均匀土壤、恒温地表、单回路三根单芯无铠装电缆；忽略土壤干燥、排管、接头、端部与其他热源。",
        "交流附加系数和金属屏蔽损耗系数是用户输入；未自动计算集肤、邻近、环流或接地方式。",
        "材料常数与预设尺寸为可编辑演示假设，不代表特定厂家的产品数据。",
        "金属屏蔽使用连续等效圆筒；实际铜丝屏蔽的空隙和接触热阻未建模。",
    ]
    if scenario.cable.r20_ohm_km is None:
        warnings.append("R20 按理想均匀导体电阻率/截面积估算，未计绞合增量；工程应用请输入厂家实测 R20。")
    operating_error = None
    try:
        operating = net.state(scenario.operating_current_a)
        if max(operating["temperatures_c"]) > scenario.cable.max_temperature_c:
            warnings.append("当前运行电流导致导体超温，请降低负荷或调整方案。")
        if max(operating["temperatures_c"]) > 150:
            warnings.append("运行温度超过 150 °C：线性材料参数外推已无实际工程可靠性。")
    except ModelError as exc:
        operating = None
        operating_error = str(exc)
        warnings.append(operating_error)
    selected_state = operating or rating
    curves = []
    for current in np.linspace(0, ampacity * 1.2, 19):
        try:
            curves.append({"current_a": float(current), "temperature_c": float(max(net.temperatures(float(current))))})
        except ModelError:
            break
    payload = scenario.model_dump(mode="json")
    digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    max_operating = max(operating["temperatures_c"]) if operating else None
    result = {
        "model_version": MODEL_VERSION, "input_sha256": digest,
        "computed_at": datetime.now(timezone.utc).isoformat(), "input": payload,
        "summary": {
            "ampacity_a": ampacity, "operating_current_a": scenario.operating_current_a,
            "operating_max_temperature_c": max_operating,
            "thermal_margin_c": scenario.cable.max_temperature_c - max_operating if max_operating is not None else None,
            "utilization_percent": scenario.operating_current_a / ampacity * 100,
            "limiting_phase": PHASES[int(np.argmax(rating["temperatures_c"]))],
            "circuit_loss_kw": operating["circuit_loss_kw"] if operating else None,
        },
        "rating": rating, "operating": operating, "operating_error": operating_error,
        "geometry": {"diameter_mm": float(net.radii[-1] * 2000), "positions_m": net.positions.tolist(),
                     "layers": [{"name": name, "radius_mm": float(radius * 1000), "color": color}
                                for name, radius, color in zip(LAYER_NAMES, net.radii, COLORS)]},
        "thermal": {"layer_resistances_k_m_w": net.t.tolist(), "soil_matrix_k_m_w": net.g.tolist(),
                    "conductor_influence_matrix_k_m_w": net.h.tolist(),
                    "capacitance_nf_km": net.capacitance_f_m * 1e12,
                    "r20_ohm_km": net.r20 * 1000, "alpha_per_k": net.alpha,
                    "dielectric_loss_w_m": net.wd},
        "curve": curves, "warnings": warnings, "sources": SOURCES,
    }
    if include_field:
        result["field"] = net.field(selected_state)
    return result
