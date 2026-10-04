"""SI contracts for explicitly sourced discrete fields; no host-side solver."""
from math import isfinite
from typing import Literal
from pydantic import ConfigDict, Field, StrictInt, model_validator
from .simulation import Strict


class Provenance(Strict):
    reference: str = Field(min_length=1)
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')


class DiscreteMesh(Strict):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    length_unit: Literal['m']
    points: list[tuple[float,float]] = Field(min_length=3,max_length=120000)
    triangles: list[tuple[StrictInt,StrictInt,StrictInt]] = Field(min_length=1,max_length=240000)
    domain_ids: list[StrictInt] = Field(min_length=1,max_length=240000)
    source: Provenance

    @model_validator(mode='after')
    def complete(self):
        if len(self.domain_ids)!=len(self.triangles) or min(self.domain_ids)<1:raise ValueError('mesh.domain_ids: one positive region per triangle required')
        if min(min(t) for t in self.triangles)<0 or max(max(t) for t in self.triangles)>=len(self.points):raise ValueError('mesh.triangles: node index outside points')
        if len({tuple(sorted(t)) for t in self.triangles})!=len(self.triangles):raise ValueError('mesh.triangles: duplicate triangles')
        if set(n for t in self.triangles for n in t)!=set(range(len(self.points))):raise ValueError('mesh.points: unused nodes are not allowed')
        return self


class ElectricalMaterial(Strict):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    conductivity_s_m: float = Field(ge=0)
    relative_permittivity: float = Field(gt=0)
    source: str = Field(min_length=1)


class Terminal(Strict):
    id: str = Field(min_length=1)
    domain_ids: list[StrictInt] = Field(min_length=1)


class TerminalField(Strict):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    schema_version: Literal['cablesim.terminal-field/1']
    mesh: DiscreteMesh
    frequency_hz: float = Field(gt=0)
    materials: dict[str,ElectricalMaterial]
    terminals: list[Terminal] = Field(min_length=1,max_length=16)
    floating_terminals: list[str] = Field(default_factory=list,max_length=15)
    ground_nodes: list[StrictInt] = Field(min_length=1)
    boundary_source: str = Field(min_length=1)

    @model_validator(mode='after')
    def complete(self):
        domains=set(self.mesh.domain_ids)
        if set(self.materials)!={str(d) for d in domains}:raise ValueError('materials: exact domain coverage required')
        regions=[d for t in self.terminals for d in t.domain_ids]
        if len({t.id for t in self.terminals})!=len(self.terminals) or len(set(regions))!=len(regions) or not set(regions)<=domains:raise ValueError('terminals: unique ids and disjoint existing domains required')
        if len(set(self.floating_terminals))!=len(self.floating_terminals) or not set(self.floating_terminals)<={t.id for t in self.terminals} or len(self.floating_terminals)>=len(self.terminals):raise ValueError('floating_terminals: unique existing ids required; retain at least one driven terminal')
        if len(set(self.ground_nodes))!=len(self.ground_nodes) or min(self.ground_nodes)<0 or max(self.ground_nodes)>=len(self.mesh.points):raise ValueError('ground_nodes: unique existing mesh node indices required')
        return self


class Conductivity(Strict):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    coefficients_w_m_k: list[float] = Field(min_length=1,max_length=8)
    minimum_temperature_k: float = Field(gt=0)
    maximum_temperature_k: float = Field(gt=0)
    source: str = Field(min_length=1)

    @model_validator(mode='after')
    def interval(self):
        if self.minimum_temperature_k>=self.maximum_temperature_k:raise ValueError('thermal_conductivity: ordered positive Kelvin interval required')
        return self


class ContactThermalField(Strict):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    schema_version: Literal['cablesim.contact-thermal-field/1']
    mesh: DiscreteMesh
    thermal_conductivity: dict[str,Conductivity]
    heat_w_m3: list[float] = Field(min_length=1,max_length=240000)
    heat_source: Provenance
    contact_edges: list[tuple[StrictInt,StrictInt]] = Field(max_length=240000)
    contact_conductance_w_m2k: list[float] = Field(max_length=240000)
    contact_source: str = Field(min_length=1)
    temperature_nodes: list[StrictInt] = Field(min_length=1)
    ambient_k: float = Field(gt=0)
    boundary_source: str = Field(min_length=1)

    @model_validator(mode='after')
    def complete(self):
        if set(self.thermal_conductivity)!={str(d) for d in self.mesh.domain_ids}:raise ValueError('thermal_conductivity: exact domain coverage required')
        if len(self.heat_w_m3)!=len(self.mesh.triangles) or any(v<0 for v in self.heat_w_m3):raise ValueError('heat_w_m3: one nonnegative SI source per triangle required')
        if len(self.contact_edges)!=len(self.contact_conductance_w_m2k) or any(v<=0 for v in self.contact_conductance_w_m2k):raise ValueError('contact_conductance_w_m2k: one positive SI conductance per edge required')
        if len({tuple(sorted(e)) for e in self.contact_edges})!=len(self.contact_edges):raise ValueError('contact_edges: duplicate interface')
        if set(self.temperature_nodes)&{v for edge in self.contact_edges for v in edge}:raise ValueError('temperature_nodes: only exterior temperature boundaries are supported; a contact-side Dirichlet value needs an explicit side and is not supported')
        nodes=self.temperature_nodes+[v for e in self.contact_edges for v in e]
        if min(nodes)<0 or max(nodes)>=len(self.mesh.points):raise ValueError('boundary/contact nodes: index outside mesh')
        for key,law in self.thermal_conductivity.items():
            if not law.minimum_temperature_k<=self.ambient_k<=law.maximum_temperature_k:raise ValueError('ambient_k: outside domain '+key+' conductivity range')
        return self
