// What the section canvas is showing and what is selected on it: which view, which layers, which cable. Project data never
// lives here; it is read from the host.
import { create } from 'zustand';

export type Lens = 'cluster' | 'overview';
export type LayerName = 'field' | 'isotherms' | 'dimensions';

interface ViewState {
  selected: string | null;
  hovered: string | null;
  lens: Lens;
  layers: Record<LayerName, boolean>;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setLens: (lens: Lens) => void;
  toggleLayer: (name: LayerName) => void;
}

export const useView = create<ViewState>(set => ({
  selected: null,
  hovered: null,
  // The whole section is the first view: the ground, the depth, the soil around the cable.
  lens: 'overview',
  layers: { field: true, isotherms: true, dimensions: true },
  select: selected => set({ selected }),
  hover: hovered => set({ hovered }),
  setLens: lens => set({ lens }),
  toggleLayer: name => set(state => ({ layers: { ...state.layers, [name]: !state.layers[name] } })),
}));
