import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError } from './helpers.js';
import { Errors } from '../services/errors.js';
import type { Standard } from '@en18031/shared';

function parseBody(body: unknown): Omit<Standard, 'createdAt' | 'updatedAt'> {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = String(b.code ?? '').trim();
  const version = String(b.version ?? '').trim();
  const name = String(b.name ?? '').trim();
  if (!code) throw Errors.validation('标准代号必填');
  if (!name) throw Errors.validation('标准名称必填');
  if (!version) throw Errors.validation('版本必填');
  // id is provided explicitly, or derived as CODE:VERSION.
  const id = (b.id ? String(b.id).trim() : `${code}:${version}`).toUpperCase();
  return {
    id,
    code: code.toUpperCase(),
    name,
    version,
    description: b.description ? String(b.description) : undefined,
  };
}

export async function standardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/standards', { preHandler: requireRole('auditor') }, async (_req, reply) => {
    try {
      ok(reply, getServices().repos.standards.list());
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/standards', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const data = parseBody(req.body);
      const repos = getServices().repos;
      if (repos.standards.get(data.id)) {
        throw Errors.conflict(`标准 ${data.id} 已存在`);
      }
      const standard = repos.standards.upsert(data);
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'standard.create',
        entityType: 'standard',
        entityId: standard.id,
        after: data,
      });
      ok(reply, standard);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/standards/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const repos = getServices().repos;
      const existing = repos.standards.get(id);
      if (!existing) throw Errors.notFound('标准', id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (b.name !== undefined && !String(b.name).trim()) {
        throw Errors.validation('标准名称必填');
      }
      if (b.version !== undefined && !String(b.version).trim()) {
        throw Errors.validation('版本必填');
      }
      const next: Omit<Standard, 'createdAt' | 'updatedAt'> = {
        id,
        code: b.code ? String(b.code).trim().toUpperCase() : existing.code,
        name: b.name ? String(b.name).trim() : existing.name,
        version: b.version ? String(b.version).trim() : existing.version,
        description:
          b.description !== undefined
            ? b.description
              ? String(b.description)
              : undefined
            : existing.description,
      };
      const standard = repos.standards.upsert(next);
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'standard.update',
        entityType: 'standard',
        entityId: id,
        before: existing,
        after: next,
      });
      ok(reply, standard);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/standards/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const repos = getServices().repos;
      const clauseCount = repos.clauses.countForStandard(id);
      if (clauseCount > 0) {
        throw Errors.conflict(`该标准下还有 ${clauseCount} 条条款，不能删除`);
      }
      const deleted = repos.standards.delete(id);
      if (!deleted) throw Errors.notFound('标准', id);
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'standard.delete',
        entityType: 'standard',
        entityId: id,
      });
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });
}
