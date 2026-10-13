"""Evidence and claim boundaries for saved public reproductions."""
import math
import re


def cards(value):
    if isinstance(value,dict):
        if value.get('kind')=='validation' and value.get('subtype') in ('reproduced','declared') and 'status' in value:
            yield value
        for child in value.values():yield from cards(child)
    elif isinstance(value,list):
        for child in value:yield from cards(child)


def facts(card,path):
    evidence=card['validation']
    for i,row in enumerate(evidence['metrics']):
        key={'ampacity_a':'ampacity','conductor_max_temperature_k':'conductor_temperature'}.get(row['quantity'],row['quantity'])
        for field in ('reference','open_source','comsol','difference','relative_difference_percent'):
            value=row.get(field);unit='%' if field=='relative_difference_percent' else row.get('unit')
            if type(value) not in (int,float) or not math.isfinite(value) or not unit:continue
            yield {'value':float(value),'unit':unit,'key':('difference.' if field=='difference' else '')+key,
                'delta':field=='difference','headline':False,'field':field,
                'source':path+'/validation/metrics/'+str(i)+'/'+field,
                'validation_id':card['id'],'row_id':row['id'],'snapshot_digest':evidence['snapshot_digest']}
        tolerance=row.get('tolerance') or {}
        if type(tolerance.get('absolute')) in (int,float) and math.isfinite(tolerance['absolute']) and tolerance.get('unit'):
            yield {'value':float(tolerance['absolute']),'unit':tolerance['unit'],'key':'reproduction_tolerance',
                'delta':True,'headline':False,'field':'absolute','source':path+'/validation/metrics/'+str(i)+'/tolerance/absolute',
                'validation_id':card['id'],'row_id':row['id'],'snapshot_digest':evidence['snapshot_digest']}


def issues(text,observations):
    evidence={card['id']:card for card in cards(observations)}
    if not evidence:return []
    from .claim_scope import ClaimScope
    scope=ClaimScope(text,observations)
    errors=[]
    pattern=r'(?:已(?:经)?(?:全部|完全|充分|全面)?(?:通过(?:验证|复现)|(?:验证|复现)(?:通过|成功)?)|(?:全部|完全|充分|全面)?(?:验证(?:已)?通过|复现成功)|(?:均|都)通过(?:验证|复现)|(?:符合|满足|处于|在)[^，。；\n]{0,14}(?:CIGRE|报告|标准)[^，。；\n]{0,6}(?:容差|精度要求)|(?:偏差|误差)[^，。；\n]{0,12}(?:在|处于)[^，。；\n]{0,12}(?:门槛|容差)(?:之)?内|(?:收敛(?:检查|测试)?|网格收敛|扩域收敛)(?:已经|已)?(?:通过|达标))'
    for match in re.finditer(pattern,text):
        start=max(text.rfind(mark,0,match.start()) for mark in '。；\n')+1
        end=min([pos for pos in (text.find(mark,match.end()) for mark in '。；\n') if pos>=0] or [len(text)])
        sentence=text[start:end];prefix=text[start:match.start()]
        local=re.split(r'[，,:：]',prefix)[-1]
        if re.search(r'未|不能|不代表|不等于|不得|不是|并非|尚无|没有|不应|不算|不能称为',local[-32:]):continue
        named=[card for card in evidence.values() if card['name'] in sentence or card['id'] in sentence]
        referenced=scope.at(match.start()).get('validation_id',set())
        targets=named or [card for id,card in evidence.items() if id in referenced] or [card for card in evidence.values() if card.get('validation')] or list(evidence.values())
        # Convergence remains independent of overall reproduction success.
        tolerance_claim=bool(re.search(r'(?:CIGRE|报告|标准)[^，。；\n]{0,6}(?:容差|精度要求)',match[0]))
        convergence_claim=not tolerance_claim and ('收敛' in match[0] or bool(re.search(r'收敛(?:检查|测试|性)?[^，。；\n]{0,6}$',prefix)))
        invalid=[card for card in targets if card['status']['code']!='reproduced' or (card.get('validation') or {}).get('outside_tolerance')]
        if tolerance_claim:invalid=[card for card in targets if not (card.get('validation') or {}).get('report_tolerance') or card['validation']['outside_tolerance']]
        if convergence_claim:invalid=[card for card in targets if (card.get('validation') or {}).get('convergence_passed') is not True]
        if invalid:
            errors.append({'code':'UNSUPPORTED_VALIDATION_CLAIM','rule':'saved_reproduction_status',
                'fragment':match[0],'start':match.start(),'end':match.end(),'value':None,'unit':None,
                'message':'保存算例不是整体验证通过，或没有报告容差证据；须区分收敛、部分复现、偏差超限和工程批准。',
                'available_values':[{'validation_id':card['id'],'name':card['name'],'status':card['status'],
                    'outside_tolerance':(card.get('validation') or {}).get('outside_tolerance'),
                    'convergence_passed':(card.get('validation') or {}).get('convergence_passed'),
                    'snapshot_digest':(card.get('validation') or {}).get('snapshot_digest')} for card in invalid]})
    return errors


def summary(observations):
    rows={card['id']:card for card in cards(observations)};lines=[];refs=[]
    for card in rows.values():
        lines.append('“'+card['name']+'”：'+card['status']['label']+'；'+(card['status'].get('reason') or ''))
        evidence=card.get('validation')
        if not evidence:continue
        for metric in evidence['metrics']:
            percent=metric.get('relative_difference_percent')
            if percent is not None:lines.append(metric['variant']+'相对公布值偏差 '+format(percent,'.4g')+' %；结果状态：'+metric['status'])
        lines.append('来源：'+evidence['reference_location'])
        lines.extend(evidence['limitations'])
        if evidence.get('omitted_limitations'):lines.append(evidence['omission_note'])
        if evidence['total_metrics']>len(evidence['metrics']):lines.append('其余明细未展开，请在该验证对象查看保存原件。')
        refs.append({'validation_id':card['id'],'snapshot_digest':evidence['snapshot_digest']})
    return lines,refs
