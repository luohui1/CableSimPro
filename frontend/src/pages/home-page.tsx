import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { studyIndex, type StudyRow } from "@/api/research";
import { indexInbox, indexObjects, type InboxItem, type ObjectCard } from "@/api/object-index";
import { message } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { usePageTheme } from "@/components/catalog-shell";
import { CreateStudyDialog } from "@/components/create-study-dialog";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { KIND_LABELS, ObjectLink, statusMark } from "@/components/object-link";
import { StatusMark } from "@/components/status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { VersionNotice } from "@/components/version-notice";
import { rootModule } from "@/lib/study-config";
import { isVersionStale } from "@/lib/version-status";

const SIMULATION_MODULES = ["simulation", "electrothermal", "transient", "sheath-losses", "thermal-field", "batch"];
const short = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const SEARCH_KINDS = ["project", "study", "type", "cable_version", "asset", "plugin", "delivery", "document"] as const;

/** 需要处理：过期研究、待审核逐条列出（带原因和下一步）；资料缺项和进行中按类合并成一行。 */
function NeedsAttention({ items, studies, theme }: { items: InboxItem[]; studies: StudyRow[]; theme: "light" | "dark" }) {
  const listed = items.filter((item) => item.category === "stale" || item.category === "review").slice(0, 6);
  const missing = items.filter((item) => item.category === "missing").length;
  const running = items.filter((item) => item.category === "running").length;
  if (!listed.length && !missing && !running) return <InlineEmpty title="没有需要处理的事项。" />;
  return <ul className="home-todo">
    {listed.map((item) => {
      const study = item.object.kind === "study" ? studies.find((row) => row.id === item.object.id) : undefined;
      return <li key={item.category + item.object.kind + item.object.id}>
        <span className="home-todo-text"><ObjectLink card={item.object}>{item.title}</ObjectLink><small>{item.reason}</small></span>
        {study && isVersionStale(study.raw)
          ? <VersionNotice value={study.raw} target={{ wid: study.workspace, sid: study.id, revision: study.workspaceRevision, studyRevision: study.revision, title: study.title }} />
          : <StatusMark kind={statusMark(item.object.status.code)} label={item.object.status.label} />}
      </li>;
    })}
    {missing > 0 && <li>
      <span className="home-todo-text"><Link className="object-link" to="/inbox" search={{ theme }}>{missing} 条资料缺项</Link><small>补齐并核对后，研究才能引用为完整型号</small></span>
      <StatusMark kind="draft" label="资料缺项" />
    </li>}
    {running > 0 && <li>
      <span className="home-todo-text"><Link className="object-link" to="/runs" search={{ theme }}>{running} 项正在运行</Link><small>运行与超算作业</small></span>
      <StatusMark kind="running" label="进行中" />
    </li>}
  </ul>;
}

/**
 * 首页（FRONTEND_REQUIREMENTS §2.2，已定方案“工作入口”）：搜索、继续工作、需要处理、三个领域的新建入口。
 * 名片、状态与待办都来自统一索引（§2.3），页面不自行推算。
 */
export function HomePage() {
  const { theme, navigate } = usePageTheme();
  const [create, setCreate] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim();
  const studyCards = useQuery({ queryKey: ["index-objects", "study"], queryFn: ({ signal }) => indexObjects({ kind: "study", limit: 100 }, signal) });
  const typeCards = useQuery({ queryKey: ["index-objects", "type"], queryFn: ({ signal }) => indexObjects({ kind: "type", limit: 100 }, signal) });
  const inbox = useQuery({ queryKey: ["index-inbox"], queryFn: ({ signal }) => indexInbox(signal) });
  const found = useQuery({ queryKey: ["index-search", needle], queryFn: ({ signal }) => indexObjects({ q: needle, limit: 60 }, signal), enabled: !!needle });
  // 过期研究的“重算”沿用工作台的确认流程，需要研究的修订号
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal) });

  const recent = [...(studyCards.data?.items || []), ...(typeCards.data?.items || [])]
    .sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 6) as (ObjectCard & { id: string })[];
  const rows = studies.data || [];
  const simulation = rows.filter((row) => SIMULATION_MODULES.includes(rootModule(row.definition))).length;
  const pending = studyCards.isPending || typeCards.isPending;
  const failure = studyCards.error || typeCards.error;

  return <>
    <AppShell title="首页" status={null} theme={theme} onUnavailable={() => {}}
      onTheme={() => void navigate({ to: "/", search: { theme: theme === "light" ? "dark" : "light" }, replace: true })}
      actions={<Button variant="primary" size="compact" onClick={() => setCreate(true)}>新建研究</Button>}>
      <div className="home-page" data-page="home">
        <label className="home-search">
          <Icon name="action/search" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索工程、研究、型号、电缆型号版本、资源或插件" aria-label="搜索" />
        </label>
        {needle ? <section className="home-section" aria-label="搜索结果">
          {found.isPending ? <LoadingState title="正在搜索" description="" />
            : found.error ? <ErrorState description={message(found.error)} />
            : !found.data?.items.length ? <InlineEmpty title="没有匹配的对象" />
            : SEARCH_KINDS.map((kind) => {
              const items = found.data.items.filter((item) => item.kind === kind).slice(0, 6);
              return items.length ? <div key={kind} className="home-results"><h2>{KIND_LABELS[kind]}</h2><ul>{items.map((item) => <li key={item.id}><ObjectLink card={item} />{item.parent && <span className="muted"> · {item.parent.name}</span>}</li>)}</ul></div> : null;
            })}
        </section> : <>
          <div className="home-columns">
            <section className="home-section" aria-label="继续工作">
              <header><h2>继续工作</h2><Link to="/studies" search={{ theme }}>全部研究</Link></header>
              {pending ? <LoadingState title="正在读取最近的研究与型号" />
                : failure ? <ErrorState description={message(failure)} action={<Button onClick={() => { void studyCards.refetch(); void typeCards.refetch(); }}>重新读取</Button>} />
                : !recent.length ? <InlineEmpty title="还没有研究或型号设计。" action={<Button size="compact" onClick={() => setCreate(true)}>新建研究</Button>} />
                : <DataTable<ObjectCard & { id: string }> label="继续工作" showGroups={false} groups={[{ id: "recent", label: "最近", rows: recent }]} rowLabel={(row) => row.name}
                  columns={[
                    { id: "name", label: "名称", wrap: true, render: (row) => <ObjectLink card={row} /> },
                    { id: "owner", label: "所属", render: (row) => row.parent?.name || KIND_LABELS[row.kind] },
                    { id: "state", label: "状态", render: (row) => <StatusMark kind={statusMark(row.status.code)} label={row.status.label} detail={row.status.reason || undefined} /> },
                    { id: "updated", label: "更新时间", render: (row) => short(row.updated) },
                  ]} />}
            </section>
            <section className="home-section" aria-label="需要处理">
              <header><h2>需要处理</h2><span className="home-section-links"><Link to="/agent" search={{ theme, ask: "inbox" }}>让 Agent 整理</Link><Link to="/inbox" search={{ theme }}>全部待办</Link></span></header>
              {inbox.isPending ? <LoadingState title="正在汇总" />
                : inbox.error ? <ErrorState description={message(inbox.error)} action={<Button onClick={() => void inbox.refetch()}>重新读取</Button>} />
                : <NeedsAttention items={inbox.data.items} studies={rows} theme={theme} />}
            </section>
          </div>
          <nav className="home-domains" aria-label="新建">
            <div><Icon name="calc/ampacity" /><Link to="/studies" search={{ theme, kind: "ampacity" }}><b>载流量计算</b><span className="muted">{rows.length - simulation} 项研究</span></Link><Button size="compact" variant="ghost" onClick={() => setCreate(true)}>新建研究</Button></div>
            <div><Icon name="nav/cable-type" /><Link to="/types" search={{ theme }}><b>电缆设计</b><span className="muted">{typeCards.data?.total ?? "—"} 个型号设计</span></Link><Button size="compact" variant="ghost" onClick={() => void navigate({ to: "/types", search: { theme, create: true } })}>新建型号</Button></div>
            <div><Icon name="calc/thermal-field" /><Link to="/studies" search={{ theme, kind: "simulation" }}><b>电缆仿真</b><span className="muted">{simulation} 项研究</span></Link><Button size="compact" variant="ghost" onClick={() => setCreate(true)}>新建研究</Button></div>
          </nav>
        </>}
      </div>
    </AppShell>
    <CreateStudyDialog open={create} onOpenChange={setCreate} theme={theme} />
  </>;
}
