import { readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

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
export const CLAUSE_IDS = ['5.5-1', '5.5-3'] as const;

/** 证据中单行最大保留长度（超出截断，避免把完整密钥写进报告） */
export const REDACT_LEN = 120;

/** 硬编码凭据特征（grep -iE 使用，同时用于结果分类） */
export const SECRET_PATTERN = '(password|passwd|api[_-]?key|secret|token|private[_-]?key|aws_|BEGIN RSA|BEGIN PRIVATE)';

/** 调试接口特征 */
export const DEBUG_PATTERN = '(jtag|uart|debug console)';

/** 文件路径中绝对不允许出现的字符（命令会用单引号包裹，故允许空格） */
const PATH_FORBIDDEN = /['"`$;&|<>\n\r\\*?]/;

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

/** 单行脱敏：压缩空白 + 截断到 REDACT_LEN，并标注已截断 */
export function redactLine(line: string): string {
  const flat = line.replace(/\s+/g, ' ').trim();
  return flat.length > REDACT_LEN ? `${flat.slice(0, REDACT_LEN)}…[已截断,原长${flat.length}]` : flat;
}

/** 归一化 grep 结果为去重后的脱敏行数组 */
export function redactMatches(raw: string, limit = 100): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of (raw || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const red = redactLine(line);
    if (seen.has(red)) continue;
    seen.add(red);
    out.push(red);
    if (out.length >= limit) break;
  }
  return out;
}

/** 判断某条命令输出是否表示可执行文件缺失 */
export function isToolMissing(tool: string, res: { exitCode: number; stderr: string; stdout: string }): boolean {
  if (res.exitCode === 127) return true;
  const blob = `${res.stderr}\n${res.stdout}`;
  return new RegExp(`${tool}[^\\n]{0,40}(not found|No such file|未找到|不是内部或外部命令)`, 'i').test(blob);
}

class FirmwareSecretScanModule implements BaseModule {
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
    const tmpFiles: string[] = [];

    const finish = (): ExecutionResult => {
      context.onProgress({
        percent: 100,
        message: `固件密钥扫描完成，共 ${verdicts.length} 条条款判定`,
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
      // ── 1. 参数与文件校验 ──
      context.onProgress({ percent: 5, message: '校验固件文件' });
      const firmwareFile = String(params.firmwareFile ?? '').trim();
      const scanDepth = String(params.scanDepth ?? 'quick').trim();
      const timeoutRaw = Number(params.timeoutMs ?? 300000);
      const timeoutMs =
        Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 300000;

      const errs: string[] = [];
      if (!firmwareFile) errs.push('firmwareFile 不能为空');
      else if (PATH_FORBIDDEN.test(firmwareFile))
        errs.push('firmwareFile 路径含非法字符（疑似命令注入）');
      else if (!isAbsolute(firmwareFile))
        errs.push(`firmwareFile 必须是绝对路径，实际为：${firmwareFile}`);
      if (!['quick', 'full'].includes(scanDepth))
        errs.push(`scanDepth 只允许 quick/full，实际为：${scanDepth}`);

      let fileSize = 0;
      if (errs.length === 0) {
        try {
          const st = await stat(firmwareFile);
          if (!st.isFile()) errs.push(`firmwareFile 不是普通文件：${firmwareFile}`);
          fileSize = st.size;
          if (st.isFile() && st.size === 0) errs.push(`firmwareFile 为空文件：${firmwareFile}`);
        } catch (e) {
          errs.push(
            `firmwareFile 不存在或不可读：${firmwareFile}（${e instanceof Error ? e.message : String(e)}）`,
          );
        }
      }

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
        allClauses(false, 'high', `参数校验失败，未执行固件扫描：${errs.join('；')}`, [idx]);
        return finish();
      }

      if (context.cancelToken.isRequested) {
        const idx = pushEvidence(evidence, 'assertion', '执行前已收到取消请求，未启动扫描', 'middle');
        status = 'cancelled';
        exitCode = 137;
        allClauses(false, 'middle', '扫描取消，结果未知，暂按不通过判定，建议补测', [idx]);
        return finish();
      }

      const cwd = dirname(firmwareFile);
      const quoted = `'${firmwareFile}'`;
      const secretLimit = scanDepth === 'full' ? 1000 : 100;
      const debugLimit = scanDepth === 'full' ? 200 : 50;
      const stringsFlags = scanDepth === 'full' ? '-a -n 4' : '';
      const stamp = `${context.stepId.replace(/[^A-Za-z0-9_-]/g, '_') || 'step'}-${Date.now()}`;
      const secretsOut = join(tmpdir(), `en18031-fw-secrets-${stamp}.txt`);
      const debugOut = join(tmpdir(), `en18031-fw-debug-${stamp}.txt`);
      tmpFiles.push(secretsOut, debugOut);

      const fileInfoIdx = pushEvidence(
        evidence,
        'file_pointer',
        `被扫描固件：${firmwareFile}（${basename(firmwareFile)}，${fileSize} bytes，scanDepth=${scanDepth}）`,
        'low',
        firmwareFile,
      );

      const run = (command: string): Promise<CommandOutcome> =>
        Promise.race<CommandOutcome>([
          context.engine.runCommand(command, {
            timeoutMs,
            cwd,
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

      const readTmp = async (p: string, fallbackStdout: string): Promise<string> => {
        try {
          const content = await readFile(p, 'utf8');
          if (content.trim().length > 0) return content;
        } catch {
          /* 落到 stdout 兜底 */
        }
        // 兜底：某些执行环境（如受限沙箱、或 runCommand 未真正落盘）下直接用命令 stdout
        return fallbackStdout || '';
      };

      // ── 2. 硬编码凭据字符串扫描（结果写临时文件，避免 stdout 爆量） ──
      const secretsCmd = [
        'strings',
        stringsFlags,
        quoted,
        '|',
        'grep',
        '-iE',
        `'${SECRET_PATTERN}'`,
        '|',
        `head -${secretLimit}`,
        '>',
        `'${secretsOut}'`,
      ]
        .filter(Boolean)
        .join(' ');
      context.onProgress({
        percent: 15,
        message: '扫描硬编码凭据特征字符串',
        logLine: `$ ${secretsCmd}`,
      });
      const secretsRes = await run(secretsCmd);
      stdoutAcc += `$ ${secretsCmd}\n${secretsRes.stdout}\n`;
      stderrAcc += secretsRes.stderr ? `${secretsRes.stderr}\n` : '';

      if (secretsRes.status === 'cancelled' || secretsRes.status === 'timeout') {
        status = secretsRes.status;
        exitCode = secretsRes.exitCode;
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `字符串扫描被${status === 'cancelled' ? '用户取消' : '超时中断'}`,
          'middle',
        );
        allClauses(
          false,
          'middle',
          `扫描${status === 'cancelled' ? '取消' : '超时'}，结果未知，暂按不通过判定，建议补测`,
          [idx, fileInfoIdx],
        );
        return finish();
      }

      if (isToolMissing('strings', secretsRes)) {
        status = 'fail';
        exitCode = secretsRes.exitCode || 127;
        error = {
          code: 'STRINGS_UNAVAILABLE',
          message: 'strings/grep 不可用，无法执行固件字符串扫描（请安装 binutils）',
          stack: secretsRes.stderr,
        };
        const idx = pushEvidence(
          evidence,
          'validation_error',
          `strings/grep 不可用，无法完成扫描。exitCode=${secretsRes.exitCode}，stderr：${secretsRes.stderr.slice(-500)}`,
          'high',
        );
        allClauses(false, 'high', 'strings/grep 依赖缺失，无法判定固件合规性，默认不通过', [
          idx,
          fileInfoIdx,
        ]);
        return finish();
      }

      const secretRaw = await readTmp(secretsOut, secretsRes.stdout);
      const secretMatches = redactMatches(secretRaw, secretLimit);

      // ── 3. 调试接口特征扫描 ──
      const debugCmd = [
        'strings',
        stringsFlags,
        quoted,
        '|',
        'grep',
        '-iE',
        `'${DEBUG_PATTERN}'`,
        '|',
        `head -${debugLimit}`,
        '>',
        `'${debugOut}'`,
      ]
        .filter(Boolean)
        .join(' ');
      context.onProgress({
        percent: 50,
        message: '扫描调试接口特征字符串',
        logLine: `$ ${debugCmd}`,
      });
      const debugRes = await run(debugCmd);
      stdoutAcc += `$ ${debugCmd}\n${debugRes.stdout}\n`;
      stderrAcc += debugRes.stderr ? `${debugRes.stderr}\n` : '';

      if (debugRes.status === 'cancelled' || debugRes.status === 'timeout') {
        status = debugRes.status;
        exitCode = debugRes.exitCode;
        const idx = pushEvidence(
          evidence,
          'stdout_line',
          `调试接口扫描被${status === 'cancelled' ? '用户取消' : '超时中断'}`,
          'middle',
        );
        allClauses(
          false,
          'middle',
          `扫描${status === 'cancelled' ? '取消' : '超时'}，结果未知，暂按不通过判定，建议补测`,
          [idx, fileInfoIdx],
        );
        return finish();
      }

      const debugRaw = await readTmp(debugOut, debugRes.stdout);
      const debugMatches = redactMatches(debugRaw, debugLimit);

      // ── 4. binwalk 组件枚举（缺失不影响整体结论） ──
      context.onProgress({ percent: 70, message: 'binwalk 枚举内嵌组件' });
      const binwalkCmd = `binwalk ${quoted}`;
      const binwalkRes = await run(binwalkCmd);
      stdoutAcc += `$ ${binwalkCmd}\n${binwalkRes.stdout}\n`;
      stderrAcc += binwalkRes.stderr ? `${binwalkRes.stderr}\n` : '';

      let binwalkNote: number;
      if (binwalkRes.status === 'cancelled' || binwalkRes.status === 'timeout') {
        binwalkNote = pushEvidence(
          evidence,
          'assertion',
          `binwalk 组件枚举被${binwalkRes.status === 'cancelled' ? '取消' : '超时中断'}，不影响字符串扫描结论；内嵌组件清单缺失，建议人工补充。`,
          'middle',
        );
      } else if (isToolMissing('binwalk', binwalkRes)) {
        binwalkNote = pushEvidence(
          evidence,
          'assertion',
          'binwalk 未安装（可选依赖）：本次未产出内嵌组件清单，仅完成 strings 特征扫描。' +
            '条款判定不受影响，但建议安装 binwalk 后复测以覆盖内嵌文件系统中的凭据。',
          'middle',
        );
      } else if (binwalkRes.exitCode !== 0) {
        binwalkNote = pushEvidence(
          evidence,
          'assertion',
          `binwalk 执行失败（exitCode=${binwalkRes.exitCode}），不影响字符串扫描结论。stderr：${binwalkRes.stderr.slice(-300)}`,
          'middle',
        );
      } else {
        binwalkNote = pushEvidence(
          evidence,
          'stdout_line',
          `binwalk 内嵌组件清单：\n${binwalkRes.stdout.trim().slice(0, 4000)}`,
          'low',
        );
      }

      // ── 5. 判定 ──
      context.onProgress({ percent: 96, message: '汇总固件扫描结论' });

      // 条款 5.5-1 固件中不得存在硬编码密钥或凭据
      if (secretMatches.length > 0) {
        const idx = pushEvidence(
          evidence,
          'assertion',
          `检测到 ${secretMatches.length} 条硬编码凭据疑似特征（每行已截断至 ${REDACT_LEN} 字符脱敏）：\n${secretMatches.join('\n')}`,
          'high',
        );
        verdicts.push({
          clauseId: '5.5-1',
          pass: false,
          severity: 'high',
          reason: `固件中命中 ${secretMatches.length} 条硬编码凭据特征（password/api_key/secret/token/private_key/BEGIN RSA 等），需逐条确认并移除`,
          evidenceRefs: [idx, fileInfoIdx, binwalkNote],
        });
      } else {
        const idx = pushEvidence(
          evidence,
          'assertion',
          `未在固件字符串中命中硬编码凭据特征（匹配规则：${SECRET_PATTERN}，scanDepth=${scanDepth}）`,
          'low',
        );
        verdicts.push({
          clauseId: '5.5-1',
          pass: true,
          severity: 'middle',
          reason: '未检出硬编码密钥/凭据特征字符串（静态字符串扫描范围内）',
          evidenceRefs: [idx, fileInfoIdx],
        });
      }

      // 条款 5.5-3 调试接口 JTAG/UART 默认关闭
      if (debugMatches.length > 0) {
        const idx = pushEvidence(
          evidence,
          'assertion',
          `检测到 ${debugMatches.length} 条调试接口相关字符串（已脱敏截断）：\n${debugMatches.join('\n')}`,
          'middle',
        );
        verdicts.push({
          clauseId: '5.5-3',
          pass: false,
          severity: 'middle',
          reason: `固件中存在 ${debugMatches.length} 条 JTAG/UART/debug console 相关字符串，需人工确认量产固件是否已关闭调试接口`,
          evidenceRefs: [idx, fileInfoIdx],
        });
      } else {
        const idx = pushEvidence(
          evidence,
          'assertion',
          `未在固件字符串中命中调试接口特征（匹配规则：${DEBUG_PATTERN}）`,
          'low',
        );
        verdicts.push({
          clauseId: '5.5-3',
          pass: true,
          severity: 'middle',
          reason: '未检出 JTAG/UART/debug console 相关字符串',
          evidenceRefs: [idx, fileInfoIdx],
        });
      }

      status = 'success';
      exitCode = 0;
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
    } finally {
      // 临时结果文件已读取完毕，统一清理
      for (const f of tmpFiles) {
        try {
          await unlink(f);
        } catch {
          /* 文件可能本就不存在，忽略 */
        }
      }
    }

    return finish();
  }
}

export default new FirmwareSecretScanModule();
