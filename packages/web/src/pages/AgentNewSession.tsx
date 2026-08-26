import { useEffect, useMemo, useState } from 'react';
import {
  Layout, Card, Button, Space, Typography, Steps, Select, Form, Input, Tree, Empty,
  Tag, Alert, message, Spin,
} from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ClauseNode, Standard, Tool } from '@en18031/shared';
import { AgentApi, ClausesApi, StandardsApi, ToolsApi } from '../api/endpoints';
import { reportError } from '../api/client';

const { Content } = Layout;

function collectLeafKeys(node: { key: string; isLeaf?: boolean; children?: unknown[] }): string[] {
  const out: string[] = [];
  const walk = (n: typeof node): void => {
    if (n.isLeaf || !n.children || n.children.length === 0) {
      out.push(n.key);
      return;
    }
    n.children.forEach((c) => walk(c as typeof node));
  };
  walk(node);
  return out;
}

interface TreeNode {
  key: string;
  title: React.ReactNode;
  isLeaf: boolean;
  selectable: boolean;
  children?: TreeNode[];
}

function buildTree(nodes: ClauseNode[]): TreeNode[] {
  return nodes.map((n) => {
    const hasChildren = !!n.children && n.children.length > 0;
    return {
      key: n.clauseId,
      title: (
        <Space size={4}>
          <span>{n.clauseId}</span>
          <span style={{ color: '#64748b', fontSize: 12 }}>{n.title}</span>
        </Space>
      ),
      isLeaf: !hasChildren,
      selectable: false,
      children: hasChildren ? buildTree(n.children!) : undefined,
    };
  });
}

export default function AgentNewSession() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [standardId, setStandardId] = useState<string>('');
  const [tree, setTree] = useState<ClauseNode[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [authorizedTools, setAuthorizedTools] = useState<string[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    Promise.all([
      StandardsApi.list().catch(() => [] as Standard[]),
      ToolsApi.list({ pageSize: 500 }).then((r) => r.items).catch(() => [] as Tool[]),
    ]).then(([ss, ts]) => {
      setStandards(ss);
      setTools(ts);
      if (ss[0]) setStandardId(ss[0].id);
    });
  }, []);

  useEffect(() => {
    if (!standardId) return;
    setLoadingTree(true);
    ClausesApi.tree(standardId)
      .then(setTree)
      .catch(() => setTree([]))
      .finally(() => setLoadingTree(false));
    setChecked([]);
  }, [standardId]);

  const leafCount = useMemo(() => {
    let n = 0;
    const walk = (nodes: ClauseNode[]) => {
      for (const node of nodes) {
        if (node.children && node.children.length) walk(node.children);
        else n += 1;
      }
    };
    walk(tree);
    return n;
  }, [tree]);

  // 条款允许全不选：创建后由 Agent 与用户对话确认测试范围（见步骤内提示）
  const canNext = step === 0 ? !!standardId : true;

  const create = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const session = await AgentApi.create({
        standardVersion: standardId,
        selectedClauses: checked,
        deviceProfile: {
          brand: values.brand,
          model: values.model,
          platform: values.platform,
          firmware: values.firmware,
          deviceType: values.deviceType,
          notes: values.notes,
        },
        authorizedTools,
      });
      message.success('会话已创建');
      navigate(`/agent/${session.id}`);
    } catch (e) {
      // antd 校验失败 reject 的是错误字段对象而非 Error——跳回表单步让用户看到红字
      if (e && typeof e === 'object' && !Array.isArray(e) && !(e instanceof Error)) {
        setStep(1);
        message.warning('请先补全第 2 步的必填信息（品牌 / 型号）');
        return;
      }
      if (e instanceof Error && e.message) reportError(e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Content style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/agent')}>返回列表</Button>
        <Typography.Title level={4} style={{ margin: 0 }}>新建 Agent 会话</Typography.Title>
      </Space>

      <Card style={{ maxWidth: 960, margin: '0 auto' }}>
        <Steps
          current={step}
          style={{ marginBottom: 24 }}
          items={[
            { title: '选择标准' },
            { title: '选择条款' },
            { title: '设备档案' },
            { title: '授权工具' },
          ]}
        />

        {step === 0 && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert type="info" showIcon message="选择要遵循的合规标准。标准与条款均由数据驱动，不绑定具体法规。" />
            <div>
              <Typography.Text strong>合规标准：</Typography.Text>
              <Select
                style={{ width: 360, marginLeft: 12 }}
                placeholder="选择标准"
                value={standardId || undefined}
                onChange={setStandardId}
                options={standards.map((s) => ({ value: s.id, label: `${s.name} (${s.version})` }))}
              />
            </div>
            {standards.length === 0 && (
              <Empty description="暂无标准——先去创建标准并导入条款，再回到这里新建会话">
                <Button type="primary" onClick={() => navigate('/clauses')}>去创建标准</Button>
              </Empty>
            )}
          </Space>
        )}

        {step === 1 && (
          <Spin spinning={loadingTree}>
            <Alert
              type={checked.length === 0 ? 'warning' : 'info'}
              showIcon
              style={{ marginBottom: 12 }}
              message={
                checked.length === 0
                  ? '当前未选择任何条款——可以直接进入下一步，创建后 Agent 会先与你确认测试范围；也可以现在勾选，Agent 将直接按所选条款执行。'
                  : `勾选要测试的条款（共 ${leafCount} 个叶子条款，已选 ${checked.length} 个）。勾选父节点会选中其下所有叶子条款。`
              }
            />
            {tree.length === 0 && !loadingTree ? (
              <Empty description="该标准下暂无条款" />
            ) : (
              <div style={{ maxHeight: 480, overflow: 'auto', border: '1px solid #eef0f4', borderRadius: 8, padding: 8 }}>
                <Tree
                  checkable
                  defaultExpandAll
                  selectable={false}
                  checkedKeys={checked}
                  treeData={buildTree(tree)}
                  onCheck={(_keys, info) => {
                    const node = info.node as unknown as { key: string; isLeaf?: boolean; children?: unknown[] };
                    if (node.isLeaf) {
                      setChecked((prev) => prev.includes(node.key) ? prev.filter((k) => k !== node.key) : [...prev, node.key]);
                    } else {
                      const leaves = collectLeafKeys(node);
                      const checking = info.checked;
                      setChecked((prev) => {
                        if (checking) return Array.from(new Set([...prev, ...leaves]));
                        return prev.filter((k) => !leaves.includes(k));
                      });
                    }
                  }}
                />
              </div>
            )}
          </Spin>
        )}

        {step === 2 && (
          <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="设备档案帮助 Agent 检索相关经验并规划接入步骤，品牌与型号为必填。" />
            <Form.Item name="brand" label="品牌" rules={[{ required: true, message: '请填写品牌' }]}>
              <Input placeholder="如：Xiaomi / Little Genius" />
            </Form.Item>
            <Form.Item name="model" label="型号" rules={[{ required: true, message: '请填写型号' }]}>
              <Input placeholder="如：Z6s" />
            </Form.Item>
            <Form.Item name="platform" label="芯片/平台">
              <Input placeholder="如：展锐 UIS8540E" />
            </Form.Item>
            <Form.Item name="firmware" label="固件版本">
              <Input placeholder="如：2.0.3" />
            </Form.Item>
            <Form.Item name="deviceType" label="设备类型">
              <Input placeholder="如：儿童手表 / 摄像头 / 智能音箱" />
            </Form.Item>
            <Form.Item name="notes" label="备注">
              <Input.TextArea rows={3} placeholder="接入方式、已知限制、网络环境等" />
            </Form.Item>
          </Form>
        )}

        {step === 3 && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert type="info" showIcon message="选择允许 Agent 自动调用的工具（白名单）。未勾选的工具需经人工执行。" />
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="选择授权工具（可留空，后续在会话中授权）"
              value={authorizedTools}
              onChange={setAuthorizedTools}
              options={tools.map((t) => ({ value: t.id, label: `${t.name} (${t.category})` }))}
              optionFilterProp="label"
            />
            <Space wrap>
              {authorizedTools.map((id) => {
                const t = tools.find((x) => x.id === id);
                return <Tag key={id} color="blue">{t?.name ?? id}</Tag>;
              })}
            </Space>
          </Space>
        )}

        <Space style={{ marginTop: 24, justifyContent: 'flex-end', width: '100%' }}>
          {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>上一步</Button>}
          {step < 3 ? (
            <Button type="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>下一步</Button>
          ) : (
            <Button type="primary" icon={<CheckCircleOutlined />} loading={creating} onClick={create}>
              创建并开始
            </Button>
          )}
        </Space>
      </Card>
    </Content>
  );
}
