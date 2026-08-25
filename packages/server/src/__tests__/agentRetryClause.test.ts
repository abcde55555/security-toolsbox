import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createInMemoryRepositories } from '../repositories/index.js';
import { AgentService } from '../agent/agentService.js';
import { ScriptedAiProvider } from '../agent/ai/scriptedProvider.js';
import './helpers.js';

function makeService() {
  const { repos, close } = createInMemoryRepositories();
  const bus = new EventEmitter();
  const service = new AgentService(repos, {} as never, {} as never, bus);
  service.useScriptedProvider(new ScriptedAiProvider([]));
  return { repos, bus, service, close };
}

describe('AgentService.attachEvidence', () => {
  it('creates a synthetic evidence_attach step and one row per fileRef; reuses the step on later calls', async () => {
    const { repos, bus, service, close } = makeService();
    try {
      let broadcast = 0;
      bus.on('agent:evidence_attached', () => broadcast++);
      const session = service.createSession({
        standardVersion: 'TEST:1',
        deviceProfile: { brand: 'X', model: 'Y' },
        selectedClauses: ['GEC-1'],
        createdBy: 'tester',
      });
      const r1 = service.attachEvidence(
        session.id,
        { fileRefs: ['uploads/a.png', 'uploads/b.log'], note: '现场补拍' },
        'tester',
      );
      expect(r1).toHaveLength(2);
      expect(broadcast).toBe(2);

      const steps = repos.projects.listAgentStepRuns(session.id);
      expect(steps.filter((s) => s.stepId.startsWith('manual-evidence-'))).toHaveLength(1);
      const evidences = repos.results
        .listEvidenceByRun(session.projectRunId!)
        .filter((e) => e.sourceStepType === 'evidence_attach');
      expect(evidences).toHaveLength(2);
      expect(evidences[0].type === 'screenshot' || evidences[1].type === 'screenshot').toBe(true);

      service.attachEvidence(session.id, { fileRefs: ['uploads/c.txt'] }, 'tester');
      const stepsAfter = repos.projects.listAgentStepRuns(session.id);
      expect(stepsAfter.filter((s) => s.stepId.startsWith('manual-evidence-'))).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('rejects an empty fileRefs list', () => {
    const { service, close } = makeService();
    try {
      const session = service.createSession({
        standardVersion: 'TEST:1',
        createdBy: 'tester',
      });
      expect(() => service.attachEvidence(session.id, { fileRefs: [] }, 'tester')).toThrow(/至少提供一个/);
    } finally {
      close();
    }
  });
});

describe('AgentService.retryClause', () => {
  it('rolls adjudication back to collection, bumps rollbackCount and restarts the loop', async () => {
    const { repos, service, close } = makeService();
    try {
      const session = service.createSession({
        standardVersion: 'TEST:1',
        selectedClauses: ['GEC-1'],
        createdBy: 'tester',
      });
      // Simulate a session that already reached adjudication.
      repos.agent.updatePhase(session.id, 'adjudication');

      const updatedPromise = service.retryClause(session.id, 'GEC-1', 'reviewer');
      const updated = await updatedPromise;
      // 规划循环是 fire-and-forget 的，等它落定再断言/关库
      await service.whenIdle(session.id);

      expect(updated.phase).toBe('collection');
      expect(updated.rollbackCount).toBeGreaterThan(0);
      const events = repos.agent.listEvents(session.id, 0);
      expect(events.some((e) => (e.content ?? '').includes('【人工退回补采】'))).toBe(true);
      expect(events.some((e) => (e.content ?? '').includes('GEC-1'))).toBe(true);
    } finally {
      close();
    }
  });

  it('refuses clauses outside the selected scope', async () => {
    const { service, close } = makeService();
    try {
      const session = service.createSession({
        standardVersion: 'TEST:1',
        selectedClauses: ['GEC-1'],
        createdBy: 'tester',
      });
      await expect(service.retryClause(session.id, 'OTHER-9', 'tester')).rejects.toThrow(/不在本会话的测试范围/);
    } finally {
      close();
    }
  });
});
