import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ClauseVerdictOutput, ExecutionStatus, ModuleExecuteContext } from '@en18031/shared';
import { validateExecutionResult } from '@en18031/shared';

import fwScan, { CLAUSE_IDS, REDACT_LEN, redactLine, redactMatches } from '../index.js';

interface CmdResult {
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const ok = (stdout: string, exitCode = 0, stderr = ''): CmdResult => ({
  status: 'success',
  exitCode,
  stdout,
  stderr,
  durationMs: 5,
});

const SECRET_HITS = `admin_password=SuperSecret123
API_KEY=AKIAIOSFODNN7EXAMPLE
-----BEGIN RSA PRIVATE KEY-----`;

const DEBUG_HITS = `jtag_enable=1
uart console baudrate 115200`;

const BINWALK_OUT = `DECIMAL       HEXADECIMAL     DESCRIPTION
--------------------------------------------------------------
0             0x0             uImage header, header size: 64 bytes
1024          0x400           Squashfs filesystem, little endian`;

let dir = '';
let firmware = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'en18031-fw-test-'));
  firmware = join(dir, 'firmware.bin');
  await writeFile(firmware, 'dummy firmware payload');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

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
    stepId: 'step-fw',
    userId: 'user-admin',
    variables: {},
    onProgress: vi.fn(),
    cancelToken: { promise: new Promise<void>(() => {}), isRequested: false },
    engine: { runCommand },
    ...overrides,
  } as ModuleExecuteContext & { engine: { runCommand: ReturnType<typeof vi.fn> } };
}

function byClause(v: ClauseVerdictOutput[]): Record<string, ClauseVerdictOutput> {
  return Object.fromEntries(v.map((x) => [x.clauseId, x]));
}

function assertContract(result: Awaited<ReturnType<typeof fwScan.execute>>): void {
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

describe('en18031-firmware-secret-scan · 配置', () => {
  it('配置与契约一致且可 JSON 序列化', () => {
    expect(fwScan.config.id).toBe('en18031-firmware-secret-scan');
    expect(fwScan.config.category).toBe('firmware-analysis');
    const f = fwScan.config.formFields.find((x) => x.id === 'firmwareFile');
    expect(f?.type).toBe('file');
    expect(f?.accept).toBe('.bin,.hex,.img,.tar,.gz');
    expect(f?.maxSizeMb).toBe(200);
    expect(fwScan.config.clauses.map((c) => c.clauseId)).toEqual([...CLAUSE_IDS]);
    expect(JSON.parse(JSON.stringify(fwScan.config))).toEqual(fwScan.config);
  });
});

describe('en18031-firmware-secret-scan · 脱敏', () => {
  it('超长行截断到 120 字符并标注', () => {
    const long = `password=${'A'.repeat(500)}`;
    const red = redactLine(long);
    expect(red.length).toBeLessThan(160);
    expect(red.startsWith(`password=${'A'.repeat(REDACT_LEN - 'password='.length)}`)).toBe(true);
    expect(red).toContain('已截断');
  });

  it('去重并限制条数', () => {
    expect(redactMatches('a\na\nb\n\n')).toEqual(['a', 'b']);
    expect(redactMatches('a\nb\nc', 2)).toEqual(['a', 'b']);
  });
});

describe('en18031-firmware-secret-scan · 条款判定', () => {
  it('命中凭据与调试特征 → 5.5-1 FAIL(high)、5.5-3 FAIL(middle)', async () => {
    const ctx = makeContext([ok(SECRET_HITS), ok(DEBUG_HITS), ok(BINWALK_OUT)]);
    const result = await fwScan.execute({ firmwareFile: firmware, scanDepth: 'quick' }, ctx);

    expect(result.status).toBe('success');
    const m = byClause(result.verdicts);
    expect(m['5.5-1'].pass).toBe(false);
    expect(m['5.5-1'].severity).toBe('high');
    expect(m['5.5-3'].pass).toBe(false);
    expect(m['5.5-3'].severity).toBe('middle');

    const cmds = ctx.engine.runCommand.mock.calls.map((c) => c[0] as string);
    expect(cmds[0]).toContain(`strings '${firmware}'`);
    expect(cmds[0]).toContain('head -100');
    expect(cmds[0]).toContain('en18031-fw-secrets-');
    expect(cmds[1]).toContain("grep -iE '(jtag|uart|debug console)'");
    expect(cmds[2]).toBe(`binwalk '${firmware}'`);
    // cwd 设为固件所在目录
    expect((ctx.engine.runCommand.mock.calls[0][1] as { cwd?: string }).cwd).toBe(dir);
    assertContract(result);
  });

  it('无命中 → 2 条 PASS(middle)', async () => {
    const ctx = makeContext([ok(''), ok(''), ok(BINWALK_OUT)]);
    const result = await fwScan.execute({ firmwareFile: firmware }, ctx);

    const m = byClause(result.verdicts);
    expect(m['5.5-1'].pass).toBe(true);
    expect(m['5.5-3'].pass).toBe(true);
    assertContract(result);
  });

  it('binwalk 缺失 → 仍 status=success，并写入告警证据', async () => {
    const ctx = makeContext([
      ok(SECRET_HITS),
      ok(''),
      ok('', 127, 'binwalk: command not found'),
    ]);
    const result = await fwScan.execute({ firmwareFile: firmware }, ctx);

    expect(result.status).toBe('success');
    expect(result.evidence.some((e) => e.content.includes('binwalk 未安装'))).toBe(true);
    expect(byClause(result.verdicts)['5.5-1'].pass).toBe(false);
    assertContract(result);
  });

  it('strings 缺失 → status=fail，2 条 FAIL(high)', async () => {
    const ctx = makeContext([ok('', 127, 'strings: command not found')]);
    const result = await fwScan.execute({ firmwareFile: firmware }, ctx);

    expect(result.status).toBe('fail');
    expect(result.error?.code).toBe('STRINGS_UNAVAILABLE');
    for (const v of result.verdicts) {
      expect(v.pass).toBe(false);
      expect(v.severity).toBe('high');
    }
    assertContract(result);
  });

  it('scanDepth=full → 命令带 -a -n 4 与 head -1000', async () => {
    const ctx = makeContext([ok(''), ok(''), ok(BINWALK_OUT)]);
    await fwScan.execute({ firmwareFile: firmware, scanDepth: 'full' }, ctx);
    const cmd = ctx.engine.runCommand.mock.calls[0][0] as string;
    expect(cmd).toContain('strings -a -n 4');
    expect(cmd).toContain('head -1000');
  });
});

describe('en18031-firmware-secret-scan · 安全与异常分支', () => {
  it('文件不存在 → 拦截，不执行命令', async () => {
    const ctx = makeContext([ok(SECRET_HITS)]);
    const result = await fwScan.execute({ firmwareFile: join(dir, 'missing.bin') }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    expect(result.exitCode).toBe(2);
    expect(result.error?.message).toContain('不存在或不可读');
    assertContract(result);
  });

  it('路径含 shell 注入字符 → 拦截', async () => {
    const ctx = makeContext([ok(SECRET_HITS)]);
    const result = await fwScan.execute({ firmwareFile: `${firmware}'; rm -rf /tmp/x; '` }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    expect(result.error?.message).toContain('非法字符');
    assertContract(result);
  });

  it('相对路径 → 拦截', async () => {
    const ctx = makeContext([ok(SECRET_HITS)]);
    const result = await fwScan.execute({ firmwareFile: 'firmware.bin' }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    assertContract(result);
  });

  it('非法 scanDepth → 拦截', async () => {
    const ctx = makeContext([ok(SECRET_HITS)]);
    const result = await fwScan.execute({ firmwareFile: firmware, scanDepth: 'deep' }, ctx);
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    assertContract(result);
  });

  it('超时 → status=timeout，2 条 FAIL(middle)', async () => {
    const ctx = makeContext([
      { status: 'timeout', exitCode: 124, stdout: '', stderr: '', durationMs: 1 },
    ]);
    const result = await fwScan.execute({ firmwareFile: firmware }, ctx);
    expect(result.status).toBe('timeout');
    for (const v of result.verdicts) expect(v.severity).toBe('middle');
    assertContract(result);
  });

  it('runCommand 抛异常 → status=crash', async () => {
    const ctx = makeContext([
      () => {
        throw new Error('kaboom');
      },
    ]);
    const result = await fwScan.execute({ firmwareFile: firmware }, ctx);
    expect(result.status).toBe('crash');
    for (const v of result.verdicts) expect(v.severity).toBe('high');
    assertContract(result);
  });

  it('执行前已取消 → cancelled', async () => {
    const ctx = makeContext([ok('')], {
      cancelToken: { promise: new Promise<void>(() => {}), isRequested: true },
    });
    const result = await fwScan.execute({ firmwareFile: firmware }, ctx);
    expect(result.status).toBe('cancelled');
    expect(ctx.engine.runCommand).not.toHaveBeenCalled();
    assertContract(result);
  });
});
