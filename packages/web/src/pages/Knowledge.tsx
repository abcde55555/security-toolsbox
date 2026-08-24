import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ExperimentOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { KnowledgeNote, Skill } from '@en18031/shared';
import { KnowledgeApi, SkillsApi } from '../api/endpoints';

const SOURCE_TYPE_TEXT: Record<KnowledgeNote['sourceType'], string> = {
  manual: '手工记录',
  url: '网页摘录',
  case: '案例沉淀',
};

const SKILL_STATUS_META: Record<Skill['status'], { text: string; color: string }> = {
  draft: { text: '草稿', color: 'orange' },
  approved: { text: '已批准', color: 'green' },
  archived: { text: '已归档', color: 'default' },
};

function whenToUseOf(skill: Skill): string {
  const v = (skill.frontmatter as { whenToUse?: unknown }).whenToUse;
  return typeof v === 'string' ? v : '';
}

interface NoteFormValues {
  title: string;
  content: string;
  tags?: string[];
  sourceType: KnowledgeNote['sourceType'];
  sourceUrl?: string;
}

export default function Knowledge() {
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [noteKeyword, setNoteKeyword] = useState('');
  const [skillKeyword, setSkillKeyword] = useState('');

  // note editor state
  const [noteEditor, setNoteEditor] = useState<{ open: boolean; editing: KnowledgeNote | null }>({
    open: false,
    editing: null,
  });
  const [noteForm] = Form.useForm<NoteFormValues>();
  const [compilingId, setCompilingId] = useState<string | null>(null);

  // skill viewers
  const [viewingSkill, setViewingSkill] = useState<Skill | null>(null);
  const [versionOf, setVersionOf] = useState<{ key: string; items: Skill[] } | null>(null);

  const loadNotes = useCallback(async (keyword?: string) => {
    try {
      setNotes(await KnowledgeApi.list(keyword || undefined));
    } catch (e) {
      message.error((e as Error).message);
    }
  }, []);

  const loadSkills = useCallback(async (keyword?: string) => {
    try {
      setSkills(await SkillsApi.list(keyword || undefined));
    } catch (e) {
      message.error((e as Error).message);
    }
  }, []);

  const reloadAll = useCallback(() => {
    setLoading(true);
    Promise.all([loadNotes(noteKeyword), loadSkills(skillKeyword)]).finally(() => setLoading(false));
  }, [loadNotes, loadSkills, noteKeyword, skillKeyword]);

  useEffect(() => {
    void loadNotes();
    void loadSkills();
  }, [loadNotes, loadSkills]);

  const openCreate = () => {
    setNoteEditor({ open: true, editing: null });
    noteForm.resetFields();
    noteForm.setFieldsValue({ sourceType: 'manual' });
  };

  const openEdit = (n: KnowledgeNote) => {
    setNoteEditor({ open: true, editing: n });
    noteForm.setFieldsValue({
      title: n.title,
      content: n.content,
      tags: n.tags,
      sourceType: n.sourceType,
      sourceUrl: n.sourceUrl,
    });
  };

  const submitNote = async () => {
    const values = await noteForm.validateFields();
    try {
      if (noteEditor.editing) {
        await KnowledgeApi.update(noteEditor.editing.id, values);
        message.success('笔记已更新');
      } else {
        await KnowledgeApi.create(values);
        message.success('笔记已保存');
      }
      setNoteEditor({ open: false, editing: null });
      void loadNotes(noteKeyword);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const compileNote = async (n: KnowledgeNote) => {
    setCompilingId(n.id);
    message.loading({ content: `正在用 AI 编译「${n.title}」…`, key: n.id, duration: 0 });
    try {
      const { skill, warnings } = await KnowledgeApi.compile(n.id);
      message.success({ content: '已生成技能草稿', key: n.id });
      void loadSkills(skillKeyword);
      Modal.info({
        title: `编译完成：${skill.title}`,
        width: 640,
        content: (
          <div>
            <p>
              <Tag>{skill.skillKey}</Tag>
              <Tag color="orange">草稿</Tag> v{skill.version}
            </p>
            <Typography.Paragraph ellipsis={{ rows: 6 }} style={{ whiteSpace: 'pre-wrap' }}>
              {skill.body}
            </Typography.Paragraph>
            {warnings.length > 0 && <Alert type="warning" showIcon message={warnings.join('；')} />}
            <p style={{ color: '#64748b' }}>可在「技能库」中审阅后批准，批准后 Agent 规划时会自动参考。</p>
          </div>
        ),
      });
    } catch (e) {
      message.error({ content: (e as Error).message, key: n.id });
    } finally {
      setCompilingId(null);
    }
  };

  const approveSkill = async (s: Skill) => {
    try {
      await SkillsApi.approve(s.id);
      message.success(`技能「${s.title}」已批准，Agent 将在后续会话中参考`);
      void loadSkills(skillKeyword);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const archiveSkill = async (s: Skill) => {
    try {
      await SkillsApi.archive(s.id);
      message.success('技能已归档');
      void loadSkills(skillKeyword);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const showVersions = async (s: Skill) => {
    try {
      setVersionOf({ key: s.skillKey, items: await SkillsApi.versions(s.id) });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const filteredNotes = useMemo(() => notes, [notes]);

  return (
    <div style={{ padding: 20, height: '100%', overflow: 'auto' }}>
      <Tabs
        defaultActiveKey="notes"
        items={[
          {
            key: 'notes',
            label: '经验笔记',
            children: (
              <>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Input.Search
                    placeholder="搜索标题/内容/标签"
                    allowClear
                    style={{ width: 280 }}
                    onSearch={(v) => {
                      setNoteKeyword(v);
                      void loadNotes(v);
                    }}
                  />
                  <Button icon={<PlusOutlined />} type="primary" onClick={openCreate}>
                    新建笔记
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={() => void loadNotes(noteKeyword)} />
                </Space>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="把做过的案例经验写成笔记，AI 会将其编译为结构化技能（前置条件→步骤→判读要点）；批准后的技能会在 Agent 规划时自动注入。"
                />
                <Table<KnowledgeNote>
                  rowKey="id"
                  size="small"
                  loading={loading}
                  dataSource={filteredNotes}
                  locale={{ emptyText: <Empty description="还没有经验笔记" /> }}
                  pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 条` }}
                  columns={[
                    {
                      title: '标题',
                      dataIndex: 'title',
                      render: (v: string, r) => (
                        <a onClick={() => openEdit(r)}>{v}</a>
                      ),
                    },
                    {
                      title: '标签',
                      dataIndex: 'tags',
                      render: (tags: string[]) =>
                        tags.map((t) => (
                          <Tag key={t} style={{ marginBottom: 2 }}>
                            {t}
                          </Tag>
                        )),
                    },
                    {
                      title: '来源',
                      dataIndex: 'sourceType',
                      width: 100,
                      render: (v: KnowledgeNote['sourceType']) => SOURCE_TYPE_TEXT[v] ?? v,
                    },
                    {
                      title: '更新时间',
                      dataIndex: 'updatedAt',
                      width: 170,
                      render: (v: string) => new Date(v).toLocaleString(),
                    },
                    {
                      title: '操作',
                      width: 240,
                      render: (_, r) => (
                        <Space>
                          <Tooltip title="用 AI 把笔记编译成技能草稿">
                            <Button
                              size="small"
                              icon={<ThunderboltOutlined />}
                              loading={compilingId === r.id}
                              onClick={() => void compileNote(r)}
                            >
                              编译为技能
                            </Button>
                          </Tooltip>
                          <Button size="small" onClick={() => openEdit(r)}>
                            编辑
                          </Button>
                          <Popconfirm
                            title="删除这条笔记？"
                            onConfirm={async () => {
                              try {
                                await KnowledgeApi.remove(r.id);
                                message.success('已删除');
                                void loadNotes(noteKeyword);
                              } catch (e) {
                                message.error((e as Error).message);
                              }
                            }}
                          >
                            <Button size="small" danger type="text">
                              删除
                            </Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'skills',
            label: '技能库',
            children: (
              <>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Input.Search
                    placeholder="搜索 key/标题/正文"
                    allowClear
                    style={{ width: 280 }}
                    onSearch={(v) => {
                      setSkillKeyword(v);
                      void loadSkills(v);
                    }}
                  />
                  <Button icon={<ReloadOutlined />} onClick={() => void loadSkills(skillKeyword)} />
                </Space>
                <Table<Skill>
                  rowKey="id"
                  size="small"
                  loading={loading}
                  dataSource={skills}
                  locale={{ emptyText: <Empty description="技能库为空——先在笔记中积累经验并编译" /> }}
                  pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 条` }}
                  columns={[
                    {
                      title: 'Key',
                      dataIndex: 'skillKey',
                      width: 200,
                      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
                    },
                    {
                      title: '标题',
                      dataIndex: 'title',
                      render: (v: string, r) => <a onClick={() => setViewingSkill(r)}>{v}</a>,
                    },
                    { title: '版本', dataIndex: 'version', width: 70 },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 90,
                      render: (v: Skill['status']) => (
                        <Tag color={SKILL_STATUS_META[v]?.color}>{SKILL_STATUS_META[v]?.text ?? v}</Tag>
                      ),
                    },
                    {
                      title: '适用场景',
                      ellipsis: true,
                      render: (_, r) => (
                        <Typography.Text type="secondary" ellipsis style={{ maxWidth: 260 }}>
                          {whenToUseOf(r) || '—'}
                        </Typography.Text>
                      ),
                    },
                    {
                      title: '操作',
                      width: 250,
                      render: (_, r) => (
                        <Space>
                          <Button size="small" onClick={() => setViewingSkill(r)}>
                            查看
                          </Button>
                          {r.status === 'draft' && (
                            <Button size="small" type="primary" onClick={() => void approveSkill(r)}>
                              批准
                            </Button>
                          )}
                          {r.status !== 'archived' && (
                            <Popconfirm title="归档后不再注入 Agent 提示词，确认？" onConfirm={() => void archiveSkill(r)}>
                              <Button size="small">归档</Button>
                            </Popconfirm>
                          )}
                          <Button size="small" type="text" icon={<ExperimentOutlined />} onClick={() => void showVersions(r)} />
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      {/* 笔记新建/编辑 */}
      <Modal
        open={noteEditor.open}
        title={noteEditor.editing ? '编辑经验笔记' : '新建经验笔记'}
        width={720}
        onCancel={() => setNoteEditor({ open: false, editing: null })}
        onOk={() => void submitNote()}
        okText="保存"
      >
        <Form<NoteFormValues> form={noteForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：BLE 手环进入测试模式的方法" />
          </Form.Item>
          <Form.Item
            name="content"
            label="正文（步骤越具体，编译出的技能越可用）"
            rules={[{ required: true, message: '请输入正文' }]}
          >
            <Input.TextArea rows={10} placeholder={'1. 前置条件…\n2. 操作步骤（含具体命令）…\n3. 输出判读要点…'} />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="tags" label="标签" style={{ minWidth: 280 }}>
              <Select mode="tags" placeholder="回车添加标签，如 ble / 固件" />
            </Form.Item>
            <Form.Item name="sourceType" label="来源类型" style={{ minWidth: 140 }}>
              <Select
                options={[
                  { value: 'manual', label: '手工记录' },
                  { value: 'url', label: '网页摘录' },
                  { value: 'case', label: '案例沉淀' },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item noStyle shouldUpdate={(a, b) => a.sourceType !== b.sourceType}>
            {() =>
              noteForm.getFieldValue('sourceType') === 'url' ? (
                <Form.Item name="sourceUrl" label="来源 URL">
                  <Input placeholder="https://…" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* 技能正文查看 */}
      <Drawer
        open={!!viewingSkill}
        width={640}
        title={
          viewingSkill && (
            <span>
              {viewingSkill.title}{' '}
              <Tag>{viewingSkill.skillKey}</Tag>
              <Tag color={SKILL_STATUS_META[viewingSkill.status]?.color}>
                {SKILL_STATUS_META[viewingSkill.status]?.text}
              </Tag>
              <Tag>v{viewingSkill.version}</Tag>
            </span>
          )
        }
        onClose={() => setViewingSkill(null)}
        extra={
          viewingSkill?.status === 'draft' && (
            <Button
              type="primary"
              size="small"
              onClick={() => {
                if (viewingSkill) void approveSkill(viewingSkill);
                setViewingSkill(null);
              }}
            >
              批准
            </Button>
          )
        }
      >
        {viewingSkill && (
          <>
            {whenToUseOf(viewingSkill) && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={`适用场景：${whenToUseOf(viewingSkill)}`}
              />
            )}
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{viewingSkill.body}</Typography.Paragraph>
            {viewingSkill.sourceNoteIds.length > 0 && (
              <Typography.Text type="secondary">
                来源笔记：{viewingSkill.sourceNoteIds.length} 条
              </Typography.Text>
            )}
          </>
        )}
      </Drawer>

      {/* 版本史 */}
      <Modal
        open={!!versionOf}
        title={`版本历史：${versionOf?.key ?? ''}`}
        footer={null}
        onCancel={() => setVersionOf(null)}
      >
        <Table<Skill>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={versionOf?.items ?? []}
          columns={[
            { title: '版本', dataIndex: 'version', width: 70 },
            { title: '标题', dataIndex: 'title' },
            {
              title: '当前',
              dataIndex: 'isCurrent',
              width: 80,
              render: (v: boolean) => (v ? <Tag color="blue">当前</Tag> : null),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: Skill['status']) => SKILL_STATUS_META[v]?.text ?? v,
            },
          ]}
        />
      </Modal>
    </div>
  );
}
