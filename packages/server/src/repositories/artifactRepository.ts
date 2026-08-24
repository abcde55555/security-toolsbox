import type { Database } from 'better-sqlite3';
import type { Artifact } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export type ArtifactType = Artifact['type'];

export interface CreateArtifactInput {
  id?: string;
  projectId: string;
  projectRunId?: string;
  agentSessionId?: string;
  type: ArtifactType;
  title?: string;
  content?: string;
  fileRefs?: string[];
  functionModule?: string;
  createdBy: string;
}

export class ArtifactRepository {
  constructor(private db: Database) {}

  create(input: CreateArtifactInput): Artifact {
    const id = input.id ?? uuid();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO artifacts
          (id, projectId, projectRunId, agentSessionId, type, title, content, fileRefs, functionModule, createdBy, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectId,
        input.projectRunId ?? null,
        input.agentSessionId ?? null,
        input.type,
        input.title ?? null,
        input.content ?? null,
        toJson(input.fileRefs ?? []),
        input.functionModule ?? null,
        input.createdBy,
        now,
      );
    return this.getById(id)!;
  }

  getById(id: string): Artifact | null {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapArtifact(row) : null;
  }

  listBySession(agentSessionId: string): Artifact[] {
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE agentSessionId = ? ORDER BY createdAt ASC')
      .all(agentSessionId) as Record<string, unknown>[];
    return rows.map((r) => this.mapArtifact(r));
  }

  listByProject(projectId: string): Artifact[] {
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE projectId = ? ORDER BY createdAt ASC')
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapArtifact(r));
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
  }

  private mapArtifact(r: Record<string, unknown>): Artifact {
    return {
      id: String(r.id),
      projectId: String(r.projectId),
      projectRunId: r.projectRunId ? String(r.projectRunId) : undefined,
      agentSessionId: r.agentSessionId ? String(r.agentSessionId) : undefined,
      type: r.type as ArtifactType,
      title: r.title ? String(r.title) : undefined,
      content: r.content ? String(r.content) : undefined,
      fileRefs: parseJson<string[]>(r.fileRefs, []),
      functionModule: r.functionModule ? String(r.functionModule) : undefined,
      createdBy: String(r.createdBy),
      createdAt: String(r.createdAt),
    };
  }
}
