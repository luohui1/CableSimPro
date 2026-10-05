"""Research-native IEC versus converged FEM, independent of ML feature limits."""
from copy import deepcopy
from cablesim_sdk.domain import DomainDocument
from cablesim_sdk.iec_fem import ComparisonParameters as Options, ComparisonArtifact
from cablesim_sdk.validation import FieldValueError
from .thermal_input import prepare as prepare_thermal, Controls
from .report import digest


def prepare(value, parameters):
    from cablesim_iec60287.domain import prepare as prepare_iec
    from cablesim_iec60287.group import rate_group
    p = Options.model_validate(parameters)
    for key in ('external_loss_artifact','external_loss_reference'):
        if key in p.iec:
            raise FieldValueError('比较参数暂不接受嵌套工件正文或引用；请填写有来源的 per_cable_losses，不能自行声明宿主已校验来源。','parameters','iec',key)
    controls = Controls.model_validate(p.controls)
    if controls.operation != 'ampacity':
        raise FieldValueError('请选择 ampacity 并指定 rated_circuit。','parameters','controls','operation')
    original = DomainDocument.model_validate(value).model_dump(mode='json')
    document = deepcopy(original)
    for key,uid in [('sections',p.section_id),('load_cases',p.load_id)]:
        document[key] = [r for r in original[key] if r['id'] == uid]
        if len(document[key]) != 1:
            raise FieldValueError('请选择已保存的截面和负荷。','parameters', 'section_id' if key == 'sections' else 'load_id')
    section = document['sections'][0]
    placed = {r['cable'] for r in section['placements']}
    document['circuits'] = [c for c in original['circuits'] if any(r['id'] in placed for r in c['cables'])]
    if any(r['id'] not in placed for c in document['circuits'] for r in c['cables']):
        raise FieldValueError('所选截面需包含被比较回路的全部电缆。','sections',original['sections'].index(section),'placements')
    if controls.rated_circuit not in {c['id'] for c in document['circuits']}:
        raise FieldValueError('请选择所选截面中实际存在的回路。','parameters','controls','rated_circuit')
    if p.iec.get('operation') == 'temperature' or p.iec.get('reference_basis','iec2023') != 'iec2023':
        raise FieldValueError('比较须采用 IEC 2023 允许电流口径。','parameters','iec')
    uniform = deepcopy(document)
    layered = bool(section['soil_layers'])
    if layered and not p.uniform_soil_counterfactual_acknowledged:
        raise FieldValueError('分层土壤的 IEC 列仅为均匀土壤对照；请明确确认此对照口径。','parameters','uniform_soil_counterfactual_acknowledged')
    uniform['sections'][0]['soil_layers'] = []
    prepared = prepare_iec(uniform,p.iec)
    trace = rate_group(prepared)
    rating = next(r for r in trace['circuit_ratings'] if r['entity'] == controls.rated_circuit)
    if rating['ampacity_a'] is None:
        raise FieldValueError(rating['error']['message'],'parameters','controls','rated_circuit')
    states = {s['entity']:s for s in rating['cable_states']}
    per_cable,duct_air = {},{}
    if p.feedback:
        from .constitutive_losses import validate
        validate(document,p.feedback.source)
    for cable in prepared.cables:
        uid = cable['id']; state = states[uid]
        # Supplied coefficients are exact inputs; do not recover zero from the
        # ratio of two temperatures at opposite sides of IEC's final iteration.
        if cable['factors'] is not None:
            ac_extra=cable['factors']['ac_extra_factor']
        else:
            from cablesim_iec60287.group import _resistance
            spacing=next(c['spacing'] for c in prepared.circuits if c['id']==cable['circuit'])
            conductor=cable['rating'].conductor
            dc=conductor.r20_ohm_m*(1+conductor.alpha20_per_k*(state['conductor_temperature_c']-20))
            ac_extra=_resistance(cable,state['conductor_temperature_c'],spacing)/dc-1
        circuit = next(c for c in document['circuits'] if c['id'] == cable['circuit'])
        ct = next(t for t in document['cable_types'] if t['id'] == circuit['cable_type'])
        layers = ct['cores'][0]['layers']+ct['common_layers']
        ids = [uid+'/conductor']+[uid+'/layer-'+str(i) for i in range(len(layers))]
        heat = dict.fromkeys(ids,0.)
        heat[ids[1]] = heat[ids[3]] = state['dielectric_loss_w_m']/2
        screen = ids[1+next(i for i,l in enumerate(layers) if l['role'] == 'metallic_sheath')]
        per_cable[uid] = {'electrical':{'ac_extra_factor':ac_extra,
            'sheath_loss_factor':state['lambda1'],'sheath_layer_uid':screen,
            'source':'IEC rated-point coefficients; trace_sha256='+digest(trace)},
            'fixed_layer_heat_w_m':heat,'prescribed_core_temperature_k':None,'equivalent_layers_acknowledged':False}
        if cable['duct']:
            duct_air[cable['duct']['id']] = {'resistance_k_m_w':state['t4_air_gap_k_m_w'],
                'source':'IEC 60287-2-1:2023 4.2.6.1; rated-point frozen; '+digest(trace)}
            if p.feedback:
                law = cable['rating'].installation.duct
                duct_air[cable['duct']['id']]['air_law'] = {
                    'u':law.u,'v':law.v,'y_per_k':law.y_per_k,
                    'minimum_temperature_k':273.15,'maximum_temperature_k':423.15,
                    'source':'IEC 60287-2-1:2023 4.2.6.1 and Table 2; '+p.feedback.source}
                duct_air[cable['duct']['id']]['source'] = 'IEC initial seed only; air law updated at FEM interface temperatures'
    ambient = section['medium']['surface_temperature']
    bc = {'kind':'temperature','temperature_k':ambient,'h_w_m2_k':None,'emissivity':None}
    thermal = {'controls':p.controls,'domain_options':{'section_id':p.section_id,'load_id':p.load_id,
        'bounds_m':list(p.bounds_m),'boundaries':{k:deepcopy(bc) for k in ('top','bottom','left','right')},
        'per_cable':per_cable,'duct_air':duct_air,'source':p.source}}
    prepare_thermal(document,thermal)
    checks = [{'assumption':'homogeneous_soil','satisfied':not layered,'path':'/sections/'+str(original['sections'].index(section))+'/soil_layers',
        'reason':'已保存分层；IEC 对照只使用 medium.material 的均匀土壤，不能当作分层标准解。' if layered else '所选截面为均匀土壤。'},
        {'assumption':'rectangular_backfill_equivalence','satisfied':section['backfill'] is None,
         'reason':'IEC 使用矩形回填等效修正；FEM 解析实际矩形与分层相交区域。' if section['backfill'] else '未设置回填。'},
        {'assumption':'resolved_duct_air_flow','satisfied':not bool(section['enclosures']),
         'reason':('管内空气按 IEC 经验式随两侧表面平均温度更新；未求空气流动。' if p.feedback else '管内空气按 IEC 额定点热阻冻结；本次未求空气流动。') if section['enclosures'] else '未设置排管。'}]
    return p,document,thermal,trace,rating,uniform,checks


def differences(a,b):
    temperature = max(abs(x['conductor_max_temperature_k']-y['conductor_max_temperature_k'])
        for condition in ('operating','rating') for x,y in zip(a[condition]['cables'],b[condition]['cables']))
    return {'maximum_temperature_change_k':temperature,
            'ampacity_change_a':abs(a['rating']['rating']['ampacity_a']-b['rating']['rating']['ampacity_a'])}


def calculate(prepared,work=None,*,_intervention=None):
    from .thermal import ThermalSystem
    p,document,thermal,iec,rating,uniform,checks = prepared
    if _intervention is not None:
        document,thermal = deepcopy(document),deepcopy(thermal)
        if not _intervention&1:
            document['sections'][0]['soil_layers'] = []
        if not _intervention&2:
            for air in thermal['domain_options']['duct_air'].values():
                air.pop('air_law',None)
    levels = []
    for kind,scale in [('mesh',s) for s in p.mesh_scales]+[('domain',p.mesh_scales[-1])]:
        parameters = deepcopy(thermal)
        controls = parameters['controls']
        controls['mesh_size_m'] *= scale; controls['far_mesh_size_m'] *= scale
        if controls.get('near_soil_mesh_size_m') is not None:controls['near_soil_mesh_size_m'] *= scale
        controls['current_maximum_a'] = controls.get('current_maximum_a') or controls['current_upper_a']
        controls['current_upper_a'] = min(controls['current_upper_a'],1.25*rating['ampacity_a'])
        if kind == 'domain':
            x0,z0,x1,z1 = p.bounds_m; center = (x0+x1)/2
            parameters['domain_options']['bounds_m'] = [center+(x0-center)*p.domain_scale,z0*p.domain_scale,
                center+(x1-center)*p.domain_scale,z1]
        model,cfg = prepare_thermal(document,parameters)
        system = ThermalSystem(model,cfg)
        native = None
        if p.feedback and (_intervention is None or _intervention&4):
            if work is None:
                raise ValueError('反馈比较需要受控的原生求解工作目录。')
            from pathlib import Path
            from .constitutive_losses import NativeLossFeedback
            from cablesim_iec60287.domain import prepare as prepare_iec
            native = NativeLossFeedback(system,document,prepare_iec(uniform,p.iec),p.feedback.source,
                                       Path(work)/f'level-{len(levels)}')
            system.loss_evaluator = native
        operating = system.state([c.current_a for c in model.cables]);operating.pop('temperature_k')
        rated,field = system.solve()
        levels.append({'kind':kind,'mesh_scale':scale,'bounds_m':parameters['domain_options']['bounds_m'],
            'nodes':len(field['points']),'elements':len(field['triangles']),
            'mesh_sha256':digest({k:field[k] for k in ('points','triangles','domain_ids')}),
            'operating':operating,'rating':rated,
            **({'native_loss_history':[{k:v for k,v in row.items() if k not in ('solver_log','electrical_rows','current_constraint_errors')}
                for row in native.history],
                'last_native_loss_state':native.history[-1]} if native else {})})
    mesh = differences(levels[-3],levels[-2]); domain = differences(levels[-2],levels[-1])
    def passed(delta):
        return delta['maximum_temperature_change_k'] <= p.temperature_tolerance_k and delta['ampacity_change_a'] <= p.ampacity_tolerance_a
    convergence = {'solver_status':'converged','mesh_status':'converged' if passed(mesh) else 'nonconverged',
        'domain_status':'converged' if passed(domain) else 'nonconverged','mesh':mesh,'domain':domain,
        'temperature_tolerance_k':p.temperature_tolerance_k,'ampacity_tolerance_a':p.ampacity_tolerance_a,
        'energy_relative_residual':max(level[k]['energy_relative_residual'] for level in levels for k in ('operating','rating'))}
    last = levels[-1]; valid = passed(mesh) and passed(domain)
    rated_id = p.controls['rated_circuit']
    iec_result = {'status':'available','ampacity_a':rating['ampacity_a'],
        'operating_temperature_k':max(s['conductor_temperature_c'] for s in iec['operating']['cable_states'] if s['circuit']==rated_id)+273.15,
        'basis':'uniform_soil_counterfactual' if document['sections'][0]['soil_layers'] else 'iec_saved_condition'}
    fem = {'status':'unavailable','ampacity_a':None,'operating_temperature_k':None,'basis':'saved_geometry_frozen_iec_coefficients'}
    if p.feedback:
        fem['basis'] = 'saved_geometry_native_losses_temperature_dependent_duct_air'
    gap = None; judgment = 'unavailable'; conclusion = '网格或计算域尚未收敛；请细化网格或扩大计算域，暂不发布偏差结论。'
    if valid:
        amp = last['rating']['rating']['ampacity_a']
        fem.update(status='available',ampacity_a=amp,operating_temperature_k=max(s['conductor_max_temperature_k'] for s in last['operating']['cables'] if s['circuit']==rated_id))
        gap = 100*(rating['ampacity_a']/amp-1)
        uncertainty = 2*(mesh['ampacity_change_a']+domain['ampacity_change_a']+p.controls['current_tolerance_a'])
        judgment = 'within_numerical_tolerance' if abs(rating['ampacity_a']-amp)<=uncertainty else 'nonconservative' if gap>0 else 'conservative'
        qualifier = '均匀土壤 IEC 对照' if document['sections'][0]['soil_layers'] else 'IEC'
        conclusion = f'在声明的损耗与管内热阻口径下，{qualifier}相对收敛 FEM '+('差异处于数值容差内。' if judgment=='within_numerical_tolerance' else ('偏危险（高估允许电流）' if gap>0 else '偏保守（低估允许电流）')+f'{abs(gap):.2f}%。')
    result = {'schema_version':'cablesim.iec-fem-comparison/1','parameters_sha256':digest(p.model_dump(mode='json')),
        'section_id':p.section_id,'load_id':p.load_id,'rated_circuit':rated_id,'valid':valid,
        'iec':iec_result,'fem':fem,'iec_over_fem_percent':gap,'judgment':judgment,'conclusion':conclusion,
        'assumption_checks':checks,'convergence':convergence,
        'clauses':['IEC 60287-1-1:2023 4.2.1, 5.1, 5.2, 5.3','IEC 60287-2-1:2023 4.2.3.3.2, 4.2.6, 4.2.7'],
        'limitations':['二维无限长单芯同心光滑护套热场；导体采用 R(T)，AC/护套系数冻结在 IEC 额定点。',
            '管内空气冻结为 IEC 额定点等效热阻；介质热源分置绝缘两侧。偏差包含该口径影响，非仅土层因果贡献。',
            '多回路电损耗必须有独立来源；各回路单独反求，其余回路保持保存负荷，各上限不可同时使用。',
            'reference_only；未完成工程审批。']}
    if p.feedback:
        result['limitations'] = [
            '二维无限长非磁性同心结构；普通圆导体按保存R20匹配连续导电率，不覆盖分割/绝缘单丝/丝带护套。',
            'GetDP按保存相序和接地求各区域损耗；区域平均温度更新电阻率，区域总热源守恒回传热场。',
            '管内采用IEC经验热阻的同心环导热等效；不计算自然对流速度场。',
            'IEC列仍为原均匀土壤、声明损耗口径的对照；不能将更新后的差值全部归因为土层。',
            '逐回路反求，其余回路保持保存负荷；reference_only，未完成工程审批。']
    bundle = {'prepared_input':{'document':document,'parameters':p.model_dump(mode='json')},
        'iec_input':uniform,'iec_trace':iec,'mesh_history':levels,'convergence':convergence,
        'field_evidence':{'sha256':digest(field),'nodes':len(field['points']),'display_triangles':len(field['triangles']),
            'representation':field.get('discretization'),'export':'quantities_and_mesh_identity_only'},
        'authority':'reference_only','engineering_approval':False}
    if _intervention is not None:
        bundle['intervention'] = {'mask':_intervention,'soil_layers':bool(_intervention&1),
            'temperature_dependent_duct_air':bool(_intervention&2),'native_electromagnetic_losses':bool(_intervention&4)}
        result['fem']['basis'] = 'declared_counterfactual_'+str(_intervention)
    elif p.feedback:
        from pathlib import Path
        from .iec_attribution import shapley
        counterfactuals = {7:(result,bundle)}
        for mask in range(7):
            counterfactuals[mask] = calculate(prepared,Path(work)/f'counterfactual-{mask}',_intervention=mask)
        if all(r['valid'] for r,_ in counterfactuals.values()):
            attribution = shapley({mask:r['fem']['ampacity_a'] for mask,(r,_) in counterfactuals.items()},rating['ampacity_a'])
            for row in attribution['counterfactuals']:
                counter = counterfactuals[row['mask']][0]
                row.update(valid=True,convergence=counter['convergence'])
            attribution['status'] = 'available'
            dominant = next(r['label'] for r in attribution['contributions'] if r['key']==attribution['dominant_physical_factor'])
            result['conclusion'] += f' 三因素反事实分解中，绝对贡献最大的是{dominant}；均匀基线残差单独保留。'
        else:
            attribution = {'status':'unavailable','reason':'部分反事实网格或计算域未收敛，未分配物理贡献。',
                'failed_masks':[mask for mask,(r,_) in counterfactuals.items() if not r['valid']]}
        result['decomposition'] = attribution
        # Do not create a self-referencing bundle for mask 7.
        bundle['counterfactual_evidence'] = {str(mask):{'result':r,'bundle':b} for mask,(r,b) in counterfactuals.items() if mask != 7}
    return result,bundle


def host_case(request,case,job):
    from .artifacts import write,source
    prepared = prepare(case['input'],case.get('parameters',{}))
    if request['phase'] == 'check':
        return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[]}
    result,bundle = calculate(prepared,job/'output'/('feedback-'+case['case_id']))
    raw = write(job,case['case_id'],'comparison-raw','x-cablesim.simulation-bundle',bundle)
    result['source'] = source(request,case,(job/raw['path']).read_bytes())
    result = ComparisonArtifact.model_validate(result).model_dump(mode='json')
    artifact = write(job,case['case_id'],'iec-fem','x-cablesim.iec-fem-comparison',result)
    quantity = {'key':'ampacity','type':'quantity','entity':result['rated_circuit'],'unit':'A',
        'status':'available' if result['valid'] else 'unavailable'}
    quantity.update({'value':result['fem']['ampacity_a']} if result['valid'] else {'reason':{'code':'COMPARISON_NOT_CONVERGED','message':result['conclusion']}})
    return {'case_id':case['case_id'],'status':'succeeded','results':[quantity],'artifacts':[raw,artifact],
        'evidence':{'input_sha256':digest(case['input']),'parameters_sha256':result['parameters_sha256']},
        'warnings':[{'code':'REFERENCE_ONLY','message':'; '.join(result['limitations'])}]}
