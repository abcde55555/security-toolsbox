import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnvelope, Paging } from '@en18031/shared';
import { ZodError, type ZodType } from 'zod';
import { AppError } from '../services/errors.js';
import { getServices } from '../services/index.js';
import type { UserRole } from '@en18031/shared';

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const err = parsed.error as ZodError;
    const msg = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AppError(9003, msg || '请求参数不合法', err.issues, 400);
  }
  return parsed.data;
}

export function ok<T>(reply: FastifyReply, data: T, paging?: Paging): void {
  const body: ApiEnvelope<T> = { code: 0, message: 'ok', data };
  if (paging) body.meta = { paging };
  reply.send(body);
}

export function fail(reply: FastifyReply, code: number, message: string, httpStatus = 400, details?: unknown): void {
  reply.code(httpStatus).send({ code, message, details });
}

export function requireRole(required: UserRole | UserRole[]): (req: FastifyRequest) => Promise<void> {
  return async (req: FastifyRequest) => {
    const services = getServices();
    const user = services.authz.getCurrentUser();
    const roles = Array.isArray(required) ? required : [required];
    services.authz.assertRole(user, roles);
    (req as FastifyRequest & { user?: typeof user }).user = user;
  };
}

export function handleError(reply: FastifyReply, err: unknown): void {
  if (err instanceof AppError) {
    fail(reply, err.code, err.message, err.httpStatus, err.details);
    return;
  }
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    fail(reply, 9003, msg || '请求参数不合法', 400, err.issues);
    return;
  }
  const message = err instanceof Error ? err.message : '内部错误';
  fail(reply, 9999, message, 500);
}

export function pagingFromQuery(query: { page?: string; pageSize?: string }): { page: number; pageSize: number } {
  const parsedPage = Number(query.page ?? 1);
  const parsedSize = Number(query.pageSize ?? 20);
  return {
    page: Number.isFinite(parsedPage) ? Math.max(1, Math.floor(parsedPage)) : 1,
    pageSize: Number.isFinite(parsedSize) ? Math.min(200, Math.max(1, Math.floor(parsedSize))) : 20,
  };
}
