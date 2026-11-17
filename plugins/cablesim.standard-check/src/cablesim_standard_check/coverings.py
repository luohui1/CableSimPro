"""Executable, receipt-driven Annex A chain for equal round XLPE cores.

Physical coordinates and actual semiconductor/tape dimensions never come from
the fictitious diameter. Only explicitly selected PVC extruded covering and
optional double steel-tape armour are generated here.
"""
from .annex import DiameterChain, decimal, evidence, MissingBasis
from .basis import RECORDS, digest


class NeedQueries(Exception):
    def __init__(self, queries):
        self.queries = queries


class OtherCoveringConstruction(ValueError):
    """An explicitly declared construction belongs to a different existing rule."""


def calculate(values, family, refs):
    part = {'mv1':'1','mv2':'2','mv3':'3'}[family]
    standard = 'GB/T 12706.'+part
    n = {'single_core':1,'three_core':3,'four_core':4}.get(values['construction'])
    if n is None:
        raise ValueError('/construction：3+1 完整护层的异截面成缆尚未覆盖；可生成绝缘线芯后由工程师补护层。')
    screened = values.get('screened')
    if screened is None:
        raise ValueError('/screened：缺字段：半导电屏蔽构造；请明确有无导体与绝缘屏蔽层。')
    if family in ('mv2','mv3') and screened != 'yes' and values['voltage'] != '3600/6000':
        raise ValueError('/screened：此电压的无半导电屏蔽分支不适用，请明确两层屏蔽厚度。')
    if family == 'mv1' and screened != 'no':
        raise ValueError('/screened：当前低压完整提案只覆盖无半导电屏蔽的 XLPE 圆形芯。')
    if values.get('armour') is None:
        raise ValueError('/armour：缺字段：护层构造；请选择 PVC 挤包内衬及外护套，有无双钢带铠装。')
    if values['armour'] == 'steel_tape' and n == 1:
        raise ValueError('/armour：普通交流单芯不能自动生成磁性钢带铠装；请选择无铠装或人工设计非磁性结构。')
    if screened == 'yes':
        for key in ('conductor_screen_thickness_m','insulation_screen_thickness_m'):
            if values.get(key) is None:
                raise ValueError('/'+key+'：缺字段：实际半导电层厚度；附录 A 的 3 mm 增量不是制造厚度。')
    if family != 'mv1':
        for key in ('screen_tape_thickness_m','screen_tape_width_m'):
            if values.get(key) is None:
                raise ValueError('/'+key+'：缺字段：铜带重叠绕包尺寸；请明确单带厚度与带宽。')

    queries = {}
    def query(key, locator, quantity, conditions=None, listed=False):
        q = {'schema_version':'cablesim.standards-query/1','standard':standard,'edition':'2020','locator':locator}
        if listed:
            q['operation'] = 'list'
        else:
            q.update(quantity=quantity,conditions=conditions or {})
        queries[key] = q
        ref = refs.get(key)
        if ref is None:
            if key in refs:
                raise MissingBasis(standard+'—2020 '+locator+'：本库暂未收录此护层条件；可先生成绝缘线芯，补齐依据后再生成完整护层。')
            raise NeedQueries({key:q})
        if ref.get('query') != q:
            raise NeedQueries({key:q})
        if ref.get('uncovered'):
            raise MissingBasis(standard+'—2020 '+locator+'：本库暂未收录此护层条件；可先生成绝缘线芯，补齐依据后再生成完整护层。')
        if listed:
            if ref.get('schema') != 'cablesim.standard-basis-list-ref/1' or ref.get('query') != q or ref.get('query_sha256') != digest(q) or ref.get('plugin_version') != RECORDS['plugin_version']:
                raise ValueError('依据表发行与查询条件不一致，请重新取依据。')
            for record in ref['records']:
                bare = {k:v for k,v in record.items() if k not in ('record_sha256','citation')}
                if RECORDS['records'].get(record['id']) != digest(bare) or record.get('verification',{}).get('status') != 'verified':
                    raise ValueError('依据表记录摘要或核验状态不一致。')
            return ref['records']
        return evidence(ref,q)

    rounding = query('annex_rounding','B.1','fictitious_rounding')
    other = query('annex_other_rounding','B.2','fictitious_rounding')
    chain = DiameterChain(rounding)
    d = chain.conductor(query('annex_conductor','表 A.1','conductor_fictitious_diameter',{'area_m2':values['area_m2']}))
    u0,u = map(int, values['voltage'].split('/'))
    insulation = query('insulation','表 6' if part=='3' else '表 7','insulation_nominal',{'area_m2':values['area_m2'],'u0_v':u0,'u_v':u,'insulation':'XLPE'})
    ti = decimal(values['insulation_thickness_m'])*1000 if values.get('insulation_thickness_m') is not None else decimal(insulation['value'])
    d = chain.core(d,ti,query('annex_core','A.2.2','core_fictitious_parameters',{'screened':screened} if part=='2' else {}))
    # Metallic screens precede laid-up-core factor; semiconductor is A.2.2.
    if family != 'mv1':
        rule = query('annex_screen_rule','A.2.5','screen_fictitious_parameters',{'screen_construction':'tape'})
        p = rule['value']
        if p.get('kind') != 'screen_tape' or p.get('table_selection') != 'next_upper_nominal_area':
            raise MissingBasis(rule['citation']+'：未覆盖的金属屏蔽构造规则。')
        gauge = decimal(values['screen_tape_thickness_m'])*1000
        width = decimal(values['screen_tape_width_m'])*1000
        if part=='2':
            nominal = query('screen_nominal','10.2.3','screen_tape_nominal_min',{'core_count':n})
            if nominal['quantity']['unit']!='mm' or nominal['criterion']!='minimum':
                raise MissingBasis(nominal['citation']+'：铜带下限单位或判据类型不适用。')
            if gauge < decimal(nominal['value']):
                raise ValueError('/screen_tape_thickness_m：铜带单带厚度低于 '+str(nominal['value'])+' mm；'+nominal['citation']+'。')
        radial = decimal(p['lapped_multiplier'])*gauge
        area = gauge*width
        if radial < decimal(p['zero_increase_if_total_thickness_lt_mm']):
            addition, source = decimal(0), rule
        else:
            table = query('annex_screen_table','表 A.3' if part=='1' else '表 A.2',None,listed=True)
            def nominal_area(record):
                axis_label=record.get('axes',{}).get('metal_screen_area',{})
                if axis_label.get('unit')=='mm²' and axis_label.get('dimension')=='area':
                    return decimal(float(axis_label['label']))/decimal(1e6)
                axis=record['conditions']['screen_area_m2']
                if isinstance(axis,dict):axis=axis.get('eq',axis.get('lte'))
                return decimal(axis)
            candidates = sorted((nominal_area(r),r) for r in table if r['quantity']['key']=='screen_diameter_increase')
            selected = next((a for a,r in candidates if a >= area/decimal(1e6)),None)
            if selected is None:
                raise ValueError('/screen_tape_width_m：铜带截面超过已核验附录屏蔽表，不能外推。')
            source = query('annex_screen_increment','表 A.2','screen_diameter_increase',{'screen_area_m2':float(selected)})
            addition = decimal(source['value'])
        d = chain.step('金属屏蔽后假设直径','Ds = Dc + Δs；屏蔽截面按表取不小于实际值的档',{'Dc':d,'ts':gauge,'Ws':width,'As':area,'Δs':addition},d+addition,source)
        chain.steps[-1]['construction_record'] = rule
    if n > 1:
        conditions = {'core_count':n,'equal_core_sections':True}
        if part=='1': conditions['cable_arrangement']='standard'
        d = chain.bundle(d,query('annex_bundle','表 A.2' if part=='1' else 'A.2.3','bundle_factor',conditions))
    bundle_d = d
    bedding = query('annex_bedding','表 7' if part=='3' else '表 9','lining_nominal',{'diameter_m':float(d)/1000})
    tb = decimal(bedding['value'])
    if part=='3':
        fictitious_bedding = decimal(values['bedding_thickness_m'])*1000 if values.get('bedding_thickness_m') is not None else tb
        fictitious_source = bedding
    else:
        conditions = {'core_count':n,'diameter_m':float(d)/1000}
        if n==1: conditions['inner_covering_present']=True
        fictitious_source = query('annex_bedding_fictitious','A.2.4','inner_covering_fictitious_thickness',conditions)
        fictitious_bedding = decimal(fictitious_source['value'])
    chain.steps.append({'stage':'内衬标称与假设厚度','formula':'标称厚度查正文表；假设厚度查附录 A.2.4，二者不混用',
        'inputs':{'D':float(d)},'unit':'mm','raw_value':str(tb),'rounded_value':float(tb),'record':bedding,'citation':bedding['citation'],
        'fictitious_thickness':float(fictitious_bedding),'fictitious_record':fictitious_source})
    d = chain.cover(d,fictitious_bedding,query('annex_inner_cover','A.2.4','cover_fictitious_parameters'),'内衬后假设直径')
    ta = None
    if values['armour']=='steel_tape':
        armour = query('annex_armour','表 11' if part=='2' else '表 11' if part=='1' else '表 9','armour_tape_nominal',{'diameter_m':float(d)/1000,'armour_material':'steel'})
        ta = decimal(armour['value'])
        actual_gauge=decimal(values['armour_tape_thickness_m'])*1000 if values.get('armour_tape_thickness_m') is not None else ta
        d = chain.cover(d,actual_gauge,query('annex_armour_cover','A.2.10' if part!='3' else 'A.2.9','cover_fictitious_parameters',{'armour_kind':'tape'}),'双钢带后假设直径')
    sheath = query('annex_oversheath','13.3' if part=='1' else '14.3' if part=='2' else '14.3','oversheath_nominal',{'core_count':n})
    ts = chain.thickness(d,sheath,other)
    return {'queries':queries,'trace':chain.steps,'insulation':float(ti),'bedding':float(tb),'armour':None if ta is None else float(ta),
            'oversheath':float(ts),'bundle_diameter':float(bundle_d),'under_sheath_diameter':float(d),
            'references':refs,'bedding_record':bedding,'sheath_record':sheath}


def from_cable(cable, materials):
    """Derive lookup conditions from the current structure, never its old trace."""
    cores = cable['cores']
    first = cores[0]
    if any(c['conductor']['nominal_area'] != first['conductor']['nominal_area'] or c['layers'] != first['layers'] for c in cores):
        raise ValueError('异截面或异尺寸护层成缆尚未覆盖；请人工设计并核对。')
    layers = {l['role']:l for l in first['layers']}
    common = {l['role']:l for l in cable['common_layers']}
    if any(c['conductor'].get('form') == 'sectoral' for c in cores):
        raise ValueError('扇形导体不属于等圆形线芯分支，请查询对应成缆依据。')
    if any(l['role'] not in ('conductor_screen','insulation','insulation_screen','metallic_screen') for l in first['layers']):
        raise ValueError('附加芯内层的假设直径增量尚未覆盖；不忽略其厚度。')
    if materials.get(layers.get('insulation',{}).get('material'),{}).get('standard_kind') != 'XLPE':
        raise ValueError('当前绝缘不是 XLPE；不能沿用原提案的绝缘和护层计算链。')
    if any(materials.get(common.get(role,{}).get('material'),{}).get('standard_kind') != 'PVC' for role in ('bedding','oversheath')):
        raise ValueError('当前完整护层分支仅覆盖 PVC 内衬与外护套；换材料后须重新查询适用依据。')
    if ('conductor_screen' in layers) != ('insulation_screen' in layers):
        raise ValueError('缺字段：请补齐导体与绝缘半导电屏蔽两层，不能推测 screened 条件。')
    if any(l['role'] not in ('bedding','armour','oversheath') for l in cable['common_layers']):
        if all(l['role'] in ('bedding','armour','oversheath','filler','binder','separator','metallic_sheath')
               for l in cable['common_layers']):
            raise OtherCoveringConstruction('完整挤包护层分支不覆盖已声明的填充、包带、隔离套或金属套；仅可保留其自身已核验且条件齐备的构造规则。')
        raise ValueError('附加填充外包、包带或隔离套分支尚未覆盖；不忽略附加厚度。')
    if common.get('bedding',{}).get('form') == 'tape':
        raise OtherCoveringConstruction('完整挤包护层分支不覆盖绕包内衬；须按已核验的绕包、填充和附加垫层规则核对。')
    if common.get('bedding',{}).get('form') != 'smooth':
        raise ValueError('完整护层计算仅覆盖挤包内衬；绕包及附加垫层须按对应条款设计。')
    result={'construction':{1:'single_core',3:'three_core',4:'four_core'}.get(len(cores),'unsupported'),
        'area_m2':first['conductor']['nominal_area'],'voltage':str(int(cable['rating']['u0']))+'/'+str(int(cable['rating']['u'])),
        'screened':'yes' if 'conductor_screen' in layers else 'no','armour':'steel_tape' if 'armour' in common else 'none',
        'insulation_thickness_m':layers['insulation']['thickness']}
    if common.get('armour',{}).get('form') == 'wires':
        raise OtherCoveringConstruction('完整双钢带护层分支不覆盖钢丝铠装；须按其已核验的丝径与反向扎带规则核对。')
    if 'armour' in common and (common['armour'].get('form')!='tape' or common['armour'].get('tape_count')!=2):
        raise ValueError('当前铠装不属于已接入的双带构造，不能套用其假设增量。')
    result['bedding_thickness_m']=common['bedding']['thickness']
    if 'armour' in common:
        if materials.get(common['armour']['material'],{}).get('standard_kind')!='steel_galvanized':
            raise ValueError('当前材料不属于镀锌钢带提案分支，请查询对应材料判据。')
        result['armour_tape_thickness_m']=common['armour'].get('nominal_tape_thickness')
        if result['armour_tape_thickness_m'] is None:raise ValueError('缺字段：铠装单带标称厚度。')
    for role in ('conductor_screen','insulation_screen'):
        if role in layers:result[role+'_thickness_m']=layers[role]['thickness']
    screen=layers.get('metallic_screen')
    if screen:
        if materials.get(screen['material'],{}).get('standard_kind')!='copper_bare':
            raise ValueError('当前屏蔽材料不属于铜带提案分支，请人工核对相应构造。')
        if screen.get('form')!='tape' or screen.get('tape_application')!='helical_overlap' or screen.get('tape_count')!=1:
            raise ValueError('金属屏蔽的当前构造尚未接入，请明确单铜带重叠绕包或人工核对。')
        result.update(screen_tape_thickness_m=screen.get('nominal_tape_thickness'),screen_tape_width_m=screen.get('tape_width'))
    return result
