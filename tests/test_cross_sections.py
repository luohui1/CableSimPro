"""Independent planar dimensions and separation checks, with no native runtime."""
from math import cos, pi, sin, sqrt
import pytest

from cablesim_sdk.cross_sections import core_profile, profile_radius, profiles_overlap, support
from cablesim_sdk.domain import CableType, Conductor


def sector(angle=0, distance=.004, offset=.003):
    return core_profile({'form':'sectoral','diameter':.04,'sector_angle_deg':120,
        'sector_rotation_deg':angle}, distance*cos(angle*pi/180), distance*sin(angle*pi/180), offset)


def test_three_sectors_fit_without_using_overlapping_bounding_circles():
    profiles=[sector(angle) for angle in (0,120,240)]
    # Adjacent radial faces are sqrt(3)*4 mm apart, more than 2*3 mm coating.
    assert sqrt(3)*.004 > .006
    assert all(not profiles_overlap(a,b) for i,a in enumerate(profiles) for b in profiles[i+1:])
    assert all(profile_radius(p)==pytest.approx(.027,abs=1e-12) for p in profiles)
    assert support(profiles[0],(1,0))==pytest.approx(.027)
    assert support(profiles[0],(-1,0))==pytest.approx(-.001)
    assert profiles_overlap(sector(0,distance=.003),sector(120,distance=.003))


def test_circle_separation_and_sector_arc_contact():
    circle=lambda x,z,r: {'kind':'circle','x':x,'z':z,'radius':r,'offset':0}
    assert not profiles_overlap(circle(0,0,.01),circle(.02,0,.01))
    assert profiles_overlap(circle(0,0,.01),circle(.019,0,.01))
    assert not profiles_overlap(sector(),circle(.029,0,.002))
    assert profiles_overlap(sector(),circle(.0289,0,.002))


def test_sector_domain_bounds_and_declared_geometry_are_validated():
    cores=[{'id':f'core/{i+1}','x':p['x'],'z':p['z'],
        'conductor':{'material':'material/cu','form':'sectoral','nominal_area':.0003,'diameter':.04,
                     'sector_angle_deg':120,'sector_rotation_deg':angle},
        'layers':[{'role':'insulation','material':'material/xlpe','thickness':.003}]}
        for i,angle in enumerate((0,120,240)) for p in [sector(angle)]]
    cable={'id':'cable_type/sector','label':'Declared sector hand check','construction':'three_core',
        'rating':{'u0':600,'max_conductor_temperature':{'normal':363.15}}, 'cores':cores,
        'common_layers':[{'role':'oversheath','material':'material/pvc','thickness':.001}]}
    assert CableType.model_validate(cable).radius()==pytest.approx(.028)
    cores[0]['conductor']['nominal_area']=.0005
    with pytest.raises(ValueError,match='轮廓面积'):CableType.model_validate(cable)
    cores[0]['conductor']['nominal_area']=.0003
    cores[1]['conductor']['sector_rotation_deg']=0
    with pytest.raises(ValueError,match='重叠'):CableType.model_validate(cable)


def test_saved_sector_draft_remains_readable_but_cannot_produce_guessed_geometry():
    draft=Conductor.model_validate({'material':'material/cu','form':'sectoral','nominal_area':.0003,'diameter':.04})
    assert draft.sector_angle_deg is None and draft.sector_rotation_deg is None
    with pytest.raises(ValueError,match='sector_angle_deg'):core_profile(draft.model_dump())
