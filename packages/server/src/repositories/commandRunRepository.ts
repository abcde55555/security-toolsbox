import type { Database } from 'better-sqlite3';
import type { CommandRun, ExecutionError } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export interface CommandRunListQuery {
  workspaceId?: string;
  toolId?: string;
  projectId?: string;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateCommandRunInput {
  id?: string;
  workspaceId?: string;
  toolId: string;
  toolName: string;
  commandId: string;
  commandName: string;
  projectId?: string | null;
  clauseId?: string | null;
  note?: string;
  params: Record<string, unknown>;
  resolvedCommand: string;
  createdBy: string;
}

export class CommandRunRepository {
  constructor(private db: Database) {}

  private mapRow(r: Record<string, unknown>): CommandRun {
    return {
      id: String(r.id),
      workspaceId: String(r.workspaceId ?? 'default'),
      toolId: String(r.toolId),
      toolName: String(r.toolName),
      commandId: String(r.commandId),
      commandName: String(r.commandName),
      projectId: (r.projectId as string | null) ?? undefined,
      clauseId: (r.clauseId as string | null) ?? undefined,
      note: r.note ? String(r.note) : undefined,
      params: parseJson<Record<string, unknown>>(r.params, {}),
      resolvedCommand: String(r.resolvedCommand),
      status: r.status as CommandRun['status'],
      exitCode: r.exitCode === null || r.exitCode === undefined ? undefined : Number(r.exitCode),
      durationMs:
        r.durationMs === null || r.durationMs === undefined ? undefined : Number(r.durationMs),
      stdoutFileRef: r.stdoutFileRef ? String(r.stdoutFileRef) : undefined,
      stderrFileRef: r.stderrFileRef ? String(r.stderrFileRef) : undefined,
      stdoutPreview: r.stdoutPreview ? String(r.stdoutPreview) : undefined,
      error: r.error ? (parseJson<ExecutionError>(r.error, {} as ExecutionError)) : undefined,
      createdBy: String(r.createdBy),
      startedAt: String(r.startedAt),
      finishedAt: r.finishedAt ? String(r.finishedAt) : undefined,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }

  create(input: CreateCommandRunInput): CommandRun {
    const now = nowIso();
    const id = input.id || uuid();
    this.db
      .prepare(
        `INSERT INTO command_runs
          (id, workspaceId, toolId, toolName, commandId, commandName, projectId, clauseId, note,
           params, resolvedCommand, status, createdBy, startedAt, createdAt, updatedAt)
         VALUES (@id,@workspaceId,@toolId,@toolName,@commandId,@commandName,@projectId,@clauseId,@note,
           @params,@resolvedCommand,'running',@createdBy,@startedAt,@createdAt,@updatedAt)`,
      )
      .run({
        id,
        workspaceId: input.workspaceId || 'default',
        toolId: input.toolId,
        toolName: input.toolName,
        commandId: input.commandId,
        commandName: input.commandName,
        projectId: input.projectId ?? null,
        clauseId: input.clauseId ?? null,
        note: input.note ?? null,
        params: toJson(input.params ?? {}),
        resolvedCommand: input.resolvedCommand,
        createdBy: input.createdBy,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    return this.getById(id)!;
  }

  markFinished(
    id: string,
    patch: {
      status: CommandRun['status'];
      exitCode?: number;
      durationMs?: number;
      stdoutFileRef?: string;
      stderrFileRef?: string;
      stdoutPreview?: string;
      error?: ExecutionError;
      finishedAt?: string;
    },
  ): CommandRun | null {
    const finishedAt = patch.finishedAt ?? nowIso();
    this.db
      .prepare(
        `UPDATE command_runs SET
           status=@status, exitCode=@exitCode, durationMs=@durationMs,
           stdoutFileRef=@stdoutFileRef, stderrFileRef=@stderrFileRef,
           stdoutPreview=@stdoutPreview, error=@error, finishedAt=@finishedAt, updatedAt=@updatedAt
         WHERE id=@id`,
      )
      .run({
        id,
        status: patch.status,
        exitCode: patch.exitCode ?? null,
        durationMs: patch.durationMs ?? null,
        stdoutFileRef: patch.stdoutFileRef ?? null,
        stderrFileRef: patch.stderrFileRef ?? null,
        stdoutPreview: patch.stdoutPreview ?? null,
        error: patch.error ? toJson(patch.error) : null,
        finishedAt,
        updatedAt: finishedAt,
      });
    return this.getById(id);
  }

  setLink(id: string, patch: { projectId?: string | null; clauseId?: string | null; note?: string | null }): CommandRun | null {
    const existing = this.getById(id);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE command_runs SET projectId=@projectId, clauseId=@clauseId, note=@note, updatedAt=@updatedAt WHERE id=@id`,
      )
      .run({
        id,
        projectId: patch.projectId === undefined ? existing.projectId ?? null : patch.projectId,
        clauseId: patch.clauseId === undefined ? existing.clauseId ?? null : patch.clauseId,
        note: patch.note === undefined ? existing.note ?? null : patch.note,
        updatedAt: nowIso(),
      });
    return this.getById(id);
  }

  getById(id: string): CommandRun | null {
    const row = this.db
      .prepare('SELECT * FROM command_runs WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  list(q: CommandRunListQuery = {}): { items: CommandRun[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.workspaceId) conditions.push('workspaceId = ?'), params.push(q.workspaceId);
    if (q.toolId) conditions.push('toolId = ?'), params.push(q.toolId);
    if (q.projectId) conditions.push('projectId = ?'), params.push(q.projectId);
    if (q.status) conditions.push('status = ?'), params.push(q.status);
    if (q.keyword) {
      conditions.push('(toolName LIKE ? OR commandName LIKE ? OR resolvedCommand LIKE ? OR note LIKE ?)');
      const kw = `%${q.keyword}%`;
      for (let i = 0; i < 4; i++) params.push(kw);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM command_runs ${where}`).get(...params) as { c: number }).c;
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 20));
    const rows = this.db
      .prepare(`SELECT * FROM command_runs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return { items: rows.map((r) => this.mapRow(r)), total };
  }

  listRunning(): CommandRun[] {
    const rows = this.db
      .prepare("SELECT * FROM command_runs WHERE status = 'running'")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }
}
