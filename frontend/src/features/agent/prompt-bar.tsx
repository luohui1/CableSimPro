import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/icon";

/* 输入栏（组件陈列“输入栏（@ 引用 · / 命令）”，@react-bits PromptBar 的结构与交互）：
   灰底圆角输入；+ 或 @ 引用本工程的研究与型号，/ 调出常用任务；左下是模型，右下是发送 / 停止。 */

export type PromptReference = { key: string; name: string; description?: string; icon: string };
export type PromptCommand = { key: string; name: string; description: string; text: string };
type Row = { key: string; name: string; description?: string; icon?: string; insert: string };
type Token = { kind: "at" | "slash"; query: string; start: number };

const parseToken = (draft: string): Token | null => {
  const match = /(^|\s)([@/])([^\s@/]*)$/.exec(draft);
  return match ? { kind: match[2] === "@" ? "at" : "slash", query: match[3].toLowerCase(), start: match.index + match[1].length } : null;
};

export function PromptBar({ value, onChange, onSend, onStop, busy, canSend, placeholder, references = [], commands = [], model }: {
  value: string; onChange: (value: string) => void; onSend: () => void; onStop?: () => void; busy?: boolean; canSend: boolean;
  placeholder: string; references?: PromptReference[]; commands?: PromptCommand[]; model?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [plus, setPlus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const token = dismissed ? null : parseToken(value);
  const open = plus ? "at" : token?.kind ?? null;
  const query = plus ? "" : token?.query ?? "";
  const rows: Row[] = open === "at"
    ? references.filter((row) => row.name.toLowerCase().includes(query)).map((row) => ({ ...row, insert: `@${row.name} ` }))
    : open === "slash" ? commands.filter((row) => row.name.toLowerCase().includes(query)).map((row) => ({ ...row, insert: row.text })) : [];
  const cursor = Math.min(active, Math.max(0, rows.length - 1));
  const armed = busy || (canSend && !!value.trim());

  useEffect(() => {
    if (!plus) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setPlus(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [plus]);

  const pick = (row: Row) => {
    const head = token && !plus ? value.slice(0, token.start) : value.replace(/\s*$/, value.trim() ? " " : "");
    onChange(head + row.insert);
    setPlus(false); setActive(0);
    input.current?.focus();
  };
  const send = () => { if (canSend && value.trim() && !busy) onSend(); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (open && rows.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((cursor + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(rows[cursor]); return; }
    }
    if (open && event.key === "Escape") { event.preventDefault(); setPlus(false); setDismissed(true); return; }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
  };

  return <div className="prompt-bar" ref={root}>
    {open && <div className="prompt-bar-menu" role="listbox" aria-label={open === "at" ? "引用" : "常用任务"}>
      {rows.length ? rows.map((row, index) => <button key={row.key} type="button" role="option" aria-selected={index === cursor} className="prompt-bar-row"
        onMouseDown={(event) => event.preventDefault()} onPointerEnter={() => setActive(index)} onClick={() => pick(row)}>
        {row.icon && <Icon name={row.icon} />}<b>{row.name}</b>{row.description && <span>{row.description}</span>}
      </button>) : <p className="prompt-bar-empty">{open === "at" ? "本工程里没有匹配的研究或型号" : "没有匹配的任务"}</p>}
    </div>}
    <div className="prompt-bar-box" onClick={() => input.current?.focus()}>
      <textarea ref={input} value={value} rows={1} aria-label="给 Agent 的任务" placeholder={placeholder} disabled={busy}
        onChange={(event) => { onChange(event.target.value); setDismissed(false); setPlus(false); setActive(0); }} onKeyDown={onKeyDown} />
      <div className="prompt-bar-tools">
        {references.length > 0 && <button type="button" className="prompt-bar-icon" aria-label="引用研究或型号" aria-expanded={plus} data-on={plus || undefined}
          onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); setActive(0); setPlus((state) => !state); input.current?.focus(); }}>
          <Icon name="action/add" />
        </button>}
        {model && <span className="prompt-bar-model">{model}</span>}
        <span className="prompt-bar-hint">{[references.length && "@ 引用", commands.length && "/ 任务"].filter(Boolean).join(" · ")}</span>
        <button type="button" className="prompt-bar-send" aria-label={busy ? "停止接收" : "发送"} data-armed={armed || undefined} disabled={!armed || (busy && !onStop)}
          onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); if (busy) onStop?.(); else send(); }}>
          <Icon name={busy ? "run/stop" : "action/arrow-up"} />
        </button>
      </div>
    </div>
  </div>;
}
