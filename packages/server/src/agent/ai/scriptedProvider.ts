import {
  AiError,
  type AiProvider,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type StreamChunk,
  type ToolCall,
} from './types.js';

/**
 * Deterministic provider for tests and for running the agent loop without a
 * real LLM. It is constructed with a script: a queue of responses returned in
 * order. Each response is either an assistant text message or a set of tool
 * calls. When the script runs out, a final "stop" message is returned.
 */
export type ScriptedResponse =
  | { content: string; toolCalls?: never }
  | { content?: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> };

export class ScriptedAiProvider implements AiProvider {
  readonly name = 'scripted';
  private calls: ChatMessage[][] = [];
  private index = 0;

  constructor(private readonly script: ScriptedResponse[] = []) {}

  get callCount(): number {
    return this.calls.length;
  }

  get lastMessages(): ChatMessage[] | undefined {
    return this.calls[this.calls.length - 1];
  }

  async chat(messages: ChatMessage[], _options: ChatOptions = {}): Promise<ChatResult> {
    if (_options.signal?.aborted) throw new AiError('aborted', 'AI 请求已取消');
    this.calls.push(messages);
    const response = this.script[this.index++];
    const toolCalls: ToolCall[] | undefined = response?.toolCalls?.map((tc, i) => ({
      id: tc.id ?? `call_${this.index}_${i}`,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    }));
    return {
      message: {
        role: 'assistant',
        content: response?.content ?? (toolCalls ? null : '（脚本结束）'),
        toolCalls,
      },
      model: 'scripted',
      finishReason: toolCalls?.length ? 'tool_calls' : 'stop',
      latencyMs: 0,
    };
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const result = await this.chat(messages, options);
    if (result.message.content) onChunk({ delta: result.message.content });
    for (const tc of result.message.toolCalls ?? []) onChunk({ toolCall: tc });
    return result;
  }
}
