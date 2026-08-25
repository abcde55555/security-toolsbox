import type { AgentPhase, AgentSession } from '@en18031/shared';
import { logger } from '../logger.js';
import type { AgentBusEvent, AgentLoopDeps, EmitEventInput, AgentToolContext } from './agentContext.js';
import { assertTransition } from './phaseMachine.js';
import { dispatchTool, TOOL_SCHEMAS } from './toolBridge.js';
import { extractMemories } from './memoryExtractor.js';
import { buildSystemPrompt } from './prompts.js';
import { notify } from '../services/notificationService.js';
import type { ChatMessage, ToolCall } from './ai/types.js';

export interface RunSessionHandle {
  sessionId: string;
  promise: Promise<void>;
  abort: () => void;
}

interface MutableState {
  session: AgentSession;
  phase: AgentPhase;
  status: AgentSession['status'];
}

/**
 * Run the agent planning loop for a session. Resolves when the model returns
 * stop (no more tool calls), the session reaches review/done, or an abort/error
 * occurs. All significant actions are appended to agent_events and forwarded to
 * the bus by the caller-provided deps.
 */
export function runPlannerLoop(
  initialSession: AgentSession,
  projectRunId: string,
  deps: AgentLoopDeps,
  opts: { initialUserMessage?: string } = {},
): RunSessionHandle {
  const controller = new AbortController();
  // Chain the external abort signal into our local controller.
  if (deps.signal) {
    if (deps.signal.aborted) controller.abort();
    else deps.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const state: MutableState = {
    session: initialSession,
    phase: initialSession.phase,
    status: 'running',
  };

  /** 工具结果硬压缩：单条超过上限即截断并标记，防止历史轮次撑爆上下文 */
  const compressToolMessage = (m: ChatMessage): ChatMessage => {
    const LIMIT = 1500;
    if (typeof m.content === 'string' && m.content.length > LIMIT) {
      return { ...m, content: `${m.content.slice(0, LIMIT)}\n…[已截断，完整输出见对应步骤运行记录]` };
    }
    return m;
  };

  const emit = (input: EmitEventInput) => {
    const ev = deps.repos.agent.createEvent({ ...input, sessionId: state.session.id });
    return ev;
  };

  const forward = (payload: AgentBusEvent): void => {
    deps.bus.emit(payload.event, payload);
  };

  const changePhase = (to: AgentPhase, reason?: string): AgentPhase => {
    const transition = assertTransition(state.phase, to);
    const from = state.phase;
    deps.repos.agent.updatePhase(state.session.id, to);
    state.phase = to;
    state.session = { ...state.session, phase: to };
    emit({ type: 'phase_change', content: JSON.stringify({ from, to, reason: reason ?? null }) });
    forward({ event: 'agent:phase', sessionId: state.session.id, from, to, isRollback: transition.isRollback });
    forward({
      event: 'agent:session',
      sessionId: state.session.id,
      status: state.status,
      phase: to,
      currentStepId: state.session.currentStepId,
    });
    if (transition.isRollback) {
      deps.repos.agent.incrementRollback(state.session.id);
    }
    return to;
  };

  const ctx: AgentToolContext = {
    get session() {
      return state.session;
    },
    projectRunId,
    deps,
    emit,
    bus: deps.bus,
    forward,
    changePhase,
    signal: controller.signal,
  };

  const promise = (async () => {
    try {
      deps.repos.agent.updateStatus(state.session.id, 'running');
      state.status = 'running';
      forward({
        event: 'agent:session',
        sessionId: state.session.id,
        status: 'running',
        phase: state.phase,
      });

      const project = deps.repos.projects.getById(state.session.projectId);
      const clauses = project
        ? state.session.selectedClauses
            .map((id) => deps.repos.clauses.get(project.standardVersion, id))
            .filter((c): c is NonNullable<typeof c> => !!c)
        : [];

      const skillContext = deps.repos.skills.list({ status: 'approved' }).items;
      const systemPrompt = buildSystemPrompt({
        session: state.session,
        clauses,
        authorizedTools: state.session.authorizedTools,
        skills: skillContext,
      });

      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
      // Anthropic (and good practice) requires at least one user message; seed
      // the loop with a kickoff prompt when the caller didn't supply one.
      const kickoff =
        opts.initialUserMessage?.trim() ||
        '开始本次合规测试会话：先确认设备档案与接入方式，然后规划并执行测试步骤。';
      // 记忆注入：user 级偏好 + 本会话已有工作上下文，启动时取一次
      let memoryLines: string[] = [];
      try {
        const mems = [
          ...deps.repos.agentMemories.listUserMemories(6),
          ...deps.repos.agentMemories.listBySession(state.session.id, 10),
        ];
        memoryLines = mems.map((m) => m.content);
      } catch { /* 记忆库不可用不阻塞主流程 */ }
      messages.push({ role: 'user', content: kickoff });
      if (opts.initialUserMessage) {
        emit({ type: 'user_message', role: 'user', content: opts.initialUserMessage });
        forward({ event: 'agent:message', sessionId: state.session.id, role: 'user', content: opts.initialUserMessage });
      }

      let iterations = 0;
      while (!controller.signal.aborted && iterations < deps.maxIterations) {
        iterations++;
        if (state.phase === 'review') {
          break;
        }

        // Refresh system prompt's phase line by replacing the system message.
        messages[0] = {
          role: 'system',
          content: buildSystemPrompt({
            session: state.session,
            clauses,
            authorizedTools: state.session.authorizedTools,
            skills: skillContext,
            memories: memoryLines,
          }),
        };

        let result;
        try {
          // 流式调用：文本增量实时推给前端（messageId 用于前端缓冲聚合），
          // 工具调用仍由 provider 聚齐后在 result.toolCalls 中返回。
          const streamMessageId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          result = await deps.provider.streamChat(
            messages,
            (chunk) => {
              if (chunk.delta) {
                forward({
                  event: 'agent:message_delta',
                  sessionId: state.session.id,
                  messageId: streamMessageId,
                  delta: chunk.delta,
                  ...(chunk.reasoning ? { reasoning: true } : {}),
                });
              }
            },
            {
              model: state.session.planningModel,
              tools: TOOL_SCHEMAS,
              toolChoice: 'auto',
              signal: controller.signal,
            },
          );
        } catch (err) {
          if (controller.signal.aborted) break;
          const msg = `AI 调用失败: ${(err as Error).message}`;
          logger.error({ err, sessionId: state.session.id }, 'planner AI error');
          emit({ type: 'error', content: msg, model: state.session.planningModel });
          forward({ event: 'agent:error', sessionId: state.session.id, message: msg });
          deps.repos.agent.updateStatus(state.session.id, 'error', msg);
          state.status = 'error';
          forward({ event: 'agent:done', sessionId: state.session.id, status: 'error' });
          return;
        }

        const assistantMsg = result.message;
        messages.push(assistantMsg);

        if (assistantMsg.content) {
          // 携带持久化事件身份（id/seq），前端按 id 去重防止多通道叠影
          const ev = emit({
            type: 'model_message',
            role: 'assistant',
            content: assistantMsg.content ?? undefined,
            model: result.model,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            latencyMs: result.latencyMs,
          });
          forward({
            event: 'agent:message',
            sessionId: state.session.id,
            role: 'assistant',
            content: assistantMsg.content,
            id: ev.id,
            seq: ev.seq,
          });
        }

        const toolCalls = assistantMsg.toolCalls ?? [];
        if (toolCalls.length === 0) {
          // Model is done. If still before review, prompt it to advance.
          if ((state.phase as AgentPhase) !== 'review') {
            messages.push({
              role: 'user',
              content:
                '如果当前阶段工作已完成，请调用 advance_phase 推进到下一阶段；如果还有未完成的条款或证据，请继续调用工具。完成全部四阶段后结束。',
            });
            continue;
          }
          break;
        }

        for (const tc of toolCalls) {
          if (controller.signal.aborted) break;
          const toolMessage = await executeToolCall(ctx, tc, emit, forward, messages);
          messages.push(compressToolMessage(toolMessage));
        }
      }

      if (controller.signal.aborted) {
        deps.repos.agent.updateStatus(state.session.id, 'aborted', '会话已中止');
        state.status = 'aborted';
        deps.coordinator.abortAll('会话已中止');
        forward({ event: 'agent:done', sessionId: state.session.id, status: 'aborted' });
        return;
      }

      // Natural completion. If reached review, mark done; otherwise require
      // the model to have explicitly advanced to review, but still finish cleanly.
      const finalStatus = state.phase === 'review' ? 'done' : state.status;
      deps.repos.agent.finish(state.session.id, finalStatus);
      state.status = finalStatus;
      if (finalStatus === 'done') {
        // 记忆沉淀：非阻塞 LLM 提炼工作上下文与用户偏好（失败静默）
        void extractMemories(deps, state.session.id).catch(() => {});
        // Non-blocking sedimentation nudge: a human decides whether this case
        // should be crystallized into skills/templates. Never blocks the run.
        try {
          const verdicts = deps.repos.results.listVerdictsByRun(projectRunId);
          const approved = verdicts.filter((v) => v.reviewStatus === 'approved').length;
          if (approved > 0) {
            notify(deps.repos, deps.bus, {
              type: 'template_save',
              title: `会话 ${state.session.id.slice(0, 8)} 完成：${approved} 条判定已通过`,
              message: '本次案例已产生通过判定，是否沉淀为技能或合规模板？',
              payload: {
                sessionId: state.session.id,
                projectId: state.session.projectId,
                projectRunId,
                approvedVerdicts: approved,
              },
              sessionId: state.session.id,
              projectId: state.session.projectId,
              createdBy: deps.userId,
            });
          }
        } catch (e) {
          logger.warn({ err: e }, 'failed to create session-end sedimentation notification');
        }
      }
      if (state.phase !== 'review') {
        forward({
          event: 'agent:error',
          sessionId: state.session.id,
          message: '规划循环达到上限或模型提前结束，会话未进入复核阶段',
        });
      }
      forward({ event: 'agent:done', sessionId: state.session.id, status: finalStatus });
    } catch (err) {
      logger.error({ err, sessionId: state.session.id }, 'planner loop crashed');
      const msg = (err as Error).message;
      deps.repos.agent.updateStatus(state.session.id, 'error', msg);
      state.status = 'error';
      emit({ type: 'error', content: msg });
      forward({ event: 'agent:error', sessionId: state.session.id, message: msg });
      forward({ event: 'agent:done', sessionId: state.session.id, status: 'error' });
    }
  })();

  return {
    sessionId: initialSession.id,
    promise,
    abort: () => controller.abort(),
  };
}

async function executeToolCall(
  ctx: AgentToolContext,
  tc: ToolCall,
  emit: (input: EmitEventInput) => unknown,
  forward: (payload: AgentBusEvent) => void,
  messages: ChatMessage[],
): Promise<ChatMessage> {
  let args: Record<string, unknown> = {};
  try {
    args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
  } catch {
    const content = `错误: 工具参数不是合法 JSON: ${tc.function.arguments}`;
    emit({ type: 'tool_call', toolName: tc.function.name, toolArgs: {}, toolStatus: 'invalid_args', stepRunId: undefined });
    return { role: 'tool', toolCallId: tc.id, content };
  }

  emit({
    type: 'tool_call',
    toolName: tc.function.name,
    toolArgs: args,
    toolStatus: 'called',
  });
  forward({
    event: 'agent:tool_call',
    sessionId: ctx.session.id,
    toolCallId: tc.id,
    tool: tc.function.name,
    args,
  });

  const t0 = Date.now();
  let result;
  try {
    result = await dispatchTool(ctx, tc.function.name, args);
  } catch (err) {
    const content = `工具执行异常: ${(err as Error).message}`;
    emit({
      type: 'tool_result',
      toolName: tc.function.name,
      toolStatus: 'error',
      content,
      latencyMs: Date.now() - t0,
    });
    return { role: 'tool', toolCallId: tc.id, content };
  }

  emit({
    type: 'tool_result',
    toolName: tc.function.name,
    toolStatus: result.isError ? 'error' : 'ok',
    content: result.content,
    stepRunId: result.stepRun?.id,
    latencyMs: Date.now() - t0,
  });
  forward({
    event: 'agent:tool_result',
    sessionId: ctx.session.id,
    toolCallId: tc.id,
    status: result.isError ? 'error' : 'ok',
    stepRunId: result.stepRun?.id,
    durationMs: Date.now() - t0,
    output: result.content.slice(0, 4000),
  });

  // Keep tool messages bounded to avoid runaway context.
  const content = result.content.length > 8000 ? result.content.slice(0, 8000) + '\n...(已截断)' : result.content;
  return { role: 'tool', toolCallId: tc.id, content };
}
