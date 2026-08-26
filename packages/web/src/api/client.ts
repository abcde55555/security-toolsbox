import { message } from 'antd';

export interface Paging {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  meta?: { paging: Paging };
  details?: unknown;
}

const BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: ApiEnvelope<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`服务器返回非 JSON 响应 (${res.status})`);
  }
  if (!res.ok || (json.code !== 0 && json.code !== undefined)) {
    const msg = json.message || `请求失败 (${res.status})`;
    const err = new Error(msg) as Error & { status?: number; code?: number };
    err.status = res.status;
    err.code = json.code;
    throw err;
  }
  return json.data;
}

export async function requestPaged<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ items: T[]; total: number }> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: ApiEnvelope<T[]>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`服务器返回非 JSON 响应 (${res.status})`);
  }
  if (!res.ok || (json.code !== 0 && json.code !== undefined)) {
    throw new Error(json.message || `请求失败 (${res.status})`);
  }
  return { items: json.data ?? [], total: json.meta?.paging?.total ?? (json.data ?? []).length };
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function downloadUrl(path: string): string {
  return BASE + path;
}

export function reportError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  message.error(msg);
}
