import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandRunsApi, type CommandRunDetail } from '../api/endpoints';
import { useRunStream } from '../api/socket';
import { useLogBuffer, type TerminalLine } from '../components/Terminal';
import { isTerminalStatus, toLines } from '../utils/ui';

/**
 * 共享的命令运行流式 + 轮询对账 Hook。
 * 抽取自 RunCommandModal 和 CommandRunDetail 中重复的逻辑：
 * - Socket.IO 实时日志推送
 * - 定时轮询获取运行详情
 * - 终态时用完整 stdout/stderr 对账，避免遗漏
 */
export function useCommandRunStream(opts?: { pollIntervalMs?: number; bufferCap?: number }) {
  const pollIntervalMs = opts?.pollIntervalMs ?? 1500;
  const bufferCap = opts?.bufferCap ?? 3000;

  const [runId, setRunId] = useState<string | undefined>();
  const [detail, setDetail] = useState<CommandRunDetail | null>(null);
  const buffer = useLogBuffer(bufferCap);
  const reconciled = useRef(false);
  const receivedSocket = useRef(false);
  const pollSeq = useRef(0);

  const running = !!runId && (!detail || !isTerminalStatus(detail.status));
  const finished = !!detail && isTerminalStatus(detail.status);

  const reset = useCallback(() => {
    reconciled.current = false;
    receivedSocket.current = false;
    buffer.reset();
    setDetail(null);
  }, [buffer]);

  const pollOnce = useCallback(async () => {
    if (!runId) return;
    const seq = ++pollSeq.current;
    try {
      const d = await CommandRunsApi.get(runId);
      if (seq !== pollSeq.current) return;
      setDetail(d);
      if (isTerminalStatus(d.status)) {
        if (!reconciled.current) {
          reconciled.current = true;
          buffer.setLines([...toLines(d.stdout, 'stdout'), ...toLines(d.stderr, 'stderr')]);
        }
      } else if (!receivedSocket.current && buffer.lines.length === 0) {
        // Socket 尚未投递任何内容（快速命令/延迟订阅）；用轮询输出打底
        const seed = [...toLines(d.stdout, 'stdout'), ...toLines(d.stderr, 'stderr')];
        if (seed.length > 0) buffer.setLines(seed);
      }
    } catch {
      // 忽略临时轮询错误
    }
  }, [runId, buffer]);

  useRunStream(runId, {
    onLogLine: (p) => {
      receivedSocket.current = true;
      buffer.append(p.line, undefined, p.stream);
    },
    onStatus: (p) => {
      if (isTerminalStatus(p.status)) void pollOnce();
    },
  });

  useEffect(() => {
    if (!runId || finished) return;
    const t = setInterval(() => void pollOnce(), pollIntervalMs);
    return () => clearInterval(t);
  }, [runId, finished, pollOnce, pollIntervalMs]);

  const start = useCallback((id: string) => {
    setRunId(id);
    reset();
    void pollOnce();
  }, [reset, pollOnce]);

  const stop = useCallback(() => {
    setRunId(undefined);
    reset();
  }, [reset]);

  return {
    runId,
    setRunId,
    detail,
    setDetail,
    buffer,
    running,
    finished,
    reset,
    pollOnce,
    start,
    stop,
    lines: buffer.lines as TerminalLine[],
    truncated: buffer.truncated,
  };
}
