import type { FastifyInstance } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { uuid } from '@en18031/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { requireRole, handleError, fail } from './helpers.js';

const UPLOAD_DIR = path.join(config.filesDir, 'tmp');
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

function extFromName(name: string | undefined): string {
  if (!name) return '';
  const base = path.basename(name);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  const ext = base.slice(idx);
  // only allow a short, simple extension to avoid path traversal / weird names
  if (ext.length > 16 || /[^a-zA-Z0-9.]/.test(ext)) return '';
  return ext;
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/upload', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) {
        return fail(reply, 9003, '缺少上传文件字段 file', 400);
      }

      const maxBytes = config.uploadMaxBytes || DEFAULT_MAX_BYTES;
      const originalName = data.filename || 'upload.bin';
      const mimeType = data.mimetype || 'application/octet-stream';
      const ext = extFromName(originalName);
      const storedName = `${uuid()}${ext}`;

      await mkdir(UPLOAD_DIR, { recursive: true });
      const absolutePath = path.join(UPLOAD_DIR, storedName);

      let size = 0;
      const sizeLimitMsg = `文件超过大小限制 ${Math.round(maxBytes / (1024 * 1024))}MB`;
      data.file.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes && !data.file.destroyed) {
          // Stop streaming so we do not write a full oversized file to disk.
          // Destroying with an error rejects `pipeline`, triggering cleanup.
          data.file.destroy(new Error('FILE_TOO_LARGE'));
        }
      });

      try {
        await pipeline(data.file, createWriteStream(absolutePath));
      } catch (e) {
        await unlink(absolutePath).catch(() => undefined);
        const status = (e as { statusCode?: number })?.statusCode;
        if (size > maxBytes || status === 413) {
          return fail(reply, 9003, sizeLimitMsg, 413);
        }
        logger.warn({ err: e, originalName }, 'file upload stream failed');
        return fail(reply, 9003, '文件上传失败', 400);
      }

      if (size > maxBytes) {
        await unlink(absolutePath).catch(() => undefined);
        return fail(reply, 9003, sizeLimitMsg, 413);
      }

      return reply.code(201).send({
        code: 0,
        message: 'ok',
        data: { path: absolutePath, originalName, size, mimeType },
      });
    } catch (e) {
      // @fastify/multipart throws a Fastify error with statusCode 413 when limits.fileSize is exceeded
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 413) {
        return fail(reply, 9003, '文件超过大小限制', 413);
      }
      return handleError(reply, e);
    }
  });
}
