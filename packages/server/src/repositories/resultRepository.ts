import type { Database } from 'better-sqlite3';
import type { Evidence, ClauseVerdict, VerdictReviewStatus } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export interface EvidenceRow {
  id: string;
  stepRunId: string;
  projectRunId: string;
  projectId?: string;
  type: Evidence['type'];
  content: string;
  fileRef?: string;
  hash?: string;
  severity: Evidence['severity'];
  createdAt: string;
  // Agent 扩展
  clauseId?: string;
  functionModule?: string;
  sourceStepType?: string;
  mimeType?: string;
}

export class ResultRepository {
  constructor(private db: Database) {}

  insertEvidence(input: Omit<EvidenceRow, 'id' | 'createdAt'>): EvidenceRow {
    const row: EvidenceRow = { ...input, id: uuid(), createdAt: nowIso() };
    this.db
      .prepare(
        `INSERT INTO evidences (id, stepRunId, projectRunId, projectId, type, content, fileRef, hash, severity,
           clauseId, functionModule, sourceStepType, mimeType, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.stepRunId,
        row.projectRunId,
        row.projectId ?? null,
        row.type,
        row.content,
        row.fileRef ?? null,
        row.hash ?? null,
        row.severity,
        row.clauseId ?? null,
        row.functionModule ?? null,
        row.sourceStepType ?? null,
        row.mimeType ?? null,
        row.createdAt,
      );
    return row;
  }

  listEvidenceByRun(projectRunId: string): EvidenceRow[] {
    return (this.db
      .prepare('SELECT * FROM evidences WHERE projectRunId = ? ORDER BY rowid ASC')
      .all(projectRunId) as Record<string, unknown>[]).map((r) => this.mapEvidence(r));
  }

  listEvidenceByStepRun(stepRunId: string): EvidenceRow[] {
    return (this.db
      .prepare('SELECT * FROM evidences WHERE stepRunId = ? ORDER BY rowid ASC')
      .all(stepRunId) as Record<string, unknown>[]).map((r) => this.mapEvidence(r));
  }

  private mapEvidence(r: Record<string, unknown>): EvidenceRow {
    return {
      id: String(r.id),
      stepRunId: String(r.stepRunId),
      projectRunId: String(r.projectRunId),
      projectId: r.projectId ? String(r.projectId) : undefined,
      type: r.type as Evidence['type'],
      content: String(r.content),
      fileRef: r.fileRef ? String(r.fileRef) : undefined,
      hash: r.hash ? String(r.hash) : undefined,
      severity: r.severity as Evidence['severity'],
      createdAt: String(r.createdAt),
      // Agent 扩展列（此前读取时被丢弃，导致人工证据/条款关联丢失）
      clauseId: r.clauseId ? String(r.clauseId) : undefined,
      functionModule: r.functionModule ? String(r.functionModule) : undefined,
      sourceStepType: r.sourceStepType ? String(r.sourceStepType) : undefined,
      mimeType: r.mimeType ? String(r.mimeType) : undefined,
    };
  }

  insertVerdict(input: {
    stepRunId: string;
    projectRunId: string;
    projectId: string;
    clauseId: string;
    pass: boolean;
    severity: ClauseVerdict['severity'];
    reason: string;
    evidenceRefs: string[];
    overridden?: boolean;
    overrideReason?: string;
    verdictGroup: string;
    reviewStatus?: VerdictReviewStatus;
    aiGenerated?: boolean;
  }): ClauseVerdict {
    const id = uuid();
    const now = nowIso();
    const reviewStatus = input.reviewStatus ?? 'approved';
    this.db
      .prepare(
        `INSERT INTO clause_verdicts (id, stepRunId, projectRunId, projectId, clauseId, pass, severity, reason,
          evidenceRefs, overridden, overrideReason, verdictGroup, reviewStatus, aiGenerated, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.stepRunId,
        input.projectRunId,
        input.projectId,
        input.clauseId,
        input.pass ? 1 : 0,
        input.severity,
        input.reason,
        toJson(input.evidenceRefs),
        input.overridden ? 1 : 0,
        input.overrideReason ?? null,
        input.verdictGroup,
        reviewStatus,
        input.aiGenerated ? 1 : 0,
        now,
      );
    return {
      id,
      stepRunId: input.stepRunId,
      projectRunId: input.projectRunId,
      projectId: input.projectId,
      clauseId: input.clauseId,
      pass: input.pass,
      severity: input.severity,
      reason: input.reason,
      evidenceRefs: input.evidenceRefs,
      overridden: input.overridden ?? false,
      overrideReason: input.overrideReason,
      verdictGroup: input.verdictGroup,
      createdAt: now,
      reviewStatus,
      aiGenerated: input.aiGenerated ?? false,
    };
  }

  /** Only approved verdicts count toward compliance grading. */
  listApprovedVerdictsByProject(projectId: string): ClauseVerdict[] {
    return (this.db
      .prepare("SELECT * FROM clause_verdicts WHERE projectId = ? AND reviewStatus = 'approved' ORDER BY rowid ASC")
      .all(projectId) as Record<string, unknown>[]).map((r) => this.mapVerdict(r));
  }

  listApprovedVerdictsByRun(projectRunId: string): ClauseVerdict[] {
    return (this.db
      .prepare("SELECT * FROM clause_verdicts WHERE projectRunId = ? AND reviewStatus = 'approved' ORDER BY rowid ASC")
      .all(projectRunId) as Record<string, unknown>[]).map((r) => this.mapVerdict(r));
  }

  listPendingReviewVerdictsByProject(projectId: string): ClauseVerdict[] {
    return (this.db
      .prepare("SELECT * FROM clause_verdicts WHERE projectId = ? AND reviewStatus = 'pending_review' ORDER BY rowid ASC")
      .all(projectId) as Record<string, unknown>[]).map((r) => this.mapVerdict(r));
  }

  setReviewStatus(
    verdictId: string,
    reviewStatus: VerdictReviewStatus,
    reviewedBy: string,
    reviewNote?: string,
  ): ClauseVerdict | null {
    const now = nowIso();
    this.db
      .prepare(
        'UPDATE clause_verdicts SET reviewStatus=?, reviewedBy=?, reviewedAt=?, reviewNote=? WHERE id=?',
      )
      .run(reviewStatus, reviewedBy, now, reviewNote ?? null, verdictId);
    const row = this.db.prepare('SELECT * FROM clause_verdicts WHERE id=?').get(verdictId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapVerdict(row) : null;
  }

  listVerdictsByProject(projectId: string): ClauseVerdict[] {
    return (this.db
      .prepare('SELECT * FROM clause_verdicts WHERE projectId = ? ORDER BY rowid ASC')
      .all(projectId) as Record<string, unknown>[]).map((r) => this.mapVerdict(r));
  }

  listVerdictsByRun(projectRunId: string): ClauseVerdict[] {
    return (this.db
      .prepare('SELECT * FROM clause_verdicts WHERE projectRunId = ? ORDER BY rowid ASC')
      .all(projectRunId) as Record<string, unknown>[]).map((r) => this.mapVerdict(r));
  }

  listVerdictsByStepRun(stepRunId: string): ClauseVerdict[] {
    return (this.db
      .prepare('SELECT * FROM clause_verdicts WHERE stepRunId = ? ORDER BY rowid ASC')
      .all(stepRunId) as Record<string, unknown>[]).map((r) => this.mapVerdict(r));
  }

  overrideVerdict(
    verdictId: string,
    pass: boolean,
    reason: string,
  ): ClauseVerdict | null {
    const row = this.db
      .prepare('SELECT * FROM clause_verdicts WHERE id = ?')
      .get(verdictId) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.db
      .prepare(
        'UPDATE clause_verdicts SET overridden=1, overrideReason=?, pass=?, reason=? WHERE id=?',
      )
      .run(reason, pass ? 1 : 0, reason, verdictId);
    const updated = this.db.prepare('SELECT * FROM clause_verdicts WHERE id = ?').get(verdictId) as Record<string, unknown>;
    return this.mapVerdict(updated);
  }

  private mapVerdict(r: Record<string, unknown>): ClauseVerdict {
    return {
      id: String(r.id),
      stepRunId: String(r.stepRunId),
      projectRunId: String(r.projectRunId),
      projectId: String(r.projectId),
      clauseId: String(r.clauseId),
      pass: Boolean(r.pass),
      severity: r.severity as ClauseVerdict['severity'],
      reason: String(r.reason),
      evidenceRefs: parseJson<string[]>(r.evidenceRefs, []),
      overridden: Boolean(r.overridden),
      overrideReason: r.overrideReason ? String(r.overrideReason) : undefined,
      verdictGroup: String(r.verdictGroup),
      createdAt: String(r.createdAt),
      reviewStatus: r.reviewStatus ? (r.reviewStatus as ClauseVerdict['reviewStatus']) : 'approved',
      reviewedBy: r.reviewedBy ? String(r.reviewedBy) : undefined,
      reviewedAt: r.reviewedAt ? String(r.reviewedAt) : undefined,
      reviewNote: r.reviewNote ? String(r.reviewNote) : undefined,
      aiGenerated: r.aiGenerated ? Boolean(r.aiGenerated) : false,
    };
  }
}
