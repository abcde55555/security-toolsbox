import type { AgentLoopDeps } from './agentContext.js';
import { logger } from '../logger.js';

/**
 * 会话结束时的记忆沉淀：用 narrativeModel 从事件流提炼
 *  - scope='session' 的工作上下文（设备/网络/发现，供续聊与重测参考）
 *  - scope='user' 的用户偏好（沟通/操作习惯）
 * LLM 输出 JSON 数组容错解析；任何失败静默——记忆是增益不是依赖。
 */
export async function extractMemories(deps: AgentLoopDeps, sessionId: string): Promise<void> {
  const events = deps.repos.agent.listEvents(sessionId, 0).slice(-60);
  const transcript = events
    .filter((e) => ['user_message', 'model_message', 'tool_result', 'human_step'].includes(e.type))
    .map((e) => `${e.type}: ${(e.content ?? '').slice(0, 200)}`)
    .join('\n');
  if (transcript.length < 50) return; // 内容太少不值得沉淀

  const prompt = `以下是一次 IoT 设备合规测试会话的事件摘要。请提炼值得跨会话记住的信息，输出 JSON（不要多余文本）：
{"session":["本次执行的关键发现/环境事实，每条≤80字"],"user":["用户偏好或固定环境约定，每条≤60字"]}
没有可提炼内容就输出 {"session":[],"user":[]}。

${transcript.slice(0, 6000)}`;

  try {
    const result = await deps.provider.chat(
      [
        { role: 'system', content: '你是记忆提炼助手。只输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      { model: deps.repos.settings.getActiveProvider()?.narrativeModel, maxTokens: 4000 },
    );
    const raw = result.message.content ?? '';
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd <= jsonStart) return;
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      session?: string[];
      user?: string[];
    };
    let count = 0;
    for (const c of (parsed.session ?? []).slice(0, 5)) {
      if (typeof c === 'string' && c.trim()) {
        deps.repos.agentMemories.insert({
          scope: 'session',
          sessionId,
          content: c.trim().slice(0, 200),
          source: 'llm_extract',
          importance: 3,
        });
        count++;
      }
    }
    for (const c of (parsed.user ?? []).slice(0, 3)) {
      if (typeof c === 'string' && c.trim()) {
        // 简单去重：同内容不重复入库
        const existing = deps.repos.agentMemories.listUserMemories(50);
        if (existing.some((m) => m.content === c.trim())) continue;
        deps.repos.agentMemories.insert({
          scope: 'user',
          content: c.trim().slice(0, 160),
          source: `session:${sessionId.slice(0, 8)}`,
          importance: 4,
        });
        count++;
      }
    }
    if (count > 0) logger.info({ sessionId, count }, 'memories extracted');
  } catch (err) {
    logger.warn({ err, sessionId }, 'memory extraction failed (non-fatal)');
  }
}
