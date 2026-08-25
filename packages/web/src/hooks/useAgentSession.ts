import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AgentSession as TAgentSession, AgentEvent, Artifact } from '@en18031/shared';
import { AgentApi, type VerdictDraft, type AgentEvidence } from '../api/endpoints';
import {
  subscribeAgentSession,
  type AgentSessionHandlers,
  type AgentToolOutputChunk,
  type AgentToolResultPayload,
} from '../api/socket';
import type {
  AgentSessionState,
  AgentStep,
  HumanStepState,
  PhaseTransition,
  ToolCallState,
  TranscriptMessage,
} from '../components/agent/types';

type StepMap = Map<string, AgentStep>;

function nextOrder(state: AgentSessionState): number {
  // Use a synthetic counter so events without seq still order after prior ones.
  return state.orderCounter + 1;
}

export type AgentAction =
  | { type: 'init'; session: TAgentSession; events: AgentEvent[]; artifacts: Artifact[]; verdicts: VerdictDraft[]; evidences?: AgentEvidence[] }
  | { type: 'session'; patch: Partial<TAgentSession> }
  | { type: 'phase'; from: string; to: string; seq?: number }
  | { type: 'step_started'; stepRunId: string; stepType: string; phase?: string; title?: string; seq?: number }
  | { type: 'tool_call'; ev: AgentEvent & { toolCallId?: string } }
  | { type: 'tool_output'; p: AgentToolOutputChunk }
  | { type: 'tool_result'; p: AgentToolResultPayload }
  | { type: 'human_requested'; req: HumanStepState }
  | { type: 'human_completed'; stepRunId: string; fileRefs?: string[]; outcome?: string }
  | { type: 'evidence'; e: AgentEvidence }
  | { type: 'artifact'; a: Artifact }
  | { type: 'verdict'; v: VerdictDraft }
  | { type: 'verdict_updated'; v: Partial<VerdictDraft> & { id: string } }
  | { type: 'message'; role: string; content: string; seq?: number; id?: string }
  | { type: 'message_delta'; messageId: string; delta: string }
  | { type: 'progress'; stepRunId: string; percent?: number; message?: string }
  | { type: 'error'; message: string; stepRunId?: string }
  | { type: 'done'; status: string }
  | { type: 'events_backfill'; events: AgentEvent[] }
  | { type: 'connected'; connected: boolean }
  | { type: 'load_error'; error: string };

export function initialState(): AgentSessionState {
  return {
    session: null,
    loading: true,
    error: null,
    events: [],
    steps: new Map(),
    toolCalls: new Map(),
    humanSteps: new Map(),
    artifacts: [],
    evidences: [],
    verdicts: [],
    phases: [],
    messages: [],
    streaming: {},
    lastSeq: 0,
    orderCounter: 0,
    connected: false,
  };
}

function upsertStep(steps: StepMap, stepRunId: string, patch: Partial<AgentStep>): StepMap {
  const next = new Map(steps);
  const prev = next.get(stepRunId);
  next.set(stepRunId, { ...(prev ?? { id: stepRunId }), ...patch, id: stepRunId });
  return next;
}

function reconcileTool(prev: ToolCallState, p: AgentToolResultPayload): ToolCallState {
  const output = p.output ?? (p.stdout !== undefined || p.stderr !== undefined
    ? [p.stdout ?? '', p.stderr ?? ''].filter(Boolean).join('\n')
    : prev.output);
  return {
    ...prev,
    status: p.status,
    exitCode: p.exitCode ?? prev.exitCode,
    durationMs: p.durationMs ?? prev.durationMs,
    output,
    stdout: p.stdout ?? prev.stdout,
    stderr: p.stderr ?? prev.stderr,
    evidenceRefs: p.evidenceRefs ?? prev.evidenceRefs,
    artifactRefs: p.artifactRefs ?? prev.artifactRefs,
    error: p.error ?? prev.error,
    finishedAt: new Date().toISOString(),
  };
}

/** Safely parse a JSON string; return undefined for plain text/markdown. */
function tryParse<T>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

/** Replay a historical/backfill event through the same state transitions as live ones. */
function applyEvent(state: AgentSessionState, ev: AgentEvent): AgentSessionState {
  switch (ev.type) {
    case 'phase_change': {
      const p = tryParse<{ from?: string; to?: string }>(ev.content);
      return p?.to ? applyPhase(state, p, ev.seq) : state;
    }
    case 'tool_call': {
      const tcId = (ev.toolArgs?.toolCallId as string | undefined) ?? ev.stepRunId ?? ev.id;
      return applyToolCall(state, { ...ev, toolCallId: tcId });
    }
    case 'tool_result': {
      // In the event log, `content` is the tool's free-text output (markdown,
      // a status sentence, etc.); structured fields live as columns on the row.
      const stepRunId = ev.stepRunId ?? '';
      const status = ev.toolStatus === 'ok' ? 'success' : ev.toolStatus === 'error' ? 'fail' : ev.toolStatus ?? 'success';
      return applyToolResult(state, {
        stepRunId,
        toolCallId: stepRunId || ev.id,
        status,
        output: ev.content ?? '',
        durationMs: ev.latencyMs,
      });
    }
    case 'human_step': {
      // `content` is the human instruction in markdown, not JSON. The step
      // title was already set by the preceding step_started/tool_call event.
      const stepRunId = ev.stepRunId ?? '';
      if (!stepRunId) return state;
      return applyHumanRequested(state, {
        stepRunId,
        instruction: ev.content ?? '',
      });
    }
    case 'verdict_draft': {
      const v = tryParse<VerdictDraft>(ev.content);
      return v ? applyVerdict(state, v) : state;
    }
    case 'model_message':
    case 'user_message':
      return applyMessage(state, ev.role ?? ev.type, ev.content ?? '', ev.seq);
    case 'error':
      return { ...state, error: ev.content ?? ev.toolStatus ?? 'Agent 错误' };
    default:
      return state;
  }
}

function applyPhase(state: AgentSessionState, p: { from?: string; to?: string }, seq?: number): AgentSessionState {
  if (!p.to) return state;
  const transition: PhaseTransition = {
    seq: seq ?? state.lastSeq,
    from: p.from ?? state.session?.phase ?? '',
    to: p.to,
    at: new Date().toISOString(),
  };
  return {
    ...state,
    phases: [...state.phases, transition],
    orderCounter: nextOrder(state),
    session: state.session ? { ...state.session, phase: p.to as TAgentSession['phase'] } : state.session,
  };
}

function applyToolCall(state: AgentSessionState, ev: AgentEvent & { toolCallId?: string }): AgentSessionState {
  const toolCallId = ev.toolCallId ?? ev.stepRunId ?? ev.id;
  const stepRunId = ev.stepRunId ?? toolCallId;
  // Step bookkeeping events are emitted as tool_calls with toolName "step:<type>"
  // (the live socket path sends a separate step_started; replay only has this row).
  const stepMatch = ev.toolName?.match(/^step:(.+)$/);
  const syntheticStepType = stepMatch?.[1];
  const stepTitle = (ev.toolArgs?.title as string | undefined) ?? undefined;
  const existing = state.toolCalls.get(toolCallId);
  const tc: ToolCallState = existing ?? {
    toolCallId,
    stepRunId,
    toolName: ev.toolName ?? 'tool',
    args: ev.toolArgs,
    status: ev.toolStatus ?? 'running',
    output: '',
    stdout: '',
    stderr: '',
    startedAt: ev.createdAt,
  };
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(toolCallId, { ...tc, args: ev.toolArgs ?? tc.args, toolName: ev.toolName ?? tc.toolName, phase: tc.phase ?? state.session?.phase });
  let steps = state.steps;
  if (stepRunId) {
    steps = upsertStep(steps, stepRunId, {
      status: 'running',
      stepType: (syntheticStepType as AgentStep['stepType']) ?? 'tool_exec',
      phase: state.session?.phase,
      startedAt: ev.createdAt,
      ...(stepTitle ? { title: stepTitle } : {}),
    });
  }
  return { ...state, toolCalls, steps, orderCounter: nextOrder(state) };
}

function applyToolOutput(state: AgentSessionState, p: AgentToolOutputChunk): AgentSessionState {
  const existing = state.toolCalls.get(p.toolCallId);
  if (!existing) {
    // Tool result may arrive before any tool_call (late subscription); seed a minimal card.
    const seeded: ToolCallState = {
      toolCallId: p.toolCallId,
      stepRunId: p.stepRunId,
      toolName: 'tool',
      status: 'running',
      output: '',
      stdout: '',
      stderr: '',
    };
    const toolCalls = new Map(state.toolCalls);
    const field = p.stream === 'stderr' ? 'stderr' : 'stdout';
    toolCalls.set(p.toolCallId, { ...seeded, [field]: seeded[field] + p.chunk, output: seeded.output + p.chunk });
    return { ...state, toolCalls };
  }
  const toolCalls = new Map(state.toolCalls);
  const field = p.stream === 'stderr' ? 'stderr' : 'stdout';
  toolCalls.set(p.toolCallId, { ...existing, [field]: existing[field] + p.chunk, output: existing.output + p.chunk });
  return { ...state, toolCalls };
}

function applyToolResult(state: AgentSessionState, p: AgentToolResultPayload): AgentSessionState {
  const existing = state.toolCalls.get(p.toolCallId);
  const base: ToolCallState = existing ?? {
    toolCallId: p.toolCallId,
    stepRunId: p.stepRunId,
    toolName: 'tool',
    status: p.status,
    output: '',
    stdout: '',
    stderr: '',
  };
  const reconciled = reconcileTool(base, p);
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(p.toolCallId, reconciled);
  let steps = state.steps;
  if (p.stepRunId) {
    steps = upsertStep(steps, p.stepRunId, {
      id: p.stepRunId,
      status: (p.status === 'success' ? 'success' : p.status === 'fail' ? 'fail' : 'running'),
      exitCode: p.exitCode,
      durationMs: p.durationMs,
      finishedAt: reconciled.finishedAt,
    });
  }
  return { ...state, toolCalls, steps, orderCounter: nextOrder(state) };
}

function applyHumanRequested(state: AgentSessionState, req: Omit<HumanStepState, 'completed'>): AgentSessionState {
  const humanSteps = new Map(state.humanSteps);
  humanSteps.set(req.stepRunId, { ...req, completed: false });
  let steps = state.steps;
  steps = upsertStep(steps, req.stepRunId, {
    id: req.stepRunId,
    status: 'running',
    stepType: 'human_instruction',
    phase: req.phase,
    functionModule: req.functionModule,
    instruction: req.instruction,
    expectedOutcome: req.expectedOutcome,
    ...(req.title ? { title: req.title } : {}),
  });
  return {
    ...state,
    humanSteps,
    steps,
    session: state.session ? { ...state.session, status: 'waiting_human', currentStepId: req.stepRunId } : state.session,
    orderCounter: nextOrder(state),
  };
}

function applyHumanCompleted(state: AgentSessionState, stepRunId: string, fileRefs?: string[], outcome?: string): AgentSessionState {
  const humanSteps = new Map(state.humanSteps);
  const prev = humanSteps.get(stepRunId);
  if (prev) humanSteps.set(stepRunId, { ...prev, completed: true, fileRefs, outcome, completedAt: new Date().toISOString() });
  let steps = state.steps;
  steps = upsertStep(steps, stepRunId, { id: stepRunId, status: 'success', finishedAt: new Date().toISOString() });
  return {
    ...state,
    humanSteps,
    steps,
    session: state.session ? { ...state.session, status: 'running' } : state.session,
    orderCounter: nextOrder(state),
  };
}

function applyVerdict(state: AgentSessionState, v: VerdictDraft): AgentSessionState {
  const exists = state.verdicts.some((x) => x.id === v.id);
  const verdicts = exists ? state.verdicts.map((x) => (x.id === v.id ? { ...x, ...v } : x)) : [...state.verdicts, v];
  return { ...state, verdicts, orderCounter: nextOrder(state) };
}

function applyMessage(state: AgentSessionState, role: string, content: string, seq?: number): AgentSessionState {
  const msg: TranscriptMessage = { role, content, at: new Date().toISOString() };
  return { ...state, messages: [...state.messages, msg], lastSeq: seq ?? state.lastSeq, orderCounter: nextOrder(state) };
}

export function reducer(state: AgentSessionState, action: AgentAction): AgentSessionState {
  switch (action.type) {
    case 'init': {
      let s: AgentSessionState = {
        ...state,
        session: action.session,
        artifacts: action.artifacts,
        verdicts: action.verdicts,
        evidences: action.evidences ?? [],
        loading: false,
        error: null,
        lastSeq: action.events.reduce((m, e) => Math.max(m, e.seq), 0),
      };
      for (const ev of action.events) s = applyEvent(s, ev);
      s.events = action.events.slice().sort((a, b) => a.seq - b.seq);
      return s;
    }
    case 'session':
      return { ...state, session: state.session ? { ...state.session, ...action.patch } : state.session };
    case 'phase':
      return applyPhase(state, { from: action.from, to: action.to }, action.seq);
    case 'step_started': {
      const steps = upsertStep(state.steps, action.stepRunId, {
        id: action.stepRunId,
        status: 'running',
        stepType: action.stepType,
        phase: action.phase,
        ...(action.title ? { title: action.title } : {}),
        startedAt: new Date().toISOString(),
      });
      return { ...state, steps, orderCounter: nextOrder(state) };
    }
    case 'tool_call':
      return applyToolCall(state, action.ev);
    case 'tool_output':
      return applyToolOutput(state, action.p);
    case 'tool_result':
      return applyToolResult(state, action.p);
    case 'human_requested':
      return applyHumanRequested(state, action.req);
    case 'human_completed':
      return applyHumanCompleted(state, action.stepRunId, action.fileRefs, action.outcome);
    case 'evidence':
      return { ...state, evidences: [...state.evidences, action.e] };
    case 'artifact':
      return state.artifacts.some((a) => a.id === action.a.id)
        ? { ...state, artifacts: state.artifacts.map((a) => (a.id === action.a.id ? action.a : a)) }
        : { ...state, artifacts: [...state.artifacts, action.a] };
    case 'verdict':
      return applyVerdict(state, action.v);
    case 'verdict_updated': {
      const verdicts = state.verdicts.map((v) => (v.id === action.v.id ? { ...v, ...action.v } : v));
      return { ...state, verdicts };
    }
    case 'message': {
      // 按 id 幂等：同一事件可能经 socket(多连接)/回补/乐观路径重复到达
      if (action.id && state.events.some((e) => e.id === action.id)) {
        return Object.keys(state.streaming).length > 0 ? { ...state, streaming: {} } : state;
      }
      // assistant 正式消息到达 → 清空流式缓冲
      const cleared =
        action.role === 'assistant' && Object.keys(state.streaming).length > 0 ? { streaming: {} } : {};
      let ns = applyMessage({ ...state, ...cleared }, action.role, action.content, action.seq);
      if (action.id) {
        const synthetic: AgentEvent = {
          id: action.id,
          seq: action.seq ?? ns.lastSeq + 1,
          sessionId: state.session?.id ?? '',
          type: action.role === 'user' ? 'user_message' : 'model_message',
          role: action.role,
          content: action.content,
        } as unknown as AgentEvent;
        ns = { ...ns, events: [...ns.events, synthetic] };
      }
      return ns;
    }
    case 'progress':
      return state; // progress is surfaced inside cards via their own status; no global state needed
    case 'error':
      return { ...state, error: action.message };
    case 'done':
      return {
        ...state,
        session: state.session ? { ...state.session, status: action.status as TAgentSession['status'], finishedAt: new Date().toISOString() } : state.session,
      };
    case 'message_delta': {
      const prev = state.streaming[action.messageId] ?? '';
      return { ...state, streaming: { ...state.streaming, [action.messageId]: prev + action.delta } };
    }
    case 'events_backfill': {
      const known = new Set(state.events.map((e) => e.id));
      const merged = [...state.events, ...action.events.filter((e) => !known.has(e.id))].sort((a, b) => a.seq - b.seq);
      let s = { ...state, events: merged, lastSeq: merged.reduce((m, e) => Math.max(m, e.seq), state.lastSeq) };
      // Replay only the newly fetched events to fill any state gaps.
      for (const ev of action.events) if (!known.has(ev.id)) s = applyEvent(s, ev);
      return s;
    }
    case 'connected':
      return { ...state, connected: action.connected };
    case 'load_error':
      return { ...state, loading: false, error: action.error };
    default:
      return state;
  }
}

/** Build a flat, ordered timeline from state maps for rendering. */
export function buildTimeline(state: AgentSessionState) {
  const entries: Array<{ key: string; kind: string; order: number; phase?: string; at?: string; data?: unknown }> = [];
  for (const ph of state.phases) {
    entries.push({ key: `phase-${ph.seq}-${ph.to}`, kind: 'phase', order: ph.seq, phase: ph.to, at: ph.at, data: ph });
  }
  for (const [id, step] of state.steps) {
    const stepType = step.stepType ?? 'tool_exec';
    entries.push({
      key: `step-${id}`,
      kind: stepType === 'human_instruction' ? 'human' : stepType === 'evidence_attach' ? 'step' : 'step',
      order: Date.parse(step.startedAt ?? '') || 0,
      phase: step.phase,
      at: step.startedAt,
      data: step,
    });
  }
  for (const tc of state.toolCalls.values()) {
    entries.push({
      key: `tool-${tc.toolCallId}`,
      kind: 'tool',
      order: Date.parse(tc.startedAt ?? '') || 0,
      phase: state.session?.phase,
      at: tc.startedAt,
      data: tc,
    });
  }
  for (const hs of state.humanSteps.values()) {
    entries.push({
      key: `human-${hs.stepRunId}`,
      kind: 'human',
      order: Date.parse(state.steps.get(hs.stepRunId)?.startedAt ?? '') || 0,
      phase: hs.phase,
      data: hs,
    });
  }
  for (const m of state.messages) {
    entries.push({ key: `msg-${entries.length}`, kind: 'message', order: Date.parse(m.at ?? '') || 0, data: m });
  }
  entries.sort((a, b) => a.order - b.order);
  return entries;
}

export interface UseAgentSessionResult {
  state: AgentSessionState;
  session: TAgentSession | null;
  events: AgentEvent[];
  timeline: ReturnType<typeof buildTimeline>;
  artifacts: Artifact[];
  evidences: AgentEvidence[];
  verdicts: VerdictDraft[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  /** Mark a human step complete (also calls API). */
  completeHumanStep: (stepRunId: string, body: Parameters<typeof AgentApi.completeHumanStep>[2]) => Promise<void>;
  /** Send a user message into the session. */
  sendMessage: (content: string) => Promise<void>;
  /** Review a verdict (approve/reject/request_evidence). */
  reviewVerdict: (verdictId: string, action: 'approve' | 'reject' | 'request_evidence', reason?: string) => Promise<void>;
  /** Retry all agent steps bound to a clause. */
  retryClause: (clauseId: string) => Promise<void>;
  start: () => Promise<void>;
  abort: () => Promise<void>;
}

export function useAgentSession(sessionId: string | undefined): UseAgentSessionResult {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const lastSeqRef = useRef(0);
  const backfillTimer = useRef<ReturnType<typeof setInterval>>();
  const pollTimer = useRef<ReturnType<typeof setInterval>>();
  const handlersRef = useRef<AgentSessionHandlers>({});

  // Initial load: session + historical events + artifacts + verdicts.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const [session, events, artifacts, verdicts] = await Promise.all([
          AgentApi.get(sessionId),
          AgentApi.events(sessionId, 0).catch(() => [] as AgentEvent[]),
          AgentApi.artifacts(sessionId).catch(() => [] as Artifact[]),
          AgentApi.verdicts(sessionId).catch(() => [] as VerdictDraft[]),
        ]);
        if (cancelled) return;
        const maxSeq = events.reduce((m, e) => Math.max(m, e.seq), 0);
        lastSeqRef.current = maxSeq;
        dispatch({ type: 'init', session, events, artifacts, verdicts });
      } catch (e) {
        if (!cancelled) dispatch({ type: 'load_error', error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Live socket subscription. Handlers always read latest dispatch via ref.
  handlersRef.current = {
    onSession: (patch) => dispatch({ type: 'session', patch }),
    onPhase: (p) => { lastSeqRef.current = Math.max(lastSeqRef.current, p.seq ?? 0); dispatch({ type: 'phase', from: p.from, to: p.to, seq: p.seq }); },
    onStepStarted: (p) => { lastSeqRef.current = Math.max(lastSeqRef.current, p.seq ?? 0); dispatch({ type: 'step_started', ...p }); },
    onToolCall: (ev) => {
      const toolCallId = (ev.toolArgs?.toolCallId as string | undefined) ?? ev.stepRunId ?? ev.id;
      lastSeqRef.current = Math.max(lastSeqRef.current, ev.seq);
      dispatch({ type: 'tool_call', ev: { ...ev, toolCallId } });
    },
    onToolOutput: (p) => dispatch({ type: 'tool_output', p }),
    onToolResult: (p) => dispatch({ type: 'tool_result', p }),
    onHumanStepRequested: (req) => dispatch({ type: 'human_requested', req: { ...req, completed: false } }),
    onHumanStepCompleted: (p) => dispatch({ type: 'human_completed', stepRunId: p.stepRunId, fileRefs: p.fileRefs }),
    onEvidenceAttached: (e) => dispatch({ type: 'evidence', e }),
    onArtifactWritten: (a) => dispatch({ type: 'artifact', a }),
    onVerdictDrafted: (v) => dispatch({ type: 'verdict', v }),
    onVerdictUpdated: (v) => dispatch({ type: 'verdict_updated', v }),
    onMessage: (p) => { dispatch({ type: 'message', role: p.role, content: p.content, seq: p.seq, id: p.id }); },
    onMessageDelta: (p) => { dispatch({ type: 'message_delta', messageId: p.messageId, delta: p.delta }); },
    onError: (p) => dispatch({ type: 'error', message: p.message }),
    onDone: (p) => dispatch({ type: 'done', status: p.status }),
  };

  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribeAgentSession(sessionId, new Proxy(handlersRef.current, {
      // Always route to the latest handler closures without re-subscribing.
      get: (_t, prop) => (handlersRef.current as Record<string | symbol, unknown>)[prop],
    }));
    dispatch({ type: 'connected', connected: true });
    return () => {
      unsub();
      dispatch({ type: 'connected', connected: false });
    };
  }, [sessionId]);

  // Gap backfill on reconnect: periodically fetch events since lastSeq.
  useEffect(() => {
    if (!sessionId) return;
    backfillTimer.current = setInterval(() => {
      if (!sessionId) return;
      const since = lastSeqRef.current;
      AgentApi.events(sessionId, since)
        .then((evs) => {
          if (evs.length > 0) {
            lastSeqRef.current = evs.reduce((m, e) => Math.max(m, e.seq), since);
            dispatch({ type: 'events_backfill', events: evs });
          }
        })
        .catch(() => { /* ignore transient gap-fill errors */ });
    }, 5000);
    return () => {
      if (backfillTimer.current) clearInterval(backfillTimer.current);
    };
  }, [sessionId]);

  // 3s session status poll as a safety net (per implementation plan §6).
  useEffect(() => {
    if (!sessionId) return;
    pollTimer.current = setInterval(() => {
      AgentApi.get(sessionId).then((s) => dispatch({ type: 'session', patch: s })).catch(() => {});
    }, 3000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [sessionId]);

  const completeHumanStep = useCallback(async (stepRunId: string, body: Parameters<typeof AgentApi.completeHumanStep>[2]) => {
    if (!sessionId) return;
    try {
      const step = await AgentApi.completeHumanStep(sessionId, stepRunId, body);
      dispatch({ type: 'human_completed', stepRunId, fileRefs: body.fileRefs, outcome: body.outcome });
      if (step) {
        // keep step status in sync with backend response
        dispatch({ type: 'step_started', stepRunId, stepType: 'human_instruction' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('已结束') || msg.includes('不在等待状态')) {
        // 状态漂移（他人已完成/超时/服务重启恢复）：静默重拉全量状态，不再弹错误
        try {
          const [session, events, artifacts, verdicts] = await Promise.all([
            AgentApi.get(sessionId),
            AgentApi.events(sessionId, 0).catch(() => [] as AgentEvent[]),
            AgentApi.artifacts(sessionId).catch(() => [] as Artifact[]),
            AgentApi.verdicts(sessionId).catch(() => [] as VerdictDraft[]),
          ]);
          lastSeqRef.current = events.reduce((m, e) => Math.max(m, e.seq), 0);
          dispatch({ type: 'init', session, events, artifacts, verdicts });
        } catch { /* 刷新失败则保留原状 */ }
        return;
      }
      throw err;
    }
  }, [sessionId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId || !content.trim()) return;
    // 不做乐观本地追加：服务端落库后经 agent:message 回显（带事件 id，前端按 id 去重）
    await AgentApi.sendMessage(sessionId, content);
  }, [sessionId]);

  const reviewVerdict = useCallback(
    async (verdictId: string, action: 'approve' | 'reject' | 'request_evidence', reason?: string) => {
      if (!sessionId) return;
      if (action === 'request_evidence') {
        // 补采 = 退回 B 阶段按条款重跑：从本地判定表取 clauseId 调 retry 端点；
        // 本地先标 skipped，会话回退/重启事件经 socket 到达后驱动其余状态。
        const clauseId = state.verdicts.find((v) => v.id === verdictId)?.clauseId;
        if (!clauseId) throw new Error('无法定位判定对应的条款');
        await AgentApi.retryClause(sessionId, clauseId);
        dispatch({
          type: 'verdict_updated',
          v: { id: verdictId, reviewStatus: 'skipped', reviewNote: reason || '已退回补采' },
        });
        return;
      }
      const v =
        action === 'approve'
          ? await AgentApi.approveVerdict(verdictId)
          : await AgentApi.rejectVerdict(verdictId, reason ?? '');
      dispatch({
        type: 'verdict_updated',
        v: { id: verdictId, reviewStatus: v.reviewStatus, reviewNote: v.reviewNote },
      });
    },
    [sessionId, state.verdicts],
  );

  const retryClause = useCallback(async (clauseId: string) => {
    if (!sessionId) return;
    const s = await AgentApi.retryClause(sessionId, clauseId);
    dispatch({ type: 'session', patch: s });
  }, [sessionId]);

  const start = useCallback(async () => {
    if (!sessionId) return;
    const s = await AgentApi.start(sessionId);
    dispatch({ type: 'session', patch: s });
  }, [sessionId]);

  const abort = useCallback(async () => {
    if (!sessionId) return;
    const s = await AgentApi.abort(sessionId);
    dispatch({ type: 'session', patch: s });
  }, [sessionId]);

  const timeline = buildTimeline(state);

  return {
    state,
    session: state.session,
    events: state.events,
    timeline,
    artifacts: state.artifacts,
    evidences: state.evidences,
    verdicts: state.verdicts,
    loading: state.loading,
    error: state.error,
    connected: state.connected,
    completeHumanStep,
    sendMessage,
    reviewVerdict,
    retryClause,
    start,
    abort,
  };
}
