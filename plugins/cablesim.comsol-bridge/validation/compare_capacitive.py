"""Re-solve installed COMSOL02/03 tutorials; never distribute or alter MPH files."""
from pathlib import Path
from hashlib import sha256
import sys,json,shutil
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.comsol-bridge/src')]
from cablesim_comsol_bridge.runtime import execute,resolve


JAVA=r'''import com.comsol.model.*;import com.comsol.model.util.*;import java.util.*;
public class BridgeJob {
static double edgeHeight(Model m,int boundary){double[][] p=m.component("comp1").mesh("mesh1").getVertex();int[][] edges=m.component("comp1").mesh("mesh1").getElem("edg");int[] ids=m.component("comp1").mesh("mesh1").getElemEntity("edg");double total=0;int n=0;for(int i=0;i<ids.length;i++)if(ids[i]==boundary){total+=p[1][edges[0][i]]+p[1][edges[1][i]];n+=2;}if(n==0)throw new IllegalStateException("Missing mesh boundary "+boundary);return total/n;}
static void metric(Model m,String mode,String tag,String kind,int[] selection,String[] expressions){m.result().numerical().create(tag,kind);if(selection==null)m.result().numerical(tag).selection().all();else m.result().numerical(tag).selection().set(selection);if(kind.equals("IntSurface"))m.result().numerical(tag).set("intvolume",true);m.result().numerical(tag).set("expr",expressions);System.out.println("BRIDGE_DATA|"+mode+"-"+tag+"|"+Arrays.deepToString(m.result().numerical(tag).getReal()));}
public static void main(String[] a)throws Exception {
System.out.println("BRIDGE_VERSION="+ModelUtil.getComsolVersion());for(String p:new String[]{"COMSOL","ACDC"})System.out.println("BRIDGE_PRODUCT="+p+":"+(ModelUtil.hasProduct(p)&&ModelUtil.checkoutLicense(p)));
for(String mode:new String[]{"single_point","both_ends","cross_bonded"}){
Model m=ModelUtil.load("Model",PATH03);
m.component("comp1").mesh("mesh1").run();
int lower=edgeHeight(m,23)<edgeHeight(m,28)?23:28;
System.out.println("BRIDGE_DATA|"+mode+"-ground|"+lower);
if(mode.equals("single_point"))m.component("comp1").physics("ec").feature("gnd1").selection().set(new int[]{lower});
if(!mode.equals("cross_bonded")){
m.component("comp1").physics("ec").feature("ein2").active(false);
for(String t:new String[]{"pot1","pot2","pot3"})m.component("comp1").physics("ec").feature(t).set("V0","V0-I0*Rcon*sys2.z");
}else{
String[] tags={"pot1","pot2","pot3"};Integer[] order={0,1,2};double[] h=new double[3];for(int j=0;j<3;j++)h[j]=edgeHeight(m,m.component("comp1").physics("ec").feature(tags[j]).selection().entities()[0]);
for(int x=0;x<3;x++)for(int y=x+1;y<3;y++)if(h[order[x]]>h[order[y]]){int swap=order[x];order[x]=order[y];order[y]=swap;}
String[] phase={"0","-120[deg]","120[deg]"};for(int j=0;j<3;j++)m.component("comp1").physics("ec").feature(tags[order[j]]).set("V0","(V0-I0*Rcon*sys2.z)*exp(i*("+phase[j]+"))");
}
m.study("std1").run();
metric(m,mode,"sheathloss","IntSurface",new int[]{10,11,12},new String[]{"ec.Qh*Scab"});
metric(m,mode,"totalloss","IntSurface",null,new String[]{"ec.Qh*Scab"});
metric(m,mode,"sheathmax","MaxSurface",new int[]{10,11,12},new String[]{"abs(V)","ec.normJ*Apbs"});
System.out.println("BRIDGE_DATA|"+mode+"-nodes|"+m.component("comp1").mesh("mesh1").getNumVertex());ModelUtil.remove("Model");
}
Model m=ModelUtil.load("Model",PATH02);
m.param().set("V1","V0");m.param().set("V2","0[V]");m.study("std1").run();
m.result().numerical().create("charge","EvalGlobal");m.result().numerical("charge").set("expr",new String[]{"abs(ec.I0_1)","abs(ec.I0_2)","abs(ec.I0_3)","Cpha","Icpha"});System.out.println("BRIDGE_DATA|radial-charge|"+Arrays.deepToString(m.result().numerical("charge").getReal()));
System.out.println("BRIDGE_COMPLETE");}}'''


def main():
    installed=resolve()[0].parents[2]/'applications/ACDC_Module/Tutorials,_Cables'
    names=['submarine_cable_02_capacitive_effects','submarine_cable_03_bonding_capacitive']
    paths=[installed/(n+'.mph') for n in names]
    if not all(p.is_file() for p in paths):raise ValueError('Installed tutorial02/03 files missing; no approximate fallback')
    before={n:sha256(p.read_bytes()).hexdigest() for n,p in zip(names,paths)}
    java=JAVA.replace('PATH02',json.dumps(paths[0].as_posix())).replace('PATH03',json.dumps(paths[1].as_posix()))
    work=ROOT/'.tmp/simulation-capacitive-reference'
    try:
        log,evidence=execute(java,work,['COMSOL','ACDC'],save_model=False)
        data={l.split('|',2)[1]:json.loads(l.split('|',2)[2]) for l in log.splitlines() if l.startswith('BRIDGE_DATA|')}
        after={n:sha256(p.read_bytes()).hexdigest() for n,p in zip(names,paths)}
        if before!=after:raise RuntimeError('Installed tutorial hash changed during reference execution')
        data.update(source_model_sha256=before,solver=evidence,source=java,
                    scope='03 same axisymmetric field, continuous sheath, bottom-to-top phase0/-120/+120; 02 full cross-section grounded-screen native versus open coaxial charging submodel',
                    engineering_approval=False)
        out=ROOT/'.data/simulation/capacitive/native-reference.json';out.parent.mkdir(parents=True,exist_ok=True)
        out.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
        print(json.dumps({k:v for k,v in data.items() if k not in ('source','solver')},ensure_ascii=False),flush=True)
    finally:
        if work.is_dir():shutil.rmtree(work)


if __name__=='__main__':main()
