import type { HealthStatus, FormField, ToolCommand } from '@en18031/shared';

export const healthColor: Record<HealthStatus, string> = {
  green: '#16a34a',
  yellow: '#d97706',
  red: '#dc2626',
  unknown: '#6b7280',
};

export const healthText: Record<HealthStatus, string> = {
  green: '健康',
  yellow: '版本不匹配',
  red: '不可用',
  unknown: '未知',
};

export const stepStatusColor: Record<string, string> = {
  pending: 'default',
  scheduled: 'default',
  running: 'processing',
  success: 'success',
  fail: 'error',
  fail_abort_triggered: 'error',
  timeout: 'warning',
  cancelled: 'default',
  skipped: 'default',
  partial: 'warning',
};

export const stepStatusText: Record<string, string> = {
  pending: '等待中',
  scheduled: '已调度',
  running: '执行中',
  success: '成功',
  fail: '失败',
  fail_abort_triggered: '失败(中止)',
  timeout: '超时',
  cancelled: '已取消',
  skipped: '已跳过',
  partial: '部分完成',
};

export const runStatusColor: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  fail: 'error',
  partial: 'warning',
  cancelled: 'default',
  timeout: 'warning',
};

export const runStatusText: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  fail: '失败',
  partial: '部分完成',
  cancelled: '已取消',
  timeout: '超时',
};

export const projectStatusColor: Record<string, string> = {
  draft: 'default',
  running: 'processing',
  success: 'success',
  fail: 'error',
  partial: 'warning',
  cancelled: 'default',
};

export const projectStatusText: Record<string, string> = {
  draft: '草稿',
  running: '运行中',
  success: '已完成',
  fail: '失败',
  partial: '部分完成',
  cancelled: '已取消',
};

export const gradeColor: Record<string, string> = {
  PASS: '#16a34a',
  CONDITIONAL_PASS: '#ea580c',
  FAIL: '#dc2626',
  INCOMPLETE: '#6b7280',
};

export const gradeText: Record<string, string> = {
  PASS: '通过',
  CONDITIONAL_PASS: '有条件通过',
  FAIL: '不通过',
  INCOMPLETE: '不完整',
};

export const commandRunStatusColor: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  fail: 'error',
  timeout: 'warning',
  crash: 'error',
  cancelled: 'default',
};

export const commandRunStatusText: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  success: '成功',
  fail: '失败',
  timeout: '超时',
  crash: '崩溃',
  cancelled: '已取消',
};

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m}m${rest}s`;
}

export function severityColor(s: string): string {
  if (s === 'high') return 'red';
  if (s === 'middle') return 'orange';
  if (s === 'low') return 'blue';
  return 'default';
}

export const severityText: Record<string, string> = {
  high: '高',
  middle: '中',
  low: '低',
};

export const failureStrategyText: Record<string, string> = {
  abort: '失败中止',
  continue: '失败继续',
  retry: '失败重试',
};

export const versionLockText: Record<string, string> = {
  locked: '锁定版本',
  follow: '跟随最新',
};

export const evidenceTypeText: Record<string, string> = {
  stdout_line: '输出行',
  assertion: '判定断言',
  validation_error: '校验错误',
  file_pointer: '文件引用',
  screenshot: '截图',
};

export const auditActionText: Record<string, string> = {
  'project.create': '创建项目',
  'project.update': '更新项目',
  'project.delete': '删除项目',
  'template.create': '创建模板',
  'template.update': '更新模板',
  'template.clone': '克隆模板',
  'template.delete': '删除模板',
  'template.confirm_upgrade': '确认模板升级',
  'run.start': '启动运行',
  'run.finish': '运行结束',
  'run.cancel': '取消运行',
  'run.manual_tool': '手动执行工具',
  'report.generate': '生成报告',
  'clause.verdict.override': '人工覆盖判定',
  'clause.verdict.invalid': '判定校验失败',
  'tool.create': '注册工具',
  'tool.update': '更新工具',
  'tool.delete': '删除工具',
  'command_run.start': '启动命令',
  'command_run.finish': '命令结束',
  'command_run.cancel': '取消命令',
  'command_run.attach': '挂载到项目',
};

export const healthLegend = [
  { status: 'green' as HealthStatus, text: healthText.green, color: healthColor.green },
  { status: 'yellow' as HealthStatus, text: healthText.yellow, color: healthColor.yellow },
  { status: 'red' as HealthStatus, text: healthText.red, color: healthColor.red },
  { status: 'unknown' as HealthStatus, text: healthText.unknown, color: healthColor.unknown },
];

// 统一的终态状态集合
const TERMINAL_STATUSES = new Set([
  'success', 'fail', 'partial', 'cancelled', 'timeout', 'crash',
]);

export function isTerminalStatus(s?: string | null): boolean {
  return !!s && TERMINAL_STATUSES.has(s);
}

// 将 stdout/stderr 文本拆分为行
export function toLines(text: string, stream: 'stdout' | 'stderr') {
  return text.split(/\r?\n/).filter((l) => l.length > 0).map((text) => ({ text, stream }));
}

// 从命令定义生成默认参数值
export function defaultsFromCommand(cmd: ToolCommand): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of cmd.params) {
    if (f.value !== undefined) out[f.id] = f.value;
    else if (f.type === 'checkbox') out[f.id] = false;
    else if (f.type === 'multiselect') out[f.id] = [];
    else out[f.id] = '';
  }
  return out;
}

// 从表单字段定义生成默认值
export function fieldDefaults(fields: FormField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.value !== undefined) out[f.id] = f.value;
    else if (f.type === 'checkbox') out[f.id] = false;
    else if (f.type === 'multiselect') out[f.id] = [];
    else out[f.id] = '';
  }
  return out;
}

// 单个字段的默认值
export function paramDefaultValue(f: FormField): unknown {
  if (f.value !== undefined) return f.value;
  if (f.type === 'checkbox') return false;
  if (f.type === 'multiselect') return [];
  return '';
}

// 格式化 ETA 为人类可读
export function formatEta(eta?: string | number | null): string {
  if (eta === undefined || eta === null || eta === '') return '';
  if (typeof eta === 'number') {
    if (eta < 60) return `预计还需 ${Math.round(eta)} 秒`;
    if (eta < 3600) return `预计还需 ${Math.round(eta / 60)} 分钟`;
    const h = Math.floor(eta / 3600);
    const m = Math.round((eta % 3600) / 60);
    return `预计还需 ${h} 小时 ${m} 分钟`;
  }
  // ISO date string
  const ms = new Date(eta).getTime() - Date.now();
  if (ms <= 0) return '即将完成';
  return formatEta(Math.round(ms / 1000));
}
