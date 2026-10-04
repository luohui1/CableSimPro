"""Export installed tutorial meshes and independently rerun native references.

The mesh is COMSOL-generated benchmark evidence, not an open mesher claim.
The thermal replay deliberately imports the native electromagnetic heat source.
"""
from pathlib import Path
from hashlib import sha256
import json
import shutil
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.comsol-bridge/src')]
from cablesim_comsol_bridge.runtime import execute,resolve

JAVA=r'''import com.comsol.model.*;import com.comsol.model.util.*;import java.util.*;import java.io.*;
public class BridgeJob {
static String repr(Object a){if(a instanceof Object[])return Arrays.deepToString((Object[])a);if(a instanceof int[])return Arrays.toString((int[])a);if(a instanceof double[])return Arrays.toString((double[])a);return String.valueOf(a);}
static void field(PrintWriter out,String key,Object a){out.println("\""+key+"\":"+repr(a)+",");}
static void mesh(Model m,PrintWriter out){
field(out,"points",m.component("comp1").mesh("mesh1").getVertex());
field(out,"triangles",m.component("comp1").mesh("mesh1").getElem("tri"));
field(out,"domain_ids",m.component("comp1").mesh("mesh1").getElemEntity("tri"));
field(out,"edges",m.component("comp1").mesh("mesh1").getElem("edg"));
field(out,"edge_ids",m.component("comp1").mesh("mesh1").getElemEntity("edg"));
}
static double[][][] sample(Model m,String[] expr,double[][] coord){
m.result().numerical().create("auditSample","Interp");m.result().numerical("auditSample").set("expr",expr);
m.result().numerical("auditSample").set("data","auditData");
m.result().numerical("auditSample").setInterpolationCoordinates(coord);m.result().numerical("auditSample").selection().all();
double[][][] data=m.result().numerical("auditSample").getData();m.result().numerical().remove("auditSample");return data;}
public static void main(String[] args)throws Exception {
System.out.println("BRIDGE_VERSION="+ModelUtil.getComsolVersion());for(String p:new String[]{"COMSOL","ACDC","HEATTRANSFER"})System.out.println("BRIDGE_PRODUCT="+p+":"+(ModelUtil.hasProduct(p)&&ModelUtil.checkoutLicense(p)));
for(String mode:MODES)for(int level:LEVELS){
Model m=ModelUtil.load("Model",INSTALL+"/submarine_cable_"+mode+".mph");
// A fresh automatic mesh leaves the installed geometry and original file intact.
m.component("comp1").mesh().remove("mesh1");m.component("comp1").mesh().create("mesh1");
m.component("comp1").mesh("mesh1").autoMeshSize(level);m.component("comp1").mesh("mesh1").run();
StringWriter buffer=new StringWriter();PrintWriter out=new PrintWriter(buffer);out.println("{");mesh(m,out);
if(mode.startsWith("02")){
String[] expr=new String[12];for(int j=0;j<6;j++){expr[2*j]="real(ec.I0_"+(j+1)+")";expr[2*j+1]="imag(ec.I0_"+(j+1)+")";}
double[][] matrix=new double[6][12];
for(int col=0;col<6;col++){
for(int j=0;j<6;j++)m.component("comp1").physics("ec").feature("term"+(j+1)).set("V0",j==col?"1[V]":"0[V]");
m.study("std1").run();m.result().numerical().create("auditI","EvalGlobal");m.result().numerical("auditI").set("expr",expr);
double[][] a=m.result().numerical("auditI").getReal();for(int j=0;j<12;j++)matrix[col][j]=a[j][0];m.result().numerical().remove("auditI");
}
field(out,"admittance_columns",matrix);field(out,"frequency_hz",m.param().evaluate("f0"));
}else{
m.study("std1").run();
m.result().dataset().create("auditData","Solution");m.result().dataset("auditData").set("solution","sol1");
double[][] p=m.component("comp1").mesh("mesh1").getVertex();int[][] tri=m.component("comp1").mesh("mesh1").getElem("tri");
double[][] coords=new double[2][tri[0].length];for(int e=0;e<tri[0].length;e++)for(int j=0;j<3;j++)for(int d=0;d<2;d++)coords[d][e]+=p[d][tri[j][e]]/3;
field(out,"centroid_temperature_k",sample(m,new String[]{"T"},coords));
double[][][] heat=sample(m,new String[]{"mf.Qh"},coords);int[] domains=m.component("comp1").mesh("mesh1").getElemEntity("tri");
// These exterior gravel/water domains are outside the magnetic interface;
// the tutorial couples no electromagnetic heat source into them.
for(int e=0;e<domains.length;e++)if(domains[e]==1||domains[e]==2||domains[e]==7)heat[0][0][e]=0;
field(out,"centroid_heat_w_m3",heat);field(out,"nonmagnetic_exterior_domains",new int[]{1,2,7});
field(out,"contact_edges",m.component("comp1").physics("ht").feature("sls1").selection().entities());
field(out,"temperature_edges",m.component("comp1").physics("ht").feature("temp1").selection().entities());
field(out,"ambient_k",m.param().evaluate("Tmext"));
m.result().numerical().create("auditMax","MaxSurface");m.result().numerical("auditMax").selection().all();m.result().numerical("auditMax").set("expr","T");field(out,"maximum_k",m.result().numerical("auditMax").getReal());
}
out.println("\"engineering_approval\":false}");out.close();System.out.println("BRIDGE_PAYLOAD|"+mode+"-"+level+"|"+buffer.toString().replace("\n","").replace("\r",""));ModelUtil.remove("Model");
}
System.out.println("BRIDGE_COMPLETE");}}
'''


def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['02','06'],required=True);parser.add_argument('--levels',nargs='+',type=int,default=[7,6,5]);args=parser.parse_args()
    if not all(1<=n<=9 for n in args.levels):raise ValueError('Mesh level must be 1..9')
    mode={'02':'02_capacitive_effects','06':'06_thermal_effects'}[args.mode]
    installed=resolve()[0].parents[2]/'applications/ACDC_Module/Tutorials,_Cables'
    source_file=installed/('submarine_cable_'+mode+'.mph');before=sha256(source_file.read_bytes()).hexdigest()
    output=ROOT/'.data/simulation/full-fields';output.mkdir(parents=True,exist_ok=True)
    source=JAVA.replace('INSTALL',json.dumps(installed.as_posix())).replace('OUTPUT',json.dumps(output.as_posix())).replace('MODES','new String[]{'+json.dumps(mode)+'}').replace('LEVELS','new int[]{'+','.join(map(str,args.levels))+'}')
    work=ROOT/('.tmp/simulation-sixth-native/export-'+args.mode)
    log,evidence=execute(source,work,['COMSOL','ACDC','HEATTRANSFER'],timeout=1800,save_model=False)
    if sha256(source_file.read_bytes()).hexdigest()!=before:raise RuntimeError('Installed tutorial changed')
    payloads={line.split('|',2)[1]:json.loads(line.split('|',2)[2]) for line in log.splitlines() if line.startswith('BRIDGE_PAYLOAD|')}
    for level in args.levels:
        path=output/(mode+'-'+str(level)+'.json');data=payloads[mode+'-'+str(level)]
        data.update(source_model_sha256=before,solver=evidence,source=source,mesh_provenance='COMSOL automatic triangle mesh of installed tutorial geometry; independent open field assembly')
        path.write_text(json.dumps(data,separators=(',',':'),allow_nan=False),'utf-8')
        print(json.dumps({'mode':mode,'level':level,'nodes':len(data['points'][0]),'elements':len(data['domain_ids'])}),flush=True)


if __name__=='__main__':main()
