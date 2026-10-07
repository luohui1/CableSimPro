"""Compile one model intent batch into finite serial nodes; no domain recipes yet."""
from copy import deepcopy
from uuid import uuid4

from backend.kernel.workspace import fingerprint


def compile_calls(calls,tools,workspace_id,workspace_revision):
    nodes=[];previous=None
    for call in calls:
        node_id=str(uuid4())
        tool=tools.get(call['name'])
        arguments=deepcopy(call['arguments'])
        identity={'workspace_id':workspace_id,'workspace_revision':workspace_revision}
        if tool and tool.method:identity['method']=deepcopy(tool.method)
        nodes.append({'id':node_id,'provider_call_id':call['id'],'tool':call['name'],'arguments':arguments,
            'arguments_digest':fingerprint(arguments),'input_identity':identity,'attempt':1,'state':'pending',
            'depends_on':[previous] if previous else []})
        previous=node_id
    return {'kind':'tool-plan','nodes':nodes,'engineering_approval':False}
