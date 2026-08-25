import type { Database } from 'better-sqlite3';

export interface AgentMemory {
  id: string;
  /** workspace 级（跨会话的用户偏好/环境事实）或 session 级（本次执行发现） */
  scope: 'user' | 'session';
  sessionId?: string;
  content: string;
  source: string;
  importance: number; // 1-5，5 最高
  createdAt: string;
}

/**
 * Agent 记忆库：会话结束时由 LLM 从事件流中提炼「值得跨轮次/跨会话记住」的
 * 事实（工作上下文）与用户偏好（user memory）；新会话启动时按需注入系统提示词。
 * 检索/压缩策略的完整设计见 docs/wiki/09-agent-context-memory.md。
 */
export class AgentMemoryRepository {
  constructor(private db: Database) {}

  insert(m: Omit<AgentMemory, 'id' | 'createdAt'>): AgentMemory {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_memories (id, scope, sessionId, content, source, importance, createdAt)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(id, m.scope, m.sessionId ?? null, m.content, m.source, m.importance, createdAt);
    return { ...m, id, createdAt };
  }

  listBySession(sessionId: string, limit = 20): AgentMemory[] {
    return this.db
      .prepare(
        `SELECT * FROM agent_memories WHERE scope='session' AND sessionId=? ORDER BY importance DESC, createdAt DESC LIMIT ?`,
      )
      .all(sessionId, limit) as unknown as AgentMemory[];
  }

  listUserMemories(limit = 8): AgentMemory[] {
    return this.db
      .prepare(`SELECT * FROM agent_memories WHERE scope='user' ORDER BY importance DESC, createdAt DESC LIMIT ?`)
      .all(limit) as unknown as AgentMemory[];
  }
}
