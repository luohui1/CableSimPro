"""Human scope declarations over real saved method evidence, never fake receipts."""
from uuid import uuid4
from backend.kernel.type_versions import can_exclude


def declare_actual_scope(client, design):
    wid=design['id'];spec=client.get(f'/api/types/{wid}/specification').json()
    checks=[c for c in spec['payload']['checks'] if c['blocking']]
    assert checks and all(can_exclude(c) for c in checks),[(c['id'],c['message']) for c in checks]
    def reason(c):
        if c['id']=='geometry/mass':return '本教学发布只交付尺寸与电气校核，不包含重量报价；缺少配方密度及制造证据，须另行核定。'
        if c['channel']=='standards':return '本教学发布不包含此项出厂合格证明或固定截面判定；缺少制造证据，独立短路容量只在计算章节声明。'
        return '本次教学型号发布不包含此项线路条件结果；实际接地、敷设及回流网络须在工程研究中另行校核。'
    body={'expected_revision':design['revision'],'request_id':str(uuid4()),'specification_digest':spec['digest'],
          'human_confirmed':True,'exclusions':[{'check_id':c['id'],'reason':reason(c)} for c in reversed(checks)]}
    # Agent/no human identity cannot create the declarations. The same evidence
    # must still be blocked; no bypass of method admission or approval thresholds.
    denied=client.post(f'/api/types/{wid}/release-scope',json=body,headers={'X-CableSim-Actor':'agent'})
    assert denied.status_code==403,denied.text
    available=next((c for c in spec['payload']['checks'] if c.get('result',{}).get('status')=='available'),None)
    if available:
        rejected=client.post(f'/api/types/{wid}/release-scope',json={**body,'request_id':str(uuid4()),
            'exclusions':[{'check_id':available['id'],'reason':'不能用人工声明掩盖已计算结果'}]},headers={'X-CableSim-Actor':'human'})
        assert rejected.status_code==422,rejected.text
    response=client.post(f'/api/types/{wid}/release-scope',json=body,headers={'X-CableSim-Actor':'human'})
    assert response.status_code==200,response.text
    assert client.post(f'/api/types/{wid}/release-scope',json=body,headers={'X-CableSim-Actor':'human'}).json()==response.json()
    after=client.get(f'/api/types/{wid}/specification').json()
    assert after['ready'] and after['digest']!=spec['digest']
    assert len(after['payload']['release_exclusions'])==len(checks)
    assert all(c['excluded'] and not c['blocking'] for c in after['payload']['checks'] if c['id'] in {x['id'] for x in checks})
    for audience in ('customer','internal'):
        rendered=client.get(f'/api/types/{wid}/specification',params={'audience':audience}).json()
        assert '本次发布不含项' in rendered['html']
        assert all(x['reason'] in rendered['html'] for x in body['exclusions'])
    return after


def real_teaching_parameters(client,workspace):
    """Engineer explicitly chooses controlled references, not guessed defaults."""
    from copy import deepcopy
    import json
    from math import hypot,sqrt,pi
    from frontend.scripts.engineering_resources import definitions
    from backend.domain.guards import pointer
    source={'kind':'demo','reviewed':False,'reference':'教学工程输入；用于实走发布，不是厂家数据或现场系统条件。'}
    d=deepcopy(workspace['domain']);c=d['cable_types'][0];wid=workspace['id']
    # The engineer explicitly declares bare copper, rather than treating an
    # unspecified copper coating as a unique IEC/GB resistance-table branch.
    conductor_material=next(m for m in d['materials'] if m['id']==c['cores'][0]['conductor']['material'])
    conductor_material['standard_kind']='copper_bare'
    d['provenance'][pointer('materials',conductor_material['id'],'standard_kind')]={**source,'reference':'教学制造选择：裸铜第 2 类紧压圆形导体；并非从铜名称猜测镀层。'}
    chosen={'material/conductor':'copper-conductor','material/screen':'copper-conductor','material/insulation':'xlpe-mv','material/pvc':'pvc-reference','material/semi':'semiconductor-pe','material/armour':'steel-armour'}
    references={r.asset_id:r.model_dump(mode='json') for r in definitions()}
    for i,m in enumerate(d['materials']):
        resource=references.get('material/'+chosen.get(m['id'],''))
        if not resource:continue
        for entry in resource['sources']:
            try:r=json.loads(entry['reference'])
            except ValueError:continue
            prop=r.get('property')
            if prop not in ('thermal_resistivity','temperature_coefficient_20','relative_permittivity','loss_tangent','electrical_resistivity_20'):continue
            if prop=='thermal_resistivity' and m['id']=='material/pvc':continue # select the ≤35 kV covering branch below
            m[prop]=r['value'];d['provenance'][f'/materials/{i}/{prop}']={**entry,'reviewed':False}
        if m['id']=='material/pvc':
            r=next(json.loads(s['reference']) for s in resource['sources'] if 'thermal_resistivity_covering_le35kv' in s['reference'])
            m['thermal_resistivity']=r['value'];d['provenance'][f'/materials/{i}/thermal_resistivity']={**source,'reference':json.dumps(r,ensure_ascii=False)}
    # Retain the released 3×300 teaching specimen's explicit steel permeability;
    # it is an engineering model input, never a new standard/factory value.
    from backend.kernel.scenarios import system_models
    donor=next(m for m in system_models() if m['id']=='system.specification-yjv22-300')['payload']
    steel=next(m for m in donor['materials'] if m['standard_kind'] in ('steel','steel_galvanized'))
    next(m for m in d['materials'] if m['id']=='material/armour')['relative_permeability']=steel['relative_permeability']
    d['provenance']['/materials/5/relative_permeability']={**source,'reference':'既有 3×300 教学样本的明示钢带磁导率；本次工程师选择，非标准定值。'}
    for core in c['cores']:
        core['conductor'].update(conductor_class=2,form='stranded_round_compacted')
        next(l for l in core['layers'] if l['role']=='metallic_screen')['longitudinal_r20']=.004
        d['provenance'][pointer('cable_types',c['id'],'cores',core['id'],'layers','metallic_screen','longitudinal_r20')]={**source,'reference':'工程师明确输入：每米成品铜带纵向电阻 0.004 Ω；需厂家试验核定，教学发布保留此身份。'}
    c['core_lay_length']=2.
    if c['common_layers'][0]['role'] not in ('filler','binder'):
        c['common_layers'].insert(0,{'role':'binder','material':'material/pvc','thickness':.0001})
        d['provenance'][pointer('cable_types',c['id'],'common_layers','binder')]={**source,'reference':'工程师明示教学构造：0.1 mm PVC 包带、同配方 PVC 填充介质；不是标准标称值或厂家实际工艺。'}
    c['rating']['max_conductor_temperature']['normal']=363.15
    d['provenance'][pointer('cable_types',c['id'],'rating','max_conductor_temperature','normal')]={**source,'reference':'工程师明示 90 °C 教学稳态限温，非厂家出厂批准值；实际额定限温须按产品证明核定。'}
    d['provenance'][pointer('cable_types',c['id'],'core_lay_length')]={**source,'reference':'教学制造条件：成缆节距 2 m，非标准值。'}
    d['provenance'][pointer('cable_types',c['id'])]={**source,'reference':'完整护层由已保存标准提案生成；工程师逐项明示裸铜类别、2 m 成缆节距、铜带纵向电阻、钢带构造及材料物性，均为教学设计条件，非厂家试验。'}
    saved=client.put('/api/types/'+wid+'/document',json={'request_id':str(uuid4()),'expected_revision':workspace['revision'],'document':d})
    assert saved.status_code==200,saved.text
    w=saved.json()
    from backend.kernel.requirements import lookup_references
    records,absent=lookup_references(client.app.state.research,{'conductor':{'schema_version':'cablesim.standards-query/1','standard':'GB/T 3956','edition':'2008','locator':'表 2','quantity':'resistance_20_max','conditions':{'area_m2':c['cores'][0]['conductor']['nominal_area'],'conductor_class':2,'conductor_material':'copper','coating':'plain'}}})
    assert not absent,absent
    declaration=json.loads(d['provenance']['/execution_standards']['reference'])
    declaration['items']=[item for item in declaration['items'] if item['standard']!='GB/T 3956—2008']+[{'standard':'GB/T 3956—2008','source_digest':records['conductor']['source_sha256']}]
    declaration['reviewer']='真实使用工程师；明确选择执行版本'
    d['provenance']['/execution_standards']['reference']=json.dumps(declaration,ensure_ascii=False)
    saved=client.put('/api/types/'+wid+'/document',json={'request_id':str(uuid4()),'expected_revision':w['revision'],'document':d})
    assert saved.status_code==200,saved.text
    w=saved.json();basis=client.post('/api/design/type-workspaces/'+wid+'/requirements/basis',json={'request_id':str(uuid4()),'expected_revision':w['revision']})
    assert basis.status_code==200,basis.text
    refs=basis.json()['parameters']['basis_references']
    r20=next(r for r in refs.values() if isinstance(r,dict) and r.get('record',{}).get('quantity',{}).get('key')=='resistance_20_max')
    assert r20['record']['quantity']['unit'] in ('ohm/km','Ω/km')
    for core in d['cable_types'][0]['cores']:
        core['conductor'].update(r20=r20['record']['value']/1000,r20_basis='design')
        d['provenance'][pointer('cable_types',c['id'],'cores',core['id'],'conductor','r20')]={**source,'reference':json.dumps({'schema':'cablesim.design-resistance/1','reference':'以标准上限作明示设计电阻，非实测值','basis_reference':r20},ensure_ascii=False)}
    saved=client.put('/api/types/'+wid+'/document',json={'request_id':str(uuid4()),'expected_revision':w['revision'],'document':d})
    assert saved.status_code==200,saved.text
    w=saved.json()
    bindings=client.get('/api/types/'+wid+'/resources').json()
    items=[{'target_id':t['id'],'resource_id':t['binding']['resource_id']} for t in bindings['targets'] if t['role']=='material' and t['state']=='outdated' and t['binding']]
    if items:
        preview=client.post('/api/types/'+wid+'/resources/material-preview',json={'expected_revision':w['revision'],'items':items})
        assert preview.status_code==200,preview.text
        shown=preview.json()
        # Read every before/after field and both sources before confirming the
        # same fixed version against the new explicit teaching material facts.
        assert len(shown['rows'])==len(items) and all(isinstance(r['differences'],list) for r in shown['rows'])
        for r in shown['rows']:
            assert all({'before','after','before_source','after_source'}<=set(diff) for diff in r['differences'])
        confirmed=client.post('/api/types/'+wid+'/resources/material-confirm',json={'request_id':str(uuid4()),'expected_revision':w['revision'],'items':items,'preview_digest':shown['digest'],'reviewed_targets':[r['id'] for r in shown['rows']],'human_confirmed':True},headers={'X-CableSim-Actor':'human'})
        assert confirmed.status_code==200,confirmed.text
        w=client.get('/api/workspaces/'+wid).json()
    spacing=hypot(c['cores'][0]['x']-c['cores'][1]['x'],c['cores'][0]['z']-c['cores'][1]['z'])
    electrical={'temperature_k':363.15,'frequency_hz':50,'ks':1.,'kp':1.,'spacing_m':spacing,'phase_voltage_v':8700.,'r20_length_basis':'finished_cable','arrangement':'trefoil','core_lay_factor':sqrt(1+(pi*1.29*spacing/2)**2),'bonding_model':'both_ends','return_path':'metallic_only'}
    short={'duration_s':1.,'initial_temperature_k':363.15,'final_temperature_k':523.15,'metal_initial_temperature_k':343.15,'metal_final_temperature_k':433.15,'metal_capacity_basis':'adiabatic','screen_fault_current_a':600.,'bonding_model':'both_ends','return_path':'metallic_only',
        'parallel_components':[{'row_id':core['id']+':metallic_screen-adiabatic','resistance_ohm':.004,'initial_temperature_k':343.15,'final_temperature_k':433.15,'source':source['reference']} for core in c['cores']]+[{'row_id':'common:armour-adiabatic','resistance_ohm':.005,'initial_temperature_k':343.15,'final_temperature_k':433.15,'source':'教学同一 1 m 电气段：钢带电阻 0.005 Ω，温限由工程师明示。'}]}
    for p in (electrical,short):p['sources']={key:source['reference'] for key in p}
    return w,electrical,short


def run_release_modules(client,w,electrical,short):
    """Five real saved capabilities over the same teaching revision."""
    from time import sleep,monotonic
    from test_type_rating import PARAMETERS
    wid=w['id'];methods=client.get('/api/methods').json();saved=[]
    def run(plugin,capability,parameters,title,definition=None):
        pin=next(m['method'] for m in methods if m['method']['plugin_id']==plugin)
        response=client.post('/api/workspaces/'+wid+'/studies',json={'expected_revision':w['revision'],
            **(definition or {'title':title,'input_source':'domain','method':{**pin,'capability':capability},'parameters':parameters,
                'input_sources':{'/parameters':{'kind':'demo','reviewed':False,'reference':'教学工程师填写；非厂家及现场数据。'}}})})
        assert response.status_code==201,response.text
        study=response.json();root='/api/workspaces/'+wid+'/studies/'+study['id']
        pre=client.get(root+'/preflight',params={'expected_revision':w['revision'],'expected_study_revision':study['revision']})
        assert pre.status_code==200 and pre.json()['ready'],pre.text
        response=client.post(root+'/runs',json={'request_id':str(uuid4()),'expected_revision':w['revision'],
            'expected_study_revision':study['revision'],'scope_acknowledged':True,'lock_digest':pre.json()['lock_digest']})
        assert response.status_code==200,response.text
        result=response.json();deadline=monotonic()+180
        while result['status'] in ('accepted','running','validating') and monotonic()<deadline:
            sleep(.1);result=client.get(root+'/runs/'+result['id'],params={'view':'full'}).json()
        assert result['status']=='succeeded' and result['integrity']=='verified',result
        saved.append(result);return result
    cid=w['domain']['cable_types'][0]['id']
    run('cablesim.cable-geometry','concentric-model',{'cable_type_id':cid},'当前结构')
    run('cablesim.type-electrical','electrical',{'cable_type_id':cid,**electrical},'当前电气')
    basis=client.post('/api/types/'+wid+'/short-circuit-basis',json={'request_id':str(uuid4()),'expected_revision':w['revision'],'parameters':{'cable_type_id':cid,**short}})
    assert basis.status_code==200 and not basis.json()['missing'],basis.text
    run('cablesim.type-electrical','short-circuit',basis.json()['parameters'],'当前短路')
    basis=client.post('/api/design/type-workspaces/'+wid+'/requirements/basis',json={'request_id':str(uuid4()),'expected_revision':w['revision']})
    assert basis.status_code==200,basis.text
    standard=run('cablesim.standard-check','dimensions',{'cable_type_id':cid,**basis.json()['parameters']},'当前标准核对')
    ledger=client.get('/api/design/type-workspaces/'+wid+'/requirements',params={'run_id':standard['id']}).json()
    chosen=[item['row_id'] for item in ledger['items'] if item['bindable']]
    assert chosen
    reviewed=client.post('/api/design/type-workspaces/'+wid+'/requirements/reviews',json={
        'request_id':str(uuid4()),'run_id':standard['id'],'row_ids':chosen,
        'expected_workspace_revision':w['revision'],'expected_requirements_revision':ledger['revision'],
        'reviewer':'真实使用工程师','human_confirmed':True})
    assert reviewed.status_code==201,reviewed.text
    definition=client.post('/api/design/workspaces/'+wid+'/rating-table-definition',json={
        'expected_revision':w['revision'],'rows':[{'case_id':'buried','name':'直埋单回教学工况','layout':'three_core_buried_single','depth_m':.8,'ambient_temperature_c':20,'soil_rho_k_m_w':1.,'bonding':'both_ends','source':'教学现场条件，非实测土壤或负荷'}],
        'parameters':{**PARAMETERS,'source':'教学工况明示方法选择；未替代现场核验'}})
    assert definition.status_code==200,definition.text
    run('cablesim.iec60287','steady-rating',{},'当前载流量',definition.json())
    return saved
