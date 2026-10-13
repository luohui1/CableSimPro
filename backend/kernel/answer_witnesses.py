"""Check a bounded answer artifact against same-case accepted engineering output."""
from cablesim_sdk.result_answers import ARTIFACT, HeadlineWitness
from cablesim_sdk.reproduction import digest
from .workspace import fingerprint


def status(run,case,*,source_artifact_types=None):
    try:
        witness=HeadlineWitness.model_validate(case['artifacts'][ARTIFACT])
        original_id=case['case_id'].split('-',2)[-1] if case['case_id'].startswith('crosscheck-') else case['case_id']
        inputs=next(item['input'] for item in run['snapshot']['cases'] if item['case_id']==original_id)
        method=case.get('method') or run['snapshot']['definition']['method']
        producer=witness.producer
        contract=run['snapshot'].get('artifact_source_contracts',{}).get(fingerprint(method),{})
        expected={'case_id':original_id,'plugin_id':method['plugin_id'],'plugin_version':method['version'],
                  'capability':method['capability'],'input_sha256':digest(inputs),'manifest_sha256':contract.get('manifest_sha256')}
        for key,value in expected.items():
            if getattr(producer,key)!=value:raise ValueError('关键结论来源不一致：'+key)
        if not case.get('method') and run.get('output',{}).get('run_id') and producer.run_id!=run['output']['run_id']:
            raise ValueError('关键结论来源不是本次执行。')
        hashes=case.get('artifact_digests',{})
        if not hashes.get(ARTIFACT):raise ValueError('关键结论工件缺少封存摘要。')
        for value in witness.quantities:
            # List projections authenticate the complete saved bytes first, then
            # read these actual JSON types from those same bytes in SQLite. They
            # never replace an engineering artifact with a manufactured object.
            present = source_artifact_types.get(value.artifact_type) == 'object' if source_artifact_types is not None else isinstance(case['artifacts'].get(value.artifact_type),dict)
            if not present or hashes.get(value.artifact_type)!=value.artifact_sha256:
                raise ValueError('关键结论没有绑定同工况原始工程工件。')
            inherited=any(spec.get('key')==value.key and spec.get('condition')==value.condition
                          and spec.get('source_artifact')==value.artifact_type for spec in run['snapshot'].get('headline_contract',[]))
            if not any(row.get('status')=='available' and row.get('key')==value.key and row.get('entity')==value.entity
                       and (row.get('case')==value.condition or 'case' not in row and inherited)
                       and row.get('unit')==value.unit and row.get('value')==value.value
                       for row in case.get('results',[])):
                raise ValueError('关键结论与插件已验收数量不一致。')
        return {'status':'verified','reason':None}
    except (KeyError,ValueError,TypeError,StopIteration) as exc:
        return {'status':'unavailable','reason':str(exc)}
