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
export const CLAUSE_IDS = ['5.1-1', '5.3-4'] as const;

/** 服务 → 端口映射（同时用于服务名识别） */
export const SERVICE_PORTS: Record<string, number> = {
  ssh: 22,
  telnet: 23,
  http: 80,
  https: 443,
  ftp: 21,
};

const ALL_SERVICES = Object.keys(SERVICE_PORTS);

export interface OpenService {
  service: string;
  port: number;
  proto: string;
  banner: string;
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

/** 从 nmap 文本输出解析开放端口，并映射回被勾选的服务名 */
export function parseOpenServices(stdout: string, selected: string[]): OpenService[] {
  const wanted = new Map<number, string>();
  for (const s of selected) {
    const port = SERVICE_PORTS[s];
    if (port !== undefined) wanted.set(port, s);
  }
  const out: OpenService[] = [];
  const re = /^(\d{1,5})\/(tcp|udp)\s+open\s*(.*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    const port = Number(m[1]);
    const service = wanted.get(port);
    if (service === undefined) continue;
    if (out.some((o) => o.port === port)) continue;
    out.push({ service, port, proto: m[2], banner: (m[3] ?? '').trim() });
  }
  return out;
}

class DefaultCredCheckModule implements BaseModule {
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
        message: `默认口令风险筛查完成，共 ${verdicts.length} 条条款判定`,
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
      const rawServices = params.servicesToCheck;
      const selected = (
        Array.isArray(rawServices)
          ? rawServices.map((s) => String(s).trim().toLowerCase())
          : typeof rawServices === 'string' && rawServices.length > 0
            ? rawServices.split(',').map((s) => s.trim().toLowerCase())
            : ALL_SERVICES
      ).filter((s) => s.length > 0);
      const timeoutRaw = Number(params.timeoutMs ?? 10000);
      const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 10000;

      const errs: string[] = [];
      if (!targetIp) errs.push('targetIp 不能为空');
      else if (!isValidIp(targetIp)) errs.push(`targetIp 不是合法的 IPv4 地址：${targetIp}`);
      if (selected.length === 0) errs.push('servicesToCheck 至少要选择一项');
      const unknown = selected.filter((s) => SERVICE_PORTS[s] === undefined);
      if (unknown.length > 0)
        errs.push(`servicesToCheck 含未知服务（只允许 ${ALL_SERVICES.join('/')}）：${unknown.join('、')}`);

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
        allClauses(false, 'high', `参数校验失败，未执行筛查：${errs.join('；')}`, [idx]);
        return finish();
      }

      if (context.cancelToken.isRequested) {
        const idx = pushEvidence(evidence, 'assertion', '执行前已收到取消请求，未启动筛查', 'middle');
        status = 'cancelled';
        exitCode = 137;
        allClauses(false, 'middle', '筛查取消，结果未知，暂按不通过判定，建议补测', [idx]);
        return finish();
      }

      // 端口列表去重并排序，保证命令可复现（数字来自内部映射表，不含用户输入，无注入风险）
      const ports = [...new Set(selected.map((s) => SERVICE_PORTS[s]))].sort((a, b) => a - b);
      const command = `nmap -p ${ports.join(',')} --open ${targetIp}`;

      // ── 2. 声明筛查性质（非爆破） ──
      const scopeIdx = pushEvidence(
        evidence,
        'assertion',
        [
          '【筛查性质说明】本模组为非破坏性筛查（screening），不会尝试任何口令登录、字典爆破或账号锁定风险操作。',
          `探测方式：${command}`,
          `覆盖服务：${selected.map((s) => `${s}(${SERVICE_PORTS[s]})`).join('、')}`,
          '判定含义：端口开放仅代表「存在默认口令风险面，需人工核实口令是否已修改」，不代表已确认存在默认口令。',
        ].join('\n'),
        'low',
      );

      context.onProgress({
        percent: 5,
        message: `探测管理服务端口：${targetIp} (${ports.join(',')})`,
        logLine: `$ ${command}`,
      });

      // ── 3. 执行探测（与 cancelToken 竞速） ──
      const cmdResult = await Promise.race<CommandOutcome>([
        context.engine.runCommand(command, {
          timeoutMs,
          cancelToken: context.cancelToken,
          onProgress: (p) => {
            const elapsed = Date.now() - startedMs;
            const est = Math.min(90, 10 + Math.floor((elapsed / timeoutMs) * 80));
            context.onProgress({ percent: est, message: `探测中 ${est}%`, logLine: p.logLine });
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

      stdoutAcc = cmdResult.stdout || '';
      stderrAcc = cmdResult.stderr || '';
      exitCode = cmdResult.exitCode ?? 0;

      if (cmdResult.status === 'cancelled' || cmdResult.status === 'timeout') {
        status = cmdResult.status;
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `端口探测被${status === 'cancelled' ? '用户取消' : '超时中断'}：\n${stdoutAcc.slice(-1000)}`,
          'middle',
        );
        allClauses(
          false,
          'middle',
          `筛查${status === 'cancelled' ? '取消' : '超时'}，结果未知，暂按不通过判定，建议补测`,
          [idx, scopeIdx],
        );
        return finish();
      }

      if (exitCode !== 0) {
        status = 'fail';
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `nmap 退出码 ${exitCode}：\nstderr:\n${stderrAcc.slice(-1000)}\nstdout tail:\n${stdoutAcc.slice(-1000)}`,
          'high',
        );
        error = { code: 'NMAP_EXIT_NONZERO', message: `nmap exitCode=${exitCode}`, stack: stderrAcc };
        allClauses(
          false,
          'high',
          `nmap 执行失败（exitCode=${exitCode}），无法完成默认口令风险筛查，默认不通过`,
          [idx, scopeIdx],
        );
        return finish();
      }

      // ── 4. 解析与判定 ──
      context.onProgress({ percent: 96, message: '解析开放的管理服务' });
      const openServices = parseOpenServices(stdoutAcc, selected);

      const stdoutIdx = pushEvidence(evidence, 'stdout_line', stdoutAcc.slice(-3000), 'low');

      const perServiceRefs: number[] = [];
      for (const s of openServices) {
        perServiceRefs.push(
          pushEvidence(
            evidence,
            'assertion',
            `检测到 ${s.service.toUpperCase()} 管理服务开放：${s.port}/${s.proto}${
              s.banner ? `（${s.banner}）` : ''
            } —— 本模组不做口令爆破，需人工核实该服务的默认口令是否已修改（默认账户/出厂口令/厂商后门账号）。`,
            'high',
          ),
        );
      }

      const anyOpen = openServices.length > 0;
      let reason: string;
      let refs: number[];
      if (anyOpen) {
        const list = openServices.map((s) => `${s.service}(${s.port})`).join('、');
        reason = `检测到 ${list} 服务开放，需人工核实默认口令是否已修改`;
        refs = [...perServiceRefs, scopeIdx, stdoutIdx];
      } else {
        const idx = pushEvidence(
          evidence,
          'assertion',
          `未检测到相关管理服务开放（已探测：${selected
            .map((s) => `${s}(${SERVICE_PORTS[s]})`)
            .join('、')}），默认口令风险面为空。`,
          'low',
        );
        reason = '未检测到相关管理服务';
        refs = [idx, scopeIdx, stdoutIdx];
      }

      verdicts.push({
        clauseId: '5.1-1',
        pass: !anyOpen,
        reason: anyOpen ? reason : `${reason}，无默认账户可被远程使用`,
        severity: anyOpen ? 'high' : 'middle',
        evidenceRefs: refs,
      });
      verdicts.push({
        clauseId: '5.3-4',
        pass: !anyOpen,
        reason: anyOpen ? reason : `${reason}，无需修改默认口令的暴露面`,
        severity: anyOpen ? 'high' : 'middle',
        evidenceRefs: refs,
      });

      status = 'success';
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

export default new DefaultCredCheckModule();
