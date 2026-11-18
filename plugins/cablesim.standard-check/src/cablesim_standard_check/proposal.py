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
    if family == 'ehv' and values['construction'] != 'single_core':
        raise ValueError('/construction：GB/T 18890.2 的 127/220 kV 提案仅覆盖单芯。')
    if family == 'ehv' and values['conductor'] != 'copper_bare':
        raise ValueError('/conductor：GB/T 18890.2—2015 6.1.1 为 TR 型圆铜线；铝或镀层替代未覆盖。')
    if family == 'ehv' and values['form'] != 'unspecified':
        raise ValueError('/form：127/220 kV 导体不能按实心等面积圆生成；请选明示外径并填写实际导体直径，绞合/分割结构仍待制造确认。')
    standard = 'GB/T 18890.2' if family == 'ehv' else 'GB/T 11017.2' if family == 'hv' else 'GB/T 12706.' + {'mv1':'1','mv2':'2','mv3':'3'}[family]
    edition = '2015' if family == 'ehv' else '2024' if family == 'hv' else '2020'
    queries = {'insulation': {'schema_version':'cablesim.standards-query/1', 'standard':standard, 'edition':edition,
        'locator':'表 3' if family == 'ehv' else '表 2' if family == 'hv' else '表 6' if family == 'mv3' else '表 7',
        'quantity':'insulation_nominal', 'conditions':{'area_m2':values['area_m2'],'u0_v':u0,'u_v':u,
            **({} if family == 'hv' else {'insulation':'XLPE'}),
            **({'conductor_material':'copper'} if family == 'ehv' else {})}}}
    n = 1 if values['construction'] == 'single_core' else 3 if values['construction'] == 'three_core' else 4
    if n == 4 and family != 'mv1':
        raise ValueError('/construction：当前四芯标准提案仅覆盖 GB/T 12706.1 的低压 XLPE 圆形线芯。')
    if values['construction'] == 'three_plus_one':
        from copy import deepcopy
        queries['neutral_insulation'] = deepcopy(queries['insulation'])
        queries['neutral_insulation']['conditions']['area_m2'] = values['neutral_area_m2']
    if values.get('generation_mode') == 'complete':
        if family in ('hv', 'ehv'):
            raise ValueError('/generation_mode：110/220 kV 不适用 GB/T 12706 附录 A/B；完整高压结构生成尚未覆盖。')
        if any(values.get(key) is not None for key in ('filler_thickness_m','binder_thickness_m')):
            raise ValueError('/generation_mode：附加填充外包与包带的假设增量分支尚未覆盖；请选择当前无附加包带的挤包内衬，或只生成绝缘线芯后人工设计。')
        if values.get('screened') is None:
            raise ValueError('/screened：缺字段：半导电屏蔽构造；请明确结构中的导体与绝缘屏蔽层。')
        for key, locator, quantity, conditions in (
            ('annex_conductor','表 A.1','conductor_fictitious_diameter',{'area_m2':values['area_m2']}),
            ('annex_rounding','B.1','fictitious_rounding',{}),
            ('annex_other_rounding','B.2','fictitious_rounding',{}),
            ('annex_core','A.2.2','core_fictitious_parameters',{'screened':values['screened']} if family=='mv2' else {}),
            ('annex_inner_cover','A.2.4','cover_fictitious_parameters',{}),
        ):
            queries[key]={'schema_version':'cablesim.standards-query/1','standard':standard,'edition':edition,
                          'locator':locator,'quantity':quantity,'conditions':conditions}
        if n>1:
            queries['annex_bundle']={'schema_version':'cablesim.standards-query/1','standard':standard,'edition':edition,
                'locator':'表 A.2' if family=='mv1' else 'A.2.3','quantity':'bundle_factor',
                'conditions':{'core_count':n,'equal_core_sections':True,**({'cable_arrangement':'standard'} if family=='mv1' else {})}}
        if family!='mv1':
            queries['annex_screen_rule']={'schema_version':'cablesim.standards-query/1','standard':standard,'edition':edition,
                'locator':'A.2.5','quantity':'screen_fictitious_parameters','conditions':{'screen_construction':'tape'}}
            queries['annex_screen_table']={'schema_version':'cablesim.standards-query/1','operation':'list','standard':standard,'edition':edition,'locator':'表 A.2'}
    if not parameters or 'basis_references' not in parameters:
        return {'schema':'cablesim.cable-design-proposal/1','status':'basis_required',
                'basis_queries':queries,'rows':[],'limitations':['待固定标准依据查询完成后提出尺寸，不批准或创建型号。']}
    refs = parameters['basis_references']
    insulation = refs.get('insulation')
    if not insulation or insulation.get('uncovered'):
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
    covering = None
    if values.get('generation_mode') == 'complete':
        from .coverings import calculate, NeedQueries
        try:
            covering = calculate(values,family,refs)
        except NeedQueries as pending:
            return {'schema':'cablesim.cable-design-proposal/1','status':'basis_required','basis_queries':pending.queries,'rows':[],'limitations':[]}
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
    radial = thickness/1000
    if covering:
        document['materials'].append({'id':'material/pvc','label':'PVC','category':'polymer','standard_kind':'PVC'})
        if values['screened']=='yes':
            document['materials'].append({'id':'material/semi','label':'半导电材料 · 待绑定','category':'semiconductor'})
        if family!='mv1':
            document['materials'].append({'id':'material/screen','label':'铜屏蔽','category':'metal','standard_kind':'copper_bare'})
        for i, core in enumerate(document['cable_types'][0]['cores']):
            insulation_layer = core['layers'][0]
            layers = []
            if values['screened']=='yes':
                layers.append({'role':'conductor_screen','material':'material/semi','thickness':values['conductor_screen_thickness_m'],'form':'smooth'})
            layers.append(insulation_layer)
            if values['screened']=='yes':
                layers.append({'role':'insulation_screen','material':'material/semi','thickness':values['insulation_screen_thickness_m'],'form':'smooth'})
            if family!='mv1':
                tape_rule = refs['annex_screen_rule']['record']['value']
                layers.append({'role':'metallic_screen','material':'material/screen','thickness':float(decimal(tape_rule['lapped_multiplier'])*decimal(values['screen_tape_thickness_m'])),
                    'form':'tape','tape_count':1,'tape_application':'helical_overlap','nominal_tape_thickness':values['screen_tape_thickness_m'],'tape_width':values['screen_tape_width_m']})
            core['layers'] = layers
            for layer in layers:
                if layer['role']=='insulation': continue
                path=f'/cable_types/cable_type~1design/cores/core~1{i+1}/layers/{layer["role"]}/thickness'
                ref={'kind':'engineering_input','screened':values['screened'],'design_request':values,'note':'实际制造厚度由工程师给定，金属带径向包络按固定绕包规则推导；不使用假设屏蔽增量。'}
                if layer['role']=='metallic_screen':
                    ref.update(refs['annex_screen_rule'],calculation=[{'stage':'铜带径向包络','formula':'t = lapped_multiplier × 单带厚度',
                        'inputs':{'lapped_multiplier':tape_rule['lapped_multiplier'],'单带厚度':values['screen_tape_thickness_m']*1000},
                        'unit':'mm','raw_value':str(layer['thickness']*1000),'rounded_value':layer['thickness']*1000,
                        'record':refs['annex_screen_rule']['record']}])
                document['provenance'][path]={'kind':'user' if layer['role']!='metallic_screen' else 'derived','reference':json.dumps(ref,ensure_ascii=False),'reviewed':False}
                rows.append({'label':f'芯 {i+1} · '+{'conductor_screen':'导体屏蔽','insulation_screen':'绝缘屏蔽','metallic_screen':'铜带屏蔽'}[layer['role']], 'path':path,'value':layer['thickness'],'unit':'m','basis':'user' if layer['role']!='metallic_screen' else 'derived','formula':ref['note']})
        radial=sum(l['thickness'] for l in document['cable_types'][0]['cores'][0]['layers'])
        common = document['cable_types'][0]['common_layers']
        common.append({'role':'bedding','material':'material/pvc','thickness':covering['bedding']/1000,'form':'smooth'})
        if covering['armour'] is not None:
            document['materials'].append({'id':'material/armour','label':'镀锌钢带','category':'metal','standard_kind':'steel_galvanized'})
            multiplier = refs['annex_armour_cover']['record']['value']['thickness_multiplier']
            common.append({'role':'armour','material':'material/armour','thickness':multiplier*covering['armour']/2000,'form':'tape','tape_count':2,
                'nominal_tape_thickness':covering['armour']/1000,'tape_application':'two_tape_gap'})
        common.append({'role':'oversheath','material':'material/pvc','thickness':covering['oversheath']/1000,'form':'smooth'})
        for layer in common:
            if layer['role'] not in ('bedding','armour','oversheath'): continue
            path='/cable_types/cable_type~1design/common_layers/'+layer['role']+'/thickness'
            key={'bedding':'annex_bedding','armour':'annex_armour','oversheath':'annex_oversheath'}[layer['role']]
            source={**refs[key],'calculation':covering['trace'],'citation':refs[key]['record']['citation']}
            document['provenance'][path]={'kind':'standard' if layer['role']=='bedding' else 'derived','reference':json.dumps(source,ensure_ascii=False),'reviewed':False}
            rows.append({'label':{'bedding':'PVC 挤包内衬','armour':'双钢带径向包络','oversheath':'PVC 外护套'}[layer['role']], 'path':path,'value':layer['thickness'],'unit':'m','basis':'standard_value' if layer['role']=='bedding' else 'derived','source':source})
            if layer['role']=='armour':
                gauge_path=path.rsplit('/',1)[0]+'/nominal_tape_thickness'
                document['provenance'][gauge_path]={'kind':'standard','reference':json.dumps(source,ensure_ascii=False),'reviewed':False}
                rows.append({'label':'钢带单带标称厚度','path':gauge_path,'value':layer['nominal_tape_thickness'],'unit':'m','basis':'standard_value','source':source})
        document['provenance']['/cable_types/cable_type~1design/annex_basis']={'kind':'derived','reference':json.dumps({'design_request':values,'basis_references':refs,'trace':covering['trace']},ensure_ascii=False),'reviewed':False}
    return {'schema': 'cablesim.cable-design-proposal/1', 'status':'partial', 'document': document, 'rows': rows,
            'next_input': {'schema_version': 'cablesim.core-layout-request/2' if n == 4 else 'cablesim.core-layout-request/1', 'area_m2': values['area_m2'],
                'thickness_m': radial, 'construction': values['construction'], 'form': values['form'],
                **{k: values[k] for k in ('diameter_m', 'gap_m','neutral_area_m2','neutral_diameter_m','filler_thickness_m','binder_thickness_m') if k in values},
                **({'neutral_thickness_m':neutral_thickness/1000} if values['construction']=='three_plus_one' else {})},
            'limitations': [*(['完整尺寸采用已核验附录及正文表；实际芯位置由实体几何插件推导，填充工艺、铜带搭盖、钢带宽度与间隙、实测最薄点、物性仍须工程师补齐。'] if covering else ['仅提出 XLPE 绝缘及导体几何；屏蔽、护套、铠装、制造数据和物性需另行设计。']),
                            '标准厚度不是实测最薄点；提案不构成合格判定或型号发布。']}
