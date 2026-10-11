import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { CommandAction as Action } from '@/components/command-bar';

/** 型号工作台命令栏里“计算”组的挂载点；模块把自己的主运行按钮放进去，状态仍归模块管理。 */
export const TypeCommandSlot = createContext<((action: Action | null) => void) | null>(null);

export function useTypeCommand(action: Action) {
  const register = useContext(TypeCommandSlot), callback = useRef(action.onSelect);
  callback.current = action.onSelect;
  useEffect(() => {
    if (!register) return;
    register({ ...action, onSelect: () => callback.current() });
    return () => register(null);
  }, [register, action.id, action.label, action.disabledReason, action.loading, action.icon, action.role]);
  return !!register;
}

export function CommandAction({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
