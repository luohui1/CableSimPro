"""Execute the sealed 0.6 manufacturing rules using live lookup receipts.

Engineering declarations live in versioned provenance, not in the standards
catalogue. A declaration of screen area never proves short-circuit capacity.
"""
import json
import math

SCHEMA = 'cablesim.manufacturing-input/1'
MATERIALS = {'steel_galvanized':'galvanized_steel',
             'steel_stainless_nonmagnetic':'nonmagnetic_stainless_steel',
             'aluminium':'aluminium','aluminium_alloy':'aluminium_alloy'}


def layer(checker, row):
    target = row['target']
    core = next((c for c in checker.cable['cores'] if c['id'] == target.get('core_id')), None)
    layers = core['layers'] if core else checker.cable['common_layers']
    return next((item for item in layers if item['role'] == target.get('role')), {})


def root(checker, row):
    escape = lambda token: token.replace('~','~0').replace('/','~1')
    target = row['target']
    path = '/cable_types/'+escape(checker.cable['id'])
    if target.get('core_id'): path += '/cores/'+escape(target['core_id'])+'/layers/'
    else: path += '/common_layers/'
    return path+escape(target['role'])


def field(checker, row, name, label, unit='1', kind='number', **extra):
    return {'field':root(checker,row)+'/engineering/'+name,'label':label,
            'unit':unit,'type':kind,'storage':'provenance',**extra}


def read(checker, spec):
    source = checker.document.get('provenance',{}).get(spec['field'])
    if not source: return None
    try: receipt = json.loads(source.get('reference',''))
    except (TypeError, ValueError): raise ValueError(spec['label']+'：工程输入来源记录损坏，请重新录入。') from None
    if receipt.get('schema') != SCHEMA or receipt.get('unit') != spec['unit'] or not receipt.get('reference'):
        raise ValueError(spec['label']+'：工程输入须记录明确单位和出处。')
    value = receipt.get('value')
    if spec['type']=='number':
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value < spec.get('min',0) or value > spec.get('max',math.inf):
            raise ValueError(spec['label']+'：数值不在声明的适用范围内。')
    elif spec['type']=='boolean' and not isinstance(value,bool):
        raise ValueError(spec['label']+'：请明确选择是或否。')
    elif spec['type']=='text' and (not isinstance(value,str) or not value.strip()):
        raise ValueError(spec['label']+'：请填写依据。')
    return value


def plan(checker, row):
    if checker.family != 'mv2': return None
    key = row['id'].rsplit(':',1)[-1]
    item = layer(checker,row)
    mapped = {
        'bedding-minimum':('17.5.3','extruded_inner_covering_measured_min',{'covering_construction':'extruded'}),
        'armour-tape-measured':('17.7.3','armour_measured_negative_deviation_max',{'armour_kind':'tape'}),
        'armour-material':('13.2','armour_allowed_materials',{'armour_kind':'tape'}),
        'armour-underlayer':('13.3.2','armour_inner_covering_rule',{'core_count':len(checker.cable['cores'])}),
        'armour-tape-count':('13.7','armour_tape_layer_count',{'armour_kind':'tape'}),
        'armour-tape-gap':('13.7','armour_tape_gap_ratio_max',{'armour_kind':'tape'}),
    }
    if key=='bedding-minimum' and item.get('form') != 'smooth': return None
    if key=='armour-underlayer' and len(checker.cable['cores']) != 3: return None
    if key in ('armour-material','armour-tape-measured','armour-tape-count','armour-tape-gap') and item.get('form') != 'tape': return None
    if key=='screen-area' and item.get('form')=='tape' and checker.materials.get(item.get('material'),{}).get('standard_kind') in ('copper_bare','copper_coated'):
        mapped[key]=('10.2.3','screen_nominal_area_requirement',{'screen_kind':'copper_tape'})
    if key=='armour-separation':
        spec=field(checker,row,'longitudinal_water_barrier','金属层间纵向阻水隔层',kind='boolean')
        water=read(checker,spec)
        row['engineering_inputs']=[spec]
        if water is None:
            row['basis_missing_fields'].append(spec)
        common=checker.cable['common_layers']
        metals=[l for c in checker.cable['cores'] for l in c['layers'] if l['role']=='metallic_screen']+[l for l in common if l['role']=='metallic_sheath']
        armour_kind=checker.materials.get(item.get('material'),{}).get('standard_kind')
        kinds=[checker.materials.get(l.get('material'),{}).get('standard_kind') for l in metals]
        if not armour_kind or armour_kind=='other' or not kinds or any(not k or k=='other' for k in kinds):
            spec={'field':'/materials/'+item.get('material','').replace('/','~1')+'/standard_kind','label':'铠装及相邻金属材料标准类别','type':'material'}
            row['basis_missing_fields'].append(spec)
            return None
        # Compare elemental identities; bare and coated copper are both copper.
        elemental=lambda k:'copper' if k.startswith('copper_') else 'steel' if k.startswith('steel_') else k
        relation='same' if all(elemental(k)==elemental(armour_kind) for k in kinds) else 'different'
        mapped[key]=('13.3.3','separation_sheath_application',{'metal_layer_relation':relation,
            'longitudinal_water_barrier':water,'lead_sheath_present':'lead' in kinds})
    if key not in mapped: return None
    locator,quantity,conditions=mapped[key]
    return {'schema_version':'cablesim.standards-query/1','standard':'GB/T 12706.2','edition':'2020',
            'locator':locator,'quantity':quantity,'conditions':conditions}


def execute(checker, row, record):
    """Return True only when this module owns the receipt's semantics."""
    quantity=record['quantity']['key']; value=record['value']; item=layer(checker,row)
    def verdict(status,reason=None):
        row.update(verdict=status,reason=reason,margin=None)
    if quantity=='extruded_inner_covering_measured_min':
        nominal=item.get('thickness')
        if record['quantity']['unit']!='mm' or value.get('kind')!='affine' or value.get('x')!='nominal_lining_thickness':
            raise ValueError('挤包内衬依据的公式或单位不兼容。')
        # The diameter chain may already have a higher required nominal value.
        # Keep that input; do not reduce the minimum by a thin design declaration.
        inputs=row.get('formula_inputs') or {}
        row['formula_inputs']={**inputs,'t_n_mm':inputs.get('t_n_mm',nominal*1000 if nominal is not None else None)}
        row['formula']=f"{value['a']} × 内衬标称厚度 + ({value['b']}) mm"
        row['reason']='缺字段：内衬实测最薄点；按 17.5 测量并记录试样，不使用外护套或设计标称值代替。'
        return False  # Generic affine comparison below uses this explicit unit conversion.
    if quantity=='armour_measured_negative_deviation_max':
        if record['quantity']['unit']!='1' or record['criterion']!='maximum' or not isinstance(value,(int,float)) or isinstance(value,bool) or not 0<=value<=1:
            raise ValueError('铠装负偏差依据须为无量纲比例。')
        nominal=item.get('nominal_tape_thickness')
        limit=None if nominal is None else nominal*1000*(1-value)
        actual=row.get('actual_unrounded')
        row.update(limit=limit,comparison='>=',actual=actual,formula=f'带标称厚度 × (1 − {value})',
                   formula_inputs={'nominal_tape_thickness_m':nominal,'negative_deviation_ratio':value,'mm_per_m':1000},
                   margin=None if actual is None or limit is None else actual-limit)
        row['verdict']='missing' if actual is None or limit is None else 'passed' if actual>=limit-1e-12 else 'failed'
        missing=[name for name,missing in [('铠装带标称厚度',nominal is None),('铠装带实测厚度',actual is None)] if missing]
        row['reason']='缺字段：'+'、'.join(missing)+'；按 17.7.2 测量方法记录平均值，不以标称厚度代替。' if missing else None
    elif quantity=='armour_tape_layer_count':
        if record['criterion']!='required' or record['quantity']['unit']!='1' or not isinstance(value,int):
            raise ValueError('金属带层数依据须为必需整数。')
        actual=item.get('tape_count');row.update(limit=value,comparison='=',actual=actual)
        verdict('missing' if actual is None else 'passed' if actual==value else 'failed',
                '缺字段：铠装带层数。' if actual is None else None)
        if row['verdict']!='failed' and item.get('tape_application')!='two_tape_gap':
            verdict('missing','缺字段：双层螺旋间隙绕包构造；外带中部须覆盖内带间隙。')
    elif quantity=='armour_tape_gap_ratio_max':
        if record['quantity']['unit']!='1' or record['criterion']!='maximum': raise ValueError('铠装间隙依据单位不符。')
        count=item.get('tape_count')
        if count is None or not isinstance(count,int) or not 1<=count<=20:
            verdict('missing','缺字段：先声明铠装带层数，再分别录入每层最大间隙率。');return True
        specs=[field(checker,row,f'tape_gap_ratio_{i+1}',f'铠装第 {i+1} 层最大间隙率','1',scale=100,display_unit='%',min=0,max=1) for i in range(count)]
        values=[read(checker,spec) for spec in specs]
        row.update(engineering_inputs=specs,limit=value,comparison='<=',actual=None if any(v is None for v in values) else max(values),
                   per_layer_values=values,formula=f'各层最大轴向间隙 / 金属带宽度 ≤ {value}',formula_inputs={'maximum_gap_ratios':values})
        missing=[spec['label'] for spec,v in zip(specs,values) if v is None]
        verdict('missing' if missing else 'passed' if all(v<=value for v in values) else 'failed',
                '缺字段：'+'、'.join(missing)+'；逐层记录，不把一层间隙沿用到其他层。' if missing else None)
        if not missing: row['margin']=value-max(values)
    elif quantity=='armour_allowed_materials':
        if not isinstance(value,list) or record['criterion']!='rule': raise ValueError('铠装材料依据格式不兼容。')
        kind=checker.materials.get(item.get('material'),{}).get('standard_kind')
        row.update(limit=None,rule_requirement='明确允许的金属材料类别',comparison='in',actual=None,
                   engineering_inputs=[{'field':'/materials/'+item.get('material','').replace('/','~1')+'/standard_kind',
                        'label':'铠装材料标准类别','type':'material','storage':'domain'}])
        translated=MATERIALS.get(kind)
        verdict('missing' if kind is None or kind=='other' else 'passed' if translated in value else 'failed',
                '缺字段：铠装材料标准类别；普通钢不能自动视为镀锌钢。' if kind is None or kind=='other' else '所声明铠装材料不在此条款允许类别中；请核对材料类别与出处。' if translated not in value else None)
        row['rule_actual']={'steel_galvanized':'镀锌钢','steel_stainless_nonmagnetic':'非磁性不锈钢','aluminium':'铝','aluminium_alloy':'铝合金','copper_bare':'裸铜','copper_coated':'镀层铜','lead':'铅'}.get(kind,'未明确' if kind is None or kind=='other' else '其他已声明类别')
    elif quantity=='screen_nominal_area_requirement':
        if not isinstance(value,dict) or value.get('fixed_numeric_area')!='standard_not_specified' or value.get('engineering_input_required') is not True:
            raise ValueError('当前屏蔽截面依据分支未实现，不套用其他判据。')
        specs=[field(checker,row,'screen_area','屏蔽设计截面','m2',scale=1e6,display_unit='mm²',min=1e-12),
               field(checker,row,'fault_current','屏蔽短路电流','A',scale=.001,display_unit='kA',min=1e-12),
               field(checker,row,'fault_duration','屏蔽短路持续时间','s',min=1e-12),
               field(checker,row,'capacity_reference','屏蔽短路容量依据',kind='text')]
        values=[read(checker,spec) for spec in specs];missing=[s['label'] for s,v in zip(specs,values) if v is None]
        row.update(engineering_inputs=specs,limit=None,margin=None,actual=None if values[0] is None else values[0]*1e6,
                   comparison=None,unit='mm²',rule_requirement='需工程输入与短路容量依据',engineering_values=values,
                   formula=None,formula_inputs={'screen_area_m2':values[0],'fault_current_A':values[1],'fault_duration_s':values[2]})
        # Neither a free-text reference nor a declared area is a capacity verdict.
        verdict('missing','需工程输入与短路容量依据；'+('待补：'+'、'.join(missing)+'。' if missing else '工程输入已记录，须按独立短路容量结果完成校核。')+'标准未规定固定截面，不据此判为通过。')
    elif quantity=='armour_inner_covering_rule':
        if value!='required_conforming_8.2': raise ValueError('当前内衬适用分支未实现。')
        bedding=next((l for l in checker.cable['common_layers'] if l['role']=='bedding'),None)
        dependencies=[r for r in checker.rows if r['target'].get('role')=='bedding' and r['id'].rsplit(':',1)[-1] in ('bedding-nominal','bedding-minimum','bedding-filled')]
        row.update(limit=None,rule_requirement='内衬须符合 8.2',actual=None,comparison=None)
        if not bedding: verdict('missing','缺字段：铠装下内衬；如拟用挤包隔离套替代，须按 13.3.3 独立核对。')
        elif not dependencies or any(r['verdict']!='passed' for r in dependencies):
            verdict('failed' if any(r['verdict']=='failed' for r in dependencies) else 'missing','内衬已声明；其标称厚度、最薄点和适用构造仍须全部核对。')
        else: verdict('passed');row['rule_actual']='内衬尺寸已满足已核验判据'
    elif quantity=='separation_sheath_application':
        row.update(limit=None,comparison=None,actual=None,rule_requirement='按金属层、阻水层及铅套条件核对隔离套')
        if value!='extruded_required':
            verdict('uncovered','依据已核验；当前隔离套适用分支尚未实现，保留本项。');return True
        separating=next((l for l in checker.cable['common_layers'] if l['role'] in ('bedding','separator') and l.get('form')=='smooth'),None)
        # Bedding dimensions remain checked separately; do not infer compound properties.
        spec=field(checker,row,'separator_compound_confirmed','隔离层材料已确认符合隔离套要求',kind='boolean')
        confirmed=read(checker,spec);row['engineering_inputs']=[*row.get('engineering_inputs',[]),spec]
        verdict('missing' if not separating or confirmed is None else 'passed' if confirmed else 'failed',
                '缺字段：声明金属层间挤包隔离层及其材料符合性；不把任意内衬自动等同隔离套。' if not separating or confirmed is None else None)
    else: return False
    return True


def finish(checker):
    # Evaluate dependent structural conditions after the live Annex A/B dimensions.
    for row in checker.rows:
        record=row.get('basis_reference',{}).get('record',{})
        if record.get('quantity',{}).get('key')=='armour_inner_covering_rule': execute(checker,row,record)
        sources={spec['field']:checker.document['provenance'][spec['field']] for spec in row.get('engineering_inputs',[])
                 if spec['field'] in checker.document.get('provenance',{})}
        if sources:
            row['engineering_sources']=sources
            row['input_source']={'kind':'user','reviewed':False,
                'reference':json.dumps({'schema':'cablesim.manufacturing-inputs/1','sources':sources},ensure_ascii=False)}
