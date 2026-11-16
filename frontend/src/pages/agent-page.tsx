import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { usePageTheme } from "@/components/catalog-shell";
import { EmptyState, InlineEmpty } from "@/components/states";
import { Button } from "@/components/ui/button";

/**
 * Agent 模式：对话页是单独构建的页面（pi 内核，studio/ui/fusion），放在这个框里，由本平台同源提供（/agent-app/），
 * 对话服务（边车）经 /agent-sidecar 到达。外壳（侧栏、顶栏、主题）仍是本平台的；框里只有对话列表和对话。
 * 框通过 postMessage 请本页跳转：卡片上的“在工作台打开”给出 cablesim:<对象>/<标识>?…，在这里换成本平台自己的路由。
 */
const SOURCE = "cablesim-agent";
const PAGE = "/agent-app/fusion.html";

interface SidecarStatus { agent: { configured: boolean; model?: string; provider?: string; hint?: string } }

/** 对话服务能不能用，不能用时的原因原话；界面文件也要在。不假装可用。 */
async function sidecarStatus(signal?: AbortSignal): Promise<SidecarStatus> {
  const response = await fetch("/agent-sidecar/api/status", { signal }).catch(() => null);
  if (!response) throw new Error("连不上本平台的服务，请确认它仍在运行。");
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `对话服务没有回答（${response.status}）。`);
  const page = await fetch(PAGE, { method: "HEAD", signal }).catch(() => null);
  if (!page?.ok) throw new Error("对话界面尚未构建：在 studio 目录运行 npm run build:fusion。");
  return body as SidecarStatus;
}

export function AgentPage() {
  const { theme } = usePageTheme();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  // 框的地址只在打开时定一次，之后换主题用消息通知，不重载（重载会丢掉正在进行的对话）
  const [src] = useState(() => `${PAGE}?theme=${theme}`);
  const status = useQuery({ queryKey: ["agent-sidecar-status"], queryFn: ({ signal }) => sidecarStatus(signal), retry: false, staleTime: 30_000 });

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ source: SOURCE, type: "theme", theme }, window.location.origin);
  }, [theme, status.isSuccess]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const message = event.data as { source?: string; type?: string; href?: unknown };
      if (message?.source !== SOURCE || message.type !== "open" || typeof message.href !== "string") return;
      const match = /^cablesim:([a-z_]+)\/([^?]+)(?:\?(.*))?$/.exec(message.href);
      if (!match) return;
      const id = decodeURIComponent(match[2]);
      const query = new URLSearchParams(match[3] || "");
      if (match[1] === "study") void navigate({ to: "/studies/$sid", params: { sid: id }, search: { theme, workspace: query.get("workspace") || "", run: query.get("run") || "", delivery: "" } });
      else if (match[1] === "project") void navigate({ to: "/studies", search: { theme, workspace: id } });
      else if (match[1] === "type") void navigate({ to: "/types/$wid/$module/$tab", params: { wid: id, module: "structure", tab: "section" }, search: { theme } });
      else if (match[1] === "cable_version") void navigate({ to: "/resources/cables", search: { theme, item: id } });
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [navigate, theme]);

  const agent = status.data?.agent;
  const model = agent?.configured ? agent.model : undefined;
  return (
    <AppShell title="Agent" theme={theme} onTheme={() => {}} onUnavailable={() => {}} actions={null}
      status={agent ? <><span className={`status-dot ${model ? "is-ok" : "is-off"}`} /><span className="agent-panel-model">{model || "模型未配置"}</span></> : null}>
      <div className="agent-page" data-page="agent">
        {status.isPending ? <InlineEmpty title="正在连接 Agent" />
          : status.isError ? <EmptyState title="Agent 暂时不能用" description={status.error.message}
            action={<Button size="compact" onClick={() => void status.refetch()}>重试</Button>} />
            : <iframe ref={frame} className="agent-embed" title="Agent 对话" src={src} />}
      </div>
    </AppShell>
  );
}
