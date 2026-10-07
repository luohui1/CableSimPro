import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentSession, agentStatus, AgentUnavailable, createSession, decideProposal, sendMessage, type AgentProposal } from "./agent-api";
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
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const liveProposals = useRef(new Map<string, AgentProposal>());

  // 外部切换任务（或点“新任务”）时换会话；自己刚建的会话回写到地址时不打断正在进行的一轮
  useEffect(() => {
    if (sessionId === currentRef.current) return;
    currentRef.current = sessionId;
    setCurrent(sessionId); setLive(null); setDecisions({}); liveProposals.current = new Map();
  }, [sessionId]);

  const record = useQuery({ queryKey: ["agent-session", current], queryFn: ({ signal }) => agentSession(current!, signal), enabled: !!current, staleTime: 5_000 });
  const turns = useMemo(() => (record.data ? buildTurns(record.data) : []), [record.data]);
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

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending || !workspaceId) return;
    setSending(true);
    let turn = newTurn(content);
    setLive(turn);
    let id = currentRef.current;
    try {
      if (!id) {
        id = (await createSession(workspaceId, studyId)).id;
        currentRef.current = id; setCurrent(id); onCreated?.(id);
      }
      await sendMessage(id, content, (event) => { turn = applyEvent(turn, event, liveProposals.current); setLive(turn); });
      await queries.fetchQuery({ queryKey: ["agent-session", id], queryFn: ({ signal }) => agentSession(id!, signal) });
      setLive(null);
    } catch (error) {
      setLive({ ...turn, running: false, notices: [...turn.notices, { text: error instanceof Error ? error.message : String(error) }] });
    } finally {
      setSending(false);
      void queries.invalidateQueries({ queryKey: ["agent-sessions"] });
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setDecisions((state) => ({ ...state, [id]: { busy: true } }));
    try {
      const reply = await decideProposal(id, decision);
      setDecisions((state) => ({ ...state, [id]: { status: reply.status === "approved" ? "approved" : "rejected" } }));
      // 批准会经正常保存路径改动工程：工作台的数据全部按新修订重读
      if (decision === "approve") void queries.invalidateQueries();
      else void queries.invalidateQueries({ queryKey: ["agent-sessions"] });
    } catch (error) {
      setDecisions((state) => ({ ...state, [id]: { error: error instanceof Error ? error.message : String(error) } }));
    }
  }

  return { id: current, turns, live, proposals, decisions, sending, loading: record.isPending && !!current, error: record.error, send, decide };
}
