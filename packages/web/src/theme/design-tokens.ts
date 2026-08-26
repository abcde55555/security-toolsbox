/**
 * 设计令牌（Design Tokens）—— UX 大改的前端地基。
 *
 * 使用约定：
 * - 页面/组件里的间距、圆角、阴影、语义色一律从这里取值；
 *   禁止新增魔法数字（#d97706、padding: 16 这类存量值在触碰到时顺手迁移）。
 * - 间距只有 5 档：4 / 8 / 12 / 16 / 24；更大留白用档位组合表达（如 space.xl * 2）。
 * - 语义色按「家族」取用：main 用于图标/强描边，bg 用于浅色底，border 用于描边；
 *   antd Tag 直接用 antdTag 映射，保证标签颜色与自绘元素同源。
 * - 「等待人工」是本产品的核心状态：与 warning 同为暖色系但强调更高（更实的描边 +
 *   脉冲光环），并与表示 Agent 活动的 inProgress（蓝）明确区分，二者不可混用。
 */

import type { CSSProperties } from 'react';

/** 间距：全站唯一刻度 */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** 圆角 */
export const radius = { sm: 4, md: 6, lg: 8, pill: 999 } as const;

/** 字号：辅助文本统一刻度（正文走 antd 默认 14） */
export const fontSize = { xs: 11, sm: 12, md: 13 } as const;

/** 阴影：静态卡片极轻，可点击/悬浮卡片加强 */
export const shadow = {
  card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
  cardHover: '0 4px 16px rgba(37, 99, 235, 0.10)',
  /** 等待人工时的脉冲光环底色（配合 .agent-human-pulse 动画） */
  waitingPulse: '0 0 0 3px rgba(217, 119, 6, 0.15)',
} as const;

/** 中性色 */
export const neutral = {
  textPrimary: '#1e293b',
  textSecondary: '#475569',
  textTertiary: '#94a3b8',
  border: '#e2e8f0',
  borderLight: '#eef0f4',
  bgPage: '#f5f7fa',
  bgCard: '#ffffff',
  bgSubtle: '#f8fafc',
} as const;

export interface SemanticPalette {
  /** 主色：图标、强调描边、彩色文字 */
  main: string;
  /** 浅色底：状态卡片/横幅背景 */
  bg: string;
  /** 描边 */
  border: string;
  /** antd Tag color 属性映射 */
  antdTag: 'success' | 'warning' | 'processing' | 'error' | 'default';
}

/** 语义色家族：成功 / 警告 / 进行中 / 等待人工 / 危险失败 */
export const semantic = {
  /** 成功：步骤通过、判定 PASS、上传完成 */
  success: {
    main: '#16a34a',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    antdTag: 'success',
  },
  /** 警告：超时、部分完成等需要注意但无需人工介入的状态 */
  warning: {
    main: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    antdTag: 'warning',
  },
  /** 进行中：Agent / 命令正在执行的活动状态 */
  inProgress: {
    main: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    antdTag: 'processing',
  },
  /**
   * 等待人工：需要用户行动的门禁状态。有意复用 warning 的暖色相以保证存量视觉零回归，
   * 但描边更强、且独享脉冲光环（shadow.waitingPulse）；永远不要用 inProgress 表达它。
   */
  waitingHuman: {
    main: '#d97706',
    bg: '#fffbeb',
    border: '#f59e0b',
    antdTag: 'warning',
  },
  /** 危险/失败：判定 FAIL、命令报错 */
  danger: {
    main: '#dc2626',
    bg: '#fef2f2',
    border: '#fecaca',
    antdTag: 'error',
  },
} as const satisfies Record<string, SemanticPalette>;

/** 卡片基础样式：新代码直接展开使用（{...cardBase}），替代手写 border+radius+shadow */
export const cardBase: CSSProperties = {
  background: neutral.bgCard,
  border: `1px solid ${neutral.borderLight}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
};

/** 页头说明文案的统一样式：标题下的一行灰字 */
export const pageDescriptionStyle: CSSProperties = {
  display: 'block',
  marginTop: space.xs,
  fontSize: fontSize.md,
  color: neutral.textSecondary,
};
