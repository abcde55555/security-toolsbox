import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError, parseBody } from './helpers.js';

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  deviceProfile: z.record(z.string(), z.unknown()).optional(),
  selectedClauses: z.array(z.string()).optional(),
  authorizedTools: z.array(z.string()).optional(),
  planningModel: z.string().optional(),
  narrativeModel: z.string().optional(),
  initialMessage: z.string().optional(),
});

const messageSchema = z.object({
  content: z.string().min(1),
});

const completeHumanStepSchema = z.object({
  note: z.string().optional(),
  fileRefs: z.array(z.string()).optional(),
});

const artifactSchema = z.object({
  projectId: z.string().min(1),
  projectRunId: z.string().optional(),
  agentSessionId: z.string().optional(),
  type: z.enum(['device_profile', 'network_topology', 'onboarding_result', 'other']),
  title: z.string().optional(),
  content: z.string().optional(),
  fileRefs: z.array(z.string()).optional(),
  functionModule: z.string().optional(),
});

const reviewSchema = z.object({
  note: z.string().optional(),
});
const rejectSchema = z.object({
  reason: z.string().min(1),
});

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // ---- Sessions ----
  app.post('/api/agent/sessions', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const body = parseBody(createSessionSchema, req.body);
      const services = getServices();
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      const userId = user?.id ?? 'local-admin';
      const session = services.agent.createSession({ ...body, createdBy: userId });
      ok(reply, session);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/agent/sessions', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { projectId?: string; limit?: string; offset?: string };
      const result = getServices().agent.listSessions({
        projectId: q.projectId,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      });
      ok(reply, result.items, {
        total: result.total,
        page: 1,
        pageSize: result.items.length,
        totalPages: Math.ceil(result.total / Math.max(1, result.items.length)),
      });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/agent/sessions/:id', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().agent.getSession(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/agent/sessions/:id/start', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = parseBody(z.object({ message: z.string().optional() }), req.body ?? {});
      const services = getServices();
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      services.agent.start(id, user?.id ?? 'local-admin', { message: body.message });
      ok(reply, { sessionId: id, status: 'running' });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/agent/sessions/:id/abort', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      getServices().agent.abort(id, user?.id ?? 'local-admin');
      ok(reply, { sessionId: id, status: 'aborted' });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/agent/sessions/:id/messages', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = parseBody(messageSchema, req.body);
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      const ev = await getServices().agent.sendMessage(id, body.content, user?.id ?? 'local-admin');
      ok(reply, ev);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/agent/sessions/:id/events', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const q = req.query as { sinceSeq?: string };
      const sinceSeq = q.sinceSeq ? Number(q.sinceSeq) : 0;
      const events = getServices().agent.listEvents(id, sinceSeq);
      ok(reply, events);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/agent/sessions/:id/steps', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().agent.listSteps(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  // ---- Human steps ----
  app.post(
    '/api/agent/sessions/:id/human-steps/:stepRunId/complete',
    { preHandler: requireRole('auditor') },
    async (req, reply) => {
      try {
        const { id, stepRunId } = req.params as { id: string; stepRunId: string };
        const body = parseBody(completeHumanStepSchema, req.body ?? {});
        const user = (req as FastifyRequest & { user?: { id: string } }).user;
        getServices().agent.completeHumanStep(id, stepRunId, body, user?.id ?? 'local-admin');
        ok(reply, { stepRunId, completed: true });
      } catch (e) {
        handleError(reply, e);
      }
    },
  );

  // ---- Verdicts review ----
  app.get('/api/agent/projects/:projectId/pending-verdicts', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { projectId } = req.params as { projectId: string };
      ok(reply, getServices().agent.listPendingVerdicts(projectId));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/agent/verdicts/:verdictId/approve', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { verdictId } = req.params as { verdictId: string };
      const body = parseBody(reviewSchema, req.body ?? {});
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      ok(reply, getServices().agent.approveVerdict(verdictId, user?.id ?? 'local-admin', body.note));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/agent/verdicts/:verdictId/reject', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { verdictId } = req.params as { verdictId: string };
      const body = parseBody(rejectSchema, req.body);
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      ok(reply, getServices().agent.rejectVerdict(verdictId, user?.id ?? 'local-admin', body.reason));
    } catch (e) {
      handleError(reply, e);
    }
  });

  // ---- Artifacts ----
  app.post('/api/agent/artifacts', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const body = parseBody(artifactSchema, req.body);
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      const artifact = getServices().repos.artifacts.create({
        ...body,
        createdBy: user?.id ?? 'local-admin',
      });
      ok(reply, artifact);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/agent/artifacts', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { sessionId?: string; projectId?: string };
      const repos = getServices().repos;
      if (q.sessionId) ok(reply, repos.artifacts.listBySession(q.sessionId));
      else if (q.projectId) ok(reply, repos.artifacts.listByProject(q.projectId));
      else ok(reply, []);
    } catch (e) {
      handleError(reply, e);
    }
  });
}
