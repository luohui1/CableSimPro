"""Collect existing evidence, without running solvers, into immutable library snapshots."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[3]
DATA=ROOT/'.data/simulation'
SHORT_TITLES={
    'T01':'排管电缆载流量','T02':'排管内自然对流','T03':'隧道电缆温度场','T04':'沟槽电缆载流量',
    'T05':'埋地电缆稳态与暂态','T06':'分层土壤热模型','T07':'分层土壤工程算例','T08':'同沟槽双缆温升',
    'T09':'回填与土壤温度分布','T10':'回填尺寸与载流量','T11':'土壤热湿迁移','T12':'直埋三相应急载流量',
    'T13':'电缆交叉降额方程','T14':'电缆交叉降额曲线','T15':'交叉电缆暂态温升','T16':'非等温地表载流量',
    'T17':'地聚物回填散热','T18':'桥架电缆载流量','T19':'平排电缆电热温升','T20':'单芯电缆非线性温升',
    'E01':'分割导体三维绞合损耗','E02':'并联电缆电热耦合','E03':'直流电缆电场与温度',
    'E04':'多级绞线交流损耗','E05':'三相电缆接地磁场','E06':'钢铠装丝损耗','E07':'海缆铠装损耗',
    'E08':'护套与铠装耦合损耗','E09':'绞线周围磁场','E10':'隧道多物理场载流量','E11':'超高压隧道电热流',
    'E12':'埋地电缆涡流与热场','E13':'交叉互联护套损耗','E17':'双圆导体交流电阻',
    'E18':'无源圆导体感应涡流','E19':'双圆导体表面电流','E20':'螺旋对称涡流场',
    'B01':'绝缘圆线导热基准','B02':'CIGRE 载流量验证集','B03':'绝缘电缆热额定指南',
    'B04':'IEC 稳态电流与损耗','B05':'IEC 电缆热阻','B06':'中压电缆周期载流量',
    'B07':'高压周期与应急载流量','B08':'土壤干燥周期载流量','B09':'400 kV 电缆暂态温升','B10':'四芯电缆电热场',
}


def plain(text):
    text=re.sub(r'\[([^\]]+)\]\([^)]+\)',r'\1',text)
    return text.replace('**','').replace('`','').strip()


def load(relative,item):
    path=ROOT/relative
    if not path.exists():return None
    raw=path.read_bytes()
    key=sha256(raw).hexdigest();archive=DATA/'library/evidence'/(key+'.json');archive.parent.mkdir(parents=True,exist_ok=True)
    if not archive.exists():archive.write_bytes(raw)
    elif sha256(archive.read_bytes()).hexdigest()!=key:raise ValueError('Immutable evidence archive has been modified: '+key)
    item['evidence'].append({'path':relative,'sha256':key,'archived_path':archive.relative_to(ROOT).as_posix()})
    return json.loads(raw)


def base_items():
    result={}
    tutorial_titles={'C01':'海缆截面几何','C02':'三相电容与充电场','C03':'充电场与护套接地','C04':'感应损耗与磁场',
                     'C05':'感应电压与接地互联','C06':'电热耦合与接触热阻','C07':'三维绞合几何与网格','C08':'三维感应效应'}
    for line in (ROOT/'docs/plugins/SIMULATION_TARGETS.md').read_text('utf-8').splitlines():
        match=re.match(r'\| ([TEBC]\d{2}) (.+)',line)
        if not match:continue
        parts=[p.strip() for p in line.strip('|').split('|')]
        ident=match[1];citation=parts[0][len(ident):].strip()
        bold=re.search(r'\*\*(.+?)\*\*',citation)
        title=bold[1] if bold else plain(citation)
        title=tutorial_titles.get(ident,title)
        urls=re.findall(r'\]\((https?://[^)]+)\)',citation)
        kind='comsol' if ident.startswith('C') else 'benchmark' if ident=='B01' else 'standard' if ident.startswith('B') else 'paper'
        status='capability_gap' if ident in ('C01','C05','C06','C07','C08','E20') else 'missing_data'
        result[ident]={'id':ident,'title':title,'short_title':SHORT_TITLES.get(ident,title),'citation':plain(citation),'kind':kind,'status':status,
                      'url':urls[0] if urls else None,'scope':plain(parts[1]),'coverage':plain(parts[-1]),
                      'limitations':[plain(parts[2])], 'reference_location':plain(parts[3] if len(parts)>4 else parts[2]),
                      'rows':[],'convergence':[],'inputs':[],'evidence':[],'assumptions':[],
                      'has_results':False,'count_as_source':True,'max_relative_deviation':None,'mesh_note':'尚无网格收敛证据'}
    return result


def normalized(row,variant='default',native=None):
    return {'id':variant+'/'+str(row.get('id',row.get('quantity','value'))),'variant':variant,
            'quantity':row.get('quantity'),'entity':row.get('entity'),'unit':row.get('unit','1'),'probe_index':row.get('probe_index'),
            'point_m':row.get('point_m'),'time_s':row.get('time_s'),
            'reference':row.get('reference'),'reference_approximate':row.get('reference_approximate',False),'open_source':row.get('calculated'),'comsol':native,
            'difference':row.get('difference'),'relative_difference':row.get('relative_difference') if row.get('status')!='not_comparable' and row.get('unit') not in ('K','deg') else None,
            'comsol_relative_difference':(row['calculated']-native)/abs(native) if native and row.get('calculated') is not None and row.get('unit') not in ('K','deg') else None,
            'comsol_difference':row['calculated']-native if native is not None and row.get('calculated') is not None else None,
            'status':row.get('status','not_assessed'),'source':row.get('source'), 'reason':row.get('reason'),
            'tolerance':row.get('tolerance')}


def paper(item,name):
    report=load('.data/simulation/'+name+'/report.json',item)
    if not report:return
    # The audited three-way files join identical physical-input digests and
    # preserve raw-field/statistical differences. Do not join an older P1 or
    # different-exterior report to the newest COMSOL row merely by target id.
    three=load('.data/simulation/comsol-comparison/'+name+'/three-way.json',item)
    quadratic=load('.data/simulation/comsol-comparison/'+name+'/open-quadratic.json',item)
    if three and quadratic:
        report={**report,'scope':three['scope'],'frozen_inputs':three.get('frozen_inputs',[]),
                'status':three['status'],'variants':[{'id':'default','finest':three,'mesh_sequence':quadratic['mesh_sequence']}]}
        item['limitations'].append('该历史P2参考序列为直接GetDP脚本调用，保留求解器版本/二进制及输入摘要，未保存宿主插件清单版本。')
    item['scope']=report['scope'];item['inputs']=report.get('frozen_inputs',[])
    item['assumptions']=report.get('assumptions',[])
    native=load('.data/simulation/comsol-comparison/'+name+'/report.json',item)
    native_cases=[] if not native else native.get('mesh_sequence',[])
    native_rows={r['id']:r.get('calculated') for r in (native_cases[-1].get('rows',[]) if native_cases else [])}
    for variant in report.get('variants',[]):
        finest=variant['finest']
        matched=next((v for v in (native or {}).get('variants',[]) if v['id']==variant['id']),None)
        matching_rows={r['id']:r.get('calculated') for r in matched['finest'].get('rows',[])} if matched else native_rows
        same_problem=matched and finest.get('numerical_evidence',{}).get('problem_sha256')==matched['finest'].get('numerical_evidence',{}).get('problem_sha256')
        for r in finest.get('rows',[]):
            reference=r.get('reference_solver_value') if three and r.get('solver_comparison_status')=='same_problem' else matching_rows.get(r['id']) if same_problem else None
            item['rows'].append(normalized(r,variant['id'],reference))
        if matched:
            for level in matched['mesh_sequence']:
                item['convergence'].extend({'variant':variant['id'],'solver':'comsol','quantity':r['id'],'mesh_size_m':level['mesh_size_m'],'nodes':level.get('numerical_evidence',{}).get('nodes'),'value':r.get('calculated')} for r in level.get('rows',[]))
        if finest.get('run'):item.setdefault('runs',[]).append(finest['run'])
        elif finest.get('numerical_evidence',{}).get('solver'):
            solver=finest['numerical_evidence']['solver'];item.setdefault('runs',[]).append({'plugin_id':solver.get('name'),'plugin_version':solver.get('version'),'method_version':'直接求解器记录；宿主插件版本未保存'})
        item['assumptions'].extend(finest.get('assumptions',[]))
        for level in variant.get('mesh_sequence',[]):
            values=level.get('quantities') or {r['id']:r.get('calculated') for r in level.get('rows',[])}
            evidence=level.get('numerical_evidence',level)
            item['convergence'].extend({'variant':variant['id'],'solver':'open_source','quantity':k,
                'mesh_size_m':level.get('mesh_size_m'),'nodes':evidence.get('nodes'), 'value':v} for k,v in values.items())
    for level in native_cases:
        item['convergence'].extend({'variant':'default','solver':'comsol','quantity':r['id'],'mesh_size_m':level.get('mesh_size_m'),
            'nodes':level.get('numerical_evidence',{}).get('nodes'),'value':r.get('calculated')} for r in level.get('rows',[]))
    item['status']='reproduced' if item['id'] in ('E17','E19') and report.get('status')=='matched' else 'partial'
    item['mesh_note']='逐档真实网格及量值；收敛趋势不等于网格无关性认证'


def standard_cases(items):
    parent=items['B02'];parent['count_as_source']=False
    data=load('.data/tb880/validation.json',parent)
    if data:
        for n in (1,2,3):
            ident='B02-'+str(n)
            item={**parent,'id':ident,'title':'CIGRE TB 880 · Case 0-'+str(n),'scope':'已声明的稳态算例及其接地/热阻变体',
                  'short_title':'TB 880 算例 0-'+str(n),
                  'evidence':list(parent['evidence']),'rows':[],'convergence':[],'inputs':[], 'status':'reproduced','count_as_source':True,
                  'mesh_note':'不适用：IEC代数/热路迭代，非有限元；同算例变体不重复计数',
                  'limitations':['采用TB880参考版本约定；IEC2023公式结果另列，不能混为同一参考。'],
                  'runs':[{'plugin_id':'cablesim.iec60287','plugin_version':data.get('package_version'),'method_version':data.get('method_version')}],
                  'coverage':'受控标准算例结果，记录保留执行时的插件版本'}
            for row in data['summaries']:
                if re.match('tb880-case-0-'+str(n)+r'(?:-|$)',row['case']):
                    delta=row['difference_a'];ref=row['published_a']
                    item['rows'].append({'id':row['case'],'variant':row['case'],'quantity':'ampacity_a','entity':'circuit','unit':'A',
                        'reference':ref,'open_source':row['computed_a'],'comsol':None,'difference':delta,'relative_difference':delta/ref,
                        'status':'not_assessed','source':'CIGRE TB880:2022 PDF '+row['pages'],'reason':'COMSOL未按该标准代数算例运行；不得填入其他几何的结果。'})
            if item['rows']:items[ident]=item
    parent['status']='partial' if data else parent['status']
    for number,label in [(1,'132kV 铜丝与铝箔屏蔽'),(2,'30kV 三芯钢丝铠装'),(4,'33kV 铜线屏蔽')]:
        item={**parent,'id':'B02-case'+str(number),'title':'CIGRE TB880 · Case '+str(number),'short_title':'TB 880 · '+label,
              'evidence':[],'rows':[],'convergence':[],'inputs':[],'assumptions':[],'count_as_source':True}
        report=load('.data/tb880/complete-references/case-'+str(number)+'.json',item)
        if not report:continue
        item.update(rows=[normalized(r,r.get('variant','default')) for r in report['rows']],convergence=report.get('convergence',[]),
                    scope=report['scope'],coverage=report['scope'],inputs=report['inputs'],limitations=report['limitations'],
                    status=report['coverage_status'],mesh_note=report['mesh_note'],runs=report.get('runs',[]))
        items[item['id']]=item
    placeholder={'evidence':[]}
    data=load('.data/iec60287/double-flat-validation.json',placeholder)
    if data:
        for section in ('8.2','8.3'):
            ident='B11-'+section.replace('.','')
            rows=[r for r in data['rows'] if r['case'].endswith(section)]
            items[ident]={'id':ident,'title':'IEC 60287-1-2:2023 · §'+section,'citation':'IEC 60287-1-2:2023 worked example §'+section,
                'short_title':'双回平排护套损耗 · 例'+str(int(section[-1])-1),
                'kind':'standard','status':'reproduced' if all(r['within_tolerance'] for r in rows) else 'partial','url':None,
                'scope':'六缆逐位置护套涡流系数和标准中间值','coverage':'保留原先声明容差与印刷值冲突','count_as_source':True,
                'limitations':[data['note']],'inputs':[data['source']],'evidence':placeholder['evidence'], 'convergence':[],
                'mesh_note':'不适用：标准系数插值，无有限元网格；打印舍入与插值误差分别核对','assumptions':[],
                'rows':[{'id':str(r['position']),'variant':'位置'+str(r['position']),'quantity':'lambda1','unit':'1',
                    'reference':r['printed_reference'],'open_source':r['calculated'],'comsol':None,'difference':r['difference'],
                    'relative_difference':r['difference']/r['printed_reference'],'status':'matched' if r['within_tolerance'] else 'outside_tolerance',
                    'source':data['source'],'tolerance':{'absolute':r['declared_tolerance']},'reason':None if r['within_tolerance'] else '超过预先声明容差；保留原印刷参考，未放宽阈值。'} for r in rows]}


def tutorials(items):
    item=items['C03'];report=load('.data/simulation/coupling-comparison/report.json',item)
    if report:
        for row in report['rows']:
            if not row['case'].startswith('tutorial03-'):continue
            variant=row['case'].replace('tutorial03-','')
            printed={'single_point':{'sheath_joule_loss':1500.,'sheath_voltage_peak':83.},
                     'both_ends':{'sheath_joule_loss':380.,'sheath_voltage_peak':21.},
                     'cross_bonded':{'sheath_joule_loss':85.,'sheath_voltage_peak':6.9}}[variant][row['quantity']]
            item['rows'].append({'id':row['case']+'/'+row['quantity'],'variant':row['case'].replace('tutorial03-',''),
                'quantity':row['quantity'],'unit':row['unit'],'reference':printed,'reference_approximate':True,'open_source':row['calculated'], 'comsol':row['comsol'],
                'difference':row['calculated']-printed,'relative_difference':(row['calculated']-printed)/printed,'comsol_relative_difference':row.get('relative_difference'),
                'comsol_difference':row.get('difference'),
                'status':'not_assessed','source':'COMSOL 6.2 tutorial03 PDF7 approximate printed values and installed model re-solved','reason':'≈为教程舍入值，对原文差值包含舍入影响；COMSOL列为独立原生解。'})
        summary=load('.data/simulation/capacitive/open-summary.json',item) or []
        for r in summary:
            if r['label'].startswith('coax'):continue
            for metric,value in [('sheath_joule_loss',next((a['joule_loss_w'] for a in r['metrics']['regions'] if a['entity']=='sheath'),None)),('sheath_voltage_peak',r['metrics'].get('sheath_maximum_nodal_voltage_peak_v'))]:
                item['convergence'].append({'variant':r['label'].rsplit('-',1)[0],'quantity':metric,'solver':'open_source','nodes':r['nodes'],'value':value})
        item.update(status='reproduced',scope='教程式轴对称单支路的单点、双端、交叉互联充电场',mesh_note='三档径向/轴向网格；三种接地方式各自收敛',
                    limitations=['仅教程轴对称单支路；不覆盖任意三相接地网或感应互联。'])
    item=items['C04']
    for mode in (False,True):
        native=load(f'.data/simulation/comsol-tutorials/04-native-{mode}.json',item)
        series=[]
        for size in (.0015,.001):
            value=load(f'.data/simulation/comsol-tutorials/04-open-{mode}-{size}.json',item)
            if value:series.append(value)
        if not series:continue
        label='串联2.5D' if mode else '普通2D'
        circles=[load(f'.data/simulation/comsol-tutorials/04-{tag}-{mode}-0.0015.json',item) for tag in ('circle','circle128')]
        circles=[v for v in circles if v];current=circles[-1] if circles else series[-1]
        for k,v in current['totals_w_m'].items():
            other=(native or {}).get('totals_w_m',{}).get(k)
            printed={'conductor':47.,'screen':15. if mode else 13.,'sheath':15. if mode else 13.,'armor':.36 if mode else 7.6}.get(k)
            item['rows'].append({'id':label+'/'+k,'variant':label,'quantity':k+'_loss','unit':'W/m','reference':printed,'reference_approximate':printed is not None,
                'open_source':v,'comsol':other,'difference':v-printed if printed is not None else None,'relative_difference':None,
                'comsol_relative_difference':(v-other)/other if other else None,'status':'not_assessed',
                'source':'COMSOL 6.2 tutorial04 full magnetic geometry; original model re-solved', 'reason':'同一教程不同模型分别对照；尚未覆盖Milliken。'})
            item['convergence'].extend({'variant':label+' · h扫描','quantity':k+'_loss','solver':'open_source','nodes':r['nodes'],'mesh_size_m':r['mesh_size_m'],'value':r['totals_w_m'][k]} for r in series)
            item['convergence'].extend({'variant':label+' · 圆周离散','quantity':k+'_loss','solver':'open_source','nodes':r['nodes'],'mesh_size_m':r['mesh_size_m'],'value':r['totals_w_m'][k]} for r in circles)
    if item['rows']:item.update(status='partial',mesh_note='h扫描与圆周64→128段几何离散分开展示；主表使用最新128段结果',limitations=['普通2D和串联2.5D已计算；Milliken多匝均质及真实3D绞合未覆盖。'])
    # Subsequent full-geometry replay scripts publish this common report form.
    for ident,folder in [('C02','capacitive-three-phase'),('C06','thermal-full'),('C01','submarine-geometry'),('C02','capacitive-independent'),('C04','submarine-inductive'),('C06','submarine-coupled')]:
        item=items[ident];report=load('.data/simulation/'+folder+'/report.json',item)
        if report:
            item.update(rows=[normalized(r,r.get('variant','full-field'),r.get('comsol')) for r in report['rows']],convergence=report['convergence'],inputs=report.get('inputs',[]),
                scope=report['scope'],limitations=report.get('limitations',[]),status=report.get('coverage_status','partial'),mesh_note=report['mesh_note'],runs=report.get('runs',[]))
            if ident=='C01':item['count_as_source']=False


def build():
    items=base_items()
    example=load('.data/simulation/insulated-wire/report.json',items['B01'])
    if example and example.get('rows'):
        row=example['rows'][-1];item=items['B01']
        item.update(status='reproduced' if example.get('passed') else 'partial',mesh_note='四档真实有限元网格与官方解析温升对照',
                    inputs=[{'source':example['reference']}],limitations=['官方数学教学尺寸与材料，不代表真实电缆产品。'])
        item['rows']=[{'id':'default/centre-rise','variant':'default','quantity':'centre_temperature_rise','unit':'K',
            'reference':row['exact_centre_rise_k'],'open_source':row['centre_rise_k'],'comsol':None,
            'difference':row['centre_error_k'],'relative_difference':row['centre_relative_error'],'status':'matched' if example.get('passed') else 'outside_tolerance',
            'source':example['reference']}]
        item['convergence']=[{'variant':'default','quantity':'centre-rise','solver':'open_source','nodes':r['nodes'],'mesh_size_m':r['mesh_size_m'],'value':r['centre_rise_k']} for r in example['rows']]
    for ident,name in [('E02','thermal-cywinski'),('E03','thermal-jorgens'),('E05','eddy-lunca'),('E17','eddy-twin'),('E18','eddy-induced'),('E19','eddy-two-round')]:
        paper(items[ident],name)
    standard_cases(items);tutorials(items)
    for item in items.values():
        item['has_results']=any(r.get('open_source') is not None for r in item['rows'])
        deviations=[abs(r['relative_difference']) for r in item['rows'] if r.get('relative_difference') is not None and not r.get('reference_approximate')]
        item['max_relative_deviation']=max(deviations) if deviations else None
        cross=[abs(r['comsol_relative_difference']) for r in item['rows'] if r.get('comsol_relative_difference') is not None]
        item['max_comsol_deviation']=max(cross) if cross else None
        temperatures=[abs(r['comsol_difference']) for r in item['rows'] if r.get('unit')=='K' and r.get('comsol_difference') is not None]
        item['max_comsol_temperature_difference_k']=max(temperatures) if temperatures else None
        item['assumptions']=list(dict.fromkeys(item.get('assumptions',[])))
    created=datetime.now(timezone.utc).isoformat()
    snapshot={'schema':'cablesim.reproduction-library/1','created_at':created,'items':list(items.values()),
        'counting_rule':'Only distinct papers, named standard cases, or COMSOL tutorials with actual results. Partial and reproduced are separate. Meshes and physical variants do not add sources.'}
    folder=DATA/'library';(folder/'snapshots').mkdir(parents=True,exist_ok=True)
    raw=json.dumps(snapshot,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
    key=sha256(raw).hexdigest();(folder/'snapshots'/(key+'.json')).write_bytes(raw)
    index=folder/'index.json';history=json.loads(index.read_text('utf-8'))['history'] if index.exists() else []
    history.insert(0,{'id':key,'created_at':created})
    index.write_text(json.dumps({'current':key,'history':history},ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'targets':len(items),'snapshot':key,'with_results':[(i['id'],i['status']) for i in items.values() if i['has_results']]},ensure_ascii=False))


if __name__=='__main__':build()
