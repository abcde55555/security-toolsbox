/**
 * AiProvider abstraction. One-shot and streaming chat with function-calling.
 * Model-agnostic; DeepSeek implements the OpenAI-compatible contract. A
 * ScriptedAiProvider is used for tests / when AI is disabled.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** Raw JSON-encoded arguments string from the model. */
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content?: string | null;
  /** Present on assistant messages that request tool calls. */
  toolCalls?: ToolCall[];
  /** Present on tool-result messages; correlates to ToolCall.id. */
  toolCallId?: string;
  name?: string;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  message: ChatMessage;
  usage?: ChatUsage;
  model: string;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | string;
  latencyMs?: number;
}

export interface StreamChunk {
  /** Incremental assistant text delta. */
  delta?: string;
  /** Emitted once a complete tool call is assembled (stream may not support partial args). */
  toolCall?: ToolCall;
  usage?: ChatUsage;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSchema[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type AiErrorCode =
  | 'ai_disabled'
  | 'invalid_request'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'parse';

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiProvider {
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  /**
   * Stream chunks via onChunk; resolves with the final assembled result.
   * Implementations that don't support streaming may fall back to one-shot and
   * emit a single delta.
   */
  streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    options?: ChatOptions,
  ): Promise<ChatResult>;
}
