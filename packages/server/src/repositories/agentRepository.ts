import type { Database } from 'better-sqlite3';
import type {
  AgentEvent,
  AgentEventType,
  AgentPhase,
  AgentSession,
  AgentSessionStatus,
} from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export interface CreateSessionInput {
  id?: string;
  workspaceId?: string;
  projectId: string;
  projectRunId?: string;
  deviceProfile?: Record<string, unknown>;
  selectedClauses?: string[];
  authorizedTools?: string[];
  planningModel?: string;
  narrativeModel?: string;
  createdBy: string;
}

export interface CreateEventInput {
  sessionId: string;
  type: AgentEventType;
  role?: string;
  content?: string;
  contentFileRef?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: string;
  stepRunId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  createdAt?: string;
}

export class AgentRepository {
  constructor(private db: Database) {}

  createSession(input: CreateSessionInput): AgentSession {
    const id = input.id ?? uuid();
    const now = nowIso();
    const deviceProfile = input.deviceProfile ?? {};
    const selectedClauses = input.selectedClauses ?? [];
    const authorizedTools = input.authorizedTools ?? [];
    this.db
      .prepare(
        `INSERT INTO agent_sessions
          (id, workspaceId, projectId, projectRunId, deviceProfile, selectedClauses, authorizedTools,
           phase, status, planningModel, narrativeModel, currentStepId, rollbackCount, tokenUsage,
           lastError, createdBy, createdAt, updatedAt, finishedAt)
         VALUES (?,?,?,?,?,?,?, 'onboarding','planning',?,?,NULL,0,'{}',NULL,?,?,?,NULL)`,
      )
      .run(
        id,
        input.workspaceId ?? 'default',
        input.projectId,
        input.projectRunId ?? null,
        toJson(deviceProfile),
        toJson(selectedClauses),
        toJson(authorizedTools),
        input.planningModel ?? null,
        input.narrativeModel ?? null,
        input.createdBy,
        now,
        now,
      );
    return this.getSession(id)!;
  }

  getSession(id: string): AgentSession | null {
    const row = this.db
      .prepare('SELECT * FROM agent_sessions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSession(row) : null;
  }

  listSessions(opts: { projectId?: string; status?: AgentSessionStatus; limit?: number; offset?: number } = {}): {
    items: AgentSession[];
    total: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.projectId) {
      conditions.push('projectId = ?');
      params.push(opts.projectId);
    }
    if (opts.status) {
      conditions.push('status = ?');
      params.push(opts.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM agent_sessions ${where}`).get(...params) as { c: number }).c;
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const offset = Math.max(0, opts.offset ?? 0);
    const rows = this.db
      .prepare(`SELECT s.*, p.name AS __projectName FROM agent_sessions s
                LEFT JOIN projects p ON p.id = s.projectId
                ${where.replace(/projectId/g, 's.projectId').replace(/status/g, 's.status')}
                ORDER BY s.createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];
    const items = rows.map((r) => {
      const session = this.mapSession(r);
      const projectName = typeof r.__projectName === 'string' ? r.__projectName : undefined;
      return projectName ? { ...session, projectName } : session;
    });
    return { items, total };
  }

  updateStatus(id: string, status: AgentSessionStatus, lastError?: string): void {
    this.db
      .prepare('UPDATE agent_sessions SET status=?, lastError=COALESCE(?, lastError), updatedAt=? WHERE id=?')
      .run(status, lastError ?? null, nowIso(), id);
  }

  updatePhase(id: string, phase: AgentPhase): void {
    this.db
      .prepare('UPDATE agent_sessions SET phase=?, updatedAt=? WHERE id=?')
      .run(phase, nowIso(), id);
  }

  setCurrentStep(id: string, stepRunId: string | null): void {
    this.db
      .prepare('UPDATE agent_sessions SET currentStepId=?, updatedAt=? WHERE id=?')
      .run(stepRunId, nowIso(), id);
  }

  setProjectRunId(id: string, projectRunId: string): void {
    this.db.prepare('UPDATE agent_sessions SET projectRunId=?, updatedAt=? WHERE id=?').run(
      projectRunId,
      nowIso(),
      id,
    );
  }

  incrementRollback(id: string): number {
    this.db.prepare('UPDATE agent_sessions SET rollbackCount = rollbackCount + 1, updatedAt=? WHERE id=?').run(
      nowIso(),
      id,
    );
    const row = this.db.prepare('SELECT rollbackCount FROM agent_sessions WHERE id=?').get(id) as
      | { rollbackCount: number }
      | undefined;
    return row?.rollbackCount ?? 0;
  }

  finish(id: string, status: AgentSessionStatus): void {
    const now = nowIso();
    this.db
      .prepare('UPDATE agent_sessions SET status=?, finishedAt=?, updatedAt=? WHERE id=?')
      .run(status, now, now, id);
  }

  /**
   * Append an event. seq is computed as MAX(seq)+1 within the session inside a
   * transaction so concurrent appends cannot collide. The UNIQUE(sessionId,seq)
   * constraint plus append-only triggers guarantee immutability.
   */
  createEvent(input: CreateEventInput): AgentEvent {
    const id = uuid();
    const createdAt = input.createdAt ?? nowIso();
    const insert = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM agent_events WHERE sessionId = ?')
        .get(input.sessionId) as { nextSeq: number };
      const seq = row.nextSeq;
      this.db
        .prepare(
          `INSERT INTO agent_events
            (id, sessionId, seq, type, role, content, contentFileRef, toolName, toolArgs, toolStatus,
             stepRunId, model, promptTokens, completionTokens, latencyMs, createdAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.sessionId,
          seq,
          input.type,
          input.role ?? null,
          input.content ?? null,
          input.contentFileRef ?? null,
          input.toolName ?? null,
          input.toolArgs ? toJson(input.toolArgs) : null,
          input.toolStatus ?? null,
          input.stepRunId ?? null,
          input.model ?? null,
          input.promptTokens ?? null,
          input.completionTokens ?? null,
          input.latencyMs ?? null,
          createdAt,
        );
      return seq;
    });
    const seq = insert();
    return {
      id,
      sessionId: input.sessionId,
      seq,
      type: input.type,
      role: input.role,
      content: input.content,
      contentFileRef: input.contentFileRef,
      toolName: input.toolName,
      toolArgs: input.toolArgs,
      toolStatus: input.toolStatus,
      stepRunId: input.stepRunId,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      latencyMs: input.latencyMs,
      createdAt,
    };
  }

  listEvents(sessionId: string, sinceSeq = 0): AgentEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_events WHERE sessionId = ? AND seq > ? ORDER BY seq ASC')
      .all(sessionId, sinceSeq) as Record<string, unknown>[];
    return rows.map((r) => this.mapEvent(r));
  }

  private mapSession(r: Record<string, unknown>): AgentSession {
    return {
      id: String(r.id),
      projectId: String(r.projectId),
      projectRunId: r.projectRunId ? String(r.projectRunId) : undefined,
      deviceProfile: parseJson<Record<string, unknown>>(r.deviceProfile, {}),
      selectedClauses: parseJson<string[]>(r.selectedClauses, []),
      authorizedTools: parseJson<string[]>(r.authorizedTools, []),
      phase: r.phase as AgentPhase,
      status: r.status as AgentSessionStatus,
      planningModel: r.planningModel ? String(r.planningModel) : undefined,
      narrativeModel: r.narrativeModel ? String(r.narrativeModel) : undefined,
      currentStepId: r.currentStepId ? String(r.currentStepId) : undefined,
      rollbackCount: Number(r.rollbackCount),
      lastError: r.lastError ? String(r.lastError) : undefined,
      createdBy: String(r.createdBy),
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
      finishedAt: r.finishedAt ? String(r.finishedAt) : undefined,
    };
  }

  private mapEvent(r: Record<string, unknown>): AgentEvent {
    return {
      id: String(r.id),
      sessionId: String(r.sessionId),
      seq: Number(r.seq),
      type: r.type as AgentEventType,
      role: r.role ? String(r.role) : undefined,
      content: r.content ? String(r.content) : undefined,
      contentFileRef: r.contentFileRef ? String(r.contentFileRef) : undefined,
      toolName: r.toolName ? String(r.toolName) : undefined,
      toolArgs: r.toolArgs ? parseJson<Record<string, unknown>>(r.toolArgs, {}) : undefined,
      toolStatus: r.toolStatus ? String(r.toolStatus) : undefined,
      stepRunId: r.stepRunId ? String(r.stepRunId) : undefined,
      model: r.model ? String(r.model) : undefined,
      promptTokens: r.promptTokens !== null && r.promptTokens !== undefined ? Number(r.promptTokens) : undefined,
      completionTokens:
        r.completionTokens !== null && r.completionTokens !== undefined ? Number(r.completionTokens) : undefined,
      latencyMs: r.latencyMs !== null && r.latencyMs !== undefined ? Number(r.latencyMs) : undefined,
      createdAt: String(r.createdAt),
    };
  }
}
