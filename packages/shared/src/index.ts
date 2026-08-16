export * from './enums.js';
export * from './types.js';
export * from './schemas.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const MUSTACHE = /\{\{\s*([^}]+?)\s*\}\}/g;

const PLAIN_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;
const SAFE_SHELL_CHARS = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function extractPlaceholders(tpl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of tpl.matchAll(PLAIN_PLACEHOLDER)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

function shellQuote(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => shellQuote(v)).filter((s) => s.length > 0).join(' ');
  }
  const str = String(value);
  if (str === '') return "''";
  if (SAFE_SHELL_CHARS.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

export interface RenderCommandOptions {
  quote?: boolean;
  rawKeys?: string[];
}

export function renderCommandTemplate(
  template: string,
  params: Record<string, unknown>,
  opts: RenderCommandOptions = {},
): { command: string; missing: string[]; unused: string[] } {
  const quote = opts.quote !== false;
  const rawKeys = new Set(opts.rawKeys ?? []);
  const used = new Set<string>();
  const missing: string[] = [];
  const command = template.replace(PLAIN_PLACEHOLDER, (_full, key: string) => {
    used.add(key);
    const v = params[key];
    if (v === undefined || v === null || v === '') {
      missing.push(key);
      return '';
    }
    if (rawKeys.has(key)) return String(v);
    return quote ? shellQuote(v) : String(v);
  });
  const unused = Object.keys(params).filter((k) => !used.has(k));
  return { command, missing, unused };
}

export type VariableScope = Record<string, unknown>;

export function renderTemplateString(
  str: string,
  project: VariableScope,
  templateVars: VariableScope = {},
  stepOutputs: Record<string, VariableScope> = {},
): { value: string; missing: string[] } {
  const missing: string[] = [];
  const value = str.replace(MUSTACHE, (_full, expr: string) => {
    const parts = expr.split('.');
    const scope = parts[0];
    const name = parts[1];
    const rest = parts.slice(2);
    let bucket: unknown;
    if (scope === 'project') bucket = project[name];
    else if (scope === 'template') bucket = templateVars[name] ?? project[name];
    else if (scope === 'step') {
      const stepId = parts[1];
      const field = parts[2];
      bucket = stepOutputs[stepId]?.[field];
      rest.splice(0, 2);
    } else {
      missing.push(expr);
      return '';
    }
    for (const key of rest) {
      if (bucket && typeof bucket === 'object' && key in (bucket as Record<string, unknown>)) {
        bucket = (bucket as Record<string, unknown>)[key];
      } else {
        bucket = undefined;
        break;
      }
    }
    if (bucket === undefined || bucket === null) {
      missing.push(expr);
      return '';
    }
    return String(bucket);
  });
  return { value, missing };
}

export function substituteObject<T>(
  obj: T,
  project: VariableScope,
  templateVars: VariableScope = {},
  stepOutputs: Record<string, VariableScope> = {},
): { value: T; missing: string[] } {
  const missing: string[] = [];
  if (obj === null || obj === undefined) return { value: obj, missing };
  if (typeof obj === 'string') {
    const r = renderTemplateString(obj, project, templateVars, stepOutputs);
    missing.push(...r.missing);
    return { value: r.value as unknown as T, missing };
  }
  if (Array.isArray(obj)) {
    const arr = obj.map((item) => {
      const r = substituteObject(item, project, templateVars, stepOutputs);
      missing.push(...r.missing);
      return r.value;
    });
    return { value: arr as unknown as T, missing };
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const r = substituteObject(v, project, templateVars, stepOutputs);
      missing.push(...r.missing);
      out[k] = r.value;
    }
    return { value: out as T, missing };
  }
  return { value: obj, missing };
}
