from scripts.evaluate_datasheets import score

def test_unit_scale_and_neighbor_model_errors_are_separate():
 labels={'truth':{'outer_diameter':{'value_si':.0861,'unit_si':'m'}},'other_model_values':{'outer_diameter':[.0936]}}
 result=score(labels,[{'field':'outer_diameter','value_si':86.1,'unit_si':'m','ambiguities':[]},{'field':'outer_diameter','value_si':.0936,'unit_si':'m','ambiguities':[]}])
 assert result['unit_errors']==1 and result['model_row_errors']==1 and result['true_positive']==0
 assert score(labels,[{'field':'outer_diameter','value_si':.0861,'unit_si':'m','ambiguities':[]}])['precision']==1

def test_ambiguous_values_are_abstentions_not_accuracy_credit():
 labels={'truth':{'outer_diameter':{'value_si':.0861,'unit_si':'m'}}}
 result=score(labels,[{'field':'outer_diameter','value_si':.0861,'unit_si':'m','ambiguities':['conflicting source']}])
 assert result['true_positive']==0 and result['predicted']==0 and result['recall']==0 and result['ambiguous_candidates']==1
