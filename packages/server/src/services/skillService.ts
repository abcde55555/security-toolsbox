import type { ServiceContext } from './context.js';
import type { Skill } from '@en18031/shared';
import { logger } from '../logger.js';
import { Errors } from './errors.js';
import { createActiveAiProvider } from './aiFactory.js';
import { safeAudit } from './notificationService.js';

/** Shape the AI must return when compiling a note into a skill. */
interface CompiledSkillDraft {
  skillKey: string;
  title: string;
  frontmatter: { description?: string; tags?: string[]; whenToUse?: string };
  body: string;
}

const COMPILE_SYSTEM_PROMPT = `你是安全测试平台的知识策展助手。把工程师写的经验笔记编译成一条可复用的"技能(Skill)"。
只输出一个 JSON 对象（不要 markdown 代码块、不要解释文字），字段：
{
  "skillKey": "kebab-case 英文标识，如 ble-l2ping-recon",
  "title": "中文短标题",
  "frontmatter": { "description": "一句话说明", "tags": ["标签"], "whenToUse": "什么场景该想起这条技能" },
  "body": "Markdown 正文：前置条件 → 操作步骤(含具体命令) → 判读要点 → 常见坑。保留笔记中的真实命令与参数。"
}
要求：忠实于笔记内容，不虚构命令；步骤编号清晰；正文 200-800 字。`;

function extractJson(raw: string): CompiledSkillDraft | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as CompiledSkillDraft;
  } catch {
    return null;
  }
}

function slugifyKey(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `skill-${Date.now()}`;
}

export class SkillService {
  constructor(private ctx: ServiceContext) {}

  list(keyword?: string): Skill[] {
    return this.ctx.repos.skills.list({ keyword }).items;
  }

  /**
   * Compile a knowledge note into a draft skill using the active AI provider
   * (narrative model preferred, planning model as fallback). Deterministic
   * fallback: if AI is unavailable, wrap the raw note as a minimal skill so the
   * loop never hard-fails on missing configuration.
   */
  async compileFromNote(
    noteId: string,
    opts: { skillKey?: string } = {},
  ): Promise<{ skill: Skill; warnings: string[] }> {
    const note = this.ctx.repos.knowledge.getById(noteId);
    if (!note) throw Errors.notFound('经验笔记', noteId);

    const factory = await createActiveAiProvider(this.ctx.repos, 'narrative');
    let draft: CompiledSkillDraft | null = null;
    const warnings: string[] = [];

    if (factory) {
      // Reasoning gateways (e.g. Volcano ark-code-latest) may spend the token
      // budget on thinking blocks or sporadically return an empty message;
      // budget generously and retry once on empty/unparseable output.
      for (let attempt = 0; attempt < 2 && !draft; attempt++) {
        try {
          const result = await factory.provider.chat(
            [
              { role: 'system', content: COMPILE_SYSTEM_PROMPT },
              {
                role: 'user',
                content: `笔记标题：${note.title}\n标签：${note.tags.join('、') || '无'}\n来源类型：${note.sourceType}\n\n笔记正文：\n${note.content}`,
              },
            ],
            { model: factory.model, maxTokens: 16384 },
          );
          draft = extractJson(result.message.content ?? '');
        } catch (err) {
          logger.warn({ err, attempt }, 'skill compile attempt failed');
          if (attempt === 1) warnings.push(`AI 编译失败已降级：${(err as Error).message}`);
        }
      }
      if (!draft) warnings.push('AI 返回内容无法解析为 JSON，已退化为原文封装');
    } else {
      warnings.push('未配置 AI Provider，已按原文直接封装为草稿技能');
    }

    if (!draft) {
      draft = {
        skillKey: slugifyKey(note.title),
        title: note.title,
        frontmatter: { description: note.content.slice(0, 120), tags: note.tags },
        body: note.content,
      };
    }
    if (opts.skillKey) draft.skillKey = opts.skillKey;
    if (!draft.body || !draft.body.trim()) throw Errors.validation('编译结果缺少正文');

    const skill = this.ctx.repos.skills.create({
      skillKey: draft.skillKey,
      title: draft.title || note.title,
      frontmatter: {
        description: draft.frontmatter?.description ?? '',
        whenToUse: draft.frontmatter?.whenToUse ?? '',
        ...(Array.isArray(draft.frontmatter?.tags) ? { tags: draft.frontmatter.tags } : {}),
      },
      body: draft.body,
      sourceNoteIds: [note.id],
      status: 'draft',
      author: this.ctx.userId,
    });
    safeAudit(this.ctx.repos.audit, {
      userId: this.ctx.userId,
      action: 'skill.compile',
      entityType: 'skill',
      entityId: skill.id,
      after: { skillKey: skill.skillKey, version: skill.version, sourceNoteIds: [note.id] },
    });
    return { skill, warnings };
  }

  approve(id: string): Skill {
    const skill = this.ctx.repos.skills.setStatus(id, 'approved', this.ctx.userId);
    if (!skill) throw Errors.notFound('技能', id);
    safeAudit(this.ctx.repos.audit, {
      userId: this.ctx.userId,
      action: 'skill.approve',
      entityType: 'skill',
      entityId: id,
      after: { status: 'approved' },
    });
    return skill;
  }

  archive(id: string): Skill {
    const skill = this.ctx.repos.skills.setStatus(id, 'archived', this.ctx.userId);
    if (!skill) throw Errors.notFound('技能', id);
    return skill;
  }
}
