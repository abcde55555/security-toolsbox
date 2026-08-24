import type { EventEmitter } from 'node:events';
import type { AgentEvent, AgentPhase, AgentSession } from '@en18031/shared';
import { nowIso } from '@en18031/shared';
import type { Repositories } from '../repositories/index.js';
import type { ExecutionEngine } from '../engine/executionEngine.js';
import type { ModuleLoader } from '../engine/moduleLoader.js';
import { AppError } from '../services/errors.js';
import { config } from '../config.js';
import { createDeepSeekProvider } from './ai/deepseekProvider.js';
import { ScriptedAiProvider } from './ai/scriptedProvider.js';
import type { AiProvider } from './ai/types.js';
import { HumanStepCoordinator } from './humanStepCoordinator.js';
import { runPlannerLoop, type RunSessionHandle } from './plannerLoop.js';
import type { AgentLoopDeps } from './agentContext.js';

interface CreateSessionInput {
  projectId: string;
  deviceProfile?: Record<string, unknown>;
  selectedClauses?: string[];
  authorizedTools?: string[];
  planningModel?: string;
  narrativeModel?: string;
  initialMessage?: string;
  createdBy: string;
}

/**
 * Facade for agent sessions: lifecycle (create/start/resume/abort), human-step
 * completion, message injection, event replay, and review actions. Holds the
 * in-memory map of running session handles and the shared HumanStepCoordinator.
 */
export class AgentService {
  private coordinator = new HumanStepCoordinator();
  private running = new Map<string, RunSessionHandle>();
  private aiProvider: AiProvider | null = null;
  private scriptedProvider: ScriptedAiProvider | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly engine: ExecutionEngine,
    private readonly moduleLoader: ModuleLoader,
    private readonly bus: EventEmitter,
  ) {
    // Provider is built lazily (and refreshed) so that DB settings added
    // after startup take effect.
    this.aiProvider = null;
  }

  /** Inject a scripted provider (for tests / AI-disabled environments). */
  useScriptedProvider(provider: ScriptedAiProvider): void {
    this.scriptedProvider = provider;
  }

  private async resolveProvider(): Promise<AiProvider> {
    if (this.scriptedProvider) return this.scriptedProvider;
    // Re-read config each call so settings-page changes apply without restart.
    const fresh = await createDeepSeekProvider();
    if (fresh) {
      this.aiProvider = fresh;
      return fresh;
    }
    if (this.aiProvider) return this.aiProvider;
    throw new AppError(
      9005,
      'AI 未启用或未配置 API Key。请在"设置"中添加大模型供应商并设为启用，或配置 DEEPSEEK_API_KEY。',
      undefined,
      503,
    );
  }

  get isAiEnabled(): boolean {
    return this.aiProvider !== null || this.scriptedProvider !== null;
  }

  createSession(input: CreateSessionInput): AgentSession {
    const project = this.repos.projects.getById(input.projectId);
    if (!project) throw new AppError(9004, '项目不存在', undefined, 404);

    // An agent session owns one project_run that all its step_runs hang off.
    const run = this.repos.projects.createRun({
      projectId: input.projectId,
      startedBy: input.createdBy,
      snapshotVariables: project.variables,
      triggerMode: 'agent',
    });

    const session = this.repos.agent.createSession({
      projectId: input.projectId,
      projectRunId: run.id,
      deviceProfile: input.deviceProfile ?? project.variables ?? {},
      selectedClauses: input.selectedClauses ?? [],
      authorizedTools: input.authorizedTools ?? [],
      planningModel: input.planningModel ?? config.ai.planningModel,
      narrativeModel: input.narrativeModel ?? config.ai.narrativeModel,
      createdBy: input.createdBy,
    });
    this.repos.agent.setProjectRunId(session.id, run.id);

    this.repos.audit.insert({
      userId: input.createdBy,
      action: 'agent.session_create',
      entityType: 'agent_session',
      entityId: session.id,
      after: { projectId: input.projectId, projectRunId: run.id, clauses: input.selectedClauses?.length ?? 0 },
    });

    return this.repos.agent.getSession(session.id)!;
  }

  listSessions(opts: { projectId?: string; status?: never; limit?: number; offset?: number } = {}) {
    return this.repos.agent.listSessions(opts);
  }

  getSession(id: string): AgentSession {
    const s = this.repos.agent.getSession(id);
    if (!s) throw new AppError(9004, 'Agent 会话不存在', undefined, 404);
    return s;
  }

  listEvents(sessionId: string, sinceSeq = 0): AgentEvent[] {
    this.getSession(sessionId);
    return this.repos.agent.listEvents(sessionId, sinceSeq);
  }

  listSteps(sessionId: string) {
    this.getSession(sessionId);
    return this.repos.projects.listAgentStepRuns(sessionId);
  }

  async start(sessionId: string, userId: string, opts: { message?: string } = {}): Promise<void> {
    const session = this.getSession(sessionId);
    if (this.running.has(sessionId)) {
      throw new AppError(9005, '会话已在运行中', undefined, 409);
    }
    const terminal = new Set(['done', 'aborted', 'error']);
    if (terminal.has(session.status)) {
      throw new AppError(9005, `会话已结束（${session.status}），无法再次启动`, undefined, 409);
    }
    const projectRunId = session.projectRunId;
    if (!projectRunId) throw new AppError(9999, '会话缺少 projectRunId');

    const provider = await this.resolveProvider();

    const rootController = new AbortController();
    const deps: AgentLoopDeps = {
      repos: this.repos,
      engine: this.engine,
      moduleLoader: this.moduleLoader,
      bus: this.bus,
      provider,
      coordinator: this.coordinator,
      signal: rootController.signal,
      userId,
      maxIterations: config.ai.maxIterations,
      humanStepTimeoutMs: config.ai.humanStepTimeoutMs,
    };

    const handle = runPlannerLoop(
      this.repos.agent.getSession(sessionId)!,
      projectRunId,
      deps,
      { initialUserMessage: opts.message },
    );
    this.running.set(sessionId, handle);
    void handle.promise.finally(() => this.running.delete(sessionId));
  }

  /** Append a user message and, if the session is idle/waiting, resume the loop. */
  async sendMessage(sessionId: string, content: string, userId: string): Promise<AgentEvent> {
    const session = this.getSession(sessionId);
    const ev = this.repos.agent.createEvent({
      sessionId,
      type: 'user_message',
      role: 'user',
      content,
    });
    this.bus.emit('agent:message', { sessionId, role: 'user', content });
    this.repos.audit.insert({
      userId,
      action: 'agent.message',
      entityType: 'agent_session',
      entityId: sessionId,
      after: { length: content.length },
    });
    // For P1, messages to an idle/done session are recorded but do not restart
    // a fresh loop automatically; the frontend calls start for new sessions.
    if (session.status === 'planning' || session.status === 'waiting_confirm') {
      this.start(sessionId, userId, { message: content });
    }
    return ev;
  }

  completeHumanStep(
    sessionId: string,
    stepRunId: string,
    input: { note?: string; fileRefs?: string[] },
    userId: string,
  ): void {
    this.getSession(sessionId);
    const stepRun = this.repos.projects.getStepRun(stepRunId);
    if (!stepRun || stepRun.agentSessionId !== sessionId) {
      throw new AppError(9004, '人工步骤不存在或不属于此会话', undefined, 404);
    }
    const ok = this.coordinator.complete(stepRunId, {
      note: input.note,
      fileRefs: input.fileRefs ?? [],
      completedBy: userId,
    });
    if (!ok) {
      throw new AppError(9005, '该人工步骤不在等待状态（可能已完成或已超时）', undefined, 409);
    }
  }

  abort(sessionId: string, userId: string): void {
    const session = this.getSession(sessionId);
    const handle = this.running.get(sessionId);
    if (handle) {
      handle.abort();
      this.running.delete(sessionId);
    } else {
      this.coordinator.abortAll('会话已中止');
      this.repos.agent.finish(sessionId, 'aborted');
    }
    this.repos.audit.insert({
      userId,
      action: 'agent.abort',
      entityType: 'agent_session',
      entityId: sessionId,
    });
    this.bus.emit('agent:done', { sessionId, status: 'aborted' });
    void session;
  }

  /** Review action: approve a pending verdict so it enters compliance grading. */
  approveVerdict(verdictId: string, userId: string, note?: string) {
    const v = this.repos.results.setReviewStatus(verdictId, 'approved', userId, note);
    if (!v) throw new AppError(9004, '判定不存在', undefined, 404);
    this.repos.audit.insert({
      userId,
      action: 'agent.verdict_approve',
      entityType: 'clause_verdict',
      entityId: verdictId,
      after: { clauseId: v.clauseId, pass: v.pass },
    });
    this.bus.emit('agent:verdict_updated', {
      sessionId: undefined,
      id: verdictId,
      reviewStatus: 'approved',
      reviewNote: note,
    });
    return v;
  }

  rejectVerdict(verdictId: string, userId: string, reason: string) {
    const v = this.repos.results.setReviewStatus(verdictId, 'rejected', userId, reason);
    if (!v) throw new AppError(9004, '判定不存在', undefined, 404);
    this.repos.audit.insert({
      userId,
      action: 'agent.verdict_reject',
      entityType: 'clause_verdict',
      entityId: verdictId,
      after: { clauseId: v.clauseId, reason },
    });
    this.bus.emit('agent:verdict_updated', {
      sessionId: undefined,
      id: verdictId,
      reviewStatus: 'rejected',
      reviewNote: reason,
    });
    return v;
  }

  listPendingVerdicts(projectId: string) {
    return this.repos.results.listPendingReviewVerdictsByProject(projectId);
  }

  /** Test/diagnostic helper: current timestamp. */
  now(): string {
    return nowIso();
  }
}
