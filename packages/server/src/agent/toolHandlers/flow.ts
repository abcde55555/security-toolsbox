import type { AgentPhase } from '@en18031/shared';
import { assertTransition } from '../phaseMachine.js';
import type { AgentToolContext, ToolResult } from '../agentContext.js';

interface AdvancePhaseArgs {
  target: AgentPhase;
  reason?: string;
}

/**
 * advance_phase: transition the session phase (A->B->C->D, or one step back).
 * Persisted by changePhase on the context, which also emits agent:phase.
 */
export async function advancePhase(ctx: AgentToolContext, args: AdvancePhaseArgs): Promise<ToolResult> {
  if (!args.target) return { content: '错误: 缺少 target 参数', isError: true };
  try {
    const transition = assertTransition(ctx.session.phase, args.target);
    const newPhase = ctx.changePhase(args.target, args.reason);
    ctx.deps.repos.audit.insert({
      userId: ctx.deps.userId,
      action: transition.isRollback ? 'agent.phase_rollback' : 'agent.phase_advance',
      entityType: 'agent_session',
      entityId: ctx.session.id,
      after: { from: transition.from, to: newPhase, reason: args.reason },
    });
    return {
      content: JSON.stringify(
        { from: transition.from, to: newPhase, isRollback: transition.isRollback },
        null,
        2,
      ),
    };
  } catch (err) {
    return { content: `错误: ${(err as Error).message}`, isError: true };
  }
}
