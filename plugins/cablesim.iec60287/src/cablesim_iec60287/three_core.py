"""IEC 60287:2023 individually screened, balanced circular three-core cables.

Extruded individual tape screens use the SL thermal path (2-1 4.1.2.3.1),
not the paper-insulated screening-factor curves. All dimensions are SI.
Tape longitudinal resistance is an input: inter-turn contact is not guessed.
"""
from copy import deepcopy
from math import hypot, isclose, isfinite, log, pi, sqrt
from types import SimpleNamespace as NS

from .group_inputs import GroupRating
from .inputs import Duct, Solver
from .method import RatingRefused
from .soil import resistance_matrix


SOURCES = ['IEC 60287-1-1:2023 4.2.1 Eq.(1); 5.1.2; 5.1.3; 5.1.5.1; 5.2; 5.3.1/5.3.2/5.3.11; 5.4.3.3.1/5.4.3.4/5.4.3.5',
           'IEC 60287-2-1:2023 4.1.2.3.1/4.1.2.5; 4.1.3; 4.1.4.2; 4.1.5; 5.6/Figure6; 4.2.2/4.2.3.2/4.2.6; Annex A']


def positive(v, path):
    if isinstance(v, bool) or not isinstance(v, (float, int)) or not isfinite(v) or v <= 0:
        raise ValueError(path+'：填写正的有限数值，并注明SI单位与来源。')
    return v


def annular(rho, inner, outer):
    return positive(rho, 'thermal_resistivity')/(2*pi)*log(outer/inner)


def filler_factor(x, touching=True):
    """2-1 5.6: Figure6 upper=touching, lower=equal separation thickness."""
    if not 0 < x <= .15:
        raise RatingRefused('SL_FILLER_GEOMETRY_RANGE', '填充与内衬厚度/芯外径须在(0,0.15]，图6范围外改用数值传热方法。')
    if touching:
        v = .00022619+2.11429*x-20.4762*x*x if x <= .03 else .0142108+1.17533*x-4.49737*x*x+10.6352*x**3
    else:
        v = .000202380+2.03214*x-21.6667*x*x if x <= .03 else .0126529+1.101*x-4.56104*x*x+11.5093*x**3
    return 2*pi*v


def steel_tape_loss(rc, spacing_m, mean_m, equivalent_m, mu, frequency, tape_thickness_m):
    """1-1 5.4.3.4 Eq.17-20. Formula dimensions s,dA,δ are mm."""
    for path,v in [('Rc',rc),('s',spacing_m),('dA',mean_m),('deltaA',equivalent_m),('mu',mu),('frequency',frequency)]:
        positive(v,path)
    if not .0003 <= tape_thickness_m <= .001:
        raise RatingRefused('STEEL_TAPE_THICKNESS_RANGE', '钢带单带厚度须为0.3–1.0 mm；该厚度不在IEC钢带损耗公式范围。')
    s, d, delta = spacing_m*1000, mean_m*1000, equivalent_m*1000
    k = 1/(1+d/(mu*delta))
    hysteresis = s*s*k*k*1e-7/(rc*d*delta)*(frequency/50)**2
    eddy = 2.25*s*s*k*k*delta*1e-8/(rc*d)*(frequency/50)**2
    # Eq.18 scales k by f/50 for hysteresis; Eq.19 separately scales by (f/50)^2.
    return {'total':hysteresis+eddy,'hysteresis':hysteresis,'eddy':eddy,'k_at_50hz':k,
            'equivalent_thickness_m':equivalent_m,'basis':'IEC 60287-1-1:2023 5.4.3.4 Eq.(17)-(20)'}


def steel_wire_loss(rc, rs, circulating, ra, centre_radius, mean, frequency):
    omega = 2*pi*frequency
    raw = 1.23*ra/rc*(2*centre_radius/mean)**2/(1+(2.77*ra*1e6/omega)**2)
    reduction = 1-rc/rs*circulating
    if not 0 <= reduction <= 1:
        raise RatingRefused('SL_ARMOUR_SCREENING_INVALID', '护套环流的铠装屏蔽修正超出[0,1]。')
    return {'total':raw*reduction,'raw':raw,'screening_factor':reduction,'resistance_ohm_m':ra,
            'basis':'IEC 60287-1-1:2023 5.4.3.3.1 / 5.4.3.5'}


def physical(cable, materials, p, circuit, criteria, duct):
    base = 'cable_types/'+cable['id']
    cores = cable['cores']
    if len(cores) != 3 or cable['construction'] != 'three_core':
        raise RatingRefused('THREE_CORE_REQUIRED', base+'：要求3个圆形、独立金属屏蔽的芯。')
    first = cores[0]
    if any(c['conductor'] != first['conductor'] or c['layers'] != first['layers'] for c in cores[1:]):
        raise RatingRefused('UNEQUAL_CORE_NOT_SUPPORTED', base+'：三个芯结构必须一致；不同芯和不平衡负荷使用数值插件。')
    cond, layers = first['conductor'], first['layers']
    if cond['form'] not in ('stranded_round','stranded_round_compacted'):
        raise RatingRefused('THREE_CORE_CONDUCTOR_FORM', base+'：仅覆盖圆绞导体，扇形/分割导体需对应验证分支。')
    metal = [i for i,l in enumerate(layers) if l['role'] in ('metallic_screen','metallic_sheath')]
    if len(metal) != 1 or metal[0] < 3:
        raise ValueError(base+'/cores/layers：需导体屏蔽、绝缘、绝缘屏蔽与一个独立金属屏蔽。')
    mi = metal[0]; screen = layers[mi]
    if len([l for l in layers[:mi] if l['role']=='insulation']) != 1 or any(l['role'] not in ('conductor_screen','insulation','insulation_screen','separator') for l in layers[:mi]):
        raise RatingRefused('SL_INSULATION_PATH', base+'：内部层序不属于已验证的SL环形热路。')
    if any(l['role'] not in ('bedding','separator','oversheath') for l in layers[mi+1:]):
        raise ValueError(base+'/cores/layers：金属屏蔽外仅支持独立保护层。')
    distances = [hypot(cores[i]['x']-cores[j]['x'],cores[i]['z']-cores[j]['z']) for i,j in ((0,1),(1,2),(2,0))]
    spacing = positive(distances[0],base+'/cores/x,z')
    radius = hypot(first['x'],first['z'])
    if any(not isclose(s,spacing,rel_tol=1e-8) for s in distances) or not isclose(sum(c['x'] for c in cores),0,abs_tol=1e-10) or not isclose(sum(c['z'] for c in cores),0,abs_tol=1e-10):
        raise RatingRefused('SL_CORE_LAYOUT', base+'/cores/x,z：要求以电缆中心为原点的等边三芯布置。')
    d = positive(cond['diameter'],base+'/conductor/diameter'); t1 = 0.; jacket = 0.; insulation_diameters = None
    for i,l in enumerate(layers):
        outer = d+2*positive(l['thickness'],base+'/layers/thickness')
        if i < mi:
            t1 += annular(materials[l['material']].get('thermal_resistivity'),d,outer)
        elif i > mi:
            jacket += annular(materials[l['material']].get('thermal_resistivity'),d,outer)
        if l['role']=='insulation':insulation_diameters=(d,outer,materials[l['material']])
        if i==mi:screen_inner,screen_outer,mean=d,outer,(d+outer)/2
        d=outer
    core_outer=d
    if not isclose(spacing,core_outer,rel_tol=1e-8):
        raise RatingRefused('SL_CORE_SPACING', base+'/cores/x,z：本轮图6仅验证芯外保护层相接触的上曲线；分离芯不可套用。')
    lay = positive(cable.get('core_lay_length'),base+'/core_lay_length (m)')
    cll = sqrt(1+(pi*1.29*core_outer/lay)**2)
    t1 /= cll; jacket /= cll
    sm = materials[screen['material']]
    if screen.get('form')=='smooth':
        rs20=positive(sm.get('electrical_resistivity_20'),base+'/screen/material/resistivity')/(pi*mean*screen['thickness'])*cll
    elif screen.get('form')=='tape':
        rs20=positive(screen.get('longitudinal_r20'),base+'/cores/layers/metallic_screen/longitudinal_r20 (Ω/m)')
    else:
        raise RatingRefused('SL_SCREEN_FORM', base+'：铜丝屏蔽和皱纹层不属于此独立铜带/光滑金属套分支。')
    common=cable['common_layers']; roles=[l['role'] for l in common]
    if not common or roles[-1]!='oversheath' or roles.count('armour')>1 or any(role not in ('filler','binder','bedding','separator','armour','oversheath') for role in roles):
        raise RatingRefused('SL_COMMON_PATH', base+'/common_layers：要求填充/内衬、可选铠装及外护套。')
    armour_at=roles.index('armour') if 'armour' in roles else len(common)-1
    before=common[:armour_at]
    if not before or any(l['role']=='armour' for l in common[armour_at+1:]):raise ValueError(base+'/common_layers：缺填充和内衬层。')
    # Figure6 accounts for the common filler region. Further concentric bedding
    # is evaluated separately; different materials are not averaged.
    pack=2*radius+core_outer; diameter=pack; t2=jacket/3; filler_layers=[]
    while before and before[0]['role'] in ('filler','binder'):
        filler_layers.append(before.pop(0))
    if not filler_layers:raise ValueError(base+'/common_layers/filler：必须给出填充层与材料。')
    rho=positive(materials[filler_layers[0]['material']].get('thermal_resistivity'),base+'/filler/material/thermal_resistivity')
    if any(materials[l['material']].get('thermal_resistivity') != rho for l in filler_layers):
        raise RatingRefused('SL_FILLER_MATERIALS', base+'：图6的填充和包带需相同热阻率；多种填料使用数值方法。')
    filler_thickness=sum(l['thickness'] for l in filler_layers); factor=filler_factor(filler_thickness/core_outer)
    t2 += rho*factor/(6*pi);diameter+=2*filler_thickness
    for l in before:
        outer=diameter+2*l['thickness'];t2+=annular(materials[l['material']].get('thermal_resistivity'),diameter,outer);diameter=outer
    armour=None
    if armour_at < len(common)-1:
        layer=common[armour_at];am=materials[layer['material']];outer=diameter+2*layer['thickness'];armour={'layer':layer,'mean':(diameter+outer)/2,'material':am}
        mu=positive(am.get('relative_permeability'),base+'/armour/material/relative_permeability')
        if mu <= 1:raise RatingRefused('NONMAGNETIC_SL_ARMOUR', base+'：非磁性铠装需护套并联热路，本轮拒算。')
        if layer.get('form')=='tape':
            thick=positive(layer.get('nominal_tape_thickness'),base+'/armour/nominal_tape_thickness (m)')
            width=positive(layer.get('tape_width'),base+'/armour/tape_width (m)');gap=layer.get('tape_gap')
            if isinstance(gap,bool) or not isinstance(gap,(int,float)) or not isfinite(gap) or not 0<=gap<=width/2:
                raise ValueError(base+'/armour/tape_gap (m)：填写实际绕包间隙，范围0至带宽的一半。')
            if layer.get('tape_count') != 2 or layer.get('tape_application')!='two_tape_gap' or not isclose(layer['thickness'],2*thick,rel_tol=1e-8):
                raise RatingRefused('STEEL_TAPE_CONSTRUCTION', base+'：仅支持两层间隙绕包，径向层厚须为2倍单带厚度。')
            equivalent=2*thick*width/(width+gap);armour.update(kind='tape',equivalent=equivalent)
            steel_tape_loss(1.,spacing,armour['mean'],equivalent,mu,circuit['system']['frequency'],thick)
        elif layer.get('form')=='wires':
            if cond['nominal_area']>400e-6:
                raise RatingRefused('STEEL_WIRE_CONDUCTOR_SIZE', base+'：钢丝铠装圆导体公式的非均匀电流修正仅声明至400 mm²；更大截面使用数值电磁插件。')
            if layer.get('longitudinal_resistance_basis')!='power_frequency_ac' or layer.get('longitudinal_resistance_frequency')!=circuit['system']['frequency']:
                raise ValueError(base+'/armour/longitudinal_resistance_basis/frequency：声明与回路频率相同的20°C工频交流纵向电阻，不能填直流电阻。')
            armour.update(kind='wires',r20=positive(layer.get('longitudinal_r20'),base+'/armour/longitudinal_r20 (Ω/m)'))
            positive(am.get('temperature_coefficient_20'),base+'/armour/material/alpha20')
        else:raise RatingRefused('SL_ARMOUR_FORM', base+'：要求明确双钢带或钢丝铠装结构。')
        diameter=outer
    t3=0.
    for l in common[armour_at+1:] if armour else common[-1:]:
        if l['role'] not in ('separator','oversheath'):raise RatingRefused('SL_OUTER_PATH',base+'：铠装外仅覆盖隔离层与护套。')
        outer=diameter+2*l['thickness'];t3+=annular(materials[l['material']].get('thermal_resistivity'),diameter,outer);diameter=outer
    insinner,insouter,im=insulation_diameters
    cap=2*pi*8.8541878128e-12*positive(im.get('relative_permittivity'),base+'/insulation/permittivity')*cll/log(insouter/insinner)
    tangent=im.get('loss_tangent')
    if isinstance(tangent,bool) or not isinstance(tangent,(int,float)) or not isfinite(tangent) or tangent<0:raise ValueError(base+'/insulation/loss_tangent：填写非负无量纲损耗角正切。')
    wc=2*pi*circuit['system']['frequency']*cap*cable['rating']['u0']**2*tangent
    cm=materials[cond['material']]
    limit=criteria.get('max_conductor_temperature',cable['rating']['max_conductor_temperature']['normal'])-273.15
    return {'r20':positive(cond.get('r20'),base+'/conductor/r20 (Ω/m)'), 'alpha':positive(cm.get('temperature_coefficient_20'),base+'/conductor/material/alpha20'),
            'dc':cond['diameter'],'rs20':rs20,'screen_alpha':positive(sm.get('temperature_coefficient_20'),base+'/screen/material/alpha20'),
            'screen_mean':mean,'spacing':spacing,'centre_radius':radius,'cll':cll,'armour':armour,'wd':wc,'cap':cap,
            't1':t1,'t2':t2,'t3':t3,'overall':diameter,'limit':limit,'filler_factor':factor,'core_ids':[c['id'] for c in cores],
            'rating':NS(max_conductor_temperature_c=limit,solver=Solver.model_validate(p['solver']),installation=NS(duct=duct))}


def prepare(value,p):
    value=deepcopy(value);p=deepcopy(p)
    if p.get('reference_basis','iec2023') != 'iec2023':raise RatingRefused('THREE_CORE_REFERENCE_MODE','此三芯领域能力按IEC2023计算；TB880旧版扩展独立验证。')
    if any(k in p for k in ('external_loss_artifact','per_cable_losses')):raise RatingRefused('THREE_CORE_EXTERNAL_LOSS_SCOPE','三芯外部损耗工件的芯/公共铠装映射尚未验证。')
    if len(value['sections'])!=1 or len(value['load_cases'])!=1:raise ValueError('三芯稳态研究需一个截面和一个负荷工况。')
    sec,load=value['sections'][0],value['load_cases'][0]
    if sec['kind']!='ground' or sec.get('soil_layers') or load['kind']!='steady' or load.get('profile'):
        raise RatingRefused('THREE_CORE_ENVIRONMENT','分层土壤、非地下或时变负荷使用数值仿真插件。')
    if not isinstance(sec['medium'].get('surface_temperature'),(int,float)):raise ValueError('surface_temperature (K)：需要等温地表温度。')
    ambient=sec['medium']['surface_temperature']-273.15;materials={m['id']:m for m in value['materials']};types={t['id']:t for t in value['cable_types']}
    points={q['cable']:q for q in sec['placements']};enclosures={d['id']:d for d in sec['enclosures']};cables=[];circuits=[]
    for circuit in value['circuits']:
        cable_type=types[circuit['cable_type']]
        provenance=value.get('provenance',{})
        model_paths=['/cable_types/'+cable_type['id'],'/cable_types/'+cable_type['id'].replace('/','~1')]
        if not any((source.get('reference') or '').strip() and any(path==base or base.startswith(path+'/') for base in model_paths) for path,source in provenance.items()):
            raise ValueError('provenance/cable_types：三芯尺寸、成缆绞距、屏蔽电阻与铠装绕包需可追溯来源；请补齐型号来源。')
        if len(circuit['cables'])!=1 or circuit['cables'][0]['phase']!='L1L2L3' or circuit['system']['kind']!='ac_three_phase' or circuit['bonding']['kind']!='both_ends':
            raise RatingRefused('THREE_CORE_CIRCUIT','每回路须一根三芯电缆（phase=ABC）、平衡三相及屏蔽两端接地；其他连接拓扑使用对应电磁方法。')
        positive(circuit['system']['frequency'],'frequency (Hz)')
        if not 45<=circuit['system']['frequency']<=65:raise RatingRefused('POWER_FREQUENCY_REQUIRED','磁性铠装公式仅声明45–65 Hz工频。')
        instance=circuit['cables'][0];cid=instance['id'];q=points.get(cid)
        if not q:raise ValueError('placements/'+cid+'：缺少电缆位置。')
        duct=None;d=enclosures.get(q.get('enclosure'))
        if q.get('enclosure'):
            if not d or d['type']!='duct' or d['contains']!=[cid] or not isclose(q['x'],d['x'],abs_tol=1e-10) or not isclose(q['z'],d['z'],abs_tol=1e-10):
                raise ValueError('enclosures/'+str(q.get('enclosure'))+'：需同心一管一缆。')
            duct=Duct.model_validate({**p.get('duct',{}),'inner_diameter_m':d['inner_diameter'],'outer_diameter_m':d['outer_diameter'],'rho_k_m_w':materials[d['material']]['thermal_resistivity']})
        normal=cable_type['rating']['max_conductor_temperature']['normal']
        if value['criteria'].get('max_conductor_temperature',normal)>normal:
            raise ValueError('criteria/max_conductor_temperature (K)：稳态温限不得超过该型号长期允许温度。')
        model=physical(cable_type,materials,p,circuit,value['criteria'],duct)
        if duct and (model['overall']>=duct.inner_diameter_m or not .025<=model['overall']<=.1):
            raise RatingRefused('THREE_CORE_DUCT_GEOMETRY','管内空气经验式的电缆外径须25–100 mm且小于管内径。')
        if ambient>=model['limit']:raise ValueError('surface_temperature：环境温度须低于导体温限。')
        current=load['currents'].get(cid,load['currents'].get(circuit['id']))
        if isinstance(current,bool) or not isinstance(current,(int,float)) or not isfinite(current) or current<0:raise ValueError('load_cases/currents/'+circuit['id']+' (A)：填写非负电流。')
        indices=[len(cables)];cables.append({'id':cid,'circuit':circuit['id'],'phase':'L1L2L3','current':current,'point':(q['x'],q['z']),'duct':bool(duct),
            'model':model,'rating':model['rating'],'geometry':NS(overall_m=model['overall'])})
        circuits.append({'id':circuit['id'],'label':circuit['label'],'indices':indices,'bonding':circuit['bonding'],'electrical_topology':circuit.get('electrical_topology'),'automatic':True,'spacing':model['spacing'],'arrangement':'three_core'})
    if set(points)!={c['id'] for c in cables} or {e['id'] for e in enclosures.values()}!={q['enclosure'] for q in points.values() if q.get('enclosure')}:raise ValueError('截面含额外电缆或管道；不忽略热源与空管。')
    fill=sec.get('backfill')
    if fill:fill={**fill,'rho':materials[fill['material']]['thermal_resistivity']}
    matrix,soil=resistance_matrix([c['point'] for c in cables],[c['rating'].installation.duct.outer_diameter_m/2 if c['duct'] else c['model']['overall']/2 for c in cables],positive(materials[sec['medium']['material']].get('thermal_resistivity'),'soil/thermal_resistivity'),fill)
    soil['three_core']=True
    if positive(p.get('ks'),'ks')>2 or positive(p.get('kp'),'kp')>2:raise ValueError('ks/kp：系数须不大于2，并按对应导体形式提供来源。')
    return GroupRating(value,p,cables,circuits,matrix,soil,ambient)


def electrical(m,theta,theta_s,theta_a,p,frequency):
    dc=m['r20']*(1+m['alpha']*(theta-20));omega=2*pi*frequency
    if dc<=0:raise RatingRefused('ELECTRICAL_STATE_INVALID','导体电阻非正。')
    xs=sqrt(8*pi*frequency*1e-7*p['ks']/dc);xp=sqrt(8*pi*frequency*1e-7*p['kp']/dc)
    if xp>2.8:raise RatingRefused('PROXIMITY_OUT_OF_RANGE','三芯邻近效应xp超过2.8；使用数值电磁模型。')
    ys=xs**4/(192+.8*xs**4) if xs<=2.8 else -.136-.0177*xs+.0563*xs*xs if xs<=3.8 else .354*xs-.733
    fp=xp**4/(192+.8*xp**4);ratio=(m['dc']/m['spacing'])**2;yp=fp*ratio*(.312*ratio+1.18/(fp+.27));rc=dc*(1+ys+yp)
    rs=m['rs20']*(1+m['screen_alpha']*(theta_s-20));x=2*omega*1e-7*log(2*m['spacing']/m['screen_mean'])*m['cll']
    # 5.3.11 for armoured; 5.3.2 for unarmoured separate metallic screens.
    l1=rs/rc/(1+(rs/x)**2)*(1.5 if m['armour'] else 1.)
    a=m['armour'];loss={'total':0.,'basis':'unarmoured'}
    if a:
        if a['kind']=='tape':loss=steel_tape_loss(rc,m['spacing'],a['mean'],a['equivalent'],a['material']['relative_permeability'],frequency,a['layer']['nominal_tape_thickness'])
        else:
            ra=a['r20']*(1+a['material']['temperature_coefficient_20']*(theta_a-20))
            loss=steel_wire_loss(rc,rs,l1,ra,m['centre_radius'],a['mean'],frequency)
    return rc,l1,loss,{'total':l1,'circulating':l1,'eddy_raw':0.,'sheath_r_ohm_m':rs,'sheath_reactance_ohm_m':x,'ys':ys,'yp':yp,'r_dc_ohm_m':dc,'basis':'IEC 60287-1-1:2023 5.3.11' if a else 'IEC 60287-1-1:2023 5.3.2'}


def operating(group,currents=None):
    n=len(group.cables);currents=[c['current'] for c in group.cables] if currents is None else currents
    ambient=group.ambient;tc=[ambient]*n;ts=tc.copy();ta=tc.copy();air=tc.copy()
    for iteration in range(1,max(c['rating'].solver.max_iterations for c in group.cables)+1):
        details=[electrical(c['model'],tc[i],ts[i],ta[i],group.parameters,group.document['circuits'][i]['system']['frequency']) for i,c in enumerate(group.cables)]
        wc=[currents[i]**2*details[i][0] for i in range(n)]
        before=[3*(wc[i]*(1+details[i][1])+c['model']['wd']) for i,c in enumerate(group.cables)]
        totals=[before[i]+3*wc[i]*details[i][2]['total'] for i in range(n)]
        external=[sum(group.matrix[i][j]*totals[j] for j in range(n)) for i in range(n)]
        walls=[];gaps=[];inner=[];surface=[];newa=[];news=[];newc=[];newair=[]
        for i,c in enumerate(group.cables):
            m=c['model'];d=c['rating'].installation.duct
            wall=annular(d.rho_k_m_w,d.inner_diameter_m,d.outer_diameter_m) if d else 0.
            denom=1+.1*(d.v+d.y_per_k*air[i])*m['overall']*1000 if d else 1
            if denom<=0:raise RatingRefused('DUCT_AIR_STATE_INVALID','管内平均空气温度使经验式无效。')
            gap=d.u/denom if d else 0.;ti=ambient+external[i]+wall*totals[i];surf=ti+gap*totals[i]
            armor=surf+m['t3']*totals[i];screen=armor+m['t2']*before[i];theta=screen+m['t1']*(wc[i]+.5*m['wd'])
            walls.append(wall);gaps.append(gap);inner.append(ti);surface.append(surf);newa.append(armor);news.append(screen);newc.append(theta);newair.append((ti+surf)/2)
        residual=max(abs(a-b) for a,b in zip(tc+ts+ta+air,newc+news+newa+newair))
        if any(not isfinite(t) or not -273.15<t<500 for t in newc):raise RatingRefused('THERMAL_RUNAWAY','该负荷下无有效稳态解；减小负荷或使用数值模型。')
        if residual<1e-7:break
        tc,ts,ta,air=[[(a+b)/2 for a,b in zip(old,new)] for old,new in ((tc,newc),(ts,news),(ta,newa),(air,newair))]
    else:raise RatingRefused('NOT_CONVERGED','三芯导体/屏蔽/铠装/管内空气温度迭代未收敛。')
    states=[]
    for i,c in enumerate(group.cables):
        m=c['model'];rc,l1,l2,ld=details[i];limit=m['limit']
        states.append({'entity':c['id'],'circuit':c['circuit'],'phase':'L1L2L3','current_a':currents[i],
            'conductor_temperature_c':newc[i],'temperature_limit_c':limit,'margin_k':limit-newc[i],'sheath_temperature_c':news[i],
            'armour_temperature_c':newa[i],'surface_temperature_c':surface[i],'ac_resistance_ohm_m':rc,'capacitance_f_m':m['cap'],
            'lambda1':l1,'lambda2':l2['total'],'lambda1_components':ld,'lambda2_components':l2,'ac_extra_factor':ld['ys']+ld['yp'],
            'conductor_loss_w_m':3*wc[i],'sheath_loss_w_m':3*wc[i]*l1,'armour_loss_w_m':3*wc[i]*l2['total'],
            'dielectric_loss_w_m':3*m['wd'],'dielectric_loss_per_core_w_m':m['wd'],'conductor_loss_per_core_w_m':wc[i],'total_loss_w_m':totals[i],
            't1_k_m_w':m['t1'],'t2_k_m_w':m['t2'],'t3_k_m_w':m['t3'],'t4_air_gap_k_m_w':gaps[i],'t4_wall_k_m_w':walls[i],
            't4_self_soil_k_m_w':group.matrix[i][i],'external_temperature_rise_k':external[i],
            'mutual_temperature_rise_k':sum(group.matrix[i][j]*totals[j] for j in range(n) if i!=j),
            'duct_outer_temperature_c':ambient+external[i],'duct_inner_temperature_c':inner[i],
            'core_lay_factor':m['cll'],'filler_geometry_factor':m['filler_factor'],
            'cores':[{'core':k,'temperature_c':newc[i],'conductor_loss_w_m':wc[i],'screen_loss_w_m':wc[i]*l1,'dielectric_loss_w_m':m['wd']} for k in m['core_ids']]})
    return {'cable_states':states,'iterations':iteration,'residual_k':residual,'hottest_cable':max(states,key=lambda s:s['conductor_temperature_c'])['entity'],'limiting_cable':min(states,key=lambda s:s['margin_k'])['entity']}


def verify(group,op,ratings):
    """Frozen-state heat balance; explicit per-core vs per-cable power basis."""
    rows=[]
    for state in op['cable_states']:
        theta=group.ambient+state['external_temperature_rise_k']+(state['t4_wall_k_m_w']+state['t4_air_gap_k_m_w']+state['t3_k_m_w'])*state['total_loss_w_m']+state['t2_k_m_w']*(state['total_loss_w_m']-state['armour_loss_w_m'])+state['t1_k_m_w']*(state['conductor_loss_w_m']+.5*state['dielectric_loss_w_m'])/3
        rows.append({'entity':state['entity'],'item':'三芯热平衡','computed':state['conductor_temperature_c'],'reference':theta,'difference':state['conductor_temperature_c']-theta,'tolerance':1e-5,'unit':'°C','passed':abs(state['conductor_temperature_c']-theta)<1e-5,'source':SOURCES[0]})
    for rated in ratings:
        if rated['ampacity_a'] is None:continue
        i=next(i for i,c in enumerate(group.cables) if c['id']==rated['limiting_cable']);s=rated['cable_states'][i]
        coefficient=0.;constant=0.
        for j,q in enumerate(rated['cable_states']):
            external=group.matrix[i][j];path=external
            if i==j:path+=s['t3_k_m_w']+s['t4_air_gap_k_m_w']+s['t4_wall_k_m_w']
            power_coefficient=3*q['ac_resistance_ohm_m']*(1+q['lambda1']+q['lambda2'])*path
            dielectric=q['dielectric_loss_w_m']*path
            if i==j:
                power_coefficient+=q['ac_resistance_ohm_m']*(q['t1_k_m_w']+3*(1+q['lambda1'])*q['t2_k_m_w'])
                dielectric+=q['dielectric_loss_w_m']*(q['t2_k_m_w']+q['t1_k_m_w']/6)
            if q['entity'] in rated['cable_currents_a']:
                coefficient+=power_coefficient*(rated['cable_currents_a'][q['entity']]/rated['ampacity_a'])**2;constant+=dielectric
            else:constant+=power_coefficient*q['current_a']**2+dielectric
        hand=sqrt((s['temperature_limit_c']-group.ambient-constant)/coefficient)
        rows.append({'entity':rated['entity'],'item':'三芯允许电流二次式','computed':rated['ampacity_a'],'reference':hand,'difference':rated['ampacity_a']-hand,'tolerance':.002,'unit':'A','passed':abs(rated['ampacity_a']-hand)<.002,'source':SOURCES[0]})
    if not all(r['passed'] for r in rows):raise RatingRefused('INDEPENDENT_HEAT_CHECK_FAILED','三芯固定参数热平衡校核未通过。')
    return {'basis':'固定最终Rc/λ1/λ2与管内平均温度的手算二次式；不替代独立电磁验证。','rows':rows,'passed':True}
