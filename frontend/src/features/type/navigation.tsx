import { createContext, useContext } from 'react';
export type TypeLocation = { wid?: string; module: string; tab: string; create?: boolean; revision?: number; run?: string; layer?: string; field?: string; theme: 'light' | 'dark' };
export type TypeNavigation = { location: TypeLocation; navigate: (path: string) => void; onTheme: () => void };
export const TypeNavigationContext = createContext<TypeNavigation | null>(null);
export function useTypeNavigation() { const value = useContext(TypeNavigationContext); if (!value) throw new Error('型号路由上下文未挂载'); return value; }
export function typePath(wid: string, module = 'structure', tab = 'section', theme = 'light') { return `/types/${encodeURIComponent(wid)}/${module}/${tab}?theme=${theme}`; }
