"""通过宿主调用现有IEC插件；复用其介损/管内热阻，不复制IEC公式。"""
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.plugin_host import Executor
from backend.domain.models import DomainDocument
from cablesim_simulation.report import digest


def inputs(ducts=False):
    document = json.loads((Path(__file__).resolve().parents[1]/'cases/thermal-iec.json').read_text('utf-8'))
    if ducts:
        section = document['sections'][0]
        for place in section['placements']:
            eid = 'enclosure/'+place['cable'].split('/')[1]
            place['enclosure'] = eid
            section['enclosures'].append({'id':eid,'type':'duct','x':place['x'],'z':place['z'],
                'material':'material/duct','inner_diameter':.14,'outer_diameter':.16,'contains':[place['cable']]})
    document = DomainDocument.model_validate(document).model_dump(mode='json')
    ids = [c['id'] for c in document['circuits'][0]['cables']]
    p = {'ks':1.,'kp':1.,'eddy':'ignored','solver':{'initial_sheath_temperature_c':50.,'current_tolerance_a':.001,'max_iterations':200},
         'per_cable_losses':{cid:{'ac_extra_factor':.03,'lambda1':.1} for cid in ids},
         'loss_input_source':'显式合成比较系数；仅隔离热模型差异，不宣称电磁计算验证'}
    if ducts:
        p['duct'] = {'u':1.87,'v':.312,'y_per_k':.0037,'initial_mean_air_temperature_c':30.}
    return document,p


def thermal_parameters(document,iec_run,operation,mesh_size=.003):
    case = iec_run.cases[0]
    if case.status != 'succeeded':
        raise ValueError('IEC插件计算失败：'+str(case.error))
    trace = case.artifacts['x-cablesim.iec60287-trace']
    selected = trace['operating']['cable_states'] if operation == 'temperature' else trace['circuit_ratings'][0]['cable_states']
    provenance = f'IEC plugin {iec_run.plugin_version}; run={iec_run.run_id}; input={iec_run.request_sha256}; artifact={case.artifact_digests["x-cablesim.iec60287-trace"]}'
    per_cable,duct_air = {},{}
    for s in selected:
        cid = s['entity']
        sources = {cid+'/conductor':0.,**{cid+f'/layer-{i}':0. for i in range(5)}}
        sources[cid+'/layer-1'] = s['dielectric_loss_w_m']
        per_cable[cid] = {'electrical':{'ac_extra_factor':.03,'sheath_loss_factor':.1,'sheath_layer_uid':cid+'/layer-3','source':'与IEC共同输入的显式合成系数'},
                          'fixed_layer_heat_w_m':sources,'prescribed_core_temperature_k':None,'equivalent_layers_acknowledged':False}
        place = next(p for p in document['sections'][0]['placements'] if p['cable'] == cid)
        if place['enclosure']:
            duct_air[place['enclosure']] = {'resistance_k_m_w':s['t4_air_gap_k_m_w'],'source':provenance+'; 固定为该IEC运行的收敛热阻'}
    bc = {'kind':'temperature','temperature_k':293.15,'h_w_m2_k':None,'emissivity':None}
    return {'controls':{'operation':operation,'mesh_size_m':mesh_size,'far_mesh_size_m':.3,'mesh_transition_m':.7,
                        'max_nodes':60000,'tolerance_k':1e-5,'max_iterations':150,'relaxation':.7,
                        'current_upper_a':1000.,'current_tolerance_a':.02,'rated_circuit':'circuit/one'},
            'domain_options':{'section_id':'section/ground','load_id':'load/steady','bounds_m':[-12,-12,12,0],
                              'boundaries':{n:bc for n in ('top','left','right','bottom')},'per_cable':per_cable,
                              'duct_air':duct_air,'source':provenance+'; 有限土壤矩形S=12与IEC半空间不同'}}


def compare(document,iec_parameters,executor,mesh_sizes=(.003,)):
    source = executor.run('cablesim.iec60287','steady-rating',[{'case_id':'iec','input':document,'parameters':iec_parameters}])
    if source.cases[0].status != 'succeeded':
        raise ValueError(source.cases[0].error)
    trace = source.cases[0].artifacts['x-cablesim.iec60287-trace']
    runs,rows = [],[]
    for h in mesh_sizes:
        for operation in ('temperature','ampacity'):
            parameters = thermal_parameters(document,source,operation,h)
            result = executor.run('cablesim.simulation','multiregion-thermal',[
                {'case_id':operation,'input':document,'parameters':parameters}])
            runs.append(asdict(result))
            c = result.cases[0]
            if c.status != 'succeeded':
                raise ValueError(c.error)
            summary = c.artifacts['x-cablesim.simulation-bundle']['summary']
            if operation == 'temperature':
                for s in summary['cables']:
                    t = next(v for v in trace['operating']['cable_states'] if v['entity'] == s['entity'])['conductor_temperature_c']+273.15
                    rows.append({'mesh_size_m':h,'entity':s['entity'],'quantity':'conductor_temperature','unit':'K',
                                 'iec':t,'fem':s['conductor_max_temperature_k'],'difference':s['conductor_max_temperature_k']-t})
            else:
                reference = trace['circuit_ratings'][0]['ampacity_a']
                actual = summary['rating']['ampacity_a']
                rows.append({'mesh_size_m':h,'entity':'circuit/one','quantity':'ampacity','unit':'A','iec':reference,'fem':actual,
                             'difference':actual-reference,'relative_difference':(actual-reference)/reference})
    return {'schema':'cablesim.iec-fem-comparison/1','input':document,'input_sha256':digest(document),
            'iec_run':asdict(source),'fem_runs':runs,'rows':rows,'engineering_approval':False,
            'differences':['IEC半空间镜像热阻与FEM有限侧底恒温域不同',
                           'FEM保留导体/金属层内部导热及二维温差，IEC按集总节点与标准热阻',
                           '介质总损耗直接取IEC输出，FEM在绝缘层均匀分布；IEC为标准等效路径',
                           '有排管时空气热阻取对应IEC运行的收敛值并固定，未在FEM中重复IEC温变空气公式']}


def main():
    jobs = ROOT/'.tmp/simulation-iec';jobs.mkdir(parents=True,exist_ok=True)
    destination = ROOT/'.data/simulation/iec-comparison';destination.mkdir(parents=True,exist_ok=True)
    for ducts in (False,True):
        document,parameters = inputs(ducts)
        report = compare(document,parameters,Executor(jobs_root=jobs))
        name = 'ducts' if ducts else 'direct'
        (destination/(name+'.json')).write_text(json.dumps(report,ensure_ascii=False,allow_nan=False),'utf-8')
        print(json.dumps({'case':name,'rows':report['rows']},ensure_ascii=False),flush=True)
    if not any(jobs.iterdir()):
        jobs.rmdir()


if __name__ == '__main__':
    main()
