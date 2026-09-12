"""Three six-layer cables and finite homogeneous soil, explicit powers, no I inversion.

Gmsh owns the conforming mesh, scikit-fem the P1 solve. Positive y is depth.
The outer rectangle is a truncation of a half-space, NOT an infinite boundary.
"""
from pathlib import Path
import json
from math import hypot
from ..schemas import Scenario
from ..foundation.contracts import CircularRecipe
from .buried_contract import BuriedArgs, BuriedField, BuriedSummary, validate_buried_projection


def buried_mesh(recipe, scenario, args):
    import gmsh
    import numpy as np
    recipe = CircularRecipe.model_validate(recipe)
    scenario = Scenario.model_validate(scenario)
    args = BuriedArgs.model_validate(args)
    positions = scenario.installation.positions_m()
    radius = recipe.layers[-1].outer_radius_m
    if len(recipe.layers) != 6:
        raise ValueError('BURIED_REQUIRES_SIX_LAYERS')
    if any(abs(layer.outer_radius_m-r/1000) > 1e-12 for layer, r in zip(recipe.layers, scenario.cable.radii_mm())):
        raise ValueError('BURIED_RECIPE_SNAPSHOT_MISMATCH')
    if min(hypot(x-x2, y-y2) for i, (x, y) in enumerate(positions) for x2, y2 in positions[i+1:]) <= 2*radius+1e-8:
        raise ValueError('TOUCHING_CABLES_REQUIRE_DIFFERENT_TOPOLOGY')
    scale = max(max(y for x, y in positions), max(abs(x) for x, y in positions)+radius)
    width = bottom = args.domain_scale*scale
    gmsh.initialize()
    try:
        gmsh.option.setNumber('General.Terminal', 0)
        gmsh.option.setNumber('General.NumThreads', 1)
        gmsh.model.add('buried-reference')
        occ = gmsh.model.occ
        corners = [occ.addPoint(x, y, 0) for x, y in [(-width, 0), (width, 0), (width, bottom), (-width, bottom)]]
        rectangle = [occ.addLine(corners[i], corners[(i+1)%4]) for i in range(4)]
        loop = occ.addCurveLoop(rectangle)
        surfaces, outer_loops, all_curves = [], [], []
        for phase, (x, y) in enumerate(positions):
            loops = []
            for layer in recipe.layers:
                curve = occ.addCircle(x, y, 0, layer.outer_radius_m)
                all_curves.append(curve); loops.append(occ.addCurveLoop([curve]))
            outer_loops.append(loops[-1])
            for i, ring in enumerate(loops):
                surfaces.append(occ.addPlaneSurface([ring] if i == 0 else [ring, loops[i-1]]))
        surfaces.append(occ.addPlaneSurface([loop]+outer_loops))
        occ.synchronize()
        for index, surface in enumerate(surfaces, 1):
            group = gmsh.model.addPhysicalGroup(2, [surface], index)
            name = 'soil' if index == 19 else f'phase-{(index-1)//6+1}/{recipe.layers[(index-1)%6].role}'
            gmsh.model.setPhysicalName(2, group, name)
        for index, (name, curve) in enumerate(zip(('ground', 'right', 'bottom', 'left'), rectangle), 201):
            group = gmsh.model.addPhysicalGroup(1, [curve], index)
            gmsh.model.setPhysicalName(1, group, name)
        distance = gmsh.model.mesh.field.add('Distance')
        gmsh.model.mesh.field.setNumbers(distance, 'CurvesList', all_curves)
        gmsh.model.mesh.field.setNumber(distance, 'Sampling', 100)
        threshold = gmsh.model.mesh.field.add('Threshold')
        for key, value in [('InField', distance), ('SizeMin', radius/args.resolution),
                           ('SizeMax', scale/4), ('DistMin', radius), ('DistMax', scale)]:
            gmsh.model.mesh.field.setNumber(threshold, key, value)
        gmsh.model.mesh.field.setAsBackgroundMesh(threshold)
        for option in ('MeshSizeFromPoints', 'MeshSizeFromCurvature', 'MeshSizeExtendFromBoundary'):
            gmsh.option.setNumber('Mesh.'+option, 0)
        gmsh.option.setNumber('Mesh.ElementOrder', 1)
        gmsh.model.mesh.generate(2)
        node_tags, coordinates, _ = gmsh.model.mesh.getNodes()
        if len(node_tags) > 100000:
            raise ValueError('BURIED_NODE_LIMIT')
        lookup = {int(tag): i for i, tag in enumerate(node_tags)}
        triangles, domain_ids = [], []
        for domain, surface in enumerate(surfaces, 1):
            types, _, connectivity = gmsh.model.mesh.getElements(2, surface)
            for kind, nodes in zip(types, connectivity):
                if kind != 2:
                    raise ValueError('ONLY_P1_TRIANGLES_SUPPORTED')
                cells = [[lookup[int(n)] for n in row] for row in nodes.reshape(-1, 3)]
                triangles.extend(cells); domain_ids.extend([domain]*len(cells))
        boundary = set()
        for curve in rectangle:
            tags, _, _ = gmsh.model.mesh.getNodes(1, curve, includeBoundary=True)
            boundary.update(lookup[int(n)] for n in tags)
        gmsh.write('buried.msh')
        return {'points': coordinates.reshape(-1, 3).tolist(), 'triangles': triangles,
                'domain_ids': domain_ids, 'boundary_nodes': sorted(boundary),
                'domains': [{'domain_id': phase*6+i+1, 'phase': ('A', 'B', 'C')[phase],
                             'role': layer.role, 'uid': f'{layer.uid}/phase-{phase+1}'}
                            for phase in range(3) for i, layer in enumerate(recipe.layers)] +
                           [{'domain_id': 19, 'phase': None, 'role': 'soil', 'uid': 'installation/soil'}],
                'cable_centers_m': positions, 'cable_outer_radius_m': radius,
                'half_width_m': width, 'bottom_depth_m': bottom}
    finally:
        gmsh.finalize()


def assemble_conduction(mesh_data, conductivities):
    """One assembly path, also exercised by the manufactured-solution test."""
    import numpy as np
    from skfem import MeshTri, Basis, ElementTriP1, BilinearForm, asm
    from skfem.helpers import dot, grad
    points = np.asarray(mesh_data['points'], dtype=float)
    cells = np.asarray(mesh_data['triangles'], dtype=int)
    ids = np.asarray(mesh_data['domain_ids'], dtype=int)
    mesh = MeshTri(points[:, :2].T, cells.T)
    basis = Basis(mesh, ElementTriP1(), intorder=4)
    if set(mesh.boundary_nodes()) != set(mesh_data['boundary_nodes']):
        raise ValueError('BURIED_MESH_HAS_UNEXPECTED_BOUNDARY')
    @BilinearForm
    def conduction(u, v, w):
        return w.k*dot(grad(u), grad(v))
    coefficients = np.asarray([conductivities[int(tag)] for tag in ids])[:, None]
    return basis, asm(conduction, basis, k=coefficients)


def solve_buried(mesh_data, scenario, args):
    import numpy as np
    from skfem import LinearForm, asm, condense, solve
    scenario = Scenario.model_validate(scenario)
    args = BuriedArgs.model_validate(args)
    # Validate topology before assembling the PDE (the dummy scalar is not a result).
    BuriedField.model_validate(dict(mesh_data, values=[273.15]*len(mesh_data['points'])))
    cable = scenario.cable
    material_k = [args.conductor_k_w_m_k, 1/cable.semicon_rho_k_m_w, 1/cable.insulation_rho_k_m_w,
                  1/cable.semicon_rho_k_m_w, args.metal_screen_k_w_m_k, 1/cable.jacket_rho_k_m_w]
    ks = {i: material_k[(i-1)%6] for i in range(1, 19)}
    ks[19] = 1/scenario.installation.soil_rho_k_m_w
    basis, matrix = assemble_conduction(mesh_data, ks)
    ids = np.asarray(mesh_data['domain_ids'])
    cells = np.asarray(mesh_data['triangles'])
    boundary = np.asarray(mesh_data['boundary_nodes'], dtype=int)
    @LinearForm
    def unit_source(v, w):
        return v
    load = np.zeros(basis.N)
    phase_nodes = []
    for phase, domain in enumerate((1, 7, 13)):
        selected = np.flatnonzero(ids == domain)
        source = asm(unit_source, basis.with_elements(selected))
        area = float(source.sum())
        if area <= 0:
            raise ValueError('BURIED_CONDUCTOR_AREA')
        load += source*(args.conductor_powers_w_m[phase]/area)
        phase_nodes.append(np.unique(cells[selected]))
    rise = solve(*condense(matrix, load, D=boundary))
    residual = matrix@rise-load
    power = float(sum(args.conductor_powers_w_m))
    outflow = -float(residual[boundary].sum())
    free = np.setdiff1d(np.arange(basis.N), boundary)
    if not np.isfinite(rise).all() or float(rise.min()) < -1e-6:
        raise ValueError('BURIED_NONPHYSICAL_TEMPERATURE')
    ambient = scenario.installation.ambient_temperature_c
    summary = BuriedSummary(
        maximum_temperature_c=float(rise.max())+ambient,
        conductor_max_temperatures_c=tuple(float(rise[n].max())+ambient for n in phase_nodes),
        ambient_temperature_c=ambient, source_powers_w_m=args.conductor_powers_w_m,
        source_heat_w_m=power, boundary_heat_w_m=outflow,
        energy_relative_residual=abs(outflow-power)/power if power else None,
        free_equation_residual_inf_w_m=float(np.max(np.abs(residual[free]))),
        nodes=int(basis.N), elements=len(cells), half_width_m=mesh_data['half_width_m'],
        bottom_depth_m=mesh_data['bottom_depth_m'], domain_scale=args.domain_scale,
        resolution=args.resolution, soil_k_w_m_k=ks[19]).model_dump(mode='json')
    field = BuriedField.model_validate(dict(mesh_data, values=(rise+ambient+273.15).tolist())).model_dump(mode='json')
    validate_buried_projection(field, summary)
    return field, summary


def buried_reference(recipe, scenario, args):
    import meshio
    import numpy as np
    mesh = buried_mesh(recipe, scenario, args)
    field, summary = solve_buried(mesh, scenario, args)
    meshio.Mesh(np.asarray(field['points']), [('triangle', np.asarray(field['triangles']))],
                point_data={'temperature_c': np.asarray(field['values'])-273.15},
                cell_data={'domain_id': [np.asarray(field['domain_ids'])]}).write('temperature.vtu')
    for name, payload in [('field.json', field), ('thermal.json', summary)]:
        Path(name).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    return {'files': ['buried.msh', 'temperature.vtu', 'thermal.json', 'field.json'], 'summary': summary,
            'warnings': ['三根六层电缆与均匀土壤的二维定功率研究；发热由用户给定，不使用运行电流推算。',
                         '地表、左右侧和底部均固定为环境温度；有限计算域不是无限土壤，须检查域扩展和网格敏感性。',
                         '不含屏蔽/介质发热、土壤干燥、接触热阻、电阻温度反馈或载流量反求。']}
