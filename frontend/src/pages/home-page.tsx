import { useDeferredValue, useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { formatDateTime } from '@/lib/format';
import { statusLabel } from '@/lib/status-vocabulary';
import { groupInbox } from '@/lib/inbox-groups';
import { InboxGroup } from '@/components/inbox-group';

const SIMULATION_MODULES = ["simulation", "electrothermal", "transient", "sheath-losses", "thermal-field", "batch"];
const short = formatDateTime;
const SEARCH_KINDS = ["project", "study", "type", "cable_version", "asset", "plugin", "delivery", "document"] as const;

/** 与待办共用分组；共性原因展示一次，所有对象仍可展开查看。 */
function NeedsAttention({ items, studies }: { items: InboxItem[]; studies: StudyRow[] }) {
  const listed = groupInbox(items).slice(0, 6);
  if (!listed.length) return <InlineEmpty title="没有需要处理的事项。" />;
  return <ul className="home-todo">
    {listed.map((group) => {
      if (group.items.length > 1) return <li className="home-todo-group" key={group.id}><InboxGroup group={group} action={item => {
        const study = item.object.kind === 'study' ? studies.find(row => row.id === item.object.id) : undefined;
        return study && isVersionStale(study.raw) ? <VersionNotice value={study.raw} target={{ wid: study.workspace, sid: study.id, revision: study.workspaceRevision, studyRevision: study.revision, title: study.title }} /> : undefined;
      }} /></li>;
      const item = group.items[0];
      const study = item.object.kind === "study" ? studies.find((row) => row.id === item.object.id) : undefined;
      return <li key={item.category + item.object.kind + item.object.id}>
        <span className="home-todo-text"><ObjectLink card={item.object}>{item.title}</ObjectLink><small>{item.reason}</small></span>
        {study && isVersionStale(study.raw)
          ? <VersionNotice value={study.raw} target={{ wid: study.workspace, sid: study.id, revision: study.workspaceRevision, studyRevision: study.revision, title: study.title }} />
          : <StatusMark kind={statusMark(item.object.status.code)} label={statusLabel(item.object.status.code, item.object.status.label)} />}
      </li>;
    })}
  </ul>;
}

/**
 * 首页（FRONTEND_REQUIREMENTS §2.2，已定方案“工作入口”）：搜索、继续工作、需要处理、三个领域的新建入口。
 * 名片、状态与待办都来自统一索引（§2.3），页面不自行推算。
 */
export function HomePage() {
  const { theme, navigate } = usePageTheme();
  const [create, setCreate] = useState(false);
  const [initialTask, setInitialTask] = useState('operating');
  const createTask = (task: string) => { setInitialTask(task); setCreate(true); };
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const searchBox = useRef<HTMLInputElement>(null), resultsBox = useRef<HTMLElement>(null);
  const needle = q.trim();
  // Ctrl+K / ⌘K 聚焦搜索
  useEffect(() => {
    const focus = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchBox.current?.focus(); } };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  const studyCards = useQuery({ queryKey: ["index-objects", "study"], queryFn: ({ signal }) => indexObjects({ kind: "study", limit: 100 }, signal) });
  const typeCards = useQuery({ queryKey: ["index-objects", "type"], queryFn: ({ signal }) => indexObjects({ kind: "type", limit: 100 }, signal) });
  const inbox = useQuery({ queryKey: ["index-inbox"], queryFn: ({ signal }) => indexInbox(signal) });
  // 输入稳定后再查；新结果回来前保留上一批，不每敲一个字就闪成骨架
  const query = useDeferredValue(needle);
  const found = useQuery({ queryKey: ["index-search", query], queryFn: ({ signal }) => indexObjects({ q: query, limit: 60 }, signal), enabled: !!query, placeholderData: keepPreviousData });
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
      actions={<Button variant="primary" size="compact" onClick={() => createTask('operating')}>新建研究</Button>}>
      <div className="home-page" data-page="home">
        <label className="home-search">
          <Icon name="action/search" />
          <input ref={searchBox} value={q} onChange={(event) => { setQ(event.target.value); setActive(0); }} placeholder="搜索工程、研究、型号、电缆型号版本、资源或插件（Ctrl+K）" aria-label="搜索"
            aria-controls="home-search-results" aria-activedescendant={needle ? `home-result-${active}` : undefined}
            onKeyDown={(event) => {
              // ↓↑ 在结果里移动，回车打开，Esc 清空
              const links = [...(resultsBox.current?.querySelectorAll<HTMLAnchorElement>("[data-result] a") || [])];
              if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (links.length) setActive((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length); }
              else if (event.key === "Enter" && links[active]) { event.preventDefault(); links[active].click(); }
              else if (event.key === "Escape") setQ("");
            }} />
        </label>
        {needle ? <section ref={resultsBox} id="home-search-results" className="home-section" aria-label="搜索结果">
          {found.isPending && !found.data ? <LoadingState title="正在搜索" description="" />
            : found.error ? <ErrorState description={message(found.error)} />
            : !found.data?.items.length ? <InlineEmpty title="没有匹配的对象" />
            : (() => {
              let index = -1;
              return SEARCH_KINDS.map((kind) => {
                const items = found.data.items.filter((item) => item.kind === kind).slice(0, 6);
                return items.length ? <div key={kind} className="home-results"><h2>{KIND_LABELS[kind]}</h2><ul>{items.map((item) => { index += 1; return <li key={item.id} id={`home-result-${index}`} data-result aria-selected={index === active} className={index === active ? "is-active" : undefined}><ObjectLink card={item} />{item.parent && <span className="muted"> · {item.parent.name}</span>}</li>; })}</ul></div> : null;
              });
            })()}
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
                    { id: "owner", label: "所属", wrap: true, render: (row) => row.parent?.name || KIND_LABELS[row.kind] },
                    { id: "state", label: "状态", render: (row) => <StatusMark kind={statusMark(row.status.code)} label={statusLabel(row.status.code, row.status.label)} detail={row.status.reason || undefined} /> },
                    { id: "updated", label: "更新时间", render: (row) => short(row.updated) },
                  ]} />}
            </section>
            <section className="home-section" aria-label="需要处理">
              <header><h2>需要处理</h2><span className="home-section-links"><Link to="/agent" search={{ theme, ask: "inbox" }}>让 Agent 整理</Link><Link to="/inbox" search={{ theme }}>全部待办</Link></span></header>
              {inbox.isPending ? <LoadingState title="正在汇总" />
                : inbox.error ? <ErrorState description={message(inbox.error)} action={<Button onClick={() => void inbox.refetch()}>重新读取</Button>} />
                : <NeedsAttention items={inbox.data.items} studies={rows} />}
            </section>
          </div>
          <nav className="home-domains" aria-label="新建">
            <div><Icon name="calc/ampacity" /><Link to="/studies" search={{ theme, kind: "ampacity" }}><b>载流量计算</b><span className="muted">{studies.data ? `${rows.length - simulation} 项研究` : studies.isError ? '计数读取失败' : '正在读取计数'}</span></Link>{studies.isError && <Button size="compact" variant="ghost" onClick={() => void studies.refetch()}>重试计数</Button>}<Button size="compact" variant="ghost" onClick={() => createTask('rating')}>新建研究</Button></div>
            <div><Icon name="nav/cable-type" /><Link to="/types" search={{ theme }}><b>电缆设计</b><span className="muted">{typeCards.data?.total ?? "—"} 个型号设计</span></Link><Button size="compact" variant="ghost" onClick={() => void navigate({ to: "/types", search: { theme, create: true } })}>新建型号</Button></div>
            <div><Icon name="calc/thermal-field" /><Link to="/studies" search={{ theme, kind: "simulation" }}><b>电缆仿真</b><span className="muted">{studies.data ? `${simulation} 项研究` : studies.isError ? '计数读取失败' : '正在读取计数'}</span></Link><Button size="compact" variant="ghost" onClick={() => createTask('transient-temperature')}>新建研究</Button></div>
          </nav>
        </>}
      </div>
    </AppShell>
    <CreateStudyDialog key={initialTask} open={create} onOpenChange={setCreate} theme={theme} initialTask={initialTask} />
  </>;
}
