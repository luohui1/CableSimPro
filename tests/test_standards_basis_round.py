"""Independent source anchors and an explicit comparison of live plugin constants."""
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'plugins/cablesim.standards-basis/src/cablesim_standards_basis'


def load(filename):
    spec=importlib.util.spec_from_file_location(filename.stem,filename)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def test_second_batch_independent_page_values_and_full_shapes():
    basis=load(DATA/'library.py').BasisLibrary().data
    records={r['id']:r for r in basis['records']}
    # Manual reads: GB PDF82/83/84/45 and IEC official PDF83/84/89.
    anchors={
        'gb50217-D-0-1/r1/c1':(1.22,72,82),
        'gb50217-D-0-1/r5/c8':(.92,72,82),
        'gb50217-D-0-3/r5/c1':(.75,73,83),
        'gb50217-D-0-4/r2/c6':(.81,73,83),
        'gb50217-D-0-6/r2/c4':(.45,74,84),
        'gb50217-D-0-7/r1/c1':(None,74,84),
        'gb50217-D-0-7/r2/c8':(.88,74,84),
        'gb50217-5-3-5/r9/p':(10,35,45),
        'gb50217-5-3-3/r1/f':(.3,35,45),
        'gb50217-5-3-3/r1/g':(.7,35,45),
        'gb50217-5-3-3/r1/a':(1,35,45),
        'iec60287-1-1-table1/r1/c1':(1.7241e-8,35,83),
        'iec60287-1-1-table1/r2/c1':(2.8264e-8,35,83),
        'iec60287-1-1-table1/r6/c2':('可忽略',35,83),
        'iec60287-1-1-table2/r5/c1':(.35,36,84),
        'iec60287-1-1-table2/r5/c2':(.20,36,84),
        'iec60287-2-1-table1/r18/c1':(5,33,89),
        'iec60287-2-1-table1/r28/c1':(2.5,33,89),
        'v35-表13/r4/c1':(20,17,22),
        'v35-表13/r9/c3':(1,17,22),
        'v35-表14/r3/c1':({'min':-40,'max':40},17,22),
        'v35-表15/r2/epr_hepr':(50,19,24),
        'v35-表18/r6/st7':(None,24,29),
        'lv-表16/r5/pvc':(.037,20,26),
        'mv-表17/r6/xlpe':(40,23,31),
    }
    for ident,(value,printed,pdf) in anchors.items():
        record=records[ident]
        assert (record['value'],record['printed_page'],record['pdf_page'])==(value,printed,pdf)
    counts={'gb50217-D-0-1':(5,8),'gb50217-D-0-3':(5,1),'gb50217-D-0-4':(3,6),
            'gb50217-D-0-5':(3,6),'gb50217-D-0-6':(2,4),'gb50217-D-0-7':(3,8),
            'gb50217-5-3-3':(1,3),'gb50217-5-3-5':(15,2),
            'iec60287-1-1-table1':(7,2),'iec60287-1-1-table2':(14,2),'iec60287-2-1-table1':(29,1),
            'v35-表13':(15,3),'v35-表14':(8,1),'v35-表15':(2,2),'v35-表17':(9,3),
            'v35-表18':(9,4),'v35-表19':(9,1),'v35-表20':(8,1),'v35-表21':(7,1),
            'lv-表16':(5,3),'mv-表17':(6,3)}
    for table in basis['tables']:
        if table['id'] in counts:
            row,col=counts[table['id']]
            assert (table['row_count'],table['column_count'],table['record_count'])==(row,col,row*col)


def test_every_published_condition_can_be_resolved_without_guessed_default():
    import pytest
    module=load(DATA/'library.py');library=module.BasisLibrary()
    for record in library.data['records']:
        conditions={}
        for key,predicate in record['conditions'].items():
            if not isinstance(predicate,dict):value=predicate
            elif 'eq' in predicate:value=predicate['eq']
            elif 'in' in predicate:value=predicate['in'][0]
            elif 'gt' in predicate:value=(predicate['gt']+predicate['lte'])/2 if 'lte' in predicate else predicate['gt']*1.01
            elif 'gte' in predicate:value=predicate['gte'] or 1e-9
            elif 'lte' in predicate:value=predicate['lte']
            elif 'lt' in predicate:value=predicate['lt']*.99
            else:raise AssertionError('未声明条件运算符 '+key)
            conditions[key]=value
        request={'schema_version':'cablesim.standards-query/1','standard':record['standard'],
                              'edition':record['edition'],'locator':record['table'] or record['clause'],
                              'quantity':record['quantity']['key'],'record_id':record['id'],'conditions':conditions}
        if record['verification']['status']=='blocked':
            with pytest.raises(module.BasisError) as caught: library.query(request)
            assert caught.value.code=='EVIDENCE_BLOCKED'
            continue
        answer=library.query(request)
        assert len(answer['records'])==1
        assert answer['records'][0]['value']==record['value']


def test_compare_live_iec_material_constants(record_testsuite_property):
    audit=load(ROOT/'plugins/cablesim.standards-basis/validation/constants.py').compare(ROOT)
    rows=audit['rows']
    record_testsuite_property('standards_constant_comparison',json.dumps(audit,ensure_ascii=False))
    copper=[r for r in rows if r.get('material_id')=='material/cu']
    assert len(copper)==2 and all(r['status']=='一致' for r in copper)
    assert next(r for r in rows if r.get('material_id')=='material/xlpe')['status']=='一致'
    pvc=next(r for r in rows if r.get('material_id')=='material/pvc')
    assert pvc['status']=='不一致' and pvc['value']==6 and pvc['basis_value']==5
    assert {r['field'] for r in rows if r['status']=='依据未覆盖'} >= {'ks','kp','thermal_resistivity'}
    assert all(len(r['source_sha256'])==64 for r in rows)


def test_compiled_shard_digest_and_footnote_branch(tmp_path):
    import shutil
    from hashlib import sha256
    import pytest
    module=load(DATA/'library.py')
    original=module.BasisLibrary()
    query={'schema_version':'cablesim.standards-query/1','standard':'GB/T 12706.3','edition':'2020',
           'locator':'表 13','quantity':'water_absorption_mass_gain',
           'record_id':'v35-表13/r9/c3','conditions':{'insulation':'XLPE','material_density_kg_m3':1100}}
    assert original.query(query)['status']=='not_covered'
    outside={'schema_version':'cablesim.standards-query/1','standard':'GB/T 12706.2','edition':'2020',
             'locator':'表 17','quantity':'tan_delta_max_5_to_10k_above_operating_temperature',
             'conditions':{'insulation':'XLPE','u0_v':64000,'u_v':110000}}
    assert original.query(outside)['status']=='not_covered'
    shutil.copytree(DATA,tmp_path/'data')
    target=tmp_path/'data'
    index=json.loads((target/'integrity.json').read_text('utf-8'))
    name='records-lv.json';raw=(target/name).read_bytes()+b' '
    (target/name).write_bytes(raw)
    index['files'][name]={'sha256':sha256(raw).hexdigest(),'size_bytes':len(raw)}
    (target/'integrity.json').write_text(json.dumps(index),encoding='utf-8')
    with pytest.raises(module.BasisError,match='摘要'):
        module.BasisLibrary(target)


def test_own_release_seals_survive_actual_autocrlf_checkout(tmp_path):
    import os
    import shutil
    import subprocess
    import sys
    source=tmp_path/'source';source.mkdir()
    for name in ('backend','cablesim_sdk','scripts','plugin-spec'):
        shutil.copytree(ROOT/name,source/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    package='plugins/cablesim.standards-basis'
    shutil.copytree(ROOT/package,source/package,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    shutil.copyfile(ROOT/'.gitattributes',source/'.gitattributes')
    registry=json.loads((ROOT/'plugins/registry.json').read_text('utf-8'))
    registry['plugins']=[p for p in registry['plugins'] if p['plugin_id']=='cablesim.standards-basis']
    (source/'plugins/registry.json').write_bytes((json.dumps(registry,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    def run(args,cwd=source):
        result=subprocess.run(args,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
        assert result.returncode==0,result.stdout+result.stderr
    for command in (['git','init','-q'],['git','config','core.autocrlf','true'],['git','config','core.safecrlf','false'],['git','add','--all']):run(command)
    checkout=tmp_path/'checkout';checkout.mkdir()
    run(['git','checkout-index','--all','--force','--prefix='+checkout.as_posix()+'/'])
    run([sys.executable,'scripts/plugin_sdk.py','verify'],checkout)
    run([sys.executable,'plugins/cablesim.standards-basis/src/cablesim_standards_basis/rebuild.py'],checkout)
    loaded=load(checkout/package/'src/cablesim_standards_basis/library.py').BasisLibrary()
    assert loaded.data_sha256==load(DATA/'library.py').BasisLibrary().data_sha256
    assert len(loaded.data['records'])==len(load(DATA/'library.py').BasisLibrary().data['records'])


def test_third_batch_manual_full_page_anchors_and_boundaries():
    module=load(DATA/'library.py');library=module.BasisLibrary()
    records={r['id']:r for r in library.data['records']}
    # Independent manual readings: GB12706.1 PDF23/24/37; GB12706.2 PDF28/32/39;
    # IEC PDF85/91/92/42. These include a range, tolerance, zero and differing branches.
    anchors={
        'gb50217-5-1-7/r1/value':(1000,29,39),
        'gb50217-5-5-2/r8/bracket_or_hanger':('h + 80',38,48),
        'lv-表14/r1/c1':({'min':.025,'max':.030},17,23),
        'lv-表14/r3/c3':({'value':200,'tolerance':3},18,24),
        'lv-表21/r2/c1':({'value':-15,'tolerance':2},31,37),
        'mv-表15/r9/c3':(1,20,28),
        'mv-表18/r5/test_voltage':(170,24,32),
        'mv-表22/r4/c2':({'value':90,'tolerance':2},31,39),
        'iec60287-1-1-table3/r17/relative_permittivity':(3,37,85),
        'iec60287-2-1-table3/r3/z':(.96,35,91),
        'iec60287-2-1-table5/r7/v':(0,36,92),
        'iec60287-3-1-annex-a4/r9/value':(1000,10,42),
    }
    for ident,(value,printed,pdf) in anchors.items():
        r=records[ident]
        assert (r['value'],r['printed_page'],r['pdf_page'])==(value,printed,pdf)
    assert len(records)==4406  # 64 verified GB/T 18890.2 numeric records, with exact scope.
    assert records['gb50217-5-5-2/r8/bracket_or_hanger']['value_details']['execution_status']=='not_implemented'
    for column in ('bracket_or_hanger','ladder_or_tray'):
        formula=records['gb50217-5-5-2/r8/'+column]
        assert formula['value_details']['variables']==[{'name':'h','description':'槽盒外壳高度','unit':'mm'}]
        assert 'h_definition' not in formula['conditions'] and 'formula_parameter' not in formula['conditions']
    counts={'lv-表14':(15,3),'lv-表15':(8,1),'mv-表15':(15,3),'mv-表16':(8,1),
            'lv-表13':(4,5),'mv-表13':(4,5),'mv-表18':(5,2),
            'iec60287-2-1-table3':(10,3),'iec60287-2-1-table5':(10,3)}
    for t in library.data['tables']:
        if t['id'] in counts:assert (t['row_count'],t['column_count'])==counts[t['id']]
    air={'schema_version':'cablesim.standards-query/1','standard':'IEC 60287-2-1','edition':'2023',
         'locator':'Table 3','quantity':'z','conditions':{'surface_colour':'black','laying_medium':'air',
         'solar_exposure':'protected','air_arrangement':'three_touching_trefoil',
         'support_type':'non_continuous_brackets','diameter_m':.15,'wall_clearance_ratio':.5}}
    assert library.query(air)['records'][0]['value']==.96
    air['conditions']['diameter_m']=.150001
    assert library.query(air)['status']=='not_covered'
    allowance={'schema_version':'cablesim.standards-query/1','standard':'GB 50217','edition':'2018',
               'locator':'5.1.18-2','quantity':'order_length_allowance_min',
               'conditions':{'voltage_v':35000,'route_length':'non_long_distance','remaining_segment':'unusable'}}
    assert library.query(allowance)['records'][0]['value']==.05
    allowance['conditions']['voltage_v']=10000
    assert library.query(allowance)['records'][0]['value']==.05
    allowance['conditions']['voltage_v']=35001
    assert library.query(allowance)['status']=='not_covered'
    for standard,clause in [('GB/T 12706.1','16.9.2'),('GB/T 12706.2','17.10.2'),('GB/T 12706.3','17.10')]:
        answer=library.query({'schema_version':'cablesim.standards-query/1','standard':standard,'edition':'2020',
                              'locator':clause,'quantity':'water_absorption_high_density_condition',
                              'conditions':{'insulation':'XLPE','material_density_kg_m3':1100}})
        assert answer['records'][0]['criterion']=='no_numeric_limit'
        assert isinstance(answer['records'][0]['value'],str)


def test_large_record_sets_split_without_losing_or_reordering_records():
    module=load(DATA/'rebuild.py')
    from copy import deepcopy
    import tempfile
    # A real growth boundary, independent of today's file lengths: enlarge one
    # reviewed material column while retaining its two routes, then rebuild.
    excerpts=json.loads((DATA/'excerpts.json').read_bytes())
    evidence=json.loads((DATA/'verification.json').read_bytes())
    table=next(t for t in excerpts['tables'] if t['id']=='iec-Table4')
    rows=deepcopy(table['rows']);cells=deepcopy(evidence['tables'][table['id']]['cells'])
    table['rows']=rows*4;evidence['tables'][table['id']]['cells']=cells*4
    with tempfile.TemporaryDirectory() as temporary:
        directory=Path(temporary)
        (directory/'excerpts.json').write_text(json.dumps(excerpts),encoding='utf-8')
        (directory/'verification.json').write_text(json.dumps(evidence),encoding='utf-8')
        files=module.expected_files(directory)
    names=[n for n in files if n.startswith('records-conductor-iec')]
    assert len(names)>1
    merged=[r for n in names for r in json.loads(files[n])]
    expected=[r for r in module.build(excerpts,evidence)['records'] if r['standard']=='IEC 60228']
    assert merged==expected
    assert all(len(files[n])<900_000 for n in names)
