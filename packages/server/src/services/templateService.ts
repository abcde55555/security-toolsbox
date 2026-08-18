import type { Template, TemplateStep, TemplateToolRef, TemplateVariable } from '@en18031/shared';
import { uuid } from '@en18031/shared';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';

export interface CreateTemplateInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  variables?: TemplateVariable[];
  concurrencyLimit?: number;
  steps?: TemplateStep[];
  toolRefs?: TemplateToolRef[];
}

function validateDag(steps: TemplateStep[]): void {
  const ids = new Set(steps.map((s) => s.stepId));
  if (ids.size !== steps.length) {
    throw Errors.invalidStep('stepId 必须唯一');
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        throw Errors.invalidStep(`步骤 ${step.stepId} 依赖了不存在的步骤 ${dep}`);
      }
    }
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(id: string): void {
    if (stack.has(id)) throw Errors.cycle(`检测到循环依赖: ${id}`);
    if (visited.has(id)) return;
    stack.add(id);
    const step = steps.find((s) => s.stepId === id);
    for (const dep of step?.dependsOn ?? []) dfs(dep);
    stack.delete(id);
    visited.add(id);
  }
  for (const s of steps) dfs(s.stepId);
}

export class TemplateService {
  constructor(private ctx: ServiceContext) {}

  list(): Template[] {
    return this.ctx.repos.templates.list();
  }

  get(id: string): Template {
    const t = this.ctx.repos.templates.getById(id);
    if (!t) throw Errors.notFound('模板', id);
    return t;
  }

  create(input: CreateTemplateInput): Template {
    if (!input.name?.trim()) throw Errors.validation('模板名称必填');
    if (input.steps) validateDag(input.steps);
    const refs = input.toolRefs ?? [];
    for (const ref of refs) {
      const tool = this.ctx.repos.tools.getById(ref.toolId);
      if (!tool) throw Errors.validation(`引用的工具不存在: ${ref.toolId}`);
      if (!ref.toolVersionSnapshot && ref.toolVersionLock === 'locked') {
        ref.toolVersionSnapshot = tool.version;
      }
    }
    const steps = (input.steps ?? []).map((s, i) => ({ ...s, position: i }));
    const template = this.ctx.repos.templates.create({
      ...input,
      steps,
      toolRefs: refs,
      workspaceId: 'default',
      createdBy: this.ctx.userId,
    });
    for (const ref of refs) {
      this.ctx.repos.tools.incrementRefCount(ref.toolId, 1);
    }
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'template.create',
      entityType: 'template',
      entityId: template.id,
      after: { id: template.id, name: template.name, steps: steps.length },
    });
    return template;
  }

  update(id: string, patch: Partial<CreateTemplateInput>, expectedRevision?: number): Template {
    const before = this.get(id);
    if (patch.steps) validateDag(patch.steps);
    const oldRefIds = new Set(before.toolRefs.map((r) => r.toolId));
    const newRefs = patch.toolRefs ?? before.toolRefs;
    const newRefIds = new Set(newRefs.map((r) => r.toolId));
    for (const ref of newRefs) {
      if (!this.ctx.repos.tools.getById(ref.toolId)) {
        throw Errors.validation(`引用的工具不存在: ${ref.toolId}`);
      }
    }
    const updated = this.ctx.repos.templates.update(id, {
      ...patch,
      steps: patch.steps?.map((s, i) => ({ ...s, position: i })),
      toolRefs: patch.toolRefs,
    }, expectedRevision);
    if (!updated) throw Errors.notFound('模板', id);
    for (const refId of oldRefIds) {
      if (!newRefIds.has(refId)) this.ctx.repos.tools.incrementRefCount(refId, -1);
    }
    for (const refId of newRefIds) {
      if (!oldRefIds.has(refId)) this.ctx.repos.tools.incrementRefCount(refId, 1);
    }
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'template.update',
      entityType: 'template',
      entityId: id,
      before: { name: before.name, revision: before.revision },
      after: { name: updated.name, revision: updated.revision },
    });
    return updated;
  }

  delete(id: string): void {
    this.get(id);
    if (this.ctx.repos.templates.countActiveProjects(id) > 0) {
      throw Errors.templateInUse();
    }
    const tpl = this.ctx.repos.templates.getById(id, true)!;
    for (const ref of tpl.toolRefs) {
      this.ctx.repos.tools.incrementRefCount(ref.toolId, -1);
    }
    this.ctx.repos.templates.softDelete(id);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'template.delete',
      entityType: 'template',
      entityId: id,
    });
  }

  clone(id: string, newName: string, inheritParent = false): Template {
    const source = this.get(id);
    const clone = this.ctx.repos.templates.create({
      name: newName,
      description: source.description ? `克隆自 ${source.name}: ${source.description}` : `克隆自 ${source.name}`,
      icon: source.icon,
      color: source.color,
      variables: JSON.parse(JSON.stringify(source.variables)),
      concurrencyLimit: source.concurrencyLimit,
      steps: JSON.parse(JSON.stringify(source.steps)),
      toolRefs: JSON.parse(JSON.stringify(source.toolRefs)),
      parentTemplateId: inheritParent ? source.id : undefined,
      inheritParent,
      workspaceId: 'default',
      createdBy: this.ctx.userId,
    });
    for (const ref of clone.toolRefs) {
      this.ctx.repos.tools.incrementRefCount(ref.toolId, 1);
    }
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'template.clone',
      entityType: 'template',
      entityId: clone.id,
      after: { sourceId: id, newId: clone.id, inheritParent },
    });
    return clone;
  }

  confirmUpgrade(id: string, toolId: string, lock: boolean): Template {
    this.get(id);
    const refs = this.ctx.repos.templates.getById(id)!.toolRefs;
    const ref = refs.find((r) => r.toolId === toolId);
    if (!ref) throw Errors.notFound('模板引用的工具', toolId);
    const tool = this.ctx.repos.tools.getById(toolId)!;
    const updated = this.ctx.repos.templates.update(id, {
      toolRefs: refs.map((r) =>
        r.toolId === toolId
          ? {
              ...r,
              toolVersionLock: lock ? 'locked' : r.toolVersionLock,
              toolVersionSnapshot: lock ? tool.version : r.toolVersionSnapshot,
              upgradePending: false,
            }
          : r,
      ),
    })!;
    this.ctx.repos.templates.clearUpgradePending(id, toolId);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'template.confirm_upgrade',
      entityType: 'template',
      entityId: id,
      after: { toolId, locked: lock },
    });
    return updated;
  }

  notifyToolUpgrade(toolId: string): number {
    return this.ctx.repos.templates.markUpgradePending(toolId);
  }

  /**
   * Compute clause coverage for a template: which clauses are covered by its
   * tools (via module-declared clauses or command mapping rules), and which
   * clauses of the standard are left uncovered.
   */
  coverage(id: string, standardVersion?: string) {
    const template = this.get(id);
    const covered = new Map<string, { clauseId: string; toolId: string; toolName: string; via: 'module' | 'rule' }>();

    for (const step of template.steps) {
      const tool = this.ctx.repos.tools.getById(step.toolId);
      if (!tool) continue;
      // Module tools declare their clauses on the tool record.
      for (const c of tool.clauses ?? []) {
        if (!covered.has(c.clauseId)) {
          covered.set(c.clauseId, { clauseId: c.clauseId, toolId: tool.id, toolName: tool.name, via: 'module' });
        }
      }
      // Command tools cover clauses through mapping rules.
      const rules = this.ctx.repos.clauses.listMappingRules(tool.id);
      for (const r of rules) {
        if (!covered.has(r.clauseId)) {
          covered.set(r.clauseId, { clauseId: r.clauseId, toolId: tool.id, toolName: tool.name, via: 'rule' });
        }
      }
    }

    // Standard must be supplied by the caller (the UI knows which standard a
    // project targets); fall back to the seeded EN18031 for convenience.
    const std = standardVersion ?? 'EN18031:2019';
    const allClauses = this.ctx.repos.clauses.list(std);
    const coveredIds = new Set(covered.keys());
    const uncovered = allClauses
      .filter((c) => !coveredIds.has(c.clauseId))
      .map((c) => ({ clauseId: c.clauseId, title: c.title, chapter: c.chapter, level: c.level }));

    return {
      templateId: id,
      standardVersion: std,
      total: allClauses.length,
      coveredCount: coveredIds.size,
      coverage: allClauses.length > 0 ? Math.round((coveredIds.size / allClauses.length) * 100) : 0,
      covered: Array.from(covered.values()),
      uncovered,
    };
  }
}
