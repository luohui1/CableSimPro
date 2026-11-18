"""Regenerate the consumer lock; never edits the standards data plugin."""
from pathlib import Path
from hashlib import sha256
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[4]


def build():
    sys.path.insert(0, str(ROOT/'plugins/cablesim.standards-basis/src'))
    sys.path.insert(0, str(ROOT/'plugins/cablesim.type-electrical/src'))
    from cablesim_standards_basis.library import BasisLibrary
    from cablesim_type_electrical.basis_identity import SCHEMA, content_digest
    library = BasisLibrary()
    manifest_path = 'plugins/cablesim.standards-basis/plugin.json'
    manifest = json.loads((ROOT/manifest_path).read_text('utf-8'))
    releases = [item for item in json.loads((ROOT/'plugins/registry.json').read_text('utf-8'))['plugins']
                if item['plugin_id'] == manifest['id']]
    if (len(releases) != 1 or releases[0]['version'] != manifest['version']
            or releases[0]['manifest'] != manifest_path
            or not re.fullmatch(r'[0-9a-f]{64}', releases[0]['release_digest'])):
        raise ValueError('标准依据发行索引与清单不一致，请先完成数据插件封签。')
    release_digest = releases[0]['release_digest']
    quantities = {'short_circuit_material_k','resistance_temperature_coefficient_reciprocal_0c',
        'volumetric_heat_capacity_20c','adiabatic_short_circuit_formula','non_adiabatic_screen_formula',
        'non_adiabatic_conductor_formula','non_adiabatic_conductor_simplified_formula',
        'short_circuit_geometrical_area_formula','parallel_metal_short_circuit_rule'}
    result = {}
    for r in library._records():
        if r['standard']!='IEC 60949' or not (r['quantity']['key'] in quantities or
            r['quantity']['key'] in ('non_adiabatic_X','non_adiabatic_Y') and r['conditions'].get('insulation')=='XLPE'):
            continue
        query = {'standard':r['standard'],'edition':r['edition'],'locator':r['table'] or r['clause'],
            'quantity':r['quantity']['key'],'record_id':r['id'],'conditions':r['conditions']}
        answer=library.query({'schema_version':'cablesim.standards-query/1','operation':'resolve',**query})
        record = answer['records'][0]
        bare = {key: value for key, value in record.items() if key not in ('record_sha256', 'citation')}
        result[r['id']]={'query':query,'digest':record['record_sha256'],
                        'content_digest_schema':SCHEMA, 'content_sha256':content_digest(bare),
                        'plugin_version':answer['plugin_version'],
                        'data_sha256':answer['data_sha256'], 'query_sha256':answer['query_sha256'],
                        'release_digest':release_digest, 'citation':record['citation'],
                        # This issuer writes exactly these UTF-8 JSON bytes. The
                        # answer contains no case/run ID; real Executor tests
                        # independently check the receipt across query batches.
                        'artifact_digest':sha256(json.dumps(answer, ensure_ascii=False,
                                                          allow_nan=False).encode('utf-8')).hexdigest()}
    return result


if __name__=='__main__':
    output=Path(__file__).with_name('short-basis-catalog.json')
    content=json.dumps(build(),ensure_ascii=False,indent=2)+'\n'
    if '--write' in sys.argv:
        with output.open('w',encoding='utf-8',newline='\n') as file:file.write(content)
    elif output.read_text('utf-8')!=content:
        raise SystemExit('IEC 60949 consumer lock differs; run basis_catalog.py --write and reseal this plugin.')
