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
    };
  }

  updateStepRun(id: string, patch: Partial<StepRun>): void {
    const existing = this.getStepRun(id);
    if (!existing) return;
    const merged = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE step_runs SET status=?, startedAt=?, finishedAt=?, exitCode=?, stdoutFileRef=?, stderrFileRef=?,
          durationMs=?, error=?, evidenceCount=?, verdictCount=?, percent=? WHERE id=?`,
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
        id,
      );
  }
}
