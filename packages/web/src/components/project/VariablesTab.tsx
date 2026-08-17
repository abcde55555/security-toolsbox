import { Card, Button, Empty, Table, Tag, Typography } from 'antd';
import type { Project, Template } from '@en18031/shared';

interface VariablesTabProps {
  project: Project;
  template?: Template;
  onEdit: () => void;
}

export default function VariablesTab({ project, template, onEdit }: VariablesTabProps) {
  const vars = template?.variables ?? [];
  return (
    <Card
      title="项目变量"
      extra={<Button type="primary" onClick={onEdit}>编辑 JSON</Button>}
    >
      {vars.length === 0 ? (
        <Empty description="模板未声明变量；可直接编辑自由变量 JSON" />
      ) : (
        <Table
          rowKey="name"
          pagination={false}
          dataSource={vars}
          columns={[
            { title: '变量名', dataIndex: 'name', render: (v: string) => <code className="mono">{`{{${v}}}`}</code> },
            { title: '标签', dataIndex: 'label' },
            { title: '类型', dataIndex: 'type', render: (v: string) => <Tag>{v}</Tag> },
            { title: '必填', dataIndex: 'required', render: (v: boolean) => (v ? <Tag color="red">是</Tag> : '否') },
            { title: '默认值', dataIndex: 'default', render: (v: unknown) => (v === undefined ? '-' : String(v)) },
            {
              title: '当前值',
              key: 'cur',
              render: (_, r) => {
                const cur = (project.variables as Record<string, unknown>)[r.name];
                return cur === undefined ? <Typography.Text type="secondary">未设置</Typography.Text> : String(cur);
              },
            },
          ]}
        />
      )}
      <Typography.Title level={5} style={{ marginTop: 16 }}>原始变量 JSON</Typography.Title>
      <pre className="terminal" style={{ height: 200 }}>{JSON.stringify(project.variables, null, 2)}</pre>
    </Card>
  );
}
