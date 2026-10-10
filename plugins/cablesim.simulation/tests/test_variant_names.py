"""Labels do not alter immutable result values or stable identifiers."""
import sys
from copy import deepcopy
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/validation'))
from build_reproduction_library import readable_variants
from backend.foundation.reproduction_library import bundled_evidence


def test_saved_variant_labels_preserve_ids_and_values():
    items={'sample':{'id':'sample','rows':[{'id':'dry/value','variant':'dry','open_source':12.3},{'id':'x/value','variant':'tb880-case-0-2-eddy-gp31','reference':682.8}],
                     'convergence':[{'variant':'nominal-fixed-loss','nodes':100,'value':320.}]}}
    before=deepcopy(items);readable_variants(items)
    assert items['sample']['rows'][0]['variant_name']=='干燥土壤'
    for group in ('rows','convergence'):
        for old,row in zip(before['sample'][group],items['sample'][group]):
            assert row['variant_id']==old['variant']
            restored={k:v for k,v in row.items() if k not in ('variant_id','variant_name')};restored['variant']=row['variant_id'];assert restored==old
    unchanged=deepcopy(items);readable_variants(items);assert items==unchanged


def test_bundled_results_have_chinese_variants_with_original_identity():
    value,_,_=bundled_evidence()
    assert len(value['items'])==63
    labelled=[row for item in value['items'] for group in ('rows','convergence') for row in item.get(group,[]) if 'variant_id' in row]
    assert labelled and all(row['variant']==row['variant_name'] and row['variant_id'] for row in labelled)
    assert any(row['variant_id']=='tb880-case-0-2-eddy-gp31' for row in labelled)
