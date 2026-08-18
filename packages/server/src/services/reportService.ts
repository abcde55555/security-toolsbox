import type {
  Clause,
  ClauseVerdict,
  Report,
  ReportGrade,
  ReportSummary,
} from '@en18031/shared';
import { nowIso } from '@en18031/shared';
import ExcelJS from 'exceljs';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

export class ReportService {
  constructor(private ctx: ServiceContext) {}

  generateReport(projectId: string, runId?: string): Report {
    const project = this.ctx.repos.projects.getById(projectId);
    if (!project) throw Errors.notFound('项目', projectId);

    const allClauses = this.ctx.repos.clauses.listAllForLevel(
      project.standardVersion,
      project.targetComplianceLevel,
    );
    const verdicts = runId
      ? this.ctx.repos.results.listVerdictsByRun(runId)
      : this.ctx.repos.results.listVerdictsByProject(projectId);

    // A report needs actual results. If nothing has run, refuse to generate
    // an "all not covered" report that looks meaningful but isn't.
    if (verdicts.length === 0) {
      throw Errors.validation('该项目还没有任何测试结果，请先运行测试再生成报告');
    }

    const latestByClause = new Map<string, ClauseVerdict>();
    for (const v of verdicts) {
      const existing = latestByClause.get(v.clauseId);
      if (!existing || v.createdAt >= existing.createdAt) {
        latestByClause.set(v.clauseId, v);
      }
    }

    // A clause referenced as another's parentId is a chapter/parent — its
    // verdict is ROLLED UP from descendants and does not count toward leaf
    // (testable-item) metrics.
    const parentIds = new Set<string>();
    for (const c of allClauses) if (c.parentId) parentIds.add(c.parentId);
    const leaves = allClauses.filter((c) => !parentIds.has(c.clauseId));

    const byChapter: ReportSummary['byChapter'] = {};
    let pass = 0;
    let fail = 0;
    let notCovered = 0;
    const failBySeverity = { high: 0, middle: 0, low: 0 };

    for (const clause of leaves) {
      const v = latestByClause.get(clause.clauseId);
      let status: 'pass' | 'fail' | 'not_covered';
      if (!v) {
        status = 'not_covered';
        notCovered++;
      } else if (v.pass) {
        status = 'pass';
        pass++;
      } else {
        status = 'fail';
        fail++;
        failBySeverity[v.severity]++;
      }
      if (!byChapter[clause.chapter]) {
        byChapter[clause.chapter] = { total: 0, pass: 0, fail: 0, notCovered: 0 };
      }
      byChapter[clause.chapter].total++;
      if (status === 'pass') byChapter[clause.chapter].pass++;
      else if (status === 'fail') byChapter[clause.chapter].fail++;
      else byChapter[clause.chapter].notCovered++;
    }

    const applicable = leaves.length;
    const notCoveredRatio = applicable > 0 ? notCovered / applicable : 0;
    let grade: ReportGrade;
    if (failBySeverity.high > 0) {
      grade = 'FAIL';
    } else if (notCoveredRatio > 0.05) {
      grade = 'CONDITIONAL_PASS';
    } else if (fail > 0) {
      grade = fail <= applicable * 0.1 ? 'CONDITIONAL_PASS' : 'FAIL';
    } else if (notCovered > 0) {
      grade = 'CONDITIONAL_PASS';
    } else {
      grade = 'PASS';
    }
    if (applicable === 0) grade = 'INCOMPLETE';

    const summary: ReportSummary = {
      applicable,
      pass,
      fail,
      notCovered,
      conditional: 0,
      byChapter,
      failBySeverity,
    };

    const report = this.ctx.repos.reports.save({
      projectId,
      projectRunId: runId,
      format: 'snapshot',
      grade,
      summary,
      generatedBy: this.ctx.userId,
    });

    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'report.generate',
      entityType: 'report',
      entityId: report.id,
      after: { projectId, grade, runId },
    });

    return report;
  }

  latest(projectId: string): Report | null {
    this.ctx.repos.projects.getById(projectId);
    return this.ctx.repos.reports.latest(projectId);
  }

  list(projectId: string): Report[] {
    return this.ctx.repos.reports.list(projectId);
  }

  getReportDetail(projectId: string, reportId: string) {
    const project = this.ctx.repos.projects.getById(projectId);
    if (!project) throw Errors.notFound('项目', projectId);
    const report = this.ctx.repos.reports.getById(reportId);
    if (!report || report.projectId !== projectId) throw Errors.notFound('报告', reportId);
    const allClauses = this.ctx.repos.clauses.listAllForLevel(
      project.standardVersion,
      project.targetComplianceLevel,
    );
    const verdicts = this.ctx.repos.results.listVerdictsByProject(projectId);
    const evidences = this.ctx.repos.results.listEvidenceByRun(
      this.ctx.repos.projects.latestRun(projectId)?.id ?? '',
    );
    const latestByClause = new Map<string, ClauseVerdict>();
    for (const v of verdicts) {
      const ex = latestByClause.get(v.clauseId);
      if (!ex || v.createdAt >= ex.createdAt) latestByClause.set(v.clauseId, v);
    }

    // Roll up parent (chapter) verdicts from their leaf descendants:
    // any fail -> fail; all pass -> pass; otherwise not covered.
    const byId = new Map<string, Clause>();
    for (const c of allClauses) byId.set(c.clauseId, c);
    const rolledUp = new Map<string, { pass: boolean } | null>();
    const isParent = (id: string) => allClauses.some((c) => c.parentId === id);
    const descendants = (id: string): Clause[] => {
      const out: Clause[] = [];
      const seen = new Set<string>([id]);
      const walk = (pid: string) => {
        for (const c of allClauses) {
          if (c.parentId === pid && !seen.has(c.clauseId)) {
            seen.add(c.clauseId);
            out.push(c);
            walk(c.clauseId);
          }
        }
      };
      walk(id);
      return out;
    };
    for (const c of allClauses) {
      if (!isParent(c.clauseId)) continue;
      const leaves = descendants(c.clauseId).filter((d) => !isParent(d.clauseId));
      const leafVerdicts = leaves.map((l) => latestByClause.get(l.clauseId)).filter(Boolean) as ClauseVerdict[];
      if (leafVerdicts.length === 0) { rolledUp.set(c.clauseId, null); continue; }
      const anyFail = leafVerdicts.some((v) => !v.pass);
      const allPass = leaves.length === leafVerdicts.length && leafVerdicts.every((v) => v.pass);
      rolledUp.set(c.clauseId, anyFail ? { pass: false } : allPass ? { pass: true } : null);
    }

    const clauses = allClauses.map((c) => {
      const isParentClause = isParent(c.clauseId);
      const roll = rolledUp.get(c.clauseId);
      const direct = latestByClause.get(c.clauseId);
      // Parents show a synthetic rolled-up verdict; leaves show their real one.
      const verdict = isParentClause
        ? (roll ? ({ clauseId: c.clauseId, pass: roll.pass, reason: roll.pass ? '所有子项通过' : '存在未通过子项', severity: c.defaultSeverity, overridden: false } as unknown as ClauseVerdict) : null)
        : (direct ?? null);
      return {
        ...c,
        isParent: isParentClause,
        verdict,
        evidences: direct?.evidenceRefs.map((id) => evidences.find((e) => e.id === id)).filter(Boolean) ?? [],
      };
    });
    return { report, project, clauses };
  }

  async exportExcel(projectId: string, reportId?: string): Promise<{ filePath: string; fileName: string }> {
    const project = this.ctx.repos.projects.getById(projectId);
    if (!project) throw Errors.notFound('项目', projectId);
    const report = reportId
      ? this.ctx.repos.reports.getById(reportId)
      : this.ctx.repos.reports.latest(projectId);
    if (!report) throw Errors.notFound('报告', reportId ?? 'latest');

    const detail = this.getReportDetail(projectId, report.id);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EN18031 合规测试平台';
    wb.created = new Date();

    const summary = wb.addWorksheet('报告摘要');
    summary.columns = [
      { header: '项目名称', key: 'name', width: 30 },
      { header: '内容', key: 'value', width: 60 },
    ];
    summary.addRows([
      { name: '项目名称', value: project.name },
      { name: '标准版本', value: project.standardVersion },
      { name: '目标合规等级', value: project.targetComplianceLevel },
      { name: '最终定级', value: report.grade },
      { name: '适用条款数', value: report.summary.applicable },
      { name: '通过', value: report.summary.pass },
      { name: '失败', value: report.summary.fail },
      { name: '未覆盖', value: report.summary.notCovered },
      { name: '高危失败数', value: report.summary.failBySeverity.high },
      { name: '生成时间', value: report.generatedAt },
    ]);
    summary.getRow(1).font = { bold: true };

    const clauses = wb.addWorksheet('条款判定详情');
    clauses.columns = [
      { header: '条款编号', key: 'clauseId', width: 14 },
      { header: '章节', key: 'chapter', width: 10 },
      { header: '标题', key: 'title', width: 40 },
      { header: '等级', key: 'level', width: 8 },
      { header: '状态', key: 'status', width: 12 },
      { header: '严重度', key: 'severity', width: 10 },
      { header: '判定理由', key: 'reason', width: 60 },
    ];
    for (const c of detail.clauses) {
      clauses.addRow({
        clauseId: c.clauseId,
        chapter: c.chapter,
        title: c.title,
        level: c.level,
        status: c.verdict ? (c.verdict.pass ? 'PASS' : 'FAIL') : 'NOT_COVERED',
        severity: c.verdict?.severity ?? c.defaultSeverity,
        reason: c.verdict?.reason ?? '',
      });
    }
    clauses.getRow(1).font = { bold: true };

    const chapterSheet = wb.addWorksheet('章节通过率');
    chapterSheet.columns = [
      { header: '章节', key: 'chapter', width: 12 },
      { header: '总数', key: 'total', width: 10 },
      { header: '通过', key: 'pass', width: 10 },
      { header: '失败', key: 'fail', width: 10 },
      { header: '未覆盖', key: 'notCovered', width: 12 },
    ];
    for (const [chapter, s] of Object.entries(report.summary.byChapter)) {
      chapterSheet.addRow({ chapter, ...s });
    }
    chapterSheet.getRow(1).font = { bold: true };

    const fileName = `EN18031-report-${project.name.replace(/[^a-z0-9一-龥]/gi, '_')}-${report.id.slice(0, 8)}.xlsx`;
    const filePath = path.join(config.reportsDir, fileName);
    await fs.promises.mkdir(config.reportsDir, { recursive: true });
    await wb.xlsx.writeFile(filePath);
    const hash = crypto
      .createHash('sha256')
      .update(await fs.promises.readFile(filePath))
      .digest('hex');
    this.ctx.repos.reports.save({
      projectId,
      projectRunId: report.projectRunId,
      format: 'excel',
      fileRef: filePath,
      hash,
      grade: report.grade,
      summary: report.summary,
      generatedBy: this.ctx.userId,
    });
    return { filePath, fileName };
  }

  renderReportHtml(projectId: string, reportId?: string): string {
    const detail = reportId
      ? this.getReportDetail(projectId, reportId)
      : this.latest(projectId)
        ? this.getReportDetail(projectId, this.latest(projectId)!.id)
        : null;
    if (!detail) {
      return '<html><body><h1>暂无报告</h1><p>请先执行测试后再生成报告。</p></body></html>';
    }
    const { report, project, clauses } = detail;
    const esc = (v: unknown): string =>
      String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    const gradeColor =
      report.grade === 'PASS' ? '#16a34a' : report.grade === 'FAIL' ? '#dc2626' : report.grade === 'CONDITIONAL_PASS' ? '#ea580c' : '#6b7280';
    const standard = this.ctx.repos.standards.get(project.standardVersion);
    const standardLabel = standard ? `${esc(standard.name)} (${esc(standard.id)})` : esc(project.standardVersion);

    // Build a tree and render parent chapters bold with their leaves indented.
    const byId = new Map(clauses.map((c) => [c.clauseId, c]));
    const roots = clauses.filter((c) => !c.parentId || !byId.has(c.parentId));
    const rendering = new Set<string>();
    const renderRow = (c: typeof clauses[number], depth: number): string => {
      const status = c.verdict ? (c.verdict.pass ? 'PASS' : 'FAIL') : 'NOT_COVERED';
      const color = status === 'PASS' ? '#16a34a' : status === 'FAIL' ? '#dc2626' : '#6b7280';
      const reason = c.verdict?.reason ? esc(c.verdict.reason) : (c.isParent ? '—' : '未执行 / 未覆盖');
      const indent = '&nbsp;'.repeat(depth * 4);
      const weight = c.isParent ? 'font-weight:700;background:#f9fafb;' : '';
      // Guard against cyclic parentId (defensive — writes reject cycles).
      const children = rendering.has(c.clauseId)
        ? ''
        : clauses
            .filter((x) => {
              if (x.parentId !== c.clauseId) return false;
              if (rendering.has(x.clauseId)) return false;
              return true;
            })
            .sort((a, b) => a.clauseId.localeCompare(b.clauseId, undefined, { numeric: true }))
            .map((ch) => {
              rendering.add(c.clauseId);
              try {
                return renderRow(ch, depth + 1);
              } finally {
                rendering.delete(c.clauseId);
              }
            })
            .join('');
      return `<tr style="${weight}">
        <td>${indent}${esc(c.clauseId)}</td><td>${esc(c.title)}</td><td>${esc(c.level)}</td>
        <td style="color:${color};font-weight:600">${status}</td>
        <td>${esc(c.verdict?.severity ?? c.defaultSeverity)}</td>
        <td>${reason}</td>
      </tr>${children}`;
    };
    const rows = roots
      .sort((a, b) => a.clauseId.localeCompare(b.clauseId, undefined, { numeric: true }))
      .map((c) => renderRow(c, 0))
      .join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>合规报告 - ${esc(project.name)}</title>
    <style>
      body{font-family:-apple-system,"PingFang SC",sans-serif;margin:40px;color:#1f2937}
      h1{font-size:24px} h2{font-size:18px;margin-top:28px;border-bottom:2px solid #e5e7eb;padding-bottom:6px}
      .grade{font-size:32px;font-weight:700;color:${gradeColor}}
      table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
      th,td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left}
      th{background:#f9fafb}
      .metrics{display:flex;gap:16px;margin:16px 0}
      .metric{border:1px solid #e5e7eb;border-radius:8px;padding:12px 18px}
      .metric .n{font-size:24px;font-weight:700}
      .meta{color:#6b7280;font-size:13px}
      @media print{body{margin:12px}}
    </style></head><body>
      <h1>合规测试报告</h1>
      <div class="meta">项目：${esc(project.name)} | 标准：${standardLabel} | 目标等级：${esc(project.targetComplianceLevel)} | 生成时间：${esc(report.generatedAt)}</div>
      <div class="grade">${esc(report.grade)}</div>
      <div class="metrics">
        <div class="metric"><div class="n">${report.summary.applicable}</div><div>适用条款</div></div>
        <div class="metric"><div class="n" style="color:#16a34a">${report.summary.pass}</div><div>通过</div></div>
        <div class="metric"><div class="n" style="color:#dc2626">${report.summary.fail}</div><div>失败</div></div>
        <div class="metric"><div class="n" style="color:#6b7280">${report.summary.notCovered}</div><div>未覆盖</div></div>
        <div class="metric"><div class="n" style="color:#dc2626">${report.summary.failBySeverity.high}</div><div>高危失败</div></div>
      </div>
      <h2>章节通过率</h2>
      <table><tr><th>章节</th><th>总数</th><th>通过</th><th>失败</th><th>未覆盖</th></tr>
      ${Object.entries(report.summary.byChapter).map(([ch, s]) => `<tr><td>${esc(ch)}</td><td>${s.total}</td><td>${s.pass}</td><td>${s.fail}</td><td>${s.notCovered}</td></tr>`).join('')}
      </table>
      <h2>条款判定详情（按章节层级）</h2>
      <table><tr><th style="width:110px">编号</th><th>标题</th><th style="width:70px">等级</th><th style="width:110px">状态</th><th style="width:80px">严重度</th><th>判定理由</th></tr>
      ${rows}
      </table>
    </body></html>`;
  }
}

export let reportService: ReportService;
export function setReportService(s: ReportService): void {
  reportService = s;
}
