import { useState } from 'react';
import { Modal, List, Button, Input, Space, Tag, Popconfirm, Typography, Form, message, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined, PlusOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { CategoriesApi, type ToolCategoryInfo } from '../api/endpoints';
import { reportError } from '../api/client';
import { useCategories } from '../hooks/useCategories';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export default function CategoryManager({ open, onClose, onChanged }: Props) {
  const { categories, refresh } = useCategories();
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const create = async () => {
    const label = newLabel.trim();
    if (!label) { message.error('请输入分类名称'); return; }
    try {
      await CategoriesApi.create({ key: newKey.trim() || undefined, label });
      message.success('分类已创建');
      setCreating(false);
      setNewLabel('');
      setNewKey('');
      await refresh();
      onChanged();
    } catch (e) { reportError(e); }
  };

  const saveEdit = async (key: string) => {
    try {
      await CategoriesApi.update(key, editLabel.trim());
      message.success('已更新');
      setEditing(null);
      await refresh();
      onChanged();
    } catch (e) { reportError(e); }
  };

  const move = async (key: string, dir: -1 | 1) => {
    try {
      await CategoriesApi.reorder(key, dir);
      await refresh();
      onChanged();
    } catch (e) { reportError(e); }
  };

  const remove = async (c: ToolCategoryInfo) => {
    try {
      const res = await CategoriesApi.remove(c.key);
      message.success(
        c.builtin
          ? '该分类为内置分类，无法删除'
          : res.reassigned > 0
            ? `已删除，${res.reassigned} 个工具归到「其他」`
            : '已删除',
      );
      await refresh();
      onChanged();
    } catch (e) { reportError(e); }
  };

  return (
    <Modal
      title="管理工具分类"
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        初始分类为内置（不可删除）。可新建自定义分类；删除自定义分类时，其下工具会自动归到「其他」。
      </Typography.Paragraph>

      <List
        size="small"
        bordered
        dataSource={categories}
        renderItem={(c, idx) => (
          <List.Item
            actions={[
              <Tooltip key="up" title="上移">
                <Button size="small" type="text" icon={<ArrowUpOutlined />}
                  disabled={idx === 0} onClick={() => move(c.key, -1)} />
              </Tooltip>,
              <Tooltip key="down" title="下移">
                <Button size="small" type="text" icon={<ArrowDownOutlined />}
                  disabled={idx === categories.length - 1} onClick={() => move(c.key, 1)} />
              </Tooltip>,
              ...(c.builtin
                ? [<Tag key="b" color="default">内置</Tag>]
                : [
                    <Button key="e" size="small" type="text" icon={<EditOutlined />}
                      onClick={() => { setEditing(c.key); setEditLabel(c.label); }} />,
                    <Popconfirm key="d" title={`删除分类「${c.label}」?`} onConfirm={() => remove(c)}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]),
            ]}
          >
            {editing === c.key ? (
              <Space>
                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} autoFocus />
                <Button size="small" type="primary" onClick={() => saveEdit(c.key)}>保存</Button>
                <Button size="small" onClick={() => setEditing(null)}>取消</Button>
              </Space>
            ) : (
              <Space>
                <Typography.Text strong>{c.label}</Typography.Text>
                <code className="mono" style={{ color: '#94a3b8', fontSize: 12 }}>{c.key}</code>
              </Space>
            )}
          </List.Item>
        )}
        style={{ marginBottom: 12 }}
      />

      {creating ? (
        <Form layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="分类名称" required>
            <Input
              placeholder="如 无线安全"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              autoFocus
            />
          </Form.Item>
          <Form.Item label="标识（可选，留空自动生成）" tooltip="英文 key，如 wireless-security">
            <Input
              placeholder="wireless-security"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="mono"
            />
          </Form.Item>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void create()}>创建</Button>
            <Button onClick={() => { setCreating(false); setNewLabel(''); setNewKey(''); }}>取消</Button>
          </Space>
        </Form>
      ) : (
        <Button block type="dashed" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          新建分类
        </Button>
      )}
    </Modal>
  );
}
