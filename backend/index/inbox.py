"""One pending item per category/origin/object, directly from persisted states."""
from .service import ACTIVE


def build(index):
    seen={(item['category'],item['origin'],item['object']['kind'],item['object']['id']) for item in index.todos}
    def add(category,origin,card,reason,created=None):
        key=(category,origin,card['kind'],card['id'])
        if key in seen:return
        seen.add(key);index.todos.append({'category':category,'origin':origin,'title':card['name'],
            'object':card,'reason':reason,'created':created or card['updated']})

    for card in index.cards.values():
        kind=card['kind'];status=card['status']['code']
        if not index.relates((kind,card['id'])):continue
        if kind=='study':
            if status=='outdated':add('stale','study',card,card['status']['reason'])
            elif status=='running':add('running','study',card,'研究运行仍在进行中；此列表不刷新远端作业。')
        elif kind=='proposal' and status in ('pending','proposed'):
            origin='agent' if card['source']['kind']=='agent' else 'document'
            add('review',origin,card,'方案等待人工核对与批准。')
        elif kind=='asset' and status in ('draft','reviewed'):
            add('review','asset',card,'资源草稿待核对。' if status=='draft' else '资源已核对，等待人工发布。')
        elif kind=='cable_version' and status=='incomplete':
            add('missing','document',card,card['status']['reason'] or '型号资料缺项，需在资料工作台补齐，不能据此计算。')
        elif kind=='job' and status in ACTIVE:
            add('running','job',card,'已保存的作业回执显示仍在进行中；请在作业工作台查看。')
        elif kind=='run' and card.get('source',{} ) and card['source']['kind']=='study' and status in ACTIVE:
            add('running','study',card,'批量数据集仍在进行中。')
    for row in index.raw['submissions']:
        if not index.relates(('delivery',row['id'])):continue
        if row['status'] not in ('submitted','approved'):continue
        design=index.workspace(row['workspace']);revision=index.workspaces[row['workspace']]['revision']
        reason='型号规格书等待人工审核。' if row['status']=='submitted' else '型号规格书已批准，等待人工发布。'
        if revision!=row['revision']:reason+='设计输入已变化，需重新提交。'
        add('review','type',index.get('delivery',row['id']),reason,row['created'])
    # Extraction failures are missing evidence, never fabricated model results.
    for row in index.raw['extractions']:
        if not index.relates(('document',row['document'])):continue
        document=index.get('document',row['document'])
        if document is None:continue
        if row['status'] in ('failed','interrupted'):
            add('missing','document',document,row['error'] or '资料提取未完成，请核对原件后重新提取。',row['created'])
        elif row['status'] in ACTIVE:add('running','document',document,'厂家资料提取仍在进行中。',row['created'])
