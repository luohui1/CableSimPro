"""同心双材料导线：Gmsh 共形 P1 网格、稳态导热与 Robin 边界。

解析式只用于后处理对照，不参与有限元组装或数值解。
"""
from dataclasses import asdict, dataclass
from math import isfinite, log, pi


@dataclass(frozen=True)
class WireInput:
    core_radius_m: float
    outer_radius_m: float
    core_k_w_m_k: float
    insulation_k_w_m_k: float
    source_w_m3: float
    convection_w_m2_k: float
    ambient_k: float
    entity: str
    source_reference: str

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != set(cls.__dataclass_fields__):
            raise ValueError('输入必须完整且只含绝缘导线契约字段；禁止补默认物性。')
        numeric = set(cls.__dataclass_fields__) - {'entity', 'source_reference'}
        for key in numeric:
            x = value[key]
            if isinstance(x, bool) or not isinstance(x, (float, int)) or not isfinite(x):
                raise ValueError('非有限实数：' + key)
            if x < 0 or (x == 0 and key != 'source_w_m3'):
                raise ValueError('数值范围错误：' + key)
        if value['outer_radius_m'] <= value['core_radius_m']:
            raise ValueError('外半径必须大于导体半径。')
        if not isinstance(value['entity'], str) or not value['entity'].startswith('cable/') or len(value['entity']) > 100:
            raise ValueError('需要稳定的 cable/ 实体标识。')
        if not isinstance(value['source_reference'], str) or not value['source_reference'].strip() or len(value['source_reference']) > 2000:
            raise ValueError('必须给出参数来源。')
        return cls(**value)

    def prepared(self):
        return asdict(self)


def mesh_size(parameters, wire):
    if not isinstance(parameters, dict) or set(parameters) != {'mesh_size_m'}:
        raise ValueError('仅接受显式 mesh_size_m 网格参数。')
    size = parameters['mesh_size_m']
    if isinstance(size, bool) or not isinstance(size, (int, float)) or not isfinite(size) or size <= 0:
        raise ValueError('mesh_size_m 必须为有限正数。')
    if size > min(wire.core_radius_m, wire.outer_radius_m-wire.core_radius_m):
        raise ValueError('网格尺寸不能超过导体半径或绝缘厚度。')
    if pi * wire.outer_radius_m**2 / size**2 > 50000:
        raise ValueError('请求的网格估计超过本参考方法资源上限。')
    return float(size)


def exact_rise(wire, radius):
    """无限长圆柱的解析温升；标量或 ndarray。"""
    import numpy as np
    r = np.asarray(radius)
    a, b, q = wire.core_radius_m, wire.outer_radius_m, wire.source_w_m3
    surface = q*a*a/(2*b*wire.convection_w_m2_k)
    interface = surface + q*a*a*log(b/a)/(2*wire.insulation_k_w_m_k)
    return np.where(r <= a, interface + q*(a*a-r*r)/(4*wire.core_k_w_m_k),
                    surface + q*a*a*np.log(b/np.maximum(r, a))/(2*wire.insulation_k_w_m_k))


def make_mesh(wire, size):
    import gmsh
    import numpy as np
    gmsh.initialize()
    try:
        gmsh.option.setNumber('General.Terminal', 0)
        gmsh.option.setNumber('General.NumThreads', 1)
        gmsh.model.add('insulated-wire')
        occ = gmsh.model.occ
        inner = occ.addCircle(0, 0, 0, wire.core_radius_m)
        outer = occ.addCircle(0, 0, 0, wire.outer_radius_m)
        iloop, oloop = occ.addCurveLoop([inner]), occ.addCurveLoop([outer])
        core, insulation = occ.addPlaneSurface([iloop]), occ.addPlaneSurface([oloop, iloop])
        centre = occ.addPoint(0, 0, 0)
        occ.synchronize()
        gmsh.model.mesh.embed(0, [centre], 2, core)
        for tag, surface, name in ((1, core, 'core'), (2, insulation, 'insulation')):
            gmsh.model.addPhysicalGroup(2, [surface], tag)
            gmsh.model.setPhysicalName(2, tag, name)
        gmsh.model.addPhysicalGroup(1, [outer], 101)
        gmsh.model.setPhysicalName(1, 101, 'convection')
        gmsh.option.setNumber('Mesh.MeshSizeMin', size)
        gmsh.option.setNumber('Mesh.MeshSizeMax', size)
        gmsh.option.setNumber('Mesh.ElementOrder', 1)
        gmsh.model.mesh.generate(2)
        tags, coordinates, _ = gmsh.model.mesh.getNodes()
        if len(tags) > 100000:
            raise ValueError('网格节点超过 100000 上限。')
        index = {int(tag): i for i, tag in enumerate(tags)}
        cells, domains = [], []
        for domain, surface in ((1, core), (2, insulation)):
            kinds, _, nodes = gmsh.model.mesh.getElements(2, surface)
            for kind, rows in zip(kinds, nodes):
                if kind != 2:
                    raise ValueError('仅接受 P1 三角形。')
                part = [[index[int(n)] for n in row] for row in rows.reshape(-1, 3)]
                cells.extend(part)
                domains.extend([domain]*len(part))
        boundary, _, _ = gmsh.model.mesh.getNodes(1, outer, includeBoundary=True)
        return np.asarray(coordinates).reshape(-1, 3)[:, :2], np.asarray(cells), np.asarray(domains), {index[int(n)] for n in boundary}
    finally:
        gmsh.finalize()


def solve_wire(wire, size):
    import numpy as np
    from skfem import MeshTri, Basis, FacetBasis, ElementTriP1, BilinearForm, LinearForm, Functional, asm, solve
    from skfem.helpers import dot, grad
    points, cells, domains, boundary = make_mesh(wire, size)
    mesh = MeshTri(points.T, cells.T)
    if set(mesh.boundary_nodes()) != boundary:
        raise ValueError('外边界不匹配或内部界面不共形。')
    if not np.isfinite(points).all() or len(np.unique(cells)) != len(points):
        raise ValueError('网格含非法坐标或孤立节点。')
    basis = Basis(mesh, ElementTriP1(), intorder=4)
    if np.any(basis.dx.sum(axis=1) <= 0):
        raise ValueError('网格含退化单元。')
    surface = FacetBasis(mesh, ElementTriP1(), facets=mesh.boundary_facets(), intorder=4)
    core = basis.with_elements(np.flatnonzero(domains == 1))
    coefficients = np.where(domains == 1, wire.core_k_w_m_k, wire.insulation_k_w_m_k)[:, None]

    @BilinearForm
    def conduction(u, v, w):
        return w.k*dot(grad(u), grad(v))

    @BilinearForm
    def robin(u, v, w):
        return wire.convection_w_m2_k*u*v

    @LinearForm
    def unit(v, w):
        return v

    bulk = asm(conduction, basis, k=coefficients)
    convection = asm(robin, surface)
    core_weights = asm(unit, core)
    surface_weights = asm(unit, surface)
    load = wire.source_w_m3*core_weights
    matrix = bulk+convection
    rise = solve(matrix, load)
    if not np.isfinite(rise).all() or float(rise.min()) < -1e-9:
        raise ValueError('温度解无效。')
    centre = float((basis.probes(np.zeros((2, 1)))@rise)[0])
    mean = float(core_weights@rise/core_weights.sum())
    surface_mean = float(surface_weights@rise/surface_weights.sum())
    source_heat = float(load.sum())
    boundary_heat = float(wire.convection_w_m2_k*(surface_weights@rise))
    residual = float(np.max(np.abs(matrix@rise-load)))
    exact_centre = float(exact_rise(wire, 0))
    exact_mean = exact_centre-wire.source_w_m3*wire.core_radius_m**2/(8*wire.core_k_w_m_k)
    exact_surface = float(exact_rise(wire, wire.outer_radius_m))

    @Functional
    def squared_error(w):
        return (w.temperature-exact_rise(wire, np.sqrt(w.x[0]**2+w.x[1]**2)))**2

    l2 = float(np.sqrt(asm(squared_error, basis, temperature=basis.interpolate(rise))))
    qexact = wire.source_w_m3*pi*wire.core_radius_m**2
    summary = {'nodes': len(points), 'elements': len(cells), 'mesh_size_m': size,
               'centre_rise_k': centre, 'core_mean_rise_k': mean, 'surface_mean_rise_k': surface_mean,
               'exact_centre_rise_k': exact_centre, 'exact_core_mean_rise_k': exact_mean,
               'exact_surface_rise_k': exact_surface, 'l2_error_k_m': l2,
               'source_heat_w_m': source_heat, 'circle_source_heat_w_m': qexact,
               'boundary_heat_w_m': boundary_heat, 'residual_inf_w_m': residual,
               'energy_relative_residual': abs(boundary_heat-source_heat)/source_heat if source_heat else None,
               'polygon_source_relative_error': (source_heat-qexact)/qexact if qexact else None}
    if residual > 1e-7*max(source_heat, 1) or (source_heat and summary['energy_relative_residual'] > 1e-7):
        raise ValueError('离散残差或能量平衡不满足参考方法阈值。')
    field = {'schema': 'cablesim.simulation-field/1', 'length_unit': 'm', 'temperature_unit': 'K',
             'association': 'node', 'points': points.tolist(), 'triangles': cells.tolist(),
             'domain_ids': domains.tolist(), 'temperature': (rise+wire.ambient_k).tolist(),
             'regions': {'1': 'core', '2': 'insulation'}}
    return summary, field
