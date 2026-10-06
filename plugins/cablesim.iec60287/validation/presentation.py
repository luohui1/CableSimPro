"""Reproduce the declared public four-source analytical validation figure.

Only closed algebra is used; no finite-element solver, fitting or remote jobs.
"""
import argparse
from hashlib import sha256
import io
import json
from math import acosh, log, pi
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.iec60287/src')]
from cablesim_iec60287.soil import resistance_matrix
from cablesim_iec60287.soil_view import surface_checks

SOURCE='plugins/cablesim.iec60287/tests/test_iec60287_group.py:50-60'


def series():
    points=[(0,-.8),(.3,-1.2),(-.45,-1),(.8,-.9)]
    radii=[.02,.025,.03,.025];losses=[8,17,2,11];rho=1.3;ambient=293.15
    matrix,_=resistance_matrix(points,radii,rho)
    reference=[]
    for i,(xi,zi) in enumerate(points):
        reference.append(ambient+sum(rho/(2*pi)*(acosh(-zi/radii[i]) if i==j else
            .5*log(((xi-xj)**2+(zi+zj)**2)/((xi-xj)**2+(zi-zj)**2)))*losses[j]
            for j,(xj,zj) in enumerate(points)))
    sources=[dict(entity=f'cable-{i+1}',center_m=p,radius_m=r,loss_w_m=q,
        reference_temperature_k=ambient+sum(h*w for h,w in zip(matrix[i],losses)))
        for i,(p,r,q) in enumerate(zip(points,radii,losses))]
    checks=surface_checks(sources,rho,ambient)
    return dict(source=SOURCE,points_m=points,radii_m=radii,losses_w_m=losses,
                soil_thermal_resistivity_k_m_w=rho,ambient_k=ambient,
                reference_k=reference,checks=checks,surface_check_tolerance_k=.1)


def render(data):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.family':'Microsoft YaHei','svg.fonttype':'path',
                         'svg.hashsalt':'cablesim.iec60287.kennelly-four-source','font.size':10})
    fig,axes=plt.subplots(1,2,figsize=(9.6,4.4),layout='constrained')
    x=list(range(1,5));checks=data['checks']
    axes[0].plot(x,[v-273.15 for v in data['reference_k']],'o-',label='独立闭式热阻 × 原损耗')
    axes[0].plot(x,[v['mean_temperature_k']-273.15 for v in checks],'x--',label='镜像场64点表面平均')
    axes[0].set(xlabel='电缆编号',ylabel='外表面平均温度 / °C',xticks=x);axes[0].legend(fontsize=9)
    axes[1].bar(x,[v['absolute_error_k'] for v in checks],color='#327683')
    axes[1].axhline(.1,color='#aa5533',linestyle='--',label='0.1 K拒绝阈值')
    axes[1].set(xlabel='电缆编号',ylabel='绝对差 / K',xticks=x);axes[1].legend(fontsize=9)
    fig.suptitle('IEC已声明解析算例：四热源、不同埋深与损耗；无数值求解器')
    fig.supxlabel('来源：test_iec60287_group.py:50–60；ρ=1.3 K·m/W，Q=[8,17,2,11] W/m',fontsize=9)
    output=io.StringIO()
    fig.savefig(output,format='svg',metadata={'Date':None,'Description':json.dumps(data,ensure_ascii=False)})
    plt.close(fig)
    value=output.getvalue()
    return value[value.index('<svg'):].encode('utf-8')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'plugins/cablesim.iec60287/assets/validation.svg')
    parser.add_argument('--check',action='store_true',help='Verify the recorded data, without rendering or changing any file.')
    args=parser.parse_args();data=series()
    if args.check:
        import xml.etree.ElementTree as ET
        root=ET.fromstring(args.output.read_bytes())
        text=next(node.text for node in root.iter() if node.tag.endswith('}description'))
        recorded=json.loads(text)
        if recorded!=json.loads(json.dumps(data)):raise SystemExit('validation figure data differs from declared analytical case')
    else:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(render(data))
    print(json.dumps({'source':SOURCE,'maximum_absolute_error_k':max(r['absolute_error_k'] for r in data['checks']),
                      'sha256':sha256(args.output.read_bytes()).hexdigest(),'check':args.check},ensure_ascii=False))


if __name__=='__main__':main()
