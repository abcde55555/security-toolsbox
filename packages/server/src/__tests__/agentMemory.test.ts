import { describe, it, expect } from 'vitest';
import { createInMemoryRepositories } from '../repositories/index.js';
import { buildSystemPrompt } from '../agent/prompts.js';
import { extractMemories } from '../agent/memoryExtractor.js';
import type { AgentLoopDeps } from '../agent/agentContext.js';
import type { ChatResult } from '../agent/ai/types.js';

describe('AgentMemoryRepository', () => {
  it('insert + 按 scope 查询；user 级按重要度排序', () => {
    const { repos } = createInMemoryRepositories();
    repos.agentMemories.insert({ scope: 'session', sessionId: 's1', content: '设备 192.168.1.5 开启 telnet', source: 'llm_extract', importance: 3 });
    repos.agentMemories.insert({ scope: 'user', content: '用户偏好中文回复', source: 'seed', importance: 4 });
    repos.agentMemories.insert({ scope: 'user', content: '测试网段固定为 10.0.0.0/24', source: 'seed', importance: 5 });

    expect(repos.agentMemories.listBySession('s1')).toHaveLength(1);
    expect(repos.agentMemories.listBySession('other')).toHaveLength(0);
    const user = repos.agentMemories.listUserMemories(8);
    expect(user).toHaveLength(2);
    expect(user[0].content).toBe('测试网段固定为 10.0.0.0/24'); // importance 5 在前
  });
});

describe('buildSystemPrompt 记忆注入', () => {
  const base = {
    session: {
      id: 's1', projectId: 'p1', standardVersion: 'EN18031:2019', phase: 'collection',
      status: 'running', deviceProfile: {}, selectedClauses: ['5.1'], authorizedTools: ['nmap'],
    } as never,
    clauses: [],
    authorizedTools: ['nmap'],
  };

  it('有记忆时注入「相关记忆」段', () => {
    const p = buildSystemPrompt({ ...base, memories: ['设备已 root', '网络隔离环境'] });
    expect(p).toContain('相关记忆');
    expect(p).toContain('- 设备已 root');
  });

  it('无记忆时不出现空段', () => {
    const p = buildSystemPrompt(base);
    expect(p).not.toContain('相关记忆');
  });
});

describe('extractMemories', () => {
  function makeDeps(replyContent: string) {
    const { repos } = createInMemoryRepositories();
    // 铺一些事件让 transcript 足够长
    for (let i = 0; i < 10; i++) {
      repos.agent.createEvent({ sessionId: 'sx', type: 'model_message', role: 'assistant', content: `执行扫描步骤 ${i}，发现开放端口与弱口令线索`.repeat(2) });
    }
    const provider = {
      async chat(): Promise<ChatResult> {
        return { message: { role: 'assistant', content: replyContent }, model: 'test' } as ChatResult;
      },
    };
    return { deps: { repos, provider } as unknown as AgentLoopDeps, repos };
  }

  it('解析 LLM JSON 并分别入库 session/user 记忆', async () => {
    const { deps, repos } = makeDeps(
      '{"session":["目标设备开启 telnet 且弱口令"],"user":["用户要求所有报告使用中文"]}',
    );
    await extractMemories(deps, 'sx');
    expect(repos.agentMemories.listBySession('sx')).toHaveLength(1);
    expect(repos.agentMemories.listUserMemories(8)).toHaveLength(1);
  });

  it('user 记忆去重：相同内容不重复入库', async () => {
    const reply = '{"session":[],"user":["用户偏好夜间执行"]}';
    const { deps, repos } = makeDeps(reply);
    await extractMemories(deps, 'sx');
    await extractMemories(deps, 'sx');
    expect(repos.agentMemories.listUserMemories(8)).toHaveLength(1);
  });

  it('LLM 输出非 JSON 时静默失败不入库', async () => {
    const { deps, repos } = makeDeps('我觉得没什么好记的');
    await extractMemories(deps, 'sx');
    expect(repos.agentMemories.listBySession('sx')).toHaveLength(0);
  });
});
