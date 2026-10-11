import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentSession, agentStatus, AgentUnavailable, createSession, decideProposal, sendMessage, type AgentProposal, type RecipeCall } from "./agent-api";
import { applyEvent, buildTurns, newTurn, type Turn } from "./transcript";

export type Decision = { busy?: boolean; error?: string; status?: AgentProposal["status"] };

export function useAgentStatus() {
  const status = useQuery({ queryKey: ["agent-status"], queryFn: ({ signal }) => agentStatus(signal), retry: false, staleTime: 60_000 });
  const ready = !!status.data?.configured;
  const label = ready ? status.data?.model || "已连接" : status.error instanceof AgentUnavailable ? "服务尚未部署" : status.isPending ? "检查中" : "未连接模型";
  // 状态还在读取时允许发送：模型若未配置，服务端会返回明确错误，不必让人干等
  return { ready, canSend: ready || status.isPending, label };
}

/**
 * 一个 Agent 会话：已完成的轮次来自审计记录（GET /api/agent/sessions/{id}），
 * 正在进行的一轮由流式事件实时拼出，结束后以记录为准重建。
 */
export function useAgentSession({ sessionId, workspaceId, studyId, onCreated }: { sessionId?: string; workspaceId?: string; studyId?: string; onCreated?: (id: string) => void }) {
  const queries = useQueryClient();
  const [current, setCurrent] = useState<string | undefined>(sessionId);
  const currentRef = useRef(current);
  const [live, setLive] = useState<Turn | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const deciding = useRef(new Set<string>());
  const liveProposals = useRef(new Map<string, AgentProposal>());
  const controller = useRef<AbortController | null>(null);
  const liveBoundary = useRef(0);

  // 外部切换任务（或点“新任务”）时换会话；自己刚建的会话回写到地址时不打断正在进行的一轮
  useEffect(() => {
    if (sessionId === currentRef.current) return;
    currentRef.current = sessionId;
    setCurrent(sessionId); setLive(null); setDecisions({}); liveProposals.current = new Map();
  }, [sessionId]);

  const record = useQuery({ queryKey: ["agent-session", current], queryFn: ({ signal }) => agentSession(current!, signal), enabled: !!current, staleTime: 5_000,
    refetchInterval: query => !sending && ['planning', 'running'].includes(query.state.data?.state || '') ? 3000 : false });
  useEffect(() => {
    if (!live?.interrupted || !record.data || ['planning', 'running'].includes(record.data.state)) return;
    const latest = buildTurns(record.data).at(-1);
    if (latest?.question === live.question && Number(latest.id) > liveBoundary.current) setLive(null);
  }, [record.data, live]);
  const turns = useMemo(() => {
    const saved = record.data ? buildTurns(record.data) : [];
    const latest = saved.at(-1);
    // 当前轮可能已进入审计记录；流式轮在收尾前接管它，旧轮保留。
    return live && latest?.question === live.question && Number(latest.id) > liveBoundary.current ? saved.slice(0, -1) : saved;
  }, [record.data, live]);
  const proposals = useMemo(() => {
    const map = new Map(liveProposals.current);
    for (const proposal of record.data?.proposals || []) map.set(proposal.id, proposal);
    for (const [id, decision] of Object.entries(decisions)) {
      const proposal = map.get(id);
      if (proposal && decision.status) map.set(id, { ...proposal, status: decision.status });
    }
    return map;
    // live 变化时重新读取 liveProposals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.data, decisions, live]);

  /** 读回审计记录；记录里已经有这一轮时，临时拼出的那一轮让位给记录。 */
  async function settle(id: string, question: string) {
    try {
      const saved = await queries.fetchQuery({ queryKey: ["agent-session", id], queryFn: ({ signal }) => agentSession(id, signal), staleTime: 0 });
      const latest = buildTurns(saved).at(-1);
      if (latest?.question === question && Number(latest.id) > liveBoundary.current && !['planning', 'running'].includes(saved.state)) setLive(null);
    } catch { /* 记录读不到时保留临时显示 */ }
  }

  async function send(text: string, recipe?: RecipeCall) {
    const content = text.trim();
    if (!content || sendingRef.current || !workspaceId) return;
    sendingRef.current = true;
    liveBoundary.current = record.data?.events.at(-1)?.sequence ?? 0;
    setSending(true);
    let turn = newTurn(content);
    setLive(turn);
    let id = currentRef.current;
    try {
      if (!id) {
        id = (await createSession(workspaceId, studyId)).id;
        currentRef.current = id; setCurrent(id); onCreated?.(id);
      }
      controller.current = new AbortController();
      await sendMessage(id, content, (event) => { turn = applyEvent(turn, event, liveProposals.current); setLive(turn); }, controller.current.signal, recipe);
      // 流已结束：这一轮不再“思考中”，即使没收到 done 也一样；随后用审计记录替换临时显示
      turn = { ...turn, running: false };
      setLive(turn);
      await settle(id, content);
    } catch (error) {
      const stopped = controller.current?.signal.aborted;
      setLive({ ...turn, running: false, interrupted: true, notices: [...turn.notices, { text: stopped ? "已停止接收。已经开始的步骤由服务端收尾，结果以任务记录为准。" : error instanceof Error ? error.message : String(error) }] });
      // 停止或中断后以服务端记录为准：等它把这一轮收尾，再用记录替换临时显示
      if (id) window.setTimeout(() => void settle(id!, content), stopped ? 1500 : 0);
    } finally {
      controller.current = null;
      sendingRef.current = false;
      setSending(false);
      void queries.invalidateQueries({ queryKey: ["agent-sessions"] });
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    if (deciding.current.has(id) || proposals.get(id)?.status !== 'pending') return;
    deciding.current.add(id);
    setDecisions((state) => ({ ...state, [id]: { busy: true } }));
    try {
      const reply = await decideProposal(id, decision);
      setDecisions((state) => ({ ...state, [id]: { status: reply.status === "approved" ? "approved" : "rejected" } }));
      // 批准会经正常保存路径改动工程：工作台的数据全部按新修订重读
      if (decision === "approve") void queries.invalidateQueries();
      else void queries.invalidateQueries({ queryKey: ["agent-sessions"] });
      void queries.invalidateQueries({ queryKey: ['agent-session', currentRef.current] });
    } catch (error) {
      setDecisions((state) => ({ ...state, [id]: { error: error instanceof Error ? error.message : String(error) } }));
    } finally { deciding.current.delete(id); }
  }

  const stop = () => controller.current?.abort();

  return { id: current, turns, live, stop, proposals, decisions, sending, loading: record.isPending && !!current, error: record.error, send, decide, events: record.data?.events || [], reload: record.refetch };
}
