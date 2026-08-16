import type { HealthStatus } from '@en18031/shared';

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

export const categoryLabels: Array<{ key: string; label: string }> = [
  { key: 'network-compliance', label: '网络合规' },
  { key: 'crypto-compliance', label: '密码合规' },
  { key: 'credential-compliance', label: '凭证合规' },
  { key: 'firmware-analysis', label: '固件分析' },
  { key: 'authentication', label: '认证安全' },
  { key: 'reconnaissance', label: '侦察探测' },
  { key: 'other', label: '其他' },
];

export const categoryOptions = categoryLabels.map((c) => ({ value: c.key, label: c.label }));

export function categoryLabel(key?: string): string {
  return categoryLabels.find((c) => c.key === key)?.label ?? key ?? '其他';
}

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
