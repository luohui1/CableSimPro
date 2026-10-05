/** Presentation-only navigation. Never register writes or calculations here. */
export const WORKBENCH_NAVIGATION = [
  { id: 'home', label: '首页', to: '/', icon: 'nav/home', description: '最近型号与研究', keywords: 'home overview dashboard gongzuotai', group: '工程工作区' },
  { id: 'types', label: '型号', to: '/types', icon: 'nav/cable-type', description: '结构设计、型号版本与规格书', keywords: 'type model cable specification xinghao', group: '工程工作区' },
  { id: 'studies', label: '研究', to: '/studies', icon: 'nav/study', description: '问询、计算、仿真与保存结果', keywords: 'study research simulation analysis yanjiu', group: '工程工作区' },
  { id: 'library', label: '库', to: '/library', icon: 'nav/library', description: '工程资源与资料依据', keywords: 'library resource asset document ziliao', group: '资源与环境' },
  { id: 'plugins', label: '插件', to: '/plugins', icon: 'nav/plugin', description: '方法能力、发行版本与适用范围', keywords: 'plugin method capability chajian', group: '资源与环境' },
  { id: 'settings', label: '设置', to: '/settings', icon: 'nav/settings', description: '界面偏好与环境设置', keywords: 'settings preferences environment shezhi', group: '资源与环境' },
] as const;

export type WorkbenchDestination = (typeof WORKBENCH_NAVIGATION)[number];
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');

export function filterNavigation(query: string): readonly WorkbenchDestination[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return WORKBENCH_NAVIGATION.filter((item) => {
    const text = normalize(`${item.label} ${item.description} ${item.keywords}`);
    return terms.every((term) => text.includes(term));
  }).sort((left, right) => {
    const needle = normalize(query);
    const rank = (item: WorkbenchDestination) => !needle ? 0 : normalize(item.label) === needle ? 0 : normalize(item.label).startsWith(needle) ? 1 : 2;
    return rank(left) - rank(right);
  });
}

export interface ShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
  defaultPrevented?: boolean;
}

export function isNavigationShortcut(event: ShortcutEvent): boolean {
  return Boolean((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
    && !event.altKey && !event.shiftKey && !event.isComposing && event.keyCode !== 229
    && !event.repeat && !event.defaultPrevented);
}

export function nextNavigationIndex(current: number, direction: -1 | 1, length: number): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return direction === 1 ? 0 : length - 1;
  return (current + direction + length) % length;
}

export const SIDEBAR_PREFERENCE_KEY = 'cablesim.ui.sidebar-collapsed';
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function readSidebarPreference(storage?: PreferenceStorage | null): boolean {
  try { return storage?.getItem(SIDEBAR_PREFERENCE_KEY) === 'true'; }
  catch { return false; }
}
export function saveSidebarPreference(storage: PreferenceStorage | null | undefined, collapsed: boolean): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SIDEBAR_PREFERENCE_KEY, String(collapsed));
    return true;
  } catch { return false; }
}
