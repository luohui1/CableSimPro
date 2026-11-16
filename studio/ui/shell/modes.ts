// Two modes work on the same data: the conversation (Agent) and the professional screens (workbench). The shell remembers where
// each was left, so switching back returns to the same place.
export type Mode = 'agent' | 'workbench';

const KEY = 'cable-studio.last';
const HOME: Record<Mode, string> = { agent: '/', workbench: '/library' };

export const modeOf = (path: string): Mode => (path === '/' || path.startsWith('/chat/') ? 'agent' : 'workbench');

export function remember(path: string, search: string): void {
  try { localStorage.setItem(`${KEY}.${modeOf(path)}`, path + search); } catch { /* private browsing: the shell goes home instead */ }
}

export function lastPlace(mode: Mode): string {
  try { return localStorage.getItem(`${KEY}.${mode}`) ?? HOME[mode]; } catch { return HOME[mode]; }
}
