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
// (repositories -> agentService -> provider -> repositories).
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

// ---- OpenAI / DeepSeek / vLLM / Ollama / Moonshot shapes ----

interface OpenAiMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenAiTool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

function toOpenAi(messages: ChatMessage[]): OpenAiMessage[] {
  return messages.map((m) => {
    const u: OpenAiMessage = { role: m.role };
    if (m.content !== undefined) u.content = m.content;
    if (m.toolCalls?.length) {
      u.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    if (m.toolCallId) u.tool_call_id = m.toolCallId;
    if (m.name) u.name = m.name;
    return u;
  });
}

function fromOpenAiToolCalls(tcs: OpenAiMessage['tool_calls']): ToolCall[] | undefined {
  if (!tcs?.length) return undefined;
  return tcs.map((tc) => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));
}

// ---- Anthropic shapes ----

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/** Convert our generic messages to Anthropic's format. System prompt is extracted. */
function toAnthropic(messages: ChatMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = system ? `${system}\n${m.content ?? ''}` : (m.content ?? '');
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content ?? '',
            is_error: false,
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || '{}');
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : (m.content ?? '') });
      continue;
    }
    // plain user
    out.push({ role: 'user', content: m.content ?? '' });
  }
  return { system, messages: out };
}

function fromAnthropicBlock(
  blocks: AnthropicContentBlock[] | string | undefined,
): { content: string | null; toolCalls: ToolCall[] } {
  if (!blocks) return { content: null, toolCalls: [] };
  if (typeof blocks === 'string') return { content: blocks, toolCalls: [] };
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text) text += b.text;
    if (b.type === 'tool_use' && b.id && b.name) {
      toolCalls.push({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      });
    }
  }
  return { content: text || null, toolCalls };
}

// ---- error classification ----

function classifyError(status: number | undefined, body: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth', `AI 鉴权失败 (${status})`, status);
  if (status === 429) return new AiError('rate_limit', 'AI 请求过于频繁 (429)', status);
  if (status === 400) return new AiError('invalid_request', `AI 请求参数错误: ${body.slice(0, 300)}`, status);
  if (status !== undefined && status >= 500)
    return new AiError('upstream', `AI 上游错误 (${status})`, status);
  return new AiError('upstream', `AI 调用失败: ${body.slice(0, 300)}`, status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SignalHandle {
  signal: AbortSignal;
  timedOut: () => boolean;
  cancel: () => void;
}

function buildSignal(options: ChatOptions, timeoutMs: number): SignalHandle {
  const controller = new AbortController();
  let didTimeout = false;
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

/**
 * HTTP-based AI provider supporting both OpenAI-compatible and Anthropic protocols.
 * Named "DeepSeekProvider" for backwards compatibility but is protocol-agnostic.
 */
export class DeepSeekProvider implements AiProvider {
  readonly name = 'http';

  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
      maxRetries: number;
      defaultModel: string;
      protocol?: 'openai' | 'anthropic';
    },
  ) {}

  private get protocol(): 'openai' | 'anthropic' {
    return this.opts.protocol ?? 'openai';
  }

  private get endpoint(): string {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    return this.protocol === 'anthropic' ? `${base}/v1/messages` : `${base}/chat/completions`;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const model = options.model ?? this.opts.defaultModel;
    const handle = buildSignal(options, this.opts.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchWithRetry(
        this.endpoint,
        this.buildBody(model, messages, options, false),
        handle,
      );
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
    return this.parseResponse(data, model);
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const model = options.model ?? this.opts.defaultModel;
    if (this.protocol === 'anthropic') {
      // Anthropic streaming uses SSE on /v1/messages; parse event types.
      return this.streamAnthropic(messages, onChunk, options, model);
    }
    return this.streamOpenAi(messages, onChunk, options, model);
  }

  // ---- body builders ----

  private buildBody(
    model: string,
    messages: ChatMessage[],
    options: ChatOptions,
    stream: boolean,
  ): Record<string, unknown> {
    if (this.protocol === 'anthropic') {
      const { system, messages: amsgs } = toAnthropic(messages);
      const body: Record<string, unknown> = {
        model,
        max_tokens: options.maxTokens ?? 4096,
        messages: amsgs,
        stream,
      };
      if (system) body.system = system;
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.tools?.length) {
        body.tools = (options.tools as OpenAiTool[]).map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));
        body.tool_choice = this.mapToolChoice(options.toolChoice);
      }
      return body;
    }

    const body: Record<string, unknown> = {
      model,
      messages: toOpenAi(messages),
      stream,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? 'auto';
    }
    return body;
  }

  private mapToolChoice(
    choice: ChatOptions['toolChoice'],
  ): { type: string; name?: string } {
    if (!choice || choice === 'auto') return { type: 'auto' };
    if (choice === 'none' || choice === 'required') return { type: 'any' };
    return { type: 'tool', name: choice.function.name };
  }

  // ---- non-stream parsing ----

  private parseResponse(data: Record<string, unknown>, model: string): ChatResult {
    if (this.protocol === 'anthropic') {
      const { content, toolCalls } = fromAnthropicBlock(
        data.content as AnthropicContentBlock[] | undefined,
      );
      return {
        message: { role: 'assistant', content, toolCalls: toolCalls.length ? toolCalls : undefined },
        model: (data.model as string) ?? model,
        usage: this.mapAnthropicUsage(data.usage as Record<string, number> | undefined),
        finishReason: (data.stop_reason as string) ?? undefined,
        latencyMs: undefined,
      };
    }
    const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;
    if (!msg) throw new AiError('parse', 'AI 响应缺少 choices[0].message');
    return {
      message: {
        role: 'assistant',
        content: (msg.content as string | null) ?? null,
        toolCalls: fromOpenAiToolCalls(msg.tool_calls as OpenAiMessage['tool_calls']),
      },
      usage: data.usage as ChatResult['usage'],
      model: (data.model as string) ?? model,
      finishReason: choice?.finish_reason as string | undefined,
    };
  }

  private mapAnthropicUsage(usage: Record<string, number> | undefined): ChatResult['usage'] {
    if (!usage) return undefined;
    return {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    };
  }

  // ---- streaming ----

  private async streamOpenAi(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    options: ChatOptions,
    model: string,
  ): Promise<ChatResult> {
    const start = Date.now();
    const handle = buildSignal(options, this.opts.timeoutMs);
    const body = this.buildBody(model, messages, options, true);
    let response: Response;
    try {
      response = await this.fetchWithRetry(this.endpoint, body, handle);
    } catch (err) {
      handle.cancel();
      throw this.mapFetchError(err, handle);
    }
    if (!response.ok || !response.body) {
      const b = await response.text().catch(() => '');
      handle.cancel();
      throw classifyError(response.status, b);
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
            if (typeof delta?.content === 'string' && delta.content) {
              contentBuffer += delta.content;
              onChunk({ delta: delta.content });
            }
            const dtc = delta?.tool_calls as Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }> | undefined;
            if (dtc) {
              for (const part of dtc) {
                const acc = toolCallAcc.get(part.index) ?? { args: '' };
                if (part.id) acc.id = part.id;
                if (part.function?.name) acc.name = part.function.name;
                if (part.function?.arguments) acc.args += part.function.arguments;
                toolCallAcc.set(part.index, acc);
              }
            }
            if (choice.finish_reason) finishReason = String(choice.finish_reason);
          }
          if (parsed.usage) usage = parsed.usage as ChatResult['usage'];
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw this.abortError(handle, options.signal);
      throw new AiError('network', `AI 流读取失败: ${(err as Error).message}`, undefined, err);
    } finally {
      handle.cancel();
      reader.releaseLock();
    }
    const toolCalls: ToolCall[] = [...toolCallAcc.values()]
      .filter((v): v is { id: string; name: string; args: string } => !!v.id && !!v.name)
      .map((v) => ({ id: v.id, type: 'function', function: { name: v.name, arguments: v.args } }));
    for (const tc of toolCalls) onChunk({ toolCall: tc });
    return {
      message: { role: 'assistant', content: contentBuffer || null, toolCalls: toolCalls.length ? toolCalls : undefined },
      usage,
      model,
      finishReason,
      latencyMs: Date.now() - start,
    };
  }

  private async streamAnthropic(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    options: ChatOptions,
    model: string,
  ): Promise<ChatResult> {
    const start = Date.now();
    const handle = buildSignal(options, this.opts.timeoutMs);
    const body = this.buildBody(model, messages, options, true);
    let response: Response;
    try {
      response = await this.fetchWithRetry(this.endpoint, body, handle);
    } catch (err) {
      handle.cancel();
      throw this.mapFetchError(err, handle);
    }
    if (!response.ok || !response.body) {
      const b = await response.text().catch(() => '');
      handle.cancel();
      throw classifyError(response.status, b);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let contentBuffer = '';
    // Accumulate tool_use by index; Anthropic sends content_block_start/stop/delta.
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
          let evt: { type?: string; [k: string]: unknown };
          try {
            evt = JSON.parse(data) as typeof evt;
          } catch {
            continue;
          }
          switch (evt.type) {
            case 'content_block_start': {
              const idx = evt.index as number;
              const block = evt.content_block as Record<string, unknown> | undefined;
              if (block?.type === 'text') {
                toolCallAcc.set(idx, { args: '' });
              } else if (block?.type === 'tool_use') {
                toolCallAcc.set(idx, {
                  id: block.id as string,
                  name: block.name as string,
                  args: '',
                });
              }
              break;
            }
            case 'content_block_delta': {
              const idx = evt.index as number;
              const delta = evt.delta as Record<string, unknown> | undefined;
              if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                contentBuffer += delta.text;
                onChunk({ delta: delta.text });
              } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                const acc = toolCallAcc.get(idx) ?? { args: '' };
                acc.args += delta.partial_json;
                toolCallAcc.set(idx, acc);
              }
              break;
            }
            case 'message_delta': {
              const delta = evt.delta as Record<string, unknown> | undefined;
              if (delta?.stop_reason) finishReason = String(delta.stop_reason);
              if (evt.usage) usage = this.mapAnthropicUsage(evt.usage as Record<string, number>);
              break;
            }
            case 'message_start':
              if (evt.message) {
                const m = evt.message as Record<string, unknown>;
                if (m.usage) usage = this.mapAnthropicUsage(m.usage as Record<string, number>);
              }
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw this.abortError(handle, options.signal);
      throw new AiError('network', `AI 流读取失败: ${(err as Error).message}`, undefined, err);
    } finally {
      handle.cancel();
      reader.releaseLock();
    }
    const toolCalls: ToolCall[] = [...toolCallAcc.values()]
      .filter((v): v is { id: string; name: string; args: string } => !!v.id && !!v.name)
      .map((v) => ({ id: v.id, type: 'function', function: { name: v.name, arguments: v.args } }));
    for (const tc of toolCalls) onChunk({ toolCall: tc });
    return {
      message: { role: 'assistant', content: contentBuffer || null, toolCalls: toolCalls.length ? toolCalls : undefined },
      usage,
      model,
      finishReason,
      latencyMs: Date.now() - start,
    };
  }

  // ---- shared HTTP ----

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.opts.apiKey}`,
    };
    if (this.protocol === 'anthropic') {
      // Anthropic-native and Anthropic-compatible gateways (Volcengine ARK
      // Coding Plan, etc.) accept either x-api-key or Bearer; send both.
      h['x-api-key'] = this.opts.apiKey;
      h['anthropic-version'] = '2023-06-01';
      h['anthropic-beta'] = 'tools-2024-04-04';
    }
    return h;
  }

  private abortError(handle: SignalHandle, externalSignal?: AbortSignal): AiError {
    if (handle.timedOut()) return new AiError('timeout', 'AI 请求超时');
    if (externalSignal?.aborted) return new AiError('aborted', 'AI 请求已取消');
    return new AiError('aborted', 'AI 请求已取消');
  }

  private mapFetchError(err: unknown, handle: SignalHandle): AiError {
    if ((err as Error).name === 'AbortError') return this.abortError(handle);
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
          headers: this.headers(),
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

// ---- runtime config resolution ----

async function resolveConfig() {
  let { baseUrl, apiKey, timeoutMs, maxRetries, planningModel } = config.ai;
  let protocol: 'openai' | 'anthropic' = 'openai';
  const settings = await getSettings();
  const active = settings?.getActiveProvider();
  if (active) {
    baseUrl = active.baseUrl || baseUrl;
    apiKey = active.apiKey || apiKey;
    timeoutMs = active.timeoutMs || timeoutMs;
    maxRetries = active.maxRetries ?? maxRetries;
    planningModel = active.planningModel || planningModel;
    protocol = active.protocol;
  }
  return { baseUrl, apiKey, timeoutMs, maxRetries, planningModel, protocol };
}

/** Build the configured provider, or null when AI is disabled / no key. */
export async function createDeepSeekProvider(): Promise<DeepSeekProvider | null> {
  if (!config.ai.enabled) return null;
  const { baseUrl, apiKey, timeoutMs, maxRetries, planningModel, protocol } = await resolveConfig();
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
    protocol,
  });
}
