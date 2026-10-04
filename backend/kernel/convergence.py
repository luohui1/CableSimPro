"""Assess immutable temperature-field evidence; no solver or plugin selection."""
from copy import deepcopy
from math import isfinite, isclose


def temperature_convergence(run):
    spec = run['snapshot']['definition'].get('verification')
    result = {'status': 'unconverged', 'reason': '未做至少三档网格和计算域加倍核验。',
              'rows': [], 'tolerance_k': 0.1, 'reference_case_id': None}
    if not spec:
        return result
    ids = spec['mesh_case_ids'] + [spec['domain_case_id']]
    source = {c['case_id']: c for c in run['snapshot']['cases']}
    output = {c['case_id']: c for c in (run.get('output') or {}).get('cases', [])}
    masks = {'mesh_size_m', 'far_mesh_size_m', 'max_nodes'}
    signatures, meshes, bounds, peaks = [], [], [], []
    try:
        for index, cid in enumerate(ids):
            case, original = output[cid], deepcopy(source[cid])
            if case['status'] != 'succeeded' or run.get('artifact_status', {}).get(cid, {}).get('x-cablesim.temperature-field', {}).get('status') != 'verified':
                raise ValueError('核验工况失败或温度场工件未通过完整性检查：'+cid)
            field = case['artifacts']['x-cablesim.temperature-field']
            controls = original['parameters']['controls']
            mesh = controls['mesh_size_m']
            domain = original['parameters']['domain_options']['bounds_m']
            peak = field['hotspot']['temperature_k']
            if not all(isfinite(v) for v in [mesh, peak, *domain]) or mesh <= 0:
                raise ValueError('网格、域或热点数值无效。')
            meshes.append(mesh); bounds.append(domain); peaks.append(peak)
            original['parameters']['controls'] = {k:v for k,v in controls.items() if k not in masks}
            original['parameters']['domain_options'].pop('bounds_m')
            original.pop('case_id')
            signatures.append(original)
            reference = peaks[-2] if index and index < len(ids)-1 else peaks[-2] if index else None
            result['rows'].append({'case_id':cid, 'kind':'domain' if index==len(ids)-1 else 'mesh',
                                   'mesh_size_m':mesh, 'bounds_m':domain, 'nodes':len(field['mesh']['points']),
                                   'hotspot_k':peak, 'change_k':None if reference is None else abs(peak-reference)})
        if any(v != signatures[0] for v in signatures[1:]):
            raise ValueError('核验工况改变了材料、负荷、边界或热源；不能作为同模型收敛证据。')
        if any(b != bounds[0] for b in bounds[:-1]):
            raise ValueError('三档网格必须使用同一计算域。')
        if any(a <= b for a,b in zip(meshes[:-2],meshes[1:-1])) or meshes[-1] != meshes[-2]:
            raise ValueError('网格须由粗到细；域加倍工况须保持最细网格。')
        a,b = bounds[-2:]
        if not (isclose(b[2]-b[0],2*(a[2]-a[0]),rel_tol=1e-9) and isclose(b[3]-b[1],2*(a[3]-a[1]),rel_tol=1e-9)
                and isclose(b[0]+b[2],a[0]+a[2],abs_tol=1e-9) and b[3]==a[3]):
            raise ValueError('计算域须水平居中、地表不动，宽度及深度均加倍。')
        tolerance=spec['tolerance_k']
        result.update(tolerance_k=tolerance,reference_case_id=ids[-2])
        grid_delta=abs(peaks[-2]-peaks[-3]); domain_delta=abs(peaks[-1]-peaks[-2])
        passed = grid_delta < tolerance and domain_delta < tolerance
        result.update(status='converged' if passed else 'unconverged',
                      grid_change_k=grid_delta,domain_change_k=domain_delta,
                      reason='最细相邻网格和加倍域热点变化均小于阈值。' if passed else '网格或加倍域热点变化未小于阈值；继续细化或扩大基准域后重算。')
    except (KeyError,TypeError,ValueError,IndexError) as exc:
        result['reason']=str(exc)
    return result


def has_temperature_field(run):
    return run['snapshot'].get('module')=='thermal-field' or bool(run['snapshot']['definition'].get('verification')) or any('x-cablesim.temperature-field' in c.get('artifacts',{}) for c in (run.get('output') or {}).get('cases',[]))
