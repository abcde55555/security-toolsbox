import type { AgentPhase } from '@en18031/shared';
import { AppError } from '../services/errors.js';

/**
 * Four-phase compliance state machine:
 *   A onboarding -> B collection -> C adjudication -> D review
 *
 * Forward progression is strict; rollback is allowed one step back (C->B,
 * B->A) and counted. D is terminal (no rollback in P1). This is the
 * application-level guard; a DB trigger (clause_verdicts_phase_guard) is the
 * belt-and-suspenders enforcement for verdict insertion.
 */

const ORDER: Record<AgentPhase, number> = {
  onboarding: 0,
  collection: 1,
  adjudication: 2,
  review: 3,
};

const FORWARD: Record<AgentPhase, AgentPhase | null> = {
  onboarding: 'collection',
  collection: 'adjudication',
  adjudication: 'review',
  review: null,
};

/** Legal one-step rollbacks. A->(none), D terminal. */
const ROLLBACK: Partial<Record<AgentPhase, AgentPhase>> = {
  collection: 'onboarding',
  adjudication: 'collection',
};

export interface PhaseTransition {
  from: AgentPhase;
  to: AgentPhase;
  isRollback: boolean;
}

export function canTransition(from: AgentPhase, to: AgentPhase): boolean {
  if (from === to) return false;
  if (FORWARD[from] === to) return true;
  if (ROLLBACK[from] === to) return true;
  return false;
}

export function assertTransition(from: AgentPhase, to: AgentPhase): PhaseTransition {
  if (from === to) {
    throw new AppError(9005, `已在阶段 ${to}`, undefined, 409);
  }
  if (FORWARD[from] === to) {
    return { from, to, isRollback: false };
  }
  if (ROLLBACK[from] === to) {
    return { from, to, isRollback: true };
  }
  throw new AppError(
    9005,
    `非法阶段迁移: ${from} -> ${to}（仅允许顺序前进或回退一步）`,
    { from, to },
    409,
  );
}

/** Verdicts (AI drafts) may only be created while the session is in adjudication. */
export function assertCanCreateVerdict(phase: AgentPhase): void {
  if (phase !== 'adjudication') {
    throw new AppError(
      9005,
      `仅在裁定阶段（adjudication）可提交判定，当前为 ${phase}`,
      { phase },
      409,
    );
  }
}

export function isTerminal(phase: AgentPhase): boolean {
  return phase === 'review';
}

export function phaseIndex(phase: AgentPhase): number {
  return ORDER[phase];
}
