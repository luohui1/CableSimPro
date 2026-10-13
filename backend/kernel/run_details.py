"""Public saved-run reads.

The default ``detail`` view is a verified display projection: it retains original
input/output digests, result quantities and source references, but omits frozen
case inputs, preflight details, physical-property evidence and lossless shards.
``view=full`` returns the complete immutable run (the same saved payload returned
by POST), for archives and exact frozen-evidence comparisons. Projection never
changes the saved input/output or their digests. Sharded display reads use the
byte-bound verification receipt; full reads still verify complete evidence.
"""
from copy import deepcopy

from fastapi import HTTPException

from .workspace import fingerprint


def detail(research, wid, sid, rid, view='detail'):
    # Identify saved lossless field shards without decoding their arrays. The
    # display reader verifies actual stored bytes, release pins and artifacts.
    sharded = None
    if view != 'full' and hasattr(research, 'store'):
        with getattr(research.store, 'read_snapshot', research.store.db)() as db:
            sharded = db.execute('SELECT request_id,request_digest,owner_epoch,execution_nonce FROM study_runs '
                                # Saved capability is in the small input snapshot.
                                # CASE short-circuits the legacy shard scan; the
                                # display reader still authenticates actual bytes.
                                "WHERE workspace=? AND id=? AND CASE WHEN json_extract(snapshot,'$.definition.method.capability')='iec-thermal-field' "
                                'THEN 1 ELSE instr(output,?)>0 END',
                                (wid, rid, '"x-cablesim.field-')).fetchone()
    if sharded is not None:
        from .batch_field_projection import read_display
        value = {**read_display(research, wid, rid), **dict(sharded)}
    else:
        value = research.get_run(wid, rid)
    if value['study'] != sid:
        raise HTTPException(404, '运行不属于此研究。')
    if view == 'full':
        return value
    # Lossless field shards belong to the explicit full/archive endpoints.
    # Verify the saved envelope first, then use the same display projection as
    # the FEM viewer; declared digests still identify the original evidence.
    from .batch_field_projection import display_only
    if isinstance(value.get('output'), dict):
        value = display_only(value)
    # read_display already decoded a private copy of the immutable receipt.
    # Retain the defensive copy for legacy/full readers only.
    if sharded is None:value = deepcopy(value)
    # Display names come from each saved case, not the live workspace model.
    # A rating-table case may replace cable IDs in its frozen input.
    labels = {}
    for index, case in enumerate(value.get('snapshot', {}).get('cases', [])):
        source = case.get('input', {})
        entities = {}
        for number, circuit in enumerate(source.get('circuits', [])):
            label = circuit.get('label') or f'回路 {number + 1}'
            entities[circuit['id']] = label
            phases = {'L1': 'A 相', 'L2': 'B 相', 'L3': 'C 相', 'L1L2L3': '三相'}
            for cable in circuit.get('cables', []):
                entities[cable['id']] = f"{label} · {phases.get(cable.get('phase'), '电缆')}"
        labels[case['case_id']] = {'label': f'工况 {index + 1}', 'entities': entities}
    value['saved_case_labels'] = labels
    snapshot = value.get('snapshot')
    if isinstance(snapshot, dict):
        for case in snapshot.get('cases', []):
            if 'input' in case:
                source = case.pop('input')
                case['input_ref'] = {
                    'url': f'/api/workspaces/{wid}/studies/{sid}/runs/{rid}/cases/{case["case_id"]}/input',
                    'sha256': fingerprint(source),
                }
        if view == 'detail':
            # These disclosures are available at ?view=evidence. Neither the
            # stored snapshot nor its digest is changed by this projection.
            manifests = snapshot.pop('method_manifests', {})
            snapshot['method_cards'] = {digest: {key: manifest.get(key) for key in ('id', 'name', 'version')}
                                        for digest, manifest in manifests.items()}
    if view == 'detail' and isinstance(value.get('output'), dict):
        value['output'].pop('preflight', None)
        for case in value['output'].get('cases', []):
            evidence = case.get('evidence') or {}
            evidence.pop('material_basis', None)
            evidence.pop('material_constants', None)
    value['evidence_ref'] = {'url': f'/api/workspaces/{wid}/studies/{sid}/runs/{rid}?view=evidence',
                             'input_digest': value['input_digest'], 'output_digest': value['output_digest']}
    value['snapshot_view'] = 'inputs-on-demand'
    return value


def case_input(research, wid, sid, rid, case_id):
    from .fem_evidence import display_read
    value = display_read(research, wid, rid)
    if value['study'] != sid:
        raise HTTPException(404, '运行不属于此研究。')
    if value['integrity'] != 'verified':
        raise HTTPException(409, '运行完整性校验失败，不能读取为可回放输入。')
    case = next((row for row in value['snapshot'].get('cases', []) if row['case_id'] == case_id), None)
    if case is None:
        raise HTTPException(404, '工况不存在于此运行的固定快照中。')
    return {'run_id': rid, 'case_id': case_id, 'input': case['input'],
            'input_digest': fingerprint(case['input']), 'run_input_digest': value['input_digest'],
            'integrity': 'verified'}
