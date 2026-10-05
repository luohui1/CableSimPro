"""Numeric reconstruction of the documented 2D inductive tutorial, no MPH assets."""
from math import pi,sqrt,cos,sin


def inductive(series=False,h=.001):
    source='COMSOL 6.2 submarine cable 01 pp29,31-35,49-56; a/b/c parameter files; tutorial04 pp6-10 Table1'
    dcon=.0262;dins=.0776;tpbs=.0029;tpe=.0029;dpha=dins+2*tpbs+2*tpe
    dpha3=dpha*(2/sqrt(3)+1);dcab=.219;darm=(dcab+dpha3)/2;tscc=(dins/2-dcon/2-.024)/2
    geometry=[];excitations=[]
    def disk(uid,x,y,r,sigma=0,mu=1,loss=0):
        geometry.append({'uid':uid,'kind':'disk','values':[x,y,r],
                         'material':{'conductivity_s_m':sigma,'relative_permeability':mu,'relative_permeability_loss':loss,'source':source}})
    def excitation(ids,kind='voltage_gradient_v_m',value=(0,0),connection='parallel'):
        excitations.append({'regions':ids,'kind':kind,'value':list(value),'connection':connection,'source':source})
    disk('gravel',0,0,5*dcab/2,1);excitation(['gravel'])
    disk('cable-polymers',0,0,dcab/2)
    for phase,(x,y),angle in zip('ABC',[(-dpha/2/sqrt(3),dpha/2),(dpha/sqrt(3),0),(-dpha/2/sqrt(3),-dpha/2)],[0,-120,120]):
        disk(phase+'/PE',x,y,dpha/2)
        disk(phase+'/screen',x,y,dins/2+tpbs,4.55e6);excitation([phase+'/screen'])
        disk(phase+'/outer-SCC',x,y,dins/2,2);excitation([phase+'/outer-SCC'])
        disk(phase+'/XLPE',x,y,dins/2-tscc)
        disk(phase+'/inner-SCC',x,y,dcon/2+tscc,2);excitation([phase+'/inner-SCC'])
        disk(phase+'/conductor',x,y,dcon/2,5.96e7*.0005/(pi*(dcon/2)**2))
        excitation([phase+'/conductor'],'current_rms_a',(655*cos(angle*pi/180),655*sin(angle*pi/180)))
    disk('fiber-steel',-dpha*.836015,0,.00125+.0005,1.46e6);excitation(['fiber-steel'])
    disk('fiber-core',-dpha*.836015,0,.00125)
    armor=[]
    for i in range(110):
        uid=f'armor-{i+1}';armor.append(uid);a=2*pi*(i+1)/110
        disk(uid,darm/2*cos(a),darm/2*sin(a),.0028,4.03e6,100,50)
        if not series:excitation([uid])
    if series:excitation(armor,connection='series')
    return ({'schema_version':'cablesim.simulation-problem/1','physics':'magnetic_harmonic',
            'geometry':geometry,'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'magnetic_potential','value':0}],
            'excitations':excitations,'frequency_hz':50,'probes_m':[],
            'provenance':{'all':{'source':source}},'assumptions':[
                'RMS 655 A; copper conductivity adjusted by documented Ncon; 20 C fixed electrical properties.',
                'Constant mu=100-50j in armor; magnetic loss retained separately from Joule heat.',
                'All non-SCC polymers are collapsed into sigma=0,mu=1 electromagnetic regions; no thermal equivalence claimed.',
                'Neglect polymer leakage 1e-18..3.2e-9 S/m and displacement currents; no Milliken homogenization.',
                'A=0 on original electromagnetic circle R=5*Dcab/2; gravel sigma=1 S/m.']},
            {'size_m':h,'far_size_m':.025,'transition_m':.2,'max_nodes':120000,'field_order':2})
