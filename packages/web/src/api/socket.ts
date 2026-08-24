import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  AgentSession,
  Artifact,
  AgentEvent,
} from '@en18031/shared';
import type {
  VerdictDraft,
  HumanStepRequest,
  AgentEvidence,
} from './endpoints';

export interface RunStreamEvents {
  onLogLine?: (p: {
    runId: string;
    stepRunId?: string;
    stepId?: string;
    line: string;
    stream?: 'stdout' | 'stderr';
  }) => void;
  onProgress?: (p: {
    runId: string;
    stepRunId?: string;
    stepId?: string;
    percent?: number;
    message?: string;
  }) => void;
  onStatus?: (p: {
    runId: string;
    stepRunId?: string;
    stepId?: string;
    status: string;
    percent?: number;
    exitCode?: number;
    durationMs?: number;
    resolvedCommand?: string;
    message?: string;
  }) => void;
  onBatchProgress?: (p: { runId: string; percent: number; status?: string }) => void;
}

export function subscribeRun(runId: string, handlers: RunStreamEvents): () => void {
  const socket: Socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => socket.emit('subscribe', { runId }));
  if (handlers.onLogLine) socket.on('run:logLine', handlers.onLogLine);
  if (handlers.onProgress) socket.on('run:progress', handlers.onProgress);
  if (handlers.onStatus) socket.on('run:status', handlers.onStatus);
  if (handlers.onBatchProgress) socket.on('run:batchProgress', handlers.onBatchProgress);
  return () => {
    socket.emit('unsubscribe', { runId });
    socket.disconnect();
  };
}

export function useRunStream(runId: string | undefined, handlers: RunStreamEvents): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!runId) return;
    const unsub = subscribeRun(runId, {
      onLogLine: (p) => ref.current.onLogLine?.(p),
      onProgress: (p) => ref.current.onProgress?.(p),
      onStatus: (p) => ref.current.onStatus?.(p),
      onBatchProgress: (p) => ref.current.onBatchProgress?.(p),
    });
    return unsub;
  }, [runId]);
}

// ===== Agent session event stream =====

/** Per-tool-call output chunk reconciled by tool_result later. */
export interface AgentToolOutputChunk {
  stepRunId: string;
  toolCallId: string;
  stream?: 'stdout' | 'stderr';
  chunk: string;
}

export interface AgentToolResultPayload {
  stepRunId: string;
  toolCallId: string;
  status: string;
  exitCode?: number;
  durationMs?: number;
  output?: string;
  stdout?: string;
  stderr?: string;
  evidenceRefs?: string[];
  artifactRefs?: string[];
  error?: { message?: string };
}

export interface AgentStepStartedPayload {
  stepRunId: string;
  stepType: string;
  phase?: string;
  title?: string;
  seq?: number;
}

export interface AgentSessionHandlers {
  onSession?: (session: Partial<AgentSession>) => void;
  onPhase?: (p: { from: string; to: string; seq?: number }) => void;
  onStepStarted?: (p: AgentStepStartedPayload) => void;
  onToolCall?: (p: AgentEvent & { toolCallId?: string }) => void;
  onToolOutput?: (p: AgentToolOutputChunk) => void;
  onToolResult?: (p: AgentToolResultPayload) => void;
  onHumanStepRequested?: (p: HumanStepRequest) => void;
  onHumanStepCompleted?: (p: { stepRunId: string; fileRefs?: string[] }) => void;
  onEvidenceAttached?: (e: AgentEvidence) => void;
  onArtifactWritten?: (a: Artifact) => void;
  onVerdictDrafted?: (v: VerdictDraft) => void;
  onVerdictUpdated?: (v: Partial<VerdictDraft> & { id: string }) => void;
  onMessage?: (p: { role: string; content: string; seq?: number }) => void;
  onWaitingConfirm?: (p: { request: { targetPhase: string; reason?: string } }) => void;
  onProgress?: (p: { stepRunId: string; percent?: number; message?: string }) => void;
  onError?: (p: { message: string; stepRunId?: string }) => void;
  onDone?: (p: { status: string }) => void;
  /** Raw pass-through for any other event, keyed by socket event name. */
  onRaw?: (event: string, payload: unknown) => void;
}

const AGENT_SOCKET_EVENTS = [
  'agent:session',
  'agent:phase',
  'agent:step_started',
  'agent:tool_call',
  'agent:tool_output',
  'agent:tool_result',
  'agent:human_step_requested',
  'agent:human_step_completed',
  'agent:evidence_attached',
  'agent:artifact_written',
  'agent:verdict_drafted',
  'agent:verdict_updated',
  'agent:message',
  'agent:waiting_confirm',
  'agent:progress',
  'agent:error',
  'agent:done',
] as const;

export function subscribeAgentSession(sessionId: string, handlers: AgentSessionHandlers): () => void {
  const socket: Socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => socket.emit('subscribe', { room: `agent:${sessionId}` }));

  const dispatch: Record<string, ((p: never) => void) | undefined> = {
    'agent:session': handlers.onSession as (p: never) => void,
    'agent:phase': handlers.onPhase as (p: never) => void,
    'agent:step_started': handlers.onStepStarted as (p: never) => void,
    'agent:tool_call': handlers.onToolCall as (p: never) => void,
    'agent:tool_output': handlers.onToolOutput as (p: never) => void,
    'agent:tool_result': handlers.onToolResult as (p: never) => void,
    'agent:human_step_requested': handlers.onHumanStepRequested as (p: never) => void,
    'agent:human_step_completed': handlers.onHumanStepCompleted as (p: never) => void,
    'agent:evidence_attached': handlers.onEvidenceAttached as (p: never) => void,
    'agent:artifact_written': handlers.onArtifactWritten as (p: never) => void,
    'agent:verdict_drafted': handlers.onVerdictDrafted as (p: never) => void,
    'agent:verdict_updated': handlers.onVerdictUpdated as (p: never) => void,
    'agent:message': handlers.onMessage as (p: never) => void,
    'agent:waiting_confirm': handlers.onWaitingConfirm as (p: never) => void,
    'agent:progress': handlers.onProgress as (p: never) => void,
    'agent:error': handlers.onError as (p: never) => void,
    'agent:done': handlers.onDone as (p: never) => void,
  };

  for (const ev of AGENT_SOCKET_EVENTS) {
    socket.on(ev, (payload: unknown) => {
      dispatch[ev]?.(payload as never);
      handlers.onRaw?.(ev, payload);
    });
  }

  return () => {
    socket.emit('unsubscribe', { room: `agent:${sessionId}` });
    socket.disconnect();
  };
}
