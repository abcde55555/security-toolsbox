import type { AgentSession, Artifact, AgentPhase } from '@en18031/shared';
import type { VerdictDraft, HumanStepRequest, AgentEvidence } from '../../api/endpoints';
import type { AgentToolResultPayload } from '../../api/socket';

/**
 * Agent steps don't carry the full orchestration snapshot (no stepSnapshot,
 * projectRunId may be absent, enums arrive as strings from the socket), so
 * fields are kept loosely typed rather than reusing StepRun.
 */
export interface AgentStep {
  id: string;
  title?: string;
  status?: string;
  stepType?: string;
  phase?: string;
  functionModule?: string;
  instruction?: string;
  expectedOutcome?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface ToolCallState {
  toolCallId: string;
  stepRunId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: 'running' | 'success' | 'fail' | 'error' | 'timeout' | 'cancelled' | string;
  /** Accumulated stdout/stderr chunks, applied live until tool_result reconciles. */
  output: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  evidenceRefs?: string[];
  artifactRefs?: string[];
  error?: { message?: string };
  startedAt?: string;
  finishedAt?: string;
  phase?: string;
}

export interface HumanStepState extends HumanStepRequest {
  completed: boolean;
  fileRefs?: string[];
  outcome?: string;
  completedAt?: string;
}

export interface PhaseTransition {
  seq: number;
  from: string;
  to: string;
  at: string;
}

export interface TranscriptMessage {
  role: string;
  content: string;
  at?: string;
}

export type TimelineKind =
  | 'phase'
  | 'step'
  | 'tool'
  | 'human'
  | 'message'
  | 'verdict'
  | 'error'
  | 'info';

export interface TimelineEntry {
  /** Stable key for React lists. */
  key: string;
  kind: TimelineKind;
  /** Monotonic order: seq when known, else a synthetic counter. */
  order: number;
  phase?: AgentPhase;
  stepRunId?: string;
  toolCallId?: string;
  at?: string;
  title?: string;
  status?: string;
  data?: unknown;
}

export interface AgentSessionState {
  session: AgentSession | null;
  loading: boolean;
  error: string | null;
  events: import('@en18031/shared').AgentEvent[];
  steps: Map<string, AgentStep>;
  toolCalls: Map<string, ToolCallState>;
  humanSteps: Map<string, HumanStepState>;
  artifacts: Artifact[];
  evidences: AgentEvidence[];
  verdicts: VerdictDraft[];
  phases: PhaseTransition[];
  messages: TranscriptMessage[];
  /** 正在流式生成的消息缓冲：正文与思考增量分开累积，final 到达即清空 */
  streaming: Record<string, { text: string; reasoning: string }>;
  /** Last seq applied (from socket or historical fetch), for gap backfill. */
  lastSeq: number;
  /** Synthetic counter for ordering events without a seq. */
  orderCounter: number;
  connected: boolean;
}

export type { AgentSession, Artifact, AgentPhase, VerdictDraft, AgentEvidence, AgentToolResultPayload };
