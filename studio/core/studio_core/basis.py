"""Standard basis lookups.

A method authors the queries it needs (which table of which standard edition, under which conditions).
The basis plugin answers them from its sealed data, and the answer travels with the method's result as a
reference: record, page, digests. The core neither derives a limit nor fills one in.
"""
from . import CoreError, runner

PLUGIN = 'cablesim.standards-basis'
ARTIFACT = 'x-cablesim.standards-basis'


def resolve(queries):
    """References for the queries the library answers, and a list of those it does not hold."""
    keys = list(queries)
    references, missing = {}, []
    for start in range(0, len(keys), 100):
        chunk = {f'basis-{index}': key for index, key in enumerate(keys[start:start + 100])}
        run = runner.run(PLUGIN, 'lookup', [{'case_id': case_id, 'input': queries[key], 'parameters': {}} for case_id, key in chunk.items()])
        for case in run['cases']:
            key = chunk[case['case_id']]
            if case['status'] != 'succeeded':
                error = case.get('error') or {}
                raise CoreError(error.get('code', 'BASIS_LOOKUP_FAILED'), error.get('message', '标准依据查询失败，请核对条件。'), error.get('path'))
            answer = case['artifacts'][ARTIFACT]
            common = {'query': queries[key], 'plugin_version': answer['plugin_version'], 'data_sha256': answer['data_sha256'],
                      'query_sha256': answer['query_sha256'], 'request_sha256': run['request_sha256'],
                      'artifact_digest': case['artifact_digests'][ARTIFACT]}
            if answer['status'] == 'listed':
                references[key] = {'schema': 'cablesim.standard-basis-list-ref/1', 'records': answer['records'], **common}
            elif answer['status'] == 'resolved':
                record = answer['records'][0]
                references[key] = {
                    'schema': 'cablesim.standard-basis-ref/1', 'plugin_id': answer['plugin_id'], 'record_id': record['id'],
                    'record_sha256': record['record_sha256'], 'standard': record['standard'], 'edition': record['edition'],
                    'locator': record['table'] or record['clause'], 'printed_page': record['printed_page'], 'pdf_page': record['pdf_page'],
                    'source_sha256': record['source_sha256'], 'record': record, 'release_digest': run['manifest_sha256'], **common}
            else:
                missing.append({'key': key, 'query': queries[key], 'reason': answer.get('reason', '标准依据库暂未收录这一条件。')})
    return references, missing
