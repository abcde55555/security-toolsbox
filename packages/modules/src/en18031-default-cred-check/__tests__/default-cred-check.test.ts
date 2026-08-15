import { describe, expect, it, vi } from 'vitest';

import type { ClauseVerdictOutput, ExecutionStatus, ModuleExecuteContext } from '@en18031/shared';
import { validateExecutionResult } from '@en18031/shared';

import credCheck, { CLAUSE_IDS, parseOpenServices } from '../index.js';

interface CmdResult {
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const NMAP_TELNET_OPEN = `Starting Nmap 7.94
Nmap scan report for 192.168.1.100
PORT   STATE SERVICE
22/tcp open  ssh
23/tcp open  telnet
Nmap done: 1 IP address (1 host up) scanned in 0.20 seconds`;

const NMAP_NONE_OPEN = `Starting Nmap 7.94
Nmap scan report for 192.168.1.100
Host is up (0.0012s latency).
All 5 scanned ports on 192.168.1.100 are in ignored states.
Nmap done: 1 IP address (1 host up) scanned in 0.15 seconds`;

function makeContext(
  cmd: Partial<CmdResult> | (() => Promise<CmdResult>),
  overrides: Partial<ModuleExecuteContext> = {},
): ModuleExecuteContext & { engine: { runCommand: ReturnType<typeof vi.fn> } } {
  const runCommand =
    typeof cmd === 'function'
      ? vi.fn(cmd)
      : vi.fn(async () => ({
          status: 'success' as ExecutionStatus,
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 5,
          ...cmd,
        }));
  return {
    projectId: 'proj-1',
    stepId: 'step-cred',
    userId: 'user-admin',
    variables: {},
    onProgress: vi.fn(),
    cancelToken: { promise: new Promise<void>(() => {}), isRequested: false },
    engine: { runCommand },
    ...overrides,
  } as ModuleExecuteContext & { engine: { runCommand: ReturnType<typeof vi.fn> } };
}

const baseParams = {
  targetIp: '192.168.1.100',
  servicesToCheck: ['ssh', 'telnet', 'http', 'https', 'ftp'],
  timeoutMs: 10000,
};

function byClause(v: ClauseVerdictOutput[]): Record<string, ClauseVerdictOutput> {
  return Object.fromEntries(v.map((x) => [x.clauseId, x]));
}

function assertContract(result: Awaited<ReturnType<typeof credCheck.execute>>): void {
  const { valid, errors } = validateExecutionResult(result);
  expect(errors).toEqual([]);
  expect(valid).toBe(true);
  expect(new Set(result.verdicts.map((v) => v.clauseId))).toEqual(new Set(CLAUSE_IDS));
  for (const v of result.verdicts) {
    expect(v.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    for (const ref of v.evidenceRefs) expect(ref).toBeLessThanOrEqual(result.evidence.length - 1);
    if (v.pass) expect(['low', 'middle']).toContain(v.severity);
  }
}

describe('en18031-default-cred-check · 配置', () => {
  it('配置与契约一致且可 JSON 序列化', () => {
    expect(credCheck.config.id).toBe('en18031-default-cred-check');
    expect(credCheck.config.category).toBe('credential-compliance');
    const services = credCheck.config.formFields.find((f) => f.id === 'servicesToCheck');
    expect(services?.type).toBe('multiselect');
    expect(services?.value).toEqual(['ssh', 'telnet', 'http', 'https', 'ftp']);
    expect(credCheck.config.clauses.map((c) => c.clauseId)).toEqual([...CLAUSE_IDS]);
    expect(JSON.parse(JSON.stringify(credCheck.config))).toEqual(credCheck.config);
  });
});

describe('en18031-default-cred-check · 解析', () => {
  it('只保留被勾选服务对应的端口', () => {
    expect(parseOpenServices(NMAP_TELNET_OPEN, ['telnet'])).toEqual([
      { service: 'telnet', port: 23, proto: 'tcp', banner: 'telnet' },
    ]);
    expect(parseOpenServices(NMAP_TELNET_OPEN, ['ssh', 'telnet']).map((s) => s.port)).toEqual([
      22, 23,
    ]);
    expect(parseOpenServices(NMAP_NONE_OPEN, ['ssh'])).toEqual([]);
  });
});

describe('en18031-default-cred-check · 条款判定', () => {
  it('有管理服务开放 → 5.1-1/5.3-4 FAIL + high，且证据声明为筛查', async () => {
    const ctx = makeContext({ stdout: NMAP_TELNET_OPEN });
    const result = await credCheck.execute(baseParams, ctx);

    expect(result.status).toBe('success');
    const m = byClause(result.verdicts);
    for (const id of CLAUSE_IDS) {
      expect(m[id].pass).toBe(false);
      expect(m[id].severity).toBe('high');
      expect(m[id].reason).toContain('需人工核实默认口令是否已修改');
    }
    expect(result.evidence[0].content).toContain('非破坏性筛查');
    expect(result.evidence[0].content).toContain('不会尝试任何口令登录');
    expect(ctx.engine.runCommand).toHaveBeenCalledTimes(1);
    expect(ctx.engine.runCommand.mock.calls[0][0]).toBe(
      'nmap -p 21,22,23,80,443 --open 192.168.1.100',
    );
    assertContract(result);
  });

  it('无管理服务开放 → 2 条 PASS(middle)', async () => {
    const ctx = makeContext({ stdout: NMAP_NONE_OPEN });
    const result = await credCheck.execute(baseParams, ctx);

    const m = byClause(result.verdicts);
    for (const id of CLAUSE_IDS) {
      expect(m[id].pass).toBe(true);
      expect(m[id].severity).toBe('middle');
      expect(m[id].reason).toContain('未检测到相关管理服务');
    }
    assertContract(result);
  });

  it('只勾选 telnet → 命令只探测 23，ssh 开放不影响判定', async () => {
    const ctx = makeContext({ stdout: '22/tcp open ssh\n' });
    const result = await credCheck.execute({ ...baseParams, servicesToCheck: ['telnet'] }, ctx);

    expect(ctx.engine.runCommand.mock.calls[0][0]).toBe('nmap -p 23 --open 192.168.1.100');
    expect(byClause(result.verdicts)['5.1-1'].pass).toBe(true);
    assertContract(result);
  });

  it('nmap 非零退出 → status=fail，2 条 FAIL(high)', async () => {
    const ctx = makeContext({ exitCode: 127, stderr: 'nmap: not found' });
    const result = await credCheck.execute(baseParams, ctx);
    expect(result.status).toBe('fail');
    expect(result.error?.code).toBe('NMAP_EXIT_NONZERO');
    assertContract(result);
  });

  it('超时 → status=timeout，2 条 FAIL(middle)', async () => {
    const ctx = makeContext({ status: 'timeout', exitCode: 124 });
    const result = await credCheck.execute(baseParams, ctx);
    expect(result.status).toBe('timeout');
    for (const v of result.verdicts) expect(v.severity).toBe('middle');
    assertContract(result);
  });
});

describe('en18031-default-cred-check · 安全与异常分支', () => {
  it('非法 IP → 拦截', async () => {
    const ctx = makeContext({ stdout: NMAP_NONE_OPEN });
    const result = await credCheck.execute({ ...baseParams, targetIp: '1.2.3.4.5' }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    assertContract(result);
  });

  it('未知服务名 → 拦截', async () => {
    const ctx = makeContext({ stdout: NMAP_NONE_OPEN });
    const result = await credCheck.execute(
      { ...baseParams, servicesToCheck: ['ssh', 'rm -rf /'] },
      ctx,
    );
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    expect(result.error?.message).toContain('未知服务');
    assertContract(result);
  });

  it('空服务列表 → 拦截', async () => {
    const ctx = makeContext({ stdout: NMAP_NONE_OPEN });
    const result = await credCheck.execute({ ...baseParams, servicesToCheck: [] }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    assertContract(result);
  });

  it('runCommand 抛异常 → status=crash', async () => {
    const ctx = makeContext(async () => {
      throw new Error('boom');
    });
    const result = await credCheck.execute(baseParams, ctx);
    expect(result.status).toBe('crash');
    for (const v of result.verdicts) expect(v.severity).toBe('high');
    assertContract(result);
  });

  it('cancelToken 竞速 → cancelled', async () => {
    let resolveCancel: () => void = () => {};
    const cancelPromise = new Promise<void>((r) => {
      resolveCancel = r;
    });
    const ctx = makeContext(
      () => {
        setTimeout(resolveCancel, 10);
        return new Promise<CmdResult>(() => {});
      },
      { cancelToken: { promise: cancelPromise, isRequested: false } },
    );
    const result = await credCheck.execute(baseParams, ctx);
    expect(result.status).toBe('cancelled');
    assertContract(result);
  });
});
