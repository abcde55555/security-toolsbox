import { describe, expect, it, vi } from 'vitest';

import type { ClauseVerdictOutput, ExecutionStatus, ModuleExecuteContext } from '@en18031/shared';
import { validateExecutionResult } from '@en18031/shared';

import portCheck, { CLAUSE_IDS, parseNmapXml, parseOpenPorts } from '../index.js';

const XML_SSH_HTTPS = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun><host><ports>
<port protocol="tcp" portid="22"><state state="open"/><service name="ssh" product="OpenSSH" version="9.0"/></port>
<port protocol="tcp" portid="443"><state state="open"/><service name="https"/></port>
</ports></host></nmaprun>`;

const XML_WITH_TELNET = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun><host><ports>
<port protocol="tcp" portid="22"><state state="open"/><service name="ssh" product="OpenSSH" version="9.0"/></port>
<port protocol="tcp" portid="23"><state state="open"/><service name="telnet"/></port>
<port protocol="tcp" portid="443"><state state="open"/><service name="https"/></port>
</ports></host></nmaprun>`;

const XML_UPNP = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun><host><ports>
<port protocol="udp" portid="1900"><state state="open"/><service name="upnp"/></port>
<port protocol="tcp" portid="80"><state state="open"/><service name="http"/></port>
</ports></host></nmaprun>`;

const XML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun><host><ports></ports></host></nmaprun>`;

interface CmdResult {
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

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
          durationMs: 10,
          ...cmd,
        }));
  return {
    projectId: 'proj-1',
    stepId: 'step-port-check',
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
  portRange: '1-10000',
  scanType: 'sT',
  timeoutMs: 120000,
  includeServiceVersion: true,
};

function byClause(verdicts: ClauseVerdictOutput[]): Record<string, ClauseVerdictOutput> {
  return Object.fromEntries(verdicts.map((v) => [v.clauseId, v]));
}

function assertContract(result: Awaited<ReturnType<typeof portCheck.execute>>): void {
  const { valid, errors } = validateExecutionResult(result);
  expect(errors).toEqual([]);
  expect(valid).toBe(true);
  // 声明条款集合 === 返回条款集合
  expect(new Set(result.verdicts.map((v) => v.clauseId))).toEqual(new Set(CLAUSE_IDS));
  for (const v of result.verdicts) {
    expect(v.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    for (const ref of v.evidenceRefs) {
      expect(ref).toBeLessThanOrEqual(result.evidence.length - 1);
    }
    if (v.pass) expect(['low', 'middle']).toContain(v.severity);
  }
}

describe('en18031-port-check · module.config', () => {
  it('配置字段与 SDK 契约一致，且可 JSON 序列化', () => {
    expect(portCheck.config.id).toBe('en18031-port-check');
    expect(portCheck.config.version).toBe('1.0.0');
    expect(portCheck.config.sdkVersion).toBe('^1.0.0');
    expect(portCheck.config.type).toBe('module');
    expect(portCheck.config.interactionMode).toBe('form');
    expect(portCheck.config.category).toBe('network-compliance');
    expect(portCheck.config.healthCheck?.command).toBe('nmap --version');
    expect(portCheck.config.formFields.map((f) => f.id)).toEqual([
      'targetIp',
      'portRange',
      'scanType',
      'timeoutMs',
      'includeServiceVersion',
    ]);
    expect(portCheck.config.clauses.map((c) => c.clauseId)).toEqual([...CLAUSE_IDS]);
    expect(JSON.parse(JSON.stringify(portCheck.config))).toEqual(portCheck.config);
  });
});

describe('en18031-port-check · nmap XML 解析', () => {
  it('解析出端口/协议/服务/版本', () => {
    expect(parseNmapXml(XML_SSH_HTTPS)).toEqual([
      { port: 22, proto: 'tcp', service: 'ssh', version: 'OpenSSH 9.0' },
      { port: 443, proto: 'tcp', service: 'https', version: '' },
    ]);
  });

  it('忽略 state != open 的端口', () => {
    const xml =
      '<nmaprun><host><ports><port protocol="tcp" portid="25"><state state="filtered"/></port></ports></host></nmaprun>';
    expect(parseNmapXml(xml)).toEqual([]);
  });

  it('兜底解析 nmap 文本输出', () => {
    const ports = parseOpenPorts('22/tcp open  ssh     OpenSSH 9.0\n23/tcp open  telnet');
    expect(ports.map((p) => p.port)).toEqual([22, 23]);
    expect(ports[1].service).toBe('telnet');
  });
});

describe('en18031-port-check · 条款判定', () => {
  it('(a) 仅开放 22/443 → 4 条条款全部 PASS', async () => {
    const ctx = makeContext({ stdout: XML_SSH_HTTPS });
    const result = await portCheck.execute(baseParams, ctx);

    expect(result.status).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.verdicts).toHaveLength(4);
    const m = byClause(result.verdicts);
    expect(m['5.3-1'].pass).toBe(true);
    expect(m['5.3-2'].pass).toBe(true);
    expect(m['5.3-3'].pass).toBe(true);
    expect(m['5.3-5'].pass).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.type === 'file_pointer')).toBe(true);
    assertContract(result);
  });

  it('(b) 开放 23/telnet → 5.3-2 FAIL + high，5.3-1 也 FAIL', async () => {
    const ctx = makeContext({ stdout: XML_WITH_TELNET });
    const result = await portCheck.execute({ ...baseParams, portRange: '1-100' }, ctx);

    const m = byClause(result.verdicts);
    expect(m['5.3-2'].pass).toBe(false);
    expect(m['5.3-2'].severity).toBe('high');
    expect(m['5.3-2'].reason).toContain('Telnet');
    expect(m['5.3-1'].pass).toBe(false);
    expect(m['5.3-1'].severity).toBe('middle');
    expect(m['5.3-3'].pass).toBe(true);
    assertContract(result);
  });

  it('(c) 超时 → status=timeout，4 条条款 FAIL + middle', async () => {
    const ctx = makeContext({ status: 'timeout', exitCode: 124, stdout: '' });
    const result = await portCheck.execute(baseParams, ctx);

    expect(result.status).toBe('timeout');
    expect(result.verdicts).toHaveLength(4);
    for (const v of result.verdicts) {
      expect(v.pass).toBe(false);
      expect(v.severity).toBe('middle');
      expect(v.reason).toContain('超时');
    }
    assertContract(result);
  });

  it('开放 80/http + 1900/upnp → 5.3-2 与 5.3-5 FAIL，5.3-3 FAIL(high)', async () => {
    const ctx = makeContext({ stdout: XML_UPNP });
    const result = await portCheck.execute(baseParams, ctx);

    const m = byClause(result.verdicts);
    expect(m['5.3-2'].pass).toBe(false);
    expect(m['5.3-2'].reason).toContain('HTTP');
    expect(m['5.3-5'].pass).toBe(false);
    expect(m['5.3-5'].severity).toBe('middle');
    expect(m['5.3-3'].pass).toBe(false);
    expect(m['5.3-3'].severity).toBe('high');
    assertContract(result);
  });

  it('无任何开放端口 → 5.3-1/5.3-2/5.3-5 PASS，5.3-3 FAIL（无加密通道）', async () => {
    const ctx = makeContext({ stdout: XML_EMPTY });
    const result = await portCheck.execute(baseParams, ctx);

    const m = byClause(result.verdicts);
    expect(m['5.3-1'].pass).toBe(true);
    expect(m['5.3-2'].pass).toBe(true);
    expect(m['5.3-5'].pass).toBe(true);
    expect(m['5.3-3'].pass).toBe(false);
    assertContract(result);
  });

  it('nmap 非零退出 → status=fail，4 条 FAIL + high', async () => {
    const ctx = makeContext({ exitCode: 1, stderr: 'nmap: command failed' });
    const result = await portCheck.execute(baseParams, ctx);

    expect(result.status).toBe('fail');
    expect(result.error?.code).toBe('NMAP_EXIT_NONZERO');
    for (const v of result.verdicts) {
      expect(v.pass).toBe(false);
      expect(v.severity).toBe('high');
    }
    assertContract(result);
  });
});

describe('en18031-port-check · 安全与异常分支', () => {
  it('portRange 含 shell 注入 → 拦截，且从未调用 runCommand', async () => {
    const ctx = makeContext({ stdout: XML_SSH_HTTPS });
    const result = await portCheck.execute(
      { ...baseParams, portRange: '22; rm -rf /tmp/test' },
      ctx,
    );

    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    expect(result.exitCode).toBe(2);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(result.evidence[0].type).toBe('validation_error');
    for (const v of result.verdicts) {
      expect(v.pass).toBe(false);
      expect(v.severity).toBe('high');
    }
    assertContract(result);
  });

  it('非法 targetIp → 拦截', async () => {
    const ctx = makeContext({ stdout: XML_SSH_HTTPS });
    const result = await portCheck.execute({ ...baseParams, targetIp: '999.1.1.1' }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    assertContract(result);
  });

  it('非法 scanType → 拦截', async () => {
    const ctx = makeContext({ stdout: XML_SSH_HTTPS });
    const result = await portCheck.execute({ ...baseParams, scanType: 'sX' }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    assertContract(result);
  });

  it('cancelToken 触发 → status=cancelled，4 条 FAIL + middle', async () => {
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
    const result = await portCheck.execute({ ...baseParams, portRange: '1-65535' }, ctx);

    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBe(137);
    for (const v of result.verdicts) {
      expect(v.pass).toBe(false);
      expect(v.severity).toBe('middle');
    }
    assertContract(result);
  });

  it('执行前已取消 → 直接返回 cancelled，不发起命令', async () => {
    const ctx = makeContext(
      { stdout: XML_SSH_HTTPS },
      { cancelToken: { promise: new Promise<void>(() => {}), isRequested: true } },
    );
    const result = await portCheck.execute(baseParams, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    assertContract(result);
  });

  it('runCommand 抛异常 → status=crash（不 reject）', async () => {
    const ctx = makeContext(async () => {
      throw new Error('spawn ENOENT');
    });
    const result = await portCheck.execute(baseParams, ctx);

    expect(result.status).toBe('crash');
    expect(result.error?.code).toBe('UNEXPECTED_CRASH');
    expect(result.verdicts).toHaveLength(4);
    for (const v of result.verdicts) {
      expect(v.pass).toBe(false);
      expect(v.severity).toBe('high');
    }
    assertContract(result);
  });

  it('onProgress 至少上报 5% 起始与 100% 完成', async () => {
    const ctx = makeContext({ stdout: XML_SSH_HTTPS });
    await portCheck.execute(baseParams, ctx);
    const calls = (ctx.onProgress as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { percent?: number }).percent,
    );
    expect(calls).toContain(5);
    expect(calls).toContain(96);
    expect(calls).toContain(100);
  });
});
