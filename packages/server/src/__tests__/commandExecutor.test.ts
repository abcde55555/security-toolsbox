import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { CommandExecutor } from '../engine/commandExecutor.js';
import { createCancelToken } from '../engine/cancelToken.js';

const isWin = process.platform === 'win32';
const pidAlive = (pid: number): boolean => {
  try {
    if (isWin) {
      execFileSync('tasklist', ['/fi', `PID eq ${pid}`], { stdio: 'ignore' });
      return true;
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('CommandExecutor process tree kill', () => {
  it('kills the spawned process when cancelled', async () => {
    const executor = new CommandExecutor();
    const token = createCancelToken();
    const pidFile = path.join(os.tmpdir(), `en18031-exec-${Date.now()}.pid`);

    // On Unix, `exec sleep` replaces the shell so its pid is the long-running
    // command itself; the shell is the process-group leader. On Windows use ping.
    const command = isWin
      ? `ping -n 30 127.0.0.1`
      : `echo $$ > ${pidFile}; exec sleep 31`;

    const resultP = executor.runCommand(command, { cancelToken: token, timeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 500));

    let pid = 0;
    if (!isWin) {
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      expect(pid).toBeGreaterThan(0);
      expect(pidAlive(pid)).toBe(true);
    }

    token.cancel();
    const result = await resultP;
    expect(result.status).toBe('cancelled');

    if (!isWin) {
      // the killed process must not linger
      let gone = false;
      for (let i = 0; i < 30; i++) {
        if (!pidAlive(pid)) { gone = true; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(gone).toBe(true);
      fs.rmSync(pidFile, { force: true });
    }
  });
});
