import type { AuthUser, UserRole } from '@en18031/shared';
import { config } from '../config.js';

const ROLE_RANK: Record<UserRole, number> = {
  anonymous: 0,
  auditor: 1,
  template_manager: 2,
  admin: 3,
};

export class AuthzService {
  private currentUser: AuthUser = {
    id: 'local-admin',
    username: 'Admin',
    role: 'admin',
    workspaceId: config.workspaceDefault,
  };

  getCurrentUser(): AuthUser {
    return this.currentUser;
  }

  hasRole(user: AuthUser, role: UserRole): boolean {
    return ROLE_RANK[user.role] >= ROLE_RANK[role];
  }

  assertRole(user: AuthUser, required: UserRole[]): void {
    if (required.length === 0) return;
    const ok = required.some((r) => this.hasRole(user, r));
    if (!ok) {
      // 首期 authEnabled=false 时默认 admin 已放行；真实鉴权在 M4 打开
      if (config.authEnabled) {
        throw Object.assign(new Error('权限不足'), { statusCode: 403, code: 9002 });
      }
    }
  }
}
