export const typeModules = [
  { id: 'structure', label: '结构设计', icon: 'module/structure', tabs: [['section', '截面'], ['three', '三维剥切'], ['table', '分层表'], ['quantities', '外径与用料']] },
  { id: 'requirements', label: '要求与标准', icon: 'module/standard-check', tabs: [['list', '要求清单'], ['standards', '执行标准'], ['pending', '待批准导入']] },
  { id: 'standard-check', label: '标准核对', icon: 'module/standard-check', tabs: [['results', '标准核对']] },
  { id: 'electrical', label: '电气参数', icon: 'module/electrical', tabs: [['results', '结果'], ['parameters', '方法参数']] },
  { id: 'short-circuit', label: '短路容量', icon: 'module/short-circuit', tabs: [['results', '结果'], ['parameters', '方法参数']] },
  { id: 'rating-table', label: '载流量表', icon: 'module/rating-table', tabs: [['results', '结果表'], ['parameters', '方法参数']] },
  { id: 'comparison', label: '方案对比', icon: 'module/method-compare', tabs: [['matrix', '结果矩阵'], ['parameters', '参数差异'], ['geometry', '截面对比']] },
  { id: 'specification', label: '规格书', icon: 'module/datasheet', tabs: [['content', '内容'], ['preview', '预览'], ['review', '审核与发布'], ['revisions', '修订记录']] },
] as const;
