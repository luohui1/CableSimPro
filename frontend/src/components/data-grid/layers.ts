export const GRID_LAYER = {
  /** Unpinned body cell — in flow, no stacking context of its own. */
  cell: 0,
  /** Active (focused) unpinned cell: above its neighbours, below anything pinned. */
  activeCell: 4,
  /** Pinned-left/right body cell — must cover any unpinned cell scrolled under it. */
  pinnedCell: 8,
  /** Active pinned cell: the focus ring must not be clipped by its own band. */
  activePinnedCell: 12,
  /** Selection/fill/presence segment covering the pinned band — above the pinned cells it decorates, below the marker. */
  pinnedOverlaySegment: 14,
  /** Row-marker body cell — first in DOM order, so it needs to outrank every data cell. */
  markerCell: 16,
  /** Pinned top/bottom row band — spans the full width above the scrolling body. */
  pinnedRowBand: 20,
  /** Header row — above every body cell, including pinned ones. */
  header: 24,
  /** Pinned header cell, and the marker header, within the header row. */
  pinnedHeader: 28,
  /** Pin-edge shadows — above the cells whose boundary they mark. */
  pinShadow: 32,
  /** Selection / fill / presence overlays drawn over the whole grid. */
  overlay: 36,
  /** Loading skeleton — covers everything while the grid has no data to show. */
  skeleton: 40,
} as const;

/** A value from {@link GRID_LAYER}. */
export type GridLayer = (typeof GRID_LAYER)[keyof typeof GRID_LAYER];

/** The stacking rank a body cell should carry, given its pinned and active state. */
export function cellLayer(pinned: boolean, active: boolean): number | undefined {
  if (pinned) return active ? GRID_LAYER.activePinnedCell : GRID_LAYER.pinnedCell;
  if (active) return GRID_LAYER.activeCell;
  return undefined;
}
