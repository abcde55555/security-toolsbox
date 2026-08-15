# EN18031 合规测试平台 · 内置模组 SDK 示例：端口合规检测（en18031-port-check）

> **文档版本**：v1.0
> **产出日期**：2026-08-15
> **适用读者**：合规模组开发工程师（首个内置模组仿写参考）、SDK 契约维护者、Milestone 1 验收执行人员
> **读完后你能做的事**：照着本骨架创建一个新的内置模组、正确实现 execute 方法、正确收集 evidence 与 verdicts、正确处理 cancelToken、正确映射 EN18031 条款、跑 Milestone 1 集成测试验收用例。

## 1. 本模组业务目标与条款覆盖

1. 模组 id 固定为 en18031-port-check，版本 semver 1.0.0，用于检测目标设备暴露的网络端口是否符合 EN18031 对"不必要网络服务必须禁用、明文管理协议不得开放、加密管理协议必须使用"的合规要求。本模组是表单交互型（interactionMode=form），用户填 IP/端口范围/超时即可执行，不需要手动拼 nmap 命令。

2. 本模组覆盖的 EN18031 条款（与 04-Clause-Mapping 文档种子数据一一对应，clauseId 拼写完全一致，拼写不一致会被校验器拦截）。条款 5.3-1 所有不必要网络服务必须禁用；条款 5.3-2 明文管理协议 Telnet/HTTP 不得开放；条款 5.3-3 必须使用加密管理协议 SSH/HTTPS；条款 5.3-5 UPnP/SSDP/MDNS 等服务不得对外网暴露。每条条款的默认严重度与条款库保持一致，模组内可以覆盖但建议不要覆盖，保持一处真源（条款库）。

3. 本模组内部执行流程。用户填参数后，模组内部构造 `nmap -sS -sV -p <portRange> --open -oX <tmpXml> <targetIp>` 命令（SYN 半开扫描 + 服务版本探测 + 只显示开放端口 + XML 输出便于解析）；通过 `context.engine.runCommand` 调用同一套命令执行通道（复用日志、取消令牌、健康检查、审计）；命令完成后解析 nmap XML 输出，逐端口判定，收集 evidence，生成每条 verdict。

## 2. 模组文件结构与 module.config 完整示例

1. 每个模组放在 packages/modules/en18031-port-check/ 目录下，固定三个文件：module.config.ts（配置声明，不能有任何运行时副作用，必须能被静态分析直接 JSON.stringify）、index.ts（实现 BaseModule 接口）、README.md（模组说明、条款覆盖、常见问题、判定规则解释）。此外如有纯逻辑（端口判定规则、nmap XML 解析）建议拆到 src 子目录，便于单独写单元测试。

2. module.config.ts 的完整 TypeScript 源码。注意所有字段名、枚举值、字段类型都必须与 03-Module-SDK 文档完全一致，少字段或错枚举会被 ModuleLoader 在加载时拦截。formFields 中每个字段的 format 取值（plain/ip/cidr/port-range）是平台通用校验器的强约束，不要自定义新 format 值。healthCheck.command 中写 `nmap --version`，启动时健康检查 worker 会跑这条命令验证 nmap 可用性。

```typescript
// packages/modules/en18031-port-check/module.config.ts
import type { ModuleConfig } from '@en18031/shared';

const config: ModuleConfig = {
  id: 'en18031-port-check',
  name: '端口合规检测',
  version: '1.0.0',
  type: 'module',
  interactionMode: 'form',
  author: 'EN18031 Core Team',
  description:
    '基于 nmap SYN 扫描 + 服务版本探测，检测目标开放端口是否符合 EN18031 第 5.3 节网络安全要求，自动判定 4 条核心条款。',
  tags: ['EN18031-ch5', '网络扫描', '非破坏性', '端口合规'],
  category: 'network-compliance',
  healthCheck: {
    command: 'nmap --version',
    timeoutMs: 5000,
  },
  formFields: [
    {
      id: 'targetIp',
      label: '目标 IP 地址',
      type: 'text',
      placeholder: '例如 192.168.1.100',
      required: true,
      format: 'ip',
      description: '需要做端口合规检测的单个设备 IPv4 地址。批量多目标请用模板编排的 for_each_json 展开或多个目标顺序执行。',
    },
    {
      id: 'portRange',
      label: '端口范围',
      type: 'text',
      value: '1-10000',
      required: true,
      format: 'port-range',
      description: '支持 nmap 语法：单端口 22、段 1-65535、列表 22,80,443；默认建议至少覆盖 1-10000 的常见服务端口。',
    },
    {
      id: 'scanType',
      label: '扫描类型',
      type: 'select',
      value: 'sS',
      options: [
        { label: 'SYN 半开扫描（推荐，快且不建立完整连接）', value: 'sS' },
        { label: 'Connect 全连接扫描（无需 root，较慢）', value: 'sT' },
        { label: 'UDP 扫描（慢，覆盖 5.3-5 UPnP/SSDP UDP 端口时选）', value: 'sU' },
      ],
      description: 'SYN 扫描需要 root / 管理员权限，如无权限可切换为 Connect，但检测完整性略差。',
    },
    {
      id: 'timeoutMs',
      label: '扫描超时（毫秒）',
      type: 'number',
      value: 300000,
      min: 60000,
      max: 3600000,
      description: '单步 nmap 执行的最长允许时间，超时后模组主动 kill 并标记 status=timeout。',
    },
    {
      id: 'includeServiceVersion',
      label: '包含服务版本探测',
      type: 'checkbox',
      value: true,
      description: '勾选后加 -sV 参数，识别端口上运行的具体服务名和版本号，用于 5.3-2/5.3-3 的精确判定；建议保持勾选。',
    },
  ],
  clauses: [
    { clauseId: '5.3-1', title: '不必要网络服务必须禁用', severity: 'middle' },
    { clauseId: '5.3-2', title: '明文管理协议 Telnet/HTTP 不得开放', severity: 'high' },
    { clauseId: '5.3-3', title: '必须使用加密管理协议 SSH/HTTPS', severity: 'middle' },
    { clauseId: '5.3-5', title: 'UPnP/SSDP/MDNS 不得对外网暴露', severity: 'middle' },
  ],
};

export default config;
```

## 3. BaseModule 实现骨架（index.ts 完整可运行代码结构）

1. 实现原则。所有异步操作显式处理 cancelToken；所有异常 try/catch 包起来后转换为标准 ExecutionResult 返回（不能让未捕获异常冒泡到核心层，核心层视为 crash 且会写 SDK 契约警告）；evidence 与 verdicts 一一对应，每条 verdict 至少引用一个 evidence 的下标。

2. 完整 index.ts 骨架代码（业务判定逻辑用注释占位，实际模组按甲方 EN18031 条款细则填充）。

```typescript
// packages/modules/en18031-port-check/index.ts
import config from './module.config';
import type {
  BaseModule,
  ExecutionResult,
  Evidence,
  ClauseVerdict,
  ModuleExecuteContext,
  PortCheckParams, // 按 formFields 生成的参数类型，可在 shared 中定义或用 zod infer
} from '@en18031/shared';

// 辅助：安全地读取某行 nmap 输出作为证据，自动写入 evidence 数组并返回下标
function pushEvidence(
  list: Evidence[],
  type: Evidence['type'],
  content: string,
  severity: Evidence['severity'] = 'low',
): number {
  list.push({
    type,
    content,
    severity,
  });
  return list.length - 1;
}

class PortCheckModule implements BaseModule {
  readonly config = config;

  async execute(params: PortCheckParams, context: ModuleExecuteContext): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const evidence: Evidence[] = [];
    const verdicts: ClauseVerdict[] = [];
    let stdoutAcc = '';
    let exitCode = 0;
    let status: ExecutionResult['status'] = 'success';
    let error: ExecutionResult['error'] | undefined;

    try {
      // 1. 业务级参数二次校验（核心层已做 format 校验，这里做语义校验）
      const businessErrors: string[] = [];
      // 例：如果 scanType=sS，SYN 扫描需要 root；可以通过 context.engine.runCommand('id -u') 预检查；此处省略具体检查代码
      if (businessErrors.length > 0) {
        const idx = pushEvidence(
          evidence,
          'validation_error',
          `参数校验失败：${businessErrors.join('；')}`,
          'high',
        );
        return {
          status: 'fail',
          exitCode: 2,
          stdout: stdoutAcc,
          stderr: businessErrors.join('\n'),
          durationMs: Date.now() - new Date(startedAt).getTime(),
          startedAt,
          finishedAt: new Date().toISOString(),
          evidence,
          verdicts: [
            {
              clauseId: '5.3-1',
              pass: false,
              severity: 'high',
              reason: `参数校验失败，未执行扫描：${businessErrors.join('；')}`,
              evidenceRefs: [idx],
            },
          ],
          error: { code: 'VALIDATION_ERROR', message: businessErrors.join('；') },
        };
      }

      // 2. 构造 nmap 命令（严格校验 params.portRange 经 format=port-range 校验后是安全的，无 shell 注入）
      const scanFlag =
        params.scanType === 'sS' ? '-sS' : params.scanType === 'sT' ? '-sT' : '-sU';
      const svFlag = params.includeServiceVersion ? '-sV' : '';
      const tmpXml = `/tmp/en18031-port-check-${context.stepId}-${Date.now()}.xml`;
      const command = `nmap ${scanFlag} ${svFlag} -p ${params.portRange} --open -oX ${tmpXml} ${params.targetIp}`;

      context.onProgress({
        percent: 5,
        message: `开始端口扫描：${params.targetIp} 端口 ${params.portRange}`,
        logLine: `$ ${command}`,
      });

      // 3. 调 engine.runCommand 执行（复用统一日志、取消令牌、超时、审计）
      const cmdResult = await Promise.race([
        context.engine.runCommand(command, {
          timeoutMs: params.timeoutMs,
          onProgress: (p) => {
            // nmap 没有内置进度，这里按超时时间线性估算兜底；更精确的做法是解析 --stats-every 输出，Milestone 3 再优化
            const elapsed = Date.now() - new Date(startedAt).getTime();
            const estPercent = Math.min(
              95,
              10 + Math.floor((elapsed / params.timeoutMs) * 85),
            );
            context.onProgress({
              percent: estPercent,
              message: p.logLine ? '扫描中…' : `扫描进行中 ${estPercent}%`,
              logLine: p.logLine,
            });
          },
        }),
        context.cancelToken.promise.then(() => ({
          status: 'cancelled' as const,
          exitCode: 137,
          stdout: stdoutAcc,
          stderr: '用户取消执行',
          durationMs: Date.now() - new Date(startedAt).getTime(),
        })),
      ]);

      stdoutAcc = cmdResult.stdout || '';
      exitCode = cmdResult.exitCode ?? exitCode;
      status =
        cmdResult.status === 'cancelled'
          ? 'cancelled'
          : cmdResult.status === 'timeout'
          ? 'timeout'
          : exitCode === 0
          ? 'success'
          : 'fail';

      if (status === 'cancelled' || status === 'timeout') {
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `扫描被${status === 'cancelled' ? '用户取消' : '超时中断'}，nmap 输出：\n${stdoutAcc.slice(-2000)}`,
          'middle',
        );
        verdicts.push(
          ...(['5.3-1', '5.3-2', '5.3-3', '5.3-5'] as const).map((c) => ({
            clauseId: c,
            pass: false,
            severity: 'middle' as const,
            reason: `扫描${status === 'cancelled' ? '取消' : '超时'}，结果未知，暂按不通过判定，建议补测`,
            evidenceRefs: [idx],
          })),
        );
      } else if (status === 'fail') {
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `nmap 退出码 ${exitCode}：\nstderr:\n${cmdResult.stderr}\nstdout tail:\n${stdoutAcc.slice(-1000)}`,
          'high',
        );
        verdicts.push(
          ...(['5.3-1', '5.3-2', '5.3-3', '5.3-5'] as const).map((c) => ({
            clauseId: c,
            pass: false,
            severity: 'high' as const,
            reason: `nmap 执行失败（exitCode=${exitCode}），无法判定合规性，默认不通过`,
            evidenceRefs: [idx],
          })),
        );
        error = {
          code: 'NMAP_EXIT_NONZERO',
          message: `nmap exitCode=${exitCode}`,
          stack: cmdResult.stderr,
        };
      } else {
        // 4. 扫描成功 → 解析 XML → 按条款做业务判定（这部分是模组核心逻辑，需按甲方细则精化）
        //    此处给出骨架结构，不实现具体正则/解析，避免示例误用于生产
        context.onProgress({ percent: 96, message: '解析 nmap 扫描结果' });

        const rawOutputIdx = pushEvidence(
          evidence,
          'file_pointer',
          `XML 扫描结果：${tmpXml}（已落盘，内容哈希见审计）`,
          'low',
        );
        const stdoutTailIdx = pushEvidence(
          evidence,
          'stdout_line',
          stdoutAcc.slice(-3000),
          'low',
        );

        // —————— 以下是示例判定逻辑占位，实际开发时用 XML 解析库（fast-xml-parser）解析后替换 ——————
        // 解析出 openPorts：[{ port: 23, proto: 'tcp', service: 'telnet', version: '' }, ...]
        const openPorts: Array<{ port: number; proto: string; service: string; version: string }> =
          []; // TODO: 解析 tmpXml 填充

        // 条款 5.3-2 明文管理协议判定：23/telnet 或 80/http 开放 → fail
        const telnetOpen = openPorts.some((p) => p.port === 23 || p.service === 'telnet');
        const httpMgmtOpen = openPorts.some(
          (p) => p.port === 80 || p.service?.toLowerCase().includes('http'),
        );
        if (telnetOpen || httpMgmtOpen) {
          const detail = [];
          if (telnetOpen) detail.push('检测到 23/Telnet 明文管理端口开放');
          if (httpMgmtOpen) detail.push('检测到 80/HTTP 明文管理协议开放');
          const idx = pushEvidence(evidence, 'assertion', detail.join('；'), 'high');
          verdicts.push({
            clauseId: '5.3-2',
            pass: false,
            severity: 'high',
            reason: detail.join('；'),
            evidenceRefs: [idx, rawOutputIdx, stdoutTailIdx],
          });
        } else {
          const idx = pushEvidence(
            evidence,
            'assertion',
            '未检测到 23/Telnet 或 80/HTTP 明文管理端口开放',
            'low',
          );
          verdicts.push({
            clauseId: '5.3-2',
            pass: true,
            severity: 'middle',
            reason: '常见明文管理端口均未开放',
            evidenceRefs: [idx, rawOutputIdx],
          });
        }

        // 条款 5.3-1 不必要网络服务：示例定义"非 22/443 以外的知名管理类端口开放"即判定 fail，具体规则由合规评审签字
        const unnecessaryPorts = openPorts.filter(
          (p) => !([22, 443].includes(p.port)),
        );
        if (unnecessaryPorts.length > 0) {
          const idx = pushEvidence(
            evidence,
            'assertion',
            `检测到不必要端口开放：${unnecessaryPorts.map((p) => `${p.port}/${p.proto}(${p.service})`).join('，')}`,
            'middle',
          );
          verdicts.push({
            clauseId: '5.3-1',
            pass: false,
            severity: 'middle',
            reason: `共 ${unnecessaryPorts.length} 个非必要端口开放，请逐一核实是否为业务必需`,
            evidenceRefs: [idx, rawOutputIdx],
          });
        } else {
          const idx = pushEvidence(
            evidence,
            'assertion',
            `开放端口均为白名单内（仅 ${openPorts.map((p) => p.port).join(',') || '无'}）`,
            'low',
          );
          verdicts.push({
            clauseId: '5.3-1',
            pass: true,
            severity: 'middle',
            reason: '未检测到不必要的网络服务端口',
            evidenceRefs: [idx, rawOutputIdx],
          });
        }

        // 条款 5.3-3 加密管理协议：至少 22/SSH 或 443/HTTPS 之一存在，且版本不能是 SSLv3 等弱加密（弱加密判定属于 crypto-check 模组，这里只判"是否有加密通道"）
        const hasSsh = openPorts.some((p) => p.port === 22 || p.service?.toLowerCase().includes('ssh'));
        const hasHttps = openPorts.some(
          (p) => p.port === 443 || p.service?.toLowerCase().includes('https'),
        );
        if (hasSsh || hasHttps) {
          const idx = pushEvidence(
            evidence,
            'assertion',
            `检测到加密管理通道：${[hasSsh && '22/SSH', hasHttps && '443/HTTPS'].filter(Boolean).join('，')}`,
            'low',
          );
          verdicts.push({
            clauseId: '5.3-3',
            pass: true,
            severity: 'middle',
            reason: '至少存在一条加密管理协议通道（加密套件强度需结合 crypto-check 模组结果综合判定）',
            evidenceRefs: [idx, rawOutputIdx],
          });
        } else {
          const idx = pushEvidence(
            evidence,
            'assertion',
            '未检测到 22/SSH 或 443/HTTPS 加密管理通道',
            'high',
          );
          verdicts.push({
            clauseId: '5.3-3',
            pass: false,
            severity: 'high',
            reason: '设备未开放任何加密管理端口，存在明文管理或无法远程管理的风险',
            evidenceRefs: [idx, rawOutputIdx],
          });
        }

        // 条款 5.3-5 UPnP/SSDP/MDNS：1900/UDP、5353/UDP、5000/TCP 开放 → fail
        const upnpPorts = openPorts.filter((p) =>
          [1900, 5353, 5000].includes(p.port),
        );
        if (upnpPorts.length > 0) {
          const idx = pushEvidence(
            evidence,
            'assertion',
            `检测到可能暴露的服务发现端口：${upnpPorts.map((p) => `${p.port}/${p.proto}`).join('，')}，需核实是否仅内网可用`,
            'middle',
          );
          verdicts.push({
            clauseId: '5.3-5',
            pass: false,
            severity: 'middle',
            reason: `开放 ${upnpPorts.length} 个服务发现类端口，对外网暴露可能导致设备被发现和攻击`,
            evidenceRefs: [idx, rawOutputIdx],
          });
        } else {
          const idx = pushEvidence(
            evidence,
            'assertion',
            '未检测到 UPnP(1900)/SSDP/MDNS(5353) 等典型服务发现端口开放',
            'low',
          );
          verdicts.push({
            clauseId: '5.3-5',
            pass: true,
            severity: 'middle',
            reason: '常见服务发现端口均未开放',
            evidenceRefs: [idx, rawOutputIdx],
          });
        }
        // —————— 示例判定逻辑占位结束 ——————
      }
    } catch (e: unknown) {
      // 兜底：任何异常 → 统一包装为 crash 返回，不让核心层抛
      const err =
        e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'unknown error');
      status = 'crash';
      exitCode = exitCode || 1;
      error = {
        code: 'UNEXPECTED_CRASH',
        message: err.message,
        stack: err.stack,
      };
      const idx = pushEvidence(
        evidence,
        'validation_error',
        `模组内部异常：${err.message}\n${err.stack || ''}`,
        'high',
      );
      verdicts.push(
        ...(['5.3-1', '5.3-2', '5.3-3', '5.3-5'] as const).map((c) => ({
          clauseId: c,
          pass: false,
          severity: 'high' as const,
          reason: `模组崩溃，默认不通过：${err.message}`,
          evidenceRefs: [idx],
        })),
      );
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(startedAt).getTime();
    context.onProgress({
      percent: 100,
      message: `端口合规检测完成，共 ${verdicts.length} 条条款判定`,
    });

    return {
      status,
      exitCode,
      stdout: stdoutAcc,
      stderr: error?.stack || '',
      durationMs,
      startedAt,
      finishedAt,
      evidence,
      verdicts,
      error,
    };
  }
}

export default new PortCheckModule();
```

## 4. 模组单测示例（验证契约合规性）

1. 单元测试重点放在"判定逻辑"，不需要真实 nmap。做法是 mock context.engine.runCommand 返回预设的 nmap 输出，断言 evidence 和 verdicts 的数量、内容、映射关系正确。下面给出一个骨架测试用 port-check.test.ts，实际模组每个判定分支（4 条条款 × 至少 pass/fail 两分支 + timeout/cancelled/crash 三分支）都要有一条对应用例。

```typescript
// packages/modules/en18031-port-check/__tests__/port-check.test.ts
import PortCheckModule from '../index';

describe('en18031-port-check', () => {
  const baseContext = (overrides: Partial<any> = {}) => ({
    projectId: 'proj-1',
    stepId: 'step-port-check',
    userId: 'user-admin',
    variables: { targetIp: '192.168.1.100' },
    onProgress: jest.fn(),
    cancelToken: { promise: new Promise(() => {}), isRequested: false },
    engine: {
      runCommand: jest.fn().mockResolvedValue({
        status: 'success',
        exitCode: 0,
        stdout: 'Nmap scan report for 192.168.1.100\n22/tcp open ssh\n443/tcp open https',
        stderr: '',
      }),
    },
    ...overrides,
  });

  it('仅开放 22/443 → 5.3-1/5.3-2/5.3-3/5.3-5 四条全部 PASS', async () => {
    const result = await PortCheckModule.execute(
      {
        targetIp: '192.168.1.100',
        portRange: '1-10000',
        scanType: 'sT',
        timeoutMs: 120000,
        includeServiceVersion: true,
      },
      baseContext(),
    );
    expect(result.status).toBe('success');
    expect(result.verdicts).toHaveLength(4);
    const byClause = Object.fromEntries(
      result.verdicts.map((v) => [v.clauseId, v]),
    );
    expect(byClause['5.3-2'].pass).toBe(true);
    expect(byClause['5.3-2'].evidenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(byClause['5.3-1'].pass).toBe(true);
    expect(byClause['5.3-3'].pass).toBe(true);
    expect(byClause['5.3-5'].pass).toBe(true);
  });

  it('开放 23/telnet → 5.3-2 FAIL 且 severity=high', async () => {
    const ctx = baseContext();
    ctx.engine.runCommand.mockResolvedValueOnce({
      status: 'success',
      exitCode: 0,
      stdout: '22/tcp open ssh\n23/tcp open telnet\n443/tcp open https',
      stderr: '',
    });
    const result = await PortCheckModule.execute(
      { targetIp: '192.168.1.101', portRange: '1-100', scanType: 'sT', timeoutMs: 60000, includeServiceVersion: true },
      ctx,
    );
    const fail532 = result.verdicts.find((v) => v.clauseId === '5.3-2')!;
    expect(fail532.pass).toBe(false);
    expect(fail532.severity).toBe('high');
  });

  it('cancelToken 触发 → status=cancelled，4 条条款暂按 FAIL 标记为"未执行"', async () => {
    let resolveCancel: () => void;
    const cancelPromise = new Promise<void>((r) => (resolveCancel = r));
    const ctx = baseContext({
      cancelToken: { promise: cancelPromise, isRequested: true },
      engine: {
        runCommand: jest.fn().mockImplementation(() => {
          setTimeout(resolveCancel!, 50);
          return new Promise(() => {}); // 永不 resolve，模拟被 cancel 打断
        }),
      },
    });
    const result = await PortCheckModule.execute(
      { targetIp: '192.168.1.102', portRange: '1-65535', scanType: 'sT', timeoutMs: 600000, includeServiceVersion: true },
      ctx,
    );
    expect(result.status).toBe('cancelled');
  });
});
```

## 5. 开发本模组时的常见坑与自检清单

1. 坑 1：直接用 `child_process.spawn` 起 nmap，绕过 engine.runCommand。后果是日志不写入审计、取消令牌不生效、执行超时后进程泄漏。自检：全局搜索 packages/modules/*/index.ts 的 `require('child_process')` 或 `import.*child_process`，禁止直接出现；必须使用的要在 README 写明理由并手动注册 cancelToken 回调。

2. 坑 2：verdict.evidenceRefs 是空数组。后果是被 ClauseMappingService 自动降级为 fail+high，并且写 SDK 契约警告。自检：每条测试断言 `expect(v.evidenceRefs.length).toBeGreaterThanOrEqual(1)`，CI 扫描所有模组的 verdicts 引用下标范围不能越界（必须 < evidence.length）。

3. 坑 3：verdict.clauseId 拼写错误或写成数字。后果是条款库找不到 → 被视为 SDK 契约违规 → ExecutionResult 校验拦截 → status=crash。自检：config.clauses 数组声明的 clauseId 必须与实际返回 verdict.clauseId 的集合完全一致（多了少了都不行），写一条测试用 Object.keys 对比。

4. 坑 4：execute 方法抛出未捕获异常。后果是核心层当作 crash，4 条条款默认全 fail+high，但证据链可能不完整。自检：每个模组的 execute 方法必须有最外层 try/catch 兜底，并写一条对应单元测试（mock runCommand 抛异常，断言返回 status=crash 而不是 Promise reject）。

5. 坑 5：params.portRange 直接字符串拼命令导致 shell 注入风险。虽然核心层 formFields.format=port-range 会校验格式，但模组内部要再次确认参数不包含 `;`、`$()`、反引号等危险字符，或者使用数组形式传参让 node-pty 不经过 shell 解析。自检：写一条参数为 `22; rm -rf /tmp/test` 的测试，断言命令被校验拦截而不是实际执行。

6. 坑 6：pass=true 的 verdict 写了 severity=high。后果是被 SDK 契约校验强制改为 middle，并留警告日志（虽然不会导致 crash 但会污染契约警告统计）。自检：所有 pass=true 的 verdict 用例断言 `v.severity === 'low' || v.severity === 'middle'`。

## 6. 与 Milestone 1 验收用例的对接

1. 本模组作为 Milestone 1 的验收交付物，必须通过《09-测试策略》文档"Milestone 1 地基验收"的集成用例 1-1：真实环境下 `ExecutionEngine.runModule('en18031-port-check', params)` 跑一个实际可达目标，断言 status=success、verdict 至少包含 5.3-2、evidence 数组非空。对接前本地先自己跑一次，把该用例的输出保存到 `packages/modules/en18031-port-check/__fixtures__/milestone1-acceptance-sample.json`，作为后续回归的对照基线。

2. 每次本模组代码改动、升级 nmap 版本、或调整判定规则时，都必须重新跑一次条款准确度测试（参考 09-Testing 文档第 5 节端口合规模组 5 台目标的对照测试），确保判定结果与手动测试基线的哈希不变，除非有对应的变更审批记录。
