import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createInMemoryRepositories } from '../repositories/index.js';
import { SkillService } from '../services/skillService.js';
import { notify } from '../services/notificationService.js';
import type { ServiceContext } from '../services/context.js';
import './helpers.js';

function makeContext() {
  const { repos, close } = createInMemoryRepositories();
  const bus = new EventEmitter();
  const ctx: ServiceContext = { repos, engine: {} as never, moduleLoader: {} as never, bus, userId: 'tester' };
  return { repos, ctx, close };
}

describe('KnowledgeRepository', () => {
  it('creates, searches and updates notes', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const note = repos.knowledge.create({
        title: 'BLE 手环测试经验',
        content: '使用 nmap -sV 扫描前需先进入配对模式',
        tags: ['ble', 'recon'],
        author: 'tester',
      });
      expect(note.id).toBeTruthy();
      expect(note.sourceType).toBe('manual');
      expect(note.tags).toEqual(['ble', 'recon']);

      expect(repos.knowledge.list({ keyword: 'nmap' }).total).toBe(1);
      expect(repos.knowledge.list({ keyword: '不存在' }).total).toBe(0);

      const updated = repos.knowledge.update(note.id, { content: '更新后的内容', sourceUrl: null });
      expect(updated?.content).toBe('更新后的内容');

      expect(repos.knowledge.delete(note.id)).toBe(true);
      expect(repos.knowledge.getById(note.id)).toBeNull();
    } finally {
      close();
    }
  });
});

describe('SkillRepository versioning', () => {
  it('supersedes the current version when the same skillKey is saved again', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const v1 = repos.skills.create({ skillKey: 'ble-recon', title: 'v1', body: 'b1', author: 't' });
      expect(v1.version).toBe(1);
      expect(v1.isCurrent).toBe(true);

      const v2 = repos.skills.create({ skillKey: 'ble-recon', title: 'v2', body: 'b2', author: 't' });
      expect(v2.version).toBe(2);
      expect(v2.isCurrent).toBe(true);

      const after = repos.skills.getById(v1.id)!;
      expect(after.isCurrent).toBe(false);

      // list() defaults to current-only
      const listed = repos.skills.list({});
      expect(listed.total).toBe(1);
      expect(listed.items[0].id).toBe(v2.id);

      const versions = repos.skills.listVersions('ble-recon');
      expect(versions.map((s) => s.version)).toEqual([2, 1]);
    } finally {
      close();
    }
  });

  it('approve stamps approvedBy/approvedAt; archived skills stay searchable via status filter', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const s = repos.skills.create({ skillKey: 'k', title: 't', body: 'b', author: 'a' });
      const approved = repos.skills.setStatus(s.id, 'approved', 'reviewer');
      expect(approved?.status).toBe('approved');
      expect(approved?.approvedBy).toBe('reviewer');
      expect(approved?.approvedAt).toBeTruthy();

      repos.skills.setStatus(s.id, 'archived', 'reviewer');
      expect(repos.skills.list({ status: 'archived' }).items).toHaveLength(1);
      expect(repos.skills.list({ status: 'approved' }).items).toHaveLength(0);
    } finally {
      close();
    }
  });
});

describe('SkillService.compileFromNote (deterministic fallback)', () => {
  it('wraps the raw note when no AI provider is configured', async () => {
    const { repos, ctx, close } = makeContext();
    try {
      const note = repos.knowledge.create({
        title: '固件提取流程',
        content: '1. 拆机\n2. 找到 UART 焊点\n3. binwalk -e firmware.bin',
        tags: ['firmware'],
        author: 'tester',
      });
      const { skill, warnings } = await new SkillService(ctx).compileFromNote(note.id);
      expect(skill.status).toBe('draft');
      expect(skill.body).toContain('binwalk');
      expect(String(skill.frontmatter.description ?? '').length).toBeGreaterThan(0);
      expect(warnings.join()).toContain('未配置 AI Provider');
      expect(skill.sourceNoteIds).toEqual([note.id]);
    } finally {
      close();
    }
  });

  it('throws notFound for a missing note', async () => {
    const { ctx, close } = makeContext();
    try {
      await expect(new SkillService(ctx).compileFromNote('nope')).rejects.toThrow(/不存在/);
    } finally {
      close();
    }
  });
});

describe('notifications', () => {
  it('notify() persists and broadcasts on the bus', () => {
    const { repos, ctx, close } = makeContext();
    try {
      const seen: string[] = [];
      ctx.bus.on('notification:new', (p: { notification: { id: string } }) => seen.push(p.notification.id));
      const n = notify(ctx.repos, ctx.bus, {
        type: 'skill_sediment',
        title: '建议沉淀',
        message: '本次 BLE 测试有可复用经验',
        payload: { title: '建议沉淀', body: 'x' },
        createdBy: 'agent',
      });
      expect(seen).toEqual([n.id]);
      expect(repos.notifications.unreadCount()).toBe(1);

      const read = repos.notifications.setStatus(n.id, 'read');
      expect(read?.readAt).toBeTruthy();
      expect(repos.notifications.unreadCount()).toBe(0);

      const accepted = repos.notifications.setStatus(n.id, 'accepted');
      expect(accepted?.status).toBe('accepted');
      expect(accepted?.actedAt).toBeTruthy();
    } finally {
      close();
    }
  });

  it('snooze stores an absolute wake-up time in the future', () => {
    const { repos, ctx, close } = makeContext();
    try {
      const n = notify(ctx.repos, ctx.bus, {
        type: 'template_save',
        title: 't',
        createdBy: 'agent',
      });
      const before = Date.now();
      const snoozed = repos.notifications.setStatus(n.id, 'snoozed', { snoozedUntilMs: 3600_000 });
      expect(snoozed?.snoozedUntil ? Date.parse(snoozed.snoozedUntil) : 0).toBeGreaterThan(before);
    } finally {
      close();
    }
  });
});
