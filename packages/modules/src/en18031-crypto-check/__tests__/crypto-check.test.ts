import { describe, expect, it, vi } from 'vitest';

import type { ClauseVerdictOutput, ExecutionStatus, ModuleExecuteContext } from '@en18031/shared';
import { validateExecutionResult } from '@en18031/shared';

import cryptoCheck, { CLAUSE_IDS, detectWeakCrypto, parseCertInfo } from '../index.js';

interface CmdResult {
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const ok = (stdout: string, exitCode = 0): CmdResult => ({
  status: 'success',
  exitCode,
  stdout,
  stderr: '',
  durationMs: 5,
});

const CERT_GOOD = `notBefore=Jan  1 00:00:00 2024 GMT
notAfter=Jan  1 00:00:00 2099 GMT
subject=C = CN, O = Vendor, CN = device.example.com
issuer=C = CN, O = Vendor CA, CN = Vendor Issuing CA
serial=0A1B2C3D`;

const CERT_EXPIRED = `notBefore=Jan  1 00:00:00 2010 GMT
notAfter=Jan  1 00:00:00 2012 GMT
subject=CN = device.local
issuer=CN = Vendor CA
serial=01`;

const CERT_SELF_SIGNED = `notBefore=Jan  1 00:00:00 2024 GMT
notAfter=Jan  1 00:00:00 2099 GMT
subject=CN = device.local
issuer=CN = device.local
serial=01`;

const CIPHERS_STRONG = `Nmap scan report for 192.168.1.100
PORT    STATE SERVICE
443/tcp open  https
| ssl-enum-ciphers:
|   TLSv1.2:
|     ciphers:
|       TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 (secp256r1) - A
|       TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 (secp256r1) - A
|       TLS_RSA_WITH_AES_128_CBC_SHA256 (rsa 2048) - A
|     compressors:
|       NULL
|     cipher preference: server
|_  least strength: A`;

const CIPHERS_WEAK = `| ssl-enum-ciphers:
|   SSLv3:
|     ciphers:
|       TLS_RSA_WITH_RC4_128_SHA (rsa 2048) - C
|   TLSv1.0:
|     ciphers:
|       TLS_RSA_WITH_3DES_EDE_CBC_SHA (rsa 2048) - C
|       TLS_RSA_WITH_DES_CBC_SHA (rsa 2048) - E
|_  least strength: E`;

function makeContext(
  queue: Array<CmdResult | (() => Promise<CmdResult>)>,
  overrides: Partial<ModuleExecuteContext> = {},
): ModuleExecuteContext & { engine: { runCommand: ReturnType<typeof vi.fn> } } {
  let i = 0;
  const runCommand = vi.fn(async () => {
    const item = queue[Math.min(i++, queue.length - 1)];
    return typeof item === 'function' ? await item() : item;
  });
  return {
    projectId: 'proj-1',
    stepId: 'step-crypto',
    userId: 'user-admin',
    variables: {},
    onProgress: vi.fn(),
    cancelToken: { promise: new Promise<void>(() => {}), isRequested: false },
    engine: { runCommand },
    ...overrides,
  } as ModuleExecuteContext & { engine: { runCommand: ReturnType<typeof vi.fn> } };
}

const baseParams = { targetIp: '192.168.1.100', port: 443, timeoutMs: 30000 };

function byClause(v: ClauseVerdictOutput[]): Record<string, ClauseVerdictOutput> {
  return Object.fromEntries(v.map((x) => [x.clauseId, x]));
}

function assertContract(result: Awaited<ReturnType<typeof cryptoCheck.execute>>): void {
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

describe('en18031-crypto-check · 配置', () => {
  it('配置与契约一致且可 JSON 序列化', () => {
    expect(cryptoCheck.config.id).toBe('en18031-crypto-check');
    expect(cryptoCheck.config.category).toBe('crypto-compliance');
    expect(cryptoCheck.config.formFields.map((f) => f.id)).toEqual([
      'targetIp',
      'port',
      'timeoutMs',
    ]);
    expect(cryptoCheck.config.clauses.map((c) => c.clauseId)).toEqual([...CLAUSE_IDS]);
    expect(JSON.parse(JSON.stringify(cryptoCheck.config))).toEqual(cryptoCheck.config);
  });
});

describe('en18031-crypto-check · 解析器', () => {
  it('强套件输出不产生弱特征命中', () => {
    const r = detectWeakCrypto(CIPHERS_STRONG);
    expect(r.hasCipherInfo).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it('弱套件输出命中 RC4/3DES/DES/CBC-SHA1 与 SSLv3/TLSv1.0', () => {
    const r = detectWeakCrypto(CIPHERS_WEAK);
    const labels = r.findings.map((f) => f.label).join(' | ');
    expect(labels).toContain('RC4');
    expect(labels).toContain('3DES');
    expect(labels).toContain('单 DES');
    expect(labels).toContain('CBC');
    expect(r.protocols).toEqual(['SSLv3', 'TLSv1.0']);
  });

  it('无 nmap 输出 → hasCipherInfo=false', () => {
    expect(detectWeakCrypto('nmap: command not found').hasCipherInfo).toBe(false);
    expect(detectWeakCrypto('').hasCipherInfo).toBe(false);
  });

  it('证书解析：有效 / 过期 / 自签名 / 不可达', () => {
    const good = parseCertInfo(CERT_GOOD);
    expect(good.reachable).toBe(true);
    expect(good.expired).toBe(false);
    expect(good.selfSigned).toBe(false);
    expect(good.serial).toBe('0A1B2C3D');

    expect(parseCertInfo(CERT_EXPIRED).expired).toBe(true);
    expect(parseCertInfo(CERT_SELF_SIGNED).selfSigned).toBe(true);
    expect(parseCertInfo('').reachable).toBe(false);
  });
});

describe('en18031-crypto-check · 条款判定', () => {
  it('强加密 + 有效证书 → 5.4-1/5.4-2 全 PASS，status=success', async () => {
    const ctx = makeContext([ok(CERT_GOOD), ok(CIPHERS_STRONG)]);
    const result = await cryptoCheck.execute(baseParams, ctx);

    expect(result.status).toBe('success');
    const m = byClause(result.verdicts);
    expect(m['5.4-1'].pass).toBe(true);
    expect(m['5.4-2'].pass).toBe(true);
    expect(ctx.engine.runCommand).toHaveBeenCalledTimes(2);
    expect(ctx.engine.runCommand.mock.calls[0][0]).toContain('openssl s_client -connect 192.168.1.100:443');
    expect(ctx.engine.runCommand.mock.calls[1][0]).toBe(
      'nmap --script ssl-enum-ciphers -p 443 192.168.1.100',
    );
    assertContract(result);
  });

  it('弱套件 → 5.4-1 FAIL + high', async () => {
    const ctx = makeContext([ok(CERT_GOOD), ok(CIPHERS_WEAK)]);
    const result = await cryptoCheck.execute(baseParams, ctx);

    const m = byClause(result.verdicts);
    expect(m['5.4-1'].pass).toBe(false);
    expect(m['5.4-1'].severity).toBe('high');
    expect(m['5.4-2'].pass).toBe(true);
    assertContract(result);
  });

  it('自签名证书 → 5.4-2 FAIL + middle', async () => {
    const ctx = makeContext([ok(CERT_SELF_SIGNED), ok(CIPHERS_STRONG)]);
    const result = await cryptoCheck.execute(baseParams, ctx);

    const m = byClause(result.verdicts);
    expect(m['5.4-2'].pass).toBe(false);
    expect(m['5.4-2'].severity).toBe('middle');
    expect(m['5.4-2'].reason).toContain('自签名');
    assertContract(result);
  });

  it('过期证书 → 5.4-2 FAIL', async () => {
    const ctx = makeContext([ok(CERT_EXPIRED), ok(CIPHERS_STRONG)]);
    const result = await cryptoCheck.execute(baseParams, ctx);
    expect(byClause(result.verdicts)['5.4-2'].reason).toContain('过期');
    assertContract(result);
  });

  it('nmap 缺失 → status=partial，5.4-1 FAIL(middle)', async () => {
    const ctx = makeContext([ok(CERT_GOOD), ok('nmap: command not found', 127)]);
    const result = await cryptoCheck.execute(baseParams, ctx);

    expect(result.status).toBe('partial');
    const m = byClause(result.verdicts);
    expect(m['5.4-1'].pass).toBe(false);
    expect(m['5.4-1'].severity).toBe('middle');
    expect(m['5.4-2'].pass).toBe(true);
    assertContract(result);
  });

  it('目标不可达（两条命令都无结果）→ status=fail', async () => {
    const ctx = makeContext([ok(''), ok('', 1)]);
    const result = await cryptoCheck.execute(baseParams, ctx);

    expect(result.status).toBe('fail');
    expect(result.error?.code).toBe('TLS_TARGET_UNREACHABLE');
    for (const v of result.verdicts) expect(v.pass).toBe(false);
    assertContract(result);
  });
});

describe('en18031-crypto-check · 安全与异常分支', () => {
  it('非法 IP → 拦截，不执行命令', async () => {
    const ctx = makeContext([ok(CERT_GOOD)]);
    const result = await cryptoCheck.execute({ ...baseParams, targetIp: '1.2.3' }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    expect(result.exitCode).toBe(2);
    assertContract(result);
  });

  it('非法 port（注入）→ 拦截', async () => {
    const ctx = makeContext([ok(CERT_GOOD)]);
    const result = await cryptoCheck.execute({ ...baseParams, port: '443; id' }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    assertContract(result);
  });

  it('超时 → status=timeout，2 条 FAIL(middle)', async () => {
    const ctx = makeContext([
      { status: 'timeout', exitCode: 124, stdout: '', stderr: '', durationMs: 1 },
    ]);
    const result = await cryptoCheck.execute(baseParams, ctx);
    expect(result.status).toBe('timeout');
    for (const v of result.verdicts) {
      expect(v.pass).toBe(false);
      expect(v.severity).toBe('middle');
    }
    assertContract(result);
  });

  it('runCommand 抛异常 → status=crash', async () => {
    const ctx = makeContext([
      () => {
        throw new Error('spawn ENOENT');
      },
    ]);
    const result = await cryptoCheck.execute(baseParams, ctx);
    expect(result.status).toBe('crash');
    for (const v of result.verdicts) expect(v.severity).toBe('high');
    assertContract(result);
  });

  it('执行前已取消 → cancelled', async () => {
    const ctx = makeContext([ok(CERT_GOOD)], {
      cancelToken: { promise: new Promise<void>(() => {}), isRequested: true },
    });
    const result = await cryptoCheck.execute(baseParams, ctx);
    expect(result.status).toBe('cancelled');
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    assertContract(result);
  });
});
