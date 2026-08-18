import type { Database } from 'better-sqlite3';
import type { Template, TemplateStep, TemplateToolRef, TemplateVariable, TemplateClauseBinding, TemplateMode } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';
import { Errors } from '../services/errors.js';

interface NewTemplate {
  id?: string;
  workspaceId?: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  variables?: TemplateVariable[];
  concurrencyLimit?: number;
  steps?: TemplateStep[];
  toolRefs?: TemplateToolRef[];
  mode?: TemplateMode;
  clauseBindings?: TemplateClauseBinding[];
  parentTemplateId?: string;
  inheritParent?: boolean;
  createdBy: string;
}

export class TemplateRepository {
  constructor(private db: Database) {}

  create(input: NewTemplate): Template {
    const id = input.id ?? uuid();
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO templates (id, workspaceId, name, description, icon, color, schemaVersion, mode, variables,
            concurrencyLimit, parentTemplateId, inheritParent, revision, createdBy, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.workspaceId ?? 'default',
          input.name,
          input.description ?? null,
          input.icon ?? null,
          input.color ?? null,
          'v1',
          input.mode ?? 'ad-hoc',
          toJson(input.variables ?? []),
          input.concurrencyLimit ?? 2,
          input.parentTemplateId ?? null,
          input.inheritParent ? 1 : 0,
          1,
          input.createdBy,
          now,
          now,
        );
      if (input.clauseBindings?.length) {
        const ins = this.db.prepare(
          `INSERT INTO template_clause_bindings (templateId, clauseId, enabled, position, aggregation)
           VALUES (?,?,?,?,?)`,
        );
        input.clauseBindings.forEach((b, i) => {
          ins.run(id, b.clauseId, b.enabled ? 1 : 0, b.position ?? i, toJson(b.aggregation));
        });
      }
      for (const ref of input.toolRefs ?? []) {
        this.db
          .prepare(
            `INSERT INTO template_tools (id, templateId, toolId, toolVersionLock, toolVersionSnapshot, selectedCommands, stepParams, upgradePending, createdAt)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            uuid(),
            id,
            ref.toolId,
            ref.toolVersionLock,
            ref.toolVersionSnapshot ?? null,
            ref.selectedCommands ? toJson(ref.selectedCommands) : null,
            ref.stepParams ? toJson(ref.stepParams) : null,
            ref.upgradePending ? 1 : 0,
            now,
          );
      }
      for (const step of input.steps ?? []) {
        this.insertStep(id, step);
      }
    });
    tx();
    return this.getById(id)!;
  }

  private insertStep(templateId: string, step: TemplateStep): void {
    this.db
      .prepare(
        `INSERT INTO template_steps (id, templateId, stepId, title, toolId, toolVersion, interactionModeOverride,
          params, selectedCommands, dependsOn, onFailure, retry, retryBackoffMs, timeoutMs, exportVars, weight,
          expandMode, ephemeral, position, clauseId, verdictRule, groupKey)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        uuid(),
        templateId,
        step.stepId,
        step.title,
        step.toolId,
        step.toolVersion,
        step.interactionModeOverride ?? null,
        toJson(step.params ?? {}),
        step.selectedCommands ? toJson(step.selectedCommands) : null,
        toJson(step.dependsOn ?? []),
        step.onFailure,
        step.retry ?? 0,
        step.retryBackoffMs ?? 2000,
        step.timeoutMs ?? null,
        step.exportVars ? toJson(step.exportVars) : null,
        step.weight ?? 1,
        step.expandMode ?? 'cartesian',
        step.ephemeral ? 1 : 0,
        step.position ?? 0,
        step.clauseId ?? null,
        step.verdictRule ? toJson(step.verdictRule) : null,
        step.groupKey ?? null,
      );
  }

  getById(id: string, includeDeleted = false): Template | null {
    const row = this.db
      .prepare(`SELECT * FROM templates WHERE id = ? ${includeDeleted ? '' : 'AND deletedAt IS NULL'}`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapTemplate(row);
  }

  list(workspaceId = 'default'): Template[] {
    const rows = this.db
      .prepare('SELECT * FROM templates WHERE workspaceId = ? AND deletedAt IS NULL ORDER BY updatedAt DESC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapTemplate(r));
  }

  private mapTemplate(r: Record<string, unknown>): Template {
    const id = String(r.id);
    const steps = this.db
      .prepare('SELECT * FROM template_steps WHERE templateId = ? ORDER BY position ASC')
      .all(id) as Record<string, unknown>[];
    const refs = this.db
      .prepare('SELECT * FROM template_tools WHERE templateId = ?')
      .all(id) as Record<string, unknown>[];
    return {
      id,
      workspaceId: String(r.workspaceId),
      name: String(r.name),
      description: r.description ? String(r.description) : undefined,
      icon: r.icon ? String(r.icon) : undefined,
      color: r.color ? String(r.color) : undefined,
      schemaVersion: String(r.schemaVersion),
      mode: (r.mode as Template['mode']) ?? 'ad-hoc',
      variables: parseJson<TemplateVariable[]>(r.variables, []),
      concurrencyLimit: Number(r.concurrencyLimit),
      steps: steps.map((s) => ({
        stepId: String(s.stepId),
        title: String(s.title),
        toolId: String(s.toolId),
        toolVersion: String(s.toolVersion),
        interactionModeOverride: s.interactionModeOverride
          ? (String(s.interactionModeOverride) as TemplateStep['interactionModeOverride'])
          : undefined,
        params: parseJson<Record<string, unknown>>(s.params, {}),
        selectedCommands: s.selectedCommands
          ? parseJson<string[] | 'all'>(s.selectedCommands, [])
          : undefined,
        dependsOn: parseJson<string[]>(s.dependsOn, []),
        onFailure: s.onFailure as TemplateStep['onFailure'],
        retry: Number(s.retry),
        retryBackoffMs: Number(s.retryBackoffMs),
        timeoutMs: s.timeoutMs ? Number(s.timeoutMs) : undefined,
        exportVars: s.exportVars
          ? (parseJson(s.exportVars, {}) as TemplateStep['exportVars'])
          : undefined,
        weight: Number(s.weight),
        expandMode: String(s.expandMode) as TemplateStep['expandMode'],
        ephemeral: Boolean(s.ephemeral),
        position: Number(s.position),
        clauseId: s.clauseId ? String(s.clauseId) : null,
        verdictRule: s.verdictRule
          ? (parseJson(s.verdictRule, null) as TemplateStep['verdictRule'])
          : undefined,
        groupKey: s.groupKey ? String(s.groupKey) : null,
      })),
      toolRefs: refs.map((rf) => ({
        toolId: String(rf.toolId),
        toolVersionLock: String(rf.toolVersionLock) as TemplateToolRef['toolVersionLock'],
        toolVersionSnapshot: rf.toolVersionSnapshot ? String(rf.toolVersionSnapshot) : undefined,
        selectedCommands: rf.selectedCommands ? parseJson<string[]>(rf.selectedCommands, []) : undefined,
        stepParams: rf.stepParams ? parseJson<Record<string, unknown>>(rf.stepParams, {}) : undefined,
        upgradePending: Boolean(rf.upgradePending),
      })),
      clauseBindings: this.getClauseBindings(id),
      parentTemplateId: r.parentTemplateId ? String(r.parentTemplateId) : undefined,
      inheritParent: Boolean(r.inheritParent),
      revision: Number(r.revision),
      createdBy: String(r.createdBy),
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
      deletedAt: r.deletedAt ? String(r.deletedAt) : undefined,
    };
  }

  update(
    id: string,
    patch: Partial<Template> & { toolRefs?: TemplateToolRef[]; steps?: TemplateStep[] },
    expectedRevision?: number,
  ): Template | null {
    const existing = this.getById(id, true);
    if (!existing) return null;
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `UPDATE templates SET name=?, description=?, icon=?, color=?, mode=?, variables=?, concurrencyLimit=?,
             parentTemplateId=?, inheritParent=?, revision=revision+1, updatedAt=?
             WHERE id=?${expectedRevision !== undefined ? ' AND revision=?' : ''}`,
        )
        .run(
          patch.name ?? existing.name,
          patch.description ?? existing.description ?? null,
          patch.icon ?? existing.icon ?? null,
          patch.color ?? existing.color ?? null,
          patch.mode ?? existing.mode ?? 'ad-hoc',
          toJson(patch.variables ?? existing.variables),
          patch.concurrencyLimit ?? existing.concurrencyLimit,
          patch.parentTemplateId ?? existing.parentTemplateId ?? null,
          patch.inheritParent ?? existing.inheritParent ? 1 : 0,
          now,
          id,
          ...(expectedRevision !== undefined ? [expectedRevision] : []),
        );
      if (expectedRevision !== undefined && info.changes === 0) {
        throw Errors.conflict('该模板已被其他地方修改，请刷新后重试');
      }
      if (patch.toolRefs) {
        this.db.prepare('DELETE FROM template_tools WHERE templateId = ?').run(id);
        for (const ref of patch.toolRefs) {
          this.db
            .prepare(
              `INSERT INTO template_tools (id, templateId, toolId, toolVersionLock, toolVersionSnapshot, selectedCommands, stepParams, upgradePending, createdAt)
               VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              uuid(),
              id,
              ref.toolId,
              ref.toolVersionLock,
              ref.toolVersionSnapshot ?? null,
              ref.selectedCommands ? toJson(ref.selectedCommands) : null,
              ref.stepParams ? toJson(ref.stepParams) : null,
              ref.upgradePending ? 1 : 0,
              now,
            );
        }
      }
      if (patch.steps) {
        this.db.prepare('DELETE FROM template_steps WHERE templateId = ?').run(id);
        patch.steps.forEach((s, i) => this.insertStep(id, { ...s, position: i }));
      }
      if (patch.clauseBindings) {
        this.setClauseBindings(id, patch.clauseBindings);
      }
    });
    tx();
    return this.getById(id);
  }

  markUpgradePending(toolId: string): number {
    const res = this.db
      .prepare(
        `UPDATE template_tools SET upgradePending = 1
         WHERE toolId = ? AND toolVersionLock = 'follow'`,
      )
      .run(toolId);
    return res.changes;
  }

  clearUpgradePending(templateId: string, toolId: string): void {
    this.db
      .prepare('UPDATE template_tools SET upgradePending = 0 WHERE templateId = ? AND toolId = ?')
      .run(templateId, toolId);
  }

  getClauseBindings(templateId: string): TemplateClauseBinding[] {
    const rows = this.db
      .prepare(
        'SELECT clauseId, enabled, position, aggregation FROM template_clause_bindings WHERE templateId = ? ORDER BY position ASC',
      )
      .all(templateId) as Record<string, unknown>[];
    return rows.map((r) => ({
      clauseId: String(r.clauseId),
      enabled: Boolean(r.enabled),
      position: Number(r.position),
      aggregation: parseJson(r.aggregation, { mode: 'cross_check', strategy: 'all_pass' }) as TemplateClauseBinding['aggregation'],
    }));
  }

  setClauseBindings(templateId: string, bindings: TemplateClauseBinding[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM template_clause_bindings WHERE templateId = ?').run(templateId);
      const ins = this.db.prepare(
        `INSERT INTO template_clause_bindings (templateId, clauseId, enabled, position, aggregation)
         VALUES (?,?,?,?,?)`,
      );
      bindings.forEach((b, i) => {
        ins.run(templateId, b.clauseId, b.enabled ? 1 : 0, b.position ?? i, toJson(b.aggregation));
      });
    });
    tx();
  }

  setMode(templateId: string, mode: Template['mode']): void {
    this.db
      .prepare('UPDATE templates SET mode = ?, updatedAt = ? WHERE id = ?')
      .run(mode, nowIso(), templateId);
  }

  softDelete(id: string): void {
    this.db.prepare('UPDATE templates SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  }

  countActiveProjects(templateId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) c FROM projects WHERE templateId = ? AND deletedAt IS NULL AND status IN ('draft','running')",
      )
      .get(templateId) as { c: number };
    return row.c;
  }
}
