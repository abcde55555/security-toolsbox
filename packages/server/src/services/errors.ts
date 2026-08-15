import { ERROR_CODES } from '@en18031/shared';

export class AppError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details?: unknown,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  notFound: (entity: string, id?: string) =>
    new AppError(ERROR_CODES.NOT_FOUND, `${entity}${id ? ` '${id}'` : ''} 不存在`, undefined, 404),
  forbidden: (msg = '权限不足') => new AppError(ERROR_CODES.FORBIDDEN, msg, undefined, 403),
  unauthorized: (msg = '未授权') => new AppError(ERROR_CODES.UNAUTHORIZED, msg, undefined, 401),
  validation: (msg: string, details?: unknown) =>
    new AppError(ERROR_CODES.VALIDATION_FAILED, msg, details, 400),
  conflict: (msg: string) => new AppError(ERROR_CODES.CONFLICT, msg, undefined, 409),
  toolReferenced: (msg = '工具被模板引用，不可删除') =>
    new AppError(ERROR_CODES.TOOL_REFERENCED, msg, undefined, 409),
  templateInUse: (msg = '模板存在运行中的项目，不可删除') =>
    new AppError(ERROR_CODES.TEMPLATE_IN_USE, msg, undefined, 409),
  variablesMissing: (msg: string, details?: unknown) =>
    new AppError(ERROR_CODES.PROJECT_VARIABLES_MISSING, msg, details, 400),
  cycle: (msg = '编排步骤存在循环依赖') =>
    new AppError(ERROR_CODES.ORCHESTRATION_CYCLE, msg, undefined, 400),
  invalidStep: (msg: string) =>
    new AppError(ERROR_CODES.ORCHESTRATION_INVALID_STEP, msg, undefined, 400),
  toolUnhealthy: (msg: string) =>
    new AppError(ERROR_CODES.TOOL_UNHEALTHY, msg, undefined, 400),
  clauseInvalid: (msg: string) =>
    new AppError(ERROR_CODES.CLAUSE_INVALID, msg, undefined, 400),
  internal: (msg = '内部错误') =>
    new AppError(ERROR_CODES.INTERNAL, msg, undefined, 500),
};
