// The gallery (/gallery): every kit part in every state, and the five screens laid out from them. A new screen takes its
// parts from here; a part that is not here does not exist. /gallery#screen=<id> opens one screen at full size.
import { useEffect, useState } from 'react';
import { SCREENS } from './gallery/screens';

const screenOf = () => new URLSearchParams(window.location.hash.slice(1)).get('screen');

export function Gallery() {
  const [screen, setScreen] = useState(screenOf);
  useEffect(() => {
    const follow = () => setScreen(screenOf());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  const shown = SCREENS.find(item => item.id === screen);
  if (shown) return <div className="fixed inset-0 z-40 bg-canvas" data-screen={shown.id}>{shown.render()}</div>;
  return <div className="h-full overflow-y-auto bg-surface">
    <div className="mx-auto flex max-w-page flex-col gap-8 px-8 py-10">
      <h1 className="m-0 text-h1 text-ink">陈列</h1>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {SCREENS.map(item => <li key={item.id}><a className="text-copper underline-offset-4 hover:underline" href={`#screen=${item.id}`}>{item.title}</a></li>)}
      </ul>
    </div>
  </div>;
}
