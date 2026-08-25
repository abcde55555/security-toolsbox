import { useEffect, useRef, useState } from 'react';
import { Button, Space, Tooltip, Typography } from 'antd';
import { BoldOutlined, PictureOutlined, LoadingOutlined } from '@ant-design/icons';
import { UploadApi } from '../../api/endpoints';

export interface RichValue {
  /** Markdown 文本：图片为 ![图片](fileRef) */
  markdown: string;
  /** 编辑区内全部图片的 fileRef 列表 */
  fileRefs: string[];
}

/**
 * 轻量富文本证据编辑器：contentEditable + 粘贴/插入图片。
 * 不引第三方编辑器——需求核心是「文字和图片混排」，序列化目标是有界 Markdown，
 * 直接复用现有 note 通道与 MiniMarkdown 渲染，服务端零改动。
 */
export default function RichEvidenceEditor({
  onChange,
  placeholder,
}: {
  onChange: (v: RichValue) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(0);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const md = serializeToMarkdown(el);
    const fileRefs = [...el.querySelectorAll('img[data-ref]')].map((img) =>
      (img as HTMLElement).dataset.ref as string,
    );
    onChange({ markdown: md, fileRefs });
  };

  // 粘贴图片：拦截剪贴板文件 → 上传 → 光标处插入 <img data-ref>
  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return; // 纯文本粘贴走默认
    e.preventDefault();
    for (const f of files) await uploadAndInsert(f);
  };

  const uploadAndInsert = async (f: File) => {
    setUploading((n) => n + 1);
    try {
      const res = await UploadApi.upload(f);
      insertAtCursor(`<img src="/api/upload/${encodeURIComponent(res.path)}" data-ref="${res.path}" style="max-width:100%;border-radius:6px;margin:4px 0;" />`);
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const insertAtCursor = (html: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand('insertHTML', false, html + '<br>');
    emit();
  };

  // 受控清空由父组件通过 key 重挂实现；这里只负责初始占位
  useEffect(() => {
    if (ref.current && !ref.current.textContent && !ref.current.querySelector('img')) {
      ref.current.dataset.empty = '1';
    }
  }, []);

  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 6 }}>
      <Space size={4} style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', width: '100%' }}>
        <Tooltip title="加粗">
          <Button size="small" type="text" icon={<BoldOutlined />} onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }} />
        </Tooltip>
        <Tooltip title="插入图片">
          <Button
            size="small"
            type="text"
            icon={<PictureOutlined />}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = () => {
                const f = input.files?.[0];
                if (f) void uploadAndInsert(f);
              };
              input.click();
            }}
          />
        </Tooltip>
        {uploading > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <LoadingOutlined spin /> 图片上传中…
          </Typography.Text>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
          可直接粘贴截图
        </Typography.Text>
      </Space>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        style={{
          minHeight: 88,
          maxHeight: 260,
          overflow: 'auto',
          padding: '8px 10px',
          fontSize: 13,
          outline: 'none',
          lineHeight: 1.7,
        }}
      />
      <style>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #bfbfbf;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

/** DOM → 有界 Markdown：块级换行、img 转 ![](ref)。不信任任意 HTML，输出仅含文本/md 结构。 */
function serializeToMarkdown(root: HTMLElement): string {
  const lines: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      lines.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === 'IMG') {
      const r = el.dataset.ref;
      if (r) lines.push(`\n![图片](${r})\n`);
      return;
    }
    if (el.tagName === 'BR') {
      lines.push('\n');
      return;
    }
    const block = ['DIV', 'P'].includes(el.tagName);
    if (block) lines.push('\n');
    if ((el.tagName === 'B' || el.tagName === 'STRONG') && el.textContent) {
      lines.push(`**${el.textContent}**`);
      return;
    }
    el.childNodes.forEach(walk);
    if (block) lines.push('\n');
  };
  root.childNodes.forEach(walk);
  return lines.join('').replace(/\n{3,}/g, '\n\n').trim();
}
