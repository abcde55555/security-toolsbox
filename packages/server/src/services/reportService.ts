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

    const latestByClause = new Map<string, ClauseVerdict>();
    for (const v of verdicts) {
      const existing = latestByClause.get(v.clauseId);
      if (!existing || v.createdAt >= existing.createdAt) {
        latestByClause.set(v.clauseId, v);
      }
    }

    const chapterMap = new Map<string, Clause & { status: 'pass' | 'fail' | 'not_covered' | 'conditional'; verdict?: ClauseVerdict }>();
    const byChapter: ReportSummary['byChapter'] = {};
    let pass = 0;
    let fail = 0;
    let notCovered = 0;
    const failBySeverity = { high: 0, middle: 0, low: 0 };

    for (const clause of allClauses) {
      const v = latestByClause.get(clause.clauseId);
      let status: 'pass' | 'fail' | 'not_covered' | 'conditional';
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
      chapterMap.set(clause.clauseId, { ...clause, status, verdict: v });
    }

    const applicable = allClauses.length;
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
    const clauses = allClauses.map((c) => ({
      ...c,
      verdict: latestByClause.get(c.clauseId) ?? null,
      evidences: latestByClause.get(c.clauseId)?.evidenceRefs.map((id) => evidences.find((e) => e.id === id)).filter(Boolean) ?? [],
    }));
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
    fs.mkdirSync(config.reportsDir, { recursive: true });
    await wb.xlsx.writeFile(filePath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
    const rows = clauses
      .map((c) => {
        const status = c.verdict ? (c.verdict.pass ? 'PASS' : 'FAIL') : 'NOT_COVERED';
        const color = status === 'PASS' ? '#16a34a' : status === 'FAIL' ? '#dc2626' : '#6b7280';
        const reason = c.verdict?.reason ? esc(c.verdict.reason) : '未执行 / 未覆盖';
        return `<tr>
          <td>${esc(c.clauseId)}</td><td>${esc(c.chapter)}</td><td>${esc(c.title)}</td><td>${esc(c.level)}</td>
          <td style="color:${color};font-weight:600">${status}</td>
          <td>${esc(c.verdict?.severity ?? c.defaultSeverity)}</td>
          <td>${reason}</td>
        </tr>`;
      })
      .join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>EN18031 合规报告 - ${esc(project.name)}</title>
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
    </style></head><body>
      <h1>EN18031 合规测试报告</h1>
      <div class="meta">项目：${esc(project.name)} | 标准：${esc(project.standardVersion)} | 目标等级：${esc(project.targetComplianceLevel)} | 生成时间：${esc(report.generatedAt)}</div>
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
      <h2>条款判定详情</h2>
      <table><tr><th>条款</th><th>章节</th><th>标题</th><th>等级</th><th>状态</th><th>严重度</th><th>判定理由</th></tr>
      ${rows}
      </table>
    </body></html>`;
  }
}

export let reportService: ReportService;
export function setReportService(s: ReportService): void {
  reportService = s;
}
