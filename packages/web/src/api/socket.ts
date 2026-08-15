import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

export interface RunStreamEvents {
  onLogLine?: (p: { runId: string; stepRunId?: string; stepId?: string; line: string }) => void;
  onProgress?: (p: { runId: string; stepRunId?: string; stepId?: string; percent: number; message?: string }) => void;
  onStatus?: (p: { runId: string; stepRunId?: string; stepId?: string; status: string; percent?: number }) => void;
  onBatchProgress?: (p: { runId: string; percent: number; status?: string }) => void;
}

export function subscribeRun(runId: string, handlers: RunStreamEvents): () => void {
  const socket: Socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => socket.emit('subscribe', { runId }));
  if (handlers.onLogLine) socket.on('run:logLine', handlers.onLogLine);
  if (handlers.onProgress) socket.on('run:progress', handlers.onProgress);
  if (handlers.onStatus) socket.on('run:status', handlers.onStatus);
  if (handlers.onBatchProgress) socket.on('run:batchProgress', handlers.onBatchProgress);
  return () => {
    socket.emit('unsubscribe', { runId });
    socket.disconnect();
  };
}

export function useRunStream(runId: string | undefined, handlers: RunStreamEvents): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!runId) return;
    const unsub = subscribeRun(runId, {
      onLogLine: (p) => ref.current.onLogLine?.(p),
      onProgress: (p) => ref.current.onProgress?.(p),
      onStatus: (p) => ref.current.onStatus?.(p),
      onBatchProgress: (p) => ref.current.onBatchProgress?.(p),
    });
    return unsub;
  }, [runId]);
}
