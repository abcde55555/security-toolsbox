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
  projectId?: string;
  standardVersion?: string;
  name?: string;
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
    // If no project was supplied, provision a throwaway agent-guided project so
    // the session has something to hang its project_run / step_runs off of.
    let project = input.projectId ? this.repos.projects.getById(input.projectId) : null;
    if (input.projectId && !project) throw new AppError(9004, '项目不存在', undefined, 404);
    if (!project) {
      if (!input.standardVersion) {
        throw new AppError(9003, '创建会话需要 projectId 或 standardVersion', undefined, 400);
      }
      const profile = input.deviceProfile ?? {};
      const brand = String(profile.brand ?? '').trim();
      const model = String(profile.model ?? '').trim();
      const name =
        input.name?.trim() ||
        [brand, model].filter(Boolean).join(' ') ||
        `Agent 测试 ${new Date().toLocaleString('zh-CN')}`;
      project = this.repos.projects.create({
        name,
        description: 'Agent 引导测试会话自动创建',
        templateId: 'agent',
        templateVersionSnapshot: 1,
        standardVersion: input.standardVersion,
        targetComplianceLevel: 'L1',
        variables: profile,
        createdBy: input.createdBy,
      });
    }

    // An agent session owns one project_run that all its step_runs hang off.
    const run = this.repos.projects.createRun({
      projectId: project.id,
      startedBy: input.createdBy,
      snapshotVariables: project.variables,
      triggerMode: 'agent',
    });

    // Model resolution: explicit input > active provider's configured model >
    // env/config default. Sessions snapshot the model so later config edits
    // don't silently change an in-flight run.
    const activeProvider = this.repos.settings.getActiveProvider();
    const planningModel =
      input.planningModel ?? activeProvider?.planningModel ?? config.ai.planningModel;
    const narrativeModel =
      input.narrativeModel ?? activeProvider?.narrativeModel ?? config.ai.narrativeModel;

    const session = this.repos.agent.createSession({
      projectId: project.id,
      projectRunId: run.id,
      deviceProfile: input.deviceProfile ?? project.variables ?? {},
      selectedClauses: input.selectedClauses ?? [],
      authorizedTools: input.authorizedTools ?? [],
      planningModel,
      narrativeModel,
      createdBy: input.createdBy,
    });
    this.repos.agent.setProjectRunId(session.id, run.id);

    this.repos.audit.insert({
      userId: input.createdBy,
      action: 'agent.session_create',
      entityType: 'agent_session',
      entityId: session.id,
      after: { projectId: project.id, projectRunId: run.id, clauses: input.selectedClauses?.length ?? 0, autoProject: !input.projectId },
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
    this.bus.emit('agent:message', { sessionId, role: 'user', content, id: ev.id, seq: ev.seq });
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

  /**
   * 人工退回补采：把会话拉回 collection 阶段并附带针对条款的补采指令，
   * 随后重启规划循环（模型经 advance_phase 合法回退语义继续工作）。
   * 会话正在运行时拒绝——避免与在途循环的内存状态打架；等它结束再退回。
   */
  async retryClause(sessionId: string, clauseId: string, userId: string): Promise<AgentSession> {
    const session = this.getSession(sessionId);
    if (this.running.has(sessionId)) {
      throw new AppError(9005, '会话正在运行中，请等待本轮结束或先中止后再退回补采', undefined, 409);
    }
    if (!session.selectedClauses.includes(clauseId)) {
      throw new AppError(9003, `条款 ${clauseId} 不在本会话的测试范围内`);
    }
    const guidance = `【人工退回补采】条款 ${clauseId} 的判定被工程师退回。请在 collection 阶段围绕该条款补充采集证据，完成后重新进入 adjudication 为该条款重新提交判定。`;

    const from = session.phase;
    if (from === 'adjudication' || from === 'review') {
      this.repos.agent.updatePhase(sessionId, 'collection');
      this.repos.agent.incrementRollback(sessionId);
      this.repos.agent.createEvent({
        sessionId,
        type: 'phase_change',
        content: JSON.stringify({ from, to: 'collection', reason: `条款 ${clauseId} 退回补采` }),
      });
      this.bus.emit('agent:phase', { sessionId, from, to: 'collection', isRollback: true });
    }
    if (session.status === 'done' || session.status === 'error') {
      this.repos.agent.updateStatus(sessionId, 'planning', '人工退回补采重开会话');
    }
    const gev = this.repos.agent.createEvent({ sessionId, type: 'user_message', role: 'user', content: guidance });
    this.bus.emit('agent:message', { sessionId, role: 'user', content: guidance, id: gev.id, seq: gev.seq });
    this.repos.audit.insert({
      userId,
      action: 'agent.retry_clause',
      entityType: 'agent_session',
      entityId: sessionId,
      after: { clauseId, fromPhase: from },
    });
    await this.start(sessionId, userId, { message: guidance });
    return this.repos.agent.getSession(sessionId)!;
  }

  /**
   * 人工补充证据：文件先经 /api/upload 落盘，这里把引用挂到会话级合成步骤
   * （stepType=evidence_attach）并广播 agent:evidence_attached。
   */
  attachEvidence(
    sessionId: string,
    input: { fileRefs: string[]; functionModule?: string; clauseId?: string; note?: string },
    userId: string,
  ): Array<{ id: string; type: string; content: string; fileRef?: string; functionModule?: string; clauseId?: string }> {
    const session = this.getSession(sessionId);
    const projectRunId = session.projectRunId;
    if (!projectRunId) throw new AppError(9999, '会话缺少 projectRunId');
    const refs = (input.fileRefs ?? []).filter((r) => typeof r === 'string' && r.trim());
    if (refs.length === 0) throw new AppError(9003, '至少提供一个证据文件引用');

    // 复用/创建本会话的"人工补充证据"合成步骤，满足 evidences.stepRunId NOT NULL
    const stepId = `manual-evidence-${sessionId.slice(0, 8)}`;
    let step = this.repos.projects
      .listAgentStepRuns(sessionId)
      .find((s) => s.stepId === stepId);
    if (!step) {
      step = this.repos.projects.createAgentStepRun({
        projectRunId,
        stepId,
        stepSnapshot: { title: '人工补充证据', source: 'manual-upload' },
        stepType: 'evidence_attach',
        phase: session.phase,
        agentSessionId: sessionId,
      });
    }

    const created = refs.map((ref) => {
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(ref);
      const fileName = ref.split('/').pop() ?? ref;
      const row = this.repos.results.insertEvidence({
        stepRunId: step!.id,
        projectRunId,
        projectId: session.projectId,
        type: isImage ? 'screenshot' : 'file_pointer',
        content: input.note?.trim() || fileName,
        fileRef: ref,
        severity: 'low',
        clauseId: input.clauseId,
        functionModule: input.functionModule,
        sourceStepType: 'evidence_attach',
      });
      const view = {
        id: row.id,
        type: row.type,
        content: row.content,
        fileRef: row.fileRef,
        functionModule: row.functionModule,
        clauseId: row.clauseId,
      };
      this.bus.emit('agent:evidence_attached', { sessionId, evidence: view });
      return view;
    });

    this.repos.audit.insert({
      userId,
      action: 'agent.evidence_attach',
      entityType: 'agent_session',
      entityId: sessionId,
      after: { count: created.length, clauseId: input.clauseId },
    });
    return created;
  }

  /** Resolve when the session's planning loop (if any) settles. Useful for tests & graceful shutdown. */
  whenIdle(sessionId: string): Promise<void> {
    return this.running.get(sessionId)?.promise ?? Promise.resolve();
  }

  /** Test/diagnostic helper: current timestamp. */
  now(): string {
    return nowIso();
  }
}
