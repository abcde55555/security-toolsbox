import { getDb, createInMemoryDb } from '../db/database.js';
import { AuditRepository } from './auditRepository.js';
import { ToolRepository } from './toolRepository.js';
import { ClauseRepository } from './clauseRepository.js';
import { TemplateRepository } from './templateRepository.js';
import { ProjectRepository } from './projectRepository.js';
import { ResultRepository } from './resultRepository.js';
import { ReportRepository } from './reportRepository.js';
import { CommandRunRepository } from './commandRunRepository.js';

export interface Repositories {
  audit: AuditRepository;
  tools: ToolRepository;
  clauses: ClauseRepository;
  templates: TemplateRepository;
  projects: ProjectRepository;
  results: ResultRepository;
  reports: ReportRepository;
  commandRuns: CommandRunRepository;
}

let repos: Repositories | null = null;

export function getRepositories(): Repositories {
  if (repos) return repos;
  const db = getDb();
  repos = {
    audit: new AuditRepository(db),
    tools: new ToolRepository(db),
    clauses: new ClauseRepository(db),
    templates: new TemplateRepository(db),
    projects: new ProjectRepository(db),
    results: new ResultRepository(db),
    reports: new ReportRepository(db),
    commandRuns: new CommandRunRepository(db),
  };
  return repos;
}

export function createInMemoryRepositories(): { repos: Repositories; close: () => void } {
  const db = createInMemoryDb();
  const r: Repositories = {
    audit: new AuditRepository(db),
    tools: new ToolRepository(db),
    clauses: new ClauseRepository(db),
    templates: new TemplateRepository(db),
    projects: new ProjectRepository(db),
    results: new ResultRepository(db),
    reports: new ReportRepository(db),
    commandRuns: new CommandRunRepository(db),
  };
  return { repos: r, close: () => db.close() };
}
