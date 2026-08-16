import { spawn } from 'node:child_process';
import type {
  CancelToken,
  CommandProgress,
  ExecutionStatus,
} from '@en18031/shared';

export interface CommandResult {
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  onProgress?: (p: CommandProgress) => void;
  cancelToken?: CancelToken;
  /** Keep full stdout/stderr in the resolved result. Set false when output is
   *  consumed via onProgress (e.g. streamed to disk) to avoid unbounded memory. */
  collectOutput?: boolean;
}

const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

function appendLimited(prev: string, chunk: string): string {
  const next = prev + chunk;
  if (next.length <= MAX_BUFFER_BYTES) return next;
  return next.slice(next.length - MAX_BUFFER_BYTES);
}

export class CommandExecutor {
  runCommand(command: string, opts: RunCommandOptions = {}): Promise<CommandResult> {
    return new Promise((resolve) => {
      const start = Date.now();
      const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
      const collectOutput = opts.collectOutput !== false;
      const child = spawn(command, {
        shell: true,
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let cancelled = false;

      const finish = (status: ExecutionStatus, exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (!child.killed) child.kill(status === 'timeout' || cancelled ? 'SIGKILL' : 'SIGTERM');
        } catch {
          // ignore
        }
        if (cancelled && exitCode === 0) {
          resolve({
            status: 'cancelled',
            exitCode: 130,
            stdout,
            stderr,
            durationMs: Date.now() - start,
          });
          return;
        }
        if (timedOut) {
          resolve({
            status: 'timeout',
            exitCode: 124,
            stdout,
            stderr,
            durationMs: Date.now() - start,
          });
          return;
        }
        resolve({
          status: status === 'cancelled' ? 'cancelled' : exitCode === 0 ? 'success' : 'fail',
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        opts.onProgress?.({ message: '命令执行超时，强制终止' });
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        finish('timeout', 124);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (collectOutput) stdout = appendLimited(stdout, text);
        for (const line of text.split(/\r?\n/)) {
          if (line.length > 0) opts.onProgress?.({ logLine: line, stream: 'stdout' });
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (collectOutput) stderr = appendLimited(stderr, text);
        for (const line of text.split(/\r?\n/)) {
          if (line.length > 0) opts.onProgress?.({ logLine: line, stream: 'stderr' });
        }
      });
      child.on('error', (err) => {
        if (collectOutput) stderr = appendLimited(stderr, `\n[spawn error] ${err.message}`);
        finish('crash', 1);
      });
      child.on('close', (code) => {
        finish(code === 0 ? 'success' : 'fail', code ?? 1);
      });

      if (opts.cancelToken) {
        if (opts.cancelToken.isRequested) {
          cancelled = true;
          finish('cancelled', 130);
        } else {
          opts.cancelToken.promise.then(() => {
            cancelled = true;
            opts.onProgress?.({ message: '收到取消信号，终止进程' });
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
            finish('cancelled', 130);
          });
        }
      }
    });
  }
}
