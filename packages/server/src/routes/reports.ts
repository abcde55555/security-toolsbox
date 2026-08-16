import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError } from './helpers.js';
import fs from 'node:fs';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:id/reports', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().reports.list(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/reports/latest', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().reports.latest(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects/:id/reports', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { runId?: string };
      ok(reply, getServices().reports.generateReport(id, body.runId));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/reports/:reportId', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id, reportId } = req.params as { id: string; reportId: string };
      ok(reply, getServices().reports.getReportDetail(id, reportId));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/reports/:reportId/html', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id, reportId } = req.params as { id: string; reportId: string };
      const html = getServices().reports.renderReportHtml(id, reportId);
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'")
        .header('X-Content-Type-Options', 'nosniff')
        .send(html);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/projects/:id/reports/:reportId/export', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id, reportId } = req.params as { id: string; reportId: string };
      const { filePath, fileName } = await getServices().reports.exportExcel(id, reportId);
      ok(reply, { filePath, fileName });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/projects/:id/reports/:reportId/download', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id, reportId } = req.params as { id: string; reportId: string };
      const services = getServices();
      const detail = services.reports.getReportDetail(id, reportId);
      if (!detail.report.fileRef || !fs.existsSync(detail.report.fileRef)) {
        const { filePath, fileName } = await services.reports.exportExcel(id, reportId);
        return reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(fs.createReadStream(filePath));
      }
      return reply
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(`report-${reportId}.xlsx`)}"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(fs.createReadStream(detail.report.fileRef));
    } catch (e) {
      handleError(reply, e);
    }
  });
}
