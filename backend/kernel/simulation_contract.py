"""Publish and validate the same solver-neutral problem used by simulation plugins."""
import json
from hashlib import sha256
from pathlib import Path
from typing import Literal
from fastapi import HTTPException
from pydantic import Field, JsonValue, ValidationError
from cablesim_sdk.simulation import Problem, MeshControls
from cablesim_sdk.simulation_artifacts import LossExport
from cablesim_sdk.validation import validation_error
from ..schemas import StrictModel


class ProblemContract(StrictModel):
    schema_version: Literal['cablesim.simulation-problem/1']
    schema_: dict[str,JsonValue] = Field(alias='schema',description='Exact Problem JSON Schema; no separate host physics model.')
    source: str = Field(description='Repository-relative authoritative SDK module.')
    source_sha256: str = Field(pattern='^[0-9a-f]{64}$')
    schema_sha256: str = Field(pattern='^[0-9a-f]{64}$')
    units: dict[str,str] = Field(description='Units and positional meanings of fields; identifiers and flags have no physical units.')


class StandaloneParameters(StrictModel):
    mesh: MeshControls = Field(description='Mesh edge lengths m, finite node limit, element order and explicit circle segments.')
    reproduction: dict[str,JsonValue] = Field(default_factory=dict,description='Saved reference observations and provenance; never solver command lines.')
    loss_export: LossExport | None = Field(default=None,description='Optional GetDP loss-export bindings, reference temperature K, frequency Hz and original domain SHA256.')


def contract():
    path=Path(__file__).resolve().parents[2]/'cablesim_sdk/simulation.py'
    schema=Problem.model_json_schema()
    return {'schema_version':'cablesim.simulation-problem/1','schema':schema,'source':'cablesim_sdk/simulation.py',
        'source_sha256':sha256(path.read_bytes()).hexdigest(),
        'schema_sha256':sha256(json.dumps(schema,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
        'units':{'geometry[].values':'m; rectangle=[x0,z0,x1,z1], disk=[x,z,r]',
         'geometry[].material.k_w_m_k':'W/(m·K)','geometry[].material.heat_capacity_j_m3_k':'J/(m³·K)',
         'geometry[].material.conductivity_s_m':'S/m','geometry[].material.relative_permeability':'1',
         'geometry[].material.relative_permeability_loss':'1','geometry[].material.relative_permittivity':'1',
         'boundaries[].values':'m; outer=[], x/z=[coordinate], circle=[x,z,r]',
         'boundaries[].value':'K for temperature/convection; Wb/m for magnetic_potential; null for insulated',
         'boundaries[].h_w_m2_k':'W/(m²·K)','excitations[].value':'W/m for heat; RMS A for current; V/m for voltage gradient; [real,imag] for complex values',
         'excitations[].schedule':'[time s, dimensionless source factor]',
         'frequency_hz':'Hz','time.initial_temperature_k':'K','time.step_s':'s','time.steps':'count','time.bdf_order':'1',
         'probes_m':'[x,z] in m','current_probes[].point_m':'[x,z] in m','axial_lengths_m':'m by conducting-region UID'}}


def validate_input(value,capability=None):
    try:
        checked=Problem.model_validate_json(json.dumps(value,allow_nan=False),strict=True)
    except ValidationError as exc:
        raise HTTPException(422,validation_error(exc,'SIMULATION_PROBLEM_INVALID',prefix=('method_input',))) from None
    physics={'getdp-eddy':{'magnetic_harmonic'},'elmer-heat':{'steady_heat','transient_heat'}}.get(capability)
    if physics and checked.physics not in physics:
        raise HTTPException(422,{'code':'SIMULATION_PHYSICS_MISMATCH','message':'请选择与问题物理类型匹配的求解能力。','path':'/method_input/physics'})
    return checked
