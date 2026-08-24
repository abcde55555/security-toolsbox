import { useEffect, useState } from 'react';
import {
  Card,
  Button,
  Table,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Space,
  Tag,
  message,
  Popconfirm,
  Typography,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ApiOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import type { AiProviderConfig } from '@en18031/shared';
import { SettingsApi, type AiProviderForm } from '../api/endpoints';

const { TextArea } = Input;
const { Title, Text } = Typography;

const DEFAULT_FORM: AiProviderForm = {
  name: '',
  protocol: 'openai',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  planningModel: 'deepseek-chat',
  narrativeModel: 'deepseek-chat',
  timeoutMs: 60000,
  maxRetries: 2,
  isActive: false,
};

const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI 兼容（DeepSeek / OpenAI / vLLM / Ollama / Moonshot 等）' },
  { value: 'anthropic', label: 'Anthropic（Claude，messages API）' },
];

// Quick-start presets for common providers.
const PRESETS: Record<string, Partial<AiProviderForm>> = {
  deepseek: {
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    planningModel: 'deepseek-chat',
    narrativeModel: 'deepseek-chat',
  },
  openai: {
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    planningModel: 'gpt-4o',
    narrativeModel: 'gpt-4o-mini',
  },
  anthropic: {
    name: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    planningModel: 'claude-sonnet-4-5-20250929',
    narrativeModel: 'claude-haiku-4-5-20251001',
  },
  ollama: {
    name: 'Ollama（本地）',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    planningModel: 'llama3.1',
    narrativeModel: 'llama3.1',
    apiKey: 'ollama',
  },
  vllm: {
    name: 'vLLM（本地）',
    protocol: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    planningModel: 'model-name',
    narrativeModel: 'model-name',
    apiKey: 'not-needed',
  },
  moonshot: {
    name: 'Moonshot Kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    planningModel: 'moonshot-v1-32k',
    narrativeModel: 'moonshot-v1-8k',
  },
};

export default function Settings() {
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AiProviderConfig | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [form] = Form.useForm<AiProviderForm>();

  async function load() {
    setLoading(true);
    try {
      const res = await SettingsApi.listProviders();
      setProviders(res.providers);
      setActiveId(res.activeId);
    } catch (e) {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate(preset?: string) {
    setEditing(null);
    const presetData = preset ? PRESETS[preset] : undefined;
    form.setFieldsValue({ ...DEFAULT_FORM, ...presetData, isActive: !activeId });
    setModalOpen(true);
  }

  function openEdit(p: AiProviderConfig) {
    setEditing(p);
    form.setFieldsValue({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      apiKey: '',
      planningModel: p.planningModel,
      narrativeModel: p.narrativeModel,
      timeoutMs: p.timeoutMs,
      maxRetries: p.maxRetries,
      isActive: p.isActive,
    });
    setModalOpen(true);
  }

  async function submit() {
    const values = await form.validateFields();
    try {
      await SettingsApi.saveProvider(values);
      message.success(editing ? '已更新' : '已添加');
      setModalOpen(false);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '保存失败';
      message.error(msg);
    }
  }

  async function activate(id: string) {
    try {
      await SettingsApi.activate(id);
      message.success('已设为启用');
      await load();
    } catch {
      message.error('操作失败');
    }
  }

  async function remove(id: string) {
    try {
      await SettingsApi.remove(id);
      message.success('已删除');
      await load();
    } catch {
      message.error('删除失败');
    }
  }

  async function test(id?: string) {
    setTesting(id ?? 'new');
    try {
      const res = await SettingsApi.test(id);
      if (res.ok) {
        message.success(`连接成功（${res.latencyMs}ms，模型 ${res.model}）`);
      } else {
        message.error(res.message ?? '连接失败');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '连接失败';
      message.error(msg);
    } finally {
      setTesting(null);
    }
  }

  function testFromForm() {
    // Save first so the backend can test the candidate.
    form.validateFields().then((values) => {
      SettingsApi.saveProvider(values)
        .then((saved) => test(saved.id))
        .catch(() => message.error('请先修正表单错误'));
    });
  }

  const columns = [
    {
      title: '供应商',
      dataIndex: 'name',
      render: (name: string, r: AiProviderConfig) => (
        <Space>
          {r.isActive ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
          <Text strong>{name}</Text>
          <Tag>{r.protocol}</Tag>
        </Space>
      ),
    },
    { title: 'Base URL', dataIndex: 'baseUrl', ellipsis: true },
    { title: '规划模型', dataIndex: 'planningModel' },
    { title: '成文模型', dataIndex: 'narrativeModel' },
    {
      title: 'Key',
      dataIndex: 'hasKey',
      render: (has: boolean) => (has ? <Tag color="green">已配置</Tag> : <Tag color="red">未配置</Tag>),
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      render: (_: unknown, r: AiProviderConfig) => (
        <Space>
          {!r.isActive && (
            <Button size="small" icon={<CheckCircleOutlined />} onClick={() => activate(r.id)}>
              启用
            </Button>
          )}
          <Button size="small" onClick={() => test(r.id)} loading={testing === r.id}>
            测试
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="删除该供应商？" onConfirm={() => remove(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>
        <ApiOutlined /> 设置 · 大模型供应商
      </Title>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="支持任何 OpenAI 兼容的 API（DeepSeek、OpenAI、Moonshot、本地 vLLM/Ollama 等）。API Key 加密存储于服务端，列表只显示是否已配置，不回显明文。同一时间只有一个供应商启用。"
      />

      <Card
        title="供应商列表"
        extra={
          <Space>
            <Dropdown preset={(k) => openCreate(k)} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
              添加供应商
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={providers}
          columns={columns}
          pagination={false}
          locale={{ emptyText: '尚未配置供应商，点击右上角添加' }}
        />
      </Card>

      <Modal
        title={editing ? '编辑供应商' : '添加供应商'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        width={620}
        footer={
          <Space>
            <Button onClick={() => testFromForm()} loading={testing === 'new'}>
              测试连接
            </Button>
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button type="primary" onClick={submit}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={DEFAULT_FORM}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如 DeepSeek" />
          </Form.Item>
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
            <Select options={PROTOCOL_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }, { type: 'url', message: 'URL 不合法' }]}
          >
            <Input placeholder="https://api.deepseek.com" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label={editing ? 'API Key（留空则不修改）' : 'API Key'}
            rules={editing ? [] : [{ required: true, message: '请输入 API Key' }]}
            extra="密钥仅保存于服务端，不会回显"
          >
            <Input.Password placeholder={editing ? '••••••••（留空保持不变）' : 'sk-...'} />
          </Form.Item>
          <Space.Compact block>
            <Form.Item
              name="planningModel"
              label="规划模型"
              rules={[{ required: true, message: '必填' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="deepseek-chat / gpt-4o" />
            </Form.Item>
            <Form.Item
              name="narrativeModel"
              label="成文模型"
              rules={[{ required: true, message: '必填' }]}
              style={{ flex: 1, marginLeft: 8 }}
            >
              <Input placeholder="deepseek-chat / gpt-4o-mini" />
            </Form.Item>
          </Space.Compact>
          <Space.Compact block>
            <Form.Item name="timeoutMs" label="超时 (ms)" style={{ flex: 1 }}>
              <InputNumber min={5000} step={5000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="maxRetries" label="重试次数" style={{ flex: 1, marginLeft: 8 }}>
              <InputNumber min={0} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="isActive" label="设为启用" valuePropName="checked" style={{ flex: 1, marginLeft: 8 }}>
              <Select
                options={[
                  { value: true, label: '启用' },
                  { value: false, label: '不启用' },
                ]}
              />
            </Form.Item>
          </Space.Compact>
        </Form>
      </Modal>
    </div>
  );
}

/** Quick-add dropdown with presets. */
function Dropdown({ preset }: { preset: (key: string) => void }) {
  const items = [
    { key: 'deepseek', label: 'DeepSeek' },
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic Claude' },
    { key: 'moonshot', label: 'Moonshot Kimi' },
    { key: 'ollama', label: 'Ollama（本地）' },
    { key: 'vllm', label: 'vLLM（本地）' },
  ];
  return (
    <Select
      placeholder="快速添加…"
      style={{ width: 160 }}
      allowClear
      onChange={(v) => v && preset(v)}
      options={items}
    />
  );
}
