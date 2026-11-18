"""Persisted workspace scope, shared by recipes, model tools and the broker."""
from fastapi import HTTPException

TYPE_TOOLS=frozenset({'draft_read','draft_update','draft_geometry','draft_propose','task_plan','platform_capabilities','platform_read','platform_prepare','type_read','propose_type_changes','object_find','object_relations',
    'workspace_list','cable_model_read','plugin_inspect','plugin_query','recipe_execute','inbox_read'})


def context(workspace_id,is_type):
    return {'kind':'type' if is_type else 'project','id':workspace_id,
        'default_proposal_kind':'type' if is_type else 'domain',
        'default_recipe':'type_review' if is_type else None}


def load_context(db,task):
    import json
    saved=db.execute("SELECT data FROM agent_events WHERE task_id=? AND type='session.context' ORDER BY sequence LIMIT 1",(task['id'],)).fetchone()
    if saved:return json.loads(saved[0])
    # Older sessions retain their original workspace identity; no migration or
    # mutable-current-state inference is necessary.
    row=db.execute("SELECT (json_type(state,'$.type_origin_reference')='object' OR json_type(state,'$.type_creation')='object') "
        "AND COALESCE(json_type(state,'$.study_cable_reference'),'null')='null' "
        "AND json_array_length(state,'$.domain.cable_types')=1 AS is_type "
        "FROM workspace_revisions WHERE workspace=? AND revision=?",(task['workspace_id'],task['workspace_revision'])).fetchone()
    return context(task['workspace_id'],bool(row and row['is_type']))


def is_type(record):return (record.get('context') or {}).get('kind')=='type'


def require_tool(task,name,*,external=False):
    from .external_actions import SCOPES
    external_tools=set(SCOPES)|{'workspace_read','study_list','study_read','run_list','run_read','propose_method_parameters'}
    if is_type(task) and name not in TYPE_TOOLS and not (external and name in external_tools):
        raise HTTPException(422,{'code':'TYPE_TOOL_NOT_APPLICABLE','path':'/tool',
            'message':'此会话绑定型号设计；请使用型号读取、型号字段方案或型号检查配方。研究操作须另建工程/研究会话。'})
