import type { Database } from 'better-sqlite3';
import type { Tool, HealthStatus } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';
import { Errors } from '../services/errors.js';

export interface ToolListQuery {
  workspaceId?: string;
  keyword?: string;
  type?: string;
  interactionMode?: string;
  category?: string;
  healthStatus?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
}

export class ToolRepository {
  constructor(private db: Database) {}

  private mapRow(r: Record<string, unknown>): Tool {
    return {
      id: String(r.id),
      workspaceId: String(r.workspaceId ?? 'default'),
      name: String(r.name),
      type: r.type as Tool['type'],
      interactionMode: r.interactionMode as Tool['interactionMode'],
      version: String(r.version),
      sdkVersion: r.sdkVersion ? String(r.sdkVersion) : undefined,
      author: r.author ? String(r.author) : undefined,
      description: r.description ? String(r.description) : undefined,
      tags: parseJson<string[]>(r.tags, []),
      category: r.category as Tool['category'],
      path: r.path ? String(r.path) : undefined,
      envVars: r.envVars ? parseJson<Record<string, string>>(r.envVars, {}) : undefined,
      setupCommand: r.setupCommand ? String(r.setupCommand) : undefined,
      healthCheck: r.healthCheck
        ? parseJson<{ command: string; timeoutMs?: number }>(r.healthCheck, { command: '' })
        : undefined,
      formFields: parseJson(r.formFields, []),
      clauses: parseJson(r.clauses, []),
      commands: parseJson(r.commands, []),
      referenceCount: Number(r.referenceCount ?? 0),
      healthStatus: r.healthStatus as HealthStatus,
      healthMessage: r.healthMessage ? String(r.healthMessage) : undefined,
      healthCheckedAt: r.healthCheckedAt ? String(r.healthCheckedAt) : undefined,
      builtin: Boolean(r.builtin),
      revision: Number(r.revision ?? 1),
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
      deletedAt: r.deletedAt ? String(r.deletedAt) : undefined,
    };
  }

  create(input: Partial<Tool> & Pick<Tool, 'name' | 'type' | 'interactionMode' | 'version' | 'category'> & { builtin?: boolean }): Tool {
    const now = nowIso();
    const id = input.id || uuid();
    this.db
      .prepare(
        `INSERT INTO tools (id, workspaceId, name, type, interactionMode, version, sdkVersion, author, description,
          tags, category, path, envVars, setupCommand, healthCheck, formFields, clauses, commands, referenceCount, healthStatus, builtin, createdAt, updatedAt)
         VALUES (@id,@workspaceId,@name,@type,@interactionMode,@version,@sdkVersion,@author,@description,
          @tags,@category,@path,@envVars,@setupCommand,@healthCheck,@formFields,@clauses,@commands,0,'unknown',@builtin,@createdAt,@updatedAt)`,
      )
      .run({
        id,
        workspaceId: input.workspaceId || 'default',
        name: input.name,
        type: input.type,
        interactionMode: input.interactionMode,
        version: input.version,
        sdkVersion: input.sdkVersion ?? null,
        author: input.author ?? null,
        description: input.description ?? null,
        tags: toJson(input.tags ?? []),
        category: input.category,
        path: input.path ?? null,
        envVars: input.envVars ? toJson(input.envVars) : null,
        setupCommand: input.setupCommand ? input.setupCommand : null,
        healthCheck: input.healthCheck ? toJson(input.healthCheck) : null,
        formFields: toJson(input.formFields ?? []),
        clauses: toJson(input.clauses ?? []),
        commands: toJson(input.commands ?? []),
        builtin: input.builtin ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
    return this.getById(id)!;
  }

  getById(id: string, includeDeleted = false): Tool | null {
    const row = this.db
      .prepare(`SELECT * FROM tools WHERE id = ? ${includeDeleted ? '' : 'AND deletedAt IS NULL'}`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  list(q: ToolListQuery = {}): { items: Tool[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!q.includeDeleted) conditions.push('deletedAt IS NULL');
    if (q.workspaceId) conditions.push('workspaceId = ?'), params.push(q.workspaceId);
    if (q.type) conditions.push('type = ?'), params.push(q.type);
    if (q.interactionMode) conditions.push('interactionMode = ?'), params.push(q.interactionMode);
    if (q.category) conditions.push('category = ?'), params.push(q.category);
    if (q.healthStatus) conditions.push('healthStatus = ?'), params.push(q.healthStatus);
    if (q.keyword) {
      conditions.push('(name LIKE ? OR description LIKE ? OR id LIKE ?)');
      const kw = `%${q.keyword}%`;
      params.push(kw, kw, kw);
    }
    if (q.tag) conditions.push("tags LIKE ?"), params.push(`%"${q.tag}"%`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM tools ${where}`).get(...params) as { c: number }).c;
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
    const rows = this.db
      .prepare(`SELECT * FROM tools ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return { items: rows.map((r) => this.mapRow(r)), total };
  }

  update(id: string, patch: Partial<Tool>, expectedRevision?: number): Tool | null {
    const existing = this.getById(id, true);
    if (!existing) return null;
    const merged = { ...existing, ...patch, updatedAt: nowIso() };
    const info = this.db
      .prepare(
        `UPDATE tools SET name=@name, type=@type, interactionMode=@interactionMode, version=@version,
          sdkVersion=@sdkVersion, author=@author, description=@description, tags=@tags, category=@category,
          path=@path, envVars=@envVars, setupCommand=@setupCommand, healthCheck=@healthCheck, formFields=@formFields, clauses=@clauses,
          commands=@commands,
          updatedAt=@updatedAt, revision=revision+1
         WHERE id=@id${expectedRevision !== undefined ? ' AND revision=@expectedRevision' : ''}`,
      )
      .run({
        id,
        name: merged.name,
        type: merged.type,
        interactionMode: merged.interactionMode,
        version: merged.version,
        sdkVersion: merged.sdkVersion ?? null,
        author: merged.author ?? null,
        description: merged.description ?? null,
        tags: toJson(merged.tags),
        category: merged.category,
        path: merged.path ?? null,
        envVars: merged.envVars ? toJson(merged.envVars) : null,
        setupCommand: merged.setupCommand ?? null,
        healthCheck: merged.healthCheck ? toJson(merged.healthCheck) : null,
        formFields: toJson(merged.formFields),
        clauses: toJson(merged.clauses),
        commands: toJson(merged.commands ?? []),
        updatedAt: merged.updatedAt,
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      });
    if (expectedRevision !== undefined && info.changes === 0) {
      throw Errors.conflict('该工具已被其他地方修改，请刷新后重试');
    }
    return this.getById(id);
  }

  setHealth(id: string, status: HealthStatus, message?: string): void {
    this.db
      .prepare(
        `UPDATE tools SET healthStatus=?, healthMessage=?, healthCheckedAt=?, updatedAt=? WHERE id=?`,
      )
      .run(status, message ?? null, nowIso(), nowIso(), id);
  }

  incrementRefCount(id: string, delta: number): void {
    this.db.prepare('UPDATE tools SET referenceCount = referenceCount + ? WHERE id = ?').run(delta, id);
  }

  softDelete(id: string): void {
    this.db.prepare('UPDATE tools SET deletedAt=?, updatedAt=? WHERE id=?').run(nowIso(), nowIso(), id);
  }

  countReferences(id: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) c FROM template_tools tt
         JOIN templates t ON t.id = tt.templateId
         WHERE tt.toolId = ? AND t.deletedAt IS NULL`,
      )
      .get(id) as { c: number };
    return row.c;
  }
}
