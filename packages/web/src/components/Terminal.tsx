import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Space, Tooltip, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

export interface TerminalLine {
  key?: string;
  text: string;
  kind?: 'in' | 'err' | 'ok' | 'warn';
  stream?: 'stdout' | 'stderr';
}

export function useLogBuffer(cap = 2000) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const seq = useRef(0);

  const append = useCallback(
    (text: string, kind: TerminalLine['kind'] = 'in', stream?: TerminalLine['stream']) => {
      const parts = text.split(/\r?\n/).filter((p) => p.length > 0);
      if (parts.length === 0) return;
      setLines((prev) => {
        const next = [...prev];
        for (const p of parts) {
          seq.current += 1;
          next.push({ key: String(seq.current), text: p, kind, stream });
        }
        return next.length > cap ? next.slice(next.length - cap) : next;
      });
    },
    [cap],
  );

  const reset = useCallback(() => {
    seq.current = 0;
    setLines([]);
  }, []);

  return { lines, append, reset, setLines };
}

function kindOf(line: TerminalLine): string {
  if (line.kind) return `log-${line.kind}`;
  if (line.stream === 'stderr') return 'log-err';
  return '';
}

export default function Terminal({
  lines,
  height,
  empty = '暂无输出',
  extra,
}: {
  lines: TerminalLine[];
  height?: number | string;
  empty?: string;
  extra?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const copy = () => {
    const text = lines.map((l) => l.text).join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => message.success('输出已复制'),
      () => message.error('复制失败'),
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <Space size={6}>
          {extra}
          <Tooltip title="复制全部输出">
            <Button size="small" icon={<CopyOutlined />} onClick={copy}>
              复制输出
            </Button>
          </Tooltip>
        </Space>
      </div>
      <div ref={ref} className="terminal" style={height !== undefined ? { height } : undefined}>
        {lines.length === 0 ? (
          <span style={{ color: '#64748b' }}>{empty}</span>
        ) : (
          lines.map((l) => (
            <div key={l.key} className={kindOf(l)}>
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
