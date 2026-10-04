"""GetDP temperature tensor samples and independent cell-centre validation."""
from copy import deepcopy
from itertools import product
from pathlib import Path
import shutil

from backend.foundation.simulation_artifacts import LossExport
from .artifacts import loss_coefficients
from .getdp_adapter import solve
from .report import digest


KEYS = ('lambda1', 'lambda2', 'ac_extra_factor')


def validate_scope(problem, options):
    cfg = LossExport.model_validate(options)
    table = cfg.temperature_table
    if table is None:
        return
    conducting = {r['uid'] for r in problem['geometry'] if not r['void'] and r['material']['conductivity_s_m'] > 0}
    if conducting != set(table.resistivity_laws):
        raise ValueError('loss_export.temperature_table：每个导电域必须绑定温度轴和材料定律。')
    if any(e['kind'] == 'voltage_gradient_v_m' and any(e['value']) for e in problem['excitations']):
        raise ValueError('loss_export.temperature_table：仅支持电流激励与零电压互联，不能改变独立电压源的比例。')
    if any(b['kind'] == 'magnetic_potential' and b['value'] != 0 for b in problem['boundaries']):
        raise ValueError('loss_export.temperature_table：磁矢势边界须为零以保持共同电流倍率关系。')
    for uid, law in table.resistivity_laws.items():
        if abs(cfg.material_temperatures_k[uid]-law.reference_temperature_k) > 1e-8:
            raise ValueError('material_temperatures_k.'+uid+'：基础电导率必须对应材料定律参考温度。')


def produce(problem, mesh, options, source_info, work):
    validate_scope(problem, options)
    cfg = LossExport.model_validate(options)
    table = cfg.temperature_table
    axes = [a.model_dump(mode='json') for a in table.axes]
    nodes = [a.values_c for a in table.axes]
    rows, by_index, checks = [], {}, []
    root = Path(work)/'temperature-table'
    root.mkdir(parents=True, exist_ok=True)

    def sample(point, tag):
        p, m, opt = deepcopy(problem), deepcopy(mesh), cfg.model_dump(mode='json')
        opt['temperature_table'] = None
        temperatures = {uid: t+273.15 for axis, t in zip(axes, point) for uid in axis['regions']}
        for region in p['geometry']+m['regions']:
            uid = region['uid']
            if uid not in temperatures:
                continue
            law = table.resistivity_laws[uid]
            region['material']['conductivity_s_m'] /= 1+law.alpha_per_k*(temperatures[uid]-law.reference_temperature_k)
        opt['material_temperatures_k'] = temperatures
        folder = root/tag
        try:
            result = solve(p, m, folder)
            artifact = loss_coefficients(p, result, opt, source_info)
            return {'temperature_c': list(point), 'coefficients': artifact['coefficients'],
                    'problem_sha256': digest(p), 'execution': result['execution'],
                    'electrical_rows': artifact['rows'],
                    'current_rms_a': {b.entity: sum(r['current_rms_a'] for r in result['regions']
                                                  if r['entity'] in b.conductor_regions) for b in cfg.bindings},
                    'solver_log': (folder/'solver.log').read_text('utf-8', errors='replace')}
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    for index in product(*(range(len(n)) for n in nodes)):
        row = sample([nodes[d][i] for d, i in enumerate(index)], 'node-'+'-'.join(map(str,index)))
        row['index'] = list(index)
        rows.append(row)
        by_index[index] = row['coefficients']
    errors = {b.entity: {k: 0. for k in KEYS} for b in cfg.bindings}
    for lower in product(*(range(len(n)-1) for n in nodes)):
        point = [(nodes[d][i]+nodes[d][i+1])/2 for d, i in enumerate(lower)]
        check = sample(point, 'check-'+'-'.join(map(str,lower)))
        corners = [by_index[tuple(i+b for i,b in zip(lower,bits))]
                   for bits in product((0,1), repeat=len(nodes))]
        check['interpolated'] = {e: {k: sum(c[e][k] for c in corners)/len(corners) for k in KEYS} for e in errors}
        check['absolute_errors'] = {e: {k: abs(check['coefficients'][e][k]-check['interpolated'][e][k]) for k in KEYS} for e in errors}
        for e in errors:
            for k in KEYS:
                errors[e][k] = max(errors[e][k], check['absolute_errors'][e][k])
        checks.append(check)
    maximum = max(v for e in errors.values() for v in e.values())
    if maximum > table.maximum_validation_absolute_error:
        raise ValueError(f'loss_export.temperature_table：独立中心点插值误差{maximum:.6g}超过容差；请细化温度节点。')
    current_refs = rows[0]['current_rms_a']
    if any(any(abs(row['current_rms_a'][e]-v)>1e-6*max(v,1) for e,v in current_refs.items()) for row in rows+checks):
        raise ValueError('loss_export.bindings：导体绑定电流随材料温度改变，不能用共同电流倍率消费。')
    dc_reference = {}
    for binding in cfg.bindings:
        if len(binding.conductor_regions) != 1:
            raise ValueError('temperature_table.bindings：变温IEC接口要求每个电缆仅一个明确实心导体域。')
        uid=binding.conductor_regions[0];law=table.resistivity_laws[uid]
        row=next(r for r in rows[0]['electrical_rows'] if r['entity']==binding.entity)
        axis=next(i for i,a in enumerate(axes) if uid in a['regions'])
        reference_r=row['dc_resistance_ohm_m']/(1+law.alpha_per_k*(rows[0]['temperature_c'][axis]+273.15-law.reference_temperature_k))
        factor20=1+law.alpha_per_k*(293.15-law.reference_temperature_k)
        if factor20<=0:
            raise ValueError('resistivity_laws：20°C参考电阻非正。')
        dc_reference[binding.entity]={'r20_ohm_m':reference_r*factor20,'alpha20_per_k':law.alpha_per_k/factor20}
    return {'axes': axes, 'rows': rows, 'validation_points': checks, 'dc_reference':dc_reference,
            'interpolation': 'multilinear', 'extrapolation': 'forbidden',
            'reference_current_a': current_refs, 'current_scale_range': list(table.current_scale_range),
            'resistivity_laws': {u:l.model_dump(mode='json') for u,l in table.resistivity_laws.items()},
            'error': {'kind':'measured_cell_centres_not_global_bound', 'maximum_absolute_by_entity':errors,
                      'acceptance_absolute':table.maximum_validation_absolute_error,
                      'maximum_absolute':maximum, 'validation_point_count':len(checks)},
            'assumptions':['Linear magnetic materials; fixed frequency, geometry, phase angles and current ratios.',
                           'Each bound metal region has its own axis temperature; no temperature extrapolation.',
                           'Cell-centre errors are measured checks, not a rigorous global error bound.']}
