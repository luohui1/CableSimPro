"""Convert a bounded CableSimPro display-scene exchange file to Blender/glTF.

Run only in a separate background Blender process. This is NOT a CAD importer,
mesh generator for analysis, material-property database, or solver.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from typing import Any

MAX_BYTES = 64 * 1024 * 1024
MAX_VERTICES = 500_000
MAX_TRIANGLES = 1_000_000
MAX_INSTANCES = 8_192


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def transform(value: Any) -> list[list[float]]:
    require(isinstance(value, list) and len(value) == 12 and all(finite_number(item) for item in value), 'Invalid row-major 3x4 metre transform')
    rows = [value[0:3], value[4:7], value[8:11]]
    for i in range(3):
        for j in range(i, 3):
            dot = sum(a * b for a, b in zip(rows[i], rows[j]))
            require(abs(dot - (1 if i == j else 0)) < 1e-5, 'Scale/shear is not an engineering rigid transform')
    a, b, c = rows
    det = a[0] * (b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])
    require(abs(det - 1) < 1e-5, 'Mirrored transform is not supported')
    return [value[0:4], value[4:8], value[8:12], [0.0, 0.0, 0.0, 1.0]]


def validate(data: Any) -> dict:
    require(isinstance(data, dict), 'Expected a scene object')
    require(data.get('schema') == 'cablesim.blender-scene/1' and data.get('purpose') == 'visualization-only', 'Not a CableSimPro display-scene exchange')
    require(data.get('unit') == 'm' and data.get('coordinate_frame') == 'right-handed-z-up' and data.get('extrusion_axis') == '+Y', 'Unit/coordinate convention mismatch')
    require(bool(re.fullmatch('[0-9a-f]{64}', str(data.get('input_sha256', '')))), 'Missing input identity')
    source = data.get('source', {})
    require(isinstance(source, dict) and all(isinstance(source.get(key), str) and source[key].strip() and len(source[key]) <= 256 for key in ('workspace_id', 'study_id', 'section_id')), 'Missing source identity')
    revision = source.get('workspace_revision')
    require(isinstance(revision, int) and not isinstance(revision, bool) and revision >= 1, 'Invalid workspace revision')
    require(data.get('representation') in ('display-mesh', 'display-envelope'), 'Unknown display representation')
    bounds = data.get('bounds_m')
    require(isinstance(bounds, list) and len(bounds) == 6 and all(finite_number(x) for x in bounds) and all(bounds[i] <= bounds[i+3] for i in range(3)), 'Invalid scene bounds')
    assets = data.get('assets')
    objects = data.get('objects')
    require(isinstance(assets, list) and 0 < len(assets) <= 512 and isinstance(objects, list) and 0 < len(objects) <= 128, 'Invalid scene size')
    asset_map = {}
    vertices = triangles = instances = 0
    for asset in assets:
        require(isinstance(asset, dict) and isinstance(asset.get('id'), str) and bool(asset['id']) and asset['id'] not in asset_map, 'Duplicate/invalid asset ID')
        require(isinstance(asset.get('geometry_key'), str) and bool(asset['geometry_key']), 'Missing geometry identity')
        prototypes = asset.get('prototypes')
        require(isinstance(prototypes, list) and 0 < len(prototypes) <= MAX_INSTANCES, 'Empty/oversized mesh prototypes')
        for prototype in prototypes:
            require(isinstance(prototype, dict), 'Invalid prototype')
            positions = prototype.get('positions_m')
            indices = prototype.get('triangles')
            matrices = prototype.get('transforms_m')
            require(isinstance(positions, list) and len(positions) > 0 and len(positions) % 3 == 0 and all(finite_number(x) for x in positions), 'Invalid metre positions')
            count = len(positions) // 3
            require(isinstance(indices, list) and len(indices) > 0 and len(indices) % 3 == 0 and all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < count for i in indices), 'Invalid triangle index')
            require(isinstance(matrices, list) and bool(matrices), 'Missing mesh instances')
            vertices += count
            triangles += len(indices) // 3
            instances += len(matrices)
            require(vertices <= MAX_VERTICES and triangles <= MAX_TRIANGLES and instances <= MAX_INSTANCES, 'Scene exceeds exchange budget')
            for matrix in matrices:
                transform(matrix)
        asset_map[asset['id']] = asset
    seen = set()
    parts = expanded_instances = 0
    for obj in objects:
        require(isinstance(obj, dict) and isinstance(obj.get('id'), str) and obj['id'] and obj['id'] not in seen, 'Duplicate/invalid object ID')
        require(obj.get('kind') in ('cable', 'enclosure', 'backfill', 'soil', 'ground'), 'Unknown engineering object kind')
        seen.add(obj['id'])
        require(isinstance(obj.get('parts'), list) and bool(obj['parts']), 'Object has no parts')
        for part in obj['parts']:
            require(isinstance(part, dict) and part.get('asset_id') in asset_map, 'Missing asset reference')
            transform(part.get('transform_m'))
            parts += 1
            expanded_instances += sum(len(p['transforms_m']) for p in asset_map[part['asset_id']]['prototypes'])
            require(parts <= 512 and expanded_instances <= MAX_INSTANCES, 'Expanded scene exceeds object budget')
    return data


def load(path: Path) -> tuple[dict, str]:
    require(path.is_file() and path.stat().st_size <= MAX_BYTES, 'Missing/oversized scene input')
    raw = path.read_bytes()
    # reject NaN/Infinity accepted by Python's default JSON parser
    data = json.loads(raw.decode('utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f'Non-finite JSON: {value}')))
    return validate(data), hashlib.sha256(raw).hexdigest()


def export(data: dict, output: Path, source_digest: str, save_blend: bool) -> None:
    import bpy  # Imported only after JSON validation; unavailable in normal Python.
    from mathutils import Matrix

    require(bpy.app.background, 'Use a separate Blender --background --factory-startup process; interactive scenes are never cleared')
    require(not output.exists(), 'Refusing to overwrite an existing GLB')
    blend = output.with_suffix('.blend')
    manifest = output.with_suffix('.manifest.json')
    require(not manifest.exists() and (not save_blend or not blend.exists()), 'Refusing to overwrite existing scene outputs')
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    scene['cablesim_schema'] = data['schema']
    scene['cablesim_input_sha256'] = data['input_sha256']
    scene['cablesim_purpose'] = 'visualization-only'
    # Display palette only. These numbers are not thermal/electrical material data.
    palette = {
        'conductor': ((0.64, 0.29, 0.10, 1.0), 0.82, 0.30),
        'metal': ((0.55, 0.60, 0.66, 1.0), 0.78, 0.35),
        'semiconductor': ((0.025, 0.03, 0.035, 1.0), 0.0, 0.65),
        'insulation': ((0.76, 0.77, 0.72, 1.0), 0.0, 0.55),
        'polymer': ((0.025, 0.028, 0.032, 1.0), 0.0, 0.50),
        'filler': ((0.34, 0.29, 0.22, 1.0), 0.0, 0.85),
        'unknown': ((0.40, 0.41, 0.42, 1.0), 0.0, 0.80),
    }
    materials = {}
    meshes = {}
    for asset in data['assets']:
        category = asset.get('category', 'unknown')
        if category not in materials:
            color, metallic, roughness = palette.get(category, palette['unknown'])
            material = bpy.data.materials.new(f'Visual/{category}')
            material.use_nodes = True
            bsdf = material.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = color
            bsdf.inputs['Metallic'].default_value = metallic
            bsdf.inputs['Roughness'].default_value = roughness
            material['cablesim_role'] = 'visual-appearance-not-physical-property'
            materials[category] = material
        for index, prototype in enumerate(asset['prototypes']):
            p, t = prototype['positions_m'], prototype['triangles']
            mesh = bpy.data.meshes.new(f"{asset['id']}/{index}")
            mesh.from_pydata([p[i:i+3] for i in range(0, len(p), 3)], [], [t[i:i+3] for i in range(0, len(t), 3)])
            mesh.update()
            mesh.materials.append(materials[category])
            meshes[(asset['id'], index)] = mesh
    for obj in data['objects']:
        parent = bpy.data.objects.new(obj.get('label') or obj['id'], None)
        scene.collection.objects.link(parent)
        parent['cablesim_entity_id'] = obj['id']
        parent['cablesim_kind'] = obj['kind']
        parent['cablesim_input_sha256'] = data['input_sha256']
        parent['cablesim_representation'] = data['representation']
        for part in obj['parts']:
            asset = next(a for a in data['assets'] if a['id'] == part['asset_id'])
            placement = Matrix(transform(part['transform_m']))
            for index, prototype in enumerate(asset['prototypes']):
                for instance, matrix in enumerate(prototype['transforms_m']):
                    item = bpy.data.objects.new(f"{obj['id']}/{index}/{instance}", meshes[(asset['id'], index)])
                    scene.collection.objects.link(item)
                    item.parent = parent
                    item.matrix_local = placement @ Matrix(transform(matrix))
                    item['cablesim_entity_id'] = obj['id']
                    item['cablesim_geometry_key'] = asset['geometry_key']
                    item['cablesim_input_sha256'] = data['input_sha256']
    if save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    # Blender's exporter performs Z-up -> glTF Y-up. Never apply that rotation twice.
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_extras=True, export_yup=True)
    require(output.is_file() and output.stat().st_size > 20, 'Blender did not produce a GLB')
    metadata = {'schema': 'cablesim.visual-asset/1', 'purpose': 'visualization-only', 'source': data['source'],
                'input_sha256': data['input_sha256'], 'exchange_sha256': source_digest,
                'glb_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'glb_unit': 'm',
                'glb_up_axis': '+Y', 'blender_version': bpy.app.version_string,
                'entity_ids': [obj['id'] for obj in data['objects']], 'representation': data['representation']}
    manifest.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--save-blend', action='store_true')
    parser.add_argument('--validate-only', action='store_true')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    try:
        data, digest = load(args.input)
        if not args.validate_only:
            require(args.output is not None and args.output.suffix.lower() == '.glb', 'Provide a new --output file.glb')
            require(args.output.resolve() != args.input.resolve(), 'Output must not replace input')
            export(data, args.output.resolve(), digest, args.save_blend)
        print(json.dumps({'status': 'validated' if args.validate_only else 'exported', 'input_sha256': data['input_sha256'], 'objects': len(data['objects'])}))
        return 0
    except (ValueError, OSError, ImportError, KeyError, TypeError) as exc:
        print(f'Scene export refused: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
