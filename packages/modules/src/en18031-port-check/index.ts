import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { XMLParser } from 'fast-xml-parser';

import { isValidIp, isValidPortRange } from '@en18031/shared';
import type {
  BaseModule,
  ClauseVerdictOutput,
  Evidence,
  ExecutionError,
  ExecutionResult,
  ExecutionStatus,
  ModuleExecuteContext,
} from '@en18031/shared';

import config from './module.config.js';

/** 本模组声明并且必须全量返回的条款集合（多一条少一条都会被 SDK 契约校验拦截） */
export const CLAUSE_IDS = ['5.3-1', '5.3-2', '5.3-3', '5.3-5'] as const;

/** 合规白名单端口：仅允许加密管理通道 */
const WHITELIST_PORTS = [22, 443];
/** 服务发现类端口（UPnP / SSDP / mDNS / UPnP HTTP） */
const DISCOVERY_PORTS = [1900, 5353, 5000];

/** 端口范围只允许数字、逗号、连字符，任何其它字符一律视为注入尝试 */
const SAFE_PORT_RANGE = /^[0-9,-]+$/;
/** shell 元字符黑名单（双保险，防止 format 校验被绕过时拼进命令） */
const SHELL_META = /[;&|`$(){}<>\\'"\s\n\r*?!#~[\]]/;

export interface OpenPort {
  port: number;
  proto: string;
  service: string;
  version: string;
}

interface CommandOutcome {
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function pushEvidence(
  list: Evidence[],
  type: Evidence['type'],
  content: string,
  severity: Evidence['severity'] = 'low',
  path?: string,
): number {
  list.push(path ? { type, content, severity, path } : { type, content, severity });
  return list.length - 1;
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * 解析 nmap XML（-oX 输出）为开放端口列表。
 * XML 结构：<nmaprun><host><ports><port protocol="tcp" portid="22">
 *   <state state="open"/><service name="ssh" product="OpenSSH" version="9.0"/></port></ports></host></nmaprun>
 */
export function parseNmapXml(xml: string): OpenPort[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xml) as Record<string, any>;
  const run = doc?.nmaprun;
  if (!run) return [];
  const out: OpenPort[] = [];
  for (const host of toArray<Record<string, any>>(run.host)) {
    for (const portsNode of toArray<Record<string, any>>(host?.ports)) {
      for (const p of toArray<Record<string, any>>(portsNode?.port)) {
        const stateNode = Array.isArray(p?.state) ? p.state[0] : p?.state;
        const state = String(stateNode?.['@_state'] ?? 'open').toLowerCase();
        if (state !== 'open') continue;
        const port = Number(p?.['@_portid']);
        if (!Number.isFinite(port)) continue;
        const svcNode = Array.isArray(p?.service) ? p.service[0] : p?.service;
        const product = String(svcNode?.['@_product'] ?? '').trim();
        const ver = String(svcNode?.['@_version'] ?? '').trim();
        out.push({
          port,
          proto: String(p?.['@_protocol'] ?? 'tcp'),
          service: String(svcNode?.['@_name'] ?? '').trim(),
          version: [product, ver].filter(Boolean).join(' '),
        });
      }
    }
  }
  return out;
}

/** 兜底：解析 nmap 普通文本输出（`22/tcp open  ssh  OpenSSH 9.0`） */
export function parseNmapText(text: string): OpenPort[] {
  const out: OpenPort[] = [];
  const re = /^(\d{1,5})\/(tcp|udp)\s+open\s*(\S*)\s*(.*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const port = Number(m[1]);
    if (!Number.isFinite(port)) continue;
    out.push({
      port,
      proto: m[2],
      service: (m[3] ?? '').trim(),
      version: (m[4] ?? '').trim(),
    });
  }
  return out;
}

/** 自动识别 XML / 文本两种来源 */
export function parseOpenPorts(source: string): OpenPort[] {
  if (!source) return [];
  if (source.includes('<nmaprun') || source.includes('<ports')) {
    try {
      const ports = parseNmapXml(source);
      if (ports.length > 0) return ports;
    } catch {
      /* 落到文本解析 */
    }
  }
  return parseNmapText(source);
}

function isTelnetOpen(ports: OpenPort[]): boolean {
  return ports.some((p) => p.port === 23 || p.service.toLowerCase() === 'telnet');
}

/**
 * 明文 HTTP 判定。注意不能用 service.includes('http')，
 * 否则 https 会被误判为明文（文档骨架里的已知缺陷，此处修正）。
 */
function isPlainHttpOpen(ports: OpenPort[]): boolean {
  return ports.some((p) => {
    const svc = p.service.toLowerCase();
    if (svc === 'https' || svc === 'https-alt' || svc.startsWith('ssl')) return false;
    if (p.port === 443 || p.port === 8443) return false;
    return p.port === 80 || svc === 'http' || svc === 'http-alt' || svc === 'http-proxy';
  });
}

function hasSsh(ports: OpenPort[]): boolean {
  return ports.some((p) => p.port === 22 || p.service.toLowerCase().includes('ssh'));
}

function hasHttps(ports: OpenPort[]): boolean {
  return ports.some(
    (p) => p.port === 443 || p.port === 8443 || p.service.toLowerCase().includes('https'),
  );
}

function describe(p: OpenPort): string {
  return `${p.port}/${p.proto}(${p.service || 'unknown'}${p.version ? ' ' + p.version : ''})`;
}

class PortCheckModule implements BaseModule {
  readonly config = config;

  async execute(
    params: Record<string, unknown>,
    context: ModuleExecuteContext,
  ): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const evidence: Evidence[] = [];
    const verdicts: ClauseVerdictOutput[] = [];
    let stdoutAcc = '';
    let stderrAcc = '';
    let exitCode = 0;
    let status: ExecutionStatus = 'success';
    let error: ExecutionError | undefined;
    let tmpXml: string | undefined;

    const finish = (): ExecutionResult => {
      context.onProgress({
        percent: 100,
        message: `端口合规检测完成，共 ${verdicts.length} 条条款判定`,
      });
      return {
        runId: '',
        projectId: context.projectId,
        stepId: context.stepId,
        toolId: config.id,
        moduleId: config.id,
        status,
        exitCode,
        stdout: stdoutAcc,
        stderr: stderrAcc,
        durationMs: Date.now() - startedMs,
        startedAt,
        finishedAt: new Date().toISOString(),
        evidence,
        verdicts,
        error,
      };
    };

    const allClauses = (
      pass: boolean,
      severity: Evidence['severity'],
      reason: string,
      refs: number[],
    ): void => {
      for (const clauseId of CLAUSE_IDS) {
        verdicts.push({ clauseId, pass, severity, reason, evidenceRefs: refs });
      }
    };

    try {
      // ── 1. 参数读取 + 安全校验（核心层已做 format 校验，此处再做一次硬校验防注入） ──
      const targetIp = String(params.targetIp ?? '').trim();
      const portRange = String(params.portRange ?? '1-10000').trim();
      const scanTypeRaw = String(params.scanType ?? 'sS').trim();
      const includeServiceVersion = params.includeServiceVersion !== false;
      const timeoutMsRaw = Number(params.timeoutMs ?? 300000);
      const timeoutMs =
        Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : 300000;

      const businessErrors: string[] = [];
      if (!targetIp) businessErrors.push('targetIp 不能为空');
      else if (!isValidIp(targetIp)) businessErrors.push(`targetIp 不是合法的 IPv4 地址：${targetIp}`);
      if (!portRange) businessErrors.push('portRange 不能为空');
      else if (!SAFE_PORT_RANGE.test(portRange) || SHELL_META.test(portRange))
        businessErrors.push(`portRange 含非法字符（疑似命令注入）：${portRange}`);
      else if (!isValidPortRange(portRange))
        businessErrors.push(`portRange 不是合法的端口范围（如 1-65535 或 22,80,443）：${portRange}`);
      if (!['sS', 'sT', 'sU'].includes(scanTypeRaw))
        businessErrors.push(`scanType 只允许 sS/sT/sU，实际为：${scanTypeRaw}`);

      if (businessErrors.length > 0) {
        const idx = pushEvidence(
          evidence,
          'validation_error',
          `参数校验失败，未执行任何命令：${businessErrors.join('；')}`,
          'high',
        );
        status = 'fail';
        exitCode = 2;
        stderrAcc = businessErrors.join('\n');
        error = { code: 'VALIDATION_ERROR', message: businessErrors.join('；') };
        allClauses(false, 'high', `参数校验失败，未执行扫描：${businessErrors.join('；')}`, [idx]);
        return finish();
      }

      if (context.cancelToken.isRequested) {
        const idx = pushEvidence(evidence, 'assertion', '执行前已收到取消请求，未启动扫描', 'middle');
        status = 'cancelled';
        exitCode = 137;
        allClauses(false, 'middle', '扫描取消，结果未知，暂按不通过判定，建议补测', [idx]);
        return finish();
      }

      // ── 2. 构造 nmap 命令（所有变量已通过严格白名单校验） ──
      const scanFlag = scanTypeRaw === 'sS' ? '-sS' : scanTypeRaw === 'sT' ? '-sT' : '-sU';
      const svFlag = includeServiceVersion ? '-sV' : '';
      const safeStepId = context.stepId.replace(/[^A-Za-z0-9_-]/g, '_') || 'step';
      tmpXml = join(tmpdir(), `en18031-port-check-${safeStepId}-${Date.now()}.xml`);
      const command = [
        'nmap',
        scanFlag,
        svFlag,
        '-p',
        portRange,
        '--open',
        '-oX',
        tmpXml,
        targetIp,
      ]
        .filter(Boolean)
        .join(' ');

      context.onProgress({
        percent: 5,
        message: `开始端口扫描：${targetIp} 端口 ${portRange}`,
        logLine: `$ ${command}`,
      });

      // ── 3. 执行（与 cancelToken 竞速） ──
      const cmdResult = await Promise.race<CommandOutcome>([
        context.engine.runCommand(command, {
          timeoutMs,
          onProgress: (p) => {
            const elapsed = Date.now() - startedMs;
            const estPercent = Math.min(95, 10 + Math.floor((elapsed / timeoutMs) * 85));
            context.onProgress({
              percent: estPercent,
              message: `扫描进行中 ${estPercent}%`,
              logLine: p.logLine,
            });
          },
          cancelToken: context.cancelToken,
        }),
        context.cancelToken.promise.then<CommandOutcome>(() => ({
          status: 'cancelled',
          exitCode: 137,
          stdout: stdoutAcc,
          stderr: '用户取消执行',
          durationMs: Date.now() - startedMs,
        })),
      ]);

      stdoutAcc = cmdResult.stdout || '';
      stderrAcc = cmdResult.stderr || '';
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
        allClauses(
          false,
          'middle',
          `扫描${status === 'cancelled' ? '取消' : '超时'}，结果未知，暂按不通过判定，建议补测`,
          [idx],
        );
      } else if (status === 'fail') {
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `nmap 退出码 ${exitCode}：\nstderr:\n${stderrAcc.slice(-1000)}\nstdout tail:\n${stdoutAcc.slice(-1000)}`,
          'high',
        );
        allClauses(
          false,
          'high',
          `nmap 执行失败（exitCode=${exitCode}），无法判定合规性，默认不通过`,
          [idx],
        );
        error = {
          code: 'NMAP_EXIT_NONZERO',
          message: `nmap exitCode=${exitCode}`,
          stack: stderrAcc,
        };
      } else {
        // ── 4. 解析 XML → 逐条款判定 ──
        context.onProgress({ percent: 96, message: '解析 nmap 扫描结果' });

        let xmlSource = '';
        let xmlReadError = '';
        try {
          xmlSource = await readFile(tmpXml, 'utf8');
        } catch (e) {
          xmlReadError = e instanceof Error ? e.message : String(e);
          xmlSource = stdoutAcc; // 兜底：从 stdout 里解析（stdout 可能就是 XML 或普通文本）
        }

        const openPorts = parseOpenPorts(xmlSource);

        const rawOutputIdx = pushEvidence(
          evidence,
          'file_pointer',
          xmlReadError
            ? `XML 扫描结果预期落盘于 ${tmpXml}，读取失败（${xmlReadError}），已回退解析 stdout`
            : `XML 扫描结果：${tmpXml}（已落盘，内容哈希见审计）`,
          'low',
          tmpXml,
        );
        const stdoutTailIdx = pushEvidence(evidence, 'stdout_line', stdoutAcc.slice(-3000), 'low');
        const summaryIdx = pushEvidence(
          evidence,
          'assertion',
          openPorts.length > 0
            ? `共解析到 ${openPorts.length} 个开放端口：${openPorts.map(describe).join('，')}`
            : '未解析到任何开放端口',
          'low',
        );

        // 条款 5.3-2 明文管理协议 Telnet/HTTP 不得开放
        const telnetOpen = isTelnetOpen(openPorts);
        const httpOpen = isPlainHttpOpen(openPorts);
        if (telnetOpen || httpOpen) {
          const detail: string[] = [];
          if (telnetOpen) detail.push('检测到 23/Telnet 明文管理端口开放');
          if (httpOpen) detail.push('检测到 80/HTTP 明文管理协议开放');
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
            evidenceRefs: [idx, rawOutputIdx, summaryIdx],
          });
        }

        // 条款 5.3-1 不必要网络服务必须禁用（白名单：22/443）
        const unnecessaryPorts = openPorts.filter((p) => !WHITELIST_PORTS.includes(p.port));
        if (unnecessaryPorts.length > 0) {
          const idx = pushEvidence(
            evidence,
            'assertion',
            `检测到不必要端口开放：${unnecessaryPorts.map(describe).join('，')}`,
            'middle',
          );
          verdicts.push({
            clauseId: '5.3-1',
            pass: false,
            severity: 'middle',
            reason: `共 ${unnecessaryPorts.length} 个非必要端口开放，请逐一核实是否为业务必需`,
            evidenceRefs: [idx, rawOutputIdx, summaryIdx],
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
            evidenceRefs: [idx, rawOutputIdx, summaryIdx],
          });
        }

        // 条款 5.3-3 必须使用加密管理协议 SSH/HTTPS
        const ssh = hasSsh(openPorts);
        const https = hasHttps(openPorts);
        if (ssh || https) {
          const idx = pushEvidence(
            evidence,
            'assertion',
            `检测到加密管理通道：${[ssh ? '22/SSH' : '', https ? '443/HTTPS' : '']
              .filter(Boolean)
              .join('，')}`,
            'low',
          );
          verdicts.push({
            clauseId: '5.3-3',
            pass: true,
            severity: 'middle',
            reason:
              '至少存在一条加密管理协议通道（加密套件强度需结合 crypto-check 模组结果综合判定）',
            evidenceRefs: [idx, rawOutputIdx, summaryIdx],
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
            evidenceRefs: [idx, rawOutputIdx, summaryIdx],
          });
        }

        // 条款 5.3-5 UPnP/SSDP/MDNS 不得对外网暴露
        const upnpPorts = openPorts.filter((p) => DISCOVERY_PORTS.includes(p.port));
        if (upnpPorts.length > 0) {
          const idx = pushEvidence(
            evidence,
            'assertion',
            `检测到可能暴露的服务发现端口：${upnpPorts
              .map((p) => `${p.port}/${p.proto}`)
              .join('，')}，需核实是否仅内网可用`,
            'middle',
          );
          verdicts.push({
            clauseId: '5.3-5',
            pass: false,
            severity: 'middle',
            reason: `开放 ${upnpPorts.length} 个服务发现类端口，对外网暴露可能导致设备被发现和攻击`,
            evidenceRefs: [idx, rawOutputIdx, summaryIdx],
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
            evidenceRefs: [idx, rawOutputIdx, summaryIdx],
          });
        }
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'unknown error');
      status = 'crash';
      exitCode = exitCode || 1;
      stderrAcc = err.stack || err.message;
      error = { code: 'UNEXPECTED_CRASH', message: err.message, stack: err.stack };
      verdicts.length = 0;
      const idx = pushEvidence(
        evidence,
        'validation_error',
        `模组内部异常：${err.message}\n${err.stack || ''}`,
        'high',
      );
      allClauses(false, 'high', `模组崩溃，默认不通过：${err.message}`, [idx]);
    } finally {
      // 临时 XML 已在上面读取完毕，此处清理（不影响 evidence 中的 file_pointer 记录）
      if (tmpXml) {
        try {
          await unlink(tmpXml);
        } catch {
          /* 文件可能本就不存在，忽略 */
        }
      }
    }

    return finish();
  }
}

export default new PortCheckModule();
