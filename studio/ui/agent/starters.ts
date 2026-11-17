// The tasks an empty conversation offers: real work, grouped by the two things the product does. A click sends the prompt as it is;
// the title and the result are what the engineer reads before clicking.
export interface Starter { icon: string; title: string; result: string; prompt: string }

export const STARTERS: { label: string; icon: string; tasks: Starter[] }[] = [
  {
    label: '电缆型号', icon: 'nav/cable-type',
    tasks: [
      { icon: 'action/import', title: '导入公开结构表示例并核对', result: '算参数，按国标列出不通过项', prompt: '导入公开结构表示例，算参数并按国标核对，列出不通过项。' },
      { icon: 'module/standard-check', title: '按标准生成一款的初始结构', result: '尺寸带标准条款，补齐后建草稿',
        prompt: '按 GB/T 12706.2-2020 生成一款 8.7/15 kV 三芯 240 mm² 铜芯 XLPE 钢带铠装电缆的初始结构，再建成草稿规格。' },
      { icon: 'object/file', title: '导出一份规格书', result: '挑一个规格，生成 PDF', prompt: '挑一个规格，导出一份规格书。' },
      { icon: 'tool/view-3d', title: '建一个电缆三维结构模型', result: '看清每一层', prompt: '挑一个三芯铠装规格，建三维结构模型，让我看各层。' },
    ],
  },
  {
    label: '载流量计算', icon: 'calc/ampacity',
    tasks: [
      { icon: 'calc/ampacity', title: '算一款型号的直埋载流量', result: '说明哪根电缆先到温限', prompt: '选一款型号，直埋敷设，算载流量，说明哪根电缆先到温限。' },
      { icon: 'module/rating-table', title: '给一个规格算载流量表', result: '几种埋深和土壤热阻率下的允许电流',
        prompt: '挑一个三芯规格，直埋单回，环境温度 25 °C，算一张载流量表：埋深 1.0 m 和 1.5 m，土壤热阻率 1.0 和 2.0 K·m/W，四种组合各一条。' },
    ],
  },
];

export const ALL_STARTERS = STARTERS.flatMap(group => group.tasks);
