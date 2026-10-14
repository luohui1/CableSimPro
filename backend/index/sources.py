"""Small SQL projections. Deliberately excludes originals, outputs and chat/tool bodies."""
import json
import sqlite3
from time import perf_counter


def decoded(value,default=None):
    return json.loads(value) if value is not None else default


class Projection(dict):
    """Verified metadata rows and their immutable/versioned source identities."""
    def __init__(self):
        super().__init__();self.identities={};self.changed={}


IDENTITIES={
    'workspaces':('id','id,revision,created,updated'),
    'studies':('id','id,workspace,revision'),
    # Frozen input/output digests remain part of every source check. Never
    # read the large JSON body merely to rediscover an unchanged saved run.
    'study_runs':('id','id,sequence,status,input_digest,output_digest,length(snapshot),error'),
    'engineering_assets':('id','id,asset_id,version,status,revision,content_sha256,updated'),
    'domain_cable_models':('id','id,state,digest'),
    'source_documents':('id','id,name,sha256,created'),
    'document_extractions':('id','id,document,status,revision,error'),
    'document_proposals':('id','id,document,status,new_model,digest,approval'),
    'type_plans':('workspace','workspace,family,name,status,created,base_reference'),
    'type_submissions':('id','id,workspace,status,digest,asset'),
    'engineering_type_releases':('asset','asset,family,workspace,submission,sequence,digest'),
    'deliveries':('id','id,workspace,sources,renderer,digest,created'),
    'agent_tasks':('id','id,workspace_id,workspace_revision,study_id,state,waiting_reason,created,updated,'
        '(SELECT max(sequence) FROM agent_events e WHERE e.task_id=agent_tasks.id)'),
    'agent_plan_revisions':('proposal_id','proposal_id,digest,'
        "(SELECT max(sequence) FROM agent_events e WHERE e.task_id=agent_plan_revisions.task_id AND e.type='proposal.decision')"),
    'hpc_convergence':('id',"id,json_extract(state,'$.workspace'),json_extract(state,'$.study'),"
        "json_extract(state,'$.title'),json_extract(state,'$.status'),json_extract(state,'$.created')"),
    'dataset_runs':('id','id,workspace,study,status,created,updated'),
}


def project(db,metrics=None,previous=None,notifications=None):
    tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result=Projection();prior=previous if isinstance(previous,Projection) else None
    names={}
    journal=notifications['tables'] if notifications and notifications.get('complete') else None
    def changed_ids(table,key):
        events=list(journal.get(table,[]))
        if table=='studies':
            events.extend({'operation':'UPDATE','old':{'id':event[side]['study']},'new':None}
                for event in journal.get('study_versions',[]) for side in ('old','new')
                if event.get(side) and event[side].get('study'))
        if table=='workspaces':
            events.extend({'operation':'UPDATE','old':{'id':event[side]['workspace']},'new':None}
                for event in journal.get('workspace_audit',[])+journal.get('requirement_reviews',[])
                for side in ('old','new') if event.get(side) and event[side].get('workspace'))
        if table in ('agent_tasks','agent_plan_revisions'):
            tasks={event[side]['task_id'] for event in journal.get('agent_events',[]) for side in ('old','new')
                if event.get(side) and event[side].get('task_id')}
            if table=='agent_tasks':
                events.extend({'operation':'UPDATE','old':{'id':tid},'new':None} for tid in tasks)
            elif tasks:
                ids={row.get('id') for row in prior.get('agent_proposals',[]) if row['task_id'] in tasks}
                ids.update(row[0] for row in db.execute('SELECT proposal_id FROM agent_plan_revisions WHERE task_id IN ('+
                    ','.join('?' for _ in tasks)+') AND proposal_id IS NOT NULL',tuple(tasks)))
                events.extend({'operation':'UPDATE','old':{'proposal_id':id},'new':None} for id in ids if id)
        ids=set()
        for event in events:
            for side in ('old','new'):
                value=event.get(side)
                if value is not None:
                    if value.get(key) is None:return None
                    ids.add(value[key])
                elif event.get('operation')=='UPDATE' and not event.get('old') and not event.get('new'):return None
            if not event.get('old') and not event.get('new'):return None
        return ids
    def rows(table,columns,tail=''):
        started=perf_counter()
        key,probe=IDENTITIES[table];identities={};changed=None
        forced=None
        # Read-only Agent conversations update task bookkeeping, not engineering
        # notifications. Compare these small identities (with event sequence)
        # instead of mistaking an empty engineering journal for unchanged tasks.
        if not table.startswith('agent_') and journal is not None and prior is not None and prior.identities.get(table) is not None and table in tables:
            forced=changed_ids(table,key)
            direct=journal.get(table,[])
            delta=sum((1 if event['operation']=='INSERT' else -1 if event['operation']=='DELETE' else 0) for event in direct)
            # SQLite REPLACE may silently delete a UNIQUE-conflicting row when
            # recursive_triggers is off. Check cardinality on changed tables;
            # mismatches fall back to all identities rather than retaining it.
            if direct:
                count=db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                if count!=len(prior.identities[table])+delta:forced=None
            if forced is not None:
                identities=prior.identities[table].copy()
                for id in forced:identities.pop(id,None)
                if forced:
                    identities.update({row[0]:tuple(row) for row in db.execute(f'SELECT {probe} FROM {table} WHERE {key} IN ('+
                        ','.join('?' for _ in forced)+')',tuple(forced))})
        if table in tables and forced is None:
            try:identities={row[0]:tuple(row) for row in db.execute(f'SELECT {probe} FROM {table}')}
            except sqlite3.OperationalError:
                # Unknown/older host schema: full normal projection, never a
                # guessed empty table or a stale reuse receipt.
                identities=None
        result.identities[table]=identities
        old_key=names[table]
        old=prior.get(old_key,[]) if prior is not None else []
        if prior is not None and identities is not None and prior.identities.get(table) is not None:
            old_ids=prior.identities[table]
            changed={id for id,stamp in identities.items() if old_ids.get(id)!=stamp}|(set(identities)&(forced or set()))
            removed=set(old_ids)-set(identities)
            result.changed[old_key]=changed|removed
            if not changed:
                value=[row for row in old if row[key if key in row else 'id'] in identities]
                if metrics is not None:metrics[table]={'ms':(perf_counter()-started)*1000,'rows':len(value),'loaded_rows':0,'reused_rows':len(value),
                    'identity_rows':0 if forced is not None else len(identities),'committed_rows':forced is not None}
                return value
        else:result.changed[old_key]=set(identities or ())|{row.get(key,row.get('id')) for row in old}
        if table not in tables:value=[]
        else:
            params=()
            if changed is not None:
                selected='s.id' if table=='studies' else key
                clause=selected+' IN ('+','.join('?' for _ in changed)+')'
                head,sep,order=tail.partition('ORDER BY')
                tail=head+(' AND ' if 'WHERE' in head else ' WHERE ')+clause+(' ORDER BY'+order if sep else '')
                params=tuple(changed)
            loaded=[dict(row) for row in db.execute(f'SELECT {columns} FROM {table} {tail}',params)]
            value=loaded if changed is None else [row for row in old if row.get(key,row.get('id')) in identities
                and row.get(key,row.get('id')) not in changed]+loaded
            if table=='study_runs':value.sort(key=lambda row:row['sequence'],reverse=True)
            elif table=='engineering_type_releases':value.sort(key=lambda row:row['sequence'])
        if metrics is not None:metrics[table]={'ms':(perf_counter()-started)*1000,'rows':len(value),
            'loaded_rows':len(loaded) if table in tables else 0,'reused_rows':len(value)-(len(loaded) if table in tables else 0),
            'identity_rows':len(forced) if forced is not None else len(identities or {}),'committed_rows':forced is not None}
        return value
    names.update(zip(IDENTITIES,('workspaces','studies','runs','assets','models','documents','extractions','document_proposals',
        'type_plans','submissions','releases','deliveries','tasks','agent_proposals','convergence','datasets')))
    reference=lambda path:("json_object('id',json_extract(state,'"+path+".id'),'name',json_extract(state,'"+path+".name'),"
        "'version',json_extract(state,'"+path+".version'),'content_sha256',json_extract(state,'"+path+".content_sha256'))")
    workspaces=rows('workspaces',"id,revision,created,updated,COALESCE(json_extract(state,'$.domain.name'),json_extract(state,'$.scenario.name')) AS name,"
        "json_array_length(state,'$.domain.cable_types') AS cable_count,json_type(state,'$.study_cable_reference') AS study_reference_type,"
        +reference('$.study_cable_reference')+' AS cable_reference,'+reference('$.type_origin_reference')+' AS origin_reference,'
        "json_extract(state,'$.type_resource_bindings') AS resource_bindings,"
        "json_extract(state,'$.type_creation') AS type_creation,"
        "json_extract(state,'$.domain.materials') AS material_facts,"
        "json_extract(state,'$.domain.provenance.\"/execution_standards\"') AS execution_standards,"
        "json_extract(state,'$.domain.cable_types') AS type_structure")
    studies=rows('studies','s.id,s.workspace,s.revision,v.created,v.definition',
        's JOIN study_versions v ON v.study=s.id AND v.revision=s.revision')
    # One JSON invocation per saved snapshot. Repeated json_extract expressions
    # reparse large FEM input snapshots; no output/field artifact is selected.
    keys=('workspace_id','workspace_revision','study_revision','module','definition','lock')
    references=('study_cable_reference','type_origin_reference')
    fields=('id','name','version','content_sha256')
    paths=[*('$.'+key for key in keys),*('$.workspace_state.'+key+'.'+field for key in references for field in fields)]
    snapshot='json_extract(snapshot,'+','.join("'"+path+"'" for path in paths)+')'
    runs=rows('study_runs','id,workspace,study,sequence,status,created,finished,input_digest,output_digest,'+snapshot+
        " AS source_meta,substr(json_extract(error,'$.message'),1,512) AS error",'ORDER BY sequence DESC')
    for row in runs:
        if 'source_meta' not in row:continue
        values=decoded(row.pop('source_meta')) or [None]*len(paths)
        meta=dict(zip(keys,values))
        meta['workspace_state']={key:dict(zip(fields,values[len(keys)+i*len(fields):len(keys)+(i+1)*len(fields)]))
            for i,key in enumerate(references)}
        row['meta']=json.dumps(meta,ensure_ascii=False,separators=(',',':'))
    result.update({'workspaces':workspaces,'studies':studies,'runs':runs,
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
        'datasets':rows('dataset_runs','id,workspace,study,status,created,updated')})
    return result
