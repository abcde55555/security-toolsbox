import type { Repositories } from '../repositories/index.js';
import { logger } from '../logger.js';
import type { AuditRepository } from '../repositories/auditRepository.js';

/**
 * Notification helper: persist + broadcast on the process bus.
 * index.ts forwards `notification:new` to every connected Socket.IO client,
 * which powers the header bell without per-user rooms (single-tenant today).
 */
export function notify(
  repos: Repositories,
  bus: NodeJS.EventEmitter,
  input: Parameters<Repositories['notifications']['create']>[0],
): ReturnType<Repositories['notifications']['create']> {
  const notification = repos.notifications.create(input);
  try {
    bus.emit('notification:new', { notification });
  } catch (e) {
    logger.warn({ err: e }, 'failed to broadcast notification');
  }
  return notification;
}

/** Fire-and-forget audit writer (never lets auditing break the main flow). */
export function safeAudit(
  audit: AuditRepository | undefined,
  entry: Parameters<AuditRepository['insert']>[0],
): void {
  if (!audit) return;
  try {
    audit.insert(entry);
  } catch (e) {
    logger.warn({ err: e }, 'audit write failed');
  }
}
