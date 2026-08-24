import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getServices } from '../services/index.js';
import { handleError, ok, parseBody, requireRole } from './helpers.js';

const noteCreateSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  sourceType: z.enum(['manual', 'url', 'case']).optional(),
  sourceUrl: z.string().url().optional(),
});

const noteUpdateSchema = noteCreateSchema.partial().extend({
  sourceUrl: z.string().url().nullable().optional(),
});

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  /** List notes (keyword search across title/content/tags). */
  app.get('/api/knowledge-notes', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { keyword?: string; limit?: string };
      const services = getServices();
      const limit = q.limit ? Number(q.limit) : undefined;
      const { items, total } = services.repos.knowledge.list({ keyword: q.keyword, limit });
      ok(reply, items, {
        total,
        page: 1,
        pageSize: items.length || Number(limit ?? 50),
        totalPages: 1,
      });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/knowledge-notes/:id', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const note = getServices().repos.knowledge.getById(id);
      if (!note) return handleError(reply, Object.assign(new Error(`经验笔记 '${id}' 不存在`), { code: 9004, httpStatus: 404 }));
      ok(reply, note);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/knowledge-notes', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const body = parseBody(noteCreateSchema, req.body);
      const services = getServices();
      const userId = services.authz.getCurrentUser().id;
      const note = services.repos.knowledge.create({ ...body, author: userId });
      services.repos.audit.insert({
        userId,
        action: 'knowledge.create',
        entityType: 'knowledge_note',
        entityId: note.id,
        after: { title: note.title },
      });
      reply.code(201);
      ok(reply, note);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/knowledge-notes/:id', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const body = parseBody(noteUpdateSchema, req.body);
      const { id } = req.params as { id: string };
      const before = getServices().repos.knowledge.getById(id);
      if (!before) throw Object.assign(new Error(`经验笔记 '${id}' 不存在`), { code: 9004, httpStatus: 404 });
      const note = getServices().repos.knowledge.update(id, body);
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'knowledge.update',
        entityType: 'knowledge_note',
        entityId: id,
        before: { title: before.title },
        after: { title: note?.title },
      });
      ok(reply, note);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/knowledge-notes/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const deleted = getServices().repos.knowledge.delete(id);
      if (!deleted) throw Object.assign(new Error(`经验笔记 '${id}' 不存在`), { code: 9004, httpStatus: 404 });
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  /** Compile a note into a draft Skill via the active AI provider. */
  app.post(
    '/api/knowledge-notes/:id/compile',
    { preHandler: requireRole('template_manager') },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = (req.body ?? {}) as { skillKey?: string };
        const services = getServices();
        const { skill, warnings } = await services.skills.compileFromNote(id, {
          skillKey: body.skillKey,
        });
        ok(reply, { skill, warnings });
      } catch (e) {
        handleError(reply, e);
      }
    },
  );
}
