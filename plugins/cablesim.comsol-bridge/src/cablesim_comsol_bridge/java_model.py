"""Translate a validated SI problem to COMSOL's native physics interfaces."""
import json
from math import sqrt


def quoted(value):
    return json.dumps(value, ensure_ascii=True)


def number(value):
    return format(float(value), '.17g')


def strings(values):
    return 'new String[]{'+','.join(quoted(v) for v in values)+'}'


def doubles(values):
    return 'new double[]{'+','.join(number(v) for v in values)+'}'


def source(problem, mesh, *, check=False):
    magnetic=problem['physics']=='magnetic_harmonic'
    if mesh.get('field_order') == 1:
        raise ValueError('mesh.field_order：COMSOL 桥接使用原生二阶单元，请设置 2 或不指定。')
    if mesh.get('minimum_circle_segments',8) != 8:
        raise ValueError('mesh.minimum_circle_segments：COMSOL 使用原生曲边单元，不支持指定 GetDP 多边形边数。')
    if mesh.get('probe_cell_size_m') is not None or mesh.get('exterior_growth_start_m') is not None:
        raise ValueError('mesh：固定探测单元及外域分段增长目前仅支持 GetDP，不能静默忽略。')
    if any(g.get('void') for g in problem['geometry']):
        raise ValueError('geometry.void：COMSOL 桥接暂不翻译内孔边界；请使用受支持的显式实体问题。')
    if problem['physics']=='transient_heat':
        raise ValueError('physics：COMSOL 桥接暂态时间序列翻译尚未启用；本能力支持稳态热和时谐电磁。')
    if magnetic and any(b['kind']!='magnetic_potential' or b['selector']!='outer' or b['value']!=0 for b in problem['boundaries']):
        raise ValueError('boundaries：COMSOL 电磁能力当前需要整个外边界 A=0。')
    module='ACDC' if magnetic else 'HEATTRANSFER'
    lines=['import com.comsol.model.*;', 'import com.comsol.model.util.*;', 'import java.util.*;',
           'public class BridgeJob {',
           'static void line(String key,Object value){System.out.println("BRIDGE_DATA|"+key+"|"+value);}',
           'static String array(double[][] a){return Arrays.deepToString(a);}',
           'static int[] difference(int[] a,Set<Integer> b){int n=0;for(int v:a)if(!b.contains(v))n++;int[] out=new int[n];n=0;for(int v:a)if(!b.contains(v))out[n++]=v;return out;}',
           'static int[] join(int[][] values){int n=0;for(int[] row:values)n+=row.length;int[] out=new int[n];n=0;for(int[] row:values)for(int v:row)out[n++]=v;return out;}',
           'static double[][] integral(Model m,String tag,int[] domains,String[] expr){',
           'm.result().numerical().create(tag,"IntSurface");m.result().numerical(tag).selection().set(domains);',
           'm.result().numerical(tag).set("expr",expr);return m.result().numerical(tag).getReal();}',
           'static double[][][] sample(Model m,String tag,double[][] coords,String[] expr,int[] domains){',
           'm.result().numerical().create(tag,"Interp");m.result().numerical(tag).set("data","dset1");m.result().numerical(tag).setInterpolationCoordinates(coords);',
           'm.result().numerical(tag).set("edim",2);m.result().numerical(tag).set("expr",expr);',
           'if(domains!=null)m.result().numerical(tag).selection().set(domains);else m.result().numerical(tag).selection().all();return m.result().numerical(tag).getData();}',
           'public static void main(String[] args) throws Exception {',
           'System.out.println("BRIDGE_VERSION="+ModelUtil.getComsolVersion());',
           f'for(String p:new String[]{{"COMSOL","{module}"}}){{boolean ok=ModelUtil.hasProduct(p)&&ModelUtil.checkoutLicense(p);System.out.println("BRIDGE_PRODUCT="+p+":"+ok);if(!ok){{System.out.println("BRIDGE_ENVIRONMENT_MISSING");return;}}}}']
    if check:
        return '\n'.join(lines+['System.out.println("BRIDGE_COMPLETE");','}','}'])
    lines+=['buildGeometry();buildMaterials();buildPhysics();runMesh();report();',
            'System.out.println("BRIDGE_COMPLETE");','}',
            'static Model m; static int[][] regions;',
            'static void buildGeometry(){',
            'm=ModelUtil.create("Model");m.component().create("comp1",true);',
            'm.component("comp1").geom().create("geom1",2);',
            'm.component("comp1").geom("geom1").lengthUnit("m");']
    count=len(problem['geometry'])
    for i,g in enumerate(problem['geometry']):
        tag='s'+str(i);v=g['values'];kind='Circle' if g['kind']=='disk' else 'Rectangle'
        lines += [f'm.component("comp1").geom("geom1").create("{tag}","{kind}");',
                  f'm.component("comp1").geom("geom1").feature("{tag}").set("pos",{doubles(v[:2])});',
                  f'm.component("comp1").geom("geom1").feature("{tag}").set("selresult","on");']
        if kind=='Circle':
            lines.append(f'm.component("comp1").geom("geom1").feature("{tag}").set("r",{number(v[2])});')
        else:
            lines.append(f'm.component("comp1").geom("geom1").feature("{tag}").set("size",{doubles([v[2]-v[0],v[3]-v[1]])});')
    for i,point in enumerate(problem['probes_m']):
        lines += [f'm.component("comp1").geom("geom1").create("probePoint{i}","Point");',
                  f'm.component("comp1").geom("geom1").feature("probePoint{i}").set("p",{doubles(point)});',
                  f'm.component("comp1").geom("geom1").feature("probePoint{i}").set("selresult","on");']
    lines+=['m.component("comp1").geom("geom1").run();',f'regions=new int[{count}][];',
            'Set<Integer> claimed=new HashSet<Integer>();']
    for i,g in reversed(list(enumerate(problem['geometry']))):
        lines += [f'regions[{i}]=difference(m.component("comp1").selection("geom1_s{i}_dom").entities(2),claimed);',
                  f'if(regions[{i}].length==0)throw new IllegalArgumentException("geometry[{i}]: empty material region");',
                  f'for(int d:regions[{i}])claimed.add(d);',f'line("region-{i}",Arrays.toString(regions[{i}]));']
    lines+=['}','static void buildMaterials(){']
    for i,g in enumerate(problem['geometry']):
        mat=g['material'];tag='mat'+str(i)
        lines += [f'm.component("comp1").material().create("{tag}","Common");',
                  f'm.component("comp1").material("{tag}").selection().set(regions[{i}]);']
        properties={'electricconductivity':number(mat['conductivity_s_m']),
                    'relpermeability':f'{number(mat["relative_permeability"])}-{number(mat.get("relative_permeability_loss",0))}*i',
                    'relpermittivity':'1'} if magnetic else {'thermalconductivity':number(mat['k_w_m_k']),'density':'1','heatcapacity':number(mat.get('heat_capacity_j_m3_k') or 1)}
        for prop,value in properties.items():
            lines.append(f'm.component("comp1").material("{tag}").propertyGroup("def").set("{prop}",{quoted(value)});')
    lines+=['}','static void buildPhysics(){']
    if magnetic:
        lines += ['m.component("comp1").physics().create("mf","InductionCurrents","geom1");',
                  'm.component("comp1").physics("mf").create("als","AmperesLawSolid",2);',
                  'm.component("comp1").physics("mf").feature("als").selection().all();']
        # Unconstrained passive domains already obey J=-j*omega*sigma*A in
        # Ampere's law. A zero imposed gradient needs no auxiliary coil DOF.
        # Keep all current constraints and the series topology explicitly.
        coils=[e for e in problem['excitations'] if e['kind']!='voltage_gradient_v_m' or any(e['value']) or e.get('connection')=='series']
        lines += [f'coils{i}();' for i in range(0,len(coils),40)]
        for i,e in enumerate(coils):
            if i%40==0:lines+=['}',f'static void coils{i}(){{']
            selected=[j for j,g in enumerate(problem['geometry']) if g['uid'] in e['regions']]
            tag='coil'+str(i)
            real=e['value'][0]*sqrt(2);imag=(e['value'][1] if len(e['value'])>1 else 0)*sqrt(2)
            value=f'({number(real)}+({number(imag)})*i)'
            current=e['kind']=='current_rms_a'
            lines += [f'int[] group{i}=join(new int[][]{{'+','.join(f'regions[{j}]' for j in selected)+'});',
                      f'm.component("comp1").physics("mf").create("{tag}","Coil",2);',
                      f'm.component("comp1").physics("mf").feature("{tag}").selection().set(group{i});',
                      f'm.component("comp1").physics("mf").feature("{tag}").set("ConductorModel","Single");',
                      f'm.component("comp1").physics("mf").feature("{tag}").set("CoilName","{i+1}");',
                      f'm.component("comp1").physics("mf").feature("{tag}").set("coilGroup","'+('1' if e.get('connection')=='series' else '0')+'");',
                      f'm.component("comp1").physics("mf").feature("{tag}").set("CoilExcitation","'+('Current' if current else 'Voltage')+'");',
                      f'm.component("comp1").physics("mf").feature("{tag}").set("'+('ICoil' if current else 'VCoil')+'",'+quoted(value+'[A]' if current else '-'+value+'[V]')+');']
    else:
        lines += ['m.component("comp1").physics().create("ht","HeatTransfer","geom1");',
                  'int nb=m.component("comp1").geom("geom1").getNBoundaries();',
                  'List<Integer> ext=new ArrayList<Integer>();for(int b=1;b<=nb;b++)if(m.component("comp1").geom("geom1").getAdj(1,2,b).length==1)ext.add(b);',
                  'int[] exterior=new int[ext.size()];for(int b=0;b<exterior.length;b++)exterior[b]=ext.get(b);']
        for i,e in enumerate(problem['excitations']):
            if len(e['regions'])!=1:raise ValueError('excitations.regions：稳态热桥接要求逐区域给定每米热源。')
            j=next(j for j,g in enumerate(problem['geometry']) if g['uid']==e['regions'][0])
            lines += [f'm.component("comp1").cpl().create("area{i}","Integration");',
                      f'm.component("comp1").cpl("area{i}").selection().set(regions[{j}]);',
                      f'm.component("comp1").physics("ht").create("heat{i}","HeatSource",2);',
                      f'm.component("comp1").physics("ht").feature("heat{i}").selection().set(regions[{j}]);',
                      f'm.component("comp1").physics("ht").feature("heat{i}").set("Q0","{number(e["value"][0])}[W/m]/area{i}(1)");']
        for i,b in enumerate(problem['boundaries']):
            if b['kind']=='insulated':continue
            if b['selector']!='outer' or b['kind']!='temperature':
                raise ValueError('boundaries：稳态热桥接当前支持外边界恒温；其他选择器尚未翻译。')
            lines += [f'm.component("comp1").physics("ht").create("temp{i}","TemperatureBoundary",1);',
                      f'm.component("comp1").physics("ht").feature("temp{i}").selection().set(exterior);',
                      f'm.component("comp1").physics("ht").feature("temp{i}").set("T0","{number(b["value"])}[K]");']
    lines+=['}','static void runMesh(){','m.component("comp1").mesh().create("mesh1");',
            'm.component("comp1").mesh("mesh1").feature("size").set("custom","on");',
            f'm.component("comp1").mesh("mesh1").feature("size").set("hmax",{number(mesh["far_size_m"])});',
            f'm.component("comp1").mesh("mesh1").feature("size").set("hmin",{number(mesh["size_m"]/5)});',
            f'm.component("comp1").mesh("mesh1").feature("size").set("hgrad",{number(1+min(.5,(mesh["far_size_m"]-mesh["size_m"])/mesh["transition_m"]))});']
    near=[i for i,g in enumerate(problem['geometry']) if i>0 and g['kind']=='disk'] or list(range(count))
    lines += ['int[] near=join(new int[][]{'+','.join(f'regions[{j}]' for j in near)+'});',
              'm.component("comp1").mesh("mesh1").create("nearSize","Size");',
              'm.component("comp1").mesh("mesh1").feature("nearSize").selection().geom("geom1",2);',
              'm.component("comp1").mesh("mesh1").feature("nearSize").selection().set(near);',
              'm.component("comp1").mesh("mesh1").feature("nearSize").set("custom","on");',
              f'm.component("comp1").mesh("mesh1").feature("nearSize").set("hmax",{number(mesh["size_m"])});',
              f'm.component("comp1").mesh("mesh1").feature("nearSize").set("hmin",{number(mesh["size_m"]/5)});']
    for i,_ in enumerate(problem['probes_m']):
        lines += [f'm.component("comp1").mesh("mesh1").create("probeSize{i}","Size");',
                  f'm.component("comp1").mesh("mesh1").feature("probeSize{i}").selection().geom("geom1",0);',
                  f'm.component("comp1").mesh("mesh1").feature("probeSize{i}").selection().named("geom1_probePoint{i}_pnt");',
                  f'm.component("comp1").mesh("mesh1").feature("probeSize{i}").set("custom","on");',
                  f'm.component("comp1").mesh("mesh1").feature("probeSize{i}").set("hmax",{number(min(.01,mesh["far_size_m"]/20))});']
    lines += ['m.component("comp1").mesh("mesh1").create("tri","FreeTri");',
              'm.component("comp1").mesh("mesh1").run();',
              f'if(m.component("comp1").mesh("mesh1").getNumVertex()>{mesh["max_nodes"]})throw new IllegalArgumentException("mesh.max_nodes exceeded");',
              'm.study().create("std1");',
              'm.study("std1").create("step","'+('Frequency' if magnetic else 'Stationary')+'");']
    if magnetic:lines.append(f'm.study("std1").feature("step").set("plist","{number(problem["frequency_hz"])}");')
    lines+=['m.study("std1").run();','}','static void report(){',
            'double[][] vertices=m.component("comp1").mesh("mesh1").getVertex();',
            'line("vertices",array(vertices));',
            'line("triangles",Arrays.deepToString(m.component("comp1").mesh("mesh1").getElem("tri")));',
            'line("domain_ids",Arrays.toString(m.component("comp1").mesh("mesh1").getElemEntity("tri")));']
    if magnetic:
        for i,g in enumerate(problem['geometry']):
            sigma=g['material']['conductivity_s_m']
            if sigma<=0:continue
            expr=['real(mf.Jz)/sqrt(2)','imag(mf.Jz)/sqrt(2)',f'0.5*abs(mf.Jz)^2/{number(sigma)}','mf.Qh','1']
            lines.append(f'line("integrals-{i}",array(integral(m,"int{i}",regions[{i}],{strings(expr)})));')
        field_expr=['real(Az)/sqrt(2)','imag(Az)/sqrt(2)']
        lines.append(f'line("field",Arrays.deepToString(sample(m,"field",vertices,{strings(field_expr)},null)));')
        for i,(x,z) in enumerate(problem['probes_m']):
            expr=['real(mf.Bx)/sqrt(2)','real(mf.By)/sqrt(2)','imag(mf.Bx)/sqrt(2)','imag(mf.By)/sqrt(2)']
            lines.append(f'line("probe-{i}",Arrays.deepToString(sample(m,"probe{i}",new double[][]{{{{{number(x)}}},{{{number(z)}}}}},{strings(expr)},null)));')
        for i,p in enumerate(problem.get('current_probes',[])):
            j=next(j for j,g in enumerate(problem['geometry']) if g['uid']==p['region']);x,z=p['point_m']
            expr=['real(mf.Jz)/sqrt(2)','imag(mf.Jz)/sqrt(2)']
            lines.append(f'line("current-probe-{i}",Arrays.deepToString(sample(m,"jp{i}",new double[][]{{{{{number(x)}}},{{{number(z)}}}}},{strings(expr)},regions[{j}])));')
    else:
        lines.append('line("field",Arrays.deepToString(sample(m,"field",vertices,new String[]{"T"},null)));')
    lines+=['}','}']
    return '\n'.join(lines)+'\n'
