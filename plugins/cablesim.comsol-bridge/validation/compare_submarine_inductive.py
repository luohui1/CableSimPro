"""Read and solve the installed final tutorial04, preserving the original file."""
from pathlib import Path
from hashlib import sha256
import json
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.comsol-bridge/src')]
from cablesim_comsol_bridge.runtime import execute,resolve

JAVA=r'''import com.comsol.model.*;import com.comsol.model.util.*;import java.util.*;
public class BridgeJob {
static void line(String key,double value){System.out.println("BRIDGE_VALUE|"+key+"|"+value);}
public static void main(String[] args)throws Exception{
for(String p:new String[]{"COMSOL","ACDC"})System.out.println("BRIDGE_PRODUCT="+p+":"+(ModelUtil.hasProduct(p)&&ModelUtil.checkoutLicense(p)));
Model m=ModelUtil.load("Model",MODEL);
for(String tag:m.component("comp1").physics("mf").feature().tags()){
System.out.println("BRIDGE_DEF|"+tag+".type|"+m.component("comp1").physics("mf").feature(tag).getType());
for(String prop:new String[]{"ConductorModel","CoilExcitation","ICoil","VCoil","sigmaCoil","coilWindArea","CoilGroup","N"})try{System.out.println("BRIDGE_DEF|"+tag+"."+prop+"|"+Arrays.deepToString(m.component("comp1").physics("mf").feature(tag).getStringMatrix(prop)));}catch(Exception e){}
}
m.component("comp1").mesh().remove("mesh1");m.component("comp1").mesh().create("mesh1");m.component("comp1").mesh("mesh1").autoMeshSize(LEVEL);m.component("comp1").mesh("mesh1").run();m.study("std1").run();
line("nodes",m.component("comp1").mesh("mesh1").getVertex()[0].length);
String[] selections={"uni1","geom1_uni3_dom","geom1_c19_dom","geom1_c17_dom"};String[] names={"conductor","screen","armor","fiber"};
for(int i=0;i<selections.length;i++){
m.result().numerical().create("auditInt","IntSurface");m.result().numerical("auditInt").selection().named(selections[i]);m.result().numerical("auditInt").set("expr",new String[]{"mf.Qh","1"});double[][] result=m.result().numerical("auditInt").getReal();line(names[i]+"_loss_w_m",result[0][0]);line(names[i]+"_area_m2",result[1][0]);m.result().numerical().remove("auditInt");}
m.result().numerical().create("auditGlobal","EvalGlobal");String[] expr={"mf.RCoil_1/1[m]","mf.RCoil_2/1[m]","mf.RCoil_3/1[m]","Scup","Acon","I0"};m.result().numerical("auditGlobal").set("expr",expr);double[][] g=m.result().numerical("auditGlobal").getReal();for(int i=0;i<expr.length;i++)line(expr[i],g[i][0]);
System.out.println("BRIDGE_COMPLETE");}}
'''


def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--levels',nargs='+',type=int,default=[7,5,3]);args=p.parse_args()
    if not all(1<=i<=9 for i in args.levels):raise ValueError('Mesh levels 1..9 required')
    model=resolve()[0].parents[2]/'applications/ACDC_Module/Tutorials,_Cables/submarine_cable_04_inductive_effects.mph'
    before=sha256(model.read_bytes()).hexdigest();out=ROOT/'.data/simulation/submarine-inductive';out.mkdir(parents=True,exist_ok=True)
    for level in args.levels:
        source=JAVA.replace('MODEL',json.dumps(model.as_posix())).replace('LEVEL',str(level))
        log,evidence=execute(source,ROOT/'.tmp/simulation-seventh-native'/('inductive-'+str(level)),['COMSOL','ACDC'],timeout=1800,save_model=False)
        values={line.split('|')[1]:float(line.split('|')[2]) for line in log.splitlines() if line.startswith('BRIDGE_VALUE|')}
        definitions={line.split('|')[1]:line.split('|',2)[2] for line in log.splitlines() if line.startswith('BRIDGE_DEF|')}
        if sha256(model.read_bytes()).hexdigest()!=before:raise ValueError('Installed tutorial changed')
        value={'source_model_sha256':before,'solver':evidence,'source':source,'level':level,'values':values,'definitions':definitions,'engineering_approval':False}
        (out/('native-'+str(level)+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
        print(json.dumps({'values':values,'definitions':definitions}),flush=True)


if __name__=='__main__':main()
