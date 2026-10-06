"""Produce research-page fields and explicit IEC external-coefficient evidence."""
from hashlib import sha256
from pathlib import Path
import json
from cablesim_sdk.simulation_artifacts import TemperatureField, LossExport
from .report import digest


def source(request, case, bundle_bytes):
    path = Path(__file__).resolve().parents[2]/'plugin.json'
    manifest = json.loads(path.read_text('utf-8'))
    return dict(run_id=request['run_id'], case_id=case['case_id'], plugin_id=manifest['id'],
                plugin_version=manifest['version'], capability=request['capability'],
                input_sha256=case.get('_source_input_sha256') or digest(case['input']), bundle_sha256=sha256(bundle_bytes).hexdigest(),
                manifest_sha256=sha256(path.read_bytes()).hexdigest())


def temperature_field(mesh, temperatures, source_info, *, time_s=0., samples=(), convergence=None):
    import numpy as np
    values = np.asarray(temperatures, dtype=float)
    if values.ndim != 1 or not np.isfinite(values).all():
        raise ValueError('temperature_k：求解器输出不是有限节点温度。')
    i = int(values.argmax())
    geometry = {k:mesh[k] for k in ('points','triangles','domain_ids','regions')}
    hotspot = dict(entity='field', point_m=mesh['points'][i], temperature_k=float(values[i]),
                   time_s=time_s, method='maximum-of-exported-nodes; not a continuous extremum proof')
    value = dict(schema_version='cablesim.temperature-field/1', source=source_info,
                 mesh={**geometry, 'sha256':digest(geometry),
                       'representation':mesh.get('discretization','linear triangular nodal field')},
                 temperature_k=values.tolist(), time_s=time_s, samples=list(samples), hotspot=hotspot,
                 convergence={'mesh_status':'not_assessed_single_mesh', **(convergence or {})})
    return TemperatureField.model_validate(value).model_dump(mode='json')


def loss_coefficients(problem, result, options, source_info):
    cfg = LossExport.model_validate(options)
    if result['solver']['name'] != 'getdp' or problem['physics'] != 'magnetic_harmonic':
        raise ValueError('外部损耗系数工件仅来自GetDP真实涡流运行。')
    states = {r['entity']:r for r in result['regions']}
    used = {u for b in cfg.bindings for u in b.conductor_regions+b.sheath_regions+b.armor_regions}
    if not used <= set(states) or not used <= set(cfg.material_temperatures_k):
        raise ValueError('loss_export：绑定区域或工作温度缺失。')
    # Bind the topology to the solved constraints; a descriptive name alone is insufficient.
    constraints = [{'regions':e['regions'],'kind':e['kind'],'connection':e.get('connection','parallel'),
                    'value':e['value']} for e in problem['excitations']]
    if cfg.topology.get('constraints') != constraints:
        raise ValueError('loss_export.topology.constraints：必须逐项匹配本次求解的电流、相角及互联约束。')
    integration=cfg.topology.get('longitudinal_integration')
    weights={uid:1. for uid in used}
    if integration is not None:
        length=integration.get('section_length_m')
        declared=integration.get('regional_length_weights',{})
        actual=problem.get('axial_lengths_m',{})
        if not isinstance(length,(int,float)) or length<=0 or set(actual)!=set(declared) or not used<=set(declared):
            raise ValueError('loss_export.topology.longitudinal_integration：分段长度与区域权重缺失。')
        if cfg.topology.get('electrical_networks')!=problem.get('electrical_networks',[]) or cfg.topology.get('axial_lengths_m')!=actual:
            raise ValueError('loss_export.topology：须逐项保留实际 GetDP 网络和轴向长度。')
        if any(abs(declared[uid]-actual[uid]/length)>1e-12 for uid in actual):
            raise ValueError('loss_export.topology.longitudinal_integration：权重须由真实小段长度除以总长得到。')
        weights={uid:declared[uid] for uid in used}
    magnetic = {r['entity']:r['magnetic_loss_w_m'] for r in result.get('magnetic_losses',[])}
    rows=[]
    for b in cfg.bindings:
        cores=[states[u] for u in b.conductor_regions]
        pc=sum(weights[r['entity']]*r['joule_loss_w_m'] for r in cores)
        dc=sum(weights[r['entity']]*r['current_rms_a']**2*r['dc_resistance_ohm_m'] for r in cores)
        if pc<=0 or dc<=0 or any(r['current_rms_a']<=1e-8 for r in cores):
            raise ValueError('loss_export.bindings：零导体电流/损耗不能定义损耗比。')
        if pc<dc:
            raise ValueError('loss_export.ac_extra_factor：交流损耗小于同一材料/面积的直流下界，需核验离散积分；未截断为零。')
        def power(regions):
            return sum(weights[u]*(states[u]['joule_loss_w_m']+magnetic.get(u,0.)) for u in regions)
        ps,pa=power(b.sheath_regions),power(b.armor_regions)
        rows.append(dict(entity=b.entity,conductor_regions=b.conductor_regions,
                         sheath_regions=b.sheath_regions,armor_regions=b.armor_regions,
                         conductor_loss_w_m=pc,sheath_loss_w_m=ps,armor_loss_w_m=pa,
                         lambda1=ps/pc,lambda2=pa/pc,ac_resistance_factor=pc/dc,ac_extra_factor=pc/dc-1,
                         conductor_dc_loss_w_m=dc,
                         ac_resistance_ohm_m=cores[0]['ac_resistance_ohm_m'] if len(cores)==1 else None,
                         dc_resistance_ohm_m=cores[0]['dc_resistance_ohm_m'] if len(cores)==1 else None))
    return dict(schema='cablesim.loss-coefficients/1',source=cfg.source,producer=source_info,unit='1',
                domain_input_sha256=cfg.source_domain_sha256,problem_sha256=digest(problem),
                coefficients={r['entity']:{k:r[k] for k in ('lambda1','lambda2','ac_extra_factor')} for r in rows},
                topology=cfg.topology,topology_sha256=digest(cfg.topology),frequency_hz=problem['frequency_hz'],
                material_temperatures_k=cfg.material_temperatures_k,rows=rows,
                validity={'kind':'fixed_operating_point','ampacity_iteration_allowed':False,
                          'reason':'未验证温度/电流范围；接收方不得直接用于变温载流量迭代。'},
                definitions={'lambda1':'total sheath loss / conductor Joule loss',
                             'lambda2':'total armor (Joule + magnetic) loss / conductor Joule loss',
                             'ac_extra_factor':'conductor Joule loss / sum(I_rms^2 Rdc) - 1'},
                provenance=cfg.source,engineering_approval=False)


def write(job,case_id,suffix,kind,value):
    raw=json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':'))
    if len(raw.encode('utf-8'))>16*1024*1024:
        raise ValueError('结果工件超过16 MiB上限，未截断数据。')
    path='output/'+case_id+'-'+suffix+'.json'
    (job/path).write_text(raw,'utf-8')
    return {'path':path,'type':kind}
