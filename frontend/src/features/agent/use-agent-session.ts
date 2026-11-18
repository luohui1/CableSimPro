import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentSession, agentStatus, AgentUnavailable, createSession, decideProposal, sendMessage, type AgentProposal, type RecipeCall } from "./agent-api";
import { applyEvent, buildTurns, newTurn, type Turn } from "./transcript";
import { AgentTurnOwner, submittedQuestionMatches, type TurnOperation } from './session-operation';

export type Decision = { busy?: boolean; error?: string; status?: AgentProposal["status"] };

export function useAgentStatus() {
  const status = useQuery({ queryKey: ["agent-status"], queryFn: ({ signal }) => agentStatus(signal), retry: false, staleTime: 60_000 });
  const ready = !!status.data?.configured;
  const label = ready ? status.data?.model || "已连接" : status.error instanceof AgentUnavailable ? "服务尚未部署" : status.isPending ? "检查中" : "未连接模型";
  const hint = status.isPending ? '正在检查模型连接，请稍候。'
    : status.error ? '无法读取模型连接状态，请重新连接；已保存的任务仍可查看。'
      : !ready ? '还没有连接 AI 模型。在设置里填写服务地址、模型名和密钥后即可使用。' : '';
  return { ready, canSend: ready, label, hint, loading: status.isPending, error: status.error, retry: status.refetch };
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
  const [awaitingRecord, setAwaitingRecord] = useState(false);
  const sendingRef = useRef(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const deciding = useRef(new Set<string>());
  const liveProposals = useRef(new Map<string, AgentProposal>());
  const controller = useRef<AbortController | null>(null);
  const liveBoundary = useRef(0);
  const generation = useRef(0);
  const owner = useRef(new AgentTurnOwner());
  const settleTimer = useRef<number | undefined>(undefined);
  const scope = useRef({ workspaceId, studyId });
  const clearSettleTimer = () => { if (settleTimer.current !== undefined) window.clearTimeout(settleTimer.current); settleTimer.current = undefined; };
  useEffect(() => () => { generation.current++; owner.current.reset(); clearSettleTimer(); controller.current?.abort(); }, []);

  // 外部切换任务（或点“新任务”）时换会话；自己刚建的会话回写到地址时不打断正在进行的一轮
  useLayoutEffect(() => {
    const scopeChanged = scope.current.workspaceId !== workspaceId || scope.current.studyId !== studyId;
    scope.current = { workspaceId, studyId };
    // A known session has immutable scope. A new session still being created belongs to the selected object.
    if (sessionId === currentRef.current && (!scopeChanged || !!sessionId)) return;
    generation.current++;
    owner.current.reset(); clearSettleTimer(); setAwaitingRecord(false);
    controller.current?.abort(); controller.current = null;
    sendingRef.current = false; setSending(false);
    currentRef.current = sessionId;
    setCurrent(sessionId); setLive(null); setDecisions({}); liveProposals.current = new Map();
  }, [sessionId, workspaceId, studyId]);

  const record = useQuery({ queryKey: ["agent-session", current], queryFn: ({ signal }) => agentSession(current!, signal), enabled: !!current, staleTime: 5_000,
    // A failed/early first read after a disconnect must not stop reconciliation.
    refetchInterval: query => !sending && (awaitingRecord || ['planning', 'running'].includes(query.state.data?.state || '')) ? 3000 : false });
  const contextError = useMemo(() => record.data && (record.data.id !== current
    || workspaceId && record.data.workspace_id !== workspaceId || studyId && record.data.study_id !== studyId)
    ? new Error('任务记录与当前工作对象不一致，请重新读取任务列表后再继续。') : null,
  [record.data, current, workspaceId, studyId]);
  const serverRunning = ['planning', 'running'].includes(record.data?.state || '');
  const blockedReason = contextError?.message || (record.error ? '任务记录读取失败。请先重新读取并确认已有操作，再继续发送。'
    : record.isPending && !!current ? '正在读取任务记录，请稍候。'
      : serverRunning && !sending ? '服务端仍在处理上一条任务。可以先编辑下一条，等待任务记录确认结束后再发送。'
        : awaitingRecord && !sending ? owner.current.current?.uncertain
          ? '上一条请求是否已接收仍待记录确认。可以编辑草稿，核对前请勿重复发送。'
          : '已接收上一条任务，正在核对保存记录。请确认结果后再发送，避免重复执行。' : '');
  const canContinue = !blockedReason;
  useEffect(() => {
    const operation = owner.current.current;
    if (sending || !live || live.running || !record.data || contextError || !operation) return;
    if (owner.current.finish(operation, record.data)) {
      setAwaitingRecord(false);
      setLive(value => value?.id === operation.liveId ? null : value);
    } else if (operation.uncertain && !record.error && !record.isFetching && !serverRunning && !submittedQuestionMatches(operation, record.data)) {
      // A pre-header abort/network failure needs one successful read before retry.
      // If this question never reached the record, retain the draft and local notice.
      operation.uncertain = false;
      setAwaitingRecord(false);
    }
  }, [record.data, record.error, record.isFetching, live, sending, serverRunning, contextError]);
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
  async function settle(operation: TurnOperation, at: number) {
    const id = operation.sessionId;
    const active = () => at === generation.current && id === currentRef.current && owner.current.owns(operation);
    if (!id || !active()) return;
    try {
      const saved = await queries.fetchQuery({ queryKey: ["agent-session", id], queryFn: ({ signal }) => agentSession(id, signal), staleTime: 0 });
      if (active() && owner.current.finish(operation, saved)) {
        setAwaitingRecord(false);
        setLive(value => value?.id === operation.liveId ? null : value);
      }
    } catch { /* 记录读不到时保留临时显示 */ }
  }

  async function send(text: string, recipe?: RecipeCall, onAccepted?: () => void) {
    const content = text.trim();
    if (!content || sendingRef.current || !workspaceId || !canContinue || owner.current.current?.accepted || owner.current.current?.uncertain) return;
    const at = generation.current;
    const request = new AbortController();
    clearSettleTimer();
    controller.current = request;
    sendingRef.current = true;
    liveBoundary.current = record.data?.events.at(-1)?.sequence ?? 0;
    setSending(true);
    let turn = newTurn(content);
    const operation = owner.current.begin({ sessionId: currentRef.current, question: content, boundary: liveBoundary.current, liveId: turn.id });
    const ownsRequest = () => at === generation.current && controller.current === request;
    const active = () => at === generation.current && owner.current.owns(operation);
    let accepted = false, submitted = false;
    setLive(turn);
    let id = currentRef.current;
    try {
      if (!id) {
        id = (await createSession(workspaceId, studyId, request.signal)).id;
        if (!active()) return;
        operation.sessionId = id;
        currentRef.current = id; setCurrent(id); onCreated?.(id);
      }
      submitted = true;
      await sendMessage(id, content, event => {
        if (!active()) return;
        turn = applyEvent(turn, event, liveProposals.current); setLive(turn);
      }, request.signal, recipe, () => {
        accepted = true;
        if (active()) { operation.accepted = true; setAwaitingRecord(true); onAccepted?.(); }
      });
      if (!active()) return;
      turn = { ...turn, running: false };
      setLive(turn);
      await settle(operation, at);
    } catch (error) {
      if (!active()) return;
      const stopped = request.signal.aborted;
      const uncertain = submitted && !accepted && (stopped || error instanceof TypeError);
      if (uncertain) { operation.uncertain = true; setAwaitingRecord(true); }
      setLive({ ...turn, running: false, interrupted: accepted || uncertain || stopped,
        ...(!accepted && !uncertain && !stopped ? { task: { state: 'failed' } } : {}),
        notices: [...turn.notices, { text: stopped ? '已停止接收。已经开始的步骤由服务端收尾，结果以任务记录为准。'
          : uncertain ? '对话连接已断开，正在读取任务记录确认请求是否被接收。输入仍保留，核对前请勿重复发送。'
          : error instanceof Error ? error.message : String(error) }] });
      // A stopped browser stream is not a cancelled server task. Keep every received proposal until the saved record confirms it.
      if (id && accepted) settleTimer.current = window.setTimeout(() => {
        settleTimer.current = undefined;
        void settle(operation, at);
      }, stopped ? 1500 : 0);
      // A fetch abort before response headers cannot prove that the POST was rejected.
      // Also refresh after a definitive 409 so a concurrent server turn blocks a retry.
      else if (id && submitted) await settle(operation, at);
    } finally {
      if (ownsRequest()) { controller.current = null; sendingRef.current = false; setSending(false); }
      void queries.invalidateQueries({ queryKey: ['agent-sessions'] });
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    if (deciding.current.has(id) || proposals.get(id)?.status !== 'pending') return;
    const at = generation.current, session = currentRef.current;
    deciding.current.add(id);
    setDecisions((state) => ({ ...state, [id]: { busy: true } }));
    try {
      const reply = await decideProposal(id, decision);
      if (!['approved', 'rejected'].includes(reply.status)) throw new Error('未收到有效的审核回执，请重新读取任务确认结果。');
      if (at === generation.current) setDecisions((state) => ({ ...state, [id]: { status: reply.status as AgentProposal['status'] } }));
      // 批准会经正常保存路径改动工程：工作台的数据全部按新修订重读
      if (decision === "approve") void queries.invalidateQueries();
      else void queries.invalidateQueries({ queryKey: ["agent-sessions"] });
      void queries.invalidateQueries({ queryKey: ['agent-session', session] });
    } catch (error) {
      if (at === generation.current) setDecisions((state) => ({ ...state, [id]: { error: error instanceof Error ? error.message : String(error) } }));
    } finally { deciding.current.delete(id); }
  }

  const stop = () => controller.current?.abort();

  return { id: current, turns, live, stop, proposals, decisions, sending, serverRunning, awaitingRecord, canContinue, blockedReason,
    sessionContext: record.data?.id === current && record.data ? { workspaceId: record.data.workspace_id, studyId: record.data.study_id ?? undefined } : undefined,
    loading: record.isPending && !!current && !live, error: contextError || record.error,
    send, decide, events: record.data?.events || [], reload: record.refetch };
}
