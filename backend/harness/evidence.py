"""Read existing evidence without manufacturing verification or model quantities."""
import math
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext

from fastapi import HTTPException

from backend.kernel.headlines import project
from .context_builder import METADATA_PROJECTIONS


def run_points(research,run,case_id=None,*,entity=None,key=None,all_quantities=False):
    if run['integrity']!='verified':raise HTTPException(409,{'code':'RUN_INTEGRITY_FAILED','message':'运行完整性未通过，拒绝提供数值。'})
    output=run.get('output') or {}
    selected=[case for case in output.get('cases',[]) if case_id is None or case['case_id']==case_id]
    if case_id is not None and not selected:raise HTTPException(404,'此运行没有指定工况。')
    if case_id is None and not all_quantities and run['snapshot']['definition']['driver']['kind']=='selection':
        from backend.kernel.report import recommended_case
        preferred=recommended_case(run)
        if preferred:selected=[case for case in selected if case['case_id']==preferred]
    cases=[];refs=[]
    family=run['snapshot']['definition']['method'].get('plugin_id')
    fem=family=='cablesim.simulation'
    numerical=run.get('convergence')
    if fem and run['snapshot']['definition']['method'].get('capability')=='iec-thermal-field' and hasattr(research,'store'):
        from backend.kernel.fem_evidence import proof as convergence_proof
        numerical=convergence_proof(research,run,display=True,summary=True)
    conclusion_keys={'ampacity','conductor_temperature','temperature_margin','x-cablesim.emergency-current',
        'thermal_resistance.external','thermal_resistance.insulation','thermal_resistance.oversheath','losses.total'}
    for case in selected:
        comparison=case.get('artifacts',{}).get('x-cablesim.iec-fem-comparison')
        usable=not fem or (numerical or {}).get('status')=='converged' or (
            isinstance(comparison,dict) and comparison.get('valid') is True and
            run.get('artifact_status',{}).get(case['case_id'],{}).get('x-cablesim.iec-fem-comparison',{}).get('status')=='verified')
        quantities=[value for value in case.get('results',[]) if (entity is None or value.get('entity')==entity)
            and (value.get('key')==key if key else all_quantities or value.get('key') in conclusion_keys)] if case['status']=='succeeded' and usable else []
        quantities.sort(key=lambda row:(0 if row.get('key')=='ampacity' else 1 if row.get('key')=='conductor_temperature' else 2))
        factors=[]
        for kind,artifact in case.get('artifacts',{}).items():
            if not usable:continue
            if not isinstance(artifact,dict):continue
            source={'run_id':run['id'],'case_id':case['case_id'],'artifact_type':kind,'sha256':case.get('artifact_digests',{}).get(kind)}
            operating=artifact.get('operating') or {}
            if not isinstance(operating,dict):continue
            for field in ('limiting_cable','hottest_cable'):
                if operating.get(field) and (entity is None or operating[field]==entity):factors.append({'key':field,'entity':operating[field],'source':source})
            for goal in artifact.get('goal_checks',[]):
                if goal.get('margin') is not None and (entity is None or goal.get('entity')==entity) and key in (None,'temperature_margin','current_margin'):
                    factors.append({'key':'temperature_margin' if goal.get('key')=='conductor_temperature' else 'current_margin',
                        'value':goal['margin'],'unit':goal['unit'],'entity':goal.get('entity'),'condition':goal.get('condition'),'source':source})
        cases.append({'case_id':case['case_id'],'status':case['status'],
            'results':quantities,'factors':factors,'limitations':[] if factors else ['未取得插件明确输出的限制对象或温限余量；未推算。'],
            'error':case.get('error'),'warnings':case.get('warnings',[]),
            **({'limitations':['有限元未通过数值收敛；只保留诊断，不作为可用结论。']} if not usable else {})})
        for kind,digest in case.get('artifact_digests',{}).items():
            refs.append({'run_id':run['id'],'case_id':case['case_id'],'artifact_type':kind,'sha256':digest,
                'verification':run.get('artifact_status',{}).get(case['case_id'],{}).get(kind,{}).get('status','unknown')})
    headline=project(run['snapshot'],output,run.get('artifact_status')) if run['status'] in ('succeeded','partial') else []
    headline=[{**value,'display_rounded':round(value['display_value'],1)} for value in headline]
    headline=[value for value in headline if (entity is None or value.get('entity')==entity) and (key is None or value.get('key')==key)]
    if fem and (numerical or {}).get('status')!='converged' and not any(
        isinstance(case.get('artifacts',{}).get('x-cablesim.iec-fem-comparison'),dict) and
        case['artifacts']['x-cablesim.iec-fem-comparison'].get('valid') is True and
        run.get('artifact_status',{}).get(case['case_id'],{}).get('x-cablesim.iec-fem-comparison',{}).get('status')=='verified'
        for case in selected):headline=[]
    return {'run_id':run['id'],'study_id':run['study'],'status':run['status'],'freshness':run['freshness'],
        'input_digest':run['input_digest'],'output_digest':run.get('output_digest'),'method':run['snapshot']['definition']['method'],
        'headlines':headline,'cases':cases,'assessment':[value for value in output.get('assessment',[]) if any(case['case_id']==value.get('case_id') for case in selected)],
        'checks':{'integrity':'pass','artifact_status':run.get('artifact_status',{}),
            'numerical':numerical if numerical is not None else {'status':'unknown','message':'未取得独立数值收敛检查。'},
            'cad_analysis_qualification':{'status':'unknown','message':'本轮未接入CAD分析资格桥。'},
            'engineering_approval':False},'artifact_refs':refs,'projection':'conclusions',
        'method_family':'finite_element' if fem else 'iec' if family=='cablesim.iec60287' else 'plugin',
        'read_hint':'可用 case_id / entity / key 继续读取；完整结果保留在运行记录。'}


def numbers(value):
    result=set()
    def visit(item):
        if type(item) in (int,float) and math.isfinite(item):result.add(float(item))
        elif isinstance(item,dict):
            if item.get('projection') in METADATA_PROJECTIONS:return
            if item.get('projection') in ('platform_read','draft_geometry'):
                visit(item.get('evidence',{}));return
            for child in item.values():visit(child)
        elif isinstance(item,list):
            for child in item:visit(child)
    visit(value)
    return result


NUMBER=r'[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?'
QUANTITY=re.compile(r'('+NUMBER+r')\s*(K\s*[·*.]\s*m/W|W/\(m\s*[·*.]\s*K\)|J/\(m³[·*]K\)|Ω/km|Ω/m|ohm/km|ohm/m|A/m(?:²|\^2|2)|mm²|mm2|m²|m2|W/m|kV|kA|°C|℃|摄氏度|安培|Hz|mm|Pa|kg|deg|°|A|K|V|W|m|s|%|倍)(?![A-Za-z²0-9/])')


def unit_name(unit):
    if unit=='°':return 'deg'
    return str(unit).replace('℃','°C').replace('摄氏度','°C').replace('安培','A').replace('ohm','Ω').replace('m^2','m²').replace('mm2','mm²').replace('m2','m²').replace('*','·').replace('K.m','K·m').replace(' ','')


def literal_number(value):
    return float(value.replace(',','')) if isinstance(value,str) else float(value)


def is_delta(key):
    return bool(re.search(r'margin|delta|rise|difference|温差|余量',str(key),re.I))


def delta_context(prefix,unit):
    if unit not in ('K','°C'):return False
    # A preceding temperature/margin has its own qualifier: "余量24 K
    # （温限90 °C）" must not transfer "余量" to the absolute limit.
    previous=list(QUANTITY.finditer(prefix))
    if previous:prefix=prefix[previous[-1].end():]
    # "升高到58°C" is an absolute value; "升高5°C" is a difference.
    if re.search(r'(?:升高|降低|变化)(?:到|至|为)|(?:从|由|→)[^，。；\n]*$',prefix):return False
    return bool(re.search(r'温差|余量|温升|变化|差值|升高|降低|超出(?:温限|上限)?|超过(?:温限|上限)',prefix))


def declared_references(observations):
    """Saved source declarations, including sealed method parameter source fields."""
    def visit(value,path='observations',parameters=False):
        if isinstance(value,dict):
            if value.get('projection') in METADATA_PROJECTIONS:return
            if '/provenance/' in path and value.get('kind') and isinstance(value.get('reference'),str):
                yield value['reference'],path+'/reference'
            for key,child in value.items():
                pointer=path+'/'+str(key)
                if parameters and key in ('source','geometry_source') and isinstance(child,str):
                    yield child,pointer
                else:yield from visit(child,pointer,parameters or key=='parameters')
        elif isinstance(value,list):
            for index,child in enumerate(value):yield from visit(child,path+'/'+str(index),parameters)
    yield from visit(observations)


def quantity_facts(observations):
    """Keep field identity and JSON source paths, never treat numeric metadata as quantities."""
    facts=[]
    def visit(item,path,identity):
        if isinstance(item,dict):
            if item.get('projection') in METADATA_PROJECTIONS:return
            if item.get('projection') in ('platform_read','draft_geometry'):
                visit(item.get('evidence',{}),path+'/evidence',identity);return
            if item.get('kind')=='validation' and item.get('subtype')=='reproduced' and item.get('validation'):
                from .validation_evidence import facts as validation_facts
                facts.extend(validation_facts(item,path))
            identity={**identity,**{key:item[key] for key in ('workspace_id','study_id','type_id','run_id','case_id','entity','condition','proposal_id') if item.get(key)}}
            if isinstance(item.get('case'),str) and not item.get('condition'):identity['condition']=item['case']
            key=item.get('key') or item.get('path') or item.get('label') or ''
            sources=[]
            if '/provenance/' in path and item.get('kind') and isinstance(item.get('reference'),str):
                sources.append((item['reference'],path+'/reference'))
            if '/parameters/' in path:
                sources.extend((item[field],path+'/'+field) for field in ('source','geometry_source')
                    if isinstance(item.get(field),str))
            for reference,source in sources:
                for match in QUANTITY.finditer(reference):
                    facts.append({'value':literal_number(match[1]),'unit':unit_name(match[2]),
                        'key':'source_reference','delta':False,'headline':False,'field':'reference',
                        'reference_only':True,'source':source+'/'+str(match.start()),**identity})
            declared_unit=item.get('unit')
            if not declared_unit and isinstance(item.get('quantity'),dict):declared_unit=item['quantity'].get('unit')
            for field,unit,headline in (('value',declared_unit,False),('display_value',item.get('display_unit'),True),
                                        ('before',item.get('unit'),False),('after',item.get('unit'),False)):
                value=item.get(field)
                if type(value) in (int,float) and math.isfinite(value) and unit and item.get('status')!='unavailable':
                    facts.append({'value':float(value),'unit':unit_name(unit),'key':key,'delta':is_delta(key),
                        'headline':headline or '/headlines/' in path,'field':field,'source':path+'/'+field,**identity})
            for name,child in item.items():visit(child,path+'/'+str(name),identity)
        elif isinstance(item,list):
            for index,child in enumerate(item):visit(child,path+'/'+str(index),identity)
    visit(observations,'observations',{})
    return facts


def converted(fact,target,*,delta=False):
    source=fact['unit'];value=fact['value']
    if source in ('K','°C') and target in ('K','°C'):
        if fact['delta']!=delta:return None
        return value if source==target or delta else value+(273.15 if target=='K' else -273.15)
    if source==target:return value
    scales={'m':('length',1.),'mm':('length',.001),'m²':('area',1.),'mm²':('area',1e-6),
            'V':('voltage',1.),'kV':('voltage',1000.),'A':('current',1.),'kA':('current',1000.),
            'Ω/m':('resistance',1.),'Ω/km':('resistance',.001)}
    if source in scales and target in scales and scales[source][0]==scales[target][0]:
        return value*scales[source][1]/scales[target][1]
    return None


def rounded_match(number,value):
    if value is None or not math.isfinite(value) or not math.isfinite(literal_number(number)):return False
    written=Decimal(str(number).replace(',',''));numeric=literal_number(number)
    if math.isclose(numeric,value,rel_tol=1e-10,abs_tol=1e-10):return True
    decimal=Decimal(str(value))
    # Preserve the literal token: 338.672 and 1.4832e2 both declare a precision.
    # Compare to a rounded source, never to a broad relative-error interval.
    places=[-written.as_tuple().exponent] if isinstance(number,str) else [1,2]
    if not isinstance(number,str) and value:places += [digits-1-decimal.copy_abs().adjusted() for digits in (3,4)]
    with localcontext() as context:
        context.prec=max(28,len(decimal.as_tuple().digits)+abs(decimal.adjusted())+max(places)+4)
        return any(math.isclose(numeric,float(decimal.quantize(Decimal(1).scaleb(-place),rounding=ROUND_HALF_UP)),
                               rel_tol=1e-10,abs_tol=1e-10) for place in places)


def reference_text(text):
    # Equal-length masking preserves audit offsets in the original draft; typographic hyphens
    # (YJV22‑8.7/15) are normalised first so designations are recognised.
    text=re.sub('[‐‑‒–—]','-',text)
    patterns=[r'(?<![A-Za-z0-9_])(?:IEC|GB(?:/T)?|TB(?:/T)?)\s*\d+(?:[-./]\d+)*(?:[:：]\d{4})?',
              r'(?<![A-Za-z0-9_])[A-Z]{2,}[A-Z0-9]*(?:-\d+(?:\.\d+)?(?:/\d+)?(?:\s+\d+[×x*]\d+)?|\s+\d+[×x*]\d+)(?![A-Za-z0-9_])',
              r'(?m)^\s*\d+[.)、](?=\s|[\u4e00-\u9fff])',
              r'(?<![A-Za-z0-9_])[0-9a-f]{8}-[0-9a-f-]{27,}(?![A-Za-z0-9_])',
              # Abbreviated run/proposal ids such as 72adf998 (hex with both letters and digits).
              r'(?<![A-Za-z0-9_.])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{6,}(?![A-Za-z0-9_.])',
              # List enumerators such as (2) or （2）.
              r'[（(]\d{1,2}[）)]']
    for pattern in patterns:text=re.sub(pattern,lambda match:' '*len(match[0]),text)
    # Model paths and entity ids (load~1steady/currents, cable/template2); unit strings such as
    # K·m/W carry no digits, tildes or underscores and stay visible.
    text=re.sub(r'(?<![A-Za-z0-9_·.])/?[A-Za-z_~][\w~.-]*(?:/[\w~.-]+)+',
                lambda match:' '*len(match[0]) if re.search(r'[\d~_]',match[0]) else match[0],text)
    text=re.sub(r'(?<![A-Za-z0-9_])[A-Za-z_][\w-]*~[\w~-]+',lambda match:' '*len(match[0]),text)
    return text


class Implied:
    """A number whose unit is written once after the following operand; behaves like a regex match."""
    def __init__(self,start,end,number,unit):self.span=(start,end);self.groups=(number+' '+unit,number,unit)
    def start(self):return self.span[0]
    def end(self):return self.span[1]
    def __getitem__(self,index):return self.groups[index]


def fact_entity(fact):
    """Entity of a fact: its own field, or the id encoded in its model path (circuit~1c1 -> circuit/c1)."""
    if fact.get('entity'):return fact['entity']
    for segment in str(fact.get('key') or '').split('/'):
        decoded=segment.replace('~1','/').replace('~0','~')
        if '/' in decoded:return decoded
    return None


def attributed(fact,named):
    """A clause naming entities only constrains facts of the same kind (cable, circuit…); limits and loads
    of other kinds stay usable."""
    entity=fact_entity(fact)
    if not named or entity is None:return True
    return entity in named or entity.split('/')[0] not in {name.split('/')[0] for name in named}


def grounded_text(text,observations,*,current=None,proposals=None,users=None,proof=None):
    """Check each claim; rejected drafts remain private audit data, never chat content."""
    def geometry_evidence(rows):
        return [{**row,'data':row['data'].get('evidence',{})} if row.get('data',{}).get('projection')=='draft_geometry' else row
                for row in rows]
    observations=geometry_evidence(observations)
    if current is not None:current=geometry_evidence(current)
    from .validation_evidence import issues as validation_issues
    from .claim_scope import ClaimScope
    facts=quantity_facts(observations);issues=validation_issues(text,current if current is not None else observations);matches=[]
    scope=ClaimScope(text,observations)
    from .validation_evidence import cards as validation_cards
    observed_validation={card['id']:card for card in validation_cards(observations)}
    def issue(match,code,rule,message,available=(),unit=None):
        issues.append({'code':code,'rule':rule,'fragment':text[match.start():match.end()],
            'start':match.start(),'end':match.end(),'value':(literal_number(match[1]) if math.isfinite(literal_number(match[1])) else match[1]) if code.startswith('UNGROUNDED') and re.fullmatch(NUMBER,match[1]) else None,
            'unit':unit,'message':message,'available_values':list(available)[:16]})
    for match in re.finditer(r'已(?:经)?(?:批准|发布|外发)|已(?:经)?(?:保存|写入)(?:到|进|至)?(?:当前)?工程|已(?:经)?(?:修改|更新)(?:当前)?工程|工程[^，。；\n]{0,12}已(?:经)?(?:修改|更新|保存)|已(?:经)?(?:将|把)[^，。；\n]{0,50}(?:保存|写入)(?:到|进|至)?(?:当前)?工程|合规认证通过',text):
        prefix=re.split(r'[，。；\n]',text[:match.start()])[-1][-24:]
        if re.search(r'未|没有|不能|不得|不应|不要|不可|禁止|不表示|不代表|不是|并非|非|不(?:改写|覆盖|替换|修改)',prefix+match[0][:-2]):continue
        issue(match,'UNSUPPORTED_OPERATION_CLAIM','actual_engineering_state','没有工程保存、批准或发布证据；方案与试算不能描述为实际工程状态。')
    if re.search(r'方案(?:已经|已)?(?:生成|创建|提出)',text) and not proposals and not any(item.get('data',{}).get('proposal') for item in (current or observations)):
        match=re.search(r'方案(?:已经|已)?(?:生成|创建|提出)',text)
        issue(match,'UNSUPPORTED_OPERATION_CLAIM','proposal_receipt','没有生成方案的工具回执。')
    clean=reference_text(text).replace('−','-')
    # Exact names from cards, study lists and saved metric variants are identities
    # even without quotes. Mask only the observed span, not its numeric values.
    def names(item,path='observations',inherited=False):
        if isinstance(item,dict):
            if item.get('projection') in METADATA_PROJECTIONS:return
            identity=inherited or any(key in item for key in ('id','study_id','workspace_id','plugin_id','asset_id'))
            for field in ('name','title','variant'):
                name=item.get(field)
                if not identity or not isinstance(name,str) or not name:continue
                for match in re.finditer(re.escape(name),text):
                    yield match.start(),match.end(),path+'/'+field
                # A compact list may repeat only the core specification (3×35).
                # These exact tokens still need to occur in an observed name.
                if field=='name':
                    for token in re.findall(r'\d+[×x*]\d+',name):
                        for match in re.finditer(r'(?<![\w×x*])'+re.escape(token)+r'(?![\w×x*])',text):
                            yield match.start(),match.end(),path+'/'+field
            for key,child in item.items():yield from names(child,path+'/'+str(key),identity)
        elif isinstance(item,list):
            for index,child in enumerate(item):yield from names(child,path+'/'+str(index),inherited)
    for start,end,source in names(observations):
        clean=clean[:start]+' '*(end-start)+clean[end:]
        quoted=start>0 and end<len(text) and (text[start-1],text[end]) in (('“','”'),('「','」'),('《','》'),('`','`'))
        matches.append({'fragment':text[start:end],'rule':'quoted_object_name' if quoted else 'evidence_object_name','sources':[source]})
    def versions(value,path='observations'):
        if isinstance(value,dict):
            if value.get('projection') in METADATA_PROJECTIONS:return
            identified=any(key in value for key in ('id','plugin_id','asset_id','method_id'))
            for field in ('version','plugin_version','method_version'):
                version=value.get(field)
                if isinstance(version,str) and (identified or field!='version') and re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][\w.-]+)?',version):
                    yield version,path+'/'+field
            for key,child in value.items():yield from versions(child,path+'/'+str(key))
        elif isinstance(value,list):
            for index,child in enumerate(value):yield from versions(child,path+'/'+str(index))
    for version,source in versions(observations):
        for match in re.finditer(r'(?<![\w.])'+re.escape(version)+r'(?![\w.])',text):
            clean=clean[:match.start()]+' '*(match.end()-match.start())+clean[match.end():]
            matches.append({'fragment':match[0],'rule':'saved_method_version','sources':[source]})
    def locators(value,path='observations'):
        if isinstance(value,dict):
            if value.get('projection') in METADATA_PROJECTIONS:return
            if isinstance(value.get('standard'),str):
                for key in ('clause','table','locator'):
                    locator=value.get(key)
                    if isinstance(locator,str) and locator:yield locator,path+'/'+key
            for key,child in value.items():yield from locators(child,path+'/'+str(key))
        elif isinstance(value,list):
            for index,child in enumerate(value):yield from locators(child,path+'/'+str(index))
    for locator,source in locators(observations):
        for match in re.finditer(r'(?<![\d.])'+re.escape(locator)+r'(?![\d.])',text):
            if any(q.start()<=match.start()<q.end() for q in QUANTITY.finditer(text)):continue
            if not (re.search(r'第\s*$|条款\s*$|条文\s*$|附录\s*$|§\s*$',text[max(0,match.start()-12):match.start()]) or
                    re.match(r'\s*(?:条|节|款|项)',text[match.end():]) or locator.startswith(('表','图'))):continue
            clean=clean[:match.start()]+' '*(match.end()-match.start())+clean[match.end():]
            matches.append({'fragment':match[0],'rule':'saved_standard_locator','sources':[source]})
    references=list(declared_references(observations))
    for reference,source in references:
        # Preserve exact source phrases (e.g. a manufacturer's table name).
        # This only masks text actually present in a saved declaration.
        for phrase in re.split(r'[，。；：;\n]',reference):
            if len(phrase)<6:continue
            pattern=r'\s*'.join(re.escape(char) for char in phrase if not char.isspace())
            for match in re.finditer(pattern,text):
                clean=clean[:match.start()]+' '*(match.end()-match.start())+clean[match.end():]
                matches.append({'fragment':match[0],'rule':'saved_source_quote','sources':[source]})
    for year,source in ((year,source) for reference,source in references
                        for year in re.findall(r'(?<!\d)(?:19|20)\d{2}(?!\d)',reference)):
        for match in re.finditer(r'(?<![\d.])'+year+r'(?![\d.])',text):
            if any(q.start()<=match.start()<q.end() for q in QUANTITY.finditer(text)):continue
            clean=clean[:match.start()]+' '*(match.end()-match.start())+clean[match.end():]
            matches.append({'fragment':year,'rule':'saved_source_year','sources':[source]})
    # Saved validation method versions are identities, not computed quantities.
    # Mask only exact observed version strings; unknown versions remain checked.
    for card in observed_validation.values():
        for run in (card.get('validation') or {}).get('runs',[]):
            for field in ('plugin_version','method_version'):
                version=run.get(field)
                if not isinstance(version,str) or not version:continue
                for match in re.finditer(r'(?<![\w.])'+re.escape(version)+r'(?![\w.])',text):
                    clean=clean[:match.start()]+' '*(match.end()-match.start())+clean[match.end():]
                    matches.append({'fragment':match[0],'rule':'saved_validation_method_version',
                        'sources':[card['validation']['snapshot_digest']+'/'+card['id']+'/runs/'+field]})
    def sentence(position):
        start=max(clean.rfind(mark,0,position) for mark in '。；;\n')+1
        ends=[found for found in (clean.find(mark,position) for mark in '。；;\n') if found>=0]
        return start,min(ends) if ends else len(clean)
    def validation_attributed(fact,position):
        if not fact.get('validation_id'):return True
        start,end=sentence(position)
        named={card['id'] for card in observed_validation.values() if card['name'] in text[start:end] or card['id'] in text[start:end]}
        return not named or fact['validation_id'] in named
    # The change of one quantity between two evidence records (saved run vs preview, proposal before/after):
    # same key, entity, condition and unit but different sources. It may be cited anywhere ("上升 12.6 K",
    # "下降 20.6 A", "+20%"); differences across unrelated quantities still need operands in their sentence.
    # Entity ids are masked in `clean` (they contain digits); attribution reads the original clause.
    def entities_named(position):
        clause=re.split(r'[，。；\n]',text[:position])[-1][-40:]
        return {row['entity'] for row in facts if row.get('entity') and row['entity'] in clause}
    changes={}
    for fact in facts:changes.setdefault((fact['key'],fact.get('entity'),fact.get('condition'),fact['unit']),[]).append(fact)
    def evidence_change(match,unit):
        number,fragment=match[1],match[0]
        clause=re.split(r'[，。；\n]',clean[:match.start()])[-1][-40:]
        for rows in changes.values():
            for i,first in enumerate(rows):
                for second in rows[i+1:]:
                    if first.get('reference_only') or second.get('reference_only'):continue
                    if not scope.matches(first,match.start()) or not scope.matches(second,match.start()):continue
                    if first.get('study_id') and second.get('study_id') and first['study_id']!=second['study_id']:continue
                    if not validation_attributed(first,match.start()) or not validation_attributed(second,match.start()):continue
                    if first['source']==second['source'] or math.isclose(first['value'],second['value']):continue
                    a,b=first['value'],second['value']
                    if unit=='%':options=[(b-a)/a*100,(a-b)/a*100,(a-b)/b*100,(b-a)/b*100] if a and b else []
                    else:options=[converted({'value':b-a,'unit':first['unit'],'delta':True},unit,delta=True),
                                  converted({'value':a-b,'unit':first['unit'],'delta':True},unit,delta=True)]
                    if any(value is not None and rounded_match(number,value) for value in options):
                        return {'fragment':fragment,'rule':'evidence_change','sources':[first['source'],second['source']]}
        # Temperature margin = limit − conductor temperature, signed; a negative margin may be stated as a
        # positive exceedance ("超温 29.6 K"). A cable named in the clause must be the one whose temperature is used.
        if unit in ('K','°C'):
            named=entities_named(match.start())
            exceedance=re.search(r'超|高出|不足|欠',clause) and not match[1].startswith('+')
            limits=[fact for fact in facts if re.search(r'max_conductor_temperature|temperature_limit',str(fact['key'])) and not fact['delta'] and not fact.get('reference_only')]
            temperatures=[fact for fact in facts if fact['key']=='conductor_temperature' and not fact['delta']
                          and attributed(fact,named) and scope.matches(fact,match.start())]
            for limit in limits:
                if not scope.matches(limit,match.start()):continue
                for temperature in temperatures:
                    a=converted(limit,'K');b=converted(temperature,'K')
                    if a is None or b is None:continue
                    if rounded_match(number,a-b) or (exceedance and a<b and rounded_match(number,b-a)):
                        return {'fragment':fragment,'rule':'temperature_margin','sources':[limit['source'],temperature['source']]}
        return None
    for match in re.finditer(r'([零〇一二两三四五六七八九十百千万点]+)\s*(安培|伏特|米|摄氏度|A\b|K\b|V\b|℃|°C)',clean):
        issue(match,'UNGROUNDED_QUANTITY','numeric_notation','工程量用证据中的阿拉伯数字和单位引用。',unit=match[2])
    known=numbers(observations);counts=evidence_counts(observations);covered=[];anchors=[];pending=[]
    user_facts=[]
    for user in users or []:
        known.update(literal_number(match[0]) for match in re.finditer(r'(?<![A-Za-z0-9_/.:-])'+NUMBER+r'(?![A-Za-z0-9_/])',reference_text(user))
                     if math.isfinite(literal_number(match[0])))
        for match in QUANTITY.finditer(reference_text(user)):
            user_facts.append({'value':literal_number(match[1]),'unit':unit_name(match[2]),'key':'user_input','delta':False,
                'headline':False,'source':'user_message','field':'value'})
    quantities=list(QUANTITY.finditer(clean))
    # "362.2 → 341.6 A", "119.61 − 106.98 °C": the first operand borrows the unit written after the second.
    for match in list(quantities):
        offset=max(0,match.start()-24)
        lead=re.search(r'(?<![A-Za-z0-9_/.:-])('+NUMBER+r')\s*(?:→|->|-|–|—|~|～|至|到)\s*$',clean[offset:match.start()])
        if lead:quantities.append(Implied(offset+lead.start(1),offset+lead.end(1),lead[1],match[2]))
        # Explicit engineering lists can share the unit at their end: insulation
        # 3.5、buffer 5.88、PE 3.5 K·m/W. Check each value against that unit, rather
        # than accepting it as unrelated numeric metadata.
        start=max(clean.rfind(mark,0,match.start()) for mark in '。；;\n，,')+1
        segment=clean[start:match.start()]
        if re.search(r'热阻率|厚度|温度|电流|长度|埋深|截面',segment) and '、' in segment:
            for token in re.finditer(r'(?<![A-Za-z0-9_/.:-])('+NUMBER+r')(?=\s*、)',segment):
                position=start+token.start()
                if not any(q.start()<=position<q.end() for q in quantities):
                    quantities.append(Implied(position,start+token.end(),token[1],match[2]))
    quantities.sort(key=lambda item:item.start())
    for match in quantities:
        number=match[1];unit=unit_name(match[2]);covered.append((match.start(),match.end()))
        clause=re.split(r'[，。；\n]',clean[:match.start()])[-1][-40:]
        delta=delta_context(clause,unit)
        named_entities=entities_named(match.start())
        candidates=[]
        # A negative margin may be stated as a positive exceedance ("超温 17.0 K"); never as headroom
        # ("余量 +17 K"), so only exceedance wording, an unsigned number and a negative fact qualify.
        exceedance=re.search(r'超|高出|不足|欠',clause) and not match[1].startswith('+')
        for fact in facts+user_facts:
            if fact.get('reference_only'):
                start,end=sentence(match.start())
                if not re.search(r'参考|来源|原表|文献|规格书|引用|工程师|声明|表中',text[start:end]):continue
            value=converted(fact,unit,delta=delta)
            if not rounded_match(number,value) and not (fact['delta'] and exceedance and value is not None and value<0 and rounded_match(number,-value)):continue
            if not attributed(fact,named_entities):continue
            if not scope.matches(fact,match.start()):continue
            if not validation_attributed(fact,match.start()):continue
            if unit=='A' and re.search(r'(?:载流量|电流)\s*(?:余量|裕度)[^0-9]{0,12}$',clause):
                # Load/capacity are operands, not an already reported headroom.
                # Leave the explicit two-source derivation to the pending pass.
                if fact['key']!='current_margin':continue
            # Only a current introduced directly by 允许电流/载流量 must be an ampacity ("允许电流 362.2 A（低于 400 A）").
            if unit=='A' and re.search(r'(?:允许电流|载流量)(?!\s*(?:余量|裕度|差|变化))[^0-9]{0,12}$',clause):
                if fact['key'] not in ('ampacity','x-cablesim.emergency-current'):continue
                if '推荐' in clause and not fact['headline']:continue
                if re.search(r'同时额定|共同允许电流',clause) and fact.get('condition')!='rating-simultaneous':continue
            candidates.append(fact)
        if candidates:
            anchors.append((match,candidates));matches.append({'fragment':match[0],'rule':'quantity','sources':[fact['source'] for fact in candidates[:8]]})
        else:pending.append((match,unit,delta))
    verified_derivations=[]
    for match,unit,delta in pending:
        # Prefer this sentence's operands. Across sentences, use a paragraph only
        # when it cites exactly two distinct quantities; competing operands are
        # ambiguous and must be rewritten with the explicit pair.
        paragraph_start,paragraph_end=sentence(match.start())
        nearby=[(anchor,candidates) for anchor,candidates in anchors if paragraph_start<=anchor.start()<paragraph_end]
        if len(nearby)<2:
            start=clean.rfind('\n\n',0,match.start())+2
            if start==1:start=0
            end=clean.find('\n\n',match.end())
            if end<0:end=len(clean)
            pairs={}
            for anchor,candidates in anchors:
                if start<=anchor.start()<end:
                    pairs.setdefault((literal_number(anchor[1]),unit_name(anchor[2])),(anchor,candidates))
            if len(pairs)==2:
                nearby=list(pairs.values());paragraph_start,paragraph_end=start,end
        derived=next(({'fragment':match[0],'rule':'repeated_derivation','sources':sources}
            for value,dimension,sources in verified_derivations if dimension==unit and rounded_match(match[1],value)
            and all(scope.matches(fact,match.start()) and attributed(fact,entities_named(match.start()))
                for fact in facts if fact['source'] in sources)),None)
        for i,(left,left_facts) in enumerate(nearby):
            for right,right_facts in nearby[i+1:]:
                for first in left_facts:
                    for second in right_facts:
                        # User settings cannot manufacture computed conclusions; quantities must share dimensions.
                        if first['source']=='user_message' or second['source']=='user_message':continue
                        if first.get('reference_only') or second.get('reference_only'):continue
                        # Same dimension is required (checked by conversion below); both operands sit in this sentence,
                        # so comparing load with capacity or two rating bases is explicit.
                        base=unit_name(left[2])
                        a=converted(first,base,delta=first['delta']);b=converted(second,base,delta=first['delta'])
                        if a is None or b is None:continue
                        context=clean[max(paragraph_start,match.start()-32):match.end()+8]
                        # Percentages: share or change in either direction; the value written must agree.
                        if unit=='%' and a and b:
                            options=[(b/a*100,'percentage'),((b-a)/a*100,'percent_change'),((a-b)/a*100,'percent_decrease'),
                                     ((a-b)/b*100,'percent_change'),((b-a)/b*100,'percent_decrease')]
                        elif unit in ('倍','1') and re.search(r'比值|倍',context) and a:options=[(b/a,'ratio')]
                        elif re.search(r'差|相减|余量|超出|超过|提高|增加|降低|减少|变化|升高|上升|下降|增大|减小|升幅|降幅|[+＋]',context):
                            difference={'value':b-a,'unit':base,'delta':base in ('K','°C')}
                            # Either subtraction order; the sign written in the text must agree with it.
                            options=[(converted(difference,unit,delta=True),'difference'),
                                     (converted({**difference,'value':a-b},unit,delta=True),'difference')]
                        else:options=[]
                        for value,operation in options:
                            if rounded_match(match[1],value):derived={'fragment':match[0],'rule':operation,'sources':[first['source'],second['source']]};break
                        if derived:break
                    if derived:break
                if derived:break
            if derived:break
        if not derived:derived=evidence_change(match,unit)
        if derived:
            matches.append(derived)
            verified_derivations.append((literal_number(match[1]),unit,derived['sources']))
        else:
            available=[fact for fact in facts+user_facts if converted(fact,unit,delta=delta) is not None and scope.matches(fact,match.start())]
            issue(match,'UNGROUNDED_QUANTITY','quantity_source_or_derivation','数值须来自所引用对象的证据，符合舍入/单位换算，或在本段明确引用推导的两个证据值；其他研究或运行的同值不能替代。',available,unit)
    # A unitless number written right after two cited, verified quantities of one paragraph may be their
    # ratio or difference ("400 A / 362.2 A = 1.104"); 273.15 is the Kelvin offset used in conversions.
    def derived_bare(number,position):
        start,end=sentence(position)
        values=[literal_number(anchor[1]) for anchor,_ in anchors if start<=anchor.start()<end]
        return any(rounded_match(number,value) for a in values for b in values if a!=b and b
                   for value in (a/b,a-b))
    for match in re.finditer(r'(?<![A-Za-z0-9_/.:-])('+NUMBER+r')(?![A-Za-z0-9_/])',clean):
        if any(start<=match.start()<end for start,end in covered):continue
        number=match[1]
        if rounded_match(number,273.15) or derived_bare(number,match.start()):continue
        context=clean[max(0,match.start()-12):match.end()+12]
        count=bool(re.search(r'工况|回路|编号|序号',context))
        count_known=literal_number(number) in counts
        if not any(rounded_match(number,value) for value in known) and not (count and count_known) and not any(rounded_match(number,f['value']) for f in user_facts):
            issue(match,'UNGROUNDED_NUMBER','bare_number','没有对应输入、工具字段或实际工况/回路计数。')
    for match in re.finditer(r'(?<![A-Za-z0-9_/.:-])('+NUMBER+r')\s*([A-Za-zΩ°℃μ]+(?:[/·][A-Za-zΩμ²³]+)*)',clean):
        if not any(start<=match.start()<end for start,end in covered):
            issue(match,'UNGROUNDED_QUANTITY','unsupported_unit','此数值的单位未取得可核验的字段证据。',unit=match[2])
    if proof is not None:proof.extend(matches)
    if issues:raise HTTPException(422,{'code':issues[0]['code'],'message':issues[0]['message'],'issues':issues})
    return text


def evidence_counts(observations):
    counts=set()
    def visit(item):
        if isinstance(item,dict):
            if item.get('projection') in METADATA_PROJECTIONS:return
            if item.get('projection') in ('platform_read','draft_geometry'):
                visit(item.get('evidence',{}));return
            for key,value in item.items():
                if key in ('cases','circuits','load_cases') and isinstance(value,list):counts.update(range(1,len(value)+1))
                if key in ('case_id','entity','id') and isinstance(value,str) and (key=='case_id' or re.match(r'(?:circuit|cable|load_case)[/-]',value)):
                    counts.update(int(token) for token in re.findall(r'\d+',value))
                visit(value)
        elif isinstance(item,list):
            for child in item:visit(child)
    visit(observations)
    return counts


def evidence_summary(record):
    """A host explanation of durable tool evidence, with no new physical result."""
    lines=['以下为工具证据摘要，模型解释未通过核验。'];refs=[];saved={};trials=[]
    labels={'ampacity':'允许电流','conductor_temperature':'最高导体温度','temperature_margin':'温限余量'}
    def display(value,unit):return f'{value:.4g} {unit}'
    def conclusions(data):
        facts=quantity_facts([{'data':data}]);selected={}
        for key in labels:
            candidates=[fact for fact in facts if fact['key']==key and fact['field'] in ('value','display_value')]
            if not candidates:continue
            if key=='conductor_temperature':
                candidates=[fact for fact in candidates if fact.get('condition') in ('operating',None)]
                candidates=[fact for fact in candidates if converted(fact,'°C') is not None]
                if candidates:selected[key]={**max(candidates,key=lambda fact:converted(fact,'°C')),'value':max(converted(fact,'°C') for fact in candidates),'unit':'°C'}
            else:
                preferred=[fact for fact in candidates if fact['headline']]
                selected[key]=min(candidates,key=lambda fact:fact['value']) if key=='temperature_margin' else (preferred or candidates)[0]
        return selected
    def describe(data,name,identity):
        values=conclusions(data);parts=[]
        for key in ('ampacity','conductor_temperature','temperature_margin'):
            if key in values:
                fact=values[key];parts.append(labels[key]+' '+display(fact['value'],fact['unit'])+(f'（{fact["entity"]}）' if fact.get('entity') else ''))
                refs.append({'identity':identity,'source':fact['source'],'key':key})
            elif key=='ampacity':
                import json
                parts.append('无正允许电流' if 'NO_POSITIVE_RATING' in json.dumps(data) else '允许电流未返回')
            else:parts.append(labels[key]+'未返回')
        factors=[factor for case in data.get('cases',[]) for factor in case.get('factors',[]) if factor.get('key') in ('limiting_cable','hottest_cable')]
        parts.extend(('限制对象' if factor['key']=='limiting_cable' else '最热导体')+' '+factor['entity'] for factor in factors)
        if not factors:parts.append('插件未明确返回限制对象')
        conditions={fact.get('condition') for fact in values.values()}
        if 'rating-simultaneous' in conditions:parts.append('口径：同时额定（共同允许电流）')
        elif conditions:parts.append('口径：'+', '.join(sorted(value for value in conditions if value)))
        if data.get('freshness') and data['freshness']!='current':parts.append('历史保存结果：'+data['freshness'])
        lines.append(name+'（'+identity+'）：'+'；'.join(parts)+'。')
        return values
    for step in record['steps']:
        result=step.get('result') or {};data=result.get('data') or {};reference=result.get('execution_ref') or {}
        if data.get('run_id') and 'cases' in data:
            saved[data['run_id']]=data
        for study in data.get('studies',[]):
            latest=study.get('latest_run') or {}
            if latest.get('run_id') and ('cases' in latest or latest.get('headlines')):
                saved[latest['run_id']]={**latest,'cases':latest.get('cases',[])}
        if data.get('preview') and data.get('cases'):trials.append((data,reference))
    for rid,data in saved.items():
        if len(data['cases'])>1 and not data.get('headlines'):
            for case in data['cases']:
                describe({**data,'cases':[case],'assessment':[row for row in data.get('assessment',[]) if row.get('case_id')==case['case_id']]},
                    '保存结果工况 '+case['case_id'],rid)
        else:describe(data,'保存结果',rid)
    for proposal in record['proposals']:
        changes=[]
        for change in proposal.get('changes',[]):
            unit=change.get('unit','');before=change.get('before');after=change.get('after')
            def field_value(value):return display(value,unit) if type(value) in (int,float) else str(value)
            changes.append((change.get('label') or change.get('path','字段'))+'：'+field_value(before)+' → '+field_value(after))
            refs.append({'proposal_id':proposal['id'],'path':change.get('path'),'field':'before/after'})
        lines.append('方案（'+proposal['id']+'，'+proposal['status']+'）：'+('；'.join(changes) or proposal.get('title','无字段差异'))+'。')
    for data,reference in trials:
        identity=reference.get('execution_id','快速预览');after=describe(data,'试算（未保存运行、未批准）',identity)
        original=saved.get(data.get('source_run_id'))
        if original and data.get('source_case_id'):
            original={**original,'cases':[case for case in original['cases'] if case['case_id']==data['source_case_id']],
                'headlines':[fact for fact in original.get('headlines',[]) if fact.get('case_id')==data['source_case_id']]}
            before=conclusions(original);changes=[]
            for key in ('ampacity','conductor_temperature'):
                a=before.get(key);b=after.get(key)
                if not a or not b or a.get('condition')!=b.get('condition') or (key!='conductor_temperature' and a.get('entity')!=b.get('entity')):continue
                previous=converted(a,b['unit'],delta=b['delta'])
                if previous is None:continue
                changes.append(labels[key]+' '+display(previous,b['unit'])+' → '+display(b['value'],b['unit'])+'，变化 '+display(b['value']-previous,b['unit']))
                refs.append({'operation':'difference','sources':[{'run_id':data['source_run_id'],'source':a['source']},{'execution_id':identity,'source':b['source']}]})
            if changes:lines.append('同一原工况前后对比：'+'；'.join(changes)+'。')
            else:lines.append('试算与原运行未返回可直接比较的同口径量值。')
        else:lines.append('试算未绑定已读取的原运行/工况，未推算前后差值。')
    from .validation_evidence import summary as validation_summary
    validation_lines,validation_refs=validation_summary([step.get('result') for step in record['steps']])
    lines.extend(validation_lines);refs.extend(validation_refs)
    if len(lines)==1:lines.append('尚未取得保存研究结论、字段方案、试算或公开复现证据。')
    for step in record['steps']:
        result=step.get('result') or {}
        if result.get('status')=='error':
            lines.extend('工具诊断 '+str(item.get('code'))+'：'+str(item.get('message')) for item in result.get('diagnostics',[])[:2])
    lines.append('方案等待人工决定；试算不等于保存结果或工程批准。' if any(p['status']=='pending' for p in record['proposals']) else '工程批准状态：未由本会话确认。')
    return '\n'.join(lines),refs


def reconcile(research,tasks,tid,*,persist=False):
    """Query original Run references; an unknown ephemeral preview is never resubmitted."""
    record=tasks.record(tid,model_context=True);unresolved=[];resolved=[]
    for step in record['steps']:
        if step['state']!='unknown':continue
        reference=step.get('execution_ref') or {}
        if not reference.get('run_id') and step['tool']=='run_read':reference=step.get('input_identity') or {}
        if reference.get('run_id'):
            try:
                run=research.get_run(record['workspace_id'],reference['run_id'])
                if run['study']!=step.get('study_id') or run['integrity']!='verified':raise HTTPException(409,'原运行归属或完整性未通过。')
                if run['status'] in ('succeeded','partial','failed','interrupted'):
                    from .contracts import ToolResult
                    data=run_points(research,run,step['arguments'].get('case_id'))
                    refs=data.pop('artifact_refs')
                    result=ToolResult(status='ok',summary='已对账并读取原运行状态；未重新执行。',
                        data=data,artifact_refs=refs,execution_ref={'run_id':run['id'],'study_id':run['study'],'status':run['status']}).model_dump(mode='json')
                    if persist:tasks.reconcile_step(tid,step['operation_id'],result)
                    resolved.append({'operation_id':step['operation_id'],'run_id':run['id'],'status':run['status']})
                    continue
            except HTTPException:pass
        unresolved.append({'operation_id':step['operation_id'],'tool':step['tool'],'reason':'无法确认原步骤结果；没有重新执行。'})
    return {'resolved':resolved,'unknown':unresolved,'reissued':False}
