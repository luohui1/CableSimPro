"""Portable numeric inference without pickle, native ML libraries or path inputs."""
from math import exp,isfinite,tanh
from pathlib import Path
import json
import time
from hashlib import sha256
from struct import pack,unpack
from pydantic import Field
from cablesim_sdk.base import StrictModel
from .features import baseline,extract,construction,family,digest,VERSION,NAMES
from collections import OrderedDict

_bundles=OrderedDict()


class Refused(ValueError):
    def __init__(self,code,message):self.code=code;super().__init__(message)


class Prediction(StrictModel):
    iec: dict
    rated_circuit: str = Field(min_length=1)
    model_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


def float32(value):return unpack('<f',pack('<f',value))[0]


def tree_value(tree,values):
    node=tree
    for _ in range(64):
        if 'leaf' in node:return node['leaf']
        feature=node['split'];index=int(feature[1:]) if feature.startswith('f') else NAMES.index(feature)
        target=node['yes'] if values[index]<float32(node['split_condition']) else node['no']
        node=next(child for child in node['children'] if child['nodeid']==target)
    raise ValueError('model：树深度超限。')


def evaluate(model,features):
    kind=model['kind']
    if kind=='xgboost':
        values=[float32(v) for v in features]
        predictions=[]
        for target in model['targets']:
            score=float32(target['base_score'])
            for tree in target['trees']:score=float32(score+float32(tree_value(tree,values)))
            predictions.append(score)
        return predictions
    values=[(x-m)/s for x,m,s in zip(features,model['x_mean'],model['x_scale'])]
    if kind=='mlp':
        for i,(weights,bias) in enumerate(zip(model['weights'],model['biases'])):
            values=[b+sum(x*row[j] for x,row in zip(values,weights)) for j,b in enumerate(bias)]
            if i<len(model['weights'])-1:values=[tanh(v) for v in values]
        return [v*s+m for v,s,m in zip(values,model['y_scale'],model['y_mean'])]
    if kind=='gaussian_process':
        weights=[exp(-sum((a-b)**2 for a,b in zip(values,row))/(2*model['length_scale']**2)) for row in model['x_train']]
        return [m+s*sum(w*a[i] for w,a in zip(weights,model['alpha']))
                for i,(m,s) in enumerate(zip(model['y_mean'],model['y_scale']))]
    raise ValueError('model.kind：不支持的模型类型。')


def domain_violations(bundle,features,signature,scene):
    errors=[]
    if bundle.get('feature_version')!=VERSION:errors.append({'field':'feature_version','reason':'特征契约不一致'})
    if scene!=bundle['family']:errors.append({'field':'sections','reason':'场景族未训练'})
    if signature not in bundle['domain']['construction_sha256']:
        errors.append({'field':'cable_types/materials/iec','reason':'结构、材料、接地或方法假设未训练'})
    for name,value,bounds in zip(NAMES,features,bundle['domain']['feature_ranges']):
        tolerance=max(1e-12,abs(bounds[1]-bounds[0])*1e-10)
        if not bounds[0]-tolerance<=value<=bounds[1]+tolerance:
            errors.append({'field':name,'value':value,'minimum':bounds[0],'maximum':bounds[1],'reason':'训练范围之外'})
    return errors


def topology_violations(document,template):
    """Freeze unsampled topology and the finite-domain reference frame."""
    errors=[];section=document['sections'][0];saved=template['sections'][0]
    def stable(value,excluded):return {k:v for k,v in value.items() if k not in excluded and v is not None}
    placements={p['cable']:p for p in section['placements']};original={p['cable']:p for p in saved['placements']}
    if {k:stable(v,{'x','z','label'}) for k,v in placements.items()}!={k:stable(v,{'x','z','label'}) for k,v in original.items()}:
        errors.append({'field':'sections.placements','reason':'连接拓扑未训练'})
    if [c['cables'] for c in document['circuits']]!=[c['cables'] for c in template['circuits']]:
        errors.append({'field':'circuits.cables','reason':'回路与相序绑定未训练'})
    for circuit in template['circuits']:
        ids=[c['id'] for c in circuit['cables']]
        if any(uid not in placements or uid not in original for uid in ids):continue
        x=[placements[uid]['x'] for uid in ids];old=[original[uid]['x'] for uid in ids]
        center=sum(x)/len(x);prior=sum(old)/len(old);span=max(x)-min(x);prior_span=max(old)-min(old)
        if abs(center-prior)>1e-9 or span<=0 or any(abs((a-center)/span-(b-prior)/prior_span)>1e-9 for a,b in zip(x,old)):
            errors.append({'field':'sections.placements.x','reason':'回路中心或相序布局未训练；仅相中心距可在训练范围内改变'})
    enclosures={e['id']:e for e in section.get('enclosures',[])};previous={e['id']:e for e in saved.get('enclosures',[])}
    if {k:stable(v,{'x','z','label'}) for k,v in enclosures.items()}!={k:stable(v,{'x','z','label'}) for k,v in previous.items()}:
        errors.append({'field':'sections.enclosures','reason':'管道结构、材料或连接关系未训练'})
    for uid,enclosure in enclosures.items():
        if uid not in previous:continue
        for cable in previous[uid].get('contains',[]):
            if cable in placements and cable in original and any(abs((enclosure[axis]-placements[cable][axis])-(previous[uid][axis]-original[cable][axis]))>1e-9 for axis in ('x','z')):
                errors.append({'field':'sections.enclosures','reason':'管内偏心布局未训练'})
    if stable(section['medium'],{'surface_temperature'})!=stable(saved['medium'],{'surface_temperature'}):
        errors.append({'field':'sections.medium','reason':'地表边界或介质定义未训练'})
    layers=sorted(section.get('soil_layers',[]),key=lambda layer:layer['top_z'],reverse=True)
    old_layers=sorted(saved.get('soil_layers',[]),key=lambda layer:layer['top_z'],reverse=True)
    if layers and (len(layers)!=2 or len(old_layers)!=2
        or layers[0]['top_z']!=old_layers[0]['top_z'] or layers[-1]['bottom_z']!=old_layers[-1]['bottom_z']
        or layers[0]['bottom_z']!=layers[1]['top_z']):
        errors.append({'field':'sections.soil_layers','reason':'仅连续两土层的共同界面深度可变；地表和底部边界未采样'})
    if stable(document['load_cases'][0],{'id','label','currents'})!=stable(template['load_cases'][0],{'id','label','currents'}):
        errors.append({'field':'load_cases','reason':'未采样的负荷条件有变化'})
    if section.get('backfill') and section['backfill']['material']!=(saved.get('backfill') or {}).get('material'):
        errors.append({'field':'sections.backfill.material','reason':'回填材料映射未训练'})
    return errors


def prediction_from_bundle(document,iec,bundle,rated_circuit):
    document,prepared,result=baseline(document,iec)
    features,base=extract(document,prepared,result,rated_circuit)
    errors=domain_violations(bundle,features,construction(document,iec),family(document))
    errors+=topology_violations(document,bundle['input_template'])
    if rated_circuit!=bundle['rated_circuit']:errors.append({'field':'rated_circuit','reason':'目标回路未训练'})
    if errors:raise Refused('HYBRID_OUT_OF_DOMAIN','适用域外，未生成近似结果：'+json.dumps(errors,ensure_ascii=False))
    k,delta=evaluate(bundle['models'][bundle['primary_model']],features)
    amp=base['ampacity_a']*k;temperature=base['temperature_k']+delta
    if not all(isfinite(v) for v in (amp,temperature)) or amp<=0 or temperature<=0:
        raise Refused('HYBRID_NUMERIC_FAILURE','model：预测值非物理，未生成结果。')
    interval=bundle['models'][bundle['primary_model']]['calibration']
    amp_width=base['ampacity_a']*interval['ampacity_ratio_absolute_q']
    temp_width=interval['temperature_absolute_q_k']
    return {'schema_version':'cablesim.hybrid-prediction/1','ampacity':amp,'conductor_temperature':temperature,
        'rated_circuit':rated_circuit,'baseline':base,'correction':{'ampacity_ratio':k,'temperature_residual_k':delta},
        'interval':{'level':.95,'method':'split conformal; separate marginal prediction intervals',
                    'ampacity_a':[max(0.,amp-amp_width),amp+amp_width],
                    'conductor_temperature_k':[max(0.,temperature-temp_width),temperature+temp_width],
                    'calibration_samples':interval['samples'],'scope':'同分布仿真标签；不保证实测覆盖或两量联合95%覆盖'},
        'applicability':'within_range','family':bundle['family'],'domain':bundle['domain'],'feature_version':VERSION,
        'model_version':bundle['model_version'],'model_kind':bundle['primary_model'],
        'dataset_sha256':bundle['dataset']['sha256'],'validation':bundle['validation'],
        'authority':'reference_only','engineering_approval':False,
        'physics_scope':bundle['physics_scope'],'input_sha256':digest(document)}


def predict(value,parameters,repository):
    p=Prediction.model_validate(parameters);started=time.perf_counter()
    folder=Path(repository)/'.data/method-models';index_path=folder/'index.json'
    if not index_path.is_file():raise Refused('HYBRID_MODEL_MISSING','model_sha256：模型库未安装，保存的输入保留。')
    index=json.loads(index_path.read_text('utf-8'));record=index.get('models',{}).get(p.model_sha256)
    if record is None:raise Refused('HYBRID_MODEL_MISSING','model_sha256：所选准确模型未登记，请重新选择已有版本。')
    path=folder/(p.model_sha256+'.json')
    if not path.is_file() or path.is_symlink() or path.stat().st_size>16*1024*1024:
        raise Refused('HYBRID_MODEL_MISSING','model_sha256：模型文件缺失或不合法。')
    raw=path.read_bytes()
    if sha256(raw).hexdigest()!=p.model_sha256:
        raise Refused('HYBRID_MODEL_CORRUPT','model_sha256：模型文件哈希不一致，已拒绝执行。')
    bundle=_bundles.get(p.model_sha256)
    if bundle is None:
        bundle=json.loads(raw);_bundles[p.model_sha256]=bundle
        if len(_bundles)>2:_bundles.popitem(last=False)
    _bundles.move_to_end(p.model_sha256)
    if bundle['dataset']['sha256']!=record['dataset_sha256']:
        raise Refused('HYBRID_MODEL_CORRUPT','dataset_sha256：登记的训练来源不一致。')
    result=prediction_from_bundle(value,p.iec,bundle,p.rated_circuit)
    result.update(model_sha256=p.model_sha256,wall_seconds=time.perf_counter()-started,
                  registration={'source_remote_run_id':record['source_remote_run_id'],'artifact_sha256':record['artifact_sha256']})
    return result
