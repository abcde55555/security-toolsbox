import type { Database } from 'better-sqlite3';
import type { Report, ReportSummary } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export class ReportRepository {
  constructor(private db: Database) {}

  save(input: {
    projectId: string;
    projectRunId?: string;
    format: Report['format'];
    fileRef?: string;
    hash?: string;
    grade: Report['grade'];
    summary: ReportSummary;
    generatedBy: string;
  }): Report {
    const id = uuid();
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE reports SET isLatest = 0 WHERE projectId = ?').run(input.projectId);
      this.db
        .prepare(
          `INSERT INTO reports (id, projectId, projectRunId, format, fileRef, hash, grade, summary, generatedBy, generatedAt, isLatest)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.projectId,
          input.projectRunId ?? null,
          input.format,
          input.fileRef ?? null,
          input.hash ?? null,
          input.grade,
          toJson(input.summary),
          input.generatedBy,
          now,
          1,
        );
    });
    tx();
    return {
      id,
      projectId: input.projectId,
      projectRunId: input.projectRunId,
      format: input.format,
      fileRef: input.fileRef,
      hash: input.hash,
      grade: input.grade,
      summary: input.summary,
      generatedBy: input.generatedBy,
      generatedAt: now,
      isLatest: true,
    };
  }

  latest(projectId: string): Report | null {
    const row = this.db
      .prepare('SELECT * FROM reports WHERE projectId = ? AND isLatest = 1 LIMIT 1')
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? this.mapReport(row) : null;
  }

  list(projectId: string): Report[] {
    return (this.db
      .prepare('SELECT * FROM reports WHERE projectId = ? ORDER BY generatedAt DESC')
      .all(projectId) as Record<string, unknown>[]).map((r) => this.mapReport(r));
  }

  getById(id: string): Report | null {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapReport(row) : null;
  }

  private mapReport(r: Record<string, unknown>): Report {
    return {
      id: String(r.id),
      projectId: String(r.projectId),
      projectRunId: r.projectRunId ? String(r.projectRunId) : undefined,
      format: r.format as Report['format'],
      fileRef: r.fileRef ? String(r.fileRef) : undefined,
      hash: r.hash ? String(r.hash) : undefined,
      grade: r.grade as Report['grade'],
      summary: parseJson<ReportSummary>(r.summary, {
        applicable: 0,
        pass: 0,
        fail: 0,
        notCovered: 0,
        conditional: 0,
        byChapter: {},
        failBySeverity: { high: 0, middle: 0, low: 0 },
      }),
      generatedBy: String(r.generatedBy),
      generatedAt: String(r.generatedAt),
      isLatest: Boolean(r.isLatest),
    };
  }
}
