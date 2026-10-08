"""Compile model intents and host recipes into finite, audited serial nodes."""
from copy import deepcopy
from uuid import uuid4
from jsonschema import Draft202012Validator

from backend.kernel.workspace import fingerprint
from .recipes import expand


def compile_calls(calls,tools,workspace_id,workspace_revision):
    nodes=[];previous=None
    for call in calls:
        tool=tools.get(call['name'])
        if tool and call['name']=='recipe_execute' and not list(Draft202012Validator(tool.parameters).iter_errors(call['arguments'])):
            children=[]
            for index,(name,arguments,bindings) in enumerate(expand(call['arguments'])):
                child=compile_calls([{'id':call['id'],'name':name,'arguments':arguments}],tools,workspace_id,workspace_revision)['nodes'][0]
                child['input_identity'].update(recipe=call['arguments']['recipe'],recipe_version=1,recipe_step=index+1)
                child['depends_on']=[children[-1]['id']] if children else ([previous] if previous else [])
                child['bindings']={key:{'node_id':children[source]['id'],'path':path} for key,(source,path) in bindings.items()}
                children.append(child)
            nodes.extend(children);previous=children[-1]['id']
            continue
        node_id=str(uuid4())
        arguments=deepcopy(call['arguments'])
        identity={'workspace_id':workspace_id,'workspace_revision':workspace_revision}
        if tool and tool.method:identity['method']=deepcopy(tool.method)
        nodes.append({'id':node_id,'provider_call_id':call['id'],'tool':call['name'],'arguments':arguments,
            'arguments_digest':fingerprint(arguments),'input_identity':identity,'attempt':1,'state':'pending',
            'depends_on':[previous] if previous else []})
        previous=node_id
    return {'kind':'tool-plan','nodes':nodes,'engineering_approval':False}
