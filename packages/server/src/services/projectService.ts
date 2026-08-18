import type { ComplianceLevel, Project, ProjectRun, StepRun, TemplateVariable } from '@en18031/shared';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';
import { CommandExecutor } from '../engine/commandExecutor.js';

export interface PreflightResult {
  ready: boolean;
  variables: { ok: boolean; missing: string[]; empty: string[] };
  tools: Array<{
    toolId: string;
    name: string;
    stepId: string;
    available: boolean;
    healthStatus: string;
    message?: string;
    skippable: boolean;
  }>;
  /** Steps that will be skipped because their tool is unavailable. */
  skippedSteps: string[];
  warnings: string[];
}

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
    // Variables are filled in *after* project creation (on the 变量 tab), so we
    // do not block creation on missing required values. Template-declared
    // defaults are seeded here; the orchestrator rejects unresolved
    // placeholders at run time if a required value is still empty.
    const variables = { ...this.defaultVariables(template.variables), ...(input.variables ?? {}) };
    const project = this.ctx.repos.projects.create({
      name: input.name,
      description: input.description,
      templateId: input.templateId,
      templateVersionSnapshot: template.revision,
      standardVersion: input.standardVersion ?? 'EN18031:2019',
      targetComplianceLevel: input.targetComplianceLevel,
      variables,
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

  private defaultVariables(declarations: TemplateVariable[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const decl of declarations) {
      if (decl.default !== undefined) out[decl.name] = decl.default;
    }
    return out;
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

  /**
   * Pre-run checks: are required variables filled, and is every step's tool
   * available? Tool unavailability is NON-fatal — those steps are marked
   * skipped at run time rather than aborting the whole run.
   */
  async preflight(id: string): Promise<PreflightResult> {
    const project = this.get(id);
    const template = this.ctx.repos.templates.getById(project.templateId);
    if (!template) throw Errors.validation('项目未绑定有效模板');

    const values = project.variables as Record<string, unknown>;
    const missing = this.validateVariables(template.variables, values);
    const empty = template.variables
      .filter((v) => !v.required)
      .filter((v) => values[v.name] === undefined || values[v.name] === null || values[v.name] === '')
      .map((v) => v.name);

    const tools: PreflightResult['tools'] = [];
    const skippedSteps: string[] = [];
    const warnings: string[] = [];

    for (const step of template.steps) {
      const tool = this.ctx.repos.tools.getById(step.toolId);
      if (!tool) {
        tools.push({
          toolId: step.toolId,
          name: step.toolId,
          stepId: step.stepId,
          available: false,
          healthStatus: 'red',
          message: '工具不存在',
          skippable: true,
        });
        skippedSteps.push(step.stepId);
        continue;
      }

      // A module is available if it was loaded at startup. Command tools
      // (interactionMode === 'cmd') have no module and are available unless
      // their binary/healthCheck fails below.
      let available = tool.interactionMode === 'form' ? this.ctx.moduleLoader.has(tool.id) : true;
      let healthStatus = available ? (tool.healthStatus ?? 'unknown') : 'red';
      let message: string | undefined;
      if (!available && tool.interactionMode === 'form') {
        message = '模组未加载（可能缺少依赖或启动失败）';
      }

      // For command tools / tools with a healthCheck command, verify the
      // executable is reachable.
      if (available && tool.healthCheck?.command) {
        try {
          const executor = new CommandExecutor();
          const r = await executor.runCommand(tool.healthCheck.command, {
            timeoutMs: tool.healthCheck.timeoutMs ?? 5000,
          });
          if (r.exitCode === 0) {
            available = true;
            healthStatus = 'green';
          } else {
            available = false;
            healthStatus = 'red';
            message = (r.stderr || r.stdout || '健康检查失败').slice(0, 200);
          }
        } catch (e) {
          available = false;
          healthStatus = 'red';
          message = (e as Error).message;
        }
      } else if (tool.interactionMode === 'cmd' && tool.path) {
        // Command tool with a path but no health check: verify the binary exists.
        try {
          const executor = new CommandExecutor();
          const r = await executor.runCommand(`command -v ${tool.path}`, { timeoutMs: 5000 });
          if (r.exitCode !== 0) {
            available = false;
            healthStatus = 'red';
            message = `找不到可执行文件: ${tool.path}`;
          }
        } catch {
          // command -v not available (Windows); treat as available.
        }
      }

      if (!available) {
        skippedSteps.push(step.stepId);
        warnings.push(`步骤「${step.title}」的工具「${tool.name}」不可用，运行时将跳过`);
      }

      tools.push({
        toolId: tool.id,
        name: tool.name,
        stepId: step.stepId,
        available,
        healthStatus,
        message,
        skippable: true,
      });
    }

    return {
      ready: missing.length === 0,
      variables: { ok: missing.length === 0, missing, empty },
      tools,
      skippedSteps,
      warnings,
    };
  }
}
