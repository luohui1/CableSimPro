"""The model's actual registry: narrow host actions plus sealed manifest capabilities."""
from copy import deepcopy
from dataclasses import dataclass, asdict
from hashlib import sha256
import json
from threading import RLock

from backend.kernel.input_contracts import contracts


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
    specs=[
        ('workspace_list','列出工程','read','读取工程身份与修订，供明确选择上下文。',object_schema()),
        ('workspace_read','读取工程输入','read','读取会话固定版本的工程事实、字段与单位；不修改输入。',object_schema({
            'paths':{'type':'array','maxItems':8,'items':{'type':'string'},'description':'可选稳定领域路径；省略返回有界工程概览。'}})),
        ('study_list','列出研究','read','读取本工程的研究名称、方法与状态。',object_schema()),
        ('study_read','读取研究定义与工况','read','读取已保存研究的参数、驱动与工况身份。',object_schema({**STUDY,
            'case_id':TEXT,'input_paths':{'type':'array','maxItems':8,'items':{'type':'string'},'description':'按稳定字段路径读取保存输入；批量工况须明确case_id。'}})),
        ('run_list','读取运行摘要','read','读取指定研究保存运行的有界摘要与关键结论。',object_schema({**STUDY,
            'after':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':10}})),
        ('run_read','读取运行结果要点','read','只读指定运行的量值、来源与分项证据；不读完整场数组。',object_schema({**STUDY,
            'run_id':TEXT,'case_id':TEXT,'entity':TEXT,'key':TEXT,'input_paths':{'type':'array','maxItems':8,'items':{'type':'string'},
                'description':'按固定快照工况读取原输入字段；使用时case_id必填。'}},['run_id'])),
        ('plugin_inspect','读取插件能力与输入契约','read','读取安装清单的准确方法身份、范围和参数schema。',object_schema({
            'plugin_id':TEXT,'capability':TEXT,'tool':TEXT,'schema_path':{'type':'string','maxLength':500,
                'description':'能力契约内的JSON Pointer，例如 /parameter_schema/properties/solver；用于按字段读取大契约。'}})),
        ('cable_model_read','读取型号结构','read','读取受摘要保护的型号结构与来源；不采用或批准型号。',object_schema({
            'model_id':TEXT,'path':{'type':'string','maxLength':500,'description':'型号返回对象内的稳定路径；省略读取有界完整对象。'}},['model_id'])),
        ('propose_domain_changes','提出领域输入修改方案','propose','生成有字段差异和校验结果的输入方案，等待人批准。',object_schema({
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


class ToolRegistry:
    def __init__(self,research):
        self.research=research
        self.lock=RLock()
        self.payload=None
        self.current=None

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

    def build(self):
        entries=contracts(self.research)
        registry=self.research.registry()
        values=host_tools()
        for entry in entries:
            method=entry['method'];cap=registry.get(method['plugin_id']).manifest.capability(method['capability'])
            name=(method['plugin_id']+'__'+cap.id).replace('.','_').replace('-','_')
            if len(name)>64:name=name[:55]+'_'+sha256(name.encode()).hexdigest()[:8]
            hpc=bool(hasattr(self.research.executor,'required') and self.research.executor.required(method['plugin_id'],cap.id))
            description=(cap.description or cap.title)+' 已选研究时只允许快速预览；未选研究时仅生成新建研究方案。'
            parameters=object_schema({**STUDY,'parameters':nested_schema(entry['parameter_schema']),'title':TEXT})
            values.append(Tool(name,cap.title,'run',description,parameters,method['plugin_id'],hpc,method,entry['preview']))
        if len({tool.name for tool in values})!=len(values):raise ValueError('duplicate tool names')
        return {tool.name:tool for tool in values}

    def visible(self,record):
        enabled={name for step in record['steps'] if step['tool']=='plugin_inspect' and step.get('result')
            and step['result']['status']=='ok' for name in step['result']['data'].get('enabled_tools',[])}
        return {name:tool for name,tool in self.tools().items() if not tool.plugin_id or name in enabled}

    def directory(self):
        return [[tool.name,tool.title] for tool in self.tools().values() if tool.plugin_id]
