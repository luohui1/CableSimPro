"""Explicit installed-release adoption through the normal saved-study path."""
from copy import deepcopy
from fastapi import HTTPException
from cablesim_sdk.parameter_units import translate
from backend.plugin_host.parameter_contracts import schemas
from .contracts import UpdateStudy,StudyDefinition


def _pointer(schema,pointer,value):
    definitions=schema.get('$defs',{})
    parts=pointer[1:].split('/')
    translated=[]
    node=schema
    changed=False
    inherited_runtime=None
    for encoded in parts:
        part=encoded.replace('~1','/').replace('~0','~')
        if '$ref' in node:node=definitions[node['$ref'][8:]]
        for branch in node.get('anyOf',[]):
            if '$ref' in branch:node=definitions[branch['$ref'][8:]];break
        props=node.get('properties',{})
        found=next(((key,prop) for key,prop in props.items() if key==part or (prop.get('x-runtime') or {}).get('key')==part),None)
        if found:
            public,node=found
            if node.get('x-runtime'):inherited_runtime=node['x-runtime']
            changed=changed or public!=part
            translated.append(public.replace('~','~0').replace('/','~1'))
        else:
            translated.append(encoded)
            node=node.get('items') or node.get('additionalProperties') or {}
            if not isinstance(node,dict):node={}
    runtime=node.get('x-runtime') or inherited_runtime or {}
    if changed and runtime:value=(value-runtime.get('offset',0))/runtime.get('scale',1)
    return '/'+ '/'.join(translated),value


def normalize_configuration(research,config):
    _,capability=research.resolve(config['method'])
    document=config.get('method_input') or {'schema_version':'cablesim.domain/1'}
    parameter_schema,input_schema=schemas(capability,document)
    config['parameters']=translate(parameter_schema,config['parameters'])
    if config.get('method_input') is not None and input_schema:
        config['method_input']=translate(input_schema,config['method_input'])
    driver=config.get('driver',{})
    for case in driver.get('cases',[]):
        case_schema,case_input_schema=schemas(capability,case['input'])
        case['parameters']=translate(case_schema,case['parameters'])
        if case_input_schema:case['input']=translate(case_input_schema,case['input'])
    for sample in driver.get('samples',[]):
        changes={}
        for pointer,value in sample['changes'].items():
            prefix='/parameters' if pointer.startswith('/parameters/') else '/input' if pointer.startswith('/input/') and input_schema else None
            if prefix:
                converted,value=_pointer(parameter_schema if prefix=='/parameters' else input_schema,pointer[len(prefix):],value)
                pointer=prefix+converted
            if pointer in changes:raise HTTPException(422,'SI升级后扫描路径重复，须先明确选择一个单位口径。')
            changes[pointer]=value
        sample['changes']=changes
    for item in [*config.get('crosschecks',[]),*config.get('candidate_completions',{}).values()]:
        _,cap=research.resolve(item['method'])
        schema,_=schemas(cap,document)
        item['parameters']=translate(schema,item['parameters'])


def adopt_configuration(research,config):
    from .version_status import methods
    for method in methods(config):
        plugin=research.registry(method['plugin_id']).get(method['plugin_id'])
        method.update(research.pin(plugin))
        research.resolve(method)
    normalize_configuration(research,config)


def upgrade(research,wid,sid,body):
    with research.store.db() as db:
        research.store.load(db,wid,body.expected_revision,allow_domain=True)
        current=research.definition(db,wid,sid,body.expected_study_revision)
    definition=StudyDefinition.model_validate(current['definition']).model_dump(mode='json')
    if body.module is not None:
        adopt_configuration(research,research.module_definition(definition,body.module))
    else:
        primary={key:value for key,value in definition.items() if key!='modules'}
        adopt_configuration(research,primary)
        definition.update(primary)
        for config in definition['modules'].values():adopt_configuration(research,config)
    if definition==current['definition']:return current
    update=UpdateStudy.model_validate({**definition,'expected_revision':body.expected_revision,'expected_study_revision':body.expected_study_revision})
    return research.save(wid,update,sid)
