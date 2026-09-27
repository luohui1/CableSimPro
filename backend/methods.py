"""Host-side access to calculation methods. The host contains no physics formulas.

Every calculation is executed by a first-party plugin through the generic executor
(backend.plugin_host). This module only chooses which capability serves an existing
host API and keeps the legacy result shape the saved runs, reports and UI already use.

Each call starts one plugin process, so callers that need many operating points must use
`calculate_many` (one process, many cases) instead of looping over `calculate`.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .plugin_host import Executor, PluginHostError
from .schemas import Scenario

THERMAL_NETWORK = 'cablesim.thermal-network'
MODEL_VERSION = 'MV-THERMAL-0.1.0'  # method_version of THERMAL_NETWORK steady-rating; checked on every run


class ModelError(ValueError):
    """The method ran and refused the input (no admissible solution). Not a host fault."""


@lru_cache(maxsize=1)
def executor() -> Executor:
    return Executor()


def _cases(scenarios: list[Scenario], parameters: dict) -> list[dict]:
    return [{'case_id': f'case-{i}', 'input': s.model_dump(mode='json'), 'parameters': parameters}
            for i, s in enumerate(scenarios)]


def _run(capability: str, scenarios: list[Scenario], parameters: dict):
    run = executor().run(THERMAL_NETWORK, capability, _cases(scenarios, parameters))
    if run.method_version != MODEL_VERSION:
        raise PluginHostError('METHOD_VERSION_MISMATCH', f'插件方法版本 {run.method_version} 与宿主期望 {MODEL_VERSION} 不一致。', 409)
    return run.cases


def calculate_many(scenarios: list[Scenario], include_field: bool = False) -> list[dict | ModelError]:
    """One plugin process for all scenarios. Each item is the legacy result dict or the ModelError it raised."""
    if not scenarios:
        return []
    out: list[dict | ModelError] = []
    for case in _run('steady-rating', scenarios, {'include_field': include_field}):
        if case.status == 'succeeded':
            out.append(case.artifacts['x-cablesim.thermal-network-rating'])
        else:
            out.append(ModelError(case.error['message']))
    return out


def calculate(scenario: Scenario, include_field: bool = True) -> dict:
    result = calculate_many([scenario], include_field)[0]
    if isinstance(result, ModelError):
        raise result
    return result


@dataclass(frozen=True)
class NetworkProperties:
    """Read-only thermal-network properties consumed by host features not yet migrated (fields, vertical)."""
    scenario: Scenario
    radii: np.ndarray
    positions: np.ndarray
    t: np.ndarray
    g: np.ndarray
    r20: float
    r20ac: float
    alpha: float
    wd: float
    total_losses_w_m: list[float] | None


def network_properties_many(scenarios: list[Scenario], current_a: float | None = None) -> list[NetworkProperties | ModelError]:
    if not scenarios:
        return []
    out: list[NetworkProperties | ModelError] = []
    for scenario, case in zip(scenarios, _run('network-properties', scenarios, {'current_a': current_a})):
        if case.status != 'succeeded':
            out.append(ModelError(case.error['message']))
            continue
        p = case.artifacts['x-cablesim.thermal-network-properties']
        out.append(NetworkProperties(scenario, np.array(p['radii_m']), np.array(p['positions_m']),
                                     np.array(p['layer_resistances_k_m_w']), np.array(p['soil_matrix_k_m_w']),
                                     p['r20_ohm_m'], p['r20_ac_ohm_m'], p['alpha_per_k'], p['dielectric_loss_w_m'],
                                     p['total_losses_w_m']))
    return out


def network_properties(scenario: Scenario, current_a: float | None = None) -> NetworkProperties:
    result = network_properties_many([scenario], current_a)[0]
    if isinstance(result, ModelError):
        raise result
    return result
