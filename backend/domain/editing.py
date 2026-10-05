"""Resolve dependent structural coordinates before validating a type edit.

Only a saved, centred, mutually tangent three-round-core construction supplies
the tangent rule. Explicit coordinate edits and other arrangements keep their
coordinates and must pass the ordinary domain validation.
"""
from math import hypot, sqrt

from fastapi.exceptions import RequestValidationError
from pydantic import Field, ValidationError, model_validator

from .guards import check_locks, pointer
from .models import CableType, DomainDocument


class DraftCableType(CableType):
    @model_validator(mode='after')
    def construction_valid(self):
        # Field constraints still apply. Cross-field geometry is checked after
        # dependent coordinates are resolved against the saved revision.
        return self


class DraftDomainDocument(DomainDocument):
    cable_types: list[DraftCableType] = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def references(self):
        return self


def radius(core):
    return core['conductor']['diameter']/2 + sum(
        layer['thickness'] + (layer.get('corrugation_depth') or 0.) for layer in core['layers'])


def follow_tangent_cores(cable, base, provenance):
    cores, previous = cable['cores'], base['cores']
    if cable['construction'] != 'three_core' or base['construction'] != 'three_core' or len(cores) != 3:
        return
    old_by_id = {core['id']: core for core in previous}
    if len(old_by_id) != 3 or {c['id'] for c in cores} != old_by_id.keys():
        return
    previous = [old_by_id[c['id']] for c in cores]
    if any(c['conductor']['form'] == 'sectoral' for c in [*cores, *previous]):
        return
    if any((c['x'], c['z']) != (b['x'], b['z']) for c, b in zip(cores, previous)):
        return
    old_r, new_r = list(map(radius, previous)), list(map(radius, cores))
    if old_r == new_r:
        return
    # Do not infer a rule for an arbitrary manufacturer's measured arrangement.
    if any(abs(sum(c[axis] for c in previous)/3) > 1e-12 for axis in ('x', 'z')):
        return
    for i, j in ((0, 1), (0, 2), (1, 2)):
        if abs(hypot(previous[i]['x']-previous[j]['x'], previous[i]['z']-previous[j]['z'])
               - old_r[i]-old_r[j]) > 1e-12:
            return
    # Three pairwise tangencies give the triangle side lengths, including when
    # just one core changes. Preserve its orientation, handedness and centroid.
    a, b, c = new_r[0]+new_r[1], new_r[0]+new_r[2], new_r[1]+new_r[2]
    along = (a*a+b*b-c*c)/(2*a)
    height = sqrt(max(0., b*b-along*along))
    dx, dz = previous[1]['x']-previous[0]['x'], previous[1]['z']-previous[0]['z']
    length = hypot(dx, dz)
    ux, uz = dx/length, dz/length
    side = 1 if dx*(previous[2]['z']-previous[0]['z'])-dz*(previous[2]['x']-previous[0]['x']) > 0 else -1
    points = [(0., 0.), (a*ux, a*uz), (along*ux-side*height*uz, along*uz+side*height*ux)]
    centre = [sum(p[i] for p in points)/3 for i in (0, 1)]
    for core, point in zip(cores, points):
        for i, axis in enumerate(('x', 'z')):
            core[axis] = point[i]-centre[i]
            path = pointer('cable_types', cable['id'], 'cores', core['id'], axis)
            provenance[path] = {'kind': 'derived', 'reviewed': False,
                'reference': '三圆芯相切成缆：保持已保存结构的朝向、芯序与芯中心重心；以各芯完整外半径重新推导坐标。'}


def resolve_edit(state, draft):
    document = draft.model_dump(mode='json')
    try:
        check_locks(state, document)
        if state.get('type_origin_reference') and not state.get('study_cable_reference'):
            base = {c['id']: c for c in state['domain']['cable_types']}
            for cable in document['cable_types']:
                if cable['id'] in base:
                    follow_tangent_cores(cable, base[cable['id']], document['provenance'])
        check_locks(state, document)
        return DomainDocument.model_validate(document).model_dump(mode='json')
    except ValidationError as error:
        raise RequestValidationError([
            {**item, 'loc': ('body', 'document', *item['loc'])} for item in error.errors()
        ]) from error
