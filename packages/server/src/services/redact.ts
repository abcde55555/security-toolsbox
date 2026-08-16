const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|credential|private[_-]?key)/i;

export function redactEnvVars(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return env;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = SECRET_KEY.test(k) && v ? '***' : v;
  }
  return out;
}
