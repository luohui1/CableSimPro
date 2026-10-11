"""Bounded XLPE design suggestions; table values never become measured facts."""
def propose(values, insulation_limit, sources, data, parameters=None):
    from cablesim_standard_check.annex import evidence, DiameterChain, decimal
    from cablesim_sdk.type_design import CableDesignRequest
    values = CableDesignRequest.model_validate(values).model_dump(exclude_none=True)
    u0, u = map(int, values['voltage'].split('/'))
    family = next((family for a, b, family in data['voltage_families'] if (a, b) == (u0, u)), None)
    area = values['area_m2'] * 1e6
    if family is None:
        raise ValueError('/voltage：表外电压，未覆盖。')
    if family == 'hv' and values['construction'] != 'single_core':
        raise ValueError('/construction：GB/T 11017 高压三芯结构未覆盖。请选择单芯或其他电压。')
    standard = 'GB/T 11017.2' if family == 'hv' else 'GB/T 12706.' + {'mv1':'1','mv2':'2','mv3':'3'}[family]
    edition = '2024' if family == 'hv' else '2020'
    queries = {'insulation': {'schema_version':'cablesim.standards-query/1', 'standard':standard, 'edition':edition,
        'locator':'表 2' if family == 'hv' else '表 6' if family == 'mv3' else '表 7',
        'quantity':'insulation_nominal', 'conditions':{'area_m2':values['area_m2'],'u0_v':u0,'u_v':u,
            **({} if family == 'hv' else {'insulation':'XLPE'})}}}
    n = 1 if values['construction'] == 'single_core' else 3 if values['construction'] == 'three_core' else 4
    if n == 4 and family != 'mv1':
        raise ValueError('/construction：当前四芯标准提案仅覆盖 GB/T 12706.1 的低压 XLPE 圆形线芯。')
    if values['construction'] == 'three_plus_one':
        from copy import deepcopy
        queries['neutral_insulation'] = deepcopy(queries['insulation'])
        queries['neutral_insulation']['conditions']['area_m2'] = values['neutral_area_m2']
    if values.get('generation_mode') == 'complete':
        if family == 'hv':
            raise ValueError('/generation_mode：110 kV 不适用 GB/T 12706 附录 A/B；完整高压结构生成尚未覆盖。')
        for key, locator, quantity, conditions in (
            ('conductor','表 A.1','conductor_fictitious_diameter',{'area_m2':values['area_m2']}),
            ('rounding','B.1','fictitious_rounding',{}),
            ('core','A.2.2','core_fictitious_parameters',{}),
            ('bundle','A.2.3','bundle_factor',{'core_count':n}),
        ):
            queries[key]={'schema_version':'cablesim.standards-query/1','standard':standard,'edition':edition,
                          'locator':locator,'quantity':quantity,'conditions':conditions}
    if not parameters or 'basis_references' not in parameters:
        return {'schema':'cablesim.cable-design-proposal/1','status':'basis_required',
                'basis_queries':queries,'rows':[],'limitations':['待固定标准依据查询完成后提出尺寸，不批准或创建型号。']}
    refs = parameters['basis_references']
    insulation = refs.get('insulation')
    if not insulation:
        raise ValueError('/area_m2：所选标准版本、额定电压和截面的 XLPE 厚度本库暂未收录，不生成近似值。')
    record = evidence(insulation, queries['insulation'])
    if record['criterion'] != 'nominal' or record['quantity']['unit'] != 'mm':
        raise ValueError('/basis_references：绝缘依据必须为毫米标称厚度，不能用最薄点或参考值代替。')
    thickness = float(decimal(record['value']))
    neutral_thickness = thickness
    if values['construction'] == 'three_plus_one':
        neutral_record = evidence(refs.get('neutral_insulation'), queries['neutral_insulation'])
        if neutral_record['criterion'] != 'nominal' or neutral_record['quantity']['unit'] != 'mm':
            raise ValueError('/neutral_area_m2：中性线绝缘依据须为毫米标称厚度。')
        neutral_thickness = float(decimal(neutral_record['value']))
    if values.get('generation_mode') == 'complete':
        names = {'conductor':'导体假设直径','rounding':'数值修约','core':'绝缘线芯假设直径','bundle':'成缆系数'}
        missing = [f'{standard}—{edition} {query["locator"]}（{names.get(key,"绝缘厚度")}）' for key,query in queries.items() if not refs.get(key)]
        if missing:
            raise ValueError('/generation_mode：完整护层生成缺少已核验的计算依据：'+'；'.join(missing)+'。可选择仅生成绝缘线芯草稿；本库补齐参数与页码后才能计算护层。')
        rounding, conductor, core_rule, bundle_rule = [evidence(refs[key],queries[key]) for key in ('rounding','conductor','core','bundle')]
        chain = DiameterChain(rounding)
        diameter = chain.bundle(chain.core(chain.conductor(conductor),decimal(thickness),core_rule),bundle_rule)
        # Never substitute the fictitious chain for physical material geometry.
        raise ValueError('/generation_mode：缆芯假设直径已可计算，但屏蔽构造、内衬与铠装直径增量和制造尺寸仍缺项；不能以假设直径 '+str(diameter)+' mm 建实体护层。')
    reference = {**insulation,
                 'clause':record['table'] or record['clause'], 'citation':record['citation']}
    conductor = {'material': 'material/conductor', 'form': 'unspecified', 'nominal_area': values['area_m2'],
                 'diameter': None, 'r20': None, 'conductor_class': None, 'lay_factor': None}
    document = {'schema_version': 'cablesim.type-draft/2' if n == 4 else 'cablesim.type-draft/1', 'name': '标准结构草稿',
        'materials': [{'id': 'material/conductor', 'label': '铜' if values['conductor'] == 'copper_bare' else '铝',
                       'category': 'conductor', 'standard_kind': values['conductor']},
                      {'id': 'material/insulation', 'label': 'XLPE', 'category': 'insulation', 'standard_kind': 'XLPE'}],
        'cable_types': [{'id': 'cable_type/design', 'label': '标准结构草稿', 'construction': 'multi_core' if n == 4 else values['construction'],
            'rating': {'u0': u0, 'u': u, 'um': None, 'max_conductor_temperature': {}},
            'cores': [{'id': f'core/{i+1}', 'conductor': dict(conductor), 'x': None, 'z': None,
                       'layers': [{'role': 'insulation', 'material': 'material/insulation', 'thickness': thickness/1000, 'form': 'smooth'}]} for i in range(n)],
            'common_layers': []}], 'circuits': [], 'sections': [], 'load_cases': [], 'criteria': {}, 'measurements': [], 'provenance': {}}
    import json
    rows = []
    for i in range(n):
        is_neutral = values['construction'] == 'three_plus_one' and i == 3
        core = document['cable_types'][0]['cores'][i]
        if is_neutral:
            core['conductor']['nominal_area'] = values['neutral_area_m2']
            core['layers'][0]['thickness'] = neutral_thickness/1000
        ref = refs['neutral_insulation'] if is_neutral else reference
        path = f'/cable_types/cable_type~1design/cores/core~1{i+1}/layers/insulation/thickness'
        document['provenance'][path] = {'kind': 'standard', 'reference': json.dumps(ref, ensure_ascii=False), 'reviewed': False}
        rows.append({'label': ('中性线' if is_neutral else f'芯 {i+1}')+' · 绝缘标称厚度', 'path': path, 'value': core['layers'][0]['thickness'], 'unit': 'm',
                     'basis': 'standard_value', 'source': ref})
    for role in ('filler', 'binder'):
        key = role+'_thickness_m'
        if key not in values:
            continue
        label = '填充' if role == 'filler' else '包带'
        document['materials'].append({'id':'material/'+role,'label':label+' · 待绑定材料','category':'filler' if role=='filler' else 'polymer'})
        document['cable_types'][0]['common_layers'].append({'role':role,'material':'material/'+role,'thickness':values[key],'form':'smooth'})
        path = '/cable_types/cable_type~1design/common_layers/'+role+'/thickness'
        document['provenance'][path]={'kind':'user','reference':'工程师给定'+label+'连续等效径向厚度；不作为标准值或绕包工艺参数。','reviewed':False}
        rows.append({'label':label+' · 等效径向厚度','path':path,'value':values[key],'unit':'m','basis':'user','formula':document['provenance'][path]['reference']})
    return {'schema': 'cablesim.cable-design-proposal/1', 'status':'partial', 'document': document, 'rows': rows,
            'next_input': {'schema_version': 'cablesim.core-layout-request/2' if n == 4 else 'cablesim.core-layout-request/1', 'area_m2': values['area_m2'],
                'thickness_m': thickness/1000, 'construction': values['construction'], 'form': values['form'],
                **{k: values[k] for k in ('diameter_m', 'gap_m','neutral_area_m2','neutral_diameter_m','filler_thickness_m','binder_thickness_m') if k in values},
                **({'neutral_thickness_m':neutral_thickness/1000} if values['construction']=='three_plus_one' else {})},
            'limitations': ['仅提出 XLPE 绝缘及导体几何；屏蔽、护套、铠装、制造数据和物性需另行设计。',
                            '标准厚度不是实测最薄点；提案不构成合格判定或型号发布。']}
