import { useEffect, useRef } from 'react';

export interface LogLine { ts: string; text: string; kind: 'in' | 'ok' | 'err' | 'warn' }

interface TerminalTabProps {
  logs: LogLine[];
}

export default function TerminalTab({ logs }: TerminalTabProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div
      ref={ref}
      className="terminal"
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="运行终端输出"
      style={{ height: 'calc(100vh - 220px)' }}
    >
      {logs.length === 0 ? (
        <span style={{ color: '#64748b' }}>暂无日志输出，点击「开始测试」启动运行。</span>
      ) : (
        logs.map((l, i) => (
          <div key={i} className={`log-${l.kind}`}>[{l.ts}] {l.text}</div>
        ))
      )}
    </div>
  );
}
