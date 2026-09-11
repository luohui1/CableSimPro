"""First-party adapters for upstream libraries, lazily invoked in a worker.

These bounded reference adapters do not replace CableModelKit or ReportEngine.
The thermal case is prescribed surface temperature + conductor heating, NOT
buried ampacity or an IEC implementation.
"""
from __future__ import annotations

import json
import math
from pathlib import Path


def write_json(name, payload):
    Path(name).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding='utf-8')


def cadquery_cable(recipe, scenario, args):
    import cadquery as cq
    solids, domains = [], []
    length = args['preview_length_m']
    for layer in recipe['layers']:
        inner, outer = layer['inner_radius_m'], layer['outer_radius_m']
        # CadQuery's CAD unit is mm; exchange schema and reported volumes use SI.
        sketch = cq.Workplane('XY').circle(outer * 1000)
        if inner:
            sketch = sketch.circle(inner * 1000)
        solid = sketch.extrude(length * 1000).val()
        if not solid.isValid():
            raise ValueError('INVALID_BREP')
        volume = solid.Volume() * 1e-9
        expected = math.pi * (outer**2 - inner**2) * length
        if not math.isclose(volume, expected, rel_tol=1e-8):
            raise ValueError('CAD_VOLUME_MISMATCH')
        solids.append(solid)
        domains.append({'uid': layer['uid'], 'role': layer['role'], 'volume_m3': volume})
    compound = cq.Compound.makeCompound(solids)
    cq.exporters.export(compound, 'cable.step', exportType='STEP')
    write_json('geometry.json', {'schema_version': 'cablesim.geometry/1', 'representation': 'brep',
                               'cad_file_unit': 'mm', 'length_m': length, 'domains': domains})
    return {'files': ['cable.step', 'geometry.json'], 'summary': {'solid_count': len(solids), 'domains': domains},
            'warnings': ['等效六层圆形电缆 CAD；不是制造绞线、公差认证或有限元网格。']}


def gmsh_section(recipe, scenario, args):
    import gmsh
    gmsh.initialize()
    try:
        gmsh.option.setNumber('General.Terminal', 0)
        gmsh.model.add('cable-section')
        occ = gmsh.model.occ
        circles, loops, surfaces = [], [], []
        for layer in recipe['layers']:
            circle = occ.addCircle(0, 0, 0, layer['outer_radius_m'])
            circles.append(circle)
            loops.append(occ.addCurveLoop([circle]))
        for i, loop in enumerate(loops):
            surfaces.append(occ.addPlaneSurface([loop] if i == 0 else [loop, loops[i-1]]))
        occ.synchronize()
        for i, surface in enumerate(surfaces):
            tag = gmsh.model.addPhysicalGroup(2, [surface], i + 1)
            gmsh.model.setPhysicalName(2, tag, recipe['layers'][i]['role'])
        gmsh.model.addPhysicalGroup(1, [circles[-1]], 100)
        gmsh.model.setPhysicalName(1, 100, 'jacket_outer')
        h = recipe['layers'][-1]['outer_radius_m'] / args['resolution']
        gmsh.option.setNumber('Mesh.MeshSizeMin', h)
        gmsh.option.setNumber('Mesh.MeshSizeMax', h)
        gmsh.option.setNumber('Mesh.ElementOrder', 1)
        gmsh.model.mesh.generate(2)
        tags, coordinates, _ = gmsh.model.mesh.getNodes()
        if len(tags) > 50000:
            raise ValueError('MESH_NODE_LIMIT')
        index = {int(tag): i for i, tag in enumerate(tags)}
        points = coordinates.reshape(-1, 3).tolist()
        triangles, domain_ids = [], []
        for i, surface in enumerate(surfaces):
            types, _, nodes = gmsh.model.mesh.getElements(2, surface)
            for kind, connectivity in zip(types, nodes):
                if kind != 2:
                    raise ValueError('ONLY_P1_TRIANGLES_SUPPORTED')
                block = [[index[int(n)] for n in row] for row in connectivity.reshape(-1, 3)]
                triangles.extend(block)
                domain_ids.extend([i + 1] * len(block))
        gmsh.write('section.msh')
        mesh = {'schema_version': 'cablesim.mesh/1', 'dimension': 2, 'length_unit': 'm',
                'points': points, 'triangles': triangles, 'domain_ids': domain_ids,
                'domains': [dict(layer, domain_id=i+1) for i, layer in enumerate(recipe['layers'])]}
        write_json('mesh.json', mesh)
        return {'files': ['section.msh', 'mesh.json'],
                'summary': {'nodes': len(points), 'elements': len(triangles), 'domains': len(surfaces), 'length_unit': 'm'},
                'warnings': ['仅电缆本体二维贴合网格；不包含土壤、管群或热源，网格不是仿真结果。']}
    finally:
        gmsh.finalize()


def meshio_vtu(recipe, scenario, args):
    import meshio
    import numpy as np
    mesh = json.loads(Path('input/mesh.json').read_text('utf-8'))
    out = meshio.Mesh(np.asarray(mesh['points']), [('triangle', np.asarray(mesh['triangles']))],
                      cell_data={'domain_id': [np.asarray(mesh['domain_ids'])]})
    out.write('section.vtu', file_format='vtu')
    loaded = meshio.read('section.vtu')
    if len(loaded.points) != len(mesh['points']):
        raise ValueError('MESH_CONVERSION_MISMATCH')
    return {'files': ['section.vtu'], 'summary': {'nodes': len(mesh['points']), 'elements': len(mesh['triangles'])},
            'warnings': ['格式转换不会创建温度场；物理域编号保留。']}


def radial_thermal(recipe, scenario, args):
    import numpy as np
    import meshio
    from skfem import MeshTri, Basis, ElementTriP1, BilinearForm, LinearForm, asm, condense, solve
    from skfem.helpers import dot, grad
    payload = json.loads(Path('input/mesh.json').read_text('utf-8'))
    points = np.asarray(payload['points'], dtype=float)
    triangles = np.asarray(payload['triangles'], dtype=int)
    ids = np.asarray(payload['domain_ids'], dtype=int)
    mesh = MeshTri(points[:, :2].T, triangles.T)
    basis = Basis(mesh, ElementTriP1())
    cable = scenario['cable']
    conductivities = [args['conductor_k_w_m_k'], 1/cable['semicon_rho_k_m_w'],
                      1/cable['insulation_rho_k_m_w'], 1/cable['semicon_rho_k_m_w'],
                      args['metal_screen_k_w_m_k'], 1/cable['jacket_rho_k_m_w']]
    if len(recipe['layers']) != 6 or set(ids) != set(range(1, 7)):
        raise ValueError('UNSUPPORTED_LAYER_MAPPING')
    @BilinearForm
    def laplace(u, v, w):
        return dot(grad(u), grad(v))
    @LinearForm
    def load(v, w):
        return v
    A = None
    for domain_id, conductivity in enumerate(conductivities, 1):
        part = asm(laplace, basis.with_elements(np.flatnonzero(ids == domain_id))) * conductivity
        A = part if A is None else A + part
    source = asm(load, basis.with_elements(np.flatnonzero(ids == 1)))
    heat = args['heat_w_m']
    b = source * (heat / source.sum())
    # Solve temperature rise, avoiding cancellation from a large Celsius offset.
    boundary = basis.get_dofs().all()
    rise = solve(*condense(A, b, D=boundary))
    temperature = rise + args['surface_temperature_c']
    residual = A @ rise - b
    flux_out = -float(residual[boundary].sum())
    balance = abs(flux_out - heat) / heat
    r = [layer['outer_radius_m'] for layer in recipe['layers']]
    reference_rise = heat / (4 * math.pi * conductivities[0])
    for i in range(1, 6):
        reference_rise += heat * math.log(r[i]/r[i-1]) / (2 * math.pi * conductivities[i])
    reference_max = args['surface_temperature_c'] + reference_rise
    summary = {'maximum_temperature_c': float(temperature.max()), 'surface_temperature_c': args['surface_temperature_c'],
               'source_heat_w_m': heat, 'boundary_heat_w_m': flux_out, 'energy_relative_residual': balance,
               'analytic_maximum_temperature_c': reference_max,
               'analytic_temperature_rise_relative_error': abs(float(rise.max()) - reference_rise)/reference_rise,
               'nodes': len(points), 'elements': len(triangles), 'method': 'P1 2D steady conduction; prescribed surface temperature',
               'ampacity_a': None, 'conductivities_w_m_k': conductivities}
    if not np.isfinite(temperature).all() or balance > 1e-6:
        raise ValueError('THERMAL_BALANCE_FAILED')
    meshio.Mesh(points, [('triangle', triangles)], point_data={'temperature_c': temperature},
                cell_data={'domain_id': [ids]}).write('temperature.vtu')
    write_json('thermal.json', dict(summary, schema_version='cablesim.thermal-reference/1'))
    return {'files': ['temperature.vtu', 'thermal.json'], 'summary': summary,
            'warnings': ['这是定缆表温度和显式导体发热的数值基准，不是直埋载流量；不使用运行电流推测损耗。',
                         '各材料热导率取常数；不含屏蔽/介质分布发热、土壤、电磁耦合或认证。']}


def pyvista_summary(recipe, scenario, args):
    import pyvista as pv
    grid = pv.read('input/temperature.vtu')
    values = grid.point_data['temperature_c']
    low, high = float(values.min()), float(values.max())
    summary = {'point_count': grid.n_points, 'cell_count': grid.n_cells,
               'temperature_min_c': low, 'temperature_max_c': high,
               'hot_node_xyz_m': grid.points[int(values.argmax())].tolist()}
    contour = grid.contour([(low + high)/2], scalars='temperature_c')
    contour.save('isotherm.vtp')
    write_json('field-summary.json', summary)
    return {'files': ['field-summary.json', 'isotherm.vtp'], 'summary': summary,
            'warnings': ['从已有有限元场提取统计和等温线，不重新求解；尚未接入 vtk.js 交互查看器。']}


HANDLERS = {'cadquery.cable-step': cadquery_cable, 'gmsh.cable-section': gmsh_section,
            'meshio.to-vtu': meshio_vtu, 'skfem.radial-thermal': radial_thermal,
            'pyvista.field-summary': pyvista_summary}
