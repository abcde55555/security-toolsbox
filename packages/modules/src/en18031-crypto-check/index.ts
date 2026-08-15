import { isValidIp } from '@en18031/shared';
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

/** 本模组声明并且必须全量返回的条款集合 */
export const CLAUSE_IDS = ['5.4-1', '5.4-2'] as const;

/** shell 元字符黑名单（双保险） */
const SHELL_META = /[;&|`$(){}<>\\'"\s\n\r*?!#~[\]]/;

interface WeakPattern {
  kind: 'cipher' | 'protocol';
  label: string;
  match: (tokens: string[]) => boolean;
}

const has = (tokens: string[], ...names: string[]): boolean =>
  names.some((n) => tokens.includes(n));

/**
 * 弱加密套件特征库。判定基于「按非字母数字切分出的 token 集合」，
 * 而不是裸正则，避免 `TLS_RSA_WITH_DES_CBC_SHA` 这类下划线分隔写法漏检、
 * 以及 `AES_128_CBC_SHA256` 被 CBC-SHA1 规则误检。
 */
const WEAK_PATTERNS: WeakPattern[] = [
  { kind: 'cipher', label: 'RC4 流密码', match: (t) => has(t, 'RC4', 'RC4128', 'RC440') },
  {
    kind: 'cipher',
    label: '3DES（有效强度不足 112bit，Sweet32）',
    match: (t) => has(t, '3DES', 'EDE3', 'DESEDE3'),
  },
  {
    kind: 'cipher',
    label: '单 DES（56bit）',
    match: (t) => has(t, 'DES', 'DES40') && !has(t, '3DES', 'EDE3', 'DESEDE3'),
  },
  {
    kind: 'cipher',
    label: 'CBC + SHA1/SHA(MAC) 套件（Lucky13/BEAST）',
    match: (t) => has(t, 'CBC') && has(t, 'SHA', 'SHA1'),
  },
  { kind: 'cipher', label: 'NULL 加密/认证', match: (t) => has(t, 'NULL') },
  { kind: 'cipher', label: 'EXPORT 级弱密钥', match: (t) => has(t, 'EXPORT', 'EXP') },
  {
    kind: 'cipher',
    label: '匿名密钥交换（无身份认证）',
    match: (t) => has(t, 'ANON', 'ADH', 'AECDH', 'DHANON', 'ECDHANON'),
  },
];

const WEAK_PROTOCOL_RE = /^\s*\|?\s*(SSLv2|SSLv3|TLSv1\.0|TLSv1\.1)\s*:/i;

function tokenize(line: string): string[] {
  return line
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toUpperCase());
}

export interface WeakFinding {
  kind: 'cipher' | 'protocol';
  label: string;
  line: string;
}

export interface CertInfo {
  reachable: boolean;
  notBefore?: string;
  notAfter?: string;
  subject?: string;
  issuer?: string;
  serial?: string;
  selfSigned: boolean;
  expired: boolean;
  notYetValid: boolean;
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
): number {
  list.push({ type, content, severity });
  return list.length - 1;
}

/** 只保留 nmap NSE 脚本输出行（以 `|` 开头），避免在无关文本上误报 */
function scriptLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => /^\s*\|/.test(l))
    .map((l) => l.trimEnd());
}

/** 从 nmap ssl-enum-ciphers 输出中提取弱套件 / 弱协议 */
export function detectWeakCrypto(nmapOutput: string): {
  findings: WeakFinding[];
  hasCipherInfo: boolean;
  protocols: string[];
} {
  const lines = scriptLines(nmapOutput);
  const hasCipherInfo =
    lines.length > 0 && /ssl-enum-ciphers/i.test(nmapOutput) && /ciphers|TLSv|SSLv/i.test(nmapOutput);
  const findings: WeakFinding[] = [];
  const protocols: string[] = [];
  const seen = new Set<string>();
  // nmap 的 ssl-enum-ciphers 按 `ciphers:` / `compressors:` 分段输出，
  // `compressors:` 下的 `NULL` 表示未启用压缩（属于安全配置），必须排除，否则每个目标都会误报。
  let section: 'ciphers' | 'compressors' | 'other' | 'none' = 'none';

  for (const line of lines) {
    const sec = /^\s*\|_?\s*(ciphers|compressors|cipher preference|warnings)\s*:/i.exec(line);
    if (sec) {
      const name = sec[1].toLowerCase();
      section = name === 'ciphers' ? 'ciphers' : name === 'compressors' ? 'compressors' : 'other';
      continue;
    }
    const proto = WEAK_PROTOCOL_RE.exec(line);
    if (proto) {
      const label = `已启用不安全协议版本 ${proto[1]}`;
      if (!protocols.includes(proto[1])) protocols.push(proto[1]);
      const key = `protocol:${proto[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ kind: 'protocol', label, line: line.trim() });
      }
      continue;
    }
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    // 只在套件段、或明显是套件名的行上做弱算法匹配
    const isCipherLine = section === 'ciphers' || /(?:TLS|SSL)[_-][A-Za-z0-9]/.test(line);
    if (!isCipherLine || section === 'compressors') continue;
    for (const p of WEAK_PATTERNS) {
      if (!p.match(tokens)) continue;
      const key = `${p.kind}:${p.label}:${line.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ kind: p.kind, label: p.label, line: line.trim() });
    }
  }
  return { findings, hasCipherInfo, protocols };
}

/** 解析 `openssl x509 -noout -dates -subject -issuer -serial` 的输出 */
export function parseCertInfo(opensslOutput: string): CertInfo {
  const text = (opensslOutput || '').trim();
  if (!text) {
    return { reachable: false, selfSigned: false, expired: false, notYetValid: false };
  }
  const grab = (key: string): string | undefined => {
    const m = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'im').exec(text);
    return m ? m[1].trim() : undefined;
  };
  const notBefore = grab('notBefore');
  const notAfter = grab('notAfter');
  const subject = grab('subject');
  const issuer = grab('issuer');
  const serial = grab('serial');

  if (!notBefore && !notAfter && !subject) {
    return { reachable: false, selfSigned: false, expired: false, notYetValid: false };
  }

  const norm = (s?: string): string => (s ?? '').replace(/\s+/g, '').replace(/^\//, '').toLowerCase();
  const now = Date.now();
  const afterMs = notAfter ? Date.parse(notAfter) : NaN;
  const beforeMs = notBefore ? Date.parse(notBefore) : NaN;

  return {
    reachable: true,
    notBefore,
    notAfter,
    subject,
    issuer,
    serial,
    selfSigned: Boolean(subject && issuer && norm(subject) === norm(issuer)),
    expired: Number.isFinite(afterMs) ? afterMs < now : false,
    notYetValid: Number.isFinite(beforeMs) ? beforeMs > now : false,
  };
}

class CryptoCheckModule implements BaseModule {
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

    const finish = (): ExecutionResult => {
      context.onProgress({
        percent: 100,
        message: `加密传输合规检测完成，共 ${verdicts.length} 条条款判定`,
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
      // ── 1. 参数校验 ──
      const targetIp = String(params.targetIp ?? '').trim();
      const portRaw = Number(params.port ?? 443);
      const timeoutRaw = Number(params.timeoutMs ?? 30000);
      const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 30000;

      const errs: string[] = [];
      if (!targetIp) errs.push('targetIp 不能为空');
      else if (!isValidIp(targetIp)) errs.push(`targetIp 不是合法的 IPv4 地址：${targetIp}`);
      if (!Number.isInteger(portRaw) || portRaw < 1 || portRaw > 65535)
        errs.push(`port 必须是 1-65535 的整数，实际为：${String(params.port)}`);
      if (SHELL_META.test(String(params.port ?? '')))
        errs.push('port 含非法字符（疑似命令注入）');

      if (errs.length > 0) {
        const idx = pushEvidence(
          evidence,
          'validation_error',
          `参数校验失败，未执行任何命令：${errs.join('；')}`,
          'high',
        );
        status = 'fail';
        exitCode = 2;
        stderrAcc = errs.join('\n');
        error = { code: 'VALIDATION_ERROR', message: errs.join('；') };
        allClauses(false, 'high', `参数校验失败，未执行检测：${errs.join('；')}`, [idx]);
        return finish();
      }
      const port = portRaw;

      if (context.cancelToken.isRequested) {
        const idx = pushEvidence(evidence, 'assertion', '执行前已收到取消请求，未启动检测', 'middle');
        status = 'cancelled';
        exitCode = 137;
        allClauses(false, 'middle', '检测取消，结果未知，暂按不通过判定，建议补测', [idx]);
        return finish();
      }

      const run = (command: string): Promise<CommandOutcome> =>
        Promise.race<CommandOutcome>([
          context.engine.runCommand(command, {
            timeoutMs,
            cancelToken: context.cancelToken,
            onProgress: (p) => {
              if (p.logLine) context.onProgress({ logLine: p.logLine });
            },
          }),
          context.cancelToken.promise.then<CommandOutcome>(() => ({
            status: 'cancelled',
            exitCode: 137,
            stdout: '',
            stderr: '用户取消执行',
            durationMs: Date.now() - startedMs,
          })),
        ]);

      // ── 2. openssl 抓证书 ──
      const certCmd =
        `openssl s_client -connect ${targetIp}:${port} -servername ${targetIp} </dev/null 2>/dev/null` +
        ` | openssl x509 -noout -dates -subject -issuer -serial 2>/dev/null`;
      context.onProgress({
        percent: 5,
        message: `读取 TLS 证书：${targetIp}:${port}`,
        logLine: `$ ${certCmd}`,
      });
      const certRes = await run(certCmd);
      stdoutAcc += `$ ${certCmd}\n${certRes.stdout}\n`;
      stderrAcc += certRes.stderr ? `${certRes.stderr}\n` : '';

      if (certRes.status === 'cancelled' || certRes.status === 'timeout') {
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `openssl 证书读取被${certRes.status === 'cancelled' ? '取消' : '超时中断'}：\n${certRes.stdout.slice(-1000)}`,
          'middle',
        );
        status = certRes.status;
        exitCode = certRes.exitCode;
        allClauses(
          false,
          'middle',
          `检测${certRes.status === 'cancelled' ? '取消' : '超时'}，结果未知，暂按不通过判定，建议补测`,
          [idx],
        );
        return finish();
      }

      // ── 3. nmap 枚举加密套件 ──
      const cipherCmd = `nmap --script ssl-enum-ciphers -p ${port} ${targetIp}`;
      context.onProgress({
        percent: 40,
        message: `枚举加密套件：${targetIp}:${port}`,
        logLine: `$ ${cipherCmd}`,
      });
      const cipherRes = await run(cipherCmd);
      stdoutAcc += `$ ${cipherCmd}\n${cipherRes.stdout}\n`;
      stderrAcc += cipherRes.stderr ? `${cipherRes.stderr}\n` : '';

      if (cipherRes.status === 'cancelled' || cipherRes.status === 'timeout') {
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `nmap 套件枚举被${cipherRes.status === 'cancelled' ? '取消' : '超时中断'}：\n${cipherRes.stdout.slice(-1000)}`,
          'middle',
        );
        status = cipherRes.status;
        exitCode = cipherRes.exitCode;
        allClauses(
          false,
          'middle',
          `检测${cipherRes.status === 'cancelled' ? '取消' : '超时'}，结果未知，暂按不通过判定，建议补测`,
          [idx],
        );
        return finish();
      }

      // ── 4. 解析与判定 ──
      context.onProgress({ percent: 90, message: '分析证书与加密套件' });

      const cert = parseCertInfo(certRes.stdout);
      const { findings, hasCipherInfo, protocols } = detectWeakCrypto(cipherRes.stdout);

      const certEvidenceIdx = pushEvidence(
        evidence,
        'stdout_line',
        cert.reachable
          ? `openssl 证书信息：\n${certRes.stdout.trim().slice(0, 2000)}`
          : `openssl 未返回证书信息（可能端口未提供 TLS、连接被拒绝、或 openssl 不可用）。exitCode=${certRes.exitCode}，stderr：${certRes.stderr.slice(-500) || '(空)'}`,
        cert.reachable ? 'low' : 'high',
      );
      const cipherEvidenceIdx = pushEvidence(
        evidence,
        'stdout_line',
        hasCipherInfo
          ? `nmap ssl-enum-ciphers 输出：\n${scriptLines(cipherRes.stdout).join('\n').slice(0, 4000)}`
          : `nmap 未返回 ssl-enum-ciphers 结果（可能 nmap 不可用、NSE 脚本缺失、或端口未提供 TLS）。exitCode=${cipherRes.exitCode}，输出尾部：${cipherRes.stdout.slice(-500) || '(空)'}`,
        hasCipherInfo ? 'low' : 'high',
      );

      // 条款 5.4-1 通信加密套件不得使用已知弱算法
      if (findings.length > 0) {
        const detail = findings.map((f) => `${f.label} ← ${f.line.slice(0, 160)}`).join('\n');
        const idx = pushEvidence(
          evidence,
          'assertion',
          `检测到 ${findings.length} 处弱加密特征：\n${detail}`,
          'high',
        );
        verdicts.push({
          clauseId: '5.4-1',
          pass: false,
          severity: 'high',
          reason: `检测到弱加密套件/协议 ${findings.length} 处：${[
            ...new Set(findings.map((f) => f.label)),
          ].join('；')}`,
          evidenceRefs: [idx, cipherEvidenceIdx],
        });
      } else if (!hasCipherInfo) {
        const idx = pushEvidence(
          evidence,
          'assertion',
          '无法枚举目标加密套件，5.4-1 无法判定，需人工补测（openssl s_client -cipher / testssl.sh）',
          'middle',
        );
        verdicts.push({
          clauseId: '5.4-1',
          pass: false,
          severity: 'middle',
          reason: '未能获取加密套件枚举结果，无法证明不存在弱算法，暂按不通过判定并要求补测',
          evidenceRefs: [idx, cipherEvidenceIdx],
        });
      } else {
        const idx = pushEvidence(
          evidence,
          'assertion',
          `加密套件枚举完成，未匹配到弱算法特征（RC4/DES/3DES/CBC-SHA1/NULL/EXPORT/匿名），协议版本：${
            protocols.length > 0 ? protocols.join('，') : 'TLSv1.2+'
          }`,
          'low',
        );
        verdicts.push({
          clauseId: '5.4-1',
          pass: true,
          severity: 'middle',
          reason: '未检测到已知弱加密套件或不安全协议版本',
          evidenceRefs: [idx, cipherEvidenceIdx],
        });
      }

      // 条款 5.4-2 TLS 证书必须合法有效且正确配置
      const certIssues: string[] = [];
      if (!cert.reachable) certIssues.push('无法获取 TLS 证书（连接被拒绝 / 端口未提供 TLS / openssl 不可用）');
      else {
        if (cert.expired) certIssues.push(`证书已过期（notAfter=${cert.notAfter}）`);
        if (cert.notYetValid) certIssues.push(`证书尚未生效（notBefore=${cert.notBefore}）`);
        if (cert.selfSigned) certIssues.push(`证书为自签名（subject 与 issuer 相同：${cert.subject}）`);
      }

      if (certIssues.length > 0) {
        const idx = pushEvidence(evidence, 'assertion', certIssues.join('；'), 'middle');
        verdicts.push({
          clauseId: '5.4-2',
          pass: false,
          severity: 'middle',
          reason: certIssues.join('；'),
          evidenceRefs: [idx, certEvidenceIdx],
        });
      } else {
        const idx = pushEvidence(
          evidence,
          'assertion',
          `证书有效：subject=${cert.subject}；issuer=${cert.issuer}；有效期 ${cert.notBefore} ~ ${cert.notAfter}；serial=${cert.serial}`,
          'low',
        );
        verdicts.push({
          clauseId: '5.4-2',
          pass: true,
          severity: 'middle',
          reason: '证书在有效期内、由独立签发者签发（非自签名）',
          evidenceRefs: [idx, certEvidenceIdx],
        });
      }

      // ── 5. 汇总执行状态 ──
      if (!cert.reachable && !hasCipherInfo) {
        status = 'fail';
        exitCode = certRes.exitCode || cipherRes.exitCode || 1;
        error = {
          code: 'TLS_TARGET_UNREACHABLE',
          message: `既未取得证书也未取得加密套件枚举结果（${targetIp}:${port}），请确认目标可达、端口提供 TLS、openssl/nmap 已安装`,
        };
        pushEvidence(
          evidence,
          'validation_error',
          `openssl 与 nmap 均未产出可用结果，判定不可信，需人工复核环境依赖。`,
          'high',
        );
      } else if (!cert.reachable || !hasCipherInfo) {
        status = 'partial';
        exitCode = 0;
        pushEvidence(
          evidence,
          'assertion',
          `部分检测未完成：${!cert.reachable ? '证书信息缺失；' : ''}${!hasCipherInfo ? '加密套件枚举缺失；' : ''}结果按 partial 上报`,
          'middle',
        );
      } else {
        status = 'success';
        exitCode = 0;
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'unknown error');
      status = 'crash';
      exitCode = exitCode || 1;
      stderrAcc += err.stack || err.message;
      error = { code: 'UNEXPECTED_CRASH', message: err.message, stack: err.stack };
      verdicts.length = 0;
      const idx = pushEvidence(
        evidence,
        'validation_error',
        `模组内部异常：${err.message}\n${err.stack || ''}`,
        'high',
      );
      allClauses(false, 'high', `模组崩溃，默认不通过：${err.message}`, [idx]);
    }

    return finish();
  }
}

export default new CryptoCheckModule();
