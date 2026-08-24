import type { Database } from 'better-sqlite3';
import type { Project, ProjectRun, StepRun } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export class ProjectRepository {
  constructor(private db: Database) {}

  create(input: {
    id?: string;
    workspaceId?: string;
    name: string;
    description?: string;
    templateId: string;
    templateVersionSnapshot: number;
    standardVersion: string;
    targetComplianceLevel: Project['targetComplianceLevel'];
    variables: Record<string, unknown>;
    createdBy: string;
  }): Project {
    const id = input.id ?? uuid();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO projects (id, workspaceId, name, description, templateId, templateVersionSnapshot, standardVersion,
          targetComplianceLevel, variables, status, createdBy, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId ?? 'default',
        input.name,
        input.description ?? null,
        input.templateId,
        input.templateVersionSnapshot,
        input.standardVersion,
        input.targetComplianceLevel,
        toJson(input.variables ?? {}),
        'draft',
        input.createdBy,
        now,
        now,
      );
    return this.getById(id)!;
  }

  getById(id: string, includeDeleted = false): Project | null {
    const row = this.db
      .prepare(`SELECT * FROM projects WHERE id = ? ${includeDeleted ? '' : 'AND deletedAt IS NULL'}`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapProject(row) : null;
  }

  list(workspaceId = 'default'): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE workspaceId = ? AND deletedAt IS NULL ORDER BY updatedAt DESC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapProject(r));
  }

  listWithLatestRun(workspaceId = 'default'): Array<Project & { latestRun: ProjectRun | null }> {
    // Single query: each non-deleted project LEFT JOINed to its most recent run
    // via a correlated subquery, avoiding an N+1 round trip per project.
    const rows = this.db
      .prepare(
        `SELECT p.*, r.id AS r_id, r.projectId AS r_projectId, r.status AS r_status,
                r.startedAt AS r_startedAt, r.finishedAt AS r_finishedAt, r.startedBy AS r_startedBy,
                r.progressPercent AS r_progressPercent, r.eta AS r_eta, r.triggerMode AS r_triggerMode,
                r.cancelRequested AS r_cancelRequested, r.snapshotVariables AS r_snapshotVariables
         FROM projects p
         LEFT JOIN project_runs r ON r.id = (
           SELECT r2.id FROM project_runs r2
           WHERE r2.projectId = p.id
           ORDER BY r2.startedAt DESC, r2.rowid DESC
           LIMIT 1
         )
         WHERE p.workspaceId = ? AND p.deletedAt IS NULL
         ORDER BY p.updatedAt DESC`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => {
      const project = this.mapProject(r);
      const latestRun = r.r_id ? this.mapRunPrefixed(r) : null;
      return { ...project, latestRun };
    });
  }

  private mapRunPrefixed(r: Record<string, unknown>): ProjectRun {
    return {
      id: String(r.r_id),
      projectId: String(r.r_projectId),
      status: String(r.r_status),
      startedAt: r.r_startedAt ? String(r.r_startedAt) : undefined,
      finishedAt: r.r_finishedAt ? String(r.r_finishedAt) : undefined,
      startedBy: String(r.r_startedBy),
      progressPercent: Number(r.r_progressPercent),
      eta: r.r_eta ? String(r.r_eta) : undefined,
      triggerMode: String(r.r_triggerMode),
      cancelRequested: Boolean(r.r_cancelRequested),
      snapshotVariables: parseJson<Record<string, unknown>>(r.r_snapshotVariables, {}),
    };
  }

  private mapProject(r: Record<string, unknown>): Project {
    return {
      id: String(r.id),
      workspaceId: String(r.workspaceId),
      name: String(r.name),
      description: r.description ? String(r.description) : undefined,
      templateId: String(r.templateId),
      templateVersionSnapshot: Number(r.templateVersionSnapshot),
      standardVersion: String(r.standardVersion),
      targetComplianceLevel: r.targetComplianceLevel as Project['targetComplianceLevel'],
      variables: parseJson<Record<string, unknown>>(r.variables, {}),
      status: String(r.status),
      createdBy: String(r.createdBy),
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
      finishedAt: r.finishedAt ? String(r.finishedAt) : undefined,
      deletedAt: r.deletedAt ? String(r.deletedAt) : undefined,
    };
  }

  update(id: string, patch: Partial<Project>): Project | null {
    const existing = this.getById(id, true);
    if (!existing) return null;
    const merged = { ...existing, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE projects SET name=?, description=?, variables=?, targetComplianceLevel=?, status=?, finishedAt=?, updatedAt=? WHERE id=?`,
      )
      .run(
        merged.name,
        merged.description ?? null,
        toJson(merged.variables),
        merged.targetComplianceLevel,
        merged.status,
        merged.finishedAt ?? null,
        merged.updatedAt,
        id,
      );
    return this.getById(id);
  }

  setStatus(id: string, status: string, finishedAt?: string): void {
    this.db
      .prepare('UPDATE projects SET status=?, finishedAt=COALESCE(?, finishedAt), updatedAt=? WHERE id=?')
      .run(status, finishedAt ?? null, nowIso(), id);
  }

  softDelete(id: string): void {
    this.db.prepare('UPDATE projects SET deletedAt=?, updatedAt=? WHERE id=?').run(nowIso(), nowIso(), id);
  }

  createRun(input: {
    projectId: string;
    startedBy: string;
    snapshotVariables: Record<string, unknown>;
    triggerMode?: string;
  }): ProjectRun {
    const id = uuid();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO project_runs (id, projectId, status, startedAt, startedBy, progressPercent, triggerMode, cancelRequested, snapshotVariables)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectId,
        'running',
        now,
        input.startedBy,
        0,
        input.triggerMode ?? 'manual',
        0,
        toJson(input.snapshotVariables ?? {}),
      );
    return this.getRun(id)!;
  }

  getRun(id: string): ProjectRun | null {
    const row = this.db.prepare('SELECT * FROM project_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRun(row) : null;
  }

  listRuns(projectId: string): ProjectRun[] {
    const rows = this.db
      .prepare('SELECT * FROM project_runs WHERE projectId = ? ORDER BY startedAt DESC')
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRun(r));
  }

  latestRun(projectId: string): ProjectRun | null {
    const row = this.db
      .prepare('SELECT * FROM project_runs WHERE projectId = ? ORDER BY startedAt DESC LIMIT 1')
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? this.mapRun(row) : null;
  }

  listIncompleteRuns(): ProjectRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM project_runs WHERE status NOT IN ('success','fail','partial','cancelled')`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRun(r));
  }

  listIncompleteStepRuns(): StepRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM step_runs WHERE status IN ('pending','running','scheduled')`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapStepRun(r));
  }

  private mapRun(r: Record<string, unknown>): ProjectRun {
    return {
      id: String(r.id),
      projectId: String(r.projectId),
      status: String(r.status),
      startedAt: r.startedAt ? String(r.startedAt) : undefined,
      finishedAt: r.finishedAt ? String(r.finishedAt) : undefined,
      startedBy: String(r.startedBy),
      progressPercent: Number(r.progressPercent),
      eta: r.eta ? String(r.eta) : undefined,
      triggerMode: String(r.triggerMode),
      cancelRequested: Boolean(r.cancelRequested),
      snapshotVariables: parseJson<Record<string, unknown>>(r.snapshotVariables, {}),
    };
  }

  updateRun(id: string, patch: Partial<ProjectRun>): void {
    const existing = this.getRun(id);
    if (!existing) return;
    const merged = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE project_runs SET status=?, finishedAt=?, progressPercent=?, eta=?, cancelRequested=?, snapshotVariables=? WHERE id=?`,
      )
      .run(
        merged.status,
        merged.finishedAt ?? null,
        merged.progressPercent,
        merged.eta ?? null,
        merged.cancelRequested ? 1 : 0,
        toJson(merged.snapshotVariables),
        id,
      );
  }

  createStepRun(input: {
    projectRunId: string;
    stepId: string;
    stepSnapshot: unknown;
    retryOf?: string;
  }): StepRun {
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO step_runs (id, projectRunId, stepId, stepSnapshot, status, evidenceCount, verdictCount, percent)
         VALUES (?,?,?,?,'pending',0,0,0)`,
      )
      .run(id, input.projectRunId, input.stepId, toJson(input.stepSnapshot));
    if (input.retryOf) {
      this.db.prepare('UPDATE step_runs SET retryOf=? WHERE id=?').run(input.retryOf, id);
    }
    return this.getStepRun(id)!;
  }

  /** Create a step_run owned by an agent session (human/tool/evidence/analysis step). */
  createAgentStepRun(input: {
    id?: string;
    projectRunId: string;
    stepId: string;
    stepSnapshot: unknown;
    stepType: NonNullable<StepRun['stepType']>;
    phase: NonNullable<StepRun['phase']>;
    agentSessionId: string;
    functionModule?: string;
    instruction?: string;
    expectedOutcome?: string;
    artifacts?: string[];
  }): StepRun {
    const id = input.id ?? uuid();
    this.db
      .prepare(
        `INSERT INTO step_runs
          (id, projectRunId, stepId, stepSnapshot, status, evidenceCount, verdictCount, percent,
           stepType, phase, functionModule, instruction, expectedOutcome, artifacts, agentSessionId)
         VALUES (?,?,?,?,'pending',0,0,0,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectRunId,
        input.stepId,
        toJson(input.stepSnapshot),
        input.stepType,
        input.phase,
        input.functionModule ?? null,
        input.instruction ?? null,
        input.expectedOutcome ?? null,
        toJson(input.artifacts ?? []),
        input.agentSessionId,
      );
    return this.getStepRun(id)!;
  }

  listAgentStepRuns(agentSessionId: string): StepRun[] {
    const rows = this.db
      .prepare('SELECT * FROM step_runs WHERE agentSessionId = ? ORDER BY rowid ASC')
      .all(agentSessionId) as Record<string, unknown>[];
    return rows.map((r) => this.mapStepRun(r));
  }

  getStepRun(id: string): StepRun | null {
    const row = this.db.prepare('SELECT * FROM step_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapStepRun(row) : null;
  }

  listStepRuns(projectRunId: string): StepRun[] {
    const rows = this.db
      .prepare('SELECT * FROM step_runs WHERE projectRunId = ? ORDER BY rowid ASC')
      .all(projectRunId) as Record<string, unknown>[];
    return rows.map((r) => this.mapStepRun(r));
  }

  /**
   * Step executions across all runs of a project, newest first. Joins
   * project_runs (for run timestamp) so callers can render orchestration
   * steps in a unified tool-execution history.
   */
  listStepExecutionsForProject(
    projectId: string,
    opts: { limit?: number; offset?: number } = {},
  ): { items: Array<StepRun & { runStartedAt?: string; runId: string }>; total: number } {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) c FROM step_runs sr
           JOIN project_runs pr ON pr.id = sr.projectRunId
           WHERE pr.projectId = ?`,
        )
        .get(projectId) as { c: number }
    ).c;
    const rows = this.db
      .prepare(
        `SELECT sr.*, pr.startedAt AS runStartedAt, pr.id AS runId
         FROM step_runs sr
         JOIN project_runs pr ON pr.id = sr.projectRunId
         WHERE pr.projectId = ?
         ORDER BY COALESCE(sr.startedAt, sr.rowid) DESC
         LIMIT ? OFFSET ?`,
      )
      .all(projectId, limit, offset) as Record<string, unknown>[];
    const items = rows.map((r) => ({
      ...this.mapStepRun(r),
      runId: String(r.runId),
      runStartedAt: r.runStartedAt ? String(r.runStartedAt) : undefined,
    }));
    return { items, total };
  }

  private mapStepRun(r: Record<string, unknown>): StepRun {
    return {
      id: String(r.id),
      projectRunId: String(r.projectRunId),
      stepId: String(r.stepId),
      stepSnapshot: parseJson(r.stepSnapshot, {} as object) as StepRun['stepSnapshot'],
      status: r.status as StepRun['status'],
      startedAt: r.startedAt ? String(r.startedAt) : undefined,
      finishedAt: r.finishedAt ? String(r.finishedAt) : undefined,
      retryOf: r.retryOf ? String(r.retryOf) : undefined,
      exitCode: r.exitCode !== null && r.exitCode !== undefined ? Number(r.exitCode) : undefined,
      stdoutFileRef: r.stdoutFileRef ? String(r.stdoutFileRef) : undefined,
      stderrFileRef: r.stderrFileRef ? String(r.stderrFileRef) : undefined,
      durationMs: r.durationMs !== null && r.durationMs !== undefined ? Number(r.durationMs) : undefined,
      error: r.error ? parseJson(r.error, undefined) : undefined,
      evidenceCount: Number(r.evidenceCount),
      verdictCount: Number(r.verdictCount),
      percent: Number(r.percent),
      stepType: r.stepType ? (r.stepType as StepRun['stepType']) : undefined,
      phase: r.phase ? (r.phase as StepRun['phase']) : undefined,
      functionModule: r.functionModule ? String(r.functionModule) : undefined,
      instruction: r.instruction ? String(r.instruction) : undefined,
      expectedOutcome: r.expectedOutcome ? String(r.expectedOutcome) : undefined,
      artifacts: r.artifacts ? parseJson<string[]>(r.artifacts, []) : undefined,
      agentSessionId: r.agentSessionId ? String(r.agentSessionId) : undefined,
    };
  }

  updateStepRun(id: string, patch: Partial<StepRun>): void {
    const existing = this.getStepRun(id);
    if (!existing) return;
    const merged = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE step_runs SET status=?, startedAt=?, finishedAt=?, exitCode=?, stdoutFileRef=?, stderrFileRef=?,
          durationMs=?, error=?, evidenceCount=?, verdictCount=?, percent=?, artifacts=? WHERE id=?`,
      )
      .run(
        merged.status,
        merged.startedAt ?? null,
        merged.finishedAt ?? null,
        merged.exitCode ?? null,
        merged.stdoutFileRef ?? null,
        merged.stderrFileRef ?? null,
        merged.durationMs ?? null,
        merged.error ? toJson(merged.error) : null,
        merged.evidenceCount,
        merged.verdictCount,
        merged.percent,
        toJson(merged.artifacts ?? []),
        id,
      );
  }
}
