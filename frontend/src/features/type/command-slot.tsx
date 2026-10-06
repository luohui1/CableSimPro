import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 型号工作台命令栏里“计算”组的挂载点；模块把自己的主运行按钮放进去，状态仍归模块管理。 */
export const TypeCommandSlot = createContext<HTMLElement | null>(null);

export function CommandAction({ children }: { children: ReactNode }) {
  const slot = useContext(TypeCommandSlot);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
