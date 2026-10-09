"""Reviewed finite engineering workflows. These carry no execution authority."""
from copy import deepcopy
from fastapi import HTTPException
from jsonschema import Draft202012Validator
from .context_builder import encoded


def obj(properties, required=()):
    return {'type':'object','properties':properties,'required':list(required),'additionalProperties':False}


STUDY = {'study_id':{'type':['string','null'],'maxLength':120}, 'module':{'type':['string','null'],'maxLength':120}}
PAGE = {'after':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':20},'case_after':{'type':'integer','minimum':0}}
CHANGES = {'type':'array','minItems':1,'maxItems':12,'items':obj({
    'path':{'type':'string','minLength':1,'maxLength':500},
    'value':{'type':['number','string','boolean','null']},
    'unit':{'type':['string','null'],'maxLength':40}}, ('path','value'))}
CATALOG = [
    {'id':'conclusion_summary','name':'结论汇总','description':'结论汇总问题必须用此配方：一次读取各口径电流、工况、热点、温限余量、限制对象、土壤/坐标/负荷与状态；next_page分页。取得完整摘要后直接解释，仅用户追问细节再读运行。',
     'parameters':obj(PAGE)},
    {'id':'missing_inputs','name':'检查缺项','description':'读取工程字段并预检指定研究；不自动补物性，正式或超算预检仍需人工。',
     'parameters':obj(STUDY)},
    {'id':'proposal_comparison','name':'方案试算对比','description':'绑定当前正常保存工况、生成字段级方案、快速预览；过期或部分成功基准停止后续动作，指导工作台更新来源并人工重算。不保存、不批准、不正式运行。',
     'parameters':obj({**STUDY,'changes':CHANGES,'scope':{'enum':['domain','parameters']},
         'run_id':{'type':'string','maxLength':120},'case_id':{'type':'string','maxLength':120}}, ('changes','scope'))},
    {'id':'sensitivity_advice','name':'参数敏感性建议','description':'读取当前字段、方法参数范围与已有结论，提出研究建议；不猜采样范围或敏感性数值，不自动求解。',
     'parameters':obj({**STUDY,'paths':{'type':'array','maxItems':8,'items':{'type':'string','maxLength':500}}})},
    {'id':'type_review','name':'型号设计检查','description':'只读型号结构、缺项及已有标准要求判定；区分保存输入、历史运行与未覆盖标准，建议改进，不修改、批准或发布。按next_page读取完整检查。',
     'parameters':obj({'type_id':{'type':'string','minLength':1,'maxLength':120},
         'view':{'const':'review'},'after':{'type':'integer','minimum':0},
         'limit':{'type':'integer','minimum':1,'maximum':20},'expected_revision':{'type':'integer','minimum':1}},('type_id',))},
]


def recipes(context=None):
    rows=deepcopy(CATALOG)
    if context and context.get('kind')=='type':
        rows=[row for row in rows if row['id']=='type_review']
        rows[0]['parameters']['required']=[]
        rows[0]['parameters']['properties']['type_id'].update(const=context['id'],default=context['id'])
    return rows


def validate_request(request,context=None):
    request=deepcopy(request)
    if context and context.get('kind')=='type':
        if request['id']!='type_review':
            raise HTTPException(422,{'code':'RECIPE_NOT_APPLICABLE','path':'/recipe/id',
                'message':'型号设计会话只适用 type_review；研究配方请在工程或研究会话使用。'})
        request['parameters'].setdefault('type_id',context['id'])
    try:encoded(request)
    except (ValueError,TypeError):raise HTTPException(422,{'code':'RECIPE_PARAMETERS_INVALID','path':'/recipe/parameters','message':'配方参数须为有限数值和合法 JSON。'}) from None
    row=next((row for row in recipes(context) if row['id']==request['id']),None)
    if row is None:raise HTTPException(422,{'code':'RECIPE_INVALID','path':'/recipe/id','message':'请选择已注册的工程配方。'})
    errors=sorted(Draft202012Validator(row['parameters']).iter_errors(request['parameters']),key=lambda error:str(list(error.path)))
    if errors:
        error=errors[0]
        path='/recipe/parameters'+''.join('/'+str(part) for part in error.absolute_path)
        if error.validator=='required':path+='/'+next(key for key in error.validator_value if key not in error.instance)
        raise HTTPException(422,{'code':'RECIPE_PARAMETERS_INVALID','path':path,
            'message':'配方参数不符合 '+error.validator+' 约束；请按 /api/agent/recipes 中该配方的 parameters 填写。'})
    return deepcopy(request)


def recipe_schema(context=None):
    catalog=recipes(context)
    return {**obj({'recipe':{'type':'string','enum':[row['id'] for row in catalog]},
        'parameters':{'type':'object','description':'按所选配方的参数契约填写；可省略会话已绑定的study_id。'}},('recipe','parameters')),
        'oneOf':[obj({'recipe':{'const':row['id']},'parameters':row['parameters']},('recipe','parameters')) for row in catalog]}


def expand(arguments):
    params = deepcopy(arguments['parameters']); rid=arguments['recipe']
    study = {k:params[k] for k in STUDY if k in params}
    if rid=='conclusion_summary':return [('project_digest',params,{})]
    if rid=='type_review':return [('type_read',{**params,'view':'review'},{})]
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
