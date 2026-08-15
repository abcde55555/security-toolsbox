import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError } from './helpers.js';
import type { Clause, ClauseMappingRule } from '@en18031/shared';

export async function clauseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/clauses', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { standardVersion?: string; level?: 'L1' | 'L2' | 'L3' };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      ok(reply, getServices().clauses.listClauses(standardVersion, q.level));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/clauses/:clauseId', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { clauseId } = req.params as { clauseId: string };
      const q = req.query as { standardVersion?: string };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      const clause = getServices().clauses.validateClauseExists(standardVersion, clauseId);
      ok(reply, clause);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/clauses/batch-import', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const clauses = req.body as Clause[];
      const repos = getServices().repos;
      const list = Array.isArray(clauses) ? clauses : [];
      for (const c of list) repos.clauses.upsert(c);
      ok(reply, { imported: list.length });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/clause-mapping-rules', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { toolId?: string };
      ok(reply, getServices().repos.clauses.listMappingRules(q.toolId));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/clause-mapping-rules', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const body = req.body as Omit<ClauseMappingRule, 'id'>;
      const rule = getServices().repos.clauses.createMappingRule(body);
      ok(reply, rule);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/clause-mapping-rules/:id', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      getServices().repos.clauses.deleteMappingRule(id);
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/clause-verdicts/:id/override', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { pass, reason } = req.body as { pass: boolean; reason: string };
      ok(reply, getServices().clauses.overrideVerdict(id, pass, reason));
    } catch (e) {
      handleError(reply, e);
    }
  });
}
