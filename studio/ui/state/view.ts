// View state only: what is selected, which condition is shown, which layers are on.
// Project data never lives here; it is read from the host.
import { create } from 'zustand';

export type Mode = 'load' | 'rated';
export type Lens = 'cluster' | 'overview';
export type LayerName = 'field' | 'isotherms' | 'dimensions';

interface ViewState {
  selected: string | null;
  hovered: string | null;
  mode: Mode;
  lens: Lens;
  layers: Record<LayerName, boolean>;
  /** Pointer position on the section, in metres. */
  cursor: [number, number] | null;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setMode: (mode: Mode) => void;
  setLens: (lens: Lens) => void;
  toggleLayer: (name: LayerName) => void;
  setCursor: (cursor: [number, number] | null) => void;
}

export const useView = create<ViewState>(set => ({
  selected: null,
  hovered: null,
  mode: 'load',
  lens: 'cluster',
  layers: { field: true, isotherms: true, dimensions: true },
  cursor: null,
  select: selected => set({ selected }),
  hover: hovered => set({ hovered }),
  setMode: mode => set({ mode }),
  setLens: lens => set({ lens }),
  toggleLayer: name => set(state => ({ layers: { ...state.layers, [name]: !state.layers[name] } })),
  setCursor: cursor => set({ cursor }),
}));
