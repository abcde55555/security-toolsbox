import type { EventEmitter } from 'node:events';
import type {
  AgentEvent,
  AgentEventType,
  AgentPhase,
  AgentSession,
  Artifact,
  ClauseVerdict,
  StepRun,
} from '@en18031/shared';
import type { Repositories } from '../repositories/index.js';
import type { ExecutionEngine } from '../engine/executionEngine.js';
import type { ModuleLoader } from '../engine/moduleLoader.js';
import type { HumanStepCoordinator } from './humanStepCoordinator.js';
import type { AiProvider } from './ai/types.js';

/**
 * Internal event emitted to the bus (and forwarded over socket.io). Payloads
 * always include sessionId so the forwarder can route to room `agent:${id}`.
 */
export type AgentBusEvent =
  | { event: 'agent:session'; sessionId: string; status: string; phase: AgentPhase; currentStepId?: string }
  | { event: 'agent:phase'; sessionId: string; from: AgentPhase; to: AgentPhase; isRollback: boolean }
  | { event: 'agent:step_started'; sessionId: string; stepRunId: string; stepType: string; phase: AgentPhase; title: string; seq: number }
  | { event: 'agent:tool_call'; sessionId: string; stepRunId?: string; toolCallId: string; tool: string; args: Record<string, unknown> }
  | { event: 'agent:tool_output'; sessionId: string; stepRunId?: string; toolCallId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { event: 'agent:tool_result'; sessionId: string; stepRunId?: string; toolCallId: string; status: string; exitCode?: number; durationMs?: number; output?: string; evidenceRefs?: string[]; artifactRefs?: string[] }
  | { event: 'agent:human_step_requested'; sessionId: string; stepRunId: string; instruction: string; expectedOutcome?: string; referenceCommand?: string }
  | { event: 'agent:human_step_completed'; sessionId: string; stepRunId: string; fileRefs: string[]; note?: string }
  | { event: 'agent:evidence_attached'; sessionId: string; evidence: { id: string; type: string; content: string; functionModule?: string; clauseId?: string } }
  | { event: 'agent:artifact_written'; sessionId: string; artifact: Artifact }
  | { event: 'agent:verdict_drafted'; sessionId: string; verdict: ClauseVerdict }
  | { event: 'agent:message'; sessionId: string; role: 'assistant' | 'user'; content: string }
  | { event: 'agent:progress'; sessionId: string; stepRunId: string; percent: number; message?: string }
  | { event: 'agent:error'; sessionId: string; message: string; stepRunId?: string }
  | { event: 'agent:done'; sessionId: string; status: string };

export interface AgentLoopDeps {
  repos: Repositories;
  engine: ExecutionEngine;
  moduleLoader: ModuleLoader;
  bus: EventEmitter;
  provider: AiProvider;
  coordinator: HumanStepCoordinator;
  signal: AbortSignal;
  userId: string;
  maxIterations: number;
  humanStepTimeoutMs: number;
}

export interface EmitEventInput {
  type: AgentEventType;
  role?: string;
  content?: string;
  contentFileRef?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: string;
  stepRunId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
}

export type EmitFn = (input: EmitEventInput) => AgentEvent;

export interface AgentToolContext {
  session: AgentSession;
  projectRunId: string;
  deps: AgentLoopDeps;
  emit: EmitFn;
  bus: EventEmitter;
  /** Forward a granular socket event. */
  forward: (payload: AgentBusEvent) => void;
  /** Update the in-memory session phase (persisted + event). Returns the new phase. */
  changePhase: (to: AgentPhase, reason?: string) => AgentPhase;
  /** The abort signal for the whole session run. */
  signal: AbortSignal;
}

export interface ToolResult {
  /** String content fed back to the model as the tool message. */
  content: string;
  /** Optional structured data stored alongside. */
  data?: unknown;
  stepRun?: StepRun;
  artifact?: Artifact;
  verdict?: ClauseVerdict;
  isError?: boolean;
}
