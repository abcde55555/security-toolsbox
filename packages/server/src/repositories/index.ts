import { getDb, createInMemoryDb } from '../db/database.js';
import { AuditRepository } from './auditRepository.js';
import { ToolRepository } from './toolRepository.js';
import { ClauseRepository } from './clauseRepository.js';
import { TemplateRepository } from './templateRepository.js';
import { ProjectRepository } from './projectRepository.js';
import { ResultRepository } from './resultRepository.js';
import { ReportRepository } from './reportRepository.js';
import { CommandRunRepository } from './commandRunRepository.js';
import { StandardRepository } from './standardRepository.js';
import { CategoryRepository } from './categoryRepository.js';
import { AgentRepository } from './agentRepository.js';
import { ArtifactRepository } from './artifactRepository.js';
import { SettingRepository } from './settingRepository.js';
import { KnowledgeRepository } from './knowledgeRepository.js';
import { SkillRepository } from './skillRepository.js';
import { NotificationRepository } from './notificationRepository.js';

export interface Repositories {
  audit: AuditRepository;
  tools: ToolRepository;
  clauses: ClauseRepository;
  templates: TemplateRepository;
  projects: ProjectRepository;
  results: ResultRepository;
  reports: ReportRepository;
  commandRuns: CommandRunRepository;
  standards: StandardRepository;
  categories: CategoryRepository;
  agent: AgentRepository;
  artifacts: ArtifactRepository;
  settings: SettingRepository;
  knowledge: KnowledgeRepository;
  skills: SkillRepository;
  notifications: NotificationRepository;
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
    standards: new StandardRepository(db),
    categories: new CategoryRepository(db),
    agent: new AgentRepository(db),
    artifacts: new ArtifactRepository(db),
    settings: new SettingRepository(db),
    knowledge: new KnowledgeRepository(db),
    skills: new SkillRepository(db),
    notifications: new NotificationRepository(db),
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
    standards: new StandardRepository(db),
    categories: new CategoryRepository(db),
    agent: new AgentRepository(db),
    artifacts: new ArtifactRepository(db),
    settings: new SettingRepository(db),
    knowledge: new KnowledgeRepository(db),
    skills: new SkillRepository(db),
    notifications: new NotificationRepository(db),
  };
  return { repos: r, close: () => db.close() };
}
