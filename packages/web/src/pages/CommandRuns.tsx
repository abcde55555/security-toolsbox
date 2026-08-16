import { Layout, Typography } from 'antd';
import CommandRunList from '../components/CommandRunList';

const { Content } = Layout;

export default function CommandRuns() {
  return (
    <Content style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>命令执行记录</Typography.Title>
      <CommandRunList />
    </Content>
  );
}
