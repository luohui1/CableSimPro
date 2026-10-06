"""CPU-only training, untouched holdouts, split conformal and portable models."""
from copy import deepcopy
from importlib.metadata import version
import json
import math
import os
import time
from .features import digest,baseline,VERSION,NAMES,UNITS
from .inference import evaluate,domain_violations,prediction_from_bundle


def statistics(truth,predicted):
    import numpy as np
    y=np.asarray(truth);p=np.asarray(predicted);error=np.abs(p-y)
    relative=error/np.abs(y)*100
    denominator=np.sum((y-y.mean())**2)
    return {'samples':len(y),'mean_absolute':float(error.mean()),'p95_absolute':float(np.quantile(error,.95)),
        'maximum_absolute':float(error.max()),'mape_percent':float(relative.mean()),
        'maximum_relative_percent':float(relative.max()),'r2':float(1-np.sum((p-y)**2)/denominator) if denominator else None}


def conformal_quantile(residual):
    import numpy as np
    ordered=np.sort(np.asarray(residual));rank=min(len(ordered),math.ceil((len(ordered)+1)*.95))
    return float(ordered[rank-1])


def train(value,parameters):
    if not os.environ.get('SLURM_JOB_ID'):raise ValueError('Training requires Slurm')
    if set(parameters)-{'seed','model_version'}:raise ValueError('parameters：未知训练设置。')
    if value.get('schema_version')!='cablesim.hybrid-training/1':raise ValueError('input：训练契约版本不支持。')
    import numpy as np
    from xgboost import XGBRegressor
    from sklearn.neural_network import MLPRegressor
    from sklearn.gaussian_process import GaussianProcessRegressor
    from sklearn.gaussian_process.kernels import RBF
    from sklearn.preprocessing import StandardScaler
    started=time.perf_counter();seed=parameters.get('seed',42);rows=value['samples']
    if len(rows)<100:raise ValueError('samples：至少100条收敛配对标签才能分开拟合、调优、校准与留出。')
    identities=[r['case_sha256'] for r in rows]
    physical=[r['physical_sha256'] for r in rows]
    if len(physical)!=len(set(physical)):raise ValueError('samples：同一物理输入重复，拒绝数据泄漏。')
    family=value['family']
    if any(not r['valid'] or r['mesh_status']!='converged' or r['family']!=family for r in rows):
        raise ValueError('samples：只允许同场景族且网格收敛的标签；失败行须留在原数据集中。')
    if digest(rows)!=value['dataset_sha256']:raise ValueError('dataset_sha256：训练输入哈希不一致。')
    x=np.asarray([r['features'] for r in rows],dtype=float)
    y=np.asarray([[r['targets']['ampacity_ratio'],r['targets']['temperature_residual_k']] for r in rows])
    if x.shape!=(len(rows),len(NAMES)) or not np.isfinite(x).all() or not np.isfinite(y).all():
        raise ValueError('features/targets：维度或有限性校验失败。')
    groups=sorted({r['construction_sha256'] for r in rows});splits={k:[] for k in ('fit','tune','calibration','validation','extrapolation')}
    rng=np.random.default_rng(seed)
    for group in groups:
        indices=np.asarray([i for i,r in enumerate(rows) if r['construction_sha256']==group and r['split']!='extrapolation'])
        rng.shuffle(indices);n=len(indices)
        if n<80:raise ValueError('construction：每个结构组至少80条域内样本。')
        fit=int(.6*n);tune=int(.1*n);cal=int(.1*n)
        for key,subset in [('fit',indices[:fit]),('tune',indices[fit:fit+tune]),('calibration',indices[fit+tune:fit+tune+cal]),('validation',indices[fit+tune+cal:])]:
            splits[key].extend(int(i) for i in subset)
    splits['extrapolation']=[i for i,r in enumerate(rows) if r['split']=='extrapolation']
    if not splits['extrapolation']:raise ValueError('samples：须有独立的训练范围外测试集。')
    fit,tune,cal=[splits[k] for k in ('fit','tune','calibration')]
    xs=StandardScaler().fit(x[fit]);ys=StandardScaler().fit(y[fit]);xf=xs.transform(x[fit]);yf=ys.transform(y[fit])
    models={};native={};timings={}
    target_models=[];boosters=[];clock=time.perf_counter();search=[]
    for target in range(2):
        candidates=[]
        for depth in (3,4,6):
            model=XGBRegressor(n_estimators=600,max_depth=depth,learning_rate=.05,subsample=1.,colsample_bytree=1.,
                reg_lambda=1.,objective='reg:squarederror',tree_method='hist',device='cpu',n_jobs=1,
                random_state=seed,base_score=float(y[fit,target].mean()),early_stopping_rounds=40)
            model.fit(x[fit],y[fit,target],eval_set=[(x[tune],y[tune,target])],verbose=False)
            score=float(np.mean((model.predict(x[tune])-y[tune,target])**2))
            candidates.append((score,depth,model))
        score,depth,model=min(candidates,key=lambda item:item[0])
        search.append({'target':target,'selected_max_depth':depth,'tune_mse':score,
                       'candidates':[{'max_depth':d,'tune_mse':s} for s,d,_ in candidates]})
        # Only the early-stopping prefix is served and compared.
        best=model.best_iteration+1;booster=model.get_booster()[:best]
        boosters.append(booster)
        config=json.loads(booster.save_config());base=json.loads(config['learner']['learner_model_param']['base_score'])
        if isinstance(base,list):base=base[0]
        target_models.append({'base_score':float(base),'trees':[json.loads(t) for t in booster.get_dump(dump_format='json')]})
    models['xgboost']={'kind':'xgboost','targets':target_models};timings['xgboost']=time.perf_counter()-clock
    clock=time.perf_counter();mlp=MLPRegressor(hidden_layer_sizes=(32,16),activation='tanh',solver='adam',
        max_iter=1800,early_stopping=True,validation_fraction=.15,n_iter_no_change=60,tol=1e-6,
        learning_rate_init=.003,alpha=.001,random_state=seed)
    mlp.fit(xf,yf)
    models['mlp']={'kind':'mlp','x_mean':xs.mean_.tolist(),'x_scale':xs.scale_.tolist(),
        'y_mean':ys.mean_.tolist(),'y_scale':ys.scale_.tolist(),
        'weights':[w.tolist() for w in mlp.coefs_],'biases':[b.tolist() for b in mlp.intercepts_]}
    timings['mlp']=time.perf_counter()-clock
    clock=time.perf_counter();chosen=rng.choice(len(fit),size=min(800,len(fit)),replace=False)
    gp=GaussianProcessRegressor(kernel=RBF(length_scale=2.),alpha=1e-6,optimizer=None,normalize_y=False)
    gp.fit(xf[chosen],yf[chosen])
    models['gaussian_process']={'kind':'gaussian_process','x_mean':xs.mean_.tolist(),'x_scale':xs.scale_.tolist(),
        'y_mean':ys.mean_.tolist(),'y_scale':ys.scale_.tolist(),'x_train':gp.X_train_.tolist(),
        'alpha':gp.alpha_.tolist(),'length_scale':2.,'fit_samples':len(chosen)}
    timings['gaussian_process']=time.perf_counter()-clock
    # Independent runtime-library prediction verifies the exported numeric
    # implementation before any model is installed.
    check=fit[:5]+tune[:5]+splits['validation'][:5]+splits['extrapolation'][:5]
    native={'xgboost':np.column_stack([b.inplace_predict(x[check].astype(np.float32)) for b in boosters]),
            'mlp':ys.inverse_transform(mlp.predict(xs.transform(x[check]))),
            'gaussian_process':ys.inverse_transform(gp.predict(xs.transform(x[check])))}
    portability={}
    for name,model in models.items():
        delta=np.max(np.abs(np.asarray([evaluate(model,row) for row in x[check]])-native[name]),axis=0)
        portability[name]={'samples':len(check),'maximum_ratio_difference':float(delta[0]),
                           'maximum_temperature_difference_k':float(delta[1])}
        if delta[0]>2e-6 or delta[1]>2e-5:raise ValueError('PORTABLE_MODEL_PARITY_FAILED: '+name+' '+json.dumps(portability[name]))
    # Declared bounds are not fitted using the holdout labels. IEC derived
    # features use fit/tune/calibration input values only, with a small buffer.
    training=fit+tune+cal;ranges=[]
    for j in range(x.shape[1]):
        lo,hi=float(x[training,j].min()),float(x[training,j].max())
        supplied=value.get('feature_ranges',{}).get(NAMES[j])
        ranges.append(supplied if supplied is not None else [lo-(hi-lo)*.02,hi+(hi-lo)*.02])
    bundle={'schema_version':'cablesim.hybrid-model/1','model_version':parameters.get('model_version','1.0.0'),
        'feature_version':VERSION,'feature_names':NAMES,'feature_units':UNITS,'family':family,
        'domain':{'construction_sha256':groups,'feature_ranges':ranges,'policy':'reject'},
        'dataset':{'sha256':value['dataset_sha256'],'valid_samples':len(rows),'sources':value['sources'],
                   'split_sha256':digest({k:[identities[i] for i in v] for k,v in splits.items()}),
                   'splits':{k:len(v) for k,v in splits.items()},'split_case_sha256':{k:[identities[i] for i in v] for k,v in splits.items()}},
        'models':models,'primary_model':'xgboost','physics_scope':value['physics_scope'],
        'input_template':deepcopy(value['input_template']),'iec_parameters':deepcopy(value['iec_parameters']),
        'rated_circuit':value['rated_circuit'],
        'authority':'reference_only','engineering_approval':False,'field_validation':'not_covered'}
    reports={}
    for name,model in models.items():
        clock=time.perf_counter();pred=np.asarray([evaluate(model,row) for row in x]);infer=time.perf_counter()-clock
        residual=np.abs(pred[cal]-y[cal]);model['calibration']={'samples':len(cal),
            'ampacity_ratio_absolute_q':conformal_quantile(residual[:,0]),
            'temperature_absolute_q_k':conformal_quantile(residual[:,1])}
        reports[name]={'fit_seconds':timings[name],'prediction_seconds_per_sample':infer/len(rows),'sets':{}}
        for split in ('tune','validation','extrapolation'):
            ids=splits[split];base=x[ids,15:17];truth=np.column_stack((y[ids,0]*base[:,0],y[ids,1]+base[:,1]))
            prediction=np.column_stack((pred[ids,0]*base[:,0],pred[ids,1]+base[:,1]))
            q=model['calibration'];width=np.column_stack((q['ampacity_ratio_absolute_q']*base[:,0],np.full(len(ids),q['temperature_absolute_q_k'])))
            reports[name]['sets'][split]={'ampacity_a':statistics(truth[:,0],prediction[:,0]),
                'temperature_k':statistics(truth[:,1],prediction[:,1]),
                'interval_coverage':{'ampacity':float(np.mean(np.abs(prediction[:,0]-truth[:,0])<=width[:,0])),
                                     'temperature':float(np.mean(np.abs(prediction[:,1]-truth[:,1])<=width[:,1]))},
                'extrapolation_diagnostic_only':split=='extrapolation'}
    iec_reports={}
    for split in ('validation','extrapolation'):
        ids=splits[split];base=x[ids,15:17];truth=np.column_stack((y[ids,0]*base[:,0],y[ids,1]+base[:,1]))
        iec_reports[split]={'ampacity_a':statistics(truth[:,0],base[:,0]),'temperature_k':statistics(truth[:,1],base[:,1])}
    detection={}
    for split in ('validation','extrapolation'):
        ids=splits[split];refused=sum(bool(domain_violations(bundle,rows[i]['features'],rows[i]['construction_sha256'],family)) for i in ids)
        detection[split]={'samples':len(ids),'rejected':refused,'rejection_rate':refused/len(ids)}
    bundle['validation']={'models':reports,'iec':iec_reports,'domain_detection':detection,
        'reference':'held-out converged FEM, not independent physical measurements',
        'fem_error_assessed_against':'mesh convergence and separate analytical/domain checks',
        'reference_project_book':{'status':'reference_only_not_acceptance_criteria',
            'note':'Earlier project-book targets are historical references; current product acceptance uses the saved physics, accuracy evidence and human review.'},
        'release_gate':{'human_approval_required':True,'engineering_eligible':False}}
    bundle['training']={'seed':seed,'cpu_only':True,'slurm_job_id':os.environ['SLURM_JOB_ID'],
        'node':os.environ.get('SLURM_JOB_NODELIST'),'packages':{p:version(p) for p in ('numpy','scipy','scikit-learn','xgboost-cpu')},
        'wall_seconds':time.perf_counter()-started,
        'selection':'XGBoost primary as proposed; tune set controls early stopping; holdouts untouched',
        'hyperparameter_search':search,'portable_prediction_parity':portability,
        'gaussian_process_subset':800,'portable_format':'bounded numeric JSON, no pickle'}
    from xgboost import DMatrix
    contributions=[b.predict(DMatrix(x[fit[:min(200,len(fit))]]),pred_contribs=True) for b in boosters]
    bundle['training']['shap_mean_absolute']={target:dict(zip(NAMES,np.mean(np.abs(c),axis=0)[:-1].tolist()))
        for target,c in zip(('ampacity_ratio','temperature_residual_k'),contributions)}
    predictions=[];iec_times=[];fem_times=[];benchmark_errors=[];benchmark_sources=[]
    for case in value.get('performance_cases',[]):
        try:
            # Both paths see the exact same saved physical input. FEM times
            # are taken from that input's verified converged Slurm label.
            prediction_from_bundle(case['input'],bundle['iec_parameters'],bundle,bundle['rated_circuit'])
            for _ in range(3):
                clock=time.perf_counter();baseline(case['input'],bundle['iec_parameters']);iec_times.append(time.perf_counter()-clock)
                clock=time.perf_counter();prediction_from_bundle(case['input'],bundle['iec_parameters'],bundle,bundle['rated_circuit']);predictions.append(time.perf_counter()-clock)
            fem_times.append(case['fem_wall_seconds'])
            benchmark_sources.append({k:case[k] for k in ('case_sha256','row_sha256','raw_sha256')})
        except ValueError as exc:benchmark_errors.append({'case_sha256':case['case_sha256'],'error':str(exc)})
    bundle['validation']['performance']={'iec_median_seconds':float(np.median(iec_times)) if iec_times else None,
        'fem_median_seconds':float(np.median(fem_times)) if fem_times else None,
        'hybrid_full_prediction_samples':len(predictions),'hybrid_full_prediction_maximum_seconds':max(predictions) if predictions else None,
        'hybrid_full_prediction_median_seconds':float(np.median(predictions)) if predictions else None,
        'hybrid_benchmark_error':benchmark_errors or None,'case_sources':benchmark_sources,
        'physical_inputs':len(benchmark_sources),'repeats_per_input':3,
        'iec_dataset_median_seconds':float(np.median([r['iec_wall_seconds'] for r in rows])),
        'fem_dataset_median_seconds':float(np.median([r['fem_wall_seconds'] for r in rows])),
        'scope':'Slurm CPU; same saved inputs for IEC and hybrid; FEM times from those exact converged three-mesh labels; loaded model; no queue/HTTP latency'}
    bundle['training']['wall_seconds']=time.perf_counter()-started
    return bundle
