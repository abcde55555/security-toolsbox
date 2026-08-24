import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, assertCanCreateVerdict } from '../agent/phaseMachine.js';
import { AppError } from '../services/errors.js';

describe('phaseMachine', () => {
  it('allows legal forward transitions A->B->C->D', () => {
    expect(canTransition('onboarding', 'collection')).toBe(true);
    expect(canTransition('collection', 'adjudication')).toBe(true);
    expect(canTransition('adjudication', 'review')).toBe(true);
    expect(assertTransition('onboarding', 'collection').isRollback).toBe(false);
    expect(assertTransition('collection', 'adjudication').isRollback).toBe(false);
    expect(assertTransition('adjudication', 'review').isRollback).toBe(false);
  });

  it('allows one-step rollbacks C->B and B->A', () => {
    expect(canTransition('adjudication', 'collection')).toBe(true);
    expect(canTransition('collection', 'onboarding')).toBe(true);
    expect(assertTransition('adjudication', 'collection').isRollback).toBe(true);
    expect(assertTransition('collection', 'onboarding').isRollback).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('onboarding', 'adjudication')).toBe(false);
    expect(canTransition('onboarding', 'review')).toBe(false);
    expect(canTransition('collection', 'review')).toBe(false);
    expect(canTransition('adjudication', 'onboarding')).toBe(false);
    expect(canTransition('review', 'adjudication')).toBe(false);
    expect(canTransition('onboarding', 'onboarding')).toBe(false);
    expect(() => assertTransition('onboarding', 'review')).toThrow(AppError);
    expect(() => assertTransition('review', 'adjudication')).toThrow(/非法阶段迁移/);
  });

  it('assertCanCreateVerdict only passes in adjudication', () => {
    expect(() => assertCanCreateVerdict('onboarding')).toThrow(/adjudication/);
    expect(() => assertCanCreateVerdict('collection')).toThrow(/adjudication/);
    expect(() => assertCanCreateVerdict('review')).toThrow(/adjudication/);
    expect(() => assertCanCreateVerdict('adjudication')).not.toThrow();
  });
});
