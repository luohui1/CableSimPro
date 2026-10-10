import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

/**
 * 画布与结果区之间的分隔条（工作台骨架，研究、型号、工程共用）：
 * 拖动或用 ↑↓ 调整上下比例，双击复原；比例按页面类别记在本机偏好里。
 * 只在父级 .workbench 上写 data-split（5% 一档），比例由样式表按档位给出；不写内联样式，不改各页面内容。
 */
const DEFAULT = 0.5, MIN = 0.15, MAX = 0.85, STEP = 0.05;
const storeKey = (kind: string) => `cablesim.workbench-split.${kind}`;

function read(kind: string) {
  try {
    const value = Number(window.localStorage.getItem(storeKey(kind)));
    return Number.isFinite(value) && value >= MIN && value <= MAX ? value : DEFAULT;
  } catch { return DEFAULT; }
}
function save(kind: string, share: number) {
  try { window.localStorage.setItem(storeKey(kind), String(share)); } catch { /* 无痕窗口等：本次有效，不记住 */ }
}
const snap = (share: number) => Math.round(Math.min(MAX, Math.max(MIN, share)) / STEP) * STEP;
function apply(grid: HTMLElement | null | undefined, share: number) {
  grid?.setAttribute("data-split", String(Math.round(snap(share) * 100)));
}

export function WorkbenchSplitter({ kind }: { kind: "study" | "type" | "project" }) {
  const ref = useRef<HTMLDivElement>(null);
  const share = useRef(DEFAULT);
  useLayoutEffect(() => {
    share.current = read(kind);
    apply(ref.current?.parentElement, share.current);
    ref.current?.setAttribute("aria-valuenow", String(Math.round(share.current * 100)));
  }, [kind]);
  const set = (next: number, persist: boolean) => {
    share.current = snap(next);
    apply(ref.current?.parentElement, share.current);
    ref.current?.setAttribute("aria-valuenow", String(Math.round(share.current * 100)));
    if (persist) save(kind, share.current);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const canvas = ref.current?.previousElementSibling as HTMLElement | null, dock = ref.current?.nextElementSibling as HTMLElement | null;
    if (!canvas || !dock || event.button !== 0) return;
    event.preventDefault();
    const top = canvas.getBoundingClientRect().top, total = canvas.offsetHeight + dock.offsetHeight;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent) => set((moved.clientY - top) / total, false);
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); save(kind, share.current); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = ({ ArrowUp: share.current - STEP, ArrowDown: share.current + STEP, Home: MIN, End: MAX } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    set(next, true);
  };
  return <div ref={ref} className="workbench-splitter" role="separator" aria-orientation="horizontal" aria-label="拖动调整画布与结果区高度，双击复原"
    aria-valuemin={MIN * 100} aria-valuemax={MAX * 100} tabIndex={0}
    onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={() => set(DEFAULT, true)} />;
}
