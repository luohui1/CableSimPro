"""Explicit interpretation of each IEC ampacity quantity and trace entry."""
from cablesim_sdk.ampacity import AmpacityBasis


def basis(group=None, entity='circuit/c1', common=False):
    circuits = group.circuits if group is not None else [{'id':entity}]
    if len(circuits) == 1:
        return AmpacityBasis(kind='single_circuit', display_name='单回路能力', varied_circuits=[circuits[0]['id']]).model_dump()
    if common:
        return AmpacityBasis(kind='common_balanced', display_name='全回路共同能力', varied_circuits=[c['id'] for c in circuits]).model_dump()
    held = {c['id']:c['current'] for c in group.cables if c['circuit'] != entity}
    labels = {c['id']:c['label'] for c in circuits}
    loads = '；'.join(f"{labels[c['circuit']]} {c['phase']} {c['current']:g} A" for c in group.cables if c['id'] in held)
    return AmpacityBasis(kind='conditional_fixed_load', display_name='其他回路固定负荷下的条件上限（'+loads+'）',
                         varied_circuits=[entity], fixed_currents_a=held).model_dump()
