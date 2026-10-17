"""Display-exchange tests. Synthetic geometry only; no engineering/numerical validation."""
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'frontend/src/features/scene/blender/export_scene.py'
spec = importlib.util.spec_from_file_location('scene_export', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]


def fixture():
    return {'schema': 'cablesim.blender-scene/1', 'purpose': 'visualization-only', 'unit': 'm',
            'coordinate_frame': 'right-handed-z-up', 'extrusion_axis': '+Y', 'input_sha256': 'a'*64,
            'source': {'workspace_id': 'w/a', 'study_id': 's/a', 'section_id': 'section/a', 'workspace_revision': 2},
            'representation': 'display-mesh', 'bounds_m': [0, 0, 0, 5, 5, 5],
            'assets': [{'id': 'metal', 'geometry_key': 'g/a', 'category': 'metal', 'material': 'copper',
                        'prototypes': [{'positions_m': [0,0,0,1,0,0,0,1,0], 'triangles': [0,1,2],
                                        'transforms_m': [[1,0,0,0,0,1,0,0,0,0,1,.5]]}]}],
            'objects': [{'id': 'cable/A', 'label': '显示测试', 'kind': 'cable',
                         'parts': [{'asset_id': 'metal', 'transform_m': [1,0,0,2,0,1,0,3,0,0,1,4]}]}]}


def multiply(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def gltf_matrix(node):
    if 'matrix' in node:
        return [[node['matrix'][c*4+r] for c in range(4)] for r in range(4)]
    x, y, z, w = node.get('rotation', [0,0,0,1])
    sx, sy, sz = node.get('scale', [1,1,1])
    tx, ty, tz = node.get('translation', [0,0,0])
    return [[(1-2*y*y-2*z*z)*sx, (2*x*y-2*z*w)*sy, (2*x*z+2*y*w)*sz, tx],
            [(2*x*y+2*z*w)*sx, (1-2*x*x-2*z*z)*sy, (2*y*z-2*x*w)*sz, ty],
            [(2*x*z-2*y*w)*sx, (2*y*z+2*x*w)*sy, (1-2*x*x-2*y*y)*sz, tz], [0,0,0,1]]


def world_vertices(doc, binary):
    found = set()
    def visit(index, parent):
        node = doc['nodes'][index]
        world = multiply(parent, gltf_matrix(node))
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                accessor = doc['accessors'][primitive['attributes']['POSITION']]
                assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
                view = doc['bufferViews'][accessor['bufferView']]
                offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
                stride = view.get('byteStride', 12)
                for vertex in range(accessor['count']):
                    p = [*struct.unpack_from('<fff', binary, offset+vertex*stride), 1]
                    found.add(tuple(round(sum(world[i][k]*p[k] for k in range(4)), 5) for i in range(3)))
        for child in node.get('children', []):
            visit(child, world)
    for root in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(root, [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]])
    return found


class SceneExchangeTests(unittest.TestCase):
    def test_valid_payload_is_not_mutated(self):
        value = fixture()
        before = copy.deepcopy(value)
        self.assertIs(module.validate(value), value)
        self.assertEqual(value, before)

    def test_missing_source_refused(self):
        value = fixture(); value['source']['workspace_id'] = ''
        with self.assertRaises(ValueError): module.validate(value)

    def test_units_and_handedness_refused(self):
        for key, invalid in [('unit', 'mm'), ('coordinate_frame', 'left-handed'), ('extrusion_axis', '+Z')]:
            with self.subTest(key=key):
                value = fixture(); value[key] = invalid
                with self.assertRaises(ValueError): module.validate(value)

    def test_result_payload_not_accepted_as_geometry(self):
        value = fixture(); value['purpose'] = 'simulation-result'
        with self.assertRaises(ValueError): module.validate(value)

    def test_duplicate_ids_and_missing_assets(self):
        value = fixture(); value['objects'].append(copy.deepcopy(value['objects'][0]))
        with self.assertRaises(ValueError): module.validate(value)
        value = fixture(); value['objects'][0]['parts'][0]['asset_id'] = 'missing'
        with self.assertRaises(ValueError): module.validate(value)

    def test_nonfinite_fractional_and_boolean_indices(self):
        for indices in [[0,1,3], [0,1,1.5], [0,True,2]]:
            value = fixture(); value['assets'][0]['prototypes'][0]['triangles'] = indices
            with self.assertRaises(ValueError): module.validate(value)
        value = fixture(); value['assets'][0]['prototypes'][0]['positions_m'][0] = math.nan
        with self.assertRaises(ValueError): module.validate(value)

    def test_transforms_are_row_major_in_metres(self):
        self.assertEqual(module.transform([1,0,0,2,0,1,0,3,0,0,1,4]), [[1,0,0,2],[0,1,0,3],[0,0,1,4],[0,0,0,1]])

    def test_scaled_or_mirrored_geometry_refused(self):
        for factor in [2, -1]:
            matrix = list(IDENTITY); matrix[0] = factor
            with self.assertRaises(ValueError): module.transform(matrix)

    def test_expanded_instance_budget_not_just_unique_mesh_count(self):
        value = fixture(); value['assets'][0]['prototypes'][0]['transforms_m'] = [IDENTITY]*5000
        value['objects'][0]['parts'].append(copy.deepcopy(value['objects'][0]['parts'][0]))
        with self.assertRaises(ValueError): module.validate(value)

    def test_file_digest_and_json_nan_refusal(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'scene.json'; raw = json.dumps(fixture()).encode()
            path.write_bytes(raw)
            _, digest = module.load(path)
            self.assertEqual(digest, hashlib.sha256(raw).hexdigest())
            path.write_text('{"value": NaN}')
            with self.assertRaises(ValueError): module.load(path)

    def test_validation_cli_needs_no_blender(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'scene.json'; path.write_text(json.dumps(fixture()), encoding='utf-8')
            result = subprocess.run([sys.executable, str(SCRIPT), '--input', str(path), '--validate-only'], capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['status'], 'validated')

    @unittest.skipUnless(os.environ.get('CABLESIM_BLENDER') and shutil.which(os.environ['CABLESIM_BLENDER']), 'Requires explicitly configured Blender executable; not a numerical solver test')
    def test_headless_glb_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            path, target = Path(folder)/'scene.json', Path(folder)/'scene.glb'
            path.write_text(json.dumps(fixture()), encoding='utf-8')
            result = subprocess.run([os.environ['CABLESIM_BLENDER'], '--background', '--factory-startup', '--python-exit-code', '1', '--python', str(SCRIPT), '--', '--input', str(path), '--output', str(target), '--save-blend'], capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout[-4000:] + result.stderr[-2000:])
            raw = target.read_bytes()
            magic, version, length = struct.unpack_from('<III', raw)
            self.assertEqual((magic, version, length), (0x46546c67, 2, len(raw)))
            offset, doc, binary = 12, None, None
            while offset < len(raw):
                size, kind = struct.unpack_from('<II', raw, offset); offset += 8
                content = raw[offset:offset+size]; offset += size
                if kind == 0x4e4f534a: doc = json.loads(content)
                if kind == 0x004e4942: binary = content
            self.assertIsNotNone(doc); self.assertIsNotNone(binary)
            self.assertTrue(any(node.get('extras', {}).get('cablesim_entity_id') == 'cable/A' for node in doc['nodes']))
            self.assertEqual(world_vertices(doc, binary), {(2,4.5,-3),(3,4.5,-3),(2,4.5,-4)})
            metadata = json.loads(target.with_suffix('.manifest.json').read_text())
            self.assertEqual(metadata['input_sha256'], 'a'*64)
            self.assertEqual(metadata['glb_sha256'], hashlib.sha256(raw).hexdigest())
            self.assertTrue(target.with_suffix('.blend').is_file())


if __name__ == '__main__':
    unittest.main()
