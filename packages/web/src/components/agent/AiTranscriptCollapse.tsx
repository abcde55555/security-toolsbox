import { Collapse, Tag, Typography, Space } from 'antd';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import type { TranscriptMessage } from './types';

/** Collapsible model/user message transcript shown at the bottom of the session page. */
export default function AiTranscriptCollapse({ messages }: { messages: TranscriptMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <Collapse
      size="small"
      style={{ background: '#fff', borderTop: '1px solid #e2e8f0' }}
      items={[
        {
          key: 'transcript',
          label: (
            <Space>
              <RobotOutlined />
              <span>AI 规划记录</span>
              <Tag>{messages.length}</Tag>
            </Space>
          ),
          children: (
            <div style={{ maxHeight: 240, overflow: 'auto', paddingRight: 8 }}>
              {messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: 8,
                    padding: '6px 10px',
                    background: m.role === 'user' ? '#eff6ff' : '#f8fafc',
                    borderRadius: 6,
                    borderLeft: `3px solid ${m.role === 'user' ? '#2563eb' : '#7c3aed'}`,
                  }}
                >
                  <Space size={6} style={{ marginBottom: 2 }}>
                    {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {m.role === 'user' ? '你' : m.role}
                    </Typography.Text>
                  </Space>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{m.content}</div>
                </div>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}
