"""Resolve text mentions to shared cards; ambiguous names need observed identities."""
from backend.index import get_index

KINDS = {'project','study','run','type','cable_version','plugin'}
FIELDS = {'workspace_id':'project','study_id':'study','run_id':'run','type_id':'type',
          'model_id':'cable_version','plugin_id':'plugin'}


def references(research, text, record):
    cards = get_index(research).snapshot().cards; preferred = set()
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get('kind'),str) and value['kind'] in KINDS and isinstance(value.get('id'), str):
                preferred.add((value['kind'],value['id']))
            for field,kind in FIELDS.items():
                if isinstance(value.get(field),str): preferred.add((kind,value[field].removeprefix('candidate:') if kind=='cable_version' else value[field]))
            for child in value.values(): visit(child)
        elif isinstance(value,list):
            for child in value: visit(child)
    for step in record.get('steps',[]):
        visit(step.get('result') or {})
    wid = record['workspace_id']; preferred.add(('type' if ('type',wid) in cards else 'project',wid))
    if record.get('study_id'): preferred.add(('study',record['study_id']))
    names = {}
    for key,card in cards.items():
        if key[0] in KINDS: names.setdefault(card['name'],[]).append(key)
    matches = []
    for key,card in cards.items():
        if key[0] not in KINDS: continue
        pos = text.find(card['id'])
        peers = names[card['name']]
        selected = [peer for peer in peers if peer in preferred]
        if len(card['name']) >= 2 and (len(peers)==1 or (len(selected)==1 and key==selected[0])):
            named = text.find(card['name'])
            if named >= 0: pos = named if pos < 0 else min(pos,named)
        if pos >= 0: matches.append((pos,key,card))
    matches.sort(key=lambda row:(row[0],row[1] not in preferred,row[1]))
    return [card for _,_,card in matches]
