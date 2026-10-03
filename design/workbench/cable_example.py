"""CAD example with cited nominal dimensions; manufacturing choices stay explicit."""
from backend.catalog import presets
from backend.domain.migration import convert
from backend.domain.models import DomainDocument
from backend.domain.guards import pointer


def example():
    preset = presets()[0]
    document = convert(preset['scenario'])['document']
    document['name'] = 'YJV72 8.7/15 kV 1×120 mm²'
    cable = document['cable_types'][0]
    cable['label'] = document['name']
    cable['rating'].update(u0=8700,u=15000,um=17500)
    cable['cores'][0]['conductor'].update(form='stranded_round',diameter=.0145,
        nominal_area=120e-6,wire_count=37,wire_diameter=.00203,
        lay_length=.2,lay_direction='right',r20=.000153)
    cable['common_layers'] = [
        {'role':'conductor_screen','material':'material/semicon','thickness':.0006},
        {'role':'insulation','material':'material/insulation','thickness':.0045},
        {'role':'insulation_screen','material':'material/semicon','thickness':.0007},
        {'role':'metallic_screen','material':'material/screen','thickness':.0008,'form':'wires',
         'wire_count':24,'wire_diameter':.0008,'lay_length':.18,'lay_direction':'right'},
        {'role':'binder','material':'material/screen','thickness':.0001,'form':'tape',
         'tape_width':.008,'lay_length':.18,'lay_direction':'left'},
        {'role':'bedding','material':'material/jacket','thickness':.0012},
        {'role':'armour','material':'material/aluminium','thickness':.002,'form':'wires',
         'wire_count':47,'wire_diameter':.002,'lay_length':.3,'lay_direction':'right'},
        {'role':'oversheath','material':'material/jacket','thickness':.0021},
    ]
    document['materials'].append({'id':'material/aluminium','label':'铝丝 · 非磁性铠装','category':'metal','density':2700,'relative_permeability':1})
    for material in document['materials']:
        if material['id'] in ('material/conductor','material/screen'): material['density']=8960
        elif material['id']=='material/semicon': material['density']=1150
        elif material['id']=='material/insulation': material.update(label='XLPE',density=920,relative_permittivity=2.5,loss_tangent=.004)
        elif material['id']=='material/jacket': material.update(label='PVC',density=1400)
        if material['id']=='material/screen':material['label']='铜屏蔽丝与反向扎带'
    source={'kind':'demo','reference':'YJV72 单芯交流 / 非磁性铝丝铠装示例；密度、制造尺寸与绞距为明示设计输入，不代表产品认证','reviewed':False}
    document['provenance']={}
    document['provenance']['/name']=source
    document['provenance'][pointer('cable_types',cable['id'],'label')]=source
    for field in ('u0','u','um'):
        document['provenance'][pointer('cable_types',cable['id'],'rating',field)]=source
    for material in document['materials']:
        for field,value in material.items():
            if value is not None:document['provenance'][pointer('materials',material['id'],field)]=source
    for field,value in cable['cores'][0]['conductor'].items():
        if value is not None:document['provenance'][pointer('cable_types',cable['id'],'cores','core/1','conductor',field)]=source
    for layer in cable['common_layers']:
        for field,value in layer.items():
            if value is not None:document['provenance'][pointer('cable_types',cable['id'],'common_layers',layer['role'],field)]=source
    # Original GB/T PDF: Zotero NIDKZ4D2 / CIUHMVQW, PDF page = printed page + 8.
    gb='GB/T 12706.2-2020'
    checked={
        ('insulation','thickness'):f'{gb} 表7，印刷页7 / PDF页15：8.7/15 kV、120 mm² XLPE 标称厚度4.5 mm',
        ('conductor_screen','thickness'):f'{gb} 7.2，页8：挤包半导电屏蔽；标准未给唯一标称厚度，0.6 mm为制造设计值',
        ('insulation_screen','thickness'):f'{gb} 7.3，页8：半导电层与金属层组合；0.7 mm为制造设计值',
        ('metallic_screen','wire_diameter'):f'{gb} 10.2.2，页10：软铜丝疏绕，可用反向带扎紧，平均相邻间隙≤4 mm；示例24×0.8 mm，故障电流与时间未指定，短路能力未判定',
        ('binder','thickness'):f'{gb} 10.2.2，页10：铜丝屏蔽的反向扎带；本层0.1 mm为制造设计值，不作为10.2.3中的主铜带屏蔽',
        ('bedding','thickness'):f'{gb} 13.3.3，页11–12：铜屏蔽与铝铠装采用PVC隔离套；假设屏蔽外径25.5 mm，公式修约1.1 mm，采用规定下限1.2 mm',
        ('armour','wire_diameter'):f'{gb} 表10、13.4–13.6，页12–13：铠装前假设直径27.9 mm，25–35 mm档圆金属丝2.0 mm；非磁性铝丝，47根与300 mm节距为制造设计值',
        ('armour','thickness'):f'{gb} 表10，页12：圆丝2.0 mm形成2.0 mm径向层；假设铠装前直径27.9 mm',
        ('oversheath','thickness'):f'{gb} 14.3、附录A，页14、39–42：假设铠装外径31.9 mm，0.035×31.9+1.0=2.1165 mm，修约为2.1 mm；假设外径不等于CAD实际外径',
    }
    for (role,field),reference in checked.items():
        document['provenance'][pointer('cable_types',cable['id'],'common_layers',role,field)]={'kind':'standard','reference':reference,'reviewed':False}
    for field in ('relative_permittivity','loss_tangent'):
        document['provenance'][pointer('materials','material/insulation',field)]={'kind':'standard','reference':'IEC 60287-1-1:2023 表3，印刷页37 / PDF页85：≤18/30 kV无填充XLPE，εr=2.5、tanδ=0.004；Zotero U7C9U2R3 / 24J5BWEN','reviewed':False}
    return {'document':DomainDocument.model_validate(document).model_dump(mode='json'),
            'scenario':preset['scenario'],'source':source['reference']}
