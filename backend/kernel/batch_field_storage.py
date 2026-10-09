"""Bounded decoding of saved full-field arrays; no solver dependency."""
from base64 import b64decode
from hashlib import sha256
import zlib
import numpy as np

DTYPES = {'points':'<f8', 'triangles':'<u4', 'domain_ids':'<u4', 'temperature_k':'<f8'}
MAX_NODES = 4000000


def unpack(value, name):
    shape = value.get('shape'); dtype = np.dtype(DTYPES[name])
    if value.get('schema_version')!='cablesim.field-array/1' or value.get('encoding')!='base64-zlib-byte-shuffle' or value.get('dtype')!=dtype.str:
        raise ValueError('原始场数组格式不支持。')
    if not isinstance(shape,list) or not shape or any(type(n) is not int or n<=0 for n in shape):raise ValueError('原始场数组形状无效。')
    expected_width = {'points':2,'triangles':3}.get(name)
    if (expected_width and (len(shape)!=2 or shape[1]!=expected_width)) or (not expected_width and len(shape)!=1):raise ValueError('原始场数组维度无效。')
    limit = MAX_NODES*2 if name in ('triangles','domain_ids') else MAX_NODES
    if shape[0]>limit or value.get('block_elements')!=65536:raise ValueError('原始场数组超过有界容量。')
    size = int(np.prod(shape)); blocks=value.get('blocks',[])
    if len(blocks)!=(size+65535)//65536:raise ValueError('原始场数组块数不符。')
    result=np.empty(size,dtype=dtype); checksum=sha256()
    for i, encoded in enumerate(blocks):
        count=min(65536,size-i*65536); expected=count*dtype.itemsize
        compressed=b64decode(encoded,validate=True)
        decoder=zlib.decompressobj(); raw=decoder.decompress(compressed,expected+1)
        if len(raw)!=expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:raise ValueError('原始场压缩块长度或终止标记无效。')
        unshuffled=np.frombuffer(raw,dtype=np.uint8).reshape(dtype.itemsize,count).T.copy().tobytes()
        checksum.update(unshuffled);result[i*65536:i*65536+count]=np.frombuffer(unshuffled,dtype=dtype)
    if checksum.hexdigest()!=value.get('sha256'):raise ValueError('原始场数组摘要不一致。')
    return result.reshape(shape)


def full_field(case):
    artifacts=case['artifacts'];field=artifacts['x-cablesim.temperature-field']
    descriptor=artifacts.get('x-cablesim.simulation-bundle',{}).get('field_storage')
    if not descriptor:
        return {name:np.asarray(field['temperature_k'] if name=='temperature_k' else field['mesh'][name]) for name in DTYPES}
    version=descriptor.get('schema_version')
    if version not in ('cablesim.full-field/1','cablesim.full-field/2'):raise ValueError('原始场契约版本不支持。')
    result={}
    for name in DTYPES:
        reference=descriptor['arrays'][name]
        if version=='cablesim.full-field/1':
            packed=artifacts[reference['artifact_type']]
            if any(packed.get(k)!=v for k,v in reference.items() if k!='artifact_type'):raise ValueError('原始场与绑定描述不一致。')
        else:
            blocks=[];references=reference.get('block_refs',[])
            if not 1<=len(references)<=(MAX_NODES*6+65535)//65536:raise ValueError('原始场分块数无效。')
            for part in references:
                packed_part=artifacts[part['artifact_type']];index=part['block_index']
                if packed_part.get('schema_version')!='cablesim.field-blocks/1' or type(index) is not int or not 0<=index<len(packed_part.get('blocks',[])):
                    raise ValueError('原始场分块引用无效。')
                blocks.append(packed_part['blocks'][index])
            packed={k:v for k,v in reference.items() if k!='block_refs'} | {'blocks':blocks}
        result[name]=unpack(packed,name)
    points,cells,ids,values=(result[n] for n in DTYPES)
    if len(points)!=len(values) or len(cells)!=len(ids) or len(points)!=descriptor['nodes'] or len(cells)!=descriptor['elements']:
        raise ValueError('原始场节点及单元数量不一致。')
    if cells.max()>=len(points) or not np.isfinite(points).all() or not np.isfinite(values).all() or values.min()<=0:
        raise ValueError('原始场索引或量值无效。')
    index=int(values.argmax());hotspot=field['hotspot']
    if values[index]!=hotspot['temperature_k'] or tuple(points[index])!=tuple(hotspot['point_m']):raise ValueError('原始全网格热点与显示工件不一致。')
    return result


def sample(arrays, queries):
    """Piecewise-linear interpolation of full saved P2 display subtriangles.

    Scan bounded blocks; never reconstruct a Delaunay mesh or use the preview.
    """
    if not 1<=len(queries)<=128:raise ValueError('每次取样须为 1–128 个坐标。')
    queries=np.asarray(queries,dtype=float)
    if queries.shape!=(len(queries),2) or not np.isfinite(queries).all():raise ValueError('取样坐标须为有限的 x、z 米值。')
    points,cells,values=arrays['points'],arrays['triangles'],arrays['temperature_k']
    result=[None]*len(queries)
    for start in range(0,len(cells),32768):
        indexes=cells[start:start+32768];p=points[indexes]
        low=p.min(axis=1);high=p.max(axis=1)
        for i,q in enumerate(queries):
            if result[i] is not None:continue
            candidate=np.flatnonzero(np.all(q>=low-1e-12,axis=1)&np.all(q<=high+1e-12,axis=1))
            if not len(candidate):continue
            t=p[candidate];v0=t[:,1]-t[:,0];v1=t[:,2]-t[:,0];v2=q-t[:,0]
            determinant=v0[:,0]*v1[:,1]-v1[:,0]*v0[:,1]
            valid=np.abs(determinant)>1e-30
            a=np.divide(v2[:,0]*v1[:,1]-v1[:,0]*v2[:,1],determinant,out=np.full(len(t),-2.),where=valid)
            b=np.divide(v0[:,0]*v2[:,1]-v2[:,0]*v0[:,1],determinant,out=np.full(len(t),-2.),where=valid)
            inside=np.flatnonzero(valid&(a>=-1e-10)&(b>=-1e-10)&(a+b<=1+1e-10))
            if len(inside):
                j=inside[0];temps=values[indexes[candidate[j]]]
                result[i]=float((1-a[j]-b[j])*temps[0]+a[j]*temps[1]+b[j]*temps[2])
        if all(v is not None for v in result):break
    return result
