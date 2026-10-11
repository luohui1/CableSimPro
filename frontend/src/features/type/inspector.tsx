import { createContext, useContext, type ReactNode } from 'react';
import type { PropertyGroup } from '@/components/property-panel';
export type TypeInspector = { show: (title: string, groups: PropertyGroup[], extra?: ReactNode) => void; clear: () => void };
export const TypeInspectorContext = createContext<TypeInspector | null>(null);
export function useTypeInspector() { const value = useContext(TypeInspectorContext); if (!value) throw new Error('型号属性栏未挂载'); return value; }
