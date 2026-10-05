"""Read installed tutorial geometry/parameter/function definitions, without solving."""
from pathlib import Path
from hashlib import sha256
import json
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.comsol-bridge/src')]
from cablesim_comsol_bridge.runtime import execute,resolve

JAVA=r'''import com.comsol.model.*;import com.comsol.model.util.*;import java.util.*;
public class BridgeJob {
static String quoted(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r")+"\"";}
static void line(String key,String value){System.out.println("BRIDGE_DEF|"+quoted(key)+"|"+quoted(value));}
public static void main(String[] args)throws Exception {
System.out.println("BRIDGE_VERSION="+ModelUtil.getComsolVersion());for(String p:new String[]{"COMSOL","ACDC","HEATTRANSFER"})System.out.println("BRIDGE_PRODUCT="+p+":"+(ModelUtil.hasProduct(p)&&ModelUtil.checkoutLicense(p)));
Model m=ModelUtil.load("Model",MODEL);
for(String p:m.param().varnames()){line("parameter."+p,m.param().get(p));try{line("value."+p,String.valueOf(m.param().evaluate(p)));}catch(Exception e){}}
for(String tag:m.component("comp1").geom("geom1").feature().tags()){
GeomFeature f=m.component("comp1").geom("geom1").feature(tag);line("geometry."+tag+".type",f.getType());line("geometry."+tag+".label",f.label());
for(String p:f.properties()){try{line("geometry."+tag+"."+p,Arrays.deepToString(f.getStringMatrix(p)));}catch(Exception e){try{line("geometry."+tag+"."+p,Arrays.toString(f.getStringArray(p)));}catch(Exception e2){try{line("geometry."+tag+"."+p,f.getString(p));}catch(Exception e3){}}}}
for(String s:new String[]{"input","input2"})try{line("geometry."+tag+".selection."+s,Arrays.toString(f.selection(s).objects()));}catch(Exception e){}
}
for(String tag:m.func().tags()){
line("function."+tag+".type",m.func(tag).getType());
for(String p:m.func(tag).properties())try{line("function."+tag+"."+p,Arrays.deepToString(m.func(tag).getStringMatrix(p)));}catch(Exception e){try{line("function."+tag+"."+p,m.func(tag).getString(p));}catch(Exception e2){}}
}
for(String tag:m.component("comp1").func().tags()){
line("component_function."+tag+".type",m.component("comp1").func(tag).getType());
for(String p:m.component("comp1").func(tag).properties())try{line("component_function."+tag+"."+p,Arrays.deepToString(m.component("comp1").func(tag).getStringMatrix(p)));}catch(Exception e){try{line("component_function."+tag+"."+p,m.component("comp1").func(tag).getString(p));}catch(Exception e2){}}
}
System.out.println("BRIDGE_COMPLETE");}}
'''


def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['02','04','06'],default='06');args=parser.parse_args()
    stem={'02':'02_capacitive_effects','04':'04_inductive_effects','06':'06_thermal_effects'}[args.mode]
    model=resolve()[0].parents[2]/'applications/ACDC_Module/Tutorials,_Cables'/('submarine_cable_'+stem+'.mph')
    before=sha256(model.read_bytes()).hexdigest();source=JAVA.replace('MODEL',json.dumps(model.as_posix()))
    log,evidence=execute(source,ROOT/'.tmp/simulation-seventh-native'/('definition-'+args.mode),['COMSOL','ACDC','HEATTRANSFER'],save_model=False)
    if sha256(model.read_bytes()).hexdigest()!=before:raise ValueError('Installed model changed')
    values={}
    for line in log.splitlines():
        if line.startswith('BRIDGE_DEF|'):
            key,value=line[len('BRIDGE_DEF|'):].split('|',1);values[json.loads(key)]=json.loads(value)
    out=ROOT/'.data/simulation/tutorial-definition';out.mkdir(parents=True,exist_ok=True)
    (out/(stem+'.json')).write_text(json.dumps({'source_model_sha256':before,'solver':evidence,'definition':values,'source':source},ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'model':stem,'definitions':len(values)}),flush=True)


if __name__=='__main__':main()
