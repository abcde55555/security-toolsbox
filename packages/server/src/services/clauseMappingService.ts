import type {
  Clause,
  ClauseVerdict,
  ExecutionResult,
  Severity,
} from '@en18031/shared';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';

export interface PersistResultArgs {
  projectId: string;
  projectRunId: string;
  stepRunId: string;
  standardVersion: string;
  toolId: string;
  result: ExecutionResult;
  commandId?: string;
}

export class ClauseMappingService {
  constructor(private ctx: ServiceContext) {}

  processAndPersist(args: PersistResultArgs): {
    evidenceIds: string[];
    verdicts: ClauseVerdict[];
  } {
    const { projectId, projectRunId, stepRunId, standardVersion, toolId, result, commandId } = args;

    const evidenceIds: string[] = [];
    for (const e of result.evidence) {
      const row = this.ctx.repos.results.insertEvidence({
        stepRunId,
        projectRunId,
        projectId,
        type: e.type,
        content: e.content,
        fileRef: e.path,
        hash: e.hash,
        severity: e.severity,
      });
      evidenceIds.push(row.id);
    }

    const verdicts: ClauseVerdict[] = [];

    if (result.verdicts.length > 0) {
      for (const v of result.verdicts) {
        const clause = this.ctx.repos.clauses.get(standardVersion, v.clauseId);
        if (!clause) {
          this.ctx.repos.audit.insert({
            userId: this.ctx.userId,
            action: 'clause.verdict.invalid',
            entityType: 'clause_verdict',
            entityId: stepRunId,
            after: { clauseId: v.clauseId, reason: '引用了无效条款编号' },
          });
          continue;
        }
        const refs = v.evidenceRefs
          .map((idx) => evidenceIds[idx])
          .filter((x): x is string => Boolean(x));
        if (refs.length === 0 && evidenceIds.length > 0) {
          refs.push(evidenceIds[0]);
        }
        let pass = v.pass;
        let severity: Severity = v.severity;
        let reason = v.reason;
        if (refs.length === 0) {
          pass = false;
          severity = 'high';
          reason = '判定缺失证据（已自动降级）';
        }
        if (pass && severity === 'high') severity = 'middle';
        const persisted = this.ctx.repos.results.insertVerdict({
          stepRunId,
          projectRunId,
          projectId,
          clauseId: v.clauseId,
          pass,
          severity,
          reason,
          evidenceRefs: refs,
          verdictGroup: stepRunId,
        });
        verdicts.push(persisted);
      }
    } else {
      const rules = this.ctx.repos.clauses
        .listMappingRules(toolId)
        .filter((r) => !commandId || !r.commandId || r.commandId === commandId)
        .sort((a, b) => b.priority - a.priority);
      for (const rule of rules) {
        const matched = this.matchRule(rule.matcherType, rule.pattern, result.stdout + '\n' + result.stderr);
        if (!matched) continue;
        const clause = this.ctx.repos.clauses.get(standardVersion, rule.clauseId);
        if (!clause) continue;
        const evidenceIdx = result.evidence.length;
        result.evidence.push({
          type: 'assertion',
          content: `命中规则 ${rule.matcherType}: ${rule.pattern}`,
          severity: rule.severityOverride ?? clause.defaultSeverity,
        });
        const evRow = this.ctx.repos.results.insertEvidence({
          stepRunId,
          projectRunId,
          projectId,
          type: 'assertion',
          content: `规则命中: ${rule.pattern}`,
          severity: rule.severityOverride ?? clause.defaultSeverity,
        });
        evidenceIds.push(evRow.id);
        const pass = rule.onMatch === 'verdict-pass';
        const persisted = this.ctx.repos.results.insertVerdict({
          stepRunId,
          projectRunId,
          projectId,
          clauseId: rule.clauseId,
          pass,
          severity: rule.severityOverride ?? clause.defaultSeverity,
          reason: pass ? `输出匹配通过规则: ${rule.pattern}` : `输出匹配失败规则: ${rule.pattern}`,
          evidenceRefs: [evRow.id],
          verdictGroup: stepRunId,
        });
        verdicts.push(persisted);
      }
    }

    this.ctx.repos.projects.updateStepRun(stepRunId, {
      evidenceCount: evidenceIds.length,
      verdictCount: verdicts.length,
    });

    return { evidenceIds, verdicts };
  }

  listClauses(standardVersion: string, level?: 'L1' | 'L2' | 'L3'): Clause[] {
    return this.ctx.repos.clauses.list(standardVersion, level);
  }

  validateClauseExists(standardVersion: string, clauseId: string): Clause {
    const c = this.ctx.repos.clauses.get(standardVersion, clauseId);
    if (!c) throw Errors.clauseInvalid(`条款不存在: ${clauseId} (${standardVersion})`);
    return c;
  }

  overrideVerdict(verdictId: string, pass: boolean, reason: string): ClauseVerdict {
    const v = this.ctx.repos.results.overrideVerdict(verdictId, pass, reason);
    if (!v) throw Errors.notFound('条款判定', verdictId);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'clause.verdict.override',
      entityType: 'clause_verdict',
      entityId: verdictId,
      after: { pass, reason },
    });
    return v;
  }

  private matchRule(type: string, pattern: string, haystack: string): boolean {
    try {
      if (type === 'contains') return haystack.includes(pattern);
      if (type === 'regex') return new RegExp(pattern, 'm').test(haystack);
      if (type === 'js-expression') return new RegExp(pattern, 'm').test(haystack);
    } catch {
      return false;
    }
    return false;
  }
}
