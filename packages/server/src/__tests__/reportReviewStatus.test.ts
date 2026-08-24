import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createInMemoryRepositories } from '../repositories/index.js';
import { ExecutionEngine } from '../engine/executionEngine.js';
import { ModuleLoader } from '../engine/moduleLoader.js';
import { ReportService } from '../services/reportService.js';
import type { ServiceContext } from '../services/context.js';
import type { Clause, Project } from '@en18031/shared';
import './helpers.js';

function makeContext() {
  const { repos, close } = createInMemoryRepositories();
  const bus = new EventEmitter();
  const moduleLoader = new ModuleLoader();
  const engine = new ExecutionEngine(moduleLoader);
  const ctx: ServiceContext = { repos, engine, moduleLoader, bus, userId: 'tester' };
  return { repos, ctx, close };
}

function seedClause(repos: ServiceContext['repos'], clauseId: string): Clause {
  repos.clauses.upsert({
    clauseId,
    standardVersion: 'TEST:1',
    chapter: 'GEC',
    title: `条款 ${clauseId}`,
    description: '',
    level: 'L1',
    defaultSeverity: 'middle',
    tags: [],
  });
  return repos.clauses.get('TEST:1', clauseId)!;
}

function seedProject(repos: ServiceContext['repos']): Project {
  return repos.projects.create({
    name: 'review-filter-test',
    templateId: 'tpl-1',
    templateVersionSnapshot: 1,
    standardVersion: 'TEST:1',
    targetComplianceLevel: 'L1',
    variables: {},
    createdBy: 'tester',
  });
}

describe('ReportService reviewStatus filtering', () => {
  it('excludes pending_review/rejected verdicts from grading; approved verdicts count', () => {
    const { repos, ctx, close } = makeContext();
    const project = seedProject(repos);
    seedClause(repos, 'C-1');
    seedClause(repos, 'C-2');
    seedClause(repos, 'C-3');
    const run = repos.projects.createRun({ projectId: project.id, startedBy: 'tester', snapshotVariables: {} });
    const sr = repos.projects.createStepRun({ projectRunId: run.id, stepId: 's1', stepSnapshot: {} });

    // C-1 approved PASS
    repos.results.insertVerdict({
      stepRunId: sr.id, projectRunId: run.id, projectId: project.id, clauseId: 'C-1',
      pass: true, severity: 'low', reason: 'ok', evidenceRefs: [], verdictGroup: 'g1',
      reviewStatus: 'approved',
    });
    // C-2 pending_review FAIL must NOT count (treated as not_covered)
    repos.results.insertVerdict({
      stepRunId: sr.id, projectRunId: run.id, projectId: project.id, clauseId: 'C-2',
      pass: false, severity: 'high', reason: 'bad', evidenceRefs: [], verdictGroup: 'g2',
      reviewStatus: 'pending_review', aiGenerated: true,
    });
    // C-3 rejected FAIL must NOT count
    repos.results.insertVerdict({
      stepRunId: sr.id, projectRunId: run.id, projectId: project.id, clauseId: 'C-3',
      pass: false, severity: 'high', reason: 'bad', evidenceRefs: [], verdictGroup: 'g3',
      reviewStatus: 'rejected',
    });

    const reports = new ReportService(ctx);
    const report = reports.generateReport(project.id, run.id);

    expect(report.summary.pass).toBe(1);
    expect(report.summary.fail).toBe(0);
    // pending and rejected are not covered for grading purposes
    expect(report.summary.notCovered).toBe(2);
    expect(report.summary.failBySeverity.high).toBe(0);
    // One not-covered out of 3 => CONDITIONAL_PASS, not FAIL (the high-severity
    // pending/rejected fails must not drag the grade to FAIL).
    expect(report.grade).toBe('CONDITIONAL_PASS');

    // getReportDetail also filters: only C-1 has a verdict
    const detail = reports.getReportDetail(project.id, report.id);
    const byId = new Map(detail.clauses.map((c) => [c.clauseId, c]));
    expect(byId.get('C-1')!.verdict?.pass).toBe(true);
    expect(byId.get('C-2')!.verdict).toBeNull();
    expect(byId.get('C-3')!.verdict).toBeNull();
    close();
  });

  it('legacy verdicts (default reviewStatus approved) grade unchanged', () => {
    const { repos, ctx, close } = makeContext();
    const project = seedProject(repos);
    seedClause(repos, 'C-1');
    const run = repos.projects.createRun({ projectId: project.id, startedBy: 'tester', snapshotVariables: {} });
    const sr = repos.projects.createStepRun({ projectRunId: run.id, stepId: 's1', stepSnapshot: {} });
    repos.results.insertVerdict({
      stepRunId: sr.id, projectRunId: run.id, projectId: project.id, clauseId: 'C-1',
      pass: true, severity: 'low', reason: 'ok', evidenceRefs: [], verdictGroup: 'g1',
    });
    const reports = new ReportService(ctx);
    const report = reports.generateReport(project.id, run.id);
    expect(report.summary.pass).toBe(1);
    expect(report.summary.fail).toBe(0);
    expect(report.grade).toBe('PASS');
    close();
  });
});
