"""Small SQL projections. Deliberately excludes originals, outputs and chat/tool bodies."""
import json


def decoded(value,default=None):
    return json.loads(value) if value is not None else default


def project(db):
    tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    def rows(table,columns,tail=''):
        return [dict(row) for row in db.execute(f'SELECT {columns} FROM {table} {tail}')] if table in tables else []
    reference=lambda path:("json_object('id',json_extract(state,'"+path+".id'),'name',json_extract(state,'"+path+".name'),"
        "'version',json_extract(state,'"+path+".version'),'content_sha256',json_extract(state,'"+path+".content_sha256'))")
    workspaces=rows('workspaces',"id,revision,created,updated,COALESCE(json_extract(state,'$.domain.name'),json_extract(state,'$.scenario.name')) AS name,"
        "json_array_length(state,'$.domain.cable_types') AS cable_count,json_type(state,'$.study_cable_reference') AS study_reference_type,"
        +reference('$.study_cable_reference')+' AS cable_reference,'+reference('$.type_origin_reference')+' AS origin_reference,'
        "json_extract(state,'$.type_resource_bindings') AS resource_bindings,"
        "json_extract(state,'$.type_creation') AS type_creation,"
        "json_extract(state,'$.domain.materials') AS material_facts,"
        "json_extract(state,'$.domain.cable_types') AS type_structure")
    studies=rows('studies','s.id,s.workspace,s.revision,v.created,v.definition',
        's JOIN study_versions v ON v.study=s.id AND v.revision=s.revision')
    snapshot=("json_object('workspace_id',json_extract(snapshot,'$.workspace_id'),"
        "'workspace_revision',json_extract(snapshot,'$.workspace_revision'),'study_revision',json_extract(snapshot,'$.study_revision'),"
        "'module',json_extract(snapshot,'$.module'),'definition',json(json_extract(snapshot,'$.definition')),"
        "'lock',json(json_extract(snapshot,'$.lock')),'workspace_state',json_object(")
    for index,key in enumerate(('study_cable_reference','type_origin_reference')):
        if index:snapshot+=','
        path='$.workspace_state.'+key
        snapshot+=f"'{key}',json_object('id',json_extract(snapshot,'{path}.id'),'name',json_extract(snapshot,'{path}.name'),'version',json_extract(snapshot,'{path}.version'),'content_sha256',json_extract(snapshot,'{path}.content_sha256'))"
    snapshot+='))'
    runs=rows('study_runs','id,workspace,study,sequence,status,created,finished,input_digest,output_digest,'+snapshot+
        " AS meta,substr(json_extract(error,'$.message'),1,512) AS error",'ORDER BY sequence DESC')
    return {'workspaces':workspaces,'studies':studies,'runs':runs,
        'assets':rows('engineering_assets',"id,asset_id,version,kind,name,status,revision,content_sha256,created,updated,"
            "json_extract(release_json,'$.dependencies') AS dependencies,json_extract(release_json,'$.sources') AS sources"),
        'models':rows('domain_cable_models',"id,state,digest,created,json_extract(payload,'$.name') AS name,"
            "json_extract(payload,'$.version') AS version,json_extract(payload,'$.specification.missing') AS missing,json_extract(payload,'$.sources') AS sources"),
        'documents':rows('source_documents','id,name,sha256,created'),
        'extractions':rows('document_extractions',"id,document,status,revision,created,substr(json_extract(error,'$.message'),1,512) AS error"),
        'document_proposals':rows('document_proposals',"id,document,status,new_model,digest,json_extract(payload,'$.draft.name') AS name,"
            "json_extract(payload,'$.draft.version') AS version,json_extract(approval,'$.approved_at') AS updated"),
        'type_plans':rows('type_plans','workspace,family,name,status,created,base_reference'),
        'submissions':rows('type_submissions',"id,workspace,status,created,digest,asset,json_extract(payload,'$.name') AS name,"
            "json_extract(payload,'$.revision') AS revision,json_extract(payload,'$.sources') AS sources"),
        'releases':rows('engineering_type_releases',"asset,family,workspace,submission,sequence,digest,"
            "json_extract(payload,'$.revision') AS revision,json_extract(payload,'$.source_design') AS source_design",'ORDER BY sequence'),
        'deliveries':rows('deliveries','id,workspace,sources,renderer,digest,created'),
        'tasks':rows('agent_tasks',"id,workspace_id,workspace_revision,study_id,state,waiting_reason,created,updated," 
            "(SELECT substr(json_extract(e.data,'$.content'),1,80) FROM agent_events e WHERE e.task_id=agent_tasks.id "
            "AND e.type='chat.message' AND json_extract(e.data,'$.role')='user' ORDER BY e.sequence LIMIT 1) AS name"),
        'agent_proposals':rows('agent_plan_revisions',"proposal_id AS id,task_id,created,digest,"
            "json_extract(body,'$.proposal.type_id') AS type_id,"
            "json_extract(body,'$.proposal.public.title') AS name,json_extract(body,'$.proposal.expires') AS expires,"
            "json_extract(body,'$.proposal.workspace_revision') AS revision,json_extract(body,'$.proposal.study_id') AS study_id,"
            "(SELECT json_extract(e.data,'$.status') FROM agent_events e WHERE e.task_id=agent_plan_revisions.task_id "
            "AND e.type='proposal.decision' AND json_extract(e.data,'$.id')=proposal_id ORDER BY e.sequence DESC LIMIT 1) AS decision",
            'WHERE proposal_id IS NOT NULL'),
        'convergence':rows('hpc_convergence',"id,json_extract(state,'$.workspace') AS workspace,json_extract(state,'$.study') AS study,"
            "json_extract(state,'$.title') AS name,json_extract(state,'$.status') AS status,json_extract(state,'$.created') AS created"),
        'datasets':rows('dataset_runs','id,workspace,study,status,created,updated')}
