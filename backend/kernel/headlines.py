"""Bounded answers from sealed, validated producer quantities and artifact receipts."""
from math import isfinite


def project(snapshot, output, artifact_status=None):
    from cablesim_sdk.plugin_ui import Headline

    answers = []
    definitions = snapshot.get('headline_contract', [])
    if not output or not definitions:
        return answers
    default = output.get('default_result') or {}
    for raw in definitions[:3]:
        spec = Headline.model_validate(raw)
        candidates = []
        condition = default.get('case') if default.get('key') == spec.key else spec.condition
        for case in output.get('cases', []):
            if case.get('status') != 'succeeded' or case.get('method') or case['case_id'].startswith('crosscheck-'):
                continue
            artifacts, hashes = case.get('artifacts', {}), case.get('artifact_digests', {})
            if not isinstance(artifacts.get(spec.artifact), dict) or not hashes.get(spec.artifact):
                continue
            state = (artifact_status or {}).get(case['case_id'], {}).get(spec.artifact)
            if not state or state.get('status') != 'verified':
                continue
            for value in artifacts[spec.artifact].get('quantities', []):
                number = value.get('value')
                if (value.get('key') == spec.key and value.get('artifact_type')==spec.source_artifact
                    and value.get('unit') == spec.unit.si and isinstance(number, (int, float))
                    and not isinstance(number, bool) and isfinite(number)
                    and (condition is None or value.get('condition') == condition)):
                    candidates.append((value, case['case_id'], hashes[spec.artifact]))
        # Separate physical operating conditions never become one aggregate.
        if not candidates:
            continue
        if spec.aggregate=='first':candidates=candidates[:1]
        elif len({row[0].get('condition') for row in candidates})!=1:continue
        selected = (min(candidates, key=lambda row: row[0]['value']) if spec.aggregate == 'minimum'
                    else max(candidates, key=lambda row: row[0]['value']) if spec.aggregate == 'maximum'
                    else candidates[0])
        value, case_id, artifact_hash = selected
        answers.append({'key': spec.key, 'title': spec.title, 'value': value['value'], 'unit': value['unit'],
                        'display_unit': spec.unit.display, 'display_value': value['value'] * spec.unit.scale + spec.unit.offset,
                        'entity': value['entity'], 'condition': value.get('condition'), 'case_id': case_id,
                        'source': {'artifact_type': value['artifact_type'], 'sha256': value['artifact_sha256'], 'witness_sha256':artifact_hash}})
    return answers
