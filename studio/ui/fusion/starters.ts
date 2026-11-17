// Starting tasks use the platform's objects and approval flow. Missing engineering data is requested explicitly.
export interface Starter { icon: string; title: string; result: string; prompt: string }

export const STARTERS: { label: string; icon: string; tasks: Starter[] }[] = [
  {
    label: '载流量研究', icon: 'object/study', tasks: [
      { icon: 'calc/ampacity', title: '查看研究结论', result: '保存的结果、来源与适用限制',
        prompt: '读取当前研究的结论和限制，给出保存运行的载流量结果卡；没有指定研究时先列出已有研究让我选择。' },
      { icon: 'object/study', title: '新建直埋校核', result: '核对输入，批准后计算并出计算书',
        prompt: '给当前工程建一项直埋单回校核，负荷 600 A，算出来并导出计算书。先核对工程、型号、敷设与方法；没有指定工程或必需输入不足时向我确认。每步写入先提交提案。' },
      { icon: 'action/compare', title: '改条件、重算并对比', result: '保留原运行，逐项比较变化',
        prompt: '将当前工程土壤热阻率改为 1.2 K·m/W，重新计算并和修改前保存的运行对比。先读取真实输入与基准运行，缺项时停止；改动和运行都由我逐项接受。' },
    ],
  },
  {
    label: '电缆型号', icon: 'resource/cable-type', tasks: [
      { icon: 'resource/cable-type', title: '查看结构和主要参数', result: '准确版本、分层尺寸及缺项',
        prompt: '读取当前型号的结构和主要参数，说明来源、版本和缺项；没有指定型号时先查找已有型号让我选择。' },
      { icon: 'module/standard-check', title: '改结构并出规格书', result: '核对结构改动，生成内部规格书',
        prompt: '把当前型号的绝缘厚度改成 4.5 mm，重新核对并出规格书。先读取型号和当前结构，确认要改的层及来源，每步写操作先提交待审卡；缺数据或没有标准核对能力时明确拒绝。' },
      { icon: 'agent/attach', title: '导入厂家结构表', result: '先检查导入接口、格式与来源',
        prompt: '我想把厂家结构表导入型号库并核对。先检查结构表导入能力是否已接入；未接入时明确说明缺少的接口和工作台替代入口，不要假装已经接收文件。支持时先核对格式、单位、来源和逐行缺项，再提交待审提案。' },
    ],
  },
];

export const ALL_STARTERS = STARTERS.flatMap(group => group.tasks);
