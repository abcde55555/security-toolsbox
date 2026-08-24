import type { AgentPhase, AgentSessionStatus } from '@en18031/shared';

export const AGENT_PHASES: Array<{ key: AgentPhase; label: string; letter: string; color: string }> = [
  { key: 'onboarding', label: 'A · 接入建档', letter: 'A', color: '#2563eb' },
  { key: 'collection', label: 'B · 证据采集', letter: 'B', color: '#0891b2' },
  { key: 'adjudication', label: 'C · 判定评估', letter: 'C', color: '#7c3aed' },
  { key: 'review', label: 'D · 复核报告', letter: 'D', color: '#059669' },
];

export const PHASE_INDEX: Record<AgentPhase, number> = {
  onboarding: 0,
  collection: 1,
  adjudication: 2,
  review: 3,
};

export const SESSION_STATUS_META: Record<AgentSessionStatus, { label: string; color: string }> = {
  planning: { label: '规划中', color: 'default' },
  running: { label: '运行中', color: 'processing' },
  waiting_human: { label: '等待人工', color: 'warning' },
  waiting_confirm: { label: '待确认', color: 'warning' },
  review: { label: '待审核', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  aborted: { label: '已中止', color: 'default' },
  error: { label: '错误', color: 'error' },
};

export function phaseMeta(phase: AgentPhase) {
  return AGENT_PHASES[PHASE_INDEX[phase]];
}

/** Split accumulated tool output into Terminal lines. */
export function outputToLines(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
  return output
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((text) => ({ text, stream }));
}

export function isImageRef(ref?: string): boolean {
  if (!ref) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(ref);
}

/** Resolve a stored fileRef into a browsable URL under /api/upload. */
export function fileRefUrl(ref?: string): string | undefined {
  if (!ref) return undefined;
  if (/^https?:\/\//i.test(ref)) return ref;
  return `/api/upload/${encodeURIComponent(ref.replace(/^\/?(uploads\/)?/, ''))}`;
}

export function fileNameOf(ref: string): string {
  return ref.split(/[\\/]/).pop() ?? ref;
}
