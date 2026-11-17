// The Agent page lives in a frame inside the old platform's page. A card cannot open the old workbench itself: it tells the page around it
// where to go, in the address form the sidecar gave (cablesim:study/<id>?workspace=…), and the old page turns that into its own route.
export const MESSAGE_SOURCE = 'cablesim-agent';

/** Reread saved platform facts after a human decision settles, including a lost or failed reply. */
export function notifyPlatformChanged(workspace?: string): void {
  window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'changed', workspace }, window.location.origin);
}

export function useOpen(): (href: string) => void {
  return href => window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'open', href }, window.location.origin);
}
