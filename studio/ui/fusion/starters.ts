// The tasks an empty conversation offers. The Agent can read the platform for now, so each task is a question about what is saved: a
// study's conclusion and what limits it, a cable type's structure, what the library holds. A click sends the prompt as it is.
export interface Starter { icon: string; title: string; result: string; prompt: string }

export const STARTERS: { label: string; icon: string; tasks: Starter[] }[] = [
  {
    label: '读一读已有的结果',
    icon: 'object/study',
    tasks: [
      { icon: 'calc/ampacity', title: '一项研究的结论是什么', result: '允许电流，哪根电缆先到温限',
        prompt: '城南线路 110 kV 直埋单回校核这项研究的结论是什么？受什么限制？' },
      { icon: 'resource/cable-type', title: '库里一款电缆的结构和主要参数', result: '各层尺寸、来源、还缺什么',
        prompt: '库里 YJV22-8.7/15 kV 3×300 的结构和主要参数是什么？' },
      { icon: 'object/folder', title: '有哪些工程', result: '名称、研究数量和状态', prompt: '列出现有的工程，各有几项研究，哪些研究的结果已过期。' },
    ],
  },
];

export const ALL_STARTERS = STARTERS.flatMap(group => group.tasks);
