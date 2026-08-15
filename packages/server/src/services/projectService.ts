import type { ComplianceLevel, Project, ProjectRun, StepRun, TemplateVariable } from '@en18031/shared';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';

export class ProjectService {
  constructor(private ctx: ServiceContext) {}

  list(): Project[] {
    return this.ctx.repos.projects.list();
  }

  get(id: string): Project {
    const p = this.ctx.repos.projects.getById(id);
    if (!p) throw Errors.notFound('项目', id);
    return p;
  }

  create(input: {
    name: string;
    description?: string;
    templateId: string;
    targetComplianceLevel: ComplianceLevel;
    standardVersion?: string;
    variables: Record<string, unknown>;
  }): Project {
    const template = this.ctx.repos.templates.getById(input.templateId);
    if (!template) throw Errors.validation('所选模板不存在');
    const missing = this.validateVariables(template.variables, input.variables);
    if (missing.length > 0) {
      throw Errors.variablesMissing(`缺少必填变量: ${missing.join(', ')}`, { missing });
    }
    const project = this.ctx.repos.projects.create({
      name: input.name,
      description: input.description,
      templateId: input.templateId,
      templateVersionSnapshot: template.revision,
      standardVersion: input.standardVersion ?? 'EN18031:2019',
      targetComplianceLevel: input.targetComplianceLevel,
      variables: input.variables,
      createdBy: this.ctx.userId,
      workspaceId: 'default',
    });
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'project.create',
      entityType: 'project',
      entityId: project.id,
      after: { name: project.name, templateId: project.templateId, level: project.targetComplianceLevel },
    });
    return project;
  }

  update(id: string, patch: { name?: string; description?: string; variables?: Record<string, unknown>; targetComplianceLevel?: ComplianceLevel }): Project {
    const before = this.get(id);
    if (patch.variables) {
      const template = this.ctx.repos.templates.getById(before.templateId);
      if (template) {
        const missing = this.validateVariables(template.variables, patch.variables);
        if (missing.length > 0) {
          throw Errors.variablesMissing(`缺少必填变量: ${missing.join(', ')}`, { missing });
        }
      }
    }
    const updated = this.ctx.repos.projects.update(id, patch);
    if (!updated) throw Errors.notFound('项目', id);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'project.update',
      entityType: 'project',
      entityId: id,
      before: { name: before.name },
      after: { name: updated.name },
    });
    return updated;
  }

  delete(id: string): void {
    this.get(id);
    this.ctx.repos.projects.softDelete(id);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'project.delete',
      entityType: 'project',
      entityId: id,
    });
  }

  listRuns(id: string): ProjectRun[] {
    this.get(id);
    return this.ctx.repos.projects.listRuns(id);
  }

  getRun(runId: string): ProjectRun {
    const run = this.ctx.repos.projects.getRun(runId);
    if (!run) throw Errors.notFound('执行批次', runId);
    return run;
  }

  listStepRuns(runId: string): StepRun[] {
    return this.ctx.repos.projects.listStepRuns(runId);
  }

  getStepRun(stepRunId: string): StepRun {
    const sr = this.ctx.repos.projects.getStepRun(stepRunId);
    if (!sr) throw Errors.notFound('步骤执行', stepRunId);
    return sr;
  }

  updateVariables(id: string, variables: Record<string, unknown>): Project {
    return this.update(id, { variables });
  }

  private validateVariables(
    declarations: TemplateVariable[],
    values: Record<string, unknown>,
  ): string[] {
    const missing: string[] = [];
    for (const decl of declarations) {
      if (decl.required) {
        const v = values[decl.name];
        if (v === undefined || v === null || v === '') missing.push(decl.name);
      }
    }
    return missing;
  }
}
