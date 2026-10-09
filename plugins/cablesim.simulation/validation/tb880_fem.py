"""TB 880 cases 0-1/0-2: resolved thermal FEM with IEC electrical feedback.

Validation only, not an extension of the engineering input applicability.
Actual tangent circles are meshed; no artificial gap or fitted T3 multiplier.
Metal regions are isothermal constraints, matching the report's zero metal
thermal resistance. No missing metal conductivity is invented. Duct air uses
the sourced IEC equivalent resistance, not a resolved fluid calculation.
Native execution is restricted to Slurm; assembly and full residuals are kept.
"""
from copy import deepcopy
from hashlib import sha256
import json
from math import log, pi, sqrt, hypot
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT), str(ROOT/'plugins/cablesim.simulation/src'), str(ROOT/'plugins/cablesim.iec60287/src')]


def inputs(fixture):
    """Map only primitive report inputs; expected results never enter the model."""
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    from backend.kernel.scenarios import system_models, METHOD_DEFAULTS
    from cablesim_sdk.domain import DomainDocument
    si = fixture['inputSi']; ducted = fixture['caseId'].endswith('0-2')
    source = 'CIGRE TB 880 (2022), case '+('0-2 pp.63–66,83–87' if ducted else '0-1 pp.63–75')
    d = convert(Scenario().model_dump())['document']
    template = next(m for m in system_models() if m['id']=='system.cu-xlpe-al-400')['payload']
    cable = deepcopy(template['cable_type']); cable['label'] = source
    cable['rating'].update(u0=si['phaseToGroundVoltageV'], u=si['lineToLineVoltageV'], um=145000.)
    cable['rating']['max_conductor_temperature']['normal'] = si['maxConductorTemperatureC']+273.15
    cable['cores'][0]['conductor'].update(diameter=si['conductorDiameterM'], nominal_area=.000630,
        r20=si['conductorResistance20OhmPerM'], form='stranded_round_compacted')
    for layer,key in zip(cable['common_layers'], ('innerSemiconductingThicknessM','insulationThicknessM',
            'outerSemiconductingThicknessM','metallicSheathThicknessM','outerSheathThicknessM')):
        layer['thickness']=si[key]
    materials=deepcopy(template['materials'])
    # These two thermal values are absent in TB 880 and not used by the
    # constrained FEM. Retain null in the saved SI document.
    next(m for m in materials if m['id']=='material/cu').update(thermal_resistivity=None,
        temperature_coefficient_20=si['conductorTemperatureCoefficientPerK'])
    next(m for m in materials if m['id']=='material/al-sheath').update(thermal_resistivity=None,
        electrical_resistivity_20=si['metallicSheathResistivity20OhmM'],
        temperature_coefficient_20=si['metallicSheathTemperatureCoefficientPerK'])
    next(m for m in materials if m['id']=='material/xlpe').update(thermal_resistivity=si['insulationThermalResistivityKMPW'],
        relative_permittivity=si['insulationRelativePermittivity'],loss_tangent=si['dielectricLossTangent'])
    next(m for m in materials if m['id']=='material/semi')['thermal_resistivity']=si['innerSemiconductingThermalResistivityKMPW']
    next(m for m in materials if m['id']=='material/pvc')['thermal_resistivity']=si['outerSheathThermalResistivityKMPW']
    section=d['sections'][0]; soil=section['medium']['material']
    materials.append({'id':soil,'label':'TB 880 soil','category':'soil','thermal_resistivity':si['soilThermalResistivityKMPW']})
    d['materials']=materials; d['cable_types']=[cable]; d['circuits']=d['circuits'][:1]
    circuit=d['circuits'][0]; circuit['cable_type']=cable['id']; circuit['bonding']['kind']='both_ends'
    circuit['system']['frequency']=si['frequencyHz']
    circuit['cables']=[{'id':f'cable/tb-{phase}','phase':phase} for phase in 'ABC']
    spacing=si['conductorAxisSpacingM']; depth=si['burialDepthM']
    centres=[(0.,-depth+spacing/sqrt(3)),(-spacing/2,-depth-spacing/(2*sqrt(3))),
             (spacing/2,-depth-spacing/(2*sqrt(3)))]
    section.update(kind='ground',soil_layers=[],backfill=None,enclosures=[],placements=[])
    section['medium']['surface_temperature']=si['ambientTemperatureC']+273.15
    for instance,(x,z) in zip(circuit['cables'],centres):
        point={'cable':instance['id'],'x':x,'z':z}
        if ducted:
            uid='enclosure/tb-'+instance['phase']; point['enclosure']=uid
            section['enclosures'].append({'id':uid,'type':'duct','x':x,'z':z,'material':'material/tb-duct',
                'inner_diameter':si['ductInnerDiameterM'],'outer_diameter':si['ductOuterDiameterM'],'contains':[instance['id']]})
        section['placements'].append(point)
    if ducted:materials.append({'id':'material/tb-duct','label':'TB 880 HDPE duct','category':'duct','thermal_resistivity':si['ductThermalResistivityKMPW']})
    d['sections']=[section]; d['load_cases']=d['load_cases'][:1]
    d['load_cases'][0].update(kind='steady',currents={circuit['id']:1.},profile={})
    d['criteria']['max_conductor_temperature']=si['maxConductorTemperatureC']+273.15
    d['provenance']={'/tb880':{'kind':'standard','reference':source+'; validation values, not engineering limits','reviewed':False}}
    p=deepcopy(METHOD_DEFAULTS['cablesim.iec60287']);p.update(reference_basis='iec2023',eddy='ignored',t4_form='exact')
    p['solver'].update(current_tolerance_a=1e-7,max_iterations=200)
    if ducted:p['duct'].update(u=si['ductAirGapCoefficientU'],v=si['ductAirGapCoefficientV'],
        y_per_k=si['ductAirGapCoefficientYPerK'],initial_mean_air_temperature_c=si['initialDuctAirGapMeanTemperatureC'])
    return DomainDocument.model_validate(d).model_dump(mode='json'),p


def thermal_model(document, group, size, extent):
    from cablesim_simulation.thermal_input import Cable, Environment, ThermalModel, Controls
    cables=[]; materials={m['id']:m for m in document['materials']}
    section=document['sections'][0];ct=document['cable_types'][0];core=ct['cores'][0]
    ducts={e['id']:e for e in section['enclosures']}
    for c in group.cables:
        uid=c['id'];radius=core['conductor']['diameter']/2
        # A positive placeholder passes the Layer dimensional contract. Its
        # assembled contribution is removed before constraints/solves below.
        layers=[dict(uid=uid+'/conductor',role='conductor',outer_radius_m=radius,k_w_m_k=1.,fixed_heat_w_m=0.)]
        for j,l in enumerate(ct['common_layers']):
            radius+=l['thickness'];rho=materials[l['material']]['thermal_resistivity']
            layers.append(dict(uid=uid+f'/layer-{j}',role=l['role'],outer_radius_m=radius,
                k_w_m_k=1. if rho is None else 1/rho,fixed_heat_w_m=0.))
        placement=next(q for q in section['placements'] if q['cable']==uid);duct=None
        if placement.get('enclosure'):
            e=ducts[placement['enclosure']];dp=group.parameters['duct']
            law=dict(u=dp['u'],v=dp['v'],y_per_k=dp['y_per_k'],minimum_temperature_k=273.15,
                maximum_temperature_k=423.15,source='TB 880 pp.83–87; IEC 60287-2-1:2023 4.2.6.1')
            resistance=dp['u']/(1+.1*(dp['v']+dp['y_per_k']*70)*radius*2000)
            duct=dict(uid=e['id'],inner_radius_m=e['inner_diameter']/2,outer_radius_m=e['outer_diameter']/2,
                k_w_m_k=1/materials[e['material']]['thermal_resistivity'],air_resistance_k_m_w=resistance,air_law=law,source=law['source'])
        cables.append(Cable.model_validate(dict(uid=uid,circuit=document['circuits'][0]['id'],x_m=c['point'][0],z_m=c['point'][1],
            layers=layers,current_a=0.,electrical=None,prescribed_core_temperature_k=None,temperature_limit_k=363.15,duct=duct)))
    env=Environment.model_validate(dict(kind='ground',background=dict(uid='soil',bounds_m=[-extent,-extent,extent,0.],k_w_m_k=1.),
        soil_layers=[],backfills=[],boundaries={name:dict(kind='temperature',temperature_k=293.15,h_w_m2_k=None,emissivity=None)
            for name in ('left','right','bottom','top')}))
    # Tangency is admitted ONLY for this controlled validation topology; normal
    # engineering ThermalModel still rejects it. Reject actual intersections.
    for i,c in enumerate(cables):
        for other in cables[i+1:]:
            radii=sum(q.duct.outer_radius_m if q.duct else q.layers[-1].outer_radius_m for q in (c,other))
            if abs(hypot(c.x_m-other.x_m,c.z_m-other.z_m)-radii)>1e-9:
                raise ValueError('TB 880 controlled topology requires exact tangent circles')
    model=ThermalModel.model_construct(schema_version='cablesim.thermal-model/1',cables=cables,environment=env,
        provenance=document['provenance'],assumptions=['Isothermal metal constraints; exact tangent circles; IEC-equivalent duct air; validation only.'])
    controls=Controls.model_validate(dict(operation='temperature',element_order=2,mesh_size_m=size,far_mesh_size_m=.8,
        mesh_transition_m=2.,fine_mesh_band_m=.0001,near_soil_mesh_size_m=.025,near_soil_margin_m=.3,
        max_nodes=500000,tolerance_k=1e-5,max_iterations=150,relaxation=.8,current_upper_a=1500.,current_tolerance_a=.001,rated_circuit=None))
    return model,controls


def isothermal_projection(count, groups):
    """Exact metal temperature equality, independent of missing conductivity."""
    import numpy as np
    from scipy.sparse import coo_matrix
    mapping=np.arange(count)
    for nodes in groups:mapping[nodes]=nodes[0]
    _,inverse=np.unique(mapping,return_inverse=True)
    return coo_matrix((np.ones(count),(np.arange(count),inverse))).tocsr(),inverse


class ConstrainedField:
    def __init__(self,model,controls,group,*,prepared_mesh=None,interfaces=(),duct_centers=None,outer_resistance=None):
        if not os.environ.get('SLURM_JOB_ID'):raise RuntimeError('Native TB 880 FEM must run in Slurm dg83.')
        import numpy as np
        from skfem import BilinearForm,asm
        from skfem.helpers import dot,grad
        from cablesim_simulation.thermal import ThermalSystem
        # Optional controls are diagnostic model reductions, never engineering
        # defaults. Nonconcentric ducts need their real interface coordinates.
        laws={}
        if duct_centers:
            model=deepcopy(model)
            for cable in model.cables:
                laws[cable.uid]=cable.duct.air_law;cable.duct.air_law=None
        self.system=system=ThermalSystem(model,controls,prepared_mesh);self.group=group;self.np=np
        metal_nodes=[];self.metals=[]
        @BilinearForm
        def conduction(u,v,w):return w.k*dot(grad(u),grad(v))
        for c in model.cables:
            for layer in c.layers:
                if layer.role not in ('conductor','metallic_sheath'):continue
                nodes=system.nodes[layer.uid];metal_nodes.append(nodes);self.metals.append(layer.uid)
                ids=[r['id'] for r in system.regions if r['uid']==layer.uid]
                metal=asm(conduction,system.basis,k=np.isin(system.ids.reshape(-1,4)[:,0],ids)[:,None].astype(float))
                system._fixed_conduction-=metal;system.K-=metal
        from skfem import FacetBasis
        endpoints=system.mesh.p[:,system.mesh.facets]
        self.outer_groups=[];self.outer_resistance=outer_resistance
        for cable in model.cables:
            if not cable.duct:continue
            center=(duct_centers or {}).get(cable.uid,(cable.x_m,cable.z_m))
            def surface(position,radius):
                distances=np.sqrt((endpoints[0]-position[0])**2+(endpoints[1]-position[1])**2)
                facets=np.flatnonzero(np.all(np.isclose(distances,radius,atol=1e-8,rtol=0),axis=0))
                if not len(facets):raise ValueError('Diagnostic duct interface is absent')
                return facets,system.basis.get_dofs(facets=facets).all()
            if duct_centers and laws[cable.uid] is not None:
                cable.duct.air_law=laws[cable.uid]
                ids=[r['id'] for r in system.regions if r['uid']==cable.duct.uid+'/air']
                unit=asm(conduction,system.basis,k=np.isin(system.ids.reshape(-1,4)[:,0],ids)[:,None].astype(float))
                initial=log(cable.duct.inner_radius_m/cable.layers[-1].outer_radius_m)/(2*pi*cable.duct.air_resistance_k_m_w)
                system._fixed_conduction-=initial*unit
                from skfem import ElementTriP2,ElementTriP1
                element=ElementTriP2() if controls.element_order==2 else ElementTriP1()
                surfaces=[surface((cable.x_m,cable.z_m),cable.layers[-1].outer_radius_m)[0],surface(center,cable.duct.inner_radius_m)[0]]
                system._duct_feedback.append((cable,unit,[FacetBasis(system.mesh,element,facets=f,intorder=4) for f in surfaces]))
            for role,position,radius in [('cable',(cable.x_m,cable.z_m),cable.layers[-1].outer_radius_m),
                                        ('inner',center,cable.duct.inner_radius_m),('outer',center,cable.duct.outer_radius_m)]:
                if role in interfaces or (role=='outer' and outer_resistance is not None):
                    nodes=surface(position,radius)[1];metal_nodes.append(nodes)
                    if role=='outer' and outer_resistance is not None:self.outer_groups.append(nodes)
        self.P,inverse=isothermal_projection(system.basis.N,metal_nodes)
        self.reduced_nodes=self.P.shape[1];self.inverse=inverse
        self.D=np.unique(inverse[np.array(sorted(system.dirichlet),dtype=int)])
        if self.outer_groups:self.D=np.union1d(self.D,inverse[np.concatenate(self.outer_groups)])
        self.free=np.setdiff1d(np.arange(self.reduced_nodes),self.D);self.factor=None
        self.spacings={i:r['spacing'] for r in group.circuits for i in r['indices']}

    def state(self,current,boundary='kennelly_image'):
        from scipy.sparse.linalg import splu,cg,LinearOperator
        from cablesim_simulation.far_boundary import image_rise
        from cablesim_iec60287.group import _resistance,_loss_factors
        np=self.np;s=self.system;temperature=np.full(s.basis.N,s.reference);history=[]
        wd=[]
        for c in self.group.cables:
            r,g=c['rating'],c['geometry'];cap=2*pi*8.8541878128e-12*r.insulation.relative_permittivity/log(g.over_insulation_m/g.over_inner_screen_m)
            wd.append(2*pi*r.frequency_hz*cap*r.phase_voltage_v**2*r.insulation.tan_delta)
        def evaluate(t):
            means=[float(s.weights[c.layers[0].uid]@t/s.weights[c.layers[0].uid].sum()) for c in s.model.cables]
            sheaths=[float(t[s.nodes[c.uid+'/layer-3'][0]]) for c in s.model.cables]
            resistances=[_resistance(c,means[i]-273.15,self.spacings[i]) for i,c in enumerate(self.group.cables)]
            lambdas=_loss_factors(self.group,resistances,[t-273.15 for t in sheaths])
            load=np.zeros(s.basis.N);powers=[]
            for i,c in enumerate(s.model.cables):
                wc=current**2*resistances[i];ws=wc*lambdas[i]
                for uid,power in ((c.uid+'/conductor',wc),(c.uid+'/layer-3',ws),(c.uid+'/layer-1',wd[i])):
                    weights=s.weights[uid];load+=power*weights/weights.sum()
                powers.append(dict(entity=c.uid,conductor_temperature_k=means[i],sheath_temperature_k=sheaths[i],
                    conductor_loss_w_m=wc,sheath_loss_w_m=ws,dielectric_loss_w_m=wd[i]))
            return load,powers
        for iteration in range(150):
            air=s.update_duct_conduction(temperature);matrix=self.P.T@s.K@self.P
            load,powers=evaluate(temperature);rhs=self.P.T@load
            boundary_nodes=np.array(sorted(s.dirichlet),dtype=int)
            prescribed=np.zeros(self.reduced_nodes)
            if boundary=='kennelly_image':
                sources=[dict(center_m=[c.x_m,c.z_m],loss_w_m=sum(p[k] for k in ('conductor_loss_w_m','sheath_loss_w_m','dielectric_loss_w_m')))
                    for c,p in zip(s.model.cables,powers)]
                prescribed[self.inverse[boundary_nodes]]=image_rise(s.points[boundary_nodes].T,sources,1.)
            for nodes,power in zip(self.outer_groups,powers):
                prescribed[self.inverse[nodes]]=sum(power[k] for k in ('conductor_loss_w_m','sheath_loss_w_m','dielectric_loss_w_m'))*self.outer_resistance
            reduced=matrix[self.free][:,self.free].tocsr()
            if self.factor is None:self.factor=LinearOperator(reduced.shape,matvec=splu(reduced.tocsc()).solve)
            solution,status=cg(reduced,rhs[self.free]-matrix[self.free][:,self.D]@prescribed[self.D],M=self.factor,rtol=1e-11,atol=1e-12,maxiter=250)
            if status:raise ValueError('Current constrained FEM matrix did not meet residual tolerance')
            prescribed[self.free]=solution;proposed=np.asarray(self.P@prescribed).ravel()+s.reference
            change=float(np.max(abs(proposed-temperature)));history.append(dict(iteration=iteration+1,change_k=change))
            if change<1e-6:temperature=proposed;break
            temperature+=.8*(proposed-temperature)
        else:raise ValueError('TB 880 loss/air/far-boundary feedback did not converge')
        s.update_duct_conduction(temperature);load,powers=evaluate(temperature)
        residual=np.asarray(self.P.T@(s.K@(temperature-s.reference)-load)).ravel()
        balance=abs(float(load.sum()+residual[self.D].sum()))/max(1.,float(load.sum()))
        physical=float(np.max(abs(residual[self.free])))
        if balance>1e-6 or physical>1e-5:raise ValueError('Accepted field fails physical heat balance')
        return dict(nodes=int(s.basis.N),constrained_dofs=int(self.reduced_nodes),hotspot_k=max(p['conductor_temperature_k'] for p in powers),
            cables=powers,iterations=history,energy_relative_residual=balance,physical_residual_w_m=physical,
            outer_boundary=boundary,duct_air_states=air),temperature


def run(folder):
    """Native worker: progressively refine two published cases, keeping failures."""
    from cablesim_iec60287.domain import prepare
    from cablesim_iec60287.group import rate_group
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True);report={'cases':[],'job_id':os.environ.get('SLURM_JOB_ID')}
    for number in (1,2):
        fixture_path=Path(__file__).parent/'cases'/('tb880-buried.json' if number==1 else 'tb880-ducts.json')
        raw=fixture_path.read_bytes();fixture=json.loads(raw);d,p=inputs(fixture)
        reference=fixture['expected']['ampacityA'];d['load_cases'][0]['currents'][d['circuits'][0]['id']]=reference
        group=prepare(d,p);iec=rate_group(group)
        item={'id':f'B02-{number}','case_id':fixture['caseId'],'source':fixture['source'],
            'fixture_sha256':sha256(raw).hexdigest(),'input':d,'parameters':p,'reference_current_a':reference,
            'reference_temperature_k':363.15,'iec':iec,'levels':[],'status':'partial','report_tolerance':None}
        report['cases'].append(item)
        try:
            for extent,size in ((8.,.0024),(8.,.0012),(8.,.0006),(16.,.0006),(32.,.0006),(64.,.0006)):
                start=time.monotonic();model,controls=thermal_model(d,group,size,extent)
                solver=ConstrainedField(model,controls,group);state,_=solver.state(reference)
                state.update(bounds_m=[-extent,-extent,extent,0.],mesh_size_m=size,wall_seconds=time.monotonic()-start,
                    kind='mesh' if extent==8. else 'domain');item['levels'].append(state)
                (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,allow_nan=False),'utf-8')
            mesh=item['levels'][:3];domain=[item['levels'][2],*item['levels'][3:]]
            changes=lambda rows:[abs(b['hotspot_k']-a['hotspot_k']) for a,b in zip(rows,rows[1:])]
            item['convergence']={'threshold_k':.1,'mesh_changes_k':changes(mesh),'domain_changes_k':changes(domain)}
            item['convergence']['passed']=all(v<.1 for v in changes(mesh)[-2:]+changes(domain)[-2:])
            # Comparison on the final verified mesh, never a different grid.
            truncated,_=solver.state(reference,'ambient_truncated');item['truncated_64m']=truncated
            if item['convergence']['passed']:
                from scipy.optimize import brentq
                trials=[]
                def excess(current):
                    state,_=solver.state(current);trials.append(dict(current_a=current,hotspot_k=state['hotspot_k']))
                    return state['hotspot_k']-363.15
                item['ampacity_a']=brentq(excess,0.,reference*1.3,xtol=.001);item['rating_trials']=trials
                state,temperature=solver.state(item['ampacity_a']);item['rating_state']=state
                import numpy as np
                np.savez_compressed(folder/f'case-{number}-field.npz',points=solver.system.points,
                    triangles=solver.system.cells,temperature_k=temperature)
        except Exception as exc:item['failure']={'type':type(exc).__name__,'message':str(exc)}
        (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,allow_nan=False),'utf-8')
    return report


def compare_boundaries(folder):
    from cablesim_iec60287.domain import prepare
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    result={'job_id':os.environ.get('SLURM_JOB_ID'),'rows':[]}
    for number,name in ((1,'tb880-buried'),(2,'tb880-ducts')):
        fixture=json.loads((Path(__file__).parent/'cases'/f'{name}.json').read_text('utf-8'))
        d,p=inputs(fixture);group=prepare(d,p);current=fixture['expected']['ampacityA']
        for extent in (8.,16.):
            model,controls=thermal_model(d,group,.0006,extent);solver=ConstrainedField(model,controls,group)
            for boundary in ('kennelly_image','ambient_truncated'):
                start=time.monotonic();state,_=solver.state(current,boundary)
                state.update(case_id=f'B02-{number}',extent_m=extent,mesh_size_m=.0006,wall_seconds=time.monotonic()-start)
                result['rows'].append(state)
                (folder/'boundaries.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),'utf-8')
    return result


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--boundaries',action='store_true')
    args=parser.parse_args()
    if args.boundaries:compare_boundaries(args.output)
    else:run(args.output)
