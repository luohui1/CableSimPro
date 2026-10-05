"""Bounds and separation of explicitly dimensioned circular/sector core profiles.

These are structural coordinates, not an electrical or thermal equivalent.
Sector coordinates locate the arc centre; diameter is twice the arc radius.
Uniform layer offsets form the parallel curve of that declared convex profile.
"""
from math import atan2, cos, hypot, pi, radians, sin


def core_profile(conductor, x=0., z=0., offset=0.):
    result = {'kind': 'circle', 'x': x, 'z': z,
              'radius': conductor['diameter']/2, 'offset': offset}
    if conductor.get('form') == 'sectoral':
        angle, rotation = conductor.get('sector_angle_deg'), conductor.get('sector_rotation_deg')
        if angle is None or rotation is None or not 0 < angle <= 180:
            raise ValueError('conductor.sector_angle_deg / sector_rotation_deg：扇形需明确 0–180° 夹角和朝向')
        result.update(kind='sector', angle=radians(angle), rotation=radians(rotation))
    return result


def in_sector(direction, profile):
    delta = (direction-profile['rotation']+pi) % (2*pi)-pi
    return abs(delta) <= profile['angle']/2+1e-12


def profile_features(profile):
    centre = (profile['x'], profile['z'])
    points, normals = [centre], []
    if profile['kind'] == 'sector':
        for direction in (profile['rotation']-profile['angle']/2, profile['rotation']+profile['angle']/2):
            points.append((centre[0]+profile['radius']*cos(direction), centre[1]+profile['radius']*sin(direction)))
            normals.append((-sin(direction), cos(direction)))
    return points, normals


def support(profile, axis):
    u, v = axis
    norm = hypot(u, v)
    if profile['kind'] == 'circle':
        projection = profile['radius']*norm
    else:
        projection = max(0., *(profile['radius']*(u*cos(direction)+v*sin(direction))
            for direction in (profile['rotation']-profile['angle']/2, profile['rotation']+profile['angle']/2)))
        if in_sector(atan2(v, u), profile):
            projection = profile['radius']*norm
    return profile['x']*u+profile['z']*v+projection+profile['offset']*norm


def profiles_overlap(first, second, tolerance=1e-12):
    """Separating axes for convex arcs/segments and their circular offsets.

    A closest boundary pair is segment/segment, segment/arc or arc/arc.
    Segment normals and vectors between arc centres/endpoints cover those pairs.
    Tangency is permitted; an overlap larger than the SI tolerance is rejected.
    """
    a_points, a_normals = profile_features(first)
    b_points, b_normals = profile_features(second)
    axes = [(1., 0.), (0., 1.), *a_normals, *b_normals]
    axes.extend((b[0]-a[0], b[1]-a[1]) for a in a_points for b in b_points)
    for axis in axes:
        norm = hypot(*axis)
        if norm < 1e-15:
            continue
        axis = (axis[0]/norm, axis[1]/norm)
        reverse = (-axis[0], -axis[1])
        if support(first, axis)+support(second, reverse) <= tolerance:
            return False
        if support(second, axis)+support(first, reverse) <= tolerance:
            return False
    return True


def profile_radius(profile):
    """Maximum distance from the cable origin, including a uniform layer offset."""
    distance = hypot(profile['x'], profile['z'])
    if profile['kind'] == 'circle' or in_sector(atan2(profile['z'], profile['x']), profile):
        radius = distance+profile['radius']
    else:
        points, _ = profile_features(profile)
        radius = max(hypot(*point) for point in points)
    return radius+profile['offset']
