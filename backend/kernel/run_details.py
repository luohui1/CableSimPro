"""Public run projections; full frozen evidence is always verified before trimming."""
from copy import deepcopy

from fastapi import HTTPException

from .workspace import fingerprint


def detail(research, wid, sid, rid, view='detail'):
    value = research.get_run(wid, rid)
    if value['study'] != sid:
        raise HTTPException(404, '运行不属于此研究。')
    if view == 'full':
        return value
    value = deepcopy(value)
    snapshot = value.get('snapshot')
    if isinstance(snapshot, dict):
        for case in snapshot.get('cases', []):
            if 'input' in case:
                source = case.pop('input')
                case['input_ref'] = {
                    'url': f'/api/workspaces/{wid}/studies/{sid}/runs/{rid}/cases/{case["case_id"]}/input',
                    'sha256': fingerprint(source),
                }
    value['snapshot_view'] = 'inputs-on-demand'
    return value


def case_input(research, wid, sid, rid, case_id):
    value = research.get_run(wid, rid)
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
