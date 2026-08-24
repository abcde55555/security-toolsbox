import { Layout, Menu } from 'antd';
import { AppstoreOutlined, ProfileOutlined, ExperimentOutlined, HistoryOutlined, SafetyCertificateOutlined, RobotOutlined, SettingOutlined } from '@ant-design/icons';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
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

const { Header, Content } = Layout;

const navItems = [
  { key: '/tools', icon: <AppstoreOutlined />, label: '工具库' },
  { key: '/clauses', icon: <SafetyCertificateOutlined />, label: '合规测试项' },
  { key: '/templates', icon: <ProfileOutlined />, label: '模板' },
  { key: '/projects', icon: <ExperimentOutlined />, label: '项目' },
  { key: '/agent', icon: <RobotOutlined />, label: 'Agent 测试' },
  { key: '/runs', icon: <HistoryOutlined />, label: '执行记录' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

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
        <div style={{ color: '#cbd5e1', fontSize: 13 }}>本地管理员</div>
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
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </Content>
    </Layout>
  );
}
