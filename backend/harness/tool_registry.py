"""The model's actual registry: narrow host actions plus sealed manifest capabilities."""
from copy import deepcopy
from dataclasses import dataclass, asdict, replace
from hashlib import sha256
import json
from threading import RLock

from .recipes import recipe_schema,INBOX
from .session_scope import is_type,TYPE_TOOLS
from backend.index.contracts import Kind
from typing import get_args


def object_schema(properties=None,required=None):
    return {'type':'object','properties':properties or {},'required':required or [],'additionalProperties':False}


TEXT={'type':'string','minLength':1,'maxLength':120}
STUDY={'study_id':{'type':['string','null'],'description':'本工程内的已保存研究ID；省略时使用会话绑定研究。'},
       'module':{'type':['string','null'],'description':'已保存研究模块；省略为主配置。'}}
PATCH={'type':'array','minItems':1,'maxItems':12,'items':object_schema({
    'path':{'type':'string','minLength':1,'maxLength':500,'description':'明确字段路径；领域数组按稳定id/role/cable选择对象，不能猜下标。'},
    'value':{'type':['number','string','boolean','null'],'description':'候选新值。绝对温度用°C，长度用m，截面用mm²；不猜缺失物性。'},
    'unit':{'type':['string','null'],'description':'声明的界面单位；温度°C、长度m，其余依契约。'}},['path','value'])}


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    kind: str
    description: str
    parameters: dict
    plugin_id: str | None = None
    hpc: bool = False
    method: dict | None = None
    preview: bool = False

    def info(self):
        result={'name':self.name,'title':self.title,'kind':self.kind,'description':self.description,'hpc':self.hpc}
        if self.plugin_id:result['plugin_id']=self.plugin_id
        return result

    def model(self):
        schema=model_schema(self.parameters)
        prune_definitions(schema)
        return {'type':'function','function':{'name':self.name,'description':self.title+'：'+self.description,
                'parameters':schema}}

    def disclosed_model(self):
        definition=self.model()
        if not self.plugin_id:
            # Repeated per-field prose (including recipe alternatives) must not
            # crowd out an inspected capability. Full schemas remain available
            # through platform_capabilities and are used by broker validation.
            def compact(node):
                if isinstance(node,dict):return {key:compact(value) for key,value in node.items()
                    if key not in ('title','default','examples') and (key!='description' or not isinstance(value,str))}
                if isinstance(node,list):return [compact(value) for value in node]
                return node
            definition['function']['parameters']=compact(definition['function']['parameters'])
            if self.name=='recipe_execute':
                # The recipe-specific alternatives are inspected on demand;
                # don't replay every workflow's parameters in every request.
                definition['function']['parameters'].pop('oneOf',None)
            # Keep a complete purpose clause. Repeated authority/usage prose is
            # in the system prompt; the full descriptions remain in /tools.
            authority={'read':'只读','propose':'待人工批准的方案','run':'宿主许可执行'}[self.kind]
            definition['function']['description']=self.title+'（'+authority+'）'
            if self.name=='recipe_execute':
                definition['function']['description']+='；参数先按platform_capabilities(tool=recipe_execute)检查。'
        if self.plugin_id and len(json.dumps(definition,ensure_ascii=False).encode())>4096:
            definition['function']['parameters']=object_schema({**STUDY,'parameters':{
                'type':'object','description':'按 plugin_inspect 读取的封签参数契约提供SI值；可用 schema_path 分字段读取。'},'title':TEXT})
        return definition


def model_schema(schema):
    """Derive a compact schema; UI ordering/basis prose is available through plugin_inspect."""
    if isinstance(schema,list):return [model_schema(item) for item in schema]
    if not isinstance(schema,dict):return schema
    result={key:model_schema(value) for key,value in schema.items() if not key.startswith('x-')}
    if isinstance(schema.get('properties'),dict):
        omitted={name for name,field in schema['properties'].items() if field.get('readOnly') or (field.get('x-bind') or {}).get('read_only')}
        for name in omitted:result['properties'].pop(name,None)
        if 'required' in result:result['required']=[name for name in result['required'] if name not in omitted]
    unit=schema.get('x-unit')
    if unit and unit.get('si'):
        result['description']=(result.get('description') or '')+' 参数值采用SI单位 '+unit['si']+'。'
    by=schema.get('x-unit-by')
    if by:
        result['description']=(result.get('description') or '')+' SI单位由 '+by['selector']+' 决定：'+', '.join(
            kind+'='+(value.get('si') or '无物理单位') for kind,value in by['cases'].items())+'。'
    if (schema.get('x-bind') or {}).get('read_only'):
        result['description']=(result.get('description') or '')+' 只读宿主绑定，模型不能提供或修改。'
    return result


def prune_definitions(schema):
    def references(node):
        found=[]
        if isinstance(node,dict):
            if '$ref' in node:found.append(node['$ref'])
            for key,value in node.items():
                if key!='$defs':found.extend(references(value))
        elif isinstance(node,list):
            for value in node:found.extend(references(value))
        return found
    active=set();pending=references(schema)
    while pending:
        reference=pending.pop()
        if reference in active or not reference.startswith('#/'):continue
        active.add(reference);value=schema
        for token in reference[2:].split('/'):value=value[token.replace('~1','/').replace('~0','~')]
        pending.extend(references(value))
    def visit(node,path=''):
        if isinstance(node,dict):
            if '$defs' in node:
                node['$defs']={key:value for key,value in node['$defs'].items()
                    if any(reference== '#'+path+'/$defs/'+key or reference.startswith('#'+path+'/$defs/'+key+'/') for reference in active)}
            for key,value in node.items():visit(value,path+'/'+key.replace('~','~0').replace('/','~1'))
        elif isinstance(node,list):
            for index,value in enumerate(node):visit(value,path+'/'+str(index))
    visit(schema)


def host_tools():
    from backend.kernel.scenarios import LayoutPreview
    from backend.kernel.contracts import Method
    method_schema=Method.model_json_schema()
    specs=[
        ('draft_read','读取或比较输入草稿','read','input读取固定输入或准确draft_id；catalog分页找本会话草稿/分析配置，保留过期原因；changes比较指定草稿与保存基准或compare_to草稿，只比较输入，不推算工程影响。',object_schema({
            'draft_id':TEXT,'view':{'enum':['input','catalog','changes']},'compare_to':TEXT,
            'offset':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':20},
            'expected_catalog_revision':{'type':'integer','minimum':0},
            'paths':{'type':'array','maxItems':8,'items':{'type':'string','maxLength':500}}})),
        ('draft_update','编辑输入草稿','propose','只修改草稿，不保存。changes 为现有标量字段：型号长度mm、工程长度m。template 明确选择宿主模板和埋深/间距m，会重排截面并保留演示来源；不可暗中替用户采用模板假设。',object_schema({
            'draft_id':TEXT,'changes':PATCH,'template':object_schema({
                'kind':LayoutPreview.model_json_schema()['properties']['kind'],
                'depth':{'type':'number','exclusiveMinimum':0},'spacing':{'type':'number','exclusiveMinimum':0},
                'unit':{'const':'m'}},['kind','depth','spacing','unit'])})),
        ('draft_geometry','检查草稿几何','run','复用普通几何预览：只允许本机geometry/domain能力，parameters按plugin_inspect准确契约填写。实际生成同源工件，返回有界量值；不保存、不提交超算，显示工件没有分析网格资格。',object_schema({
            'draft_id':TEXT,'method':method_schema,'parameters':{'type':'object'}},['method','parameters'])),
        ('simulation_prepare','准备草稿分析研究','propose','按封签方法与参数核对草稿，生成仿真配置；不会预检、建网格或求解。与草稿绑定，输入变化须重建配置。预算待批准保存后从研究estimate读取，不猜数值。',object_schema({
            'draft_id':TEXT,'method':method_schema,'parameters':{'type':'object'},'title':TEXT},['method','parameters','title'])),
        ('draft_propose','提交草稿审核方案','propose','将同版本草稿及可选仿真配置转成完整审核差异。人批准后原子保存输入和新研究；不会运行、发布或提交超算。',object_schema({
            'draft_id':TEXT,'simulation_plan_id':TEXT,'title':TEXT},['title'])),
        ('platform_capabilities','发现平台能力或检查契约','read','来自实际注册API的能力目录；operation检查平台参数契约，tool检查已开放宿主工具，schema_path可按字段读取。目录不授予执行权限。',object_schema({
            'operation':TEXT,'tool':TEXT,'module':TEXT,'q':{'type':'string','maxLength':200},
            'schema_path':{'type':'string','maxLength':500},'offset':{'type':'integer','minimum':0},
            'limit':{'type':'integer','minimum':1,'maximum':20}})),
        ('platform_read','调用平台只读接口','read','先检查operation；按平台参数契约读取JSON，保持会话修订；view是返回对象内路径，offset/limit按整项分页。禁止写接口、任意URL、请求头和大工件。',object_schema({
            'operation':TEXT,'path_parameters':{'type':'object'},'query':{'type':'object'},
            'view':{'type':'string','maxLength':500},'offset':{'type':'integer','minimum':0},
            'limit':{'type':'integer','minimum':1,'maximum':20}},['operation'])),
        ('platform_prepare','准备平台人工执行请求','propose','先检查operation；只准备结构合规的参数和人工交接，不执行接口，不生成工程批准。文件上传、凭据、系统管理仍由人操作。',object_schema({
            'operation':TEXT,'path_parameters':{'type':'object'},'query':{'type':'object'},'body':{},
            },['operation'])),
        ('task_plan','记录任务目标','read','复杂任务可列出全部目标和每项目标所需的工具及参数；宿主根据本条消息实际成功回执计算完成状态。可修订计划，不执行工程操作、不批准。',object_schema({
            'goals':{'type':'array','minItems':1,'maxItems':8,'items':object_schema({
                'id':{'type':'string','minLength':1,'maxLength':60},
                'description':{'type':'string','minLength':1,'maxLength':300},
                'requires':{'type':'array','minItems':1,'maxItems':8,'items':object_schema({
                    'tool':TEXT,'arguments':{'type':'object'}},['tool','arguments'])}},['id','description','requires'])}},['goals'])),
        ('inbox_read','读取统一待办','read','跨工程只读首页同一待办索引：完整对象名片、类别、原因原文及人工下一步；不代办。默认10项、上限20项、6KiB，按next_page继续；不能把未展开条目称为已处理。',object_schema(deepcopy(INBOX))),
        ('type_read','读取型号设计','read','读取型号工作区的保存结构、要求、方案、最近运行及规格书；数值带单位来源，按next_page分页，缺保存运行不推算外径或标准符合性。',object_schema({
            'type_id':TEXT,'view':{'enum':['summary','structure','requirements','plans','runs','specification','review']},
            'after':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':20},
            'expected_revision':{'type':'integer','minimum':1}},['type_id'])),
        ('propose_type_changes','提出型号修改方案','propose','仅本会话型号工作区：使用type_read返回稳定字段path，长度值用mm；材料仅引用已导入文档的材料ID。等待人工保存，不发布、不批准。',object_schema({
            'type_id':TEXT,'changes':{'type':'array','minItems':1,'maxItems':12,'items':object_schema({
                'path':{'type':'string','minLength':1,'maxLength':500},'value':{'type':['number','string','boolean','null']},
                'unit':{'type':['string','null'],'maxLength':40}},['path','value'])},
            'reason':{'type':'string','minLength':1,'maxLength':500}},['type_id','changes','reason'])),
        ('object_find','查找对象','read','按统一索引查对象名片；validation保留保存偏差、状态、收敛和出处，限制说明按整条省略，total_limitations/omitted_limitations与detail_ref标明全文位置。declared仅为声明。next_offset 非空时继续分页。',object_schema({
            'kind':{'enum':list(get_args(Kind))},'q':{'type':'string','maxLength':200},
            'limit':{'type':'integer','minimum':1,'maximum':20},'offset':{'type':'integer','minimum':0}})),
        ('object_relations','查关联','read','读取名片的保存引用、版本与当前性；验证限制的省略条数与全文位置见target.validation；unresolved也会说明复现库错误，不猜关联。保持 kind/id 并按next_offset分页。',object_schema({
            'kind':{'enum':list(get_args(Kind))},'id':{'type':'string','minLength':1,'maxLength':200},
            'limit':{'type':'integer','minimum':1,'maximum':20},'offset':{'type':'integer','minimum':0}},['kind','id'])),
        ('workspace_list','列出工程','read','读取工程身份与修订，供明确选择上下文。',object_schema()),
        ('workspace_read','读取工程输入','read','读取会话固定版本的工程事实、字段与单位；不修改输入。',object_schema({
            'paths':{'type':'array','maxItems':8,'items':{'type':'string'},'description':'可选稳定领域路径；省略返回有界工程概览。'},
            'view':{'enum':['outline','locks']},'offset':{'type':'integer','minimum':0},
            'limit':{'type':'integer','minimum':1,'maximum':30}})),
        ('study_list','列出研究','read','读取本工程的研究名称、方法与状态。',object_schema()),
        ('project_digest','汇总工程研究结论','read','优先用于结论汇总：一次读取各研究最新保存运行的量值、单位、口径、限制对象和状态；按next_cursor分页。',object_schema({
            'after':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':20},'case_after':{'type':'integer','minimum':0}})),
        ('fem_comparison_read','读取有限元与 IEC 对照','read','读取已保存且完整性通过的对照工件或同输入、同 IEC 参数的两次运行；未收敛只给诊断，不给偏差结论。',object_schema({'run_id':TEXT,'iec_run_id':TEXT,'case_id':TEXT})),
        ('propose_fem_verification','提出新建有限元核验研究','propose','绑定原保存工况，只生成研究方案；边界、网格和来源必须明确。人工保存、预检与确认核时后才提交超算。',object_schema({
            'run_id':TEXT,'case_id':TEXT,'capability':{'enum':['iec-thermal-field','iec-fem-comparison']},
            'parameters':{'type':'object','description':'按 plugin_inspect 封签参数契约填写 SI 值；原 IEC 参数由宿主绑定，不猜求解边界。'},'title':TEXT},['run_id'])),
        ('recipe_execute','执行工程配方','run','选择宿主配方并填参数；宿主展开有限工具步骤，每一步照常核验权限、预算并审计。',recipe_schema()),
        ('study_baseline','读取试算对比原工况','read','绑定当前正常保存运行；过期、历史或部分成功返回原因、最近运行与人工重算动作，不继续方案试算。扫描/批量须明确case_id。',object_schema({**STUDY,'run_id':TEXT,'case_id':TEXT})),
        ('sensitivity_inputs','读取敏感性研究约束','read','读取当前方法参数与封签范围；只供研究建议，不猜敏感性或自动求解。',object_schema(STUDY)),
        ('study_read','读取研究定义与工况','read','读取已保存研究的参数、驱动与工况身份。',object_schema({**STUDY,
            'run_id':TEXT,'case_id':TEXT,'input_paths':{'type':'array','maxItems':8,'items':{'type':'string'},'description':'按稳定字段路径读取保存输入；批量工况须明确case_id。'}})),
        ('run_list','读取运行摘要','read','有study_id时读取研究保存运行；未选研究时直接返回工程最新结论摘要，无需重试。',object_schema({**STUDY,
            'after':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':10}})),
        ('run_read','读取运行结果要点','read','只读指定运行的量值、来源与分项证据；不读完整场数组。',object_schema({**STUDY,
            'run_id':TEXT,'case_id':TEXT,'entity':TEXT,'key':TEXT,'input_paths':{'type':'array','maxItems':8,'items':{'type':'string'},
                'description':'按固定快照工况读取原输入字段；使用时case_id必填。'}},['run_id'])),
        ('plugin_inspect','读取插件能力与输入契约','read','读取安装清单的准确方法身份、范围和参数schema。',object_schema({
            'plugin_id':TEXT,'capability':TEXT,'tool':TEXT,'schema_path':{'type':'string','maxLength':500,
                'description':'能力契约内的JSON Pointer，例如 /parameter_schema/properties/solver；用于按字段读取大契约。'}})),
        ('cable_model_read','读取型号结构','read','读取受摘要保护的型号结构与来源；不采用或批准型号。',object_schema({
            'model_id':TEXT,'path':{'type':'string','maxLength':500,'description':'型号返回对象内的稳定路径；省略读取有界完整对象。'}},['model_id'])),
        ('propose_domain_changes','提出领域输入修改方案','propose','按workspace_read的稳定路径与显示单位生成字段方案：长度m、温度°C、截面mm²；等待人工批准。',object_schema({
            'changes':PATCH,'title':TEXT},['changes'])),
        ('propose_method_parameters','提出方法参数修改方案','propose','按封签参数契约生成方案，等待人批准后普通保存。',object_schema({
            **STUDY,'changes':PATCH,'title':TEXT},['changes'])),
        ('study_preflight','预检研究','run','复用研究预检；需要原生或超算的能力不在本机替代执行。',object_schema(STUDY)),
        ('study_preview','快速预览试算','run','复用本机快速预览；可试算未批准方案，不保存输入、不创建Run、不批准结果。',object_schema({**STUDY,
            'proposal_id':TEXT,'run_id':TEXT,'case_id':TEXT})),
    ]
    return [Tool(*spec) for spec in specs]


def nested_schema(schema):
    """Keep the manifest's schema and rebase local references inside the tool envelope."""
    value=deepcopy(schema)
    def visit(node):
        if isinstance(node,dict):
            if isinstance(node.get('$ref'),str) and node['$ref'].startswith('#/'):
                node['$ref']='#/properties/parameters'+node['$ref'][1:]
            for child in node.values():visit(child)
        elif isinstance(node,list):
            for child in node:visit(child)
    visit(value)
    return value


def capability_name(plugin_id,capability):
    name=(plugin_id+'__'+capability).replace('.','_').replace('-','_')
    return name[:55]+'_'+sha256(name.encode()).hexdigest()[:8] if len(name)>64 else name


class ToolRegistry:
    def __init__(self,research):
        self.research=research
        self.lock=RLock()
        self.payload=None
        self.current=None
        self.hosts=host_tools()
        self.catalog_count=len(self.hosts)

    def initialize(self):
        # Load only manifest metadata before serving status, never full contracts.
        from backend.plugin_host import PluginHostError
        try:
            registry=self.research.registry()
            self.catalog_count=len(self.hosts)+sum(cap.input_contract is not None
                for plugin in registry.plugins.values() for cap in plugin.manifest.capabilities)
        except PluginHostError:
            # A broken plugin must not make model settings/status unavailable.
            # /tools and execution retain the existing explicit plugin diagnosis.
            self.catalog_count=len(self.hosts)

    def tools(self):
        # Reuse the host's existing source-notification cache; no new TTL cache.
        with self.lock:
            cache=self.research.read_responses
            key=('agent-tool-specs',)
            payload=cache.get(key,False)
            if payload is None:
                payload=cache.build(key,None,lambda: json.dumps([asdict(tool) for tool in self.build().values()],
                    ensure_ascii=False,allow_nan=False).encode(),False)
            if payload is not self.payload:
                self.current={row['name']:Tool(**row) for row in json.loads(payload)}
                self.payload=payload
            return self.current

    def info(self):
        """The UI directory does not need parameter schemas or model definitions."""
        cache=self.research.read_responses;key=('agent-tool-directory',)
        payload=cache.get(key,False)
        if payload is None:
            def load():
                rows=[tool.info() for tool in self.hosts]
                for plugin in self.research.registry().plugins.values():
                    for cap in plugin.manifest.capabilities:
                        if cap.input_contract is None:continue
                        rows.append({'name':capability_name(plugin.manifest.id,cap.id),'title':cap.title,'kind':'run',
                            'description':(cap.description or cap.title)+' 已选研究时只允许快速预览；未选研究时仅生成新建研究方案。',
                            'plugin_id':plugin.manifest.id,
                            'hpc':bool(hasattr(self.research.executor,'required') and self.research.executor.required(plugin.manifest.id,cap.id))})
                self.catalog_count=len(rows)
                return json.dumps(rows,ensure_ascii=False,allow_nan=False).encode()
            payload=cache.build(key,None,load,False)
        return json.loads(payload)

    def build(self):
        # Discovery uses validated installed manifests only. Full input-contract
        # construction and release verification remain at inspection/execution.
        registry=self.research.registry()
        values=deepcopy(self.hosts)
        for plugin in registry.plugins.values():
            pinned=self.research.pin(plugin)
            for cap in plugin.manifest.capabilities:
                if cap.input_contract is None:continue
                method={**pinned,'capability':cap.id}
                name=capability_name(method['plugin_id'],cap.id)
                hpc=bool(hasattr(self.research.executor,'required') and self.research.executor.required(method['plugin_id'],cap.id))
                description=(cap.description or cap.title)+' 已选研究时只允许快速预览；未选研究时仅生成新建研究方案。'
                parameters=object_schema({**STUDY,'parameters':nested_schema(cap.parameter_schema.model_dump(mode='json',by_alias=True,exclude_none=False)),'title':TEXT})
                values.append(Tool(name,cap.title,'run',description,parameters,method['plugin_id'],hpc,method,cap.preview))
        if len({tool.name for tool in values})!=len(values):raise ValueError('duplicate tool names')
        self.catalog_count=len(values)
        return {tool.name:tool for tool in values}

    def count(self):
        # No disk scan, schema generation or contract-read lock on /status.
        return self.catalog_count

    def visible(self,record):
        if is_type(record):
            # Each tool owns its schema: shared TEXT objects in the catalog
            # must not carry the proposal's bound-ID const into read tools.
            visible={tool.name:deepcopy(tool) for tool in self.hosts if tool.name in TYPE_TOOLS}
            visible['recipe_execute']=replace(visible['recipe_execute'],parameters=recipe_schema(record['context']))
            for name in ('type_read','propose_type_changes'):
                visible[name].parameters['properties']['type_id'].update(default=record['workspace_id'])
                visible[name].parameters['required'].remove('type_id')
            visible['propose_type_changes'].parameters['properties']['type_id']['const']=record['workspace_id']
            return visible
        enabled={name for step in record['steps'] if step['tool']=='plugin_inspect' and step.get('result')
            and step['result']['status']=='ok' for name in step['result']['data'].get('enabled_tools',[])}
        return {name:tool for name,tool in self.tools().items() if not tool.plugin_id or name in enabled}

    def directory(self,record=None):
        if record and is_type(record):return []
        return [[tool.name,tool.title] for tool in self.tools().values() if tool.plugin_id]
