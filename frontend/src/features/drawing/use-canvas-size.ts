import { useEffect, useRef, useState } from 'react';

export function useCanvasSize() {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 460 });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const read = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) setSize(previous =>
        previous.width === bounds.width && previous.height === bounds.height ? previous
          : { width: bounds.width, height: bounds.height });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { host, size };
}
