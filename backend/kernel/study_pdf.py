"""Customer/internal calculation books from immutable runs; never invoke a solver.

render_pdf(runs, audience='customer', generated_at=None) returns PDF bytes.
The host remains responsible for run ownership/freshness; source digests are
checked here as well. CLI: python -m backend.kernel.study_pdf --source run.json
--output report.pdf [--audience internal].
"""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from html import escape
from io import BytesIO
import math
import re

from .specification_pdf import _Blocks, _font_lock
from .workspace import fingerprint

RENDERER = 'cablesim.study-pdf/5'
PLUGIN_NAMES = {'cablesim.iec60287':'IEC 60287 稳态载流量', 'cablesim.thermal-network':'热网络交叉校核',
    'cablesim.gb50217-correction':'GB 50217 载流量校正',
    'cablesim.simulation':'数值仿真', 'cablesim.hybrid-rating':'混合载流量参考',
    'cablesim.native-reference':'原生算法参考', 'cablesim.comsol-bridge':'COMSOL 仿真'}
PARAMETERS = {'core_lay_length':'成缆节距', 'filler_rho':'填充材料热阻率', 'screen_model':'铜带导电接触模型',
    'screen_radial_factor':'铜带径向包络系数', 'armour_gap_ratio':'钢带间隙率',
    'steel_relative_permeability':'钢带相对磁导率', 'conductor_form':'导体构造', 'diameter_rounding':'外径舍入容差'}
VALUES = {'continuous_contact':'连续导电接触', 'stranded_round_compacted':'紧压圆绞导体'}
QUANTITIES = {'ampacity':'允许电流', 'conductor_temperature':'导体温度', 'sheath_temperature':'金属屏蔽温度',
    'surface_temperature':'表面温度', 'losses.conductor':'导体损耗', 'losses.sheath':'金属屏蔽损耗',
    'losses.dielectric':'介质损耗', 'losses.total':'总损耗', 'loss_factor.sheath':'屏蔽损耗因数',
    'ac_resistance':'交流电阻', 'capacitance':'每相电容', 'thermal_resistance.insulation':'绝缘热阻',
    'thermal_resistance.oversheath':'外护套热阻', 'thermal_resistance.external':'外部热阻',
    'x-cablesim.iec60287.loss_factor.armour':'铠装损耗因数', 'x-cablesim.iec60287.losses.armour':'铠装损耗',
    'x-cablesim.iec60287.thermal_resistance.bedding':'内衬层热阻',
    'x-cablesim.iec60287.thermal_resistance.duct_air':'管内空气热阻',
    'x-cablesim.iec60287.thermal_resistance.duct_wall':'管壁热阻',
    'x-cablesim.iec60287.temperature_rise.mutual':'互热温升', 'x-cablesim.iec60287.current':'运行电流'}


def number(value, digits=1):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return '未输出'
    return format(Decimal(str(value)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP), f'.{digits}f')


def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def local_time(value):
    if not value:return '未记录'
    return datetime.fromisoformat(str(value).replace('Z','+00:00')).astimezone().strftime('%Y-%m-%d %H:%M')


def human_name(value, fallback):
    value=clean(value).replace('~1','/').replace('~0','~')
    return fallback if not value or value.lower().startswith('v0 ') else value


def engineering_value(key, given):
    value,unit=given['value'],given['unit']
    if not isinstance(value,(int,float)):return VALUES.get(str(value),str(value)), '—' if unit=='1' else unit
    if key=='diameter_rounding' and unit=='m':return number(value*1000,2),'mm'
    if key=='armour_gap_ratio':return number(value*100,1),'%'
    digits=3 if key=='core_lay_length' else 0 if key in ('steel_relative_permeability','screen_radial_factor') else 2
    return number(value,digits),{'1':'—','K*m/W':'K·m/W'}.get(unit,unit)


def table(headers, rows, widths):
    return '<table data-widths="'+','.join(map(str,widths))+'"><tr>'+''.join('<th>'+escape(h)+'</th>' for h in headers)+'</tr>'+''.join(
        '<tr>'+''.join('<td>'+escape(str(v if v is not None else '未输出'))+'</td>' for v in row)+'</tr>' for row in rows)+'</table>'


def paragraph(text):
    return '<p>'+escape(str(text))+'</p>'


def _names(document):
    names={}
    for index,circuit in enumerate(document.get('circuits',[]),1):
        label=human_name(circuit.get('label'),f'回路 {index}')
        names[circuit['id']]=label
        for cable in circuit.get('cables',[]):
            phase={'A':'A 相','B':'B 相','C':'C 相','L1':'A 相','L2':'B 相','L3':'C 相','L1L2L3':'三相整缆'}.get(cable.get('phase'),'电缆')
            names[cable['id']]=label+' · '+phase
    return names


def _input(run, case_id=None):
    if case_id is None:
        from .report_selection import context
        selected=context(run)
        case_id=selected['case_id'] if selected else run.get('convergence',{}).get('reference_case_id') or next((c['case_id'] for c in run.get('output',{}).get('cases',[]) if c['status']=='succeeded'),None)
    cases=run['snapshot'].get('cases',[])
    saved=next((c.get('input',{}) for c in cases if c['case_id']==case_id),cases[0].get('input',{}) if cases else {})
    if saved:return saved
    definition=run['snapshot']['definition']
    return definition.get('method_input') if definition.get('input_source')=='study' else run['snapshot'].get('workspace_state',{}).get('domain',{}) or {}


def _basis(run):
    from .report_selection import context, basis_text
    selected=context(run)
    if selected:return basis_text(selected['basis'],_names(selected['document']))
    quantities=[q for c in run['output'].get('cases',[]) for q in c.get('results',[]) if q.get('key')=='ampacity' and q.get('status')=='available' and q.get('rating_basis')]
    if quantities:
        return '；'.join(dict.fromkeys(basis_text(q['rating_basis'],_names(_input(run))) for q in quantities))
    return '该保存运行未输出可核验的载流量口径，不补写当前方法默认值。'


def _condition_rows(document):
    rows=[];materials={m['id']:m for m in document.get('materials',[])}
    for section in document.get('sections',[]):
        label=section.get('label') or {'ground':'地下敷设','air':'空气敷设','tunnel':'隧道敷设'}.get(section.get('kind'),'敷设截面')
        rows.append(['敷设方式',label])
        places=section.get('placements',[])
        depths=sorted(set(round(-p['z'],8) for p in places))
        rows.append(['电缆中心埋深',' / '.join(number(v,3) for v in depths)+' m' if depths else '未提供'])
        if len(places)>1:
            distances=[math.hypot(a['x']-b['x'],a['z']-b['z']) for i,a in enumerate(places) for b in places[i+1:]]
            rows.append(['最近电缆中心距',number(min(distances),3)+' m'])
        medium=section.get('medium',{});soil=materials.get(medium.get('material'),{})
        rows.append(['环境介质 / 热阻率',human_name(soil.get('label'),'土壤' if section.get('kind')=='ground' else '环境介质')+' / '+number(soil.get('thermal_resistivity'),2)+' K·m/W'])
        ambient=medium.get('surface_temperature')
        if ambient is None:ambient=medium.get('air_temperature')
        rows.append(['环境温度',number(ambient-273.15 if isinstance(ambient,(int,float)) else None)+' °C'])
        ducts=section.get('enclosures',[])
        for inside,outside,rho in sorted({(d.get('inner_diameter'),d.get('outer_diameter'),materials.get(d.get('material'),{}).get('thermal_resistivity')) for d in ducts if d.get('type')=='duct'},key=str):
            rows.append(['管道内径 / 外径 / 管材热阻率',number(inside*1000 if inside else None)+' / '+number(outside*1000 if outside else None)+' mm；'+number(rho,2)+' K·m/W'])
    for index,circuit in enumerate(document.get('circuits',[]),1):
        label=human_name(circuit.get('label'),f'回路 {index}')
        bonding={'both_ends':'两端接地','single_point':'单点接地','cross_bonded':'交叉互联'}.get(circuit.get('bonding',{}).get('kind'),'未提供')
        rows.append([label+'接地方式',bonding])
    for load in document.get('load_cases',[]):
        currents=load.get('currents',{});names=_names(document)
        rows.extend([names.get(key,'负荷对象')+'负荷',number(value,0)+' A'] for key,value in currents.items() if isinstance(value,(int,float)))
    return rows or [['输入状态','旧格式输入；明细仅见内部版来源摘要']]


def _selection(run):
    from collections import Counter
    from .report_selection import context
    source=context(run)
    candidates=run['snapshot'].get('candidate_snapshots',[]);rows=[];recommended=source['case_id'] if source else None
    selected=(source['assessment'],source['candidate']) if source else None
    for assessment in run['output'].get('assessment',[]):
        index=int(assessment['case_id'].rsplit('-',1)[-1]);candidate=candidates[index];payload=candidate['payload']
        cable=payload.get('cable_type') or {};cores=cable.get('cores',[])
        area=cores[0]['conductor']['nominal_area']*1e6 if cores else (payload.get('specification') or {}).get('area_m2',0)*1e6 or (payload.get('cable') or {}).get('area_mm2')
        status=assessment.get('status','unavailable');name=payload.get('name') or cable.get('label') or '未命名型号'
        status_name={'satisfied':'满足','not_satisfied':'不满足','not_applicable':'不适用','failed':'计算失败'}.get(status,'无法判断')
        reason=(assessment.get('reason') or {}).get('message') or ('温限校核满足' if status=='satisfied' else '未取得有效结果')
        reason=reason.replace('screen_radial_factor：','铜带径向包络：')
        detail=assessment.get('reason') or {}
        if detail.get('actual_k') is not None and detail.get('limit_k') is not None:
            reason='目标负荷下导体 '+number(detail['actual_k']-273.15)+' °C，超过 '+number(detail['limit_k']-273.15)+' °C。'
        rows.append([name,number(area,0),number(assessment['value'],1) if assessment.get('value') is not None else '—',
            number(assessment['margin'],1) if assessment.get('margin') is not None else '—',status_name,reason])
    driver=run['snapshot']['definition']['driver'];target=driver.get('minimum')
    if selected:
        conclusion=source['answer']
    elif driver.get('allow_demo_candidates'):
        conclusion='候选尚需完成型号核对，本次不作工程型号推荐。'
    else:conclusion='本次未取得可推荐候选；不满足、不适用及计算失败的原因见比较表。'
    counts=Counter(row[-1] for row in rows)
    notes={reason:index+1 for index,reason in enumerate(reason for reason,count in counts.items() if count>1)}
    for row in rows:
        if row[-1] in notes:row[-1]='见说明 '+str(notes[row[-1]])
    comparison=table(['候选型号','截面 / mm²','允许电流 / A','余量 / A','判定','说明'],rows,[2.2,.75,.95,.75,1.05,2.6])
    comparison+=''.join(paragraph(f'说明 {index}：{reason}') for reason,index in notes.items())
    return recommended, selected, conclusion, comparison


def _metric(row):
    value=row.get('value');unit=row.get('unit','')
    if row.get('status')!='available':return (row.get('reason') or {}).get('message','未输出'),unit
    if unit=='K' and 'temperature' in row['key'] and 'rise' not in row['key']:return number(value-273.15), '°C'
    if unit=='F/m':return number(value*1e9,4),'μF/km'
    if unit=='Ω/m':return number(value*1000,5),'Ω/km'
    if unit=='1' and value and abs(value)<.001:return f'{value:.2e}','—'
    return number(value,0 if unit=='A' else 1 if unit=='K' else 2 if unit=='W/m' else 3), {'1':'—','K*m/W':'K·m/W'}.get(unit,unit)


def paper_text(runs, value, *, aliases=None):
    """Human labels on paper; exact machine identities remain in the audit attachment."""
    value=clean(value).replace('~1','/').replace('~0','~')
    if aliases is None:aliases=paper_aliases(runs)
    for key,label in aliases:
        value=key.sub(lambda _:label,value)
    for key,label in PLUGIN_NAMES.items():value=value.replace(key,label)
    value=re.sub(r'\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b','保存记录',value)
    value=re.sub(r'(?:public-sample)?\+engineering','（工程版）',value).replace('public-sample','公开资料版')
    value=re.sub(r'(?:cable|circuit|section)/[\w.-]+','计算对象',value)
    value=re.sub(r'x-cablesim\.[\w.-]+','方法扩展量',value)
    value=re.sub(r'\bcablesim\.[\w.-]+','保存方法',value)
    value=value.replace('v0 area/fill_factor','截面积与填充系数推导（保存来源记录）')
    if value.startswith('/'):
        fields={'condition':'工况','parameters':'方法参数','materials':'材料','thermal_resistivity':'热阻率','cable_types':'型号','cores':'绝缘线芯','conductor':'导体','diameter':'外径','nominal_area':'标称截面','layers':'层结构','common_layers':'公共层','thickness':'厚度','insulation':'绝缘','screen':'金属屏蔽','sheath':'护套','bedding':'内衬','armour':'铠装','sections':'敷设截面','placements':'电缆位置','circuits':'回路','load_cases':'负荷工况','currents':'电流','medium':'环境介质','surface_temperature':'地表温度','max_temperature':'温限','conductor_screen':'导体屏蔽','insulation_screen':'绝缘屏蔽','oversheath':'外护套','material':'材料引用','form':'构造形式','lay_direction':'绞合方向','lay_length':'节距','overlap':'搭盖率','role':'层功能','tape_width':'带宽','wire_count':'根数','wire_diameter':'单丝直径','title':'研究名称','driver':'任务','crosschecks':'对照方法','normal':'正常运行','rating':'额定参数','resistance_20':'20 °C 电阻','r20':'20 °C 电阻','core':'线芯','x':'横向位置','z':'竖向位置','category':'材料类别','electrical_resistivity_20':'20 °C 电阻率','temperature_coefficient_20':'电阻温度系数','relative_permittivity':'相对介电常数','loss_tangent':'介质损耗角正切','max_conductor_temperature':'导体温限','criteria':'校核要求','bonding':'接地方式','kind':'类型','u0':'额定相电压','u':'额定线电压','um':'最高系统电压'}
        value=' · '.join(fields.get(part,PARAMETERS.get(part,part)) for part in value.split('/') if part and not part.isdigit())
    return value


def paper_aliases(runs):
    aliases={}
    for index,run in enumerate(runs,1):
        aliases[run['id']]=f'运行 {run.get("sequence") or index}'
        aliases.update(_names(_input(run)))
        domain=run['snapshot'].get('workspace_state',{}).get('domain',{})
        for collection in ('materials','cable_types','sections','load_cases'):
            for i,item in enumerate(domain.get(collection,[]),1):
                if item.get('id'):aliases[item['id']]=human_name(item.get('label'),{'materials':'材料','cable_types':'电缆型号','sections':'截面','load_cases':'负荷工况'}[collection]+f' {i}')
        for case in run['snapshot'].get('cases',[]):
            aliases[case['case_id']]=human_name(case.get('label'),'保存工况')
    return [(re.compile(r'(?<![\w.-])(?:cable/|circuit/)?'+re.escape(key)+r'(?![\w.-])'),label)
            for key,label in sorted(aliases.items(),key=lambda item:len(item[0]),reverse=True)]


def input_sources(document, definition, candidate=None):
    """Keep per-field provenance; repeated bibliography entries are printed once."""
    sources=[];references=[]
    origins={'user':'工程师给定','standard':'标准值','derived':'推导','manufacturer':'厂家资料','document':'厂家资料','library':'型号库','asset':'型号库'}
    for path,source in document.get('provenance',{}).items():
        # Identity/display metadata and container origins remain in the full
        # audit snapshot; the paper bibliography lists actual input fields.
        if path.rsplit('/',1)[-1] in ('id','label','name','schema_version'):continue
        value=document
        for part in path.strip('/').split('/'):
            part=part.replace('~1','/').replace('~0','~')
            if isinstance(value,list):value=value[int(part)] if part.isdigit() and int(part)<len(value) else next((v for v in value if isinstance(v,dict) and v.get('id')==part),None)
            elif isinstance(value,dict):value=value.get(part)
            else:value=None
        if value is not None and not isinstance(value,(dict,list)):
            sources.append((source.get('label') or source.get('field_name') or path,source))
    sources.extend((source.get('label') or path,source) for path,source in (candidate or {}).get('sources',{}).items())
    # Engineer-entered method/condition sources are also explicit input evidence.
    sources.extend((path,source) for path,source in definition.get('input_sources',{}).items() if source.get('kind'))
    rows=[]
    for label,source in sources:
        ref=source.get('reference') or '未记录出处';page=source.get('page') or source.get('page_number')
        if page:ref+=f' · 第 {page} 页'
        if ref not in references:references.append(ref)
        if str(label).startswith('/cable_types/'):
            label='/'+ '/'.join(str(label).split('/')[-2:]) if len(str(label).split('/'))>3 else '电缆结构与物性'
        rows.append([label,origins.get(source.get('kind'),'保存来源'),f'依据 {references.index(ref)+1}'])
    return table(['输入项目','来源类型','依据'],rows or [['工况与结构','保存输入','未逐项登记来源']],[2.5,1,1.5])+''.join(paragraph(f'依据 {i}：{ref}') for i,ref in enumerate(references,1))


def summary(run):
    """Use the recommended case and its actual operating state, never a new solve."""
    from .report import recommended_case, task_answer
    if run.get('fem_evidence'):
        from .fem_evidence import values
        metrics,_=values(run,run['convergence'])
        hottest=metrics['hottest_temperature_k'];margin=metrics['margin_k']
        boundary=run['fem_evidence']['scope'][0]['fem']
        answer=('保存负荷超出温限' if margin is not None and margin<0 else '保存负荷满足温限' if margin is not None else '保存温度场已核验')+'；有限元 · 已收敛（网格与扩域均 < '+number(run['convergence'].get('verdict',{}).get('tolerance_k',.1))+' K）· '+boundary+'。'
        return answer,[number(metrics['allowable_current_a'],1)+' A',number(hottest-273.15 if hottest is not None else None)+' °C',number(margin)+' K']
    definition=run['snapshot']['definition'];driver=definition.get('driver',{})
    selection=driver.get('kind')=='selection'
    if selection:
        from .report_selection import context
        source=context(run)
        if source:return source['answer'],[number(source['quantity']['value'],1)+' A',number(source['temperature_c'])+' °C',number(source['margin_k'])+' K']
        return _selection(run)[2],['未输出 A','未输出 °C','未输出 K']
    preferred,selected,answer,_=_selection(run) if selection else (recommended_case(run) if driver else None,None,None,None)
    if answer is None:
        answer=next((b['text'] for b in _Blocks(task_answer(run)).blocks if b['kind']=='p'),'未取得可用结论。') if driver else '保存温度场结果；详细校核见结果表。'
    cases=[c for c in run['output'].get('cases',[]) if c['status']=='succeeded' and (not preferred or c['case_id']==preferred)][:1]
    if driver.get('kind') in ('sweep','batch') and cases:answer='首个成功保存工况的摘要；全部扫描点见结果表。'+answer
    correction=next((c.get('artifacts',{}).get('x-cablesim.gb50217-correction') for c in cases if c.get('artifacts',{}).get('x-cablesim.gb50217-correction')),None)
    if correction:
        return answer,[number(correction['corrected_current_a'])+' A',number(correction['baseline']['baseline_current_a'])+' A',number(correction['total_factor'],4)]
    trace=next((c.get('artifacts',{}).get('x-cablesim.iec60287-trace') for c in cases if c.get('artifacts',{}).get('x-cablesim.iec60287-trace')), {})
    states=trace.get('operating',{}).get('cable_states',[])
    currents=[r['value'] for c in cases for r in c.get('results',[]) if r['key']=='ampacity' and r.get('status')=='available']
    temperatures=[r['value']-273.15 for c in cases for r in c.get('results',[]) if r['key']=='conductor_temperature' and r.get('status')=='available']
    margins=[s['margin_k'] for s in states if s.get('margin_k') is not None]
    if states:temperatures=[s['conductor_temperature_c'] for s in states if s.get('conductor_temperature_c') is not None]
    capacity=selected[0].get('value') if selected else min(currents,default=None)
    return answer, [number(capacity,0)+' A',number(max(temperatures,default=None))+' °C',number(min(margins,default=None))+' K']


def grouped_results(cases, names, document):
    groups=[('温度与电流',['ampacity','x-cablesim.iec60287.current','conductor_temperature','sheath_temperature','surface_temperature']),
        ('损耗',['losses.conductor','losses.sheath','x-cablesim.iec60287.losses.armour','losses.dielectric','losses.total']),
        ('热阻',['thermal_resistance.insulation','x-cablesim.iec60287.thermal_resistance.bedding','thermal_resistance.oversheath','thermal_resistance.external','x-cablesim.iec60287.thermal_resistance.duct_air','x-cablesim.iec60287.thermal_resistance.duct_wall']),
        ('电气参数',['ac_resistance','capacitance','loss_factor.sheath','x-cablesim.iec60287.loss_factor.armour','x-cablesim.iec60287.temperature_rise.mutual'])]
    duct=any(d.get('type')=='duct' for s in document.get('sections',[]) for d in s.get('enclosures',[]))
    html=''
    for case in cases:
        if case['status']!='succeeded':
            html+=paragraph((case.get('error') or {}).get('message','工况未取得结果。'));continue
        results=[r for r in case.get('results',[]) if r.get('status')=='available' and (duct or not r['key'].endswith(('duct_air','duct_wall')))]
        capacities=[r for r in results if r['key']=='ampacity' and r.get('rating_basis')]
        if capacities:
            from .report_selection import basis_text
            html+='<h3>允许电流与口径</h3>'+table(['回路','允许电流 / A','保存口径'],[
                [names.get(r.get('entity'),'整体工况'),number(r['value'],1),basis_text(r['rating_basis'],names)] for r in capacities],[1.2,1.2,2.6])
            results=[r for r in results if r not in capacities]
        for title,keys in groups:
            keys=[k for k in keys if any(r['key']==k for r in results)]
            if not keys:continue
            for offset in range(0,len(keys),4):
                columns=keys[offset:offset+4];units={k:_metric(next(r for r in results if r['key']==k))[1] for k in columns}
                by_entity={}
                for r in results:
                    if r['key'] in columns:by_entity.setdefault(r.get('entity'),{})[r['key']]=_metric(r)[0]
                rows=[]
                for entity,values in by_entity.items():
                    label=names.get(entity,'整体工况');parts=label.split(' · ',1)
                    rows.append([parts[0],parts[1] if len(parts)>1 else '整体',*[values.get(k,'—') for k in columns]])
                heading='表面温度' if columns==['surface_temperature'] else title
                html+='<h3>'+heading+'</h3>'+table(['回路','相别',*[QUANTITIES[k]+' / '+units[k] for k in columns]],rows,[1.2,.7]+[1.2]*len(columns))
    return html


def chapters(runs, audience):
    """Human-facing chapters; customer text never includes hashes or raw JSON."""
    from .report import recommended_case, task_answer
    sections=[]
    for run in runs:
        definition=run['snapshot']['definition'];selection=definition['driver']['kind']=='selection'
        preferred,selected,answer,comparison=_selection(run) if selection else (recommended_case(run),None,None,None)
        if run.get('fem_evidence'):answer=summary(run)[0]
        if answer is None:
            parsed=_Blocks(task_answer(run)).blocks
            answer=next((p['text'] for p in parsed if p['kind']=='p'),'未取得可用结论。')
        document=_input(run,preferred);names=_names(document)
        if run.get('freshness')!='current':answer='历史运行结论：'+answer
        body='<h2>1. 计算结论</h2>'+paragraph(answer)
        common_fem=any(r.get('key')=='ampacity' and r.get('case')=='rating-simultaneous' for r in run.get('fem_evidence',{}).get('rows',[]))
        correction_method=definition['method']['plugin_id']=='cablesim.gb50217-correction'
        body+=paragraph('载流量口径：'+('有出处的单根基准按保存工况校正；不输出负荷温度，不等同于 IEC 热路求解。' if correction_method else '全回路共同能力，所有回路同时等负荷。' if common_fem else _basis(run)))
        if run.get('freshness')!='current':body+=paragraph('该运行与当前输入或已安装方法版本不同。本文仅复现保存工况，不能作为当前版本的重新校核。')
        body+='<h2>2. 工况与输入</h2>'+table(['输入项目','保存值'],_condition_rows(document),[1.25,3.75])
        engineering_html=''
        if selected:
            engineering=selected[1].get('engineering_parameters',{}).get('values',{})
            if engineering:
                engineering_html='<h3>采用的工程设计参数</h3>'+paragraph('以下为保存的工程师给定参数，不是厂家实测声明。')
                engineering_html+=table(['参数','采用值','单位'],[[PARAMETERS.get(k,'工程参数'),*engineering_value(k,v)] for k,v in engineering.items()],[2,1.6,1.4])
        sections.append(body)
        body='<h2>3. '+('候选比较与推荐' if selection else '结果表')+'</h2>'
        if comparison:body+=comparison
        else:
            body+=grouped_results(run['output'].get('cases',[]),names,document)
        cases=[c for c in run['output'].get('cases',[]) if c['status']=='succeeded' and (not preferred or c['case_id']==preferred)]
        trace=next((c.get('artifacts',{}).get('x-cablesim.iec60287-trace') for c in cases if c.get('artifacts',{}).get('x-cablesim.iec60287-trace')), {})
        for case in cases:
            correction=case.get('artifacts',{}).get('x-cablesim.gb50217-correction')
            if correction:
                body+='<h3>GB 50217 校正系数</h3>'+table(['校正项目','采用系数','取值条件','出处'],[
                    [r['label'],number(r['factor'],4),r['condition_text'],r['record']['citation']] for r in correction['coefficients']],[1,1,1.5,2.5])
                body+=paragraph('基准 '+number(correction['baseline']['baseline_current_a'])+' A；总系数 '+number(correction['total_factor'],4)+'；校正后 '+number(correction['corrected_current_a'])+' A。')
                body+=paragraph(correction['baseline']['baseline_source']+' · 第 '+str(correction['baseline']['baseline_page'])+' 页；由工程师核对，不是厂家保证值。')+paragraph(correction['scope'])
        if trace.get('crossing_derating'):
            row=trace['crossing_derating'][0]
            body+='<h3>交叉热源降额</h3>'+table(['降额前 / A','降额后 / A','降额系数','交叉温升 / K'],[[number(row['baseline_current_a']),number(row['derated_current_a']),number(row['derating_factor'],4),number(row['crossing_rise_k'],2)]],[1,1,1,1])
            body+=paragraph(row['clause'])+paragraph(row['scope'])
            body+=table(['热源','轴线深度 / m','净距 / m','交叉角 / rad','发热 / W/m','出处'],[[s['label'],number(s['depth_m'],3),number(s['net_clearance_m'],3),number(s['angle_rad'],3),number(s['heat_w_m'],2),s['source']] for s in row['sources']],[1,1,1,1,1,2])
        if selection and selected and trace:
            from .report_selection import context
            body+='<h3>'+('推荐型号' if context(run)['recommended'] else '最接近候选（不满足）')+'：保存负荷下的温度与损耗</h3>'
            states=trace.get('operating',{}).get('cable_states',[])
            body+=table(['回路','负荷 / A','导体 / °C','温限余量 / K','总损耗 / W/m'],[[names.get(s['entity'],'电缆'),number(s['current_a'],0),number(s['conductor_temperature_c']),number(s['margin_k']),number(s['total_loss_w_m'],2)] for s in states],[1.8,1,1,1.2,1.2])
        sections.append(body)
        method=definition['method'];clauses=list(dict.fromkeys(trace.get('sources',[])))
        for case in cases:
            for artifact in case.get('artifacts',{}).values():
                if isinstance(artifact,dict):clauses.extend(c for c in artifact.get('clauses',[]) if c not in clauses)
        body='<h2>4. 计算依据与方法版本</h2>'+table(['项目','采用版本'],[
            ['计算方法',PLUGIN_NAMES.get(method['plugin_id'],'已保存插件方法')],
            ['插件版本',method['version']],['方法能力',{'steady-rating':'稳态载流量','steady':'稳态计算'}.get(method['capability'],'保存的计算能力')],['运行时间（本地）',local_time(run.get('finished') or run.get('created'))],
            ['输入 / 研究修订',str(run['snapshot'].get('workspace_revision','未记录'))+' / '+str(run['snapshot'].get('study_revision','未记录'))]], [1.3,3.7])
        body+='<h3>标准条款</h3>'+''.join(paragraph(c) for c in clauses or ['该保存运行未提供可引用条款；不补写推测依据。'])
        if trace.get('electrical_basis'):body+='<h3>方法适用口径</h3>'+paragraph(trace['electrical_basis'])
        from .material_basis import saved_rows
        constants=[row for case in cases for row in saved_rows(case)]
        if constants:
            body+='<h3>材料常数与标准出处</h3>'+table(['材料常数','采用值 / 单位','标准出处与核对'],[
                [row['label'],str(row['value'])+' '+row['unit'],row.get('citation','')+' · '+row['status_label']+
                 (f"；依据值 {row['reference_value']} {row['unit']}；差 {row['difference']:.4g}" if row['status']=='different' else '')+
                 ('；'+row['note'] if row.get('note') else '')] for row in constants],[1.6,1.1,2.3])
        body+=engineering_html
        body+='<h3>逐项输入来源</h3>'+input_sources(document,definition,selected[1]['payload'] if selected else None)
        body+=paragraph('客户版保留结论、工况、结果和依据；内部审核版另附完整输入快照、诊断和验证证据。')
        sections.append(body)
        if audience=='internal':
            body='<h2>附录：来源摘要</h2>'+paragraph('完整输入快照、完整精度结果、诊断与验证证据保存在本 PDF 的 JSON 附件中，可由支持附件的 PDF 阅读器导出。原始字段和标识完整保留，纸面使用工程名称。')+table(['证据','保存记录'],[['源运行',run['id']],['输入 SHA256',run['input_digest']],['输出 SHA256',run['output_digest']],['方法发行 SHA256',method.get('release_digest','未记录')],['结果完整性',run.get('integrity','未记录')],['运行状态',run.get('status')],['时效状态',run.get('freshness')]], [1.1,3.9])
            body+=table(['输入位置','来源及核对状态'],[[p,clean(s.get('reference'))+'；'+('已核对' if s.get('reviewed') else '未核对')] for p,s in definition.get('input_sources',{}).items()] or [['来源','未记录']],[1.3,3.7])
            for candidate in run['snapshot'].get('candidate_snapshots',[]):
                body+='<h3>'+escape(candidate['payload']['name'])+'</h3>'+table(['证据','摘要'],[['候选内容 SHA256',candidate['digest']],['候选状态',candidate['state']],['原始记录 SHA256',candidate.get('origin',{}).get('digest','未记录')],['补全工件 SHA256',candidate.get('preparation',{}).get('artifact_sha256','未记录')]], [1.3,3.7])
                references=list(dict.fromkeys(s['reference'] for s in candidate['payload'].get('sources',{}).values()))
                body+=''.join(paragraph(s) for s in references)
            sections.append(body)
    return sections


def validate_sources(runs):
    if not runs:raise ValueError('请选择至少一个已保存运行。')
    for run in runs:
        if run.get('integrity')!='verified' or fingerprint(run['snapshot'])!=run['input_digest'] or fingerprint(run['output'])!=run['output_digest']:
            raise ValueError('计算书源运行完整性校验失败。')
        from .report_selection import context
        context(run)
        for assessment in run['output'].get('assessment',[]):
            if assessment.get('value') is not None:context(run,assessment['case_id'])


def render_pdf(runs, audience='customer', *, generated_at=None, attachments=None):
    validate_sources(runs)
    return _render_pdf(runs,audience,generated_at=generated_at,attachments=attachments)


def render_editions(runs, *, generated_at=None, attachments=None):
    """Validate once, format both editions from the same private source objects."""
    from .report_reads import checkpoint
    checkpoint('consistency');validate_sources(runs)
    editions={}
    for audience in ('customer','internal'):
        checkpoint('pdf_'+audience)
        editions[audience]=_render_pdf(runs,audience,generated_at=generated_at,attachments=attachments)
    return editions


def _render_pdf(runs, audience, *, generated_at=None, attachments=None):
    if audience not in ('customer','internal'):raise ValueError('文档版本须为 customer 或 internal。')
    import fitz
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
    from reportlab.platypus import SimpleDocTemplate, Paragraph, LongTable, TableStyle, PageBreak, KeepTogether

    font='CableChinese'
    with _font_lock:
        if font not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont(font,BytesIO(fitz.Font('cjk').buffer)))
    timestamp=local_time(generated_at or datetime.now(timezone.utc).isoformat(timespec='seconds'))
    first=runs[0];definition=first['snapshot']['definition'];study=definition.get('title','研究计算书')
    project=first['snapshot'].get('workspace_state',{}).get('domain',{}).get('name') or '未记录工程名称'
    version='输入修订 '+str(first['snapshot'].get('workspace_revision','—'))+' / 研究修订 '+str(first['snapshot'].get('study_revision','—'))
    historical=any(r.get('freshness')!='current' for r in runs)
    edition='客户版' if audience=='customer' else '内部审核版'
    output=BytesIO();width,height=A4
    doc=SimpleDocTemplate(output,pagesize=A4,leftMargin=42,rightMargin=42,topMargin=58,bottomMargin=52,
        title=study+' · 研究计算书',subject=edition,creator='CableSimPro',author='')
    normal=ParagraphStyle('Body',fontName=font,fontSize=10.5,leading=16,wordWrap='CJK',spaceAfter=8)
    styles={'p':normal,'h1':ParagraphStyle('Title',parent=normal,fontSize=21,leading=28,spaceAfter=12,keepWithNext=True),
        'h2':ParagraphStyle('Chapter',parent=normal,fontSize=15,leading=21,spaceBefore=12,spaceAfter=9,keepWithNext=True),
        'h3':ParagraphStyle('Section',parent=normal,fontSize=12,leading=18,spaceBefore=10,spaceAfter=7,keepWithNext=True),
        'cell':ParagraphStyle('Cell',parent=normal,leading=15,spaceAfter=0)}
    from .report_reads import checkpoint
    checkpoint('layout_'+audience)
    aliases=paper_aliases(runs);texts={}
    def p(value,style):
        if value not in texts:texts[value]=paper_text(runs,value,aliases=aliases)
        value=texts[value]
        if audience=='customer':value=re.sub(r'[a-f0-9]{64}',lambda m:m[0][:12],value)
        value=escape(value).replace('\n','<br/>')
        value=re.sub(r'[a-f0-9]{64}',lambda m:'<font name="Courier" size="9">'+' '.join(m[0][i:i+16] for i in range(0,64,16))+'</font>',value)
        return Paragraph(value,style)
    def flow(html):
        out=[]
        for block in _Blocks(html).blocks:
            if block['kind']!='table':out.append(p(block['text'],styles[block['kind']]));continue
            rows=block['rows'];weights=block['widths'] or [1]*len(rows[0])
            t=LongTable([[p(c,styles['cell']) for c in row] for row in rows],colWidths=[doc.width*w/sum(weights) for w in weights],repeatRows=1,splitByRow=1,spaceAfter=14,hAlign='LEFT')
            t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eeeeee')),
                ('GRID',(0,0),(-1,-1),.25,colors.HexColor('#cccccc')),('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#808080')),
                ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
            out.append(t)
        return out
    class NumberedCanvas(canvas.Canvas):
        def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.saved=[]
        def showPage(self):
            if len(self.saved)>=100:raise ValueError('计算书超过100页，请缩小交付范围。')
            self.saved.append(dict(self.__dict__));self._startPage()
        def save(self):
            total=len(self.saved)
            for state in self.saved:
                self.__dict__.update(state);self.setFont(font,10)
                self.drawString(42,height-31,'研究计算书');self.drawRightString(width-42,height-31,edition+' · '+version)
                self.setStrokeColor(colors.HexColor('#a0a0a0'));self.setLineWidth(.45);self.line(42,height-40,width-42,height-40);self.line(42,39,width-42,39)
                self.drawString(42,24,('历史运行复现 · ' if historical else '')+'待人工审核');self.drawRightString(width-42,24,f'第 {self._pageNumber} 页 / 共 {total} 页')
                super().showPage()
            super().save()
    version_labels=list(dict.fromkeys(clean((run.get('version_status') or {}).get('display_name')) for run in runs))
    version_labels=[label for label in version_labels if label]
    cover_rows=[['工程名称',project],['研究名称',study],
        ['图号 / 文件号','CS-'+first['input_digest'][:12].upper()],['修订',version],
        ['运行编号与摘要','运行 '+str(first.get('sequence') or 1)+' · 输入 '+first['input_digest'][:8 if audience=='customer' else 12]+' · 结果 '+first['output_digest'][:8 if audience=='customer' else 12]],
        ['日期（本地）',timestamp],['文档版本',edition],
        ['文件状态','历史运行复现 · 待人工审核' if historical else '待人工审核']]
    if version_labels:cover_rows.append(['版本状态','；'.join(version_labels)])
    cover='<h1>研究计算书</h1>'+table(['文件信息','保存内容'],cover_rows,[1.4,3.6])
    cover+='<h3>编制与审核签字</h3>'+table(['设计（编制）','校核','审核（批准）'],[['签字：____________','签字：____________','签字：____________'],['日期：____________','日期：____________','日期：____________']],[1,1,1])
    answer,metrics=summary(first)
    saved_input=_input(first)
    currents=sorted({i for load in saved_input.get('load_cases',[]) for i in load.get('currents',{}).values() if isinstance(i,(int,float))})
    if currents:answer=' / '.join(number(i,0) for i in currents)+' A 工况：'+answer
    correction_method=definition['method']['plugin_id']=='cablesim.gb50217-correction'
    cover+='<h2>结论摘要</h2>'+paragraph(answer)+table(['校正后允许电流','基准载流量','总校正系数'] if correction_method else ['允许电流','最热导体温度','温限余量'],[metrics],[1,1,1])
    cover+=paragraph('适用方法：'+PLUGIN_NAMES.get(definition['method']['plugin_id'],'保存方法')+' '+definition['method']['version']+'；具体标准条款见计算依据。')
    references=[]
    for source_run in runs:
        references.append(str(source_run.get('fem_evidence',{}).get('boundary_source',{}).get('standard','')))
        for case in source_run['output'].get('cases',[]):
            for artifact in case.get('artifacts',{}).values():
                if isinstance(artifact,dict):references.extend(str(r) for r in artifact.get('sources',[]) + artifact.get('clauses',[]))
    standards=list(dict.fromkeys(re.findall(r'IEC \d+(?:-\d+)+(?::\d{4})?|GB 50217(?:—2018)?',' '.join(references))))
    cover+=paragraph('适用标准：'+'；'.join(standards or ['保存运行未登记引用标准']))
    fem_basis=first.get('fem_evidence',{}).get('rows',[])
    common_fem=any(r.get('key')=='ampacity' and r.get('case')=='rating-simultaneous' for r in fem_basis)
    cover+=paragraph('载流量口径：'+('单根基准按实际敷设校正；不输出负荷温度。' if correction_method else '全回路共同能力，所有回路同时等负荷提升。' if common_fem else _basis(first)))
    story=flow(cover)
    if attachments:
        from base64 import b64decode
        from .report_attachments import chapter_html
        from reportlab.platypus import Image
        items = attachments.get('section_images', []) + attachments.get('field_images', []) + attachments.get('cad_images', []) + ([attachments['fem_chapter']] if attachments.get('fem_chapter') else [])
        for body, item in zip(chapter_html(attachments, audience), items):
            story.append(PageBreak());story.extend(flow(body))
            image = Image(BytesIO(b64decode(item['png_base64'], validate=True)))
            factor = min(doc.width/image.imageWidth, (doc.height*0.65)/image.imageHeight)
            image.drawWidth = image.imageWidth*factor; image.drawHeight = image.imageHeight*factor
            story.append(image)
    for body in chapters(runs,audience):
        story.extend(flow(body))
    arranged=[]
    for item in story:
        if isinstance(item,LongTable) and item.wrap(doc.width,doc.height)[1]<doc.height-45:
            headings=[]
            while arranged and isinstance(arranged[-1],Paragraph) and arranged[-1].getKeepWithNext():headings.insert(0,arranged.pop())
            arranged.append(KeepTogether([*headings,item]))
        else:arranged.append(item)
    checkpoint('pdf_'+audience)
    doc.build(arranged,canvasmaker=NumberedCanvas)
    if audience=='internal':
        checkpoint('archive')
        import json
        from .report_reads import archive_runs
        with fitz.open(stream=output.getvalue(),filetype='pdf') as audit:
            audit.embfile_add('saved-runs.json',json.dumps(archive_runs(runs),ensure_ascii=False,indent=2).encode('utf-8'),filename='saved-runs.json',desc='完整输入、完整精度结果与证据；大场二进制数组以来源工件摘要和保存运行地址引用，原件保留在工程库；未重新计算。')
            return audit.tobytes(garbage=3,deflate=True)
    return output.getvalue()


if __name__=='__main__':
    import argparse,json
    from pathlib import Path
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--audience',choices=['customer','internal'],default='customer');args=parser.parse_args()
    data=json.loads(args.source.read_text(encoding='utf-8'));runs=data if isinstance(data,list) else [data]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_bytes(render_pdf(runs,args.audience))
