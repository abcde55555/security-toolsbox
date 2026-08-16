import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
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

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception, exiting');
  process.exit(1);
});

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: unknown) => void): void {
  if (!origin) return cb(null, true);
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
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

  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host;
    if (host && !isLoopbackHost(host) && config.host !== '0.0.0.0') {
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

  const services = await initServices();
  try {
    runSeed();
    logger.info('种子数据已就绪');
  } catch (e) {
    logger.warn({ err: e }, '种子数据执行失败（可忽略，若已存在）');
  }

  const io = new SocketIOServer(app.server, {
    cors: { origin: corsOrigin as never, credentials: true },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    const queryRunId = (socket.handshake.query as { runId?: string }).runId;
    if (queryRunId) socket.join(`run:${queryRunId}`);
    socket.on('subscribe', (payload: { runId?: string } | undefined) => {
      const runId = payload?.runId;
      if (runId) socket.join(`run:${runId}`);
    });
    socket.on('unsubscribe', (payload: { runId?: string } | undefined) => {
      const runId = payload?.runId;
      if (runId) socket.leave(`run:${runId}`);
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
