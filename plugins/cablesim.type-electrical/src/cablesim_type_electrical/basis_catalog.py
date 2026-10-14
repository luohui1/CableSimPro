"""Regenerate the consumer lock; never edits the standards data plugin."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[4]


def build():
    sys.path.insert(0, str(ROOT/'plugins/cablesim.standards-basis/src'))
    from cablesim_standards_basis.library import BasisLibrary
    library = BasisLibrary()
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
        result[r['id']]={'query':query,'digest':answer['records'][0]['record_sha256'],
                        'plugin_version':answer['plugin_version']}
    return result


if __name__=='__main__':
    output=Path(__file__).with_name('short-basis-catalog.json')
    content=json.dumps(build(),ensure_ascii=False,indent=2)+'\n'
    if '--write' in sys.argv:
        with output.open('w',encoding='utf-8',newline='\n') as file:file.write(content)
    elif output.read_text('utf-8')!=content:
        raise SystemExit('IEC 60949 consumer lock differs; run basis_catalog.py --write and reseal this plugin.')
