"""Explicit SI/display metadata for editable domain facts; parameter metadata stays in manifests."""
from copy import deepcopy
import re

from fastapi import HTTPException

from backend.domain.guards import value_at

# No unit inference from suffixes. Domain names are canonical SDK facts.
DOMAIN_FIELDS = {
    'name':('工程名称',None), 'label':('对象名称',None), 'construction':('电缆构造',None),
    'form':('结构形式',None), 'kind':('类型',None), 'phase':('相别',None),
    'material':('材料引用',None), 'cable_type':('电缆型号引用',None),
    'nominal_area':('导体标称截面','m2'), 'diameter':('导体直径','m'), 'inner_diameter':('内径','m'),
    'outer_diameter':('外径','m'), 'thickness':('层厚度','m'), 'length':('截面段长','m'),
    'x':('横向坐标','m'), 'z':('竖向坐标','m'), 'width':('宽度','m'), 'height':('高度','m'),
    'wire_diameter':('单丝直径','m'), 'lay_length':('绞距','m'), 'core_lay_length':('成缆绞距','m'),
    'corrugation_depth':('皱纹深度','m'), 'corrugation_pitch':('皱纹节距','m'),
    'padding_thickness':('附加垫层厚度','m'), 'tape_width':('带宽','m'), 'tape_gap':('绕包间隙','m'),
    'screen_inner_diameter':('屏蔽内径','m'), 'nominal_tape_thickness':('单带标称厚度','m'),
    'reverse_binder_thickness':('反向扎带厚度','m'), 'reverse_binder_width':('反向扎带宽度','m'),
    'r20':('20 °C 直流电阻','ohm/m'), 'longitudinal_r20':('金属层纵向电阻','ohm/m'),
    'thermal_resistivity':('热阻率','K·m/W'), 'dry_thermal_resistivity':('干燥热阻率','K·m/W'),
    'volumetric_heat_capacity':('体积热容量','J/(m³·K)'), 'electrical_resistivity_20':('20 °C 电阻率','Ω·m'),
    'temperature_coefficient_20':('电阻温度系数','1/K'), 'density':('质量密度','kg/m³'),
    'relative_permittivity':('相对介电常数','1'), 'relative_permeability':('相对磁导率','1'),
    'loss_tangent':('介质损耗角正切','1'), 'emissivity':('发射率','1'), 'solar_absorptivity':('太阳吸收率','1'),
    'surface_temperature':('地表温度','K'), 'air_temperature':('空气温度','K'),
    'critical_temperature_rise':('临界温升','K'), 'duration':('持续时间','s'), 'period':('周期','s'),
    'frequency':('频率','Hz'), 'voltage':('系统线电压','V'), 'u0':('额定相对地电压','V'),
    'u':('额定线电压','V'), 'um':('最高系统电压','V'), 'longitudinal_resistance_frequency':('纵向电阻测量频率','Hz'),
    'wind_speed':('风速','m/s'), 'solar_irradiance':('太阳辐照度','W/m²'),
    'wire_count':('单丝根数','1'), 'segments':('导体分块数','1'), 'parallel_index':('并联序号','1'),
    'tape_count':('带层数','1'), 'reverse_binder_count':('反向扎带数','1'), 'lay_factor':('绞入系数','1'),
    'overlap':('绕包搭盖率','1'), 'minimum_overlap':('最小搭盖率','1'),
    'sector_angle_deg':('扇形夹角','°'), 'sector_rotation_deg':('扇形朝向','°'),
    'reference_angle_rad':('参考相角','rad'), 'phase_sequence':('相序',None),
    'lay_direction':('绞向',None), 'conductor_class':('导体类别','1'), 'standard_kind':('材料类别',None),
    'insulated_wires':('单丝绝缘',None), 'transposed':('护套换位',None), 'ventilation':('通风方式',None),
}


def parts(path):
    if not isinstance(path,str) or not path.startswith('/') or '//' in path or re.search(r'~(?![01])',path):
        raise HTTPException(422,{'code':'FIELD_PATH_INVALID','message':'需要合法的字段 JSON Pointer。','path':str(path)[:500]})
    return [part.replace('~1','/').replace('~0','~') for part in path[1:].split('/')]


def target(document,path,*,stable):
    tokens=parts(path);current=document
    for token in tokens[:-1]:
        if isinstance(current,list):
            if stable:
                matches=[item for item in current if isinstance(item,dict) and token in (item.get('id'),item.get('role'),item.get('cable'))]
                if len(matches)!=1:raise HTTPException(422,{'code':'FIELD_NOT_FOUND','message':'领域对象不存在或不唯一。','path':path})
                current=matches[0]
            else:
                try:
                    if not re.fullmatch(r'0|[1-9][0-9]*',token):raise ValueError('index')
                    current=current[int(token)]
                except (ValueError,IndexError):raise HTTPException(422,'参数数组下标不存在。') from None
        elif isinstance(current,dict) and token in current:current=current[token]
        else:raise HTTPException(422,{'code':'FIELD_NOT_FOUND','message':'字段路径不存在。','path':path})
    key=tokens[-1]
    if isinstance(current,list) and not stable:
        try:
            if not re.fullmatch(r'0|[1-9][0-9]*',key):raise ValueError('index')
            key=int(key);current[key]
        except (ValueError,IndexError):raise HTTPException(422,'参数数组下标不存在。') from None
    elif not isinstance(current,dict) or key not in current:
        raise HTTPException(422,{'code':'FIELD_NOT_FOUND','message':'只允许修改现有字段。','path':path})
    return current,key


def domain_metadata(path):
    tokens=parts(path);field=tokens[-1]
    if 'provenance' in tokens or field in ('id','schema_version','reviewed'):
        raise HTTPException(422,{'code':'FIELD_NOT_EDITABLE','message':'来源、身份和核对状态不属于模型可修改字段。','path':path})
    absolute_temperature = 'max_conductor_temperature' in tokens or field in ('surface_temperature','air_temperature')
    if absolute_temperature:
        return {'title':'导体温限' if 'max_conductor_temperature' in tokens else DOMAIN_FIELDS[field][0],
                'x-unit':{'si':'K','display':'°C','scale':1,'offset':-273.15}}
    if 'currents' in tokens or 'base_current' in tokens:
        return {'title':'负荷电流','x-unit':{'si':'A','display':'A','scale':1,'offset':0}}
    if field not in DOMAIN_FIELDS:
        raise HTTPException(422,{'code':'FIELD_NOT_EDITABLE','message':'此字段尚无可编辑的明确单位契约，请在工作台人工修改。','path':path})
    title,unit=DOMAIN_FIELDS[field]
    return {'title':title,'x-unit':{'si':unit,'display':'mm²' if unit=='m2' else unit,
        'scale':1e6 if unit=='m2' else 1,'offset':0}}


def schema_at(schema,path):
    root=schema
    def unwrap(node):
        if '$ref' in node:
            ref=node['$ref']
            if not ref.startswith('#/'):raise HTTPException(422,'参数契约不能引用外部 schema。')
            value=root
            for token in parts(ref[1:]):value=value[token]
            return {**unwrap(value),**{key:value for key,value in node.items() if key!='$ref'}}
        choices=node.get('anyOf') or node.get('oneOf')
        if choices and len([item for item in choices if item.get('type')!='null'])==1:
            return {**unwrap(next(item for item in choices if item.get('type')!='null')),
                    **{key:value for key,value in node.items() if key not in ('anyOf','oneOf')}}
        return node
    node=unwrap(root)
    read_only=False
    for token in parts(path):
        node=unwrap(node)
        read_only=read_only or bool(node.get('readOnly') or (node.get('x-bind') or {}).get('read_only'))
        if node.get('type')=='array' or 'items' in node:
            node=(node.get('prefixItems') or [])[int(token)] if 'prefixItems' in node else node.get('items',{})
        else:
            node=node.get('properties',{}).get(token,node.get('additionalProperties',{}))
        if not isinstance(node,dict):raise HTTPException(422,'字段没有结构化参数契约。')
    node=unwrap(node)
    return {**node,'readOnly':True} if read_only else node


def unit_for(metadata,document,path):
    defaults={'si':None,'display':None,'scale':1,'offset':0}
    unit={**defaults,**deepcopy(metadata.get('x-unit') or {})}
    if metadata.get('x-unit-by'):
        parent,key=target(document,path,stable=False)
        by=metadata['x-unit-by'];selector=parent.get(by['selector'])
        if selector not in by['cases']:raise HTTPException(422,'物理类型没有完整单位声明。')
        unit={**defaults,**deepcopy(by['cases'][selector])}
    # The workbench domain change rows use metres; all absolute temperatures use °C.
    if unit['si']=='m':unit.update(display='m',scale=1,offset=0)
    return unit


def displayed(value,unit):
    if type(value) in (int,float):return round(value*unit['scale']+unit['offset'],12)
    return value


def stored(value,unit,provided_unit):
    if provided_unit is not None and provided_unit!=unit['display']:
        raise HTTPException(422,{'code':'DISPLAY_UNIT_MISMATCH','message':'方案值必须使用声明的界面单位：'+str(unit['display'])+'。'})
    if type(value) in (int,float) and (unit['scale']!=1 or unit['offset']!=0):return (value-unit['offset'])/unit['scale']
    return value


def check_edits(changes):
    paths=[row['path'] for row in changes]
    if not changes or len(changes)>12 or len(set(paths))!=len(paths):
        raise HTTPException(422,'方案须包含一至十二个不重复的字段变更。')
    for row in changes:
        if len(row['path'])>500 or isinstance(row['value'],(dict,list)):
            raise HTTPException(422,'最小版本只接受明确的标量字段变更，不替换整个结构或集合。')


def changed_domain(before,after):
    """Include dependent coordinate changes made by the ordinary domain editor."""
    changes=[]
    def walk(old,new,tokens):
        if isinstance(old,dict) and isinstance(new,dict):
            for name in old.keys() & new.keys():
                if name!='provenance':walk(old[name],new[name],[*tokens,name])
        elif isinstance(old,list) and isinstance(new,list) and len(old)==len(new):
            for index,(a,b) in enumerate(zip(old,new)):
                identity=next((a[key] for key in ('id','role','cable') if isinstance(a,dict) and key in a),str(index))
                walk(a,b,[*tokens,identity])
        elif old!=new:
            path='/'+ '/'.join(str(part).replace('~','~0').replace('/','~1') for part in tokens)
            metadata=domain_metadata(path);unit=metadata['x-unit']
            changes.append({'path':path,'label':metadata['title'],'before':displayed(old,unit),
                'after':displayed(new,unit),'unit':unit['display']})
    walk(before,after,[])
    return changes
