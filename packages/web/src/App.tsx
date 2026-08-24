import { Layout, Menu, Badge, Button, Empty, List, Popover, Tag, Tooltip, Typography } from 'antd';
import {
  AppstoreOutlined,
  BellOutlined,
  BookOutlined,
  ProfileOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { Notification } from '@en18031/shared';
import ToolLibrary from './pages/ToolLibrary';
import Templates from './pages/Templates';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import CommandRuns from './pages/CommandRuns';
import Clauses from './pages/Clauses';
import AgentSessions from './pages/AgentSessions';
import AgentNewSession from './pages/AgentNewSession';
import AgentSessionDetail from './pages/AgentSessionDetail';
import Settings from './pages/Settings';
import Knowledge from './pages/Knowledge';
import { useNotifications } from './hooks/useNotifications';

const { Header, Content } = Layout;

const navItems = [
  { key: '/tools', icon: <AppstoreOutlined />, label: '工具库' },
  { key: '/clauses', icon: <SafetyCertificateOutlined />, label: '合规测试项' },
  { key: '/templates', icon: <ProfileOutlined />, label: '模板' },
  { key: '/projects', icon: <ExperimentOutlined />, label: '项目' },
  { key: '/agent', icon: <RobotOutlined />, label: 'Agent 测试' },
  { key: '/knowledge', icon: <BookOutlined />, label: '知识库' },
  { key: '/runs', icon: <HistoryOutlined />, label: '执行记录' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

const NOTIFICATION_TYPE_TEXT: Record<string, string> = {
  tool_sediment: '工具沉淀',
  skill_sediment: '技能沉淀',
  evidence_gap: '证据缺口',
  template_save: '模板沉淀',
  config_fix: '配置修复',
  review_hint: '复核提醒',
};

type BellAction = 'accept' | 'open' | 'read' | 'dismiss';

function notificationActions(n: Notification): readonly BellAction[] {
  if (n.type === 'skill_sediment') return ['accept', 'dismiss'] as const;
  if (n.type === 'template_save') return ['open', 'dismiss'] as const;
  return ['read', 'dismiss'] as const;
}

function NotificationBell() {
  const navigate = useNavigate();
  const { items, unread, markRead, dismiss, acceptSkill, refresh } = useNotifications();
  return (
    <Popover
      placement="bottomRight"
      trigger="click"
      onOpenChange={(open) => open && void refresh()}
      styles={{ body: { width: 380 } }}
      title={
        <span>
          通知 <Tag style={{ marginLeft: 4 }}>{unread} 条未读</Tag>
        </span>
      }
      content={
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
          ) : (
            <List
              size="small"
              dataSource={items}
              renderItem={(n) => {
                const actions = notificationActions(n);
                const settled = n.status === 'accepted' || n.status === 'dismissed';
                return (
                  <List.Item
                    style={{
                      background: n.status === 'unread' ? '#eff6ff' : undefined,
                      borderRadius: 6,
                      paddingInline: 8,
                      display: 'block',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tag
                        color={
                          n.type === 'skill_sediment'
                            ? 'purple'
                            : n.type === 'template_save'
                              ? 'geekblue'
                              : 'default'
                        }
                      >
                        {NOTIFICATION_TYPE_TEXT[n.type] ?? n.type}
                      </Tag>
                      <Typography.Text strong ellipsis style={{ flex: 1 }}>
                        {n.title}
                      </Typography.Text>
                    </div>
                    {n.message && (
                      <Typography.Paragraph
                        type="secondary"
                        ellipsis={{ rows: 2 }}
                        style={{ marginBottom: 4, marginTop: 2 }}
                      >
                        {n.message}
                      </Typography.Paragraph>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {!settled && actions.includes('accept') && (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() =>
                            acceptSkill(n.id)
                              .then(() => void refresh())
                              .catch(() => undefined)
                          }
                        >
                          采纳为技能
                        </Button>
                      )}
                      {!settled && actions.includes('open') && n.projectId && (
                        <Button size="small" onClick={() => navigate(`/projects/${n.projectId}`)}>
                          查看项目
                        </Button>
                      )}
                      {!settled && n.status === 'unread' && actions.includes('read') && (
                        <Button size="small" onClick={() => markRead(n.id)}>
                          已读
                        </Button>
                      )}
                      {!settled && (
                        <Button size="small" type="text" onClick={() => dismiss(n.id)}>
                          忽略
                        </Button>
                      )}
                      {n.status === 'accepted' && <Tag color="green">已采纳</Tag>}
                      {n.status === 'dismissed' && <Tag>已忽略</Tag>}
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </div>
      }
    >
      <Badge count={unread} size="small" offset={[-2, 2]}>
        <Tooltip title="通知">
          <Button type="text" icon={<BellOutlined style={{ color: '#e2e8f0', fontSize: 18 }} />} />
        </Tooltip>
      </Badge>
    </Popover>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const selected = navItems.find((n) => location.pathname.startsWith(n.key))?.key ?? '/projects';

  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', background: '#0f172a', paddingInline: 20 }}>
        <div className="app-logo" style={{ marginRight: 40 }}>
          <span className="brand-dot" />
          EN18031 合规测试平台
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selected]}
          items={navItems}
          onClick={(e) => navigate(e.key)}
          style={{ flex: 1, minWidth: 0, background: 'transparent' }}
        />
        <NotificationBell />
        <div style={{ color: '#cbd5e1', fontSize: 13, marginLeft: 12 }}>本地管理员</div>
      </Header>
      <Content style={{ overflow: 'hidden' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/tools" element={<ToolLibrary />} />
          <Route path="/clauses" element={<Clauses />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/agent" element={<AgentSessions />} />
          <Route path="/agent/new" element={<AgentNewSession />} />
          <Route path="/agent/:sessionId" element={<AgentSessionDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/runs" element={<CommandRuns />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </Content>
    </Layout>
  );
}
