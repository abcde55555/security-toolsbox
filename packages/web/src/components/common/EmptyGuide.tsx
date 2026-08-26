import type { CSSProperties, ReactNode } from 'react';
import { Button, Typography } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { space, radius, fontSize, neutral } from '../../theme/design-tokens';

/**
 * 统一空态 EmptyGuide —— 全站规范：空态必须带行动引导。
 * 只说「暂无数据」不说「下一步做什么」是反模式；因此 action 是必填项，
 * 类型层面强制每个使用方给出至少一个可点击的出路。
 */
export interface EmptyGuideAction {
  label: string;
  onClick?: () => void;
  /** 外链场景；设置 href 后 onClick 可省略 */
  href?: string;
}

export default function EmptyGuide({
  title,
  hint,
  action,
  icon,
  compact,
  style,
}: {
  /** 一句话说清「这里是什么、为什么是空的」 */
  title: ReactNode;
  /** 行动前的补充说明：怎么做/做了会怎样 */
  hint?: ReactNode;
  /** 行动引导（必填）：第一个渲染为主按钮，其余为次按钮 */
  action: EmptyGuideAction | EmptyGuideAction[];
  icon?: ReactNode;
  /** 紧凑模式：表格内嵌、卡片内小空间使用 */
  compact?: boolean;
  style?: CSSProperties;
}) {
  const actions = Array.isArray(action) ? action : [action];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: compact ? `${space.lg}px ${space.md}px` : `48px ${space.lg}px`,
        ...style,
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: radius.pill,
          background: neutral.bgSubtle,
          border: `1px solid ${neutral.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          color: neutral.textTertiary,
          marginBottom: space.md,
        }}
      >
        {icon ?? <InboxOutlined />}
      </div>
      <Typography.Text strong>{title}</Typography.Text>
      {hint && (
        <Typography.Text
          type="secondary"
          style={{ fontSize: fontSize.md, marginTop: space.xs, maxWidth: 420 }}
        >
          {hint}
        </Typography.Text>
      )}
      <div style={{ marginTop: space.md, display: 'flex', gap: space.sm }}>
        {actions.map((a) =>
          a.href ? (
            <Button key={a.label} type="primary" href={a.href} target="_blank" rel="noreferrer">
              {a.label}
            </Button>
          ) : (
            <Button key={a.label} type="primary" onClick={a.onClick}>
              {a.label}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
