"""Lossless full fields and a separate, explicitly approximate display mesh.

Little-endian arrays are byte-shuffled and zlib compressed in bounded blocks.
No temperatures are rounded. Display decimation never feeds the solver/results.
"""
from base64 import b64encode
from hashlib import sha256
import zlib
import numpy as np

SCHEMA = 'cablesim.field-array/1'
BLOCK = 65536
PART_BYTES = 12*1024*1024


def pack(values, dtype):
    array = np.asarray(values, dtype=dtype)
    flat = array.reshape(-1); blocks = []; checksum = sha256()
    for start in range(0, len(flat), BLOCK):
        raw = flat[start:start+BLOCK].tobytes(); checksum.update(raw)
        shuffled = np.frombuffer(raw, dtype=np.uint8).reshape(-1, array.itemsize).T.copy().tobytes()
        blocks.append(b64encode(zlib.compress(shuffled, 6)).decode('ascii'))
    return {'schema_version': SCHEMA, 'encoding': 'base64-zlib-byte-shuffle',
            'dtype': array.dtype.str, 'shape': list(array.shape), 'block_elements': BLOCK,
            'sha256': checksum.hexdigest(), 'blocks': blocks}


def export(job, case_id, mesh, temperatures):
    from .artifacts import write
    descriptors = {}; artifacts = []; parts = [[]]; part_bytes = 0
    for name, values, dtype in [('points', mesh['points'], '<f8'),
            ('triangles', mesh['triangles'], '<u4'), ('domain_ids', mesh['domain_ids'], '<u4'),
            ('temperature_k', temperatures, '<f8')]:
        value=pack(values,dtype);references=[]
        for block in value['blocks']:
            if part_bytes+len(block)+3>PART_BYTES:
                parts.append([]);part_bytes=0
            if len(parts)>16:raise ValueError('全网格分块超过有界工件容量，未截断数据。')
            references.append({'artifact_type':'x-cablesim.field-part-'+str(len(parts)-1),'block_index':len(parts[-1])})
            parts[-1].append(block);part_bytes+=len(block)+3
        descriptors[name]={k:v for k,v in value.items() if k!='blocks'} | {'block_refs':references}
    for index,blocks in enumerate(parts):
        artifacts.append(write(job,case_id,'full-part-'+str(index),'x-cablesim.field-part-'+str(index),
                               {'schema_version':'cablesim.field-blocks/1','blocks':blocks}))
    return {'schema_version': 'cablesim.full-field/2', 'arrays': descriptors,
            'nodes': len(mesh['points']), 'elements': len(mesh['triangles']),
            'regions': mesh['regions'], 'representation': mesh.get('discretization'),
            'length_unit': 'm', 'temperature_unit': 'K'}, artifacts


def display(mesh, temperatures, maximum=12000):
    """Select actual nodes in graded spatial bins, retaining both extrema.

    Retriangulation is for display only. Domain ids indicate the nearest original
    triangle centre; display edges are not a material-interface discretization.
    """
    if len(mesh['points']) <= maximum:return mesh, temperatures
    from scipy.spatial import Delaunay, cKDTree
    points = np.asarray(mesh['points']); values = np.asarray(temperatures)
    centre = points[int(values.argmax())]
    transformed = np.arcsinh((points-centre)/.1)
    low = transformed.min(axis=0); span = np.maximum(transformed.max(axis=0)-low, 1e-12)
    bins = int(np.sqrt(maximum/2))
    keys = np.floor((transformed-low)/span*bins).astype(np.int64)
    _, selected = np.unique(keys, axis=0, return_index=True)
    selected = np.unique(np.r_[selected, values.argmax(), values.argmin(),
                              points.argmin(axis=0), points.argmax(axis=0)])
    if len(selected)>maximum:raise ValueError('显示网格超出独立预算，未截断原始场。')
    visible = points[selected]; triangles = Delaunay(visible).simplices
    original = np.asarray(mesh['triangles'], dtype=np.int32)
    centres = points[original].mean(axis=1)
    _, nearest = cKDTree(centres).query(visible[triangles].mean(axis=1))
    return {'points':visible.tolist(), 'triangles':triangles.tolist(),
            'domain_ids':np.asarray(mesh['domain_ids'])[nearest].tolist(), 'regions':mesh['regions'],
            'discretization':'display-decimated actual nodes; retriangulated visualization only; full mesh in bound bundle'}, values[selected].tolist()
