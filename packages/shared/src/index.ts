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
