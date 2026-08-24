import { config } from '../../config.js';
import { logger } from '../../logger.js';
import {
  AiError,
  type AiProvider,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type StreamChunk,
  type ToolCall,
} from './types.js';
import type { SettingRepository } from '../../repositories/settingRepository.js';

// Lazily resolve the settings repo to avoid a circular import
// (repositories -> agentService -> deepseekProvider -> repositories).
let settingsRepo: SettingRepository | null = null;
async function getSettings(): Promise<SettingRepository | null> {
  if (settingsRepo) return settingsRepo;
  try {
    const mod = await import('../../repositories/index.js');
    settingsRepo = mod.getRepositories().settings;
    return settingsRepo;
  } catch (err) {
    logger.warn({ err }, 'settings repository unavailable');
    return null;
  }
}

interface UpstreamMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

function toUpstream(messages: ChatMessage[]): UpstreamMessage[] {
  return messages.map((m) => {
    const u: UpstreamMessage = { role: m.role };
    if (m.content !== undefined) u.content = m.content;
    if (m.toolCalls?.length) {
      u.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    if (m.toolCallId) u.tool_call_id = m.toolCallId;
    if (m.name) u.name = m.name;
    return u;
  });
}

function mapToolCalls(toolCalls: UpstreamMessage['tool_calls']): ToolCall[] | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));
}

function classifyError(status: number | undefined, body: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth', `AI 鉴权失败 (${status})`, status);
  if (status === 429) return new AiError('rate_limit', 'AI 请求过于频繁 (429)', status);
  if (status === 400) return new AiError('invalid_request', `AI 请求参数错误: ${body.slice(0, 200)}`, status);
  if (status !== undefined && status >= 500)
    return new AiError('upstream', `AI 上游错误 (${status})`, status);
  return new AiError('upstream', `AI 调用失败: ${body.slice(0, 200)}`, status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SignalHandle {
  signal: AbortSignal;
  timedOut: () => boolean;
  cancel: () => void;
}

export class DeepSeekProvider implements AiProvider {
  readonly name = 'deepseek';

  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
      maxRetries: number;
      defaultModel: string;
    },
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const model = options.model ?? this.opts.defaultModel;
    const payload: Record<string, unknown> = {
      model,
      messages: toUpstream(messages),
      stream: false,
    };
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.tools?.length) {
      payload.tools = options.tools;
      payload.tool_choice = options.toolChoice ?? 'auto';
    }
    return this.requestJson(payload, options, model);
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const model = options.model ?? this.opts.defaultModel;
    const payload: Record<string, unknown> = {
      model,
      messages: toUpstream(messages),
      stream: true,
    };
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.tools?.length) {
      payload.tools = options.tools;
      payload.tool_choice = options.toolChoice ?? 'auto';
    }

    const start = Date.now();
    const handle = this.buildSignal(options);
    let response: Response;
    try {
      response = await this.fetchWithRetry(`${this.opts.baseUrl}/chat/completions`, payload, handle);
    } catch (err) {
      handle.cancel();
      throw this.mapFetchError(err, handle);
    }

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      handle.cancel();
      throw classifyError(response.status, body);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let contentBuffer = '';
    const toolCallAcc = new Map<number, { id?: string; name?: string; args: string }>();
    let usage: ChatResult['usage'];
    let finishReason: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }
          const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
          if (choice) {
            const delta = choice.delta as Record<string, unknown> | undefined;
            if (delta) {
              if (typeof delta.content === 'string' && delta.content) {
                contentBuffer += delta.content;
                onChunk({ delta: delta.content });
              }
              const dtc = delta.tool_calls as Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
              if (dtc) {
                for (const part of dtc) {
                  const acc = toolCallAcc.get(part.index) ?? { args: '' };
                  if (part.id) acc.id = part.id;
                  if (part.function?.name) acc.name = part.function.name;
                  if (part.function?.arguments) acc.args += part.function.arguments;
                  toolCallAcc.set(part.index, acc);
                }
              }
            }
            if (choice.finish_reason) finishReason = String(choice.finish_reason);
          }
          if (parsed.usage) usage = parsed.usage as ChatResult['usage'];
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw this.abortError(handle, options.signal);
      }
      throw new AiError('network', `AI 流读取失败: ${(err as Error).message}`, undefined, err);
    } finally {
      handle.cancel();
      reader.releaseLock();
    }

    const toolCalls: ToolCall[] = [...toolCallAcc.values()]
      .filter((v): v is { id: string; name: string; args: string } => !!v.id && !!v.name)
      .map((v) => ({
        id: v.id,
        type: 'function',
        function: { name: v.name, arguments: v.args },
      }));
    for (const tc of toolCalls) onChunk({ toolCall: tc });

    const message: ChatMessage = {
      role: 'assistant',
      content: contentBuffer || null,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
    return { message, usage, model, finishReason, latencyMs: Date.now() - start };
  }

  private async requestJson(
    payload: Record<string, unknown>,
    options: ChatOptions,
    model: string,
  ): Promise<ChatResult> {
    const start = Date.now();
    const handle = this.buildSignal(options);
    let response: Response;
    try {
      response = await this.fetchWithRetry(`${this.opts.baseUrl}/chat/completions`, payload, handle);
    } catch (err) {
      handle.cancel();
      throw this.mapFetchError(err, handle);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      handle.cancel();
      throw classifyError(response.status, body);
    }
    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch (err) {
      handle.cancel();
      throw new AiError('parse', `AI 响应解析失败: ${(err as Error).message}`, undefined, err);
    }
    handle.cancel();
    const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;
    if (!msg) throw new AiError('parse', 'AI 响应缺少 choices[0].message');
    const message: ChatMessage = {
      role: 'assistant',
      content: (msg.content as string | null) ?? null,
      toolCalls: mapToolCalls(msg.tool_calls as UpstreamMessage['tool_calls']),
    };
    return {
      message,
      usage: data.usage as ChatResult['usage'],
      model: (data.model as string) ?? model,
      finishReason: choice?.finish_reason as string | undefined,
      latencyMs: Date.now() - start,
    };
  }

  private buildSignal(options: ChatOptions): SignalHandle {
    const controller = new AbortController();
    let didTimeout = false;
    const timeoutMs = options.timeoutMs ?? this.opts.timeoutMs;
    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error('timeout'));
    }, timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return {
      signal: controller.signal,
      timedOut: () => didTimeout,
      cancel: () => clearTimeout(timer),
    };
  }

  private abortError(handle: SignalHandle, externalSignal?: AbortSignal): AiError {
    if (handle.timedOut()) return new AiError('timeout', 'AI 请求超时');
    if (externalSignal?.aborted) return new AiError('aborted', 'AI 请求已取消');
    return new AiError('aborted', 'AI 请求已取消');
  }

  private mapFetchError(err: unknown, handle: SignalHandle): AiError {
    if ((err as Error).name === 'AbortError') {
      return this.abortError(handle);
    }
    return new AiError('network', `AI 网络错误: ${(err as Error).message}`, undefined, err);
  }


  private async fetchWithRetry(
    url: string,
    payload: Record<string, unknown>,
    handle: SignalHandle,
  ): Promise<Response> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.opts.maxRetries) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: handle.signal,
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.opts.maxRetries) {
            const backoff = 500 * 2 ** attempt;
            logger.warn({ status: response.status, attempt }, 'AI upstream retryable, backing off');
            await response.text().catch(() => {});
            await sleep(backoff);
            attempt++;
            continue;
          }
        }
        return response;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        lastErr = err;
        if (attempt < this.opts.maxRetries) {
          attempt++;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new AiError('network', `AI 网络错误: ${(err as Error).message}`, undefined, err);
      }
    }
    throw new AiError('upstream', 'AI 调用失败，已达最大重试次数', undefined, lastErr);
  }
}

/** Resolve runtime config: DB active provider overrides env. Synchronous-ish via lazy cache. */
async function resolveConfig() {
  let { baseUrl, apiKey, timeoutMs, maxRetries, planningModel } = config.ai;
  const settings = await getSettings();
  const active = settings?.getActiveProvider();
  if (active) {
    baseUrl = active.baseUrl || baseUrl;
    apiKey = active.apiKey || apiKey;
    timeoutMs = active.timeoutMs || timeoutMs;
    maxRetries = active.maxRetries ?? maxRetries;
    planningModel = active.planningModel || planningModel;
  }
  return { baseUrl, apiKey, timeoutMs, maxRetries, planningModel };
}

/**
 * Build the configured provider, or null when AI is disabled / no key.
 * Returns a Promise now because DB settings are read asynchronously; callers
 * in the agent loop already await provider construction.
 */
export async function createDeepSeekProvider(): Promise<DeepSeekProvider | null> {
  if (!config.ai.enabled) return null;
  const { baseUrl, apiKey, timeoutMs, maxRetries, planningModel } = await resolveConfig();
  if (!apiKey) {
    logger.warn('AI_ENABLED=true but no API key configured; AI provider unavailable');
    return null;
  }
  return new DeepSeekProvider({
    baseUrl,
    apiKey,
    timeoutMs,
    maxRetries,
    defaultModel: planningModel,
  });
}
