import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnvelope, Paging } from '@en18031/shared';
import { AppError } from '../services/errors.js';
import { getServices } from '../services/index.js';
import type { UserRole } from '@en18031/shared';

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
  const message = err instanceof Error ? err.message : '内部错误';
  fail(reply, 9999, message, 500);
}

export function pagingFromQuery(query: { page?: string; pageSize?: string }): { page: number; pageSize: number } {
  return {
    page: Math.max(1, Number(query.page ?? 1)),
    pageSize: Math.min(200, Math.max(1, Number(query.pageSize ?? 20))),
  };
}
