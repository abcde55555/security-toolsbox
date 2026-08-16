import { useEffect, useState } from 'react';
import {
  Layout, Card, Button, Tag, Space, Typography, Empty, Spin, Modal, Form, Input, Select,
  Table, message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Project, Template, ProjectRun } from '@en18031/shared';
import { ProjectsApi, TemplatesApi } from '../api/endpoints';
import { reportError } from '../api/client';
import { runStatusColor, runStatusText, projectStatusColor, projectStatusText } from '../utils/ui';

const { Content } = Layout;
const { TextArea } = Input;

export default function Projects() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [latestRuns, setLatestRuns] = useState<Record<string, ProjectRun | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [ps, ts] = await Promise.all([ProjectsApi.list(), TemplatesApi.list()]);
      setProjects(ps);
      setTemplates(ts);
      const runs: Record<string, ProjectRun | undefined> = {};
      const results = await Promise.allSettled(ps.map((p) => ProjectsApi.get(p.id)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') runs[ps[i].id] = r.value.latestRun;
      });
      setLatestRuns(runs);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    if (params.get('newFrom')) setOpen(true);
  }, []);

  const submit = async () => {
    const v = await form.validateFields();
    setCreating(true);
    try {
      const project = await ProjectsApi.create({
        name: v.name,
        description: v.description,
        templateId: v.templateId,
        standardVersion: 'EN18031:2019',
        targetComplianceLevel: v.level,
        variables: {},
      });
      message.success('项目已创建');
      setOpen(false);
      form.resetFields();
      navigate(`/projects/${project.id}`);
    } catch (e) {
      reportError(e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Content style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>测试项目</Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建项目</Button>
        </Space>
      </Space>

      {loading ? <Spin /> : projects.length === 0 ? <Empty description="暂无项目，请先创建" /> : (
        <Table
          rowKey="id"
          dataSource={projects}
          onRow={(p) => ({ onClick: () => navigate(`/projects/${p.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '项目名称', dataIndex: 'name', render: (v, r) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{v}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.description}</Typography.Text>
              </Space>
            ) },
            { title: '模板', key: 'tpl', render: (_, r) => {
              const t = templates.find((x) => x.id === r.templateId);
              return t?.name ?? r.templateId;
            } },
            { title: '目标等级', dataIndex: 'targetComplianceLevel', render: (v: string) => <Tag color="blue">{v}</Tag> },
            { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={projectStatusColor[v] ?? 'default'}>{projectStatusText[v] ?? v}</Tag> },
            { title: '最近运行', key: 'run', render: (_, r) => {
              const run = latestRuns[r.id];
              if (!run) return <Typography.Text type="secondary">未运行</Typography.Text>;
              return <Tag color={runStatusColor[run.status]}>{runStatusText[run.status]} {run.progressPercent ?? 0}%</Tag>;
            } },
            { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
          ]}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 760 }}
        />
      )}

      <Modal
        title="新建测试项目"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={creating}
        okText="创建" cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ level: 'L2', templateId: params.get('newFrom') ?? undefined }}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="例如：智能摄像头 X1 合规测试" />
          </Form.Item>
          <Form.Item name="description" label="项目描述"><TextArea rows={2} /></Form.Item>
          <Form.Item name="templateId" label="绑定模板" rules={[{ required: true, message: '请选择模板' }]}>
            <Select placeholder="选择测试模板" options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.steps.length} 步)` }))} />
          </Form.Item>
          <Form.Item name="level" label="目标合规等级" rules={[{ required: true }]}>
            <Select options={[
              { value: 'L1', label: 'L1 - 基础' },
              { value: 'L2', label: 'L2 - 标准' },
              { value: 'L3', label: 'L3 - 增强' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </Content>
  );
}
