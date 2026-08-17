import { describe, it, expect, beforeAll } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { standardRoutes } from '../routes/standards.js';
import { clauseRoutes } from '../routes/clauses.js';
import { uploadRoutes } from '../routes/upload.js';
import { getServices } from '../services/index.js';
import { config } from '../config.js';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import './helpers.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: { fileSize: 1024, files: 1 },
  });
  await app.register(standardRoutes);
  await app.register(clauseRoutes);
  await app.register(uploadRoutes);
  return app;
}

describe('standards route error handling', () => {
  it('returns 400 (not 500) for missing required fields', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/standards',
      payload: { code: 'X1' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe(9003);
  });

  it('returns 409 for a duplicate standard', async () => {
    const app = await buildApp();
    const code = `DUP${Date.now()}`;
    const payload = { code, name: 'Dup', version: '1.0' };
    const first = await app.inject({ method: 'POST', url: '/api/standards', payload });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/standards', payload });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).code).toBe(9005);
  });

  it('returns 404 when updating a missing standard', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/standards/NOPE:9.9',
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe(9004);
  });
});

describe('clauses route parent validation', () => {
  const std = 'EN18031:2019';

  beforeAll(() => {
    // ensure a clean set of test clauses exists
    const repos = getServices().repos;
    for (const id of ['CYC-A', 'CYC-B', 'CYC-C']) {
      if (!repos.clauses.get(std, id)) {
        repos.clauses.upsert({
          clauseId: id,
          standardVersion: std,
          chapter: 'X',
          title: id,
          description: '',
          level: 'L1',
          defaultSeverity: 'middle',
          tags: [],
        });
      }
    }
  });

  it('rejects a self-referencing parentId', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/clauses?standardVersion=${encodeURIComponent(std)}`,
      payload: {
        clauseId: 'SELF-1',
        chapter: 'X',
        title: 'self',
        level: 'L1',
        parentId: 'SELF-1',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('自身');
  });

  it('rejects a non-existent parentId', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/clauses?standardVersion=${encodeURIComponent(std)}`,
      payload: {
        clauseId: 'MISSING-PARENT-1',
        chapter: 'X',
        title: 'x',
        level: 'L1',
        parentId: 'DOES-NOT-EXIST',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('不存在');
  });

  it('rejects setting a descendant as parent (cycle)', async () => {
    const app = await buildApp();
    const repos = getServices().repos;
    // CYC-B is a child of CYC-A.
    repos.clauses.update(std, 'CYC-B', { parentId: 'CYC-A' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/clauses/CYC-A?standardVersion=${encodeURIComponent(std)}`,
      payload: { parentId: 'CYC-B' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('循环');
  });

  it('rejects deleting a clause that still has children', async () => {
    const app = await buildApp();
    // CYC-A is parent of CYC-B from the previous test
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/clauses/CYC-A?standardVersion=${encodeURIComponent(std)}`,
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('upload route cleanup', () => {
  it('does not persist an oversized file and returns 413', async () => {
    const app = await buildApp();
    const tmpDir = path.join(config.filesDir, 'tmp');
    const before = existsSync(tmpDir) ? new Set(readdirSync(tmpDir)) : new Set<string>();

    const originalLimit = config.uploadMaxBytes;
    config.uploadMaxBytes = 64;

    const big = Buffer.alloc(2048, 'a');
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': 'multipart/form-data; boundary=----testboundary' },
      payload: [
        '------testboundary',
        'Content-Disposition: form-data; name="file"; filename="big.bin"',
        'Content-Type: application/octet-stream',
        '',
        big.toString('utf8'),
        '------testboundary--',
        '',
      ].join('\r\n'),
    });
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body).code).toBe(9003);

    config.uploadMaxBytes = originalLimit;

    const after = existsSync(tmpDir) ? readdirSync(tmpDir) : [];
    const leftover = after.filter((f) => !before.has(f));
    expect(leftover).toEqual([]);
  });

  it('accepts a file within the size limit', async () => {
    const app = await buildApp();
    const originalLimit = config.uploadMaxBytes;
    config.uploadMaxBytes = 64 * 1024;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': 'multipart/form-data; boundary=----testboundary' },
        payload: [
          '------testboundary',
          'Content-Disposition: form-data; name="file"; filename="small.txt"',
          'Content-Type: text/plain',
          '',
          'hello world',
          '------testboundary--',
          '',
        ].join('\r\n'),
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data.size).toBe(11);
      expect(body.data.originalName).toBe('small.txt');
    } finally {
      config.uploadMaxBytes = originalLimit;
    }
  });
});
