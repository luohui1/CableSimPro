"""Shared SI wire contract for magnetic/thermal feedback with contact traces."""
from typing import Literal
from math import hypot
from pydantic import Field,StrictInt,model_validator
from .simulation import Strict,Excitation
from .discrete_fields import ContactThermalField


class MagneticMaterial(Strict):
    conductivity_s_m: float = Field(ge=0)
    relative_permeability: float = Field(gt=0)
    relative_permeability_loss: float = Field(default=0,ge=0)
    alpha_per_k: float = Field(ge=0)
    reference_temperature_k: float = Field(gt=0)
    minimum_temperature_k: float = Field(gt=0)
    maximum_temperature_k: float = Field(gt=0)
    source: str = Field(min_length=1)

    @model_validator(mode='after')
    def interval(self):
        if self.minimum_temperature_k>=self.maximum_temperature_k or not self.minimum_temperature_k<=self.reference_temperature_k<=self.maximum_temperature_k:
            raise ValueError('magnetic_materials: reference temperature must lie in the ordered validity interval')
        if 1+self.alpha_per_k*(self.minimum_temperature_k-self.reference_temperature_k)<=0:
            raise ValueError('magnetic_materials: resistivity must stay positive over the declared interval')
        return self


class PortResistance(Strict):
    domain_ids: list[StrictInt] = Field(min_length=1)
    resistance_reference_ohm_m: float = Field(gt=0)
    alpha_per_k: float = Field(ge=0)
    reference_temperature_k: float = Field(gt=0)
    minimum_temperature_k: float = Field(gt=0)
    maximum_temperature_k: float = Field(gt=0)
    source: str = Field(min_length=1)
    scope: Literal['mean_terminal_resistance_including_passive_losses']


class ContactElectrothermal(ContactThermalField):
    schema_version: Literal['cablesim.contact-electrothermal-field/1']
    frequency_hz: float = Field(gt=0)
    magnetic_domain_ids: list[StrictInt] = Field(min_length=1)
    magnetic_materials: dict[str,MagneticMaterial]
    excitations: list[Excitation] = Field(min_length=1)
    magnetic_boundary_source: str = Field(min_length=1)
    port_resistance: PortResistance
    temperature_tolerance_k: float = Field(default=1e-4,gt=0,le=.01)
    power_relative_tolerance: float = Field(default=1e-6,gt=0,le=1e-3)
    maximum_iterations: int = Field(default=40,ge=2,le=100)
    relaxation: float = Field(default=.8,gt=0,le=1)

    @model_validator(mode='after')
    def magnetic_complete(self):
        domains=set(self.magnetic_domain_ids)
        if len(domains)!=len(self.magnetic_domain_ids) or not domains<=set(self.mesh.domain_ids):raise ValueError('magnetic_domain_ids: unique existing mesh domains required')
        if set(self.magnetic_materials)!={str(d) for d in domains}:raise ValueError('magnetic_materials: exact magnetic-domain coverage required')
        allowed={'domain/'+str(d):m for d,m in self.magnetic_materials.items()};used=set();impressed=[]
        for e in self.excitations:
            if len(e.regions)!=1 or e.connection!='parallel' or e.schedule:raise ValueError('excitations: this feedback method requires independent single-region constraints')
            uid=e.regions[0]
            if uid not in allowed or uid in used:raise ValueError('excitations: unique existing magnetic domain required')
            used.add(uid);mat=allowed[uid]
            if e.kind=='impressed_current_rms_a':
                if mat.conductivity_s_m!=0:raise ValueError('excitations: homogenized impressed-current region must have sigma=0 in the field equation')
                impressed.append(e)
            elif e.kind not in ('current_rms_a','voltage_gradient_v_m') or any(e.value) or mat.conductivity_s_m<=0:
                raise ValueError('excitations: remaining conductive domains must be explicit passive zero-current/voltage constraints')
        required={u for u,m in allowed.items() if m.conductivity_s_m>0}
        if required!=used-{e.regions[0] for e in impressed}:raise ValueError('excitations: every conductive domain needs an explicit constraint')
        law=self.port_resistance
        if len(law.domain_ids)!=len(set(law.domain_ids)) or {'domain/'+str(d) for d in law.domain_ids}!={e.regions[0] for e in impressed}:
            raise ValueError('port_resistance.domain_ids: must exactly identify all impressed-current domains')
        magnitudes=[hypot(*e.value) if len(e.value)==2 else abs(e.value[0]) for e in impressed]
        if not magnitudes or min(magnitudes)<=0 or max(magnitudes)-min(magnitudes)>1e-9*max(magnitudes):raise ValueError('port_resistance: nonzero equal RMS source magnitudes required')
        if not law.minimum_temperature_k<=self.ambient_k<=law.maximum_temperature_k or not law.minimum_temperature_k<=law.reference_temperature_k<=law.maximum_temperature_k:
            raise ValueError('port_resistance: initial/reference Kelvin temperature outside valid interval')
        if 1+law.alpha_per_k*(law.minimum_temperature_k-law.reference_temperature_k)<=0:raise ValueError('port_resistance: nonpositive resistance in validity interval')
        return self
