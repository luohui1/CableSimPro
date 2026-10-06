"""Assess immutable temperature-field evidence; no solver or plugin selection."""
from copy import deepcopy
from math import isfinite, isclose


def temperature_convergence(run):
    spec = run['snapshot'].get('automatic_convergence') or run['snapshot']['definition'].get('verification')
    result = {'status': 'unconverged', 'reason': '未做至少三档网格和计算域加倍核验。',
              'rows': [], 'tolerance_k': 0.1, 'reference_case_id': None}
    if not spec:
        return result
    domain_id = spec.get('domain_case_id')
    ids = spec['mesh_case_ids'] + ([domain_id] if domain_id else [])
    mesh_count = len(spec['mesh_case_ids'])
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
            parameters = original['parameters']
            control_key = 'controls' if 'controls' in parameters else 'mesh'
            controls = parameters[control_key]
            mesh_key = 'mesh_size_m' if control_key == 'controls' else 'size_m'
            bounds_key = 'domain_options' if 'domain_options' in parameters else 'electromagnetic_options'
            mesh = controls[mesh_key]
            domain = parameters[bounds_key]['bounds_m']
            peak = field['hotspot']['temperature_k']
            if spec.get('peak_basis') == 'whole_history' or run['snapshot']['definition'].get('task') == 'transient-temperature':
                history = case['artifacts']['x-cablesim.temperature-history']
                if run['artifact_status'][cid]['x-cablesim.temperature-history']['status'] != 'verified':
                    raise ValueError('暂态温度曲线工件未通过完整性检查：'+cid)
                peak = max(c['peak_temperature_k'] for c in history['curves'])
            if not all(isfinite(v) for v in [mesh, peak, *(domain or [])]) or mesh <= 0:
                raise ValueError('网格、域或热点数值无效。')
            meshes.append(mesh); bounds.append(domain); peaks.append(peak)
            ignored = masks if control_key == 'controls' else {'size_m','far_size_m','max_nodes','minimum_circle_segments'}
            parameters[control_key] = {k:v for k,v in controls.items() if k not in ignored}
            parameters[bounds_key].pop('bounds_m')
            original.pop('case_id')
            signatures.append(original)
            reference = peaks[-2] if index and index < len(ids)-1 else peaks[-2] if index else None
            result['rows'].append({'case_id':cid, 'kind':'domain' if cid==domain_id else 'mesh',
                                   'mesh_size_m':mesh, 'bounds_m':domain, 'nodes':len(field['mesh']['points']),
                                   'hotspot_k':peak, 'change_k':None if reference is None else abs(peak-reference)})
        if any(v != signatures[0] for v in signatures[1:]):
            raise ValueError('核验工况改变了材料、负荷、边界或热源；不能作为同模型收敛证据。')
        if any(b != bounds[0] for b in bounds[:mesh_count]):
            raise ValueError('三档网格必须使用同一计算域。')
        if mesh_count < 3 or any(a <= b for a,b in zip(meshes[:mesh_count-1],meshes[1:mesh_count])) or (domain_id and meshes[-1] != meshes[mesh_count-1]):
            raise ValueError('网格须由粗到细；域加倍工况须保持最细网格。')
        a,b = bounds[-2:]
        if domain_id and not (isclose(b[2]-b[0],2*(a[2]-a[0]),rel_tol=1e-9) and isclose(b[3]-b[1],2*(a[3]-a[1]),rel_tol=1e-9)
                and isclose(b[0]+b[2],a[0]+a[2],abs_tol=1e-9) and b[3]==a[3]):
            raise ValueError('计算域须水平居中、地表不动，宽度及深度均加倍。')
        tolerance=spec['tolerance_k']
        if not domain_id and (spec.get('domain_policy') != 'physical_boundary' or any(b is not None for b in bounds)):
            raise ValueError('有限外部域缺少计算域加倍核验。')
        result.update(tolerance_k=tolerance,reference_case_id=ids[mesh_count-1],peak_basis=spec.get('peak_basis','steady_hotspot'),domain_policy=spec.get('domain_policy','double_exterior'))
        grid_delta=abs(peaks[mesh_count-1]-peaks[mesh_count-2]); domain_delta=abs(peaks[-1]-peaks[mesh_count-1]) if domain_id else None
        grid_changes=[abs(a-b) for a,b in zip(peaks[:mesh_count-1],peaks[1:mesh_count])]
        passed = all(change < tolerance for change in grid_changes[-2:]) and (domain_delta is None or domain_delta < tolerance)
        result.update(status='converged' if passed else 'unconverged',
                      grid_change_k=grid_delta,adjacent_grid_changes_k=grid_changes,domain_change_k=domain_delta,
                      reason=('最细相邻网格变化小于阈值；边界是物理边界。' if not domain_id else '最细相邻网格和加倍域热点变化均小于阈值。') if passed else '网格或加倍域热点变化未小于阈值；继续细化或扩大基准域后重算。')
    except (KeyError,TypeError,ValueError,IndexError) as exc:
        result['reason']=str(exc)
        seen={r['case_id'] for r in result['rows']}
        for cid in ids:
            if cid in seen:continue
            original=source.get(cid,{})
            parameters=original.get('parameters',{});controls=parameters.get('mesh',parameters.get('controls',{}))
            result['rows'].append({'case_id':cid,'kind':'domain' if cid==domain_id else 'mesh',
                'mesh_size_m':controls.get('size_m',controls.get('mesh_size_m')),
                'bounds_m':parameters.get('domain_options',parameters.get('electromagnetic_options',{})).get('bounds_m'),
                'nodes':None,'hotspot_k':None,'change_k':None,'status':output.get(cid,{}).get('status','missing'),
                'error':output.get(cid,{}).get('error')})
    return result


def has_temperature_field(run):
    return run['snapshot'].get('module')=='thermal-field' or bool(run['snapshot']['definition'].get('verification')) or any(
        'x-cablesim.temperature-field' in c.get('artifacts',{}) and not (
            c['artifacts']['x-cablesim.temperature-field'].get('source',{}).get('binding')=='iec-trace'
            and run.get('artifact_status',{}).get(c['case_id'],{}).get('x-cablesim.temperature-field',{}).get('status')=='verified')
        for c in (run.get('output') or {}).get('cases',[]))
