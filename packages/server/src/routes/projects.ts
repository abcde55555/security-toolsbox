import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError, pagingFromQuery } from './helpers.js';
import { readFile, access } from 'node:fs/promises';

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', { preHandler: requireRole('auditor') }, async (_req, reply) => {
    try {
      ok(reply, getServices().repos.projects.listWithLatestRun());
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const services = getServices();
      const project = services.projects.get(id);
      const latestRun = services.repos.projects.latestRun(id);
      ok(reply, { ...project, latestRun });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>;
      const project = getServices().projects.create(body as never);
      ok(reply, project);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/projects/:id', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().projects.update(id, req.body as never));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/projects/:id', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      getServices().projects.delete(id);
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/runs', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().projects.listRuns(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/variables', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().projects.get(id).variables);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/projects/:id/variables', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { variables } = req.body as { variables: Record<string, unknown> };
      ok(reply, getServices().projects.updateVariables(id, variables));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects/:id/runs', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { stepIds?: string[]; concurrencyOverride?: number; fromStepId?: string };
      const run = await getServices().orchestrator.startRun(id, body);
      ok(reply, run);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects/:id/runs/:runId/cancel', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { runId } = req.params as { runId: string };
      getServices().orchestrator.cancelRun(runId);
      ok(reply, { runId, cancelRequested: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects/:id/runs/:runId/steps/:stepRunId/retry', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id, runId, stepRunId } = req.params as { id: string; runId: string; stepRunId: string };
      const sr = await getServices().orchestrator.retryStep(id, runId, stepRunId);
      ok(reply, sr);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/runs/:runId', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { runId } = req.params as { runId: string };
      ok(reply, getServices().projects.getRun(runId));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/runs/:runId/steps', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { runId } = req.params as { runId: string };
      const services = getServices();
      const steps = services.projects.listStepRuns(runId);
      ok(reply, steps);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/runs/:runId/steps/:stepRunId', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { stepRunId } = req.params as { stepRunId: string };
      const services = getServices();
      const stepRun = services.projects.getStepRun(stepRunId);
      const evidences = services.repos.results.listEvidenceByStepRun(stepRunId);
      const verdicts = services.repos.results.listVerdictsByStepRun(stepRunId);
      let stdout = '';
      let stderr = '';
      if (stepRun.stdoutFileRef) {
        try {
          await access(stepRun.stdoutFileRef);
          stdout = (await readFile(stepRun.stdoutFileRef, 'utf8')).slice(-100000);
        } catch {
          // file may be absent; leave stdout empty
        }
      }
      if (stepRun.stderrFileRef) {
        try {
          await access(stepRun.stderrFileRef);
          stderr = (await readFile(stepRun.stderrFileRef, 'utf8')).slice(-100000);
        } catch {
          // file may be absent; leave stderr empty
        }
      }
      ok(reply, { ...stepRun, evidences, verdicts, stdout, stderr });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects/:id/tools/:toolId/execute-cmd', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id, toolId } = req.params as { id: string; toolId: string };
      const body = (req.body ?? {}) as { commandId?: string; params?: Record<string, unknown>; timeoutMs?: number };
      const r = await getServices().orchestrator.runToolManually(id, toolId, body.params ?? {}, {
        commandId: body.commandId,
        timeoutMs: body.timeoutMs,
      });
      ok(reply, { runId: r.runId, stepRunId: r.stepRunId, status: r.result.status });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects/:id/tools/:toolId/execute-module', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id, toolId } = req.params as { id: string; toolId: string };
      const body = (req.body ?? {}) as { params?: Record<string, unknown>; timeoutMs?: number };
      const r = await getServices().orchestrator.runToolManually(id, toolId, body.params ?? {}, { timeoutMs: body.timeoutMs });
      ok(reply, { runId: r.runId, stepRunId: r.stepRunId, status: r.result.status });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/logs', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      const { page, pageSize } = pagingFromQuery(q);
      const result = getServices().repos.audit.query({
        entityId: q.entityId,
        action: q.action,
        keyword: q.keyword,
        since: q.since,
        until: q.until,
        page,
        pageSize,
      });
      ok(reply, result.items, { total: result.total, page, pageSize, totalPages: Math.ceil(result.total / pageSize) });
    } catch (e) {
      handleError(reply, e);
    }
  });
}
