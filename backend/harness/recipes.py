"""Reviewed finite engineering workflows. These carry no execution authority."""
from copy import deepcopy


def obj(properties, required=()):
    return {'type':'object','properties':properties,'required':list(required),'additionalProperties':False}


STUDY = {'study_id':{'type':['string','null'],'maxLength':120}, 'module':{'type':['string','null'],'maxLength':120}}
PAGE = {'after':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':20}}
CHANGES = {'type':'array','minItems':1,'maxItems':12,'items':obj({
    'path':{'type':'string','minLength':1,'maxLength':500},
    'value':{'type':['number','string','boolean','null']},
    'unit':{'type':['string','null'],'maxLength':40}}, ('path','value'))}
CATALOG = [
    {'id':'conclusion_summary','name':'结论汇总','description':'一次读取各研究最新保存结论、限制对象与状态；超过容量分页。',
     'parameters':obj(PAGE)},
    {'id':'missing_inputs','name':'检查缺项','description':'读取工程字段并预检指定研究；不自动补物性，正式或超算预检仍需人工。',
     'parameters':obj(STUDY)},
    {'id':'proposal_comparison','name':'方案试算对比','description':'绑定原保存工况、生成字段级方案、快速预览；不保存、不批准、不正式运行。',
     'parameters':obj({**STUDY,'changes':CHANGES,'scope':{'enum':['domain','parameters']},
         'run_id':{'type':'string','maxLength':120},'case_id':{'type':'string','maxLength':120}}, ('changes','scope'))},
    {'id':'sensitivity_advice','name':'参数敏感性建议','description':'读取当前字段、方法参数范围与已有结论，提出研究建议；不猜采样范围或敏感性数值，不自动求解。',
     'parameters':obj({**STUDY,'paths':{'type':'array','maxItems':8,'items':{'type':'string','maxLength':500}}})},
]


def recipes():
    return deepcopy(CATALOG)


def recipe_schema():
    return {**obj({'recipe':{'type':'string','enum':[row['id'] for row in CATALOG]},
        'parameters':{'type':'object','description':'按所选配方的参数契约填写；可省略会话已绑定的study_id。'}},('recipe','parameters')),
        'oneOf':[obj({'recipe':{'const':row['id']},'parameters':row['parameters']},('recipe','parameters')) for row in CATALOG]}


def expand(arguments):
    params = deepcopy(arguments['parameters']); rid=arguments['recipe']
    study = {k:params[k] for k in STUDY if k in params}
    if rid=='conclusion_summary':return [('project_digest',params,{})]
    if rid=='missing_inputs':return [('workspace_read',{},{}),('study_preflight',study,{})]
    if rid=='sensitivity_advice':
        return [('workspace_read',{'paths':params['paths']} if params.get('paths') else {},{}),
            ('sensitivity_inputs',study,{}),('project_digest',{}, {})]
    if rid=='proposal_comparison':
        baseline={**study,**{k:params[k] for k in ('run_id','case_id') if k in params}}
        proposal={'changes':params['changes']}
        if params['scope']=='parameters':proposal.update(study)
        return [('study_baseline',baseline,{}),
            ('propose_domain_changes' if params['scope']=='domain' else 'propose_method_parameters',proposal,{}),
            ('study_preview',study,{'proposal_id':(1,'/data/proposal/id'),
                'run_id':(0,'/data/source_run_id'),'case_id':(0,'/data/source_case_id')})]
    raise ValueError('Unknown recipe')
