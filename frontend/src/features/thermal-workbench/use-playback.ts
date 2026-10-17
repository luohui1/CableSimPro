import { useEffect, useRef, useState } from 'react';
import { indexAt } from './data';

/** Advances by physical elapsed seconds; renders only actual saved samples. No interpolation. */
export function usePlayback(times: readonly number[]) {
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(60), [reduced, setReduced] = useState(false);
  const cursor = useRef(index); cursor.current = index;
  useEffect(() => { setIndex(0); setPlaying(false); }, [times]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => { setReduced(media.matches); if (media.matches) setPlaying(false); };
    const visibility = () => { if (document.hidden) setPlaying(false); };
    preference(); media.addEventListener('change', preference); document.addEventListener('visibilitychange', visibility);
    return () => { media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!playing || reduced || times.length < 2) return;
    let active = true, frame = 0, start: number | null = null;
    const from = times[Math.min(cursor.current, times.length - 1)], end = times[times.length - 1];
    function tick(now: number) {
      if (!active) return;
      if (start === null) start = now;
      const time = Math.min(end, from + (now - start) * speed / 1000);
      const next = indexAt(times, time);
      setIndex(previous => previous === next ? previous : next);
      if (time >= end || document.hidden) setPlaying(false); else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [playing, speed, times, reduced]);
  function seek(next: number) { setPlaying(false); setIndex(Math.max(0, Math.min(times.length - 1, Math.round(next)))); }
  function toggle() {
    if (reduced || times.length < 2) return;
    if (!playing && index >= times.length - 1) { cursor.current = 0; setIndex(0); }
    setPlaying(value => !value);
  }
  return { index, time: times[index] ?? null, playing, speed, reduced, seek, toggle,
    rate: (value: number) => { if ([1, 60, 600, 3600].includes(value)) setSpeed(value); } };
}
