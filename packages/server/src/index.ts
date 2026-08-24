import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { Server as SocketIOServer } from 'socket.io';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { getServices, initServices } from './services/index.js';
import { runSeed } from './db/seed.js';
import { closeDb } from './db/database.js';
import { toolRoutes } from './routes/tools.js';
import { templateRoutes } from './routes/templates.js';
import { projectRoutes } from './routes/projects.js';
import { clauseRoutes } from './routes/clauses.js';
import { reportRoutes } from './routes/reports.js';
import { commandRunRoutes } from './routes/commandRuns.js';
import { uploadRoutes } from './routes/upload.js';
import { auditRoutes } from './routes/audit.js';
import { standardRoutes } from './routes/standards.js';
import { agentRoutes } from './routes/agent.js';
import { settingsRoutes } from './routes/settings.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { skillRoutes } from './routes/skills.js';
import { notificationRoutes } from './routes/notifications.js';

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception, exiting');
  process.exit(1);
});

function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  if (config.allowedHosts.some((allowed) => allowed.toLowerCase() === hostname)) {
    return true;
  }
  // When binding to all interfaces (0.0.0.0), accept loopback, LAN, and
  // private/loopback IPs so the app is reachable on the machine's real address.
  if (config.host === '0.0.0.0') {
    if (hostname === 'localhost' || hostname === '::1') return true;
    if (/^127\./.test(hostname)) return true;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) return true;
    // bare hostname (no dot) on a LAN
    if (!hostname.includes('.')) return true;
  }
  return false;
}

function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: unknown) => void): void {
  if (!origin) return cb(null, true);
  try {
    const { hostname } = new URL(origin);
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      /^127\./.test(hostname) ||
      (config.host === '0.0.0.0' &&
        (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) ||
          !hostname.includes('.')))
    ) {
      return cb(null, origin);
    }
  } catch {
    // fall through to deny
  }
  cb(null, false);
}

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cors, { origin: corsOrigin as never, credentials: true });

  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: config.uploadMaxBytes,
      files: 1,
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host;
    if (host && !isAllowedHost(host)) {
      logger.warn({ host, url: req.raw.url }, 'rejected request with unrecognized Host header');
      reply.code(403).send({ code: 9003, message: 'invalid host' });
    }
  });

  app.get('/api/health', async () => ({
    code: 0,
    message: 'ok',
    data: { status: 'ok', version: '0.1.0', time: new Date().toISOString() },
  }));

  await app.register(toolRoutes);
  await app.register(templateRoutes);
  await app.register(projectRoutes);
  await app.register(clauseRoutes);
  await app.register(reportRoutes);
  await app.register(commandRunRoutes);
  await app.register(uploadRoutes);
  await app.register(auditRoutes);
  await app.register(standardRoutes);
  await app.register(agentRoutes);
  await app.register(settingsRoutes);
  await app.register(knowledgeRoutes);
  await app.register(skillRoutes);
  await app.register(notificationRoutes);

  const services = await initServices();
  try {
    await runSeed();
    logger.info('种子数据已就绪');
  } catch (e) {
    logger.error({ err: e }, '种子数据执行失败');
    throw e;
  }

  const io = new SocketIOServer(app.server, {
    cors: { origin: corsOrigin as never, credentials: true },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    const queryRunId = (socket.handshake.query as { runId?: string }).runId;
    if (queryRunId) socket.join(`run:${queryRunId}`);
    const querySessionId = (socket.handshake.query as { sessionId?: string }).sessionId;
    if (querySessionId) socket.join(`agent:${querySessionId}`);
    socket.on('subscribe', (payload: { runId?: string; sessionId?: string } | undefined) => {
      if (payload?.runId) socket.join(`run:${payload.runId}`);
      if (payload?.sessionId) socket.join(`agent:${payload.sessionId}`);
    });
    socket.on('unsubscribe', (payload: { runId?: string; sessionId?: string } | undefined) => {
      if (payload?.runId) socket.leave(`run:${payload.runId}`);
      if (payload?.sessionId) socket.leave(`agent:${payload.sessionId}`);
    });
  });

  const forward = (event: string) => (payload: { runId?: string } & Record<string, unknown>): void => {
    if (payload?.runId) io.to(`run:${payload.runId}`).emit(event, payload);
  };
  services.bus.on('run:logLine', forward('run:logLine'));
  services.bus.on('run:progress', forward('run:progress'));
  services.bus.on('run:status', forward('run:status'));
  services.bus.on('run:batchProgress', forward('run:batchProgress'));
  services.bus.on('tool:health', (payload: Record<string, unknown>) => {
    io.emit('tool:health', payload);
  });
  // Notifications are platform-wide (single tenant): broadcast to all clients.
  services.bus.on('notification:new', (payload: Record<string, unknown>) => {
    io.emit('notification:new', payload);
  });
  // AI narrative lands after the report response: route by run room when the
  // report is bound to a run, otherwise broadcast.
  services.bus.on('report:narrative', (payload: { runId?: string } & Record<string, unknown>) => {
    if (payload?.runId) io.to(`run:${payload.runId}`).emit('report:narrative', payload);
    else io.emit('report:narrative', payload);
  });

  // Forward all agent:* bus events to the agent:${sessionId} room. Each payload
  // carries sessionId. Clients join via ?sessionId= or the subscribe socket event.
  const AGENT_EVENTS = [
    'agent:session', 'agent:phase', 'agent:step_started', 'agent:tool_call',
    'agent:tool_output', 'agent:tool_result', 'agent:human_step_requested',
    'agent:human_step_completed', 'agent:evidence_attached', 'agent:artifact_written',
    'agent:verdict_drafted', 'agent:verdict_updated', 'agent:message',
    'agent:waiting_confirm', 'agent:progress', 'agent:error', 'agent:done',
  ] as const;
  for (const event of AGENT_EVENTS) {
    services.bus.on(event, (payload: { sessionId?: string }) => {
      if (payload?.sessionId) io.to(`agent:${payload.sessionId}`).emit(event, payload);
      else io.emit(event, payload);
    });
  }

  if (fs.existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: '/',
      index: ['index.html'],
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/') || req.raw.url?.startsWith('/socket.io/')) {
        reply.code(404).send({ code: 9004, message: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
    logger.info({ webDistDir: config.webDistDir }, '已挂载前端静态资源');
  } else {
    logger.warn({ webDistDir: config.webDistDir }, '前端 dist 目录不存在，仅提供 API 服务');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '正在关闭服务...');
    io.close();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(`EN18031 server listening on http://${config.host}:${config.port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  logger.error(err);
  process.exit(1);
});
